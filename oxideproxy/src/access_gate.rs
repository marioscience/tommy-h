use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use dashmap::DashMap;
use hmac::{Hmac, Mac};
use http::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, HOST, LOCATION, ORIGIN, SET_COOKIE};
use http::uri::Authority;
use http::{HeaderValue, Method, Request, Response, StatusCode};
use hyper::Body;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

const ACCESS_PATH: &str = "/__access";
const REQUEST_PATH: &str = "/__access/request";
const VERIFY_PATH: &str = "/__access/verify";
const SESSION_COOKIE: &str = "__Host-rn_staging_access";
const OTP_TTL_SECS: u64 = 10 * 60;
const SESSION_TTL_SECS: u64 = 24 * 60 * 60;
const UNKNOWN_WINDOW: Duration = Duration::from_secs(60 * 60);
const RESEND_COOLDOWN: Duration = Duration::from_secs(60);
const MAX_FORM_BYTES: usize = 4096;

static ACCESS_GATE: OnceLock<Option<AccessGate>> = OnceLock::new();

pub(crate) fn normalized_request_host(req: &Request<Body>) -> String {
    let raw_host = req
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| req.uri().authority().map(Authority::as_str))
        .unwrap_or_default();

    raw_host
        .parse::<Authority>()
        .map(|authority| authority.host().trim_end_matches('.').to_ascii_lowercase())
        .unwrap_or_else(|_| raw_host.trim_end_matches('.').to_ascii_lowercase())
}

#[derive(Clone)]
pub struct AccessGatePage;

pub enum GateOutcome {
    Allow(Request<Body>),
    Respond(Response<Body>),
}

struct OtpChallenge {
    digest: Vec<u8>,
    expires_at: u64,
}

struct AttemptWindow {
    started_at: Instant,
    attempts: u8,
}

pub struct AccessGate {
    domain: String,
    shared_edge: bool,
    allowed_emails: HashSet<String>,
    session_secret: Vec<u8>,
    resend_api_key: String,
    from_email: String,
    http_client: reqwest::Client,
    otp_by_email: DashMap<String, OtpChallenge>,
    unknown_by_ip: DashMap<IpAddr, AttemptWindow>,
    invalid_code_by_ip: DashMap<IpAddr, AttemptWindow>,
    last_send_by_email: DashMap<String, Instant>,
    last_cleanup_at: AtomicU64,
}

pub fn initialize() -> Result<(), Box<dyn Error>> {
    let gate = AccessGate::from_env()?;
    ACCESS_GATE.set(gate).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "la puerta de acceso ya estaba inicializada",
        )
    })?;
    Ok(())
}

pub fn current() -> Option<&'static AccessGate> {
    ACCESS_GATE.get().and_then(Option::as_ref)
}

impl AccessGate {
    fn from_env() -> Result<Option<Self>, Box<dyn Error>> {
        if !env_flag("ACCESS_GATE_ENABLED") {
            tracing::info!("Puerta de acceso de preproducción desactivada");
            return Ok(None);
        }

        let domain = required_env("ACCESS_GATE_DOMAIN")?
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if !valid_dns_name(&domain) {
            return Err("ACCESS_GATE_DOMAIN no es un nombre DNS válido".into());
        }

        let allowed_emails = required_env("ACCESS_GATE_ALLOWED_EMAILS")?
            .split(',')
            .filter_map(normalize_email)
            .collect::<HashSet<_>>();
        if allowed_emails.is_empty() {
            return Err("ACCESS_GATE_ALLOWED_EMAILS debe contener al menos un correo".into());
        }

        let session_secret = required_env("ACCESS_GATE_SESSION_SECRET")?.into_bytes();
        if session_secret.len() < 32 {
            return Err("ACCESS_GATE_SESSION_SECRET debe tener al menos 32 caracteres".into());
        }

        let resend_api_key = required_env("RESEND_API_KEY")?;
        let shared_edge = env_flag("ACCESS_GATE_SHARED_EDGE");
        let from_email = std::env::var("ACCESS_GATE_FROM_EMAIL")
            .unwrap_or_else(|_| "RageNodes Access <info@ragenodes.com>".to_string());
        let http_client = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .user_agent("RageNodes-OxideProxy/1.0")
            .build()?;

        tracing::info!(
            "Puerta de acceso habilitada para {} con {} correo(s) autorizado(s)",
            domain,
            allowed_emails.len()
        );

        Ok(Some(Self {
            domain,
            shared_edge,
            allowed_emails,
            session_secret,
            resend_api_key,
            from_email,
            http_client,
            otp_by_email: DashMap::new(),
            unknown_by_ip: DashMap::new(),
            invalid_code_by_ip: DashMap::new(),
            last_send_by_email: DashMap::new(),
            last_cleanup_at: AtomicU64::new(unix_now()),
        }))
    }

    pub async fn enforce(
        &self,
        req: Request<Body>,
        peer_addr: SocketAddr,
        ban_tx: tokio::sync::mpsc::Sender<IpAddr>,
        is_https: bool,
    ) -> GateOutcome {
        self.cleanup_expired_state();
        let host = normalized_request_host(&req);
        let gated_subdomain = host
            .strip_suffix(&format!(".{}", self.domain))
            .is_some_and(|label| !label.is_empty() && !label.contains('.'));

        if host != self.domain && !gated_subdomain {
            if self.shared_edge {
                return GateOutcome::Allow(req);
            }
            return GateOutcome::Respond(text_response(
                StatusCode::MISDIRECTED_REQUEST,
                "421 Misdirected Request",
            ));
        }

        if req.uri().path() == "/healthz" {
            return GateOutcome::Allow(req);
        }

        if !is_https {
            let path = req
                .uri()
                .path_and_query()
                .map(|value| value.as_str())
                .unwrap_or("/");
            return GateOutcome::Respond(redirect_response(&format!(
                "https://{}{}",
                self.domain, path
            )));
        }

        if self.has_valid_session(&req) {
            return GateOutcome::Allow(req);
        }

        // Los paneles dinámicos de staging comparten la cookie del dominio
        // principal. Si todavía no existe una sesión, la autenticación siempre
        // se realiza en el host canónico para conservar una validación Origin
        // estricta y evitar formularios válidos en subdominios arbitrarios.
        if gated_subdomain {
            return GateOutcome::Respond(redirect_response(&format!(
                "https://{}{}",
                self.domain, ACCESS_PATH
            )));
        }

        let path = req.uri().path().to_string();
        let method = req.method().clone();
        match (method, path.as_str()) {
            (Method::GET, ACCESS_PATH) | (Method::GET, "/") => {
                GateOutcome::Respond(access_page(None, false, None))
            }
            (Method::POST, REQUEST_PATH) => {
                if !self.valid_origin(&req) {
                    return GateOutcome::Respond(text_response(
                        StatusCode::FORBIDDEN,
                        "Origen no permitido",
                    ));
                }
                GateOutcome::Respond(self.request_code(req, peer_addr.ip(), ban_tx).await)
            }
            (Method::POST, VERIFY_PATH) => {
                if !self.valid_origin(&req) {
                    return GateOutcome::Respond(text_response(
                        StatusCode::FORBIDDEN,
                        "Origen no permitido",
                    ));
                }
                GateOutcome::Respond(self.verify_code(req, peer_addr.ip(), ban_tx).await)
            }
            _ => GateOutcome::Respond(access_page(None, false, None)),
        }
    }

    async fn request_code(
        &self,
        req: Request<Body>,
        ip: IpAddr,
        ban_tx: tokio::sync::mpsc::Sender<IpAddr>,
    ) -> Response<Body> {
        let form = match read_form(req).await {
            Ok(form) => form,
            Err(response) => return response,
        };
        let email = form.get("email").and_then(|value| normalize_email(value));
        let Some(email) = email else {
            return access_page(Some("Introduce un correo válido."), false, None);
        };

        if !self.allowed_emails.contains(&email) {
            let attempts = self.record_unknown_attempt(ip);
            tracing::warn!(
                "Puerta de acceso: intento con correo no autorizado desde {} ({}/3)",
                ip,
                attempts
            );
            if attempts >= 3 {
                let _ = ban_tx.send(ip).await;
                return text_response(StatusCode::FORBIDDEN, "Acceso bloqueado");
            }
            return access_page(
                Some("Si el correo está autorizado, recibirás un código en breve."),
                true,
                Some(&email),
            );
        }

        if self
            .last_send_by_email
            .get(&email)
            .is_some_and(|last| last.elapsed() < RESEND_COOLDOWN)
        {
            return access_page(
                Some("Si el correo está autorizado, recibirás un código en breve."),
                true,
                Some(&email),
            );
        }

        let code = generate_code();
        let expires_at = unix_now().saturating_add(OTP_TTL_SECS);
        let digest = self.otp_digest(&email, &code, expires_at);

        match self.send_code(&email, &code).await {
            Ok(()) => {
                self.otp_by_email.insert(
                    email.clone(),
                    OtpChallenge {
                        digest,
                        expires_at,
                    },
                );
                self.last_send_by_email.insert(email.clone(), Instant::now());
            }
            Err(error) => {
                tracing::error!("Resend no pudo entregar el código de acceso: {}", error);
            }
        }

        access_page(
            Some("Si el correo está autorizado, recibirás un código en breve."),
            true,
            Some(&email),
        )
    }

    async fn verify_code(
        &self,
        req: Request<Body>,
        ip: IpAddr,
        ban_tx: tokio::sync::mpsc::Sender<IpAddr>,
    ) -> Response<Body> {
        let form = match read_form(req).await {
            Ok(form) => form,
            Err(response) => return response,
        };
        let email = form.get("email").and_then(|value| normalize_email(value));
        let code = form
            .get("code")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let Some(email) = email else {
            return access_page(Some("Código inválido o caducado."), true, None);
        };

        if !self.allowed_emails.contains(&email) {
            let attempts = self.record_unknown_attempt(ip);
            if attempts >= 3 {
                let _ = ban_tx.send(ip).await;
                return text_response(StatusCode::FORBIDDEN, "Acceso bloqueado");
            }
            return access_page(
                Some("Código inválido o caducado."),
                true,
                Some(&email),
            );
        }

        let now = unix_now();
        let mut valid = false;
        if let Some(challenge) = self.otp_by_email.get(&email) {
            if challenge.expires_at >= now && code.len() == 6 {
                let mut mac = HmacSha256::new_from_slice(&self.session_secret)
                    .expect("HMAC admite secretos de cualquier tamaño");
                mac.update(
                    format!("otp|{}|{}|{}", email, code, challenge.expires_at).as_bytes(),
                );
                valid = mac.verify_slice(&challenge.digest).is_ok();
            }
        }

        if valid {
            self.otp_by_email.remove(&email);
            return self.authorized_response(&email);
        }

        if self.record_invalid_code(ip) >= 5 {
            let _ = ban_tx.send(ip).await;
            return text_response(StatusCode::FORBIDDEN, "Acceso bloqueado");
        }

        access_page(
            Some("Código inválido o caducado."),
            true,
            Some(&email),
        )
    }

    async fn send_code(&self, email: &str, code: &str) -> Result<(), String> {
        let payload = json!({
            "from": self.from_email,
            "to": [email],
            "subject": "Código de acceso a RageNodes Dev",
            "html": format!(
                "<div style=\"font-family:sans-serif;background:#09090b;color:#fff;padding:28px;border-radius:12px\"><h2>Acceso a RageNodes Dev</h2><p>Tu código de acceso es:</p><p style=\"font-size:32px;font-weight:700;letter-spacing:8px\">{code}</p><p>Caduca en 10 minutos y solo puede utilizarse una vez.</p></div>"
            )
        });
        let response = self
            .http_client
            .post("https://api.resend.com/emails")
            .bearer_auth(&self.resend_api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        Ok(())
    }

    fn authorized_response(&self, email: &str) -> Response<Body> {
        let token = self.create_session_token(email);
        let cookie = format!(
            "{SESSION_COOKIE}={token}; Domain={}; Path=/; Max-Age={SESSION_TTL_SECS}; Secure; HttpOnly; SameSite=Strict",
            self.domain
        );
        let mut response = redirect_response("/");
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            response.headers_mut().insert(SET_COOKIE, value);
        }
        response
    }

    fn has_valid_session(&self, req: &Request<Body>) -> bool {
        let Some(cookie_header) = req.headers().get(COOKIE).and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        cookie_header.split(';').any(|part| {
            let mut fields = part.trim().splitn(2, '=');
            fields.next() == Some(SESSION_COOKIE)
                && fields
                    .next()
                    .is_some_and(|token| self.verify_session_token(token))
        })
    }

    fn create_session_token(&self, email: &str) -> String {
        let expires_at = unix_now().saturating_add(SESSION_TTL_SECS);
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).expect("el sistema debe proporcionar aleatoriedad segura");
        let email_hash = Sha256::digest(email.as_bytes());
        let payload = format!(
            "v1|{}|{}|{}",
            expires_at,
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(email_hash)
        );
        let signature = self.sign(payload.as_bytes());
        format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(payload.as_bytes()),
            URL_SAFE_NO_PAD.encode(signature)
        )
    }

    fn verify_session_token(&self, token: &str) -> bool {
        let Some((payload_b64, signature_b64)) = token.split_once('.') else {
            return false;
        };
        let Ok(payload) = URL_SAFE_NO_PAD.decode(payload_b64) else {
            return false;
        };
        let Ok(signature) = URL_SAFE_NO_PAD.decode(signature_b64) else {
            return false;
        };
        let mut mac = HmacSha256::new_from_slice(&self.session_secret)
            .expect("HMAC admite secretos de cualquier tamaño");
        mac.update(&payload);
        if mac.verify_slice(&signature).is_err() {
            return false;
        }
        let Ok(payload_text) = std::str::from_utf8(&payload) else {
            return false;
        };
        let mut fields = payload_text.split('|');
        if fields.next() != Some("v1") {
            return false;
        }
        let expires_at = fields
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_default();
        expires_at >= unix_now()
            && fields.next().is_some()
            && fields.next().is_some()
            && fields.next().is_none()
    }

    fn otp_digest(&self, email: &str, code: &str, expires_at: u64) -> Vec<u8> {
        let value = format!("otp|{email}|{code}|{expires_at}");
        self.sign(value.as_bytes())
    }

    fn sign(&self, value: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.session_secret)
            .expect("HMAC admite secretos de cualquier tamaño");
        mac.update(value);
        mac.finalize().into_bytes().to_vec()
    }

    fn record_unknown_attempt(&self, ip: IpAddr) -> u8 {
        record_attempt(&self.unknown_by_ip, ip)
    }

    fn record_invalid_code(&self, ip: IpAddr) -> u8 {
        record_attempt(&self.invalid_code_by_ip, ip)
    }

    fn cleanup_expired_state(&self) {
        let now = unix_now();
        let previous = self.last_cleanup_at.load(Ordering::Relaxed);
        if now.saturating_sub(previous) < 300
            || self
                .last_cleanup_at
                .compare_exchange(previous, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
        {
            return;
        }
        self.otp_by_email
            .retain(|_, challenge| challenge.expires_at >= now);
        self.unknown_by_ip
            .retain(|_, window| window.started_at.elapsed() <= UNKNOWN_WINDOW);
        self.invalid_code_by_ip
            .retain(|_, window| window.started_at.elapsed() <= UNKNOWN_WINDOW);
        self.last_send_by_email
            .retain(|_, sent_at| sent_at.elapsed() <= RESEND_COOLDOWN);
    }

    fn valid_origin(&self, req: &Request<Body>) -> bool {
        let Some(origin) = req
            .headers()
            .get(ORIGIN)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        let Ok(origin) = url::Url::parse(origin) else {
            return false;
        };

        origin.scheme() == "https"
            && origin
                .host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case(&self.domain))
            && origin.port_or_known_default() == Some(443)
            && origin.username().is_empty()
            && origin.password().is_none()
            && origin.path() == "/"
            && origin.query().is_none()
            && origin.fragment().is_none()
    }
}

fn record_attempt(windows: &DashMap<IpAddr, AttemptWindow>, ip: IpAddr) -> u8 {
        let now = Instant::now();
        let mut entry = windows.entry(ip).or_insert(AttemptWindow {
            started_at: now,
            attempts: 0,
        });
        if now.duration_since(entry.started_at) > UNKNOWN_WINDOW {
            entry.started_at = now;
            entry.attempts = 0;
        }
        entry.attempts = entry.attempts.saturating_add(1);
        entry.attempts
}

async fn read_form(req: Request<Body>) -> Result<HashMap<String, String>, Response<Body>> {
    let body = hyper::body::to_bytes(req.into_body())
        .await
        .map_err(|_| text_response(StatusCode::BAD_REQUEST, "Formulario inválido"))?;
    if body.len() > MAX_FORM_BYTES {
        return Err(text_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Formulario demasiado grande",
        ));
    }
    Ok(url::form_urlencoded::parse(&body)
        .into_owned()
        .collect::<HashMap<_, _>>())
}

fn access_page(message: Option<&str>, show_code: bool, email: Option<&str>) -> Response<Body> {
    let message_html = message
        .map(|value| format!("<p class=\"notice\">{}</p>", escape_html(value)))
        .unwrap_or_default();
    let form = if show_code {
        format!(
            "<form method=\"post\" action=\"{VERIFY_PATH}\"><input type=\"hidden\" name=\"email\" value=\"{}\"><label for=\"code\">Código de acceso</label><input id=\"code\" name=\"code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9]{{6}}\" maxlength=\"6\" required autofocus><button type=\"submit\">Verificar código</button></form><a href=\"{ACCESS_PATH}\">Usar otro correo</a>",
            escape_html(email.unwrap_or_default())
        )
    } else {
        format!(
            "<form method=\"post\" action=\"{REQUEST_PATH}\"><label for=\"email\">Correo autorizado</label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\" maxlength=\"254\" required autofocus><button type=\"submit\">Enviar código</button></form>"
        )
    };
    let html = format!(
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Acceso · RageNodes Dev</title><style>:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070a;color:#f5f5f5;font-family:Inter,system-ui,sans-serif}}main{{width:min(92vw,430px);padding:32px;border:1px solid #27272a;border-radius:18px;background:#101014;box-shadow:0 24px 80px #0008}}h1{{margin:0 0 8px;font-size:1.7rem}}p{{color:#a1a1aa;line-height:1.5}}label{{display:block;margin:22px 0 8px;font-weight:650}}input{{width:100%;padding:13px 14px;border:1px solid #3f3f46;border-radius:10px;background:#09090b;color:#fff;font-size:1rem}}button{{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#6366f1;color:#fff;font-weight:750;cursor:pointer}}a{{display:block;margin-top:18px;color:#a5b4fc;text-align:center}}.notice{{padding:11px 13px;border-radius:9px;background:#18181b;color:#d4d4d8}}</style></head><body><main><h1>RageNodes Dev</h1><p>Entorno restringido para desarrolladores. El acceso concedido tendrá una duración de 24 horas.</p>{message_html}{form}</main></body></html>"
    );
    let mut response = Response::new(Body::from(html));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response.extensions_mut().insert(AccessGatePage);
    response
}

fn redirect_response(location: &str) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::SEE_OTHER;
    if let Ok(value) = HeaderValue::from_str(location) {
        response.headers_mut().insert(LOCATION, value);
    }
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
}

fn text_response(status: StatusCode, message: &str) -> Response<Body> {
    let mut response = Response::new(Body::from(message.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
}

fn generate_code() -> String {
    let mut random = [0u8; 4];
    getrandom::getrandom(&mut random).expect("el sistema debe proporcionar aleatoriedad segura");
    format!("{:06}", u32::from_le_bytes(random) % 1_000_000)
}

fn normalize_email(value: &str) -> Option<String> {
    let email = value.trim().to_ascii_lowercase();
    if email.is_empty()
        || email.len() > 254
        || !email.is_ascii()
        || email.contains(char::is_whitespace)
    {
        return None;
    }
    let mut parts = email.split('@');
    let local = parts.next()?;
    let domain = parts.next()?;
    if parts.next().is_some() || local.is_empty() || !valid_dns_name(domain) {
        return None;
    }
    Some(email)
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

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn required_env(name: &str) -> Result<String, Box<dyn Error>> {
    let value = std::env::var(name).unwrap_or_default().trim().to_string();
    if value.is_empty() {
        Err(format!("{name} es obligatorio cuando ACCESS_GATE_ENABLED=true").into())
    } else {
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_gate() -> AccessGate {
        AccessGate {
            domain: "ragenodes.dev".to_string(),
            shared_edge: false,
            allowed_emails: HashSet::from(["dev@example.com".to_string()]),
            session_secret: b"0123456789abcdef0123456789abcdef".to_vec(),
            resend_api_key: "unused".to_string(),
            from_email: "unused@example.com".to_string(),
            http_client: reqwest::Client::new(),
            otp_by_email: DashMap::new(),
            unknown_by_ip: DashMap::new(),
            invalid_code_by_ip: DashMap::new(),
            last_send_by_email: DashMap::new(),
            last_cleanup_at: AtomicU64::new(unix_now()),
        }
    }

    #[test]
    fn normalizes_valid_email() {
        assert_eq!(
            normalize_email(" Dev@Example.COM "),
            Some("dev@example.com".to_string())
        );
        assert_eq!(normalize_email("invalid"), None);
    }

    #[test]
    fn origin_validation_accepts_only_canonical_https_origin() {
        let gate = test_gate();
        let request = |origin: Option<&str>| {
            let mut builder = Request::builder().uri(REQUEST_PATH);
            if let Some(origin) = origin {
                builder = builder.header(ORIGIN, origin);
            }
            builder.body(Body::empty()).unwrap()
        };

        assert!(gate.valid_origin(&request(Some("https://ragenodes.dev"))));
        assert!(gate.valid_origin(&request(Some("https://ragenodes.dev:443"))));
        assert!(!gate.valid_origin(&request(Some("http://ragenodes.dev"))));
        assert!(!gate.valid_origin(&request(Some("https://ragenodes.dev:444"))));
        assert!(!gate.valid_origin(&request(Some("https://evil.example"))));
        assert!(!gate.valid_origin(&request(None)));
    }

    #[test]
    fn session_token_is_signed_and_rejects_tampering() {
        let gate = test_gate();
        let token = gate.create_session_token("dev@example.com");
        assert!(gate.verify_session_token(&token));
        let mut tampered = token.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
        assert!(!gate.verify_session_token(std::str::from_utf8(&tampered).unwrap()));
    }

    #[test]
    fn unknown_attempts_reset_and_reach_three() {
        let gate = test_gate();
        let ip: IpAddr = "203.0.113.5".parse().unwrap();
        assert_eq!(gate.record_unknown_attempt(ip), 1);
        assert_eq!(gate.record_unknown_attempt(ip), 2);
        assert_eq!(gate.record_unknown_attempt(ip), 3);
    }

    #[tokio::test]
    async fn shared_edge_does_not_gate_production_domain() {
        let mut gate = test_gate();
        gate.shared_edge = true;
        let request = Request::builder()
            .uri("https://ragenodes.com/")
            .body(Body::empty())
            .unwrap();
        let (ban_tx, _ban_rx) = tokio::sync::mpsc::channel(1);
        let peer_addr: SocketAddr = "192.0.2.10:443".parse().unwrap();

        assert!(matches!(
            gate.enforce(request, peer_addr, ban_tx, true).await,
            GateOutcome::Allow(_)
        ));
    }

    #[tokio::test]
    async fn shared_edge_redirects_unauthenticated_staging_subdomains_to_the_gate() {
        let mut gate = test_gate();
        gate.shared_edge = true;
        let request = Request::builder()
            .uri("https://tx40120.ragenodes.dev/")
            .body(Body::empty())
            .unwrap();
        let (ban_tx, _ban_rx) = tokio::sync::mpsc::channel(1);
        let peer_addr: SocketAddr = "192.0.2.10:443".parse().unwrap();

        let GateOutcome::Respond(response) = gate.enforce(request, peer_addr, ban_tx, true).await
        else {
            panic!("el subdominio de staging no debe quedar público");
        };
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(
            response.headers().get(LOCATION).and_then(|value| value.to_str().ok()),
            Some("https://ragenodes.dev/__access")
        );
    }
}
