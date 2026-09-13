//! Cuánto ancho de banda consume cada topic de NetworkTables.
//!
//! En competencia el FMS impone un tope duro de 4 Mbps por robot, y la forma
//! típica de reventarlo es loguear de más sin darse cuenta: el equipo se
//! entera cuando el dashboard se congela en una eliminatoria. Acá se mide
//! sobre los datos que YA están en el buffer, sin instrumentar nada extra.

use serde::Serialize;

use super::client::{NTBuffer, NTValue};

/// Límite de ancho de banda que impone el FMS a cada robot, en bits/s.
pub const FMS_LIMIT_BITS_PER_SEC: f64 = 4_000_000.0;

/// Bytes que gasta NT4 por muestra además del valor: cabecera del array
/// MessagePack + id de topic + timestamp + índice de tipo. Es una
/// aproximación, pero ignorarlo subestima mucho a los topics de valores
/// chicos (un booleano son 1 byte de dato y ~9 de sobre).
const FRAMING_OVERHEAD_BYTES: u64 = 9;

/// Tamaño en bytes del VALOR de una muestra, tal como viaja por el socket.
fn value_size(value: &NTValue) -> u64 {
    match value {
        NTValue::Boolean(_) => 1,
        NTValue::Number(_) => 8,
        NTValue::String(s) => s.len() as u64,
        NTValue::NumberArray(a) => (a.len() * 8) as u64,
        NTValue::BooleanArray(a) => a.len() as u64,
        // Cada string del array va precedido por su largo (4 bytes).
        NTValue::StringArray(a) => a.iter().map(|s| s.len() as u64 + 4).sum::<u64>() + 4,
        NTValue::Raw(b) => b.len() as u64,
    }
}

#[derive(Serialize)]
pub struct TopicBandwidth {
    pub name: String,
    pub topic_type: String,
    pub sample_count: usize,
    pub total_bytes: u64,
    pub bytes_per_second: f64,
    pub samples_per_second: f64,
    /// Fracción del total medido, de 0 a 1.
    pub share: f64,
}

#[derive(Serialize)]
pub struct BandwidthReport {
    /// Segundos de datos que realmente cubrió la medición (puede ser menos que
    /// la ventana pedida si el buffer todavía no la llenó).
    pub window_seconds: f64,
    pub total_bytes: u64,
    pub total_bytes_per_second: f64,
    pub total_bits_per_second: f64,
    /// Porcentaje del tope del FMS que se está usando.
    pub percent_of_fms_limit: f64,
    pub topic_count: usize,
    /// Ordenados de mayor a menor consumo.
    pub topics: Vec<TopicBandwidth>,
}

/// Mide sobre los últimos `window_seconds` de datos del buffer.
pub fn measure(buffer: &NTBuffer, window_seconds: u32) -> BandwidthReport {
    let empty = BandwidthReport {
        window_seconds: 0.0,
        total_bytes: 0,
        total_bytes_per_second: 0.0,
        total_bits_per_second: 0.0,
        percent_of_fms_limit: 0.0,
        topic_count: 0,
        topics: Vec::new(),
    };

    let Some(end_us) = buffer.end_time else { return empty };
    let window_us = (window_seconds.max(1) as u64) * 1_000_000;
    let cutoff_us = end_us.saturating_sub(window_us);

    let mut rows: Vec<TopicBandwidth> = Vec::new();
    let mut total_bytes: u64 = 0;
    // El span REAL medido: si el buffer solo tiene 3s de datos, dividir por una
    // ventana de 10s daría un tercio del consumo verdadero.
    let mut earliest_in_window = end_us;

    for history in buffer.topics.values() {
        let mut bytes: u64 = 0;
        let mut count: usize = 0;

        // Los datos están ordenados por timestamp, así que se recorre desde
        // el final y se corta al salir de la ventana.
        for (ts, value) in history.data.iter().rev() {
            if *ts < cutoff_us { break; }
            bytes += value_size(value) + FRAMING_OVERHEAD_BYTES;
            count += 1;
            if *ts < earliest_in_window { earliest_in_window = *ts; }
        }

        if count == 0 { continue; }
        total_bytes += bytes;
        rows.push(TopicBandwidth {
            name: history.name.clone(),
            topic_type: history.topic_type.clone(),
            sample_count: count,
            total_bytes: bytes,
            bytes_per_second: 0.0,   // se completa abajo, con el span real
            samples_per_second: 0.0,
            share: 0.0,
        });
    }

    if rows.is_empty() { return empty; }

    // Con una sola muestra el span es 0; se usa un piso para no dividir por cero.
    let span_seconds = ((end_us.saturating_sub(earliest_in_window)) as f64 / 1e6).max(0.001);

    for row in rows.iter_mut() {
        row.bytes_per_second = row.total_bytes as f64 / span_seconds;
        row.samples_per_second = row.sample_count as f64 / span_seconds;
        row.share = if total_bytes > 0 { row.total_bytes as f64 / total_bytes as f64 } else { 0.0 };
    }

    rows.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));

    let total_bytes_per_second = total_bytes as f64 / span_seconds;
    let total_bits_per_second = total_bytes_per_second * 8.0;

    BandwidthReport {
        window_seconds: span_seconds,
        total_bytes,
        total_bytes_per_second,
        total_bits_per_second,
        percent_of_fms_limit: (total_bits_per_second / FMS_LIMIT_BITS_PER_SEC) * 100.0,
        topic_count: rows.len(),
        topics: rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::client::TopicHistory;
    use std::collections::VecDeque;

    fn buffer_with(entries: Vec<(&str, &str, Vec<(u64, NTValue)>)>, end: u64) -> NTBuffer {
        let mut buffer = NTBuffer::new();
        for (i, (name, ty, data)) in entries.into_iter().enumerate() {
            buffer.topics.insert(i as i32, TopicHistory {
                name: name.to_string(),
                topic_type: ty.to_string(),
                data: VecDeque::from(data),
            });
        }
        buffer.end_time = Some(end);
        buffer
    }

    #[test]
    fn empty_buffer_reports_zero() {
        let report = measure(&NTBuffer::new(), 10);
        assert_eq!(report.total_bytes, 0);
        assert!(report.topics.is_empty());
    }

    #[test]
    fn counts_value_size_plus_framing() {
        // Un double son 8 bytes de dato + el sobre de NT4.
        let buffer = buffer_with(
            vec![("/a", "double", vec![(1_000_000, NTValue::Number(1.0))])],
            1_000_000,
        );
        let report = measure(&buffer, 10);
        assert_eq!(report.total_bytes, 8 + FRAMING_OVERHEAD_BYTES);
    }

    #[test]
    fn ignores_samples_outside_the_window() {
        let buffer = buffer_with(
            vec![("/a", "double", vec![
                (1_000_000, NTValue::Number(1.0)),   // 9s antes del final
                (9_000_000, NTValue::Number(2.0)),
                (10_000_000, NTValue::Number(3.0)),
            ])],
            10_000_000,
        );
        // Ventana de 2s: solo entran las dos últimas.
        let report = measure(&buffer, 2);
        assert_eq!(report.topics[0].sample_count, 2);
    }

    #[test]
    fn ranks_topics_by_consumption() {
        // Un struct de 64 bytes a la misma tasa pesa mucho más que un booleano.
        let buffer = buffer_with(
            vec![
                ("/small", "boolean", vec![(1_000_000, NTValue::Boolean(true)), (2_000_000, NTValue::Boolean(false))]),
                ("/big", "raw", vec![(1_000_000, NTValue::Raw(vec![0; 64])), (2_000_000, NTValue::Raw(vec![0; 64]))]),
            ],
            2_000_000,
        );
        let report = measure(&buffer, 10);
        assert_eq!(report.topics[0].name, "/big");
        assert!(report.topics[0].share > report.topics[1].share);
        // Las fracciones tienen que sumar 1.
        let sum: f64 = report.topics.iter().map(|t| t.share).sum();
        assert!((sum - 1.0).abs() < 1e-9);
    }

    #[test]
    fn rate_uses_the_real_span_not_the_requested_window() {
        // Solo hay 1s de datos: pedir una ventana de 60s no puede hacer que el
        // consumo parezca 60 veces menor.
        let buffer = buffer_with(
            vec![("/a", "double", vec![
                (1_000_000, NTValue::Number(1.0)),
                (2_000_000, NTValue::Number(2.0)),
            ])],
            2_000_000,
        );
        let report = measure(&buffer, 60);
        assert!((report.window_seconds - 1.0).abs() < 1e-6);
        let expected = (2 * (8 + FRAMING_OVERHEAD_BYTES)) as f64 / 1.0;
        assert!((report.total_bytes_per_second - expected).abs() < 1e-6);
    }

    #[test]
    fn string_array_counts_each_length_prefix() {
        let value = NTValue::StringArray(vec!["ab".into(), "cde".into()]);
        // 4 (cantidad) + (4+2) + (4+3) = 17
        assert_eq!(value_size(&value), 17);
    }

    #[test]
    fn single_sample_does_not_divide_by_zero() {
        let buffer = buffer_with(
            vec![("/a", "double", vec![(5_000_000, NTValue::Number(1.0))])],
            5_000_000,
        );
        let report = measure(&buffer, 10);
        assert!(report.total_bytes_per_second.is_finite());
        assert!(report.total_bytes_per_second > 0.0);
    }
}
