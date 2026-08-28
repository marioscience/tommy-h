use crate::access_gate::{
    current as access_gate, normalized_request_host, AccessGatePage, GateOutcome,
};
use crate::config::ProxyConfig;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use flate2::write::GzEncoder;
use flate2::Compression;
use http::header::{
    HeaderName, HeaderValue, ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_TYPE, ETAG,
};
use http::{Request, Response, StatusCode};
use hyper::{service::service_fn, Body};
use percent_encoding::percent_decode_str;
use std::convert::Infallible;
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use tokio::io::{AsyncRead, AsyncWrite};

static PROXY_HTTP_CLIENT: OnceLock<hyper::Client<hyper::client::HttpConnector>> = OnceLock::new();

fn get_proxy_client() -> &'static hyper::Client<hyper::client::HttpConnector> {
    PROXY_HTTP_CLIENT.get_or_init(|| {
        hyper::Client::builder()
            .pool_idle_timeout(std::time::Duration::from_secs(60))
            .pool_max_idle_per_host(64)
            .build_http()
    })
}

#[derive(Clone)]
struct StaticPageSecurity {
    nonce: String,
    allows_paypal: bool,
    allows_internal_frames: bool,
    cross_origin_isolated: bool,
}

#[derive(Clone)]
struct AllowSameOriginFraming;

#[derive(Clone)]
struct AllowPhpMyAdminFraming;

#[derive(Clone)]
struct AllowRageNodesPanelFraming;

#[derive(Clone)]
struct AllowBlenderApp;

#[derive(Clone)]
struct TrustedStagingUpstream;

fn env_port(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(default)
}

fn dynamic_web_domains() -> Vec<String> {
    std::env::var("OXIDE_DYNAMIC_WEB_DOMAINS")
        .unwrap_or_else(|_| {
            "ragenodes.app,ragenodes.dev,ragenodes.com,node1.ragenodes.com".to_string()
        })
        .split(',')
        .map(|domain| domain.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|domain| {
            !domain.is_empty()
                && domain.len() <= 253
                && domain.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '-')
                })
        })
        .collect()
}

fn dynamic_proxy_port_for_domains(
    host: &str,
    prefix: &str,
    start: u16,
    end: u16,
    domains: &[String],
) -> Option<u16> {
    if start > end {
        return None;
    }

    domains.iter().find_map(|domain| {
        let suffix = format!(".{domain}");
        host.strip_prefix(prefix)
            .and_then(|value| value.strip_suffix(&suffix))
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| (start..=end).contains(port))
    })
}

fn dynamic_proxy_port(host: &str, prefix: &str, start: u16, end: u16) -> Option<u16> {
    dynamic_proxy_port_for_domains(host, prefix, start, end, &dynamic_web_domains())
}

fn prepare_public_proxy_request(req: &mut Request<Body>, host: &str, is_https: bool) {
    if let Ok(value) = HeaderValue::from_str(if is_https { "https" } else { "http" }) {
        req.headers_mut().insert("x-forwarded-proto", value);
    }
    if let Ok(value) = HeaderValue::from_str(host) {
        req.headers_mut().insert("x-forwarded-host", value);
    }
}

fn valid_backend_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
        })
}

fn dynamic_backend_addr(request_host: &str, port: u16) -> String {
    let staging_domain = std::env::var("STAGING_DYNAMIC_DOMAIN")
        .unwrap_or_else(|_| "ragenodes.dev".to_string())
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let staging_backend = std::env::var("OXIDE_DYNAMIC_STAGING_BACKEND_HOST")
        .ok()
        .filter(|value| valid_backend_host(value.trim()))
        .or_else(|| {
            std::env::var("STAGING_UPSTREAM").ok().and_then(|value| {
                let host = value.trim().split(':').next().unwrap_or_default();
                valid_backend_host(host).then(|| host.to_string())
            })
        })
        .unwrap_or_default();
    let is_staging_endpoint = request_host.ends_with(&format!(".{staging_domain}"));
    let configured = if is_staging_endpoint && valid_backend_host(staging_backend.trim()) {
        staging_backend
    } else {
        std::env::var("OXIDE_DYNAMIC_BACKEND_HOST")
            .unwrap_or_else(|_| "host.docker.internal".to_string())
    };
    let host = configured.trim().trim_end_matches('.');
    let safe_host = if valid_backend_host(host) {
        host
    } else {
        "host.docker.internal"
    };
    format!("{safe_host}:{port}")
}

fn frame_ancestors_policy() -> String {
    let configured = std::env::var("OXIDE_FRAME_ANCESTORS").unwrap_or_else(|_| {
        "https://ragenodes.com https://www.ragenodes.com https://panel.ragenodes.app https://ragenodes.dev https://panel.ragenodes.dev https://staging.ragenodes.com".to_string()
    });
    let origins: Vec<String> = configured
        .split_whitespace()
        .filter_map(|origin| {
            let parsed = url::Url::parse(origin).ok()?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || parsed.username() != ""
                || parsed.password().is_some()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                return None;
            }
            Some(origin.trim_end_matches('/').to_string())
        })
        .collect();

    if origins.is_empty() {
        "'none'".to_string()
    } else {
        // txAdmin y otras aplicaciones proxificadas pueden crear iframes
        // internos bajo el mismo host. CSP comprueba toda la cadena de
        // ancestros, por lo que el propio origen debe estar permitido junto
        // a los paneles externos enumerados explícitamente.
        format!("'self' {}", origins.join(" "))
    }
}

fn access_gate_csp(domain: Option<&str>) -> String {
    let panel_origin = domain
        .map(str::trim)
        .map(|value| value.trim_end_matches('.'))
        .filter(|value| {
            value.contains('.')
                && value.len() <= 253
                && value.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
        })
        .map(|value| format!(" https://panel.{value}"))
        .unwrap_or_default();

    format!(
        "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'{panel_origin}; style-src 'unsafe-inline'"
    )
}

fn csp_with_frame_ancestors(existing: Option<&str>, ancestors: &str) -> String {
    let mut directives: Vec<String> = existing
        .unwrap_or_default()
        .split(';')
        .map(str::trim)
        .filter(|directive| {
            !directive.is_empty()
                && !directive
                    .to_ascii_lowercase()
                    .starts_with("frame-ancestors")
        })
        .map(str::to_string)
        .collect();
    directives.push(format!("frame-ancestors {ancestors}"));
    directives.join("; ")
}

fn blender_app_csp(ancestors: &str) -> String {
    format!(
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors {ancestors}; form-action 'self'; \
         script-src 'self' blob:; script-src-attr 'none'; \
         style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; \
         font-src 'self' data:; img-src 'self' data: blob:; \
         connect-src 'self' data: blob: ws: wss:; frame-src 'self' blob:; \
         worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' data: blob:; \
         manifest-src 'self'"
    )
}

fn trusted_upstream_csp(existing: Option<&str>) -> Option<String> {
    let policy = existing?.trim();
    if policy.is_empty() || policy.len() > 8_192 {
        return None;
    }

    let directive = |name: &str| {
        policy.split(';').map(str::trim).find(|entry| {
            entry
                .split_whitespace()
                .next()
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(name))
        })
    };
    let contains_token = |entry: &str, token: &str| {
        entry
            .split_whitespace()
            .any(|candidate| candidate.eq_ignore_ascii_case(token))
    };

    let default_src = directive("default-src")?;
    let object_src = directive("object-src")?;
    directive("frame-ancestors")?;
    if !contains_token(object_src, "'none'") {
        return None;
    }

    if let Some(script_src) = directive("script-src") {
        let has_nonce = script_src
            .split_whitespace()
            .any(|candidate| candidate.starts_with("'nonce-") && candidate.ends_with('\''));
        if !has_nonce
            || contains_token(script_src, "'unsafe-inline'")
            || contains_token(script_src, "'unsafe-eval'")
            || directive("script-src-attr").is_none_or(|entry| !contains_token(entry, "'none'"))
        {
            return None;
        }
    } else if !contains_token(default_src, "'none'") {
        return None;
    }

    Some(policy.to_string())
}

fn static_page_security_profile(path: &Path, nonce: String) -> StaticPageSecurity {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let allows_paypal = matches!(
        file_name.as_str(),
        "index.html" | "hosting-fivem.html" | "creadores.html" | "panel.html"
    );
    let allows_internal_frames = matches!(
        file_name.as_str(),
        "panel.html" | "admin.html" | "fivem.html" | "fivem_v3.html"
    );

    StaticPageSecurity {
        nonce,
        allows_paypal,
        allows_internal_frames,
        // Las vistas que no integran pagos pueden activar COEP sin interferir
        // con los iframes y popups necesarios para el checkout de PayPal.
        cross_origin_isolated: !allows_paypal,
    }
}

fn is_private_admin_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
    }
}

fn normalize_uri_path(path: &str) -> String {
    let mut current_path = path.to_string();
    let mut iterations = 0;
    loop {
        if iterations > 3 {
            break; // Prevención de DoS por bucle infinito
        }
        let decoded = percent_decode_str(&current_path)
            .decode_utf8_lossy()
            .into_owned();
        if decoded == current_path {
            break;
        }
        current_path = decoded;
        iterations += 1;
    }

    // Eliminación de null bytes
    current_path = current_path.replace('\0', "");

    // Normalización de rutas (resolver /../ y /./)
    let mut components = Vec::new();
    for comp in current_path.split('/') {
        if comp == "." || comp.is_empty() {
            continue;
        } else if comp == ".." {
            components.pop();
        } else {
            components.push(comp);
        }
    }

    let mut normalized = format!("/{}", components.join("/"));
    if current_path.ends_with('/') && normalized != "/" {
        normalized.push('/');
    }

    normalized
}

fn is_admin_surface(path: &str) -> bool {
    path == "/admin"
        || path == "/admin/"
        || path == "/admin.html"
        || path.starts_with("/admin/")
        || path.starts_with("/api/admin")
}

fn forbidden_admin_response() -> Response<Body> {
    let mut res = Response::new(Body::from(
        "403 Forbidden: admin panel is only available from the local network",
    ));
    *res.status_mut() = StatusCode::FORBIDDEN;
    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    res
}

fn not_found_response() -> Response<Body> {
    let mut res = Response::new(Body::from("404 Not Found"));
    *res.status_mut() = StatusCode::NOT_FOUND;
    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    res
}

fn is_disallowed_static_path(path: &str) -> bool {
    path.split('/').filter(|part| !part.is_empty()).any(|part| {
        let lower = part.to_ascii_lowercase();
        (part.starts_with('.') && part != ".well-known")
            || lower.ends_with(".bak")
            || lower.ends_with(".old")
            || lower.ends_with('~')
            || lower.contains("_backup.")
            || lower.contains(".backup.")
    })
}

fn apply_browser_security_headers(response: &mut Response<Body>, is_https: bool) {
    let page_security = response.extensions().get::<StaticPageSecurity>().cloned();
    let allow_same_origin_framing = response
        .extensions()
        .get::<AllowSameOriginFraming>()
        .is_some();
    let allow_pma_framing = response
        .extensions()
        .get::<AllowPhpMyAdminFraming>()
        .is_some();
    let allow_panel_framing = response
        .extensions()
        .get::<AllowRageNodesPanelFraming>()
        .is_some();
    let allow_blender_app = response.extensions().get::<AllowBlenderApp>().is_some();
    let trusted_staging_upstream = response
        .extensions()
        .get::<TrustedStagingUpstream>()
        .is_some();
    let access_gate_page = response.extensions().get::<AccessGatePage>().is_some();
    let headers = response.headers_mut();
    let upstream_csp = headers
        .get("content-security-policy")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let trusted_staging_csp = trusted_staging_upstream
        .then(|| trusted_upstream_csp(upstream_csp.as_deref()))
        .flatten();
    headers.remove("server");
    headers.remove("x-powered-by");
    if !allow_panel_framing && trusted_staging_csp.is_none() {
        headers.remove("content-security-policy");
    }
    headers.remove("x-content-security-policy");
    headers.remove("x-webkit-csp");
    headers.remove("x-frame-options");
    headers.remove("cross-origin-resource-policy");
    headers.remove("cross-origin-embedder-policy");
    headers.remove("cross-origin-opener-policy");
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    if !allow_panel_framing {
        headers.insert(
            HeaderName::from_static("x-frame-options"),
            if allow_same_origin_framing || allow_pma_framing {
                HeaderValue::from_static("SAMEORIGIN")
            } else {
                HeaderValue::from_static("DENY")
            },
        );
    }
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        if access_gate_page {
            HeaderValue::from_static("same-origin")
        } else {
            HeaderValue::from_static("no-referrer")
        },
    );
    // Los navegadores solo aceptan HSTS sobre HTTPS, por lo que esta cabecera
    // es inocua en desarrollo HTTP y queda preparada para producción TLS.
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=31536000"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(
            "camera=(), microphone=(), geolocation=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=(), serial=(), hid=(), browsing-topics=(), clipboard-write=(self), fullscreen=(self), payment=(self \"https://www.paypal.com\")",
        ),
    );
    if is_https && !allow_panel_framing {
        let coop = if page_security
            .as_ref()
            .is_some_and(|profile| profile.allows_paypal)
        {
            HeaderValue::from_static("same-origin-allow-popups")
        } else {
            HeaderValue::from_static("same-origin")
        };
        headers.insert(HeaderName::from_static("cross-origin-opener-policy"), coop);
    }
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        if allow_panel_framing {
            HeaderValue::from_static("cross-origin")
        } else {
            HeaderValue::from_static("same-origin")
        },
    );
    if page_security
        .as_ref()
        .is_some_and(|profile| profile.cross_origin_isolated)
    {
        headers.insert(
            HeaderName::from_static("cross-origin-embedder-policy"),
            HeaderValue::from_static("credentialless"),
        );
    }
    let csp = if let Some(policy) = trusted_staging_csp {
        policy
    } else if allow_blender_app {
        let ancestors = if allow_panel_framing {
            frame_ancestors_policy()
        } else {
            "'self'".to_string()
        };
        blender_app_csp(&ancestors)
    } else if allow_panel_framing {
        csp_with_frame_ancestors(upstream_csp.as_deref(), &frame_ancestors_policy())
    } else if access_gate_page {
        access_gate_csp(std::env::var("ACCESS_GATE_DOMAIN").ok().as_deref())
    } else if let Some(profile) = page_security.as_ref() {
        let third_party = match (profile.allows_paypal, profile.allows_internal_frames) {
            (true, true) => "img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https://www.paypal.com https://www.paypalobjects.com; frame-src 'self' https://*.ragenodes.app https://*.ragenodes.dev https://*.ragenodes.com https://www.paypal.com;",
            (true, false) => "img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https://www.paypal.com https://www.paypalobjects.com; frame-src https://www.paypal.com;",
            (false, true) => "img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; frame-src 'self' https://*.ragenodes.app https://*.ragenodes.dev https://*.ragenodes.com;",
            (false, false) => "img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; frame-src 'none';",
        };
        format!(
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'nonce-{}' 'strict-dynamic' 'self' https://www.paypal.com; script-src-attr 'none'; style-src 'self'; style-src-elem 'self' 'nonce-{}'; style-src-attr 'unsafe-inline'; font-src 'self' data:; {} worker-src 'self' blob:; manifest-src 'self'",
            profile.nonce, profile.nonce, third_party
        )
    } else if allow_same_origin_framing {
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; manifest-src 'none'".to_string()
    } else if allow_pma_framing {
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; manifest-src 'self'".to_string()
    } else {
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; manifest-src 'none'".to_string()
    };
    if let Ok(value) = HeaderValue::from_str(&csp) {
        headers.insert(HeaderName::from_static("content-security-policy"), value);
    }
}

pub async fn serve_http_connection<S>(
    stream: S,
    config: Arc<ProxyConfig>,
    peer_addr: SocketAddr,
    ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>,
    is_https: bool,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |req| {
        let cfg = Arc::clone(&config);
        let tx = ban_tx.clone();
        async move {
            let mut response = handle_http_request(req, cfg, peer_addr, tx, is_https).await?;
            apply_browser_security_headers(&mut response, is_https);
            Ok::<_, Infallible>(response)
        }
    });

    if let Err(err) = hyper::server::conn::Http::new()
        .http1_only(false) // Soporte HTTP/1.1 y HTTP/2
        .serve_connection(stream, service)
        .with_upgrades()
        .await
    {
        tracing::debug!("Error sirviendo conexión HTTP L7: {}", err);
    }
}

async fn handle_http_request(
    mut req: Request<Body>,
    config: Arc<ProxyConfig>,
    peer_addr: SocketAddr,
    ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>,
    is_https: bool,
) -> Result<Response<Body>, Infallible> {
    if let Some(gate) = access_gate() {
        match gate.enforce(req, peer_addr, ban_tx.clone(), is_https).await {
            GateOutcome::Allow(request) => req = request,
            GateOutcome::Respond(response) => return Ok(response),
        }
    }

    let host = normalized_request_host(&req);
    let host_without_port = host.as_str();

    let raw_uri_path = req.uri().path();
    let uri_path_string = normalize_uri_path(raw_uri_path);
    let uri_path = uri_path_string.as_str();

    let is_staging_vps = std::env::var("STAGING_MODE").unwrap_or_default() == "true";

    // Una instalación de producción puede reenviar el dominio de staging si
    // configura explícitamente el destino. En staging y desarrollo se sirve
    // la aplicación local y nunca se depende de una IP privada codificada.
    let staging_domains = std::env::var("STAGING_DOMAINS")
        .or_else(|_| std::env::var("STAGING_DOMAIN"))
        .unwrap_or_else(|_| "ragenodes.dev,panel.ragenodes.dev".to_string())
        .split(',')
        .map(|domain| domain.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect::<Vec<_>>();
    if !is_staging_vps
        && staging_domains
            .iter()
            .any(|domain| domain == host_without_port)
    {
        if let Ok(staging_target) = std::env::var("STAGING_UPSTREAM") {
            let staging_target = staging_target.trim();
            if !staging_target.is_empty() {
                tracing::info!("Petición Staging detectada. Redirigiendo a destino configurado...");
                let mut response =
                    reverse_proxy_request(req, staging_target.to_string(), None, peer_addr).await?;
                response.extensions_mut().insert(TrustedStagingUpstream);
                return Ok(response);
            }
        }
    }

    tracing::debug!(
        "Petición HTTP L7: Host: '{}', Path: '{}' (Raw: '{}')",
        host,
        uri_path,
        raw_uri_path
    );

    let forwarded_request =
        req.headers().contains_key("x-forwarded-for") || req.headers().contains_key("forwarded");
    if is_admin_surface(uri_path) && (!is_private_admin_peer(peer_addr.ip()) || forwarded_request) {
        tracing::warn!(
            "Bloqueado acceso no local a superficie administrativa: Peer='{}', Host='{}', Path='{}'",
            peer_addr.ip(), host, uri_path
        );
        return Ok(forbidden_admin_response());
    }

    if uri_path == "/pma/doc" || uri_path.starts_with("/pma/doc/") {
        return Ok(not_found_response());
    }

    // 1. Enrutamiento virtual sin túneles por nombres deterministas. El dominio
    // y los rangos se restringen por configuración para impedir que OxideProxy
    // pueda utilizarse como proxy abierto hacia cualquier puerto del host.
    let txadmin_start = env_port("OXIDE_TXADMIN_PORT_START", 40100);
    let txadmin_end = env_port("OXIDE_TXADMIN_PORT_END", 49999);
    if let Some(port) = dynamic_proxy_port(host_without_port, "tx", txadmin_start, txadmin_end) {
        tracing::debug!(
            "Virtual Host coincide con FiveM txAdmin (puerto {}). Reenviando al backend...",
            port
        );
        prepare_public_proxy_request(&mut req, host_without_port, is_https);
        let mut response = reverse_proxy_request(
            req,
            dynamic_backend_addr(host_without_port, port),
            None,
            peer_addr,
        )
        .await?;
        response.extensions_mut().insert(AllowRageNodesPanelFraming);
        return Ok(response);
    }

    let blender_start = env_port("OXIDE_BLENDER_PORT_START", 50100);
    let blender_end = env_port("OXIDE_BLENDER_PORT_END", 59999);
    if let Some(port) = dynamic_proxy_port(host_without_port, "blender", blender_start, blender_end)
    {
        tracing::debug!(
            "Virtual Host coincide con Blender Web (puerto {}). Reenviando al backend...",
            port
        );
        prepare_public_proxy_request(&mut req, host_without_port, is_https);
        let mut response = reverse_proxy_request(
            req,
            dynamic_backend_addr(host_without_port, port),
            None,
            peer_addr,
        )
        .await?;
        response.extensions_mut().insert(AllowRageNodesPanelFraming);
        response.extensions_mut().insert(AllowBlenderApp);
        return Ok(response);
    }

    // 1b. txAdmin por subdominio estable del servidor (ej. s3a5ee6de.ragenodes.com).
    // RageNodes guarda estos hosts por server_id corto; el puerto txAdmin de FiveM
    // se asigna como puerto de juego + 10000.
    if host_without_port.starts_with('s') && host_without_port.ends_with(".ragenodes.com") {
        if let Some(short_id) = host_without_port
            .strip_prefix('s')
            .and_then(|s| s.split('.').next())
            .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            if let Some(route) = config.routing.game_servers.iter().find(|route| {
                route
                    .backend_addr
                    .contains(&format!("ragenodes-{}", short_id))
            }) {
                let txadmin_port = route.game_id.saturating_add(10000);
                tracing::debug!(
                    "Virtual Host coincide con servidor {}. Reenviando txAdmin al puerto {}...",
                    short_id,
                    txadmin_port
                );
                prepare_public_proxy_request(&mut req, host_without_port, is_https);
                let mut response = reverse_proxy_request(
                    req,
                    dynamic_backend_addr(host_without_port, txadmin_port),
                    None,
                    peer_addr,
                )
                .await?;
                response.extensions_mut().insert(AllowRageNodesPanelFraming);
                return Ok(response);
            }
        }
    }

    // 1c. WordPress por subdominio estable (ej. w3a5ee6de.ragenodes.com)
    if host_without_port.starts_with('w') && host_without_port.ends_with(".ragenodes.com") {
        if let Some(short_id) = host_without_port
            .strip_prefix('w')
            .and_then(|s| s.split('.').next())
            .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            if let Some(route) = config.routing.game_servers.iter().find(|route| {
                route
                    .backend_addr
                    .contains(&format!("ragenodes-{}", short_id))
            }) {
                let wp_port = route.game_id;
                tracing::debug!(
                    "Virtual Host coincide con WordPress {}. Reenviando al puerto HTTP {}...",
                    short_id,
                    wp_port
                );
                return reverse_proxy_request(
                    req,
                    format!("127.0.0.1:{}", wp_port),
                    None,
                    peer_addr,
                )
                .await;
            }
        }
    }

    // 2. Enrutamiento API de Oxide Control Panel (`/api/oxide/...`)
    if uri_path.starts_with("/api/oxide") {
        tracing::debug!(
            "Enrutando petición API Oxide L7 al contenedor oxide_control_panel:3000..."
        );
        return reverse_proxy_request(req, "oxide_control_panel:3000".to_string(), None, peer_addr)
            .await;
    }

    // 2a. Enrutamiento Panel de Control Interno (OxideProxy Dashboard)
    if uri_path.starts_with("/oxide") {
        tracing::debug!(
            "Enrutando petición al Panel de Control Oxide (oxide_control_panel:3000)..."
        );
        let mut response = reverse_proxy_request(
            req,
            "oxide_control_panel:3000".to_string(),
            Some("/oxide"),
            peer_addr,
        )
        .await?;
        response.extensions_mut().insert(AllowSameOriginFraming);
        return Ok(response);
    }

    // 2b. Enrutamiento dinámico para el Editor 3D Blender (`/blender/<short_id>/...`)
    if uri_path.starts_with("/blender/") {
        let parts: Vec<&str> = uri_path.split('/').collect();
        if parts.len() >= 3 {
            let short_id = parts[2];
            if short_id.len() == 8 && short_id.chars().all(|c| c.is_ascii_hexdigit()) {
                let blender_start = env_port("OXIDE_BLENDER_PORT_START", 50100);
                let blender_end = env_port("OXIDE_BLENDER_PORT_END", 59999);
                let published_port = req.uri().query().and_then(|query| {
                    url::form_urlencoded::parse(query.as_bytes())
                        .find(|(key, _)| key == "port")
                        .and_then(|(_, value)| value.parse::<u16>().ok())
                        .filter(|port| *port >= blender_start && *port <= blender_end)
                });
                let target_addr = published_port
                    .map(|port| dynamic_backend_addr(host_without_port, port))
                    .unwrap_or_else(|| format!("ragenodes-blender-{}:3000", short_id));
                tracing::debug!(
                    "Enrutando petición Blender al backend validado {}...",
                    target_addr
                );
                let mut response = reverse_proxy_request(req, target_addr, None, peer_addr).await?;
                response.extensions_mut().insert(AllowSameOriginFraming);
                response.extensions_mut().insert(AllowBlenderApp);
                return Ok(response);
            }
        }
    }

    // 2b. Enrutamiento API REST al backend Node.js (`/api/...` o `api.ragenodes.com`)
    if uri_path == "/healthz"
        || uri_path.starts_with("/api")
        || host_without_port.starts_with("api.")
    {
        tracing::debug!("Enrutando petición API/Panel al backend Node.js (backend:3006)...");
        return reverse_proxy_request(req, "backend:3006".to_string(), None, peer_addr).await;
    }

    // 2c. Enrutamiento phpMyAdmin (`/pma/...`)
    if uri_path.starts_with("/pma") {
        tracing::debug!("Enrutando petición phpMyAdmin al contenedor phpmyadmin:80...");
        let mut response =
            reverse_proxy_request(req, "phpmyadmin:80".to_string(), Some("/pma"), peer_addr)
                .await?;
        response.extensions_mut().insert(AllowPhpMyAdminFraming);
        return Ok(response);
    }

    // 3. Servidor de Archivos Estáticos Blindado (Frontend Web)
    serve_static_file(req, "/var/www/frontend", peer_addr, ban_tx).await
}

async fn reverse_proxy_request(
    mut req: Request<Body>,
    target_addr: String,
    strip_prefix: Option<&str>,
    peer_addr: SocketAddr,
) -> Result<Response<Body>, Infallible> {
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("");

    let modified_path = match strip_prefix {
        Some(prefix) => {
            if let Some(stripped) = path_and_query.strip_prefix(prefix) {
                if !stripped.starts_with('/') {
                    format!("/{}", stripped)
                } else {
                    stripped.to_string()
                }
            } else {
                path_and_query.to_string()
            }
        }
        None => path_and_query.to_string(),
    };

    if let Some(prefix) = strip_prefix {
        if let Ok(val) = prefix.parse() {
            req.headers_mut().insert("x-forwarded-prefix", val);
        }
        if let Ok(val) = "http".parse() {
            req.headers_mut().insert("x-forwarded-proto", val);
        }
    }

    let real_ip = peer_addr.ip();

    if let Ok(val) = real_ip.to_string().parse::<hyper::header::HeaderValue>() {
        req.headers_mut().insert("x-forwarded-for", val.clone());
        req.headers_mut().insert("x-real-ip", val);
    }

    let new_uri = format!("http://{}{}", target_addr, modified_path);
    match new_uri.parse::<hyper::Uri>() {
        Ok(uri) => {
            *req.uri_mut() = uri;
            *req.version_mut() = hyper::Version::HTTP_11;

            let is_upgrade = req.headers().contains_key(hyper::header::UPGRADE);
            let req_upgrade = if is_upgrade {
                Some(hyper::upgrade::on(&mut req))
            } else {
                // HTTP/2 prohíbe cabeceras hop-by-hop. El cliente de salida las
                // administra por conexión y nunca deben heredarse del navegador.
                for header in [
                    "connection",
                    "keep-alive",
                    "proxy-connection",
                    "transfer-encoding",
                    "te",
                    "trailer",
                    "upgrade",
                ] {
                    req.headers_mut().remove(header);
                }
                None
            };

            let client = get_proxy_client();
            match client.request(req).await {
                Ok(mut res) => {
                    if res.status() == StatusCode::SWITCHING_PROTOCOLS {
                        if let Some(req_up) = req_upgrade {
                            let res_up = hyper::upgrade::on(&mut res);
                            tokio::spawn(async move {
                                match tokio::try_join!(req_up, res_up) {
                                    Ok((mut client_conn, mut server_conn)) => {
                                        if let Err(e) = tokio::io::copy_bidirectional(
                                            &mut client_conn,
                                            &mut server_conn,
                                        )
                                        .await
                                        {
                                            tracing::debug!(
                                                "WebSocket finalizado con error: {}",
                                                e
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!(
                                            "Fallo al actualizar conexiones WebSocket: {}",
                                            e
                                        );
                                    }
                                }
                            });
                        }
                    } else {
                        // Las respuestas HTTP/2 tampoco pueden transportar
                        // cabeceras hop-by-hop heredadas del upstream HTTP/1.1.
                        for header in [
                            "connection",
                            "keep-alive",
                            "proxy-connection",
                            "transfer-encoding",
                            "te",
                            "trailer",
                            "upgrade",
                        ] {
                            res.headers_mut().remove(header);
                        }
                    }
                    Ok(res)
                }
                Err(err) => {
                    let message = err.to_string();
                    if message.contains("Connection refused")
                        || message.contains("connection refused")
                    {
                        tracing::debug!(
                            "Backend web temporalmente inactivo en {}: {}",
                            target_addr,
                            message
                        );
                    } else {
                        tracing::warn!("Error en Reverse Proxy hacia {}: {}", target_addr, message);
                    }
                    let mut res = Response::new(Body::from("502 Bad Gateway"));
                    *res.status_mut() = StatusCode::BAD_GATEWAY;
                    res.headers_mut().insert(
                        CONTENT_TYPE,
                        HeaderValue::from_static("text/plain; charset=utf-8"),
                    );
                    Ok(res)
                }
            }
        }
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            res.headers_mut().insert(
                CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            Ok(res)
        }
    }
}

async fn serve_static_file(
    req: Request<Body>,
    root_dir: &str,
    peer_addr: SocketAddr,
    ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>,
) -> Result<Response<Body>, Infallible> {
    let mut uri_path = req.uri().path();
    if uri_path == "/" {
        uri_path = "/index.html";
    }

    let decoded_path = match percent_decode_str(uri_path).decode_utf8() {
        Ok(p) => p.into_owned(),
        Err(_) => {
            let mut res = Response::new(Body::from("400 Bad Request"));
            *res.status_mut() = StatusCode::BAD_REQUEST;
            return Ok(res);
        }
    };

    if is_disallowed_static_path(&decoded_path) {
        return Ok(not_found_response());
    }

    let base_path = Path::new(root_dir);
    let mut full_path = base_path.to_path_buf();
    for component in Path::new(&decoded_path).components() {
        match component {
            std::path::Component::Normal(c) => full_path.push(c),
            std::path::Component::ParentDir => {
                if full_path != base_path {
                    full_path.pop();
                }
            }
            _ => {}
        }
    }

    let candidates = vec![
        full_path.clone(),
        full_path.with_extension("html"),
        full_path.join("index.html"),
    ];

    let mut resolved_path = None;
    for candidate in candidates {
        if candidate.is_file() {
            if let Ok(canon) = candidate.canonicalize() {
                resolved_path = Some(canon);
                break;
            }
        }
    }

    let canonical_full = match resolved_path {
        Some(p) => p,
        None => return Ok(not_found_response()),
    };

    let mime_type = match canonical_full.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };

    let canonical_base = match base_path.canonicalize() {
        Ok(p) => p,
        Err(_) => base_path.to_path_buf(),
    };

    if !canonical_full.starts_with(&canonical_base) {
        tracing::warn!(
            "¡Alerta de Seguridad! Intento de Path Traversal detectado hacia: {:?}",
            canonical_full
        );
        if let Err(e) = ban_tx.send(peer_addr.ip()).await {
            tracing::error!("Fallo al enviar IP al gestor XDP (Fail2Ban): {}", e);
        } else {
            tracing::warn!(
                "Fail2Ban: Petición de baneo enviada al canal eBPF para la IP {}",
                peer_addr.ip()
            );
        }
        let mut res = Response::new(Body::from("403 Forbidden: Path Traversal detectado"));
        *res.status_mut() = StatusCode::FORBIDDEN;
        return Ok(res);
    }

    if !canonical_full.is_file() {
        return Ok(not_found_response());
    }

    let meta = match tokio::fs::metadata(&canonical_full).await {
        Ok(m) => m,
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            return Ok(res);
        }
    };

    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let etag = format!("\"{:x}-{:x}\"", mtime, meta.len());

    let cache_control_value = if mime_type.starts_with("text/html") {
        "no-cache, no-store, must-revalidate"
    } else {
        "public, max-age=31536000, immutable"
    };

    if !mime_type.starts_with("text/html") {
        if let Some(if_none) = req.headers().get(http::header::IF_NONE_MATCH) {
            if if_none.to_str().unwrap_or("") == etag {
                let mut res = Response::new(Body::empty());
                *res.status_mut() = StatusCode::NOT_MODIFIED;
                res.headers_mut().insert(ETAG, etag.parse().unwrap());
                res.headers_mut()
                    .insert(CACHE_CONTROL, cache_control_value.parse().unwrap());
                return Ok(res);
            }
        }
    }

    let mut content = match tokio::fs::read(&canonical_full).await {
        Ok(c) => c,
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            return Ok(res);
        }
    };

    let csp_nonce = if mime_type.starts_with("text/html") {
        let mut random_bytes = [0u8; 18];
        if getrandom::getrandom(&mut random_bytes).is_err() {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            res.headers_mut().insert(
                CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            return Ok(res);
        }
        let nonce = STANDARD_NO_PAD.encode(random_bytes);
        let html = match String::from_utf8(content) {
            Ok(html) => html,
            Err(_) => return Ok(not_found_response()),
        };
        let nonce_attribute = format!(" nonce=\"{}\"", nonce);
        content = html
            .replace("<script", &format!("<script{}", nonce_attribute))
            .replace("<style", &format!("<style{}", nonce_attribute))
            .into_bytes();
        Some(static_page_security_profile(&canonical_full, nonce))
    } else {
        None
    };

    let mut res = Response::new(Body::empty());
    *res.status_mut() = StatusCode::OK;
    res.headers_mut()
        .insert(CONTENT_TYPE, mime_type.parse().unwrap());
    res.headers_mut().insert(ETAG, etag.parse().unwrap());
    res.headers_mut()
        .insert(CACHE_CONTROL, cache_control_value.parse().unwrap());
    if let Some(nonce) = csp_nonce {
        res.extensions_mut().insert(nonce);
    }

    // COMPRESIÓN LOCAL PARA JS Y CSS
    let accept_encoding = req
        .headers()
        .get(ACCEPT_ENCODING)
        .map(|v| v.to_str().unwrap_or(""))
        .unwrap_or("");
    if accept_encoding.contains("gzip")
        && (mime_type.starts_with("text/")
            || mime_type == "application/javascript"
            || mime_type == "application/json")
    {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        if let Ok(_) = encoder
            .write_all(&content)
            .and_then(|_| encoder.finish())
            .map(|compressed| {
                res.headers_mut()
                    .insert(CONTENT_ENCODING, "gzip".parse().unwrap());
                *res.body_mut() = Body::from(compressed);
            })
        {
            return Ok(res);
        }
    }

    *res.body_mut() = Body::from(content);
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::{
        access_gate_csp, apply_browser_security_headers, blender_app_csp, csp_with_frame_ancestors,
        dynamic_proxy_port_for_domains, frame_ancestors_policy, trusted_upstream_csp,
        AllowBlenderApp, AllowRageNodesPanelFraming, AllowSameOriginFraming,
        TrustedStagingUpstream,
    };
    use http::{Response, StatusCode};
    use hyper::Body;

    #[test]
    fn dynamic_hosts_only_resolve_inside_the_allowed_range_and_domain() {
        let domains = vec!["ragenodes.app".to_string(), "ragenodes.dev".to_string()];
        assert_eq!(
            dynamic_proxy_port_for_domains("tx40120.ragenodes.app", "tx", 40100, 49999, &domains,),
            Some(40120)
        );
        assert_eq!(
            dynamic_proxy_port_for_domains("tx40120.ragenodes.dev", "tx", 40100, 49999, &domains,),
            Some(40120)
        );
        assert_eq!(
            dynamic_proxy_port_for_domains("tx22.ragenodes.dev", "tx", 40100, 49999, &domains,),
            None
        );
        assert_eq!(
            dynamic_proxy_port_for_domains(
                "tx40120.attacker.example",
                "tx",
                40100,
                49999,
                &domains,
            ),
            None
        );
    }

    #[test]
    fn access_gate_allows_only_its_configured_panel_redirect() {
        let policy = access_gate_csp(Some("ragenodes.dev"));
        assert!(policy.contains("form-action 'self' https://panel.ragenodes.dev"));
        assert!(!policy.contains("https://*.ragenodes.dev"));

        let unsafe_domain = access_gate_csp(Some("ragenodes.dev; form-action *"));
        assert!(unsafe_domain.contains("form-action 'self';"));
        assert!(!unsafe_domain.contains("form-action *"));
    }

    #[test]
    fn frame_ancestors_is_replaced_without_weakening_other_directives() {
        let result = csp_with_frame_ancestors(
            Some("default-src 'self'; frame-ancestors 'self'; object-src 'none'"),
            "https://ragenodes.dev",
        );
        assert!(result.contains("default-src 'self'"));
        assert!(result.contains("object-src 'none'"));
        assert!(result.contains("frame-ancestors https://ragenodes.dev"));
        assert!(!result.contains("frame-ancestors 'self'"));
    }

    #[test]
    fn configured_frame_ancestors_always_include_same_origin() {
        let policy = frame_ancestors_policy();
        assert!(policy.starts_with("'self' "));
        assert!(policy.contains("https://ragenodes.com"));
        assert!(!policy.contains("*"));
    }

    #[test]
    fn trusted_staging_csp_requires_a_nonce_and_strict_script_attributes() {
        let strict = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; \
            script-src 'nonce-test123' 'strict-dynamic' 'self'; script-src-attr 'none'; \
            style-src 'self'; style-src-attr 'unsafe-inline'";
        assert_eq!(trusted_upstream_csp(Some(strict)).as_deref(), Some(strict));

        let unsafe_policy = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; \
            script-src 'self' 'unsafe-inline'; script-src-attr 'none'";
        assert!(trusted_upstream_csp(Some(unsafe_policy)).is_none());

        let missing_nonce = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; \
            script-src 'self'; script-src-attr 'none'";
        assert!(trusted_upstream_csp(Some(missing_nonce)).is_none());
    }

    #[test]
    fn trusted_staging_html_preserves_its_nonce_bound_csp() {
        let policy = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; \
            script-src 'nonce-test123' 'strict-dynamic' 'self'; script-src-attr 'none'; \
            style-src 'self'; style-src-elem 'self' 'nonce-test123'; \
            style-src-attr 'unsafe-inline'";
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::OK;
        response
            .headers_mut()
            .insert("content-security-policy", policy.parse().unwrap());
        response.extensions_mut().insert(TrustedStagingUpstream);

        apply_browser_security_headers(&mut response, true);

        assert_eq!(
            response
                .headers()
                .get("content-security-policy")
                .and_then(|value| value.to_str().ok()),
            Some(policy)
        );
    }

    #[test]
    fn trusted_staging_marker_does_not_preserve_a_permissive_csp() {
        let mut response = Response::new(Body::empty());
        response.headers_mut().insert(
            "content-security-policy",
            "default-src *; object-src *; frame-ancestors *; script-src 'unsafe-inline'"
                .parse()
                .unwrap(),
        );
        response.extensions_mut().insert(TrustedStagingUpstream);

        apply_browser_security_headers(&mut response, true);

        let policy = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(!policy.contains("script-src 'unsafe-inline'"));
        assert!(policy.contains("object-src 'none'"));
    }

    #[test]
    fn blender_csp_allows_only_the_runtime_features_required_by_the_web_app() {
        let policy = blender_app_csp("'self'");

        assert!(policy.contains("frame-ancestors 'self'"));
        assert!(policy.contains("script-src 'self' blob:"));
        assert!(!policy.contains("script-src 'self' 'unsafe-inline'"));
        assert!(!policy.contains("'unsafe-eval'"));
        assert!(policy.contains("style-src 'self' 'unsafe-inline'"));
        assert!(policy.contains("connect-src 'self' data: blob: ws: wss:"));
        assert!(policy.contains("worker-src 'self' blob:"));
        assert!(policy.contains("manifest-src 'self'"));
        assert!(policy.contains("object-src 'none'"));
    }

    #[test]
    fn blender_path_keeps_same_origin_framing_and_uses_scoped_runtime_csp() {
        let mut response = Response::new(Body::empty());
        response.extensions_mut().insert(AllowSameOriginFraming);
        response.extensions_mut().insert(AllowBlenderApp);

        apply_browser_security_headers(&mut response, true);

        let policy = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert_eq!(
            response.headers().get("x-frame-options").unwrap(),
            "SAMEORIGIN"
        );
        assert!(policy.contains("frame-ancestors 'self'"));
        assert!(policy.contains("script-src 'self' blob:"));
    }

    #[test]
    fn blender_virtual_host_can_be_embedded_only_by_configured_ragenodes_panels() {
        let mut response = Response::new(Body::empty());
        response.extensions_mut().insert(AllowRageNodesPanelFraming);
        response.extensions_mut().insert(AllowBlenderApp);

        apply_browser_security_headers(&mut response, true);

        let policy = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(response.headers().get("x-frame-options").is_none());
        assert!(policy.contains("frame-ancestors 'self' https://"));
        assert!(!policy.contains("frame-ancestors *"));
        assert!(policy.contains("object-src 'none'"));
    }
}
