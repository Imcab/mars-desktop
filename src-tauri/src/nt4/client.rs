use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message, tungstenite::client::IntoClientRequest};
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use std::collections::HashMap;

type RttTuple = (i32, u32, i32, u64);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum NTValue {
    Boolean(bool),
    Number(f64),
    String(String),
    NumberArray(Vec<f64>), // <-- SOPORTE PARA DOUBLE[]
    Raw(Vec<u8>),          // <-- SOPORTE PARA STRUCTS (BYTES)
}

#[derive(Clone)]
pub struct TopicHistory {
    pub name: String,
    pub topic_type: String,
    pub data: Vec<(u64, NTValue)>,
}

pub struct NTBuffer {
    pub topics: HashMap<i32, TopicHistory>,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
}

// Helper: extrae un f64 sin importar si MessagePack lo mandó como Float,
// Integer o UInteger (los ints de NT4 llegan como enteros nativos, no floats).
fn value_as_f64(v: &rmpv::Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_i64().map(|i| i as f64))
        .or_else(|| v.as_u64().map(|u| u as f64))
}

impl NTBuffer {
    pub fn new() -> Self { Self { topics: HashMap::new(), start_time: None, end_time: None } }

    pub fn add_topic(&mut self, id: i32, name: String, topic_type: String) {
        if !self.topics.contains_key(&id) {
            self.topics.insert(id, TopicHistory { name, topic_type, data: Vec::new() });
        }
    }

    // IMPORTANTE: `value` ahora es rmpv::Value (tipo nativo de MessagePack),
    // NO serde_json::Value. serde_json::Value no tiene variante para bytes,
    // así que al llegar un topic "raw" (structs, protobuf, msgpack -> type_idx 5)
    // la deserialización a serde_json::Value fallaba silenciosamente y rompía
    // el loop de lectura de ese frame binario completo. Con rmpv::Value los
    // bytes llegan como Value::Binary y sí se pueden leer.
    pub fn insert_value(&mut self, id: i32, timestamp: u64, type_idx: i32, value: rmpv::Value) {
        if let Some(topic) = self.topics.get_mut(&id) {
            let nt_val = match type_idx {
                0 => NTValue::Boolean(value.as_bool().unwrap_or(false)),
                1 | 2 | 3 => NTValue::Number(value_as_f64(&value).unwrap_or(0.0)),
                4 => NTValue::String(value.as_str().unwrap_or("").to_string()),
                // Raw / struct / protobuf / msgpack (bytes)
                5 => {
                    match &value {
                        rmpv::Value::Binary(bytes) => NTValue::Raw(bytes.clone()),
                        rmpv::Value::Array(arr) => {
                            let bytes: Vec<u8> = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();
                            NTValue::Raw(bytes)
                        }
                        _ => return,
                    }
                },
                // Arreglo de doubles (DoubleArray)
                17 => {
                    if let Some(arr) = value.as_array() {
                        let doubles: Vec<f64> = arr.iter().filter_map(value_as_f64).collect();
                        NTValue::NumberArray(doubles)
                    } else { return; }
                },
                _ => return,
            };
            topic.data.push((timestamp, nt_val));

            if self.start_time.is_none() || timestamp < self.start_time.unwrap() { self.start_time = Some(timestamp); }
            if self.end_time.is_none() || timestamp > self.end_time.unwrap() { self.end_time = Some(timestamp); }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TopicAnnounce { pub id: i32, pub name: String, pub topic_type: String }

pub struct NT4Client {
    pub is_connected: bool, pub current_ip: String, tx: Option<mpsc::Sender<Message>>, pub buffer: Arc<Mutex<NTBuffer>>, 
}

impl NT4Client {
    pub fn new() -> Self {
        Self { is_connected: false, current_ip: String::new(), tx: None, buffer: Arc::new(Mutex::new(NTBuffer::new())) }
    }

    pub async fn connect(&mut self, ip: &str, app_handle: AppHandle) -> Result<(), String> {
        self.disconnect().await;
        self.current_ip = ip.to_string();
        let url = format!("ws://{}:5810/nt/MARS", ip);
        
        let mut request = url.into_client_request().map_err(|e| e.to_string())?;
        request.headers_mut().insert("Sec-WebSocket-Protocol", "v4.1.networktables.first.wpi.edu".parse().unwrap());

        let (ws_stream, _) = connect_async(request).await.map_err(|e| format!("Error conectando a {}: {}", ip, e))?;
        
        self.buffer = Arc::new(Mutex::new(NTBuffer::new()));
        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::channel::<Message>(100);
        self.tx = Some(tx.clone());
        self.is_connected = true;

        let app_handle_clone = app_handle.clone();
        let buffer_clone = self.buffer.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        if let Some(msg) = msg { if write.send(msg).await.is_err() { break; } } else { break; }
                    }
                    incoming = read.next() => {
                        match incoming {
                            Some(Ok(Message::Binary(bin))) => {
                                let mut buff = buffer_clone.lock().await;
                                let mut cursor = std::io::Cursor::new(&bin);
                                while (cursor.position() as usize) < bin.len() {
                                    if let Ok(record) = rmp_serde::from_read::<_, (i32, u64, i32, rmpv::Value)>(&mut cursor) {
                                        buff.insert_value(record.0, record.1, record.2, record.3);
                                    } else { break; }
                                }
                            }
                            Some(Ok(Message::Text(text))) => {
                                if let Ok(json_array) = serde_json::from_str::<Vec<serde_json::Value>>(&text) {
                                    for msg in json_array {
                                        if let (Some(method), Some(params)) = (msg.get("method").and_then(|m| m.as_str()), msg.get("params")) {
                                            if method == "announce" {
                                                if let (Some(name), Some(id), Some(t_type)) = (
                                                    params.get("name").and_then(|n| n.as_str()), params.get("id").and_then(|i| i.as_i64()), params.get("type").and_then(|t| t.as_str())
                                                ) {
                                                    buffer_clone.lock().await.add_topic(id as i32, name.to_string(), t_type.to_string());
                                                    let topic = TopicAnnounce { id: id as i32, name: name.to_string(), topic_type: t_type.to_string() };
                                                    let _ = app_handle_clone.emit("nt-topic-announced", topic);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => { break; }
                            _ => {} 
                        }
                    }
                }
            }
            let _ = app_handle_clone.emit("nt-disconnected", ());
        });

        self.send_initial_rtt().await?;
        if let Some(tx_channel) = &self.tx {
            let sub_msg = serde_json::json!([{"method": "subscribe", "params": {"topics": [""], "subuid": 1, "options": { "all": true, "prefix": true, "periodic": 0.05 }}}]);
            let _ = tx_channel.send(Message::Text(sub_msg.to_string().into())).await;
        }
        Ok(())
    }

    pub async fn disconnect(&mut self) {
        if self.is_connected {
            self.tx = None; 
            self.is_connected = false;
            self.current_ip.clear();
        }
    }

    async fn send_initial_rtt(&self) -> Result<(), String> {
        if let Some(tx) = &self.tx {
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros() as u64;
            let rtt_payload: RttTuple = (-1, 0, 2, timestamp);
            if let Ok(bin_data) = rmp_serde::to_vec(&rtt_payload) {
                tx.send(Message::Binary(bin_data.into())).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
pub struct NT4State(pub Arc<Mutex<NT4Client>>);