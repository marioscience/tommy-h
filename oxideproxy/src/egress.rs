use bytes::Bytes;
use dashmap::DashMap;
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpStream, UdpSocket};

type UdpSessionMap = DashMap<SocketAddr, (Arc<UdpSocket>, Instant), BuildHasherDefault<FxHasher>>;

fn udp_sessions() -> &'static UdpSessionMap {
    static SESSIONS: OnceLock<UdpSessionMap> = OnceLock::new();
    SESSIONS.get_or_init(|| DashMap::default())
}

fn resolve_backend(backend_addr: &str) -> std::io::Result<SocketAddr> {
    backend_addr.to_socket_addrs()?.next().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("backend sin direcciones: {}", backend_addr),
        )
    })
}

pub async fn forward_tcp<S>(mut client_stream: S, buffer: bytes::BytesMut, backend_addr: &str)
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
            match tokio::io::copy_bidirectional(&mut client_stream, &mut backend_stream).await {
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

    tracing::debug!(
        "Reenviando datagrama UDP ({} bytes) de {} a backend {} ({})",
        payload.len(),
        client_addr,
        backend_addr,
        resolved_backend
    );

    let sessions = udp_sessions();

    let ephemeral_sock = {
        if let Some(mut entry) = sessions.get_mut(&client_addr) {
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

                    let entry = sessions.entry(client_addr).or_insert_with(|| {
                    let ephemeral_clone = sock.clone();
                    let ingress_clone = ingress_socket.clone();

                    tokio::spawn(async move {
                        let mut buf = [0u8; 65536];
                        loop {
                            match tokio::time::timeout(Duration::from_secs(60), ephemeral_clone.recv_from(&mut buf)).await {
                                Ok(Ok((len, from_addr))) => {
                                    if from_addr == resolved_backend {
                                        {
                                            if let Some(mut s_entry) = udp_sessions().get_mut(&client_addr) {
                                                s_entry.value_mut().1 = Instant::now();
                                            }
                                        }
                                        let _ = ingress_clone.send_to(&buf[..len], client_addr).await;
                                    }
                                }
                                Ok(Err(_)) => break,
                                Err(_) => {
                                    let is_active = {
                                        if let Some(s_entry) = udp_sessions().get(&client_addr) {
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
                        udp_sessions().remove_if(&client_addr, |_, (_, last_active)| {
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
            backend_addr,
            resolved_backend
        ),
        Err(e) => tracing::error!(
            "Error reenviando UDP a {} ({}): {}",
            backend_addr,
            resolved_backend,
            e
        ),
    }
}
