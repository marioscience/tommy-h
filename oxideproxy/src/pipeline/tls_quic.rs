use rustls::{Certificate, PrivateKey, ServerConfig};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::any_supported_type;
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_rustls::{server::TlsStream, TlsAcceptor};
use rustc_hash::FxHashMap;

pub struct DynamicCertResolver {
    default_cert: Arc<rustls::sign::CertifiedKey>,
    // Mapa futuro para almacenar certificados por SNI (ej. "cliente1.ragenodes.com" -> cert)
    sni_map: FxHashMap<String, Arc<rustls::sign::CertifiedKey>>,
}

impl ResolvesServerCert for DynamicCertResolver {
    fn resolve(&self, client_hello: ClientHello) -> Option<Arc<rustls::sign::CertifiedKey>> {
        if let Some(sni) = client_hello.server_name() {
            if let Some(cert) = self.sni_map.get(sni) {
                tracing::debug!("Certificado SNI resuelto dinámicamente para: {}", sni);
                return Some(Arc::clone(cert));
            }
            tracing::debug!("SNI no encontrado en mapa ({}). Usando certificado por defecto.", sni);
        }
        Some(Arc::clone(&self.default_cert))
    }
}

pub struct TlsTerminator {
    acceptor: TlsAcceptor,
}

impl TlsTerminator {
    pub fn new(cert_path: &Path, key_path: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let cert_file = File::open(cert_path)?;
        let mut cert_reader = BufReader::new(cert_file);
        let cert_chain = certs(&mut cert_reader)?
            .into_iter()
            .map(Certificate)
            .collect();

        let key_file = File::open(key_path)?;
        let mut key_reader = BufReader::new(key_file);
        let mut keys = pkcs8_private_keys(&mut key_reader)?;
        if keys.is_empty() {
            return Err("No se encontró una llave privada PKCS8 válida".into());
        }
        let key = PrivateKey(keys.remove(0));

        let signing_key = any_supported_type(&key).map_err(|_| "Tipo de llave privada no soportada por rustls")?;
        let certified_key = rustls::sign::CertifiedKey::new(cert_chain, signing_key);

        let resolver = Arc::new(DynamicCertResolver {
            default_cert: Arc::new(certified_key),
            sni_map: FxHashMap::default(), // Preparado para llenarse dinámicamente en el futuro
        });

        let mut config = ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_cert_resolver(resolver);
            
        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        Ok(Self {
            acceptor: TlsAcceptor::from(Arc::new(config)),
        })
    }

    pub async fn accept<IO>(&self, stream: IO) -> Result<TlsStream<IO>, std::io::Error>
    where
        IO: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        self.acceptor.accept(stream).await
    }
}

pub struct QuicTerminator;

impl QuicTerminator {
    /// Analiza la cabecera QUIC en Zero-Copy O(1)
    /// Devuelve Option<(version_u32, dcid_len_u8)> si es un datagrama QUIC válido
    pub fn parse_quic_header(payload: &[u8]) -> Option<(u32, u8)> {
        if payload.is_empty() {
            return None;
        }

        let first_byte = payload[0];
        // Verificar bit de cabecera QUIC (Bit 0x80 para Long Header, 0x40 fijo en QUICv1)
        if (first_byte & 0xc0) == 0xc0 {
            // Long Header (Initial / Handshake / 0-RTT)
            if payload.len() < 6 {
                return None;
            }

            let version = u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]);
            let dcid_len = payload[5];

            if payload.len() < (6 + dcid_len as usize) {
                return None;
            }

            Some((version, dcid_len))
        } else if (first_byte & 0x40) == 0x40 {
            // Short Header (1-RTT)
            Some((0, 0))
        } else {
            None
        }
    }
}
