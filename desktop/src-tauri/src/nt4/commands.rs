use tauri::{State, AppHandle};
use super::client::{partition_point_deque, NT4State, NTValue, TopicAnnounce};
use super::wpilog::{self, ExportSummary, LogSummary};
use super::bandwidth::{self, BandwidthReport};
use std::collections::HashMap;
use std::path::PathBuf;
use serde::Serialize;

/// 3472 -> 10.34.72.2. Si no es un número, se toma tal cual como host
/// (permite pasar un hostname o una IP directamente).
fn team_to_address(team: &str) -> String {
    match team.trim().parse::<u32>() {
        Ok(team) => format!("10.{}.{:02}.2", team / 100, team % 100),
        Err(_) => team.trim().to_string(),
    }
}

#[tauri::command]
pub async fn connect_sim(app: AppHandle, state: State<'_, NT4State>) -> Result<String, String> {
    // El simulador siempre corre en la máquina local, pero el puerto sí
    // depende del destino: la Driver Station reexpone los mismos datos en
    // 6767 sobre localhost.
    let port = crate::load_mars_settings().nt_port();
    let mut client = state.0.lock().await;
    match client.connect("127.0.0.1", port, app).await {
        Ok(_) => {
            client.connection_mode = "sim".to_string();
            Ok(format!("Simulation connected at 127.0.0.1:{}", port))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn connect_real(team_number: Option<String>, app: AppHandle, state: State<'_, NT4State>) -> Result<String, String> {
    let settings = crate::load_mars_settings();
    let port = settings.nt_port();

    // Una dirección custom gana sobre el número de equipo: es la única forma
    // de llegar al robot por USB (172.22.11.2) o por hostname.
    let ip = if !settings.nt_custom_address.trim().is_empty() {
        settings.nt_custom_address.trim().to_string()
    } else {
        let team = team_number
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| settings.team_number.clone());
        team_to_address(&team)
    };

    let mut client = state.0.lock().await;
    match client.connect(&ip, port, app).await {
        Ok(_) => {
            client.connection_mode = "real".to_string();
            Ok(format!("Connected to real robot at {}:{}", ip, port))
        }
        Err(e) => Err(e),
    }
}

// --- Logs (.wpilog) ---------------------------------------------------------

/// Vuelca el buffer actual a un archivo WPILOG. Sirve tanto para una sesión en
/// vivo como para reexportar un log ya abierto.
#[tauri::command]
pub async fn export_wpilog(path: String, state: State<'_, NT4State>) -> Result<ExportSummary, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    if buffer.topics.is_empty() {
        return Err("No hay datos en el buffer para exportar.".to_string());
    }
    wpilog::write_wpilog(&buffer, &PathBuf::from(&path))
}

#[derive(Serialize)]
pub struct OpenLogResult {
    pub summary: LogSummary,
    /// Los topics del log, para que el front reemplace el árbol de una sola vez
    /// en vez de recibir cientos de eventos `nt-topic-announced` sueltos.
    pub topics: Vec<TopicAnnounce>,
}

/// Carga un WPILOG en el mismo buffer que usa NT4. Como el buffer es la única
/// fuente de datos de toda la app, con esto Field, Swerve, Mechanism, Display y
/// Functions pasan a leer del log sin cambiar una línea.
#[tauri::command]
pub async fn open_wpilog(path: String, state: State<'_, NT4State>) -> Result<OpenLogResult, String> {
    let (topics, summary) = wpilog::read_wpilog(&PathBuf::from(&path))?;

    let mut client = state.0.lock().await;
    // El log y la conexión comparten buffer: dejar NT4 vivo haría que los datos
    // en vivo se mezclen con los del archivo en la misma timeline.
    client.disconnect().await;

    let announces: Vec<TopicAnnounce> = topics
        .iter()
        .map(|(id, h)| TopicAnnounce { id: *id, name: h.name.clone(), topic_type: h.topic_type.clone() })
        .collect();

    let mut buffer = client.buffer.lock().await;
    wpilog::load_into_buffer(&mut buffer, topics, &summary);

    Ok(OpenLogResult { summary, topics: announces })
}

/// Descarta el log cargado y deja el buffer limpio para volver a conectarse.
#[tauri::command]
pub async fn close_log(state: State<'_, NT4State>) -> Result<(), String> {
    let client = state.0.lock().await;
    let mut buffer = client.buffer.lock().await;
    buffer.topics.clear();
    buffer.end_time = None;
    Ok(())
}

/// Consumo de ancho de banda por topic, sobre los últimos `window_seconds`
/// de datos del buffer. En competencia el FMS corta en 4 Mbps y la causa
/// típica de pasarse es loguear de más sin saberlo.
#[tauri::command]
pub async fn get_bandwidth_report(window_seconds: u32, state: State<'_, NT4State>) -> Result<BandwidthReport, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    Ok(bandwidth::measure(&buffer, window_seconds))
}

#[derive(Serialize)]
pub struct NTLinkStatus {
    pub address: String,
    pub port: u16,
    pub connected: bool,
    /// Mitad del round trip medido con el ping RTT, en µs.
    pub latency_us: i64,
    /// Hora del servidor NT en µs, o None si todavía no sincronizamos relojes.
    pub server_time_us: Option<u64>,
}

/// Estado del enlace NT4 tal como lo mide el ping RTT. Sirve para mostrar a
/// qué host:puerto se está hablando de verdad (antes la barra de estado
/// asumía siempre localhost:5810) y si los relojes ya están sincronizados.
#[tauri::command]
pub async fn get_nt_link_status(state: State<'_, NT4State>) -> Result<NTLinkStatus, String> {
    let client = state.0.lock().await;
    Ok(NTLinkStatus {
        address: client.current_ip.clone(),
        port: client.current_port,
        connected: client.is_connected,
        latency_us: client.network_latency_us(),
        server_time_us: client.server_time_us(),
    })
}

#[tauri::command]
pub async fn disconnect_nt(state: State<'_, NT4State>) -> Result<String, String> {
    let mut client = state.0.lock().await;
    client.disconnect().await;
    Ok("Disconnected successfully".to_string())
}

/// Ajusta cuánto historial por topic se conserva en RAM antes de podarse.
/// `minutes == 0` desactiva la poda (sesión completa en memoria, a costa de
/// crecimiento sin límite -- pensado para quien quiera grabar una prueba
/// larga entera y sabe que va a cerrar la app después).
#[tauri::command]
pub async fn set_buffer_retention_minutes(minutes: u32, state: State<'_, NT4State>) -> Result<(), String> {
    let client = state.0.lock().await;
    let mut buffer = client.buffer.lock().await;
    buffer.set_retention_us(minutes as u64 * 60 * 1_000_000);
    Ok(())
}

#[derive(Serialize)]
pub struct TimeBounds {
    pub start: Option<u64>,
    pub end: Option<u64>,
}

#[tauri::command]
pub async fn get_time_bounds(state: State<'_, NT4State>) -> Result<TimeBounds, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    Ok(TimeBounds { start: buffer.effective_start_time(), end: buffer.end_time })
}

#[tauri::command]
pub async fn get_live_values(topic_names: Vec<String>, state: State<'_, NT4State>) -> Result<HashMap<String, NTValue>, String> {
    let client = state.0.lock().await;
    let mut result = HashMap::new();

    let buffer = client.buffer.lock().await;

    for history in buffer.topics.values() {
        if topic_names.contains(&history.name) {
            if let Some((_, last_value)) = history.data.back() {
                result.insert(history.name.clone(), last_value.clone());
            }
        }
    }

    Ok(result)
}

/// Igual que get_live_values pero para un instante específico del pasado:
/// devuelve el último valor conocido de cada topic con timestamp <= `timestamp`.
/// Es lo que usa el frontend cuando la timeline está en pausa/scrub.
#[tauri::command]
pub async fn get_values_at(
    topic_names: Vec<String>,
    timestamp: u64,
    state: State<'_, NT4State>,
) -> Result<HashMap<String, NTValue>, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    let mut result = HashMap::new();

    for history in buffer.topics.values() {
        if !topic_names.contains(&history.name) { continue; }

        // Requiere que history.data esté ordenado por timestamp (lo está,
        // ya que insert_value hace push en orden de llegada del websocket).
        let idx = partition_point_deque(&history.data, |(ts, _)| *ts <= timestamp);
        if idx == 0 { continue; } // no había ningún valor todavía en ese instante
        result.insert(history.name.clone(), history.data[idx - 1].1.clone());
    }

    Ok(result)
}

/// Devuelve TODOS los puntos de cada topic dentro de [start, end]. Lo usa
/// FunctionPage/useLiveSeriesBuffers cuando está pausado, para reconstruir
/// la ventana de la gráfica desde el buffer real en vez de acumulación local.
#[tauri::command]
pub async fn get_values_range(
    topic_names: Vec<String>,
    start: u64,
    end: u64,
    state: State<'_, NT4State>,
) -> Result<HashMap<String, Vec<(u64, NTValue)>>, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    let mut result = HashMap::new();

    for history in buffer.topics.values() {
        if !topic_names.contains(&history.name) { continue; }

        let lo = partition_point_deque(&history.data, |(ts, _)| *ts < start);
        let hi = partition_point_deque(&history.data, |(ts, _)| *ts <= end);
        result.insert(history.name.clone(), history.data.range(lo..hi).cloned().collect());
    }

    Ok(result)
}

fn type_idx_from_type_str(topic_type: &str) -> Result<i32, String> {
    match topic_type {
        "boolean" => Ok(0),
        "double" => Ok(1),
        "int" => Ok(2),
        "float" => Ok(3),
        "string" => Ok(4),
        // Los arreglos hacen falta para la NT Session: un Pose2d publicado a
        // mano viaja como double[] {x, y, theta}. Los indices son los que fija
        // la spec de NT4 y los mismos que decodifica `insert_value`.
        "boolean[]" => Ok(16),
        "double[]" => Ok(17),
        "int[]" => Ok(18),
        "float[]" => Ok(19),
        "string[]" => Ok(20),
        // Todo lo binario comparte el indice 5: structs de WPILib, sus schemas
        // y el raw suelto. El frontend arma los bytes (ya tiene la tabla de
        // layouts para decodificarlos) y los manda como arreglo de numeros.
        "structschema" | "raw" | "rpc" | "msgpack" | "protobuf" => Ok(5),
        other if other.starts_with("struct:") => Ok(5),
        other => Err(format!("Tipo no soportado para escritura todavía: {}", other)),
    }
}

/// Convierte un array JSON aplicando `item` a cada elemento. Un solo elemento
/// invalido invalida el arreglo entero: publicar la mitad de un Pose2d seria
/// peor que fallar.
fn json_array_to_rmpv(
    value: &serde_json::Value,
    what: &str,
    item: impl Fn(&serde_json::Value) -> Option<rmpv::Value>,
) -> Result<rmpv::Value, String> {
    let array = value.as_array().ok_or_else(|| format!("Se esperaba un arreglo de {}", what))?;
    let mut out = Vec::with_capacity(array.len());
    for entry in array {
        out.push(item(entry).ok_or_else(|| format!("Elemento inválido en el arreglo de {}", what))?);
    }
    Ok(rmpv::Value::Array(out))
}

fn json_to_rmpv(value: &serde_json::Value, type_idx: i32) -> Result<rmpv::Value, String> {
    match type_idx {
        0 => value.as_bool().map(rmpv::Value::from).ok_or_else(|| "Valor booleano inválido".to_string()),
        1 | 3 => value.as_f64().map(rmpv::Value::from).ok_or_else(|| "Valor numérico inválido".to_string()),
        2 => value.as_i64().map(rmpv::Value::from).ok_or_else(|| "Valor entero inválido".to_string()),
        4 => value.as_str().map(|s| rmpv::Value::from(s)).ok_or_else(|| "Valor de texto inválido".to_string()),
        16 => json_array_to_rmpv(value, "booleanos", |v| v.as_bool().map(rmpv::Value::from)),
        17 | 19 => json_array_to_rmpv(value, "números", |v| v.as_f64().map(rmpv::Value::from)),
        18 => json_array_to_rmpv(value, "enteros", |v| v.as_i64().map(rmpv::Value::from)),
        20 => json_array_to_rmpv(value, "textos", |v| v.as_str().map(rmpv::Value::from)),
        // Binario: llega como arreglo de bytes 0..255.
        5 => {
            let array = value.as_array().ok_or("Se esperaba un arreglo de bytes")?;
            let mut bytes = Vec::with_capacity(array.len());
            for entry in array {
                let byte = entry.as_u64().filter(|n| *n <= 255)
                    .ok_or("Byte fuera de rango (se esperaba 0..255)")?;
                bytes.push(byte as u8);
            }
            Ok(rmpv::Value::Binary(bytes))
        }
        _ => Err("Tipo no soportado para escritura todavía".to_string()),
    }
}

/// Escribe un valor en un topic de NetworkTables (Command Console).
/// `value` llega como JSON crudo desde el frontend; se convierte al tipo
/// correcto según `topic_type` antes de mandarlo por el socket.
#[tauri::command]
pub async fn set_value(
    topic_name: String,
    topic_type: String,
    value: serde_json::Value,
    state: State<'_, NT4State>,
) -> Result<(), String> {
    let type_idx = type_idx_from_type_str(&topic_type)?;
    let rmpv_value = json_to_rmpv(&value, type_idx)?;
    let mut client = state.0.lock().await;
    client.set_value(&topic_name, &topic_type, type_idx, rmpv_value).await
}

/// Retira un topic publicado por MARS (ver `NT4Client::unpublish`).
#[tauri::command]
pub async fn unpublish_value(topic_name: String, state: State<'_, NT4State>) -> Result<(), String> {
    let mut client = state.0.lock().await;
    client.unpublish(&topic_name).await
}

#[derive(Serialize)]
pub struct JitterStats {
    pub mean_dt_ms: f64,
    pub stddev_dt_ms: f64,
    pub min_dt_ms: f64,
    pub max_dt_ms: f64,
    pub sample_count: usize,
    pub expected_hz: f64,
}

/// Analiza el timing de llegada de cada topic dentro de una ventana reciente
/// (no toda la sesión, para que refleje el comportamiento ACTUAL del robot,
/// no un promedio diluido de horas de conexión). Calcula el delta entre
/// timestamps consecutivos -- eso es directamente el período real de
/// publicación de ese topic, con sus drops y overruns incluidos.
#[tauri::command]
pub async fn get_jitter_stats(
    topic_names: Vec<String>,
    window_us: u64,
    state: State<'_, NT4State>,
) -> Result<HashMap<String, JitterStats>, String> {
    let client = state.0.lock().await;
    let buffer = client.buffer.lock().await;
    let mut result = HashMap::new();

    let now = buffer.end_time.unwrap_or(0);
    let cutoff = now.saturating_sub(window_us);

    for history in buffer.topics.values() {
        if !topic_names.contains(&history.name) { continue; }

        let timestamps: Vec<u64> = history.data.iter()
            .map(|(ts, _)| *ts)
            .filter(|&ts| ts >= cutoff)
            .collect();

        if timestamps.len() < 2 { continue; } // no hay suficientes samples en la ventana

        let deltas: Vec<f64> = timestamps.windows(2)
            .map(|w| (w[1] - w[0]) as f64 / 1000.0) // us -> ms
            .collect();

        let n = deltas.len() as f64;
        let mean = deltas.iter().sum::<f64>() / n;
        let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / n;
        let stddev = variance.sqrt();
        let min = deltas.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = deltas.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        result.insert(history.name.clone(), JitterStats {
            mean_dt_ms: mean,
            stddev_dt_ms: stddev,
            min_dt_ms: min,
            max_dt_ms: max,
            sample_count: timestamps.len(),
            expected_hz: if mean > 0.0 { 1000.0 / mean } else { 0.0 },
        });
    }

    Ok(result)
}