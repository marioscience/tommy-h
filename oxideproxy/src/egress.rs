use bytes::Bytes;
use dashmap::DashMap;
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
use std::net::{SocketAddr, ToSocketAddrs};
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpStream, UdpSocket};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct UdpSessionKey {
    client: SocketAddr,
    backend: SocketAddr,
    ingress: SocketAddr,
}

impl UdpSessionKey {
    fn new(client: SocketAddr, backend: SocketAddr, ingress: SocketAddr) -> Self {
        Self {
            client,
            backend,
            ingress,
        }
    }
}

type UdpSessionMap =
    DashMap<UdpSessionKey, (Arc<UdpSocket>, Instant), BuildHasherDefault<FxHasher>>;

#[derive(Clone, Copy)]
enum TrafficDirection {
    Ingress,
    Egress,
}

struct MeteredStream<S> {
    inner: S,
    direction: TrafficDirection,
}

impl<S: AsyncRead + Unpin> AsyncRead for MeteredStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &result {
            let bytes = buf.filled().len().saturating_sub(before);
            if bytes > 0 {
                match self.direction {
                    TrafficDirection::Ingress => crate::metrics::tcp_ingress(bytes),
                    TrafficDirection::Egress => crate::metrics::tcp_egress(bytes),
                }
            }
        }
        result
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for MeteredStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

fn udp_sessions() -> &'static UdpSessionMap {
    static SESSIONS: OnceLock<UdpSessionMap> = OnceLock::new();
    SESSIONS.get_or_init(|| DashMap::default())
}

pub(crate) fn resolve_backend(backend_addr: &str) -> std::io::Result<SocketAddr> {
    backend_addr.to_socket_addrs()?.next().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("backend sin direcciones: {}", backend_addr),
        )
    })
}

pub async fn forward_tcp<S>(client_stream: S, buffer: bytes::BytesMut, backend_addr: &str)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let resolved_backend = match resolve_backend(backend_addr) {
        Ok(addr) => addr,
        Err(e) => {
            tracing::error!("Fallo al resolver backend TCP {}: {}", backend_addr, e);
            return;
        }
    };

    tracing::debug!(
        "Iniciando reenvio TCP hacia backend {} ({})",
        backend_addr,
        resolved_backend
    );
    match TcpStream::connect(resolved_backend).await {
        Ok(mut backend_stream) => {
            if !buffer.is_empty() {
                tracing::debug!(
                    "Escribiendo {} bytes iniciales del buffer al backend TCP...",
                    buffer.len()
                );
                if let Err(e) =
                    tokio::io::AsyncWriteExt::write_all(&mut backend_stream, &buffer).await
                {
                    tracing::error!(
                        "Error escribiendo buffer inicial al backend {} ({}): {}",
                        backend_addr,
                        resolved_backend,
                        e
                    );
                    return;
                }
            }
            let mut metered_client = MeteredStream {
                inner: client_stream,
                direction: TrafficDirection::Ingress,
            };
            let mut metered_backend = MeteredStream {
                inner: backend_stream,
                direction: TrafficDirection::Egress,
            };
            match tokio::io::copy_bidirectional(&mut metered_client, &mut metered_backend).await {
                Ok((from_client, from_backend)) => {
                    tracing::debug!(
                        "Sesion TCP finalizada. Bytes cliente->backend: {}, backend->cliente: {}",
                        from_client,
                        from_backend
                    );
                }
                Err(e) => tracing::error!(
                    "Error en proxy bidireccional TCP hacia {} ({}): {}",
                    backend_addr,
                    resolved_backend,
                    e
                ),
            }
        }
        Err(e) => tracing::error!(
            "Fallo al conectar con backend TCP en {} ({}): {}",
            backend_addr,
            resolved_backend,
            e
        ),
    }
}

pub async fn forward_udp(
    ingress_socket: Arc<UdpSocket>,
    payload: Bytes,
    client_addr: SocketAddr,
    backend_addr: &str,
) {
    let resolved_backend = match resolve_backend(backend_addr) {
        Ok(addr) => addr,
        Err(e) => {
            tracing::error!("Fallo al resolver backend UDP {}: {}", backend_addr, e);
            return;
        }
    };

    forward_udp_resolved(
        ingress_socket,
        payload,
        client_addr,
        resolved_backend,
        backend_addr,
    )
    .await;
}

/// Fast path for dedicated game listeners. The backend is resolved once when
/// the listener starts instead of executing DNS resolution for every packet.
pub async fn forward_udp_resolved(
    ingress_socket: Arc<UdpSocket>,
    payload: Bytes,
    client_addr: SocketAddr,
    resolved_backend: SocketAddr,
    backend_label: &str,
) {
    tracing::debug!(
        "Reenviando datagrama UDP ({} bytes) de {} a backend {} ({})",
        payload.len(),
        client_addr,
        backend_label,
        resolved_backend
    );

    let sessions = udp_sessions();
    let ingress_addr = match ingress_socket.local_addr() {
        Ok(addr) => addr,
        Err(e) => {
            tracing::error!(
                "No se pudo obtener el listener UDP de {}: {}",
                client_addr,
                e
            );
            return;
        }
    };
    let session_key = UdpSessionKey::new(client_addr, resolved_backend, ingress_addr);

    let ephemeral_sock = {
        if let Some(mut entry) = sessions.get_mut(&session_key) {
            let (ref sock, ref mut last_active) = *entry;
            *last_active = Instant::now();
            Some(sock.clone())
        } else {
            None
        }
    };

    let ephemeral_sock = match ephemeral_sock {
        Some(sock) => sock,
        None => {
            match UdpSocket::bind("0.0.0.0:0").await {
                Ok(sock) => {
                    let sock = Arc::new(sock);
                    let now = Instant::now();

                    let entry = sessions.entry(session_key).or_insert_with(|| {
                    let ephemeral_clone = sock.clone();
                    let ingress_clone = ingress_socket.clone();

                    tokio::spawn(async move {
                        let mut buf = [0u8; 65536];
                        loop {
                            match tokio::time::timeout(Duration::from_secs(60), ephemeral_clone.recv_from(&mut buf)).await {
                                Ok(Ok((len, from_addr))) => {
                                    if from_addr == resolved_backend {
                                        {
                                            if let Some(mut s_entry) = udp_sessions().get_mut(&session_key) {
                                                s_entry.value_mut().1 = Instant::now();
                                            }
                                        }
                                        let _ = ingress_clone.send_to(&buf[..len], client_addr).await;
                                        crate::metrics::udp_egress(len);
                                    }
                                }
                                Ok(Err(_)) => break,
                                Err(_) => {
                                    let is_active = {
                                        if let Some(s_entry) = udp_sessions().get(&session_key) {
                                            Instant::now().duration_since(s_entry.value().1) < Duration::from_secs(60)
                                        } else {
                                            false
                                        }
                                    };
                                    if !is_active {
                                        tracing::debug!("Sesion UDP inactiva por 60s para {}. Cerrando socket.", client_addr);
                                        break;
                                    }
                                }
                            }
                        }
                        udp_sessions().remove_if(&session_key, |_, (_, last_active)| {
                            Instant::now().duration_since(*last_active) >= Duration::from_secs(60)
                        });
                    });

                    (sock, now)
                });

                    let result_sock = entry.value().0.clone();
                    drop(entry);
                    result_sock
                }
                Err(e) => {
                    tracing::error!(
                        "Error vinculando socket UDP efimero para {}: {}",
                        client_addr,
                        e
                    );
                    return;
                }
            }
        }
    };

    match ephemeral_sock.send_to(&payload, resolved_backend).await {
        Ok(sent) => tracing::debug!(
            "Enviados {} bytes UDP a {} ({})",
            sent,
            backend_label,
            resolved_backend
        ),
        Err(e) => tracing::error!(
            "Error reenviando UDP a {} ({}): {}",
            backend_label,
            resolved_backend,
            e
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::UdpSessionKey;

    #[test]
    fn udp_sessions_are_isolated_by_backend_and_public_listener() {
        let client = "127.0.0.1:40000".parse().unwrap();
        let backend_a = "127.0.0.1:30120".parse().unwrap();
        let backend_b = "127.0.0.1:25565".parse().unwrap();
        let listener_a = "0.0.0.0:30120".parse().unwrap();
        let listener_b = "0.0.0.0:31120".parse().unwrap();

        let base = UdpSessionKey::new(client, backend_a, listener_a);
        assert_ne!(base, UdpSessionKey::new(client, backend_b, listener_a));
        assert_ne!(base, UdpSessionKey::new(client, backend_a, listener_b));
        assert_eq!(base, UdpSessionKey::new(client, backend_a, listener_a));
    }
}
