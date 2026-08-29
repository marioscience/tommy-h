pub mod http_server;
pub mod l4_inspector;
pub mod tls_quic;

use crate::config::ProxyConfig;
use crate::egress::{forward_tcp, forward_udp};
use crate::pipeline::http_server::serve_http_connection;
use crate::pipeline::l4_inspector::parse_game_packet;
use crate::pipeline::tls_quic::{QuicTerminator, TlsRuntime};
use bytes::{Bytes, BytesMut};
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpStream, UdpSocket};

fn tls_client_hello_sni(buffer: &[u8]) -> Option<String> {
    if buffer.len() < 9 || buffer[0] != 0x16 || buffer[5] != 0x01 {
        return None;
    }
    let mut cursor = 9usize;
    cursor = cursor.checked_add(2 + 32)?;
    let session_len = *buffer.get(cursor)? as usize;
    cursor = cursor.checked_add(1 + session_len)?;
    let cipher_len = u16::from_be_bytes([*buffer.get(cursor)?, *buffer.get(cursor + 1)?]) as usize;
    cursor = cursor.checked_add(2 + cipher_len)?;
    let compression_len = *buffer.get(cursor)? as usize;
    cursor = cursor.checked_add(1 + compression_len)?;
    let extensions_len = u16::from_be_bytes([*buffer.get(cursor)?, *buffer.get(cursor + 1)?]) as usize;
    cursor += 2;
    let extensions_end = cursor.checked_add(extensions_len)?.min(buffer.len());

    while cursor.checked_add(4)? <= extensions_end {
        let extension_type = u16::from_be_bytes([buffer[cursor], buffer[cursor + 1]]);
        let extension_len = u16::from_be_bytes([buffer[cursor + 2], buffer[cursor + 3]]) as usize;
        cursor += 4;
        let extension_end = cursor.checked_add(extension_len)?;
        if extension_end > extensions_end {
            return None;
        }
        if extension_type == 0 {
            let mut name_cursor = cursor.checked_add(2)?;
            while name_cursor.checked_add(3)? <= extension_end {
                let name_type = buffer[name_cursor];
                let name_len = u16::from_be_bytes([
                    buffer[name_cursor + 1],
                    buffer[name_cursor + 2],
                ]) as usize;
                name_cursor += 3;
                let name_end = name_cursor.checked_add(name_len)?;
                if name_end > extension_end {
                    return None;
                }
                if name_type == 0 {
                    return std::str::from_utf8(&buffer[name_cursor..name_end])
                        .ok()
                        .map(|name| name.trim_end_matches('.').to_ascii_lowercase());
                }
                name_cursor = name_end;
            }
            return None;
        }
        cursor = extension_end;
    }
    None
}

fn staging_tls_passthrough(buffer: &[u8]) -> Option<String> {
    if std::env::var("STAGING_MODE")
        .is_ok_and(|value| value.trim().eq_ignore_ascii_case("true"))
    {
        return None;
    }
    let upstream = std::env::var("STAGING_TLS_UPSTREAM").ok()?;
    let upstream = upstream.trim();
    upstream.parse::<SocketAddr>().ok()?;
    let requested_sni = tls_client_hello_sni(buffer)?;
    let domains = std::env::var("STAGING_TLS_DOMAINS")
        .or_else(|_| std::env::var("STAGING_DOMAINS"))
        .unwrap_or_else(|_| "ragenodes.dev".to_string());
    let matches_staging = domains.split(',').any(|domain| {
        let domain = domain.trim().trim_start_matches("*.").trim_end_matches('.').to_ascii_lowercase();
        !domain.is_empty()
            && (requested_sni == domain || requested_sni.ends_with(&format!(".{domain}")))
    });
    matches_staging.then(|| upstream.to_string())
}

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
    tls_runtime: Arc<TlsRuntime>,
) {
    let peer_addr = stream
        .peer_addr()
        .unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap());

    // Los listeners dedicados de juegos son L4 transparentes. Esta decisión debe
    // ocurrir antes de cualquier inspección TLS para no transformar TCP nativo.
    if let Some(backend_addr) = specific_backend {
        tracing::debug!(
            "Enrutando flujo TCP en crudo (Transparent Proxy) hacia backend especifico: {}",
            backend_addr
        );
        forward_tcp(stream, buffer, &backend_addr).await;
        return;
    }

    if !buffer.is_empty() && buffer[0] == 0x16 {
        if let Some(staging_upstream) = staging_tls_passthrough(&buffer) {
            tracing::info!(
                "Reenviando TLS de staging por SNI hacia {} sin terminarlo en producción",
                staging_upstream
            );
            forward_tcp(stream, buffer, &staging_upstream).await;
            return;
        }
        tracing::debug!(
            "Flujo TCP identificado como TLS ClientHello. Evaluando terminacion TLS..."
        );
        let rewind_stream = RewindStream {
            stream,
            buffer: Some(buffer.freeze()),
        };
        match tls_runtime.accept(rewind_stream).await {
            Ok(Some(tls_stream)) => {
                tracing::debug!("Handshake TLS exitoso. Sirviendo conexion web L7 segura...");
                let tls_rewind = RewindStream {
                    stream: tls_stream,
                    buffer: None,
                };
                serve_http_connection(tls_rewind, config, peer_addr, ban_tx.clone(), true).await;
            }
            Ok(None) => {
                tracing::debug!("Validación ACME TLS-ALPN-01 atendida correctamente");
            }
            Err(e) => {
                let message = e.to_string();
                if message.contains("SNI no autorizado")
                    || message.contains("peer is incompatible")
                    || message.contains("Connection reset by peer")
                {
                    tracing::debug!("Handshake TLS externo rechazado: {}", message);
                } else {
                    tracing::warn!("Fallo en handshake TLS: {}", message);
                }
            }
        }
        return;
    }

    // Solo el ingress compartido no-TLS interpreta la cabecera propietaria.
    // Un ClientHello comienza por 0x16; analizarlo antes producía el GameID
    // ficticio 0x1603 (5635) en la telemetría.
    if let Ok((_remaining, packet)) = parse_game_packet(&buffer) {
        if let Some(backend_addr) = config.routing.game_servers_map.get(&packet.game_id) {
            tracing::info!(
                "Paquete Gaming TCP reconocido. GameID: {}, Payload Len: {}",
                packet.game_id,
                packet.payload_len
            );
            tracing::debug!(
                "Enrutando flujo de juego TCP directamente a backend: {}",
                backend_addr
            );
            forward_tcp(stream, buffer, backend_addr).await;
            return;
        }
    }

    if !is_http_ingress {
        tracing::debug!("Flujo TCP sin cabecera Oxide. Evaluando enrutamiento de juegos en crudo (FiveM/Comercial)...");
        for route in &config.routing.game_servers {
            if route.game_id == 30120
                || route.description.to_lowercase().contains("fivem")
                || route.game_id == 25565
            {
                if let Some(addr) = config.routing.game_servers_map.get(&route.game_id) {
                    tracing::debug!(
                        "Enrutando flujo TCP en crudo (Transparent Proxy) hacia backend: {}",
                        addr
                    );
                    forward_tcp(stream, buffer, addr).await;
                    return;
                }
            }
        }
    }

    tracing::debug!("Flujo TCP identificado como HTTP en crudo. Sirviendo conexion web L7...");
    let rewind_stream = RewindStream {
        stream,
        buffer: Some(buffer.freeze()),
    };
    serve_http_connection(rewind_stream, config, peer_addr, ban_tx, false).await;
}

#[cfg(test)]
mod tests {
    use super::{staging_tls_passthrough, tls_client_hello_sni};

    fn client_hello_for(host: &str) -> Vec<u8> {
        let name = host.as_bytes();
        let server_name_len = 1 + 2 + name.len();
        let extension_len = 2 + server_name_len;
        let extensions_len = 4 + extension_len;
        let handshake_len = 2 + 32 + 1 + 2 + 2 + 1 + 1 + 2 + extensions_len;
        let record_len = 4 + handshake_len;
        let mut hello = vec![0x16, 0x03, 0x03, (record_len >> 8) as u8, record_len as u8];
        hello.extend([0x01, 0, 0, handshake_len as u8, 0x03, 0x03]);
        hello.extend([0u8; 32]);
        hello.extend([0, 0, 2, 0x13, 0x01, 1, 0, 0, extensions_len as u8]);
        hello.extend([0, 0, 0, extension_len as u8, 0, server_name_len as u8, 0, 0, name.len() as u8]);
        hello.extend(name);
        hello
    }

    #[test]
    fn extracts_sni_from_a_tls_client_hello() {
        assert_eq!(
            tls_client_hello_sni(&client_hello_for("tx41120.ragenodes.dev")),
            Some("tx41120.ragenodes.dev".to_string())
        );
    }

    #[test]
    fn passthrough_matches_dynamic_staging_subdomains_only() {
        std::env::set_var("STAGING_MODE", "false");
        std::env::set_var("STAGING_TLS_UPSTREAM", "192.168.1.106:443");
        std::env::set_var("STAGING_TLS_DOMAINS", "ragenodes.dev");
        assert_eq!(
            staging_tls_passthrough(&client_hello_for("tx41120.ragenodes.dev")),
            Some("192.168.1.106:443".to_string())
        );
        assert_eq!(
            staging_tls_passthrough(&client_hello_for("tx40120.ragenodes.app")),
            None
        );
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
            tracing::debug!(
                "Enrutando datagrama UDP directamente a backend: {}",
                backend_addr
            );
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
                tracing::debug!(
                    "Enrutando datagrama UDP en crudo (Transparent Proxy) hacia backend: {}",
                    addr
                );
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
        forward_udp(
            socket,
            payload,
            peer_addr,
            &config.routing.default_web_backend,
        )
        .await;
        return;
    }

    // Un paquete desconocido es ruido de Internet normal. Mantenerlo en debug
    // evita amplificación de I/O y disco durante escaneos o ataques UDP.
    tracing::debug!("Datagrama UDP de {} no coincide con ningun GameID conocido o en crudo ni QUIC. Descartando.", peer_addr);
}
