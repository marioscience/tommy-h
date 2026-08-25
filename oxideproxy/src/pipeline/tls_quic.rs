use futures_util::StreamExt;
use rustls::crypto::ring::sign::any_supported_type;
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;
use rustls_acme::caches::DirCache;
use rustls_acme::{is_tls_alpn_challenge, AcmeConfig};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio_rustls::{server::TlsStream, LazyConfigAcceptor};

pub struct TlsRuntime {
    default_config: Arc<ServerConfig>,
    challenge_config: Option<Arc<ServerConfig>>,
    allowed_sni: Option<HashSet<String>>,
}

impl TlsRuntime {
    pub async fn initialize(
        cert_path: &Path,
        key_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if env_flag("OXIDE_ACME_ENABLED") {
            return Self::initialize_acme().await;
        }

        let runtime_cert_path = std::env::var("OXIDE_TLS_CERT_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| cert_path.to_path_buf());
        let runtime_key_path = std::env::var("OXIDE_TLS_KEY_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| key_path.to_path_buf());

        Self::initialize_static(&runtime_cert_path, &runtime_key_path)
    }

    fn initialize_static(
        cert_path: &Path,
        key_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let cert_chain =
            CertificateDer::pem_file_iter(cert_path)?.collect::<Result<Vec<_>, _>>()?;
        if cert_chain.is_empty() {
            return Err("No se encontró un certificado PEM válido".into());
        }

        let key = PrivateKeyDer::from_pem_file(key_path)?;

        let signing_key = any_supported_type(&key)
            .map_err(|_| "Tipo de llave privada no soportada por rustls")?;
        let certified_key = rustls::sign::CertifiedKey::new(cert_chain, signing_key);

        let mut config = ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_cert_resolver(Arc::new(StaticCertResolver {
                certified_key: Arc::new(certified_key),
            }));

        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        Ok(Self {
            default_config: Arc::new(config),
            challenge_config: None,
            allowed_sni: None,
        })
    }

    async fn initialize_acme() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let domains = required_env("OXIDE_ACME_DOMAINS")?
            .split(',')
            .map(|domain| domain.trim().trim_end_matches('.').to_ascii_lowercase())
            .filter(|domain| !domain.is_empty())
            .collect::<Vec<_>>();
        if domains.is_empty() || domains.iter().any(|domain| !valid_dns_name(domain)) {
            return Err("OXIDE_ACME_DOMAINS contiene un nombre DNS no válido".into());
        }

        let email = required_env("OXIDE_ACME_EMAIL")?;
        if !email.contains('@') || email.contains(char::is_whitespace) {
            return Err("OXIDE_ACME_EMAIL no es válido".into());
        }

        let cache_dir = std::env::var("OXIDE_ACME_CACHE_DIR")
            .unwrap_or_else(|_| "/app/acme".to_string());
        std::fs::create_dir_all(&cache_dir)?;
        let production = env_flag("OXIDE_ACME_PRODUCTION");

        let mut state = AcmeConfig::new(domains.clone())
            .contact_push(format!("mailto:{email}"))
            .cache(DirCache::new(cache_dir))
            .directory_lets_encrypt(production)
            .state();

        let challenge_config = state.challenge_rustls_config();
        let mut default_config = ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_cert_resolver(state.resolver());
        default_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        tokio::spawn(async move {
            while let Some(event) = state.next().await {
                match event {
                    Ok(ok) => tracing::info!("ACME: {:?}", ok),
                    Err(err) => tracing::error!("ACME: {:?}", err),
                }
            }
            tracing::error!("ACME: el gestor de certificados terminó inesperadamente");
        });

        tracing::info!(
            "TLS ACME habilitado para {} usando el directorio de Let's Encrypt {}",
            domains.join(", "),
            if production { "producción" } else { "staging" }
        );

        Ok(Self {
            default_config: Arc::new(default_config),
            challenge_config: Some(challenge_config),
            allowed_sni: Some(domains.into_iter().collect()),
        })
    }

    pub async fn accept<IO>(
        &self,
        stream: IO,
    ) -> Result<Option<TlsStream<IO>>, Box<dyn std::error::Error + Send + Sync>>
    where
        IO: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let handshake = LazyConfigAcceptor::new(Default::default(), stream).await?;
        let is_challenge = self.challenge_config.is_some()
            && is_tls_alpn_challenge(&handshake.client_hello());

        if !is_challenge {
            if let Some(allowed_sni) = &self.allowed_sni {
                let requested_sni = handshake
                    .client_hello()
                    .server_name()
                    .map(|value| value.trim_end_matches('.').to_ascii_lowercase());
                if requested_sni
                    .as_ref()
                    .is_none_or(|domain| !allowed_sni.contains(domain))
                {
                    return Err("SNI no autorizado para este OxideProxy".into());
                }
            }
        }

        if is_challenge {
            tracing::info!("ACME: solicitud TLS-ALPN-01 recibida");
            let mut tls = handshake
                .into_stream(Arc::clone(
                    self.challenge_config
                        .as_ref()
                        .expect("challenge config comprobada"),
                ))
                .await?;
            tls.shutdown().await?;
            return Ok(None);
        }

        Ok(Some(
            handshake
                .into_stream(Arc::clone(&self.default_config))
                .await?,
        ))
    }
}

#[derive(Debug)]
struct StaticCertResolver {
    certified_key: Arc<rustls::sign::CertifiedKey>,
}

impl rustls::server::ResolvesServerCert for StaticCertResolver {
    fn resolve(
        &self,
        _client_hello: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        Some(Arc::clone(&self.certified_key))
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn required_env(name: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let value = std::env::var(name).unwrap_or_default().trim().to_string();
    if value.is_empty() {
        Err(format!("{name} es obligatorio cuando OXIDE_ACME_ENABLED=true").into())
    } else {
        Ok(value)
    }
}

fn valid_dns_name(domain: &str) -> bool {
    domain.len() <= 253
        && domain.contains('.')
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
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
