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

struct MeteredStream<S> {
    inner: S,
    metrics: crate::metrics::TcpReadCounters,
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
                self.metrics.record(bytes);
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
                metrics: crate::metrics::TcpReadCounters::new(true),
            };
            let mut metered_backend = MeteredStream {
                inner: backend_stream,
                metrics: crate::metrics::TcpReadCounters::new(false),
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_stream<S>(
        inner: S,
    ) -> (
        super::MeteredStream<S>,
        &'static AtomicU64,
        &'static AtomicU64,
    ) {
        // Each test owns isolated counters, including when the suite runs in parallel.
        let reads = Box::leak(Box::new(AtomicU64::new(0)));
        let bytes = Box::leak(Box::new(AtomicU64::new(0)));
        (
            super::MeteredStream {
                inner,
                metrics: crate::metrics::TcpReadCounters::with_test_counters(reads, bytes),
            },
            reads,
            bytes,
        )
    }

    #[tokio::test]
    async fn tcp_reverse_backpressure_and_cancellation_keep_exact_counters() {
        use std::future::Future;
        let (mut client_side, _client) = tokio::io::duplex(1);
        let (mut backend, backend_side) = tokio::io::duplex(16384);
        client_side.write_all(&[0]).await.unwrap();
        backend.write_all(&[9; 8192]).await.unwrap();
        let (mut source, in_reads, in_bytes) = test_stream(client_side);
        let (mut destination, out_reads, out_bytes) = test_stream(backend_side);
        let mut relay = Box::pin(tokio::io::copy_bidirectional(&mut source, &mut destination));
        let waker = futures_util::task::noop_waker();
        let mut cx = std::task::Context::from_waker(&waker);
        assert!(relay.as_mut().poll(&mut cx).is_pending());
        assert_eq!(out_bytes.load(Ordering::Relaxed), 8192);
        assert_eq!(out_reads.load(Ordering::Relaxed), 1);
        assert_eq!(in_bytes.load(Ordering::Relaxed), 0);
        assert_eq!(in_reads.load(Ordering::Relaxed), 0);
        drop(relay); // Cancellation must not lose or publish the same read twice.
        drop(source);
        drop(destination);
        assert_eq!(out_bytes.load(Ordering::Relaxed), 8192);
        assert_eq!(out_reads.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn tcp_bulk_half_close_preserves_payloads_and_allows_a_response() {
        let (mut client, client_side) = tokio::io::duplex(1024);
        let (mut backend, backend_side) = tokio::io::duplex(1024);
        let (mut source, _, in_bytes) = test_stream(client_side);
        let (mut destination, _, out_bytes) = test_stream(backend_side);
        // Spawning also verifies the relay remains Send, as required in production.
        let relay = tokio::spawn(async move {
            tokio::io::copy_bidirectional(&mut source, &mut destination).await
        });
        let exchange = async {
            let client_exchange = async {
                client.write_all(&vec![3; 300_000]).await.unwrap();
                client.shutdown().await.unwrap();
                let mut reply = Vec::new();
                client.read_to_end(&mut reply).await.unwrap();
                assert_eq!(reply, vec![5; 90_000]);
            };
            let backend_exchange = async {
                let mut request = Vec::new();
                backend.read_to_end(&mut request).await.unwrap();
                assert_eq!(request, vec![3; 300_000]);
                backend.write_all(&vec![5; 90_000]).await.unwrap();
                backend.shutdown().await.unwrap();
            };
            tokio::join!(client_exchange, backend_exchange);
            assert_eq!(relay.await.unwrap().unwrap(), (300_000, 90_000));
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), exchange)
            .await
            .unwrap();
        assert_eq!(in_bytes.load(Ordering::Relaxed), 300_000);
        assert_eq!(out_bytes.load(Ordering::Relaxed), 90_000);
    }

    #[tokio::test]
    async fn tcp_backend_write_failure_keeps_already_read_bytes() {
        let (mut client, client_side) = tokio::io::duplex(16384);
        let (backend, backend_side) = tokio::io::duplex(1);
        client.write_all(&[6; 8192]).await.unwrap();
        drop(backend);
        let (mut source, reads, bytes) = test_stream(client_side);
        let (mut destination, _, _) = test_stream(backend_side);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::io::copy_bidirectional(&mut source, &mut destination),
        )
        .await
        .unwrap();
        assert!(result.is_err());
        assert_eq!(bytes.load(Ordering::Relaxed), 8192);
        assert_eq!(reads.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn tcp_idle_and_eof_do_not_count_as_reads() {
        use std::future::Future;
        let (client, client_side) = tokio::io::duplex(1);
        let (mut stream, reads, bytes) = test_stream(client_side);
        let mut buf = [0; 1];
        let mut read = Box::pin(stream.read(&mut buf));
        let waker = futures_util::task::noop_waker();
        let mut cx = std::task::Context::from_waker(&waker);
        assert!(read.as_mut().poll(&mut cx).is_pending());
        drop(read);
        assert_eq!(reads.load(Ordering::Relaxed), 0);
        drop(client);
        assert_eq!(stream.read(&mut buf).await.unwrap(), 0);
        assert_eq!(reads.load(Ordering::Relaxed), 0);
        assert_eq!(bytes.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn tcp_loopback_forwarding_preserves_initial_buffer_and_half_close() {
        let origin = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ingress = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin_addr = origin.local_addr().unwrap().to_string();
        let ingress_addr = ingress.local_addr().unwrap();
        let scenario = async {
            let relay = async {
                let (stream, _) = ingress.accept().await.unwrap();
                super::forward_tcp(stream, bytes::BytesMut::from(&b"prefix:"[..]), &origin_addr)
                    .await;
            };
            let backend = async {
                let (mut stream, _) = origin.accept().await.unwrap();
                let mut request = Vec::new();
                stream.read_to_end(&mut request).await.unwrap();
                let mut expected = b"prefix:".to_vec();
                expected.extend_from_slice(&vec![42; 65536]);
                assert_eq!(request, expected);
                stream
                    .write_all(b"response-after-client-half-close")
                    .await
                    .unwrap();
                stream.shutdown().await.unwrap();
            };
            let client = async {
                let mut stream = tokio::net::TcpStream::connect(ingress_addr).await.unwrap();
                stream.write_all(&vec![42; 65536]).await.unwrap();
                stream.shutdown().await.unwrap();
                let mut response = Vec::new();
                stream.read_to_end(&mut response).await.unwrap();
                assert_eq!(response, b"response-after-client-half-close");
            };
            tokio::join!(relay, backend, client);
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), scenario)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn tcp_metrics_are_visible_while_the_destination_is_blocked() {
        use super::MeteredStream;
        use crate::metrics::TcpReadCounters;
        use std::future::Future;
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::task::{Context, Poll};
        use tokio::io::AsyncWriteExt;

        static READS: AtomicU64 = AtomicU64::new(0);
        static BYTES: AtomicU64 = AtomicU64::new(0);
        let (mut client, source) = tokio::io::duplex(16384);
        let (mut destination, _backend) = tokio::io::duplex(1);
        // Fill the destination and the relay's entire 8 KiB input buffer.
        destination.write_all(&[0]).await.unwrap();
        client.write_all(&[7; 8192]).await.unwrap();
        let mut source = MeteredStream {
            inner: source,
            metrics: TcpReadCounters::with_test_counters(&READS, &BYTES),
        };
        let mut destination = MeteredStream {
            inner: destination,
            metrics: TcpReadCounters::new(false),
        };
        let mut relay = Box::pin(tokio::io::copy_bidirectional(&mut source, &mut destination));
        let waker = futures_util::task::noop_waker();
        let mut cx = Context::from_waker(&waker);
        assert!(matches!(relay.as_mut().poll(&mut cx), Poll::Pending));
        // No further polling is guaranteed until the destination becomes writable.
        assert_eq!(BYTES.load(Ordering::Relaxed), 8192);
        assert_eq!(READS.load(Ordering::Relaxed), 1);
    }

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
