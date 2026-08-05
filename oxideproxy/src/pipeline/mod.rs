pub mod http_server;
pub mod l4_inspector;
pub mod tls_quic;

use crate::config::ProxyConfig;
use crate::egress::{forward_tcp, forward_udp};
use crate::pipeline::http_server::serve_http_connection;
use crate::pipeline::l4_inspector::parse_game_packet;
use crate::pipeline::tls_quic::{QuicTerminator, TlsTerminator};
use bytes::{Bytes, BytesMut};
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpStream, UdpSocket};

pub struct RewindStream<S> {
    pub stream: S,
    pub buffer: Option<Bytes>,
}

impl<S: AsyncRead + Unpin> AsyncRead for RewindStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if let Some(ref mut prefix) = self.buffer {
            if !prefix.is_empty() {
                let len = std::cmp::min(buf.remaining(), prefix.len());
                buf.put_slice(&prefix[..len]);
                let _ = prefix.split_to(len);
                if prefix.is_empty() {
                    self.buffer = None;
                }
                return Poll::Ready(Ok(()));
            } else {
                self.buffer = None;
            }
        }
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for RewindStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

pub async fn process_tcp_stream(
    stream: TcpStream,
    buffer: BytesMut,
    config: Arc<ProxyConfig>,
    specific_backend: Option<String>,
    is_http_ingress: bool,
    ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>,
) {
    let peer_addr = stream.peer_addr().unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap());

    if let Ok((_remaining, packet)) = parse_game_packet(&buffer) {
        tracing::info!(
            "Paquete Gaming TCP detectado en Ingress. GameID: {}, Payload Len: {}",
            packet.game_id,
            packet.payload_len
        );

        if let Some(backend_addr) = config.routing.game_servers_map.get(&packet.game_id) {
            tracing::debug!("Enrutando flujo de juego TCP directamente a backend: {}", backend_addr);
            forward_tcp(stream, buffer, backend_addr).await;
            return;
        }
    }

    if let Some(backend_addr) = specific_backend {
        tracing::debug!(
            "Enrutando flujo TCP en crudo (Transparent Proxy) hacia backend especifico: {}",
            backend_addr
        );
        forward_tcp(stream, buffer, &backend_addr).await;
        return;
    }

    if !is_http_ingress {
        tracing::debug!("Flujo TCP sin cabecera Oxide. Evaluando enrutamiento de juegos en crudo (FiveM/Comercial)...");
        for route in &config.routing.game_servers {
            if route.game_id == 30120 || route.description.to_lowercase().contains("fivem") || route.game_id == 25565 {
                if let Some(addr) = config.routing.game_servers_map.get(&route.game_id) {
                    tracing::debug!("Enrutando flujo TCP en crudo (Transparent Proxy) hacia backend: {}", addr);
                    forward_tcp(stream, buffer, addr).await;
                    return;
                }
            }
        }
    }

    if !buffer.is_empty() && buffer[0] == 0x16 {
        tracing::debug!("Flujo TCP identificado como TLS ClientHello. Evaluando terminacion TLS...");
        match TlsTerminator::new(&config.tls.cert_path, &config.tls.key_path) {
            Ok(terminator) => {
                let rewind_stream = RewindStream {
                    stream,
                    buffer: Some(buffer.freeze()),
                };
                match terminator.accept(rewind_stream).await {
                    Ok(tls_stream) => {
                        tracing::debug!("Handshake TLS exitoso. Sirviendo conexion web L7 segura...");
                        let tls_rewind = RewindStream {
                            stream: tls_stream,
                            buffer: None,
                        };
                        serve_http_connection(tls_rewind, config, peer_addr, ban_tx.clone()).await;
                    }
                    Err(e) => tracing::error!("Fallo en handshake TLS: {}", e),
                }
            }
            Err(e) => {
                tracing::error!("Error inicializando terminador TLS: {}. Reenviando al servidor HTTP L7 en crudo...", e);
                drop(e);
                let rewind_stream = RewindStream {
                    stream,
                    buffer: Some(buffer.freeze()),
                };
                serve_http_connection(rewind_stream, config, peer_addr, ban_tx.clone()).await;
            }
        }
    } else {
        tracing::debug!("Flujo TCP identificado como HTTP en crudo. Sirviendo conexion web L7...");
        let rewind_stream = RewindStream {
            stream,
            buffer: Some(buffer.freeze()),
        };
        serve_http_connection(rewind_stream, config, peer_addr, ban_tx).await;
    }
}

pub async fn process_udp_packet_inline(
    socket: Arc<UdpSocket>,
    payload: Bytes,
    peer_addr: SocketAddr,
    config: Arc<ProxyConfig>,
    specific_backend: Option<String>,
) {
    if let Ok((_remaining, packet)) = parse_game_packet(&payload) {
        tracing::info!(
            "Datagrama Gaming UDP detectado. GameID: {}, Payload Len: {}",
            packet.game_id,
            packet.payload_len
        );

        if let Some(backend_addr) = config.routing.game_servers_map.get(&packet.game_id) {
            tracing::debug!("Enrutando datagrama UDP directamente a backend: {}", backend_addr);
            forward_udp(socket, payload, peer_addr, backend_addr).await;
            return;
        }
    }

    if let Some(backend_addr) = specific_backend {
        tracing::debug!(
            "Enrutando datagrama UDP en crudo (Transparent Proxy) hacia backend especifico: {}",
            backend_addr
        );
        forward_udp(socket, payload, peer_addr, &backend_addr).await;
        return;
    }

    tracing::debug!("Datagrama UDP sin cabecera Oxide. Evaluando enrutamiento de juegos en crudo (FiveM/Comercial)...");
    for route in &config.routing.game_servers {
        if route.game_id == 30120
            || route.description.to_lowercase().contains("fivem")
            || route.game_id == 7777
            || route.game_id == 2456
            || route.game_id == 19132
        {
            if let Some(addr) = config.routing.game_servers_map.get(&route.game_id) {
                tracing::debug!("Enrutando datagrama UDP en crudo (Transparent Proxy) hacia backend: {}", addr);
                forward_udp(socket, payload, peer_addr, addr).await;
                return;
            }
        }
    }

    if let Some((version, dcid_len)) = QuicTerminator::parse_quic_header(&payload) {
        tracing::debug!(
            "Datagrama QUIC / HTTP3 detectado (Version: {:#x}, DCID Len: {}). Enrutando al backend web por defecto...",
            version,
            dcid_len
        );
        forward_udp(socket, payload, peer_addr, &config.routing.default_web_backend).await;
        return;
    }

    tracing::warn!("Datagrama UDP de {} no coincide con ningun GameID conocido o en crudo ni QUIC. Descartando o enviando a log.", peer_addr);
}
