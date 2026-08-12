use tauri::{State, AppHandle};
use super::client::{NT4State, NTValue};
use std::collections::HashMap;
use serde::Serialize;

#[tauri::command]
pub async fn connect_sim(app: AppHandle, state: State<'_, NT4State>) -> Result<String, String> {
    let mut client = state.0.lock().await;
    match client.connect("127.0.0.1", app).await {
        Ok(_) => Ok("Simulation Connected".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn connect_real(team_number: String, app: AppHandle, state: State<'_, NT4State>) -> Result<String, String> {
    let mut client = state.0.lock().await;
    let ip = match team_number.parse::<u32>() {
        Ok(team) => {
            let te = team / 100;
            let am = format!("{:02}", team % 100);
            format!("10.{}.{}.2", te, am)
        },
        Err(_) => team_number
    };
    match client.connect(&ip, app).await {
        Ok(_) => Ok(format!("Connected to Real Robot at {}", ip)),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn disconnect_nt(state: State<'_, NT4State>) -> Result<String, String> {
    let mut client = state.0.lock().await;
    client.disconnect().await;
    Ok("Disconnected successfully".to_string())
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
    Ok(TimeBounds { start: buffer.start_time, end: buffer.end_time })
}

#[tauri::command]
pub async fn get_live_values(topic_names: Vec<String>, state: State<'_, NT4State>) -> Result<HashMap<String, NTValue>, String> {
    let client = state.0.lock().await;
    let mut result = HashMap::new();

    let buffer = client.buffer.lock().await;

    for history in buffer.topics.values() {
        if topic_names.contains(&history.name) {
            if let Some((_, last_value)) = history.data.last() {
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
        let idx = history.data.partition_point(|(ts, _)| *ts <= timestamp);
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

        let lo = history.data.partition_point(|(ts, _)| *ts < start);
        let hi = history.data.partition_point(|(ts, _)| *ts <= end);
        result.insert(history.name.clone(), history.data[lo..hi].to_vec());
    }

    Ok(result)
}