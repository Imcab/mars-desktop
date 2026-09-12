use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message, tungstenite::client::IntoClientRequest};
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use std::collections::{HashMap, VecDeque};

type RttTuple = (i32, u32, i32, u64);

/// Cuánto historial se conserva por topic antes de podarse (evita crecimiento
/// sin límite de memoria en sesiones largas). 0 = sin límite (opt-in explícito
/// vía `set_buffer_retention_minutes`, para quien quiera grabar la sesión
/// completa a costa de memoria).
const DEFAULT_RETENTION_US: u64 = 15 * 60 * 1_000_000;

/// Cada cuánto se manda el ping de round trip (topic id -1). Es el periodo que
/// usa AdvantageScope para v4.1; sin esto el offset servidor/cliente se
/// calcularía una sola vez al conectar y quedaría a la deriva del reloj.
const RTT_PERIOD: Duration = Duration::from_millis(250);

const RECONNECT_MIN_BACKOFF: Duration = Duration::from_secs(1);
const RECONNECT_MAX_BACKOFF: Duration = Duration::from_secs(15);

/// Equivalente a `[T]::partition_point` pero para `VecDeque`, que no expone
/// el método directamente. Asume que `deque` está ordenado según `pred`
/// (monótono decreciente de true a false), tal como lo está `TopicHistory.data`
/// por venir siempre insertado en orden de llegada/timestamp creciente.
pub fn partition_point_deque<T>(deque: &VecDeque<T>, pred: impl Fn(&T) -> bool) -> usize {
    let mut lo = 0usize;
    let mut hi = deque.len();
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if pred(&deque[mid]) { lo = mid + 1; } else { hi = mid; }
    }
    lo
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum NTValue {
    Boolean(bool),
    Number(f64),
    String(String),
    NumberArray(Vec<f64>),      // double[] / int[] / float[]
    BooleanArray(Vec<bool>),
    StringArray(Vec<String>),
    Raw(Vec<u8>),               // structs, protobuf, msgpack (bytes)
}

#[derive(Clone)]
pub struct TopicHistory {
    pub name: String,
    pub topic_type: String,
    pub data: VecDeque<(u64, NTValue)>,
}

pub struct NTBuffer {
    pub topics: HashMap<i32, TopicHistory>,
    pub end_time: Option<u64>,
    /// Ventana de retención en microsegundos. 0 = sin límite.
    pub retention_us: u64,
}

// Helper: extrae un f64 sin importar si MessagePack lo mandó como Float,
// Integer o UInteger (los ints de NT4 llegan como enteros nativos, no floats).
fn value_as_f64(v: &rmpv::Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_i64().map(|i| i as f64))
        .or_else(|| v.as_u64().map(|u| u as f64))
}

fn value_as_u64(v: &rmpv::Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_i64().map(|i| i as u64))
        .or_else(|| v.as_f64().map(|f| f as u64))
}

/// Reloj local en microsegundos desde epoch. Es la escala en la que mandamos
/// los pings RTT y contra la que se mide la respuesta; NO es la escala de
/// timestamps de NT4 (esa la da `NT4Client::server_time_us`).
fn now_epoch_us() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0)
}

impl NTBuffer {
    pub fn new() -> Self {
        Self { topics: HashMap::new(), end_time: None, retention_us: DEFAULT_RETENTION_US }
    }

    pub fn add_topic(&mut self, id: i32, name: String, topic_type: String) {
        if !self.topics.contains_key(&id) {
            self.topics.insert(id, TopicHistory { name, topic_type, data: VecDeque::new() });
        }
    }

    /// Más viejo timestamp todavía presente en el buffer, calculado on-demand
    /// escaneando el frente de cada topic (barato: O(topics), no O(samples)).
    /// No se puede mantener como campo incremental porque la poda por
    /// retención invalida cualquier mínimo cacheado.
    pub fn effective_start_time(&self) -> Option<u64> {
        self.topics.values().filter_map(|h| h.data.front().map(|(ts, _)| *ts)).min()
    }

    pub fn set_retention_us(&mut self, us: u64) {
        self.retention_us = us;
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
                // 16 = boolean[]
                16 => {
                    if let Some(arr) = value.as_array() {
                        NTValue::BooleanArray(arr.iter().map(|v| v.as_bool().unwrap_or(false)).collect())
                    } else { return; }
                },
                // 17 = double[], 18 = int[], 19 = float[]. Los tres son
                // numéricos y el front los consume igual: el índice solo dice
                // con qué precisión los publicó el robot, no cambia el valor.
                17 | 18 | 19 => {
                    if let Some(arr) = value.as_array() {
                        let doubles: Vec<f64> = arr.iter().filter_map(value_as_f64).collect();
                        NTValue::NumberArray(doubles)
                    } else { return; }
                },
                // 20 = string[]
                20 => {
                    if let Some(arr) = value.as_array() {
                        NTValue::StringArray(arr.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect())
                    } else { return; }
                },
                _ => return,
            };
            topic.data.push_back((timestamp, nt_val));

            // Poda por ventana de retención: como los timestamps llegan en
            // orden creciente por topic, basta con ir sacando del frente.
            if self.retention_us > 0 {
                let cutoff = timestamp.saturating_sub(self.retention_us);
                while matches!(topic.data.front(), Some((ts, _)) if *ts < cutoff) {
                    topic.data.pop_front();
                }
            }

            if self.end_time.is_none() || timestamp > self.end_time.unwrap() { self.end_time = Some(timestamp); }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TopicAnnounce { pub id: i32, pub name: String, pub topic_type: String }

pub struct NT4Client {
    pub is_connected: bool, pub current_ip: String, tx: Option<mpsc::Sender<Message>>, pub buffer: Arc<Mutex<NTBuffer>>,
    /// Puerto del servidor NT4 de la sesion actual (5810 normal, 6767 DS,
    /// 6810 Systemcore, o el que se haya configurado a mano).
    pub current_port: u16,
    published: HashMap<String, i32>,
    next_pubuid: i32,
    /// "sim" | "real" — recordado para que el loop de auto-reconexión sepa
    /// qué evento emitir al recuperar la conexión. Lo setean connect_sim/connect_real.
    pub connection_mode: String,
    /// Se pone en `true` cuando el usuario (o una nueva llamada a `connect`)
    /// termina la conexión a propósito, para que el lector de socket sepa
    /// que NO debe disparar auto-reconexión al ver el socket cerrado.
    manual_disconnect: Arc<AtomicBool>,
    /// Diferencia entre el reloj del servidor NT y el local, en µs, deducida
    /// del round trip del ping RTT. Viven en atómicos porque los escribe la
    /// task que lee el socket y los leen los comandos desde el runtime de
    /// Tauri. Se reemplazan por Arcs nuevos en cada `connect` (igual que
    /// `manual_disconnect`), así un lector viejo no pisa la sesión nueva.
    server_time_offset_us: Arc<AtomicI64>,
    time_offset_valid: Arc<AtomicBool>,
    network_latency_us: Arc<AtomicI64>,
}

impl NT4Client {
    pub fn new() -> Self {
        Self {
            is_connected: false, current_ip: String::new(), current_port: 5810,
            tx: None, buffer: Arc::new(Mutex::new(NTBuffer::new())),
            published: HashMap::new(), next_pubuid: 1, connection_mode: String::new(),
            manual_disconnect: Arc::new(AtomicBool::new(false)),
            server_time_offset_us: Arc::new(AtomicI64::new(0)),
            time_offset_valid: Arc::new(AtomicBool::new(false)),
            network_latency_us: Arc::new(AtomicI64::new(0)),
        }
    }

    // Firma "boxed future" (en vez de `async fn`) a propósito: `connect` y
    // `reconnect_with_backoff` se llaman mutuamente (una reconecta llamando a
    // la otra), y el compilador no puede darle un tamaño finito al tipo de
    // Future de una recursión así entre dos `async fn` normales. Devolver un
    // `Pin<Box<dyn Future>>` borra ese tipo concreto y rompe el ciclo.
    pub fn connect<'a>(
        &'a mut self,
        ip: &'a str,
        port: u16,
        app_handle: AppHandle,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
        self.disconnect().await;
        // Flag nueva y propia de esta sesión: la anterior (si el lector de
        // socket de una conexión previa sigue vivo) ya quedó marcada como
        // "manual" arriba, así que no disparará su propio auto-reconnect.
        self.manual_disconnect = Arc::new(AtomicBool::new(false));
        self.server_time_offset_us = Arc::new(AtomicI64::new(0));
        self.time_offset_valid = Arc::new(AtomicBool::new(false));
        self.network_latency_us = Arc::new(AtomicI64::new(0));
        self.current_ip = ip.to_string();
        self.current_port = port;
        let url = format!("ws://{}:{}/nt/MARS", ip, port);

        let mut request = url.into_client_request().map_err(|e| e.to_string())?;
        request.headers_mut().insert("Sec-WebSocket-Protocol", "v4.1.networktables.first.wpi.edu".parse().unwrap());

        let (ws_stream, _) = connect_async(request).await.map_err(|e| format!("Error conectando a {}: {}", ip, e))?;

        self.buffer = Arc::new(Mutex::new(NTBuffer::new()));
        {
            // connect() crea un buffer nuevo: sin esto, cada reconexión
            // descartaría la ventana de historial que el usuario eligió.
            let retention_minutes = crate::load_mars_settings().nt_retention_minutes;
            self.buffer.lock().await.set_retention_us(retention_minutes as u64 * 60 * 1_000_000);
        }
        self.published.clear();
        self.next_pubuid = 1;
        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::channel::<Message>(100);
        self.tx = Some(tx.clone());
        self.is_connected = true;

        let app_handle_clone = app_handle.clone();
        let buffer_clone = self.buffer.clone();
        let manual_flag = self.manual_disconnect.clone();
        let reconnect_ip = ip.to_string();
        let reconnect_port = port;
        let offset_slot = self.server_time_offset_us.clone();
        let offset_valid_slot = self.time_offset_valid.clone();
        let latency_slot = self.network_latency_us.clone();

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
                                        // El topic id -1 NO es un topic: es la respuesta al
                                        // ping RTT. Antes caía en insert_value, que buscaba
                                        // el id -1 en el mapa de topics, no lo encontraba y
                                        // la descartaba en silencio -- por eso el offset
                                        // servidor/cliente nunca llegaba a calcularse.
                                        if record.0 == -1 {
                                            if let Some(sent_at) = value_as_u64(&record.3) {
                                                let rx = now_epoch_us();
                                                // Se asume viaje simétrico: la mitad del round
                                                // trip es lo que tardó la respuesta desde que
                                                // el servidor la timestampeó.
                                                let latency = (rx.saturating_sub(sent_at) / 2) as i64;
                                                let server_at_rx = record.1 as i64 + latency;
                                                offset_slot.store(server_at_rx - rx as i64, Ordering::SeqCst);
                                                latency_slot.store(latency, Ordering::SeqCst);
                                                offset_valid_slot.store(true, Ordering::SeqCst);
                                            }
                                        } else {
                                            buff.insert_value(record.0, record.1, record.2, record.3);
                                        }
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
                                            } else if method == "unannounce" {
                                                // Sin esto el arbol de topics solo crece: un topic que el
                                                // robot deja de publicar, o uno que MARS retira, se queda
                                                // en pantalla hasta reiniciar la app.
                                                //
                                                // El historial en el buffer NO se toca: la timeline sigue
                                                // pudiendo mostrar lo que ese topic valia antes de irse.
                                                if let Some(name) = params.get("name").and_then(|n| n.as_str()) {
                                                    let _ = app_handle_clone.emit("nt-topic-unannounced", name.to_string());
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

            // El socket se cerró solo (no vía disconnect_nt ni una nueva
            // conexión manual) -> intentar recuperarla con backoff.
            if !manual_flag.load(Ordering::SeqCst) {
                let client_arc = app_handle_clone.state::<NT4State>().0.clone();
                {
                    let mut client = client_arc.lock().await;
                    // Solo tocar el estado si nadie más ya tomó esta sesión.
                    if Arc::ptr_eq(&client.manual_disconnect, &manual_flag) {
                        client.is_connected = false;
                        client.tx = None;
                    }
                }
                tokio::spawn(NT4Client::reconnect_with_backoff(
                    app_handle_clone.clone(), client_arc, reconnect_ip, reconnect_port, manual_flag,
                ));
            }
        });

        self.send_initial_rtt().await?;

        // Ping RTT periódico. Con uno solo al conectar el offset queda clavado
        // para toda la sesión y se va desfasando con el reloj del robot.
        let rtt_tx = tx.clone();
        let rtt_manual = self.manual_disconnect.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(RTT_PERIOD);
            ticker.tick().await; // el primer tick es inmediato y ya mandamos uno arriba
            loop {
                ticker.tick().await;
                if rtt_manual.load(Ordering::SeqCst) { return; }
                let payload: RttTuple = (-1, 0, 2, now_epoch_us());
                match rmp_serde::to_vec(&payload) {
                    Ok(bin) => { if rtt_tx.send(Message::Binary(bin.into())).await.is_err() { return; } }
                    Err(_) => return,
                }
            }
        });

        if let Some(tx_channel) = &self.tx {
            let sub_msg = serde_json::json!([{"method": "subscribe", "params": {"topics": [""], "subuid": 1, "options": { "all": true, "prefix": true, "periodic": 0.05 }}}]);
            let _ = tx_channel.send(Message::Text(sub_msg.to_string().into())).await;
        }
        Ok(())
        })
    }

        pub async fn set_value(&mut self, topic_name: &str, topic_type: &str, type_idx: i32, value: rmpv::Value) -> Result<(), String> {
        let tx = self.tx.as_ref().ok_or("No hay conexión activa")?.clone();

        let pubuid = if let Some(&id) = self.published.get(topic_name) {
            id
        } else {
            let id = self.next_pubuid;
            self.next_pubuid += 1;
            self.published.insert(topic_name.to_string(), id);

            let pub_msg = serde_json::json!([{
                "method": "publish",
                "params": { "name": topic_name, "pubuid": id, "type": topic_type }
            }]);
            tx.send(Message::Text(pub_msg.to_string().into())).await.map_err(|e| e.to_string())?;
            id
        };

        // NT4 timestampea en la escala del SERVIDOR, no en epoch Unix. Mandar
        // epoch acá metía un valor ~5 órdenes de magnitud más grande que el
        // resto del buffer, y como `insert_value` mueve `end_time` al máximo
        // visto, la timeline global saltaba a 1970+epoch apenas se escribía un
        // topic. 0 es lo que la spec pide mientras el cliente no sincronizó:
        // el servidor lo reemplaza por su propia hora.
        let server_time = self.server_time_us();
        let timestamp = server_time.unwrap_or(0);

        let frame: (i32, u64, i32, rmpv::Value) = (pubuid, timestamp, type_idx, value.clone());
        let bin = rmp_serde::to_vec(&frame).map_err(|e| e.to_string())?;
        tx.send(Message::Binary(bin.into())).await.map_err(|e| e.to_string())?;

        // Eco local para feedback inmediato, solo si el timestamp es de verdad
        // comparable con el resto del buffer. Sin offset todavía, el valor
        // igual vuelve por la suscripción con la hora real del servidor.
        if let Some(ts) = server_time {
            let mut buff = self.buffer.lock().await;
            if let Some(&topic_id) = buff.topics.iter().find(|(_, h)| h.name == topic_name).map(|(id, _)| id) {
                buff.insert_value(topic_id, ts, type_idx, value);
            }
        }

        Ok(())
    }

    /// Retira un topic que este cliente habia publicado.
    ///
    /// Hace falta de verdad: un topic publicado sobrevive en el servidor hasta
    /// que su publicador se va, asi que renombrar un valor sin retirar el
    /// anterior deja basura en la red hasta reiniciar la app. Tambien es
    /// obligatorio antes de republicar el mismo nombre con OTRO tipo, que NT no
    /// permite.
    pub async fn unpublish(&mut self, topic_name: &str) -> Result<(), String> {
        let Some(pubuid) = self.published.remove(topic_name) else { return Ok(()) };
        let tx = self.tx.as_ref().ok_or("No hay conexión activa")?.clone();

        let msg = serde_json::json!([{
            "method": "unpublish",
            "params": { "pubuid": pubuid }
        }]);
        tx.send(Message::Text(msg.to_string().into())).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn disconnect(&mut self) {
        // Marca la sesión actual como terminada a propósito: si su lector de
        // socket todavía está vivo, al ver el cierre no debe auto-reconectar.
        self.manual_disconnect.store(true, Ordering::SeqCst);
        if self.is_connected {
            self.tx = None;
            self.is_connected = false;
            self.current_ip.clear();
        }
    }

    /// Reintenta `connect()` con backoff exponencial (1s -> 2s -> 4s ... tope 15s)
    /// hasta que se logre reconectar o `manual_flag` indique que la sesión fue
    /// abandonada (por un `disconnect_nt` explícito o por una nueva conexión
    /// manual que ya la reemplazó).
    async fn reconnect_with_backoff(
        app_handle: AppHandle,
        client_arc: Arc<Mutex<NT4Client>>,
        ip: String,
        port: u16,
        manual_flag: Arc<AtomicBool>,
    ) {
        let mut backoff = RECONNECT_MIN_BACKOFF;
        loop {
            if manual_flag.load(Ordering::SeqCst) { return; }
            tokio::time::sleep(backoff).await;
            if manual_flag.load(Ordering::SeqCst) { return; }

            let mut client = client_arc.lock().await;
            // Si otra sesión ya tomó el lugar de esta (reconexión manual
            // mientras esperábamos), abortamos: ese connect() ya tiene su
            // propio lector de socket corriendo.
            if !Arc::ptr_eq(&client.manual_disconnect, &manual_flag) { return; }

            match client.connect(&ip, port, app_handle.clone()).await {
                Ok(_) => {
                    let _ = app_handle.emit("nt-reconnected", client.connection_mode.clone());
                    return;
                }
                Err(_) => {
                    drop(client);
                    backoff = std::cmp::min(backoff * 2, RECONNECT_MAX_BACKOFF);
                }
            }
        }
    }

    /// Hora del servidor NT en µs, o `None` si todavía no volvió ningún ping
    /// RTT. Es la única escala válida para timestampear samples propios.
    pub fn server_time_us(&self) -> Option<u64> {
        if !self.time_offset_valid.load(Ordering::SeqCst) { return None; }
        let t = now_epoch_us() as i64 + self.server_time_offset_us.load(Ordering::SeqCst);
        if t < 0 { None } else { Some(t as u64) }
    }

    /// Mitad del round trip medido contra el servidor, en µs (0 si no hay dato).
    pub fn network_latency_us(&self) -> i64 {
        self.network_latency_us.load(Ordering::SeqCst)
    }

    async fn send_initial_rtt(&self) -> Result<(), String> {
        if let Some(tx) = &self.tx {
            let timestamp = now_epoch_us();
            let rtt_payload: RttTuple = (-1, 0, 2, timestamp);
            if let Ok(bin_data) = rmp_serde::to_vec(&rtt_payload) {
                tx.send(Message::Binary(bin_data.into())).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

pub struct NT4State(pub Arc<Mutex<NT4Client>>);