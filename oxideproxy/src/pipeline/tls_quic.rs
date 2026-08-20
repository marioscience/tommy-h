use rustc_hash::FxHashMap;
use rustls::crypto::ring::sign::any_supported_type;
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::ServerConfig;
use std::path::Path;
use std::sync::Arc;
use tokio_rustls::{server::TlsStream, TlsAcceptor};

#[derive(Debug)]
pub struct DynamicCertResolver {
    default_cert: Arc<rustls::sign::CertifiedKey>,
    // Mapa futuro para almacenar certificados por SNI (ej. "cliente1.ragenodes.com" -> cert)
    sni_map: FxHashMap<String, Arc<rustls::sign::CertifiedKey>>,
}

impl ResolvesServerCert for DynamicCertResolver {
    fn resolve(&self, client_hello: ClientHello<'_>) -> Option<Arc<rustls::sign::CertifiedKey>> {
        if let Some(sni) = client_hello.server_name() {
            if let Some(cert) = self.sni_map.get(sni) {
                tracing::debug!("Certificado SNI resuelto dinámicamente para: {}", sni);
                return Some(Arc::clone(cert));
            }
            tracing::debug!(
                "SNI no encontrado en mapa ({}). Usando certificado por defecto.",
                sni
            );
        }
        Some(Arc::clone(&self.default_cert))
    }
}

pub struct TlsTerminator {
    acceptor: TlsAcceptor,
}

impl TlsTerminator {
    pub fn new(
        cert_path: &Path,
        key_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if !cert_path.exists() || !key_path.exists() {
            tracing::info!("Certificados TLS no encontrados. Generando certificados autofirmados automáticos...");
            if let Some(parent) = cert_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let subject_alt_names = vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "0.0.0.0".to_string(),
                "ragenodes.com".to_string(),
                "*.ragenodes.com".to_string(),
            ];
            let rcgen::CertifiedKey { cert, signing_key } =
                rcgen::generate_simple_self_signed(subject_alt_names)?;
            let _ = std::fs::write(cert_path, cert.pem().as_bytes());
            let _ = std::fs::write(key_path, signing_key.serialize_pem().as_bytes());
        }

        let cert_chain =
            CertificateDer::pem_file_iter(cert_path)?.collect::<Result<Vec<_>, _>>()?;
        if cert_chain.is_empty() {
            return Err("No se encontró un certificado PEM válido".into());
        }

        let key = PrivateKeyDer::from_pem_file(key_path)?;

        let signing_key = any_supported_type(&key)
            .map_err(|_| "Tipo de llave privada no soportada por rustls")?;
        let certified_key = rustls::sign::CertifiedKey::new(cert_chain, signing_key);

        let resolver = Arc::new(DynamicCertResolver {
            default_cert: Arc::new(certified_key),
            sni_map: FxHashMap::default(), // Preparado para llenarse dinámicamente en el futuro
        });

        let mut config = ServerConfig::builder()
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
