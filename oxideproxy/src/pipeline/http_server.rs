use crate::config::ProxyConfig;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use flate2::write::GzEncoder;
use flate2::Compression;
use http::header::{
    HeaderName, HeaderValue, ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_TYPE, ETAG,
    HOST,
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
            .keep_alive(true)
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
    let allow_same_origin_framing = response.extensions().get::<AllowSameOriginFraming>().is_some();
    let allow_pma_framing = response.extensions().get::<AllowPhpMyAdminFraming>().is_some();
    let headers = response.headers_mut();
    headers.remove("server");
    headers.remove("x-powered-by");
    headers.remove("content-security-policy");
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
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("SAMEORIGIN"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
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
    // COOP header omitted to prevent Chrome untrustworthy origin warnings on HTTP IP environments
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("cross-origin"),
    );
    headers.remove("cross-origin-embedder-policy");
    let csp = if let Some(profile) = page_security.as_ref() {
        let third_party = "img-src * 'self' data: blob: https: http:; connect-src * 'self' ws: wss: https: http:; frame-src 'self' https: http:;";
        format!(
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self' *; form-action 'self'; script-src 'nonce-{}' 'unsafe-inline' 'self' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-elem 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; font-src 'self' https: http: data:; {} worker-src 'self' blob:; manifest-src 'self'",
            profile.nonce, third_party
        )
    } else if allow_same_origin_framing {
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self' *; form-action 'self'; script-src 'self' 'unsafe-inline' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-elem 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; font-src 'self' https: http: data:; img-src * 'self' data: blob: https: http:; connect-src * 'self' ws: wss: https: http:; frame-src 'self' https: http:; worker-src 'none'; manifest-src 'none'".to_string()
    } else if allow_pma_framing {
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self' *; form-action 'self'; script-src 'self' 'unsafe-inline' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-elem 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; font-src 'self' https: http: data:; img-src * 'self' data: blob: https: http:; connect-src * 'self' ws: wss: https: http:; frame-src 'self' https: http:; worker-src 'self' blob:; manifest-src 'self'".to_string()
    } else {
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self' *; form-action 'self'; script-src 'self' 'unsafe-inline' https: http:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https: http:; style-src-elem 'self' 'unsafe-inline' https: http:; style-src-attr 'unsafe-inline'; font-src 'self' https: http: data:; img-src * 'self' data: blob: https: http:; connect-src * 'self' ws: wss: https: http:; frame-src 'self' https: http:; worker-src 'self' blob:; manifest-src 'self'".to_string()
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
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |req| {
        let cfg = Arc::clone(&config);
        let tx = ban_tx.clone();
        async move {
            let is_https = req
                .headers()
                .get("x-forwarded-proto")
                .and_then(|v| v.to_str().ok())
                == Some("https")
                || req.headers().contains_key("cf-visitor");
            let mut response = handle_http_request(req, cfg, peer_addr, tx).await?;
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
    req: Request<Body>,
    config: Arc<ProxyConfig>,
    peer_addr: SocketAddr,
    ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>,
) -> Result<Response<Body>, Infallible> {
    let host = req
        .headers()
        .get(HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let host_without_port = host.split(':').next().unwrap_or("");

    let raw_uri_path = req.uri().path();
    let uri_path_string = normalize_uri_path(raw_uri_path);
    let uri_path = uri_path_string.as_str();

    tracing::debug!(
        "Petición HTTP L7: Host: '{}', Path: '{}' (Raw: '{}')",
        host,
        uri_path,
        raw_uri_path
    );

    let forwarded_request = req.headers().contains_key("cf-connecting-ip")
        || req.headers().contains_key("x-forwarded-for")
        || req.headers().contains_key("forwarded");
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

    // Enrutamiento Transparente para Staging (`staging.ragenodes.com` -> `192.168.1.106:80`)
    if host_without_port.starts_with("staging.") || host_without_port == "staging.ragenodes.com" {
        tracing::info!(
            "Petición Staging detectada (Host: '{}'). Redirigiendo transparente a 192.168.1.106:80...",
            host_without_port
        );
        return reverse_proxy_request(req, "192.168.1.106:80".to_string(), None, peer_addr).await;
    }

    // 1. Enrutamiento Virtual Host & SNI para Servidores de Juego (ej. tx40121.node1.ragenodes.com)
    if host_without_port.ends_with(".node1.ragenodes.com") {
        if let Some(port_str) = host_without_port
            .strip_prefix("tx")
            .and_then(|s| s.strip_suffix(".node1.ragenodes.com"))
        {
            if let Ok(port) = port_str.parse::<u16>() {
                tracing::debug!(
                    "Virtual Host coincide con FiveM txAdmin (puerto {}). Reenviando al backend...",
                    port
                );
                return reverse_proxy_request(req, format!("127.0.0.1:{}", port), None, peer_addr)
                    .await;
            }
        }
        if let Some(port_str) = host_without_port
            .strip_prefix("blender")
            .and_then(|s| s.strip_suffix(".node1.ragenodes.com"))
        {
            if let Ok(port) = port_str.parse::<u16>() {
                tracing::debug!(
                    "Virtual Host coincide con Blender Web (puerto {}). Reenviando al backend...",
                    port
                );
                return reverse_proxy_request(req, format!("127.0.0.1:{}", port), None, peer_addr)
                    .await;
            }
        }
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
                return reverse_proxy_request(
                    req,
                    format!("127.0.0.1:{}", txadmin_port),
                    None,
                    peer_addr,
                )
                .await;
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
                let target_addr = format!("ragenodes-blender-{}:3000", short_id);
                tracing::debug!(
                    "Enrutando petición Blender al contenedor {}...",
                    target_addr
                );
                return reverse_proxy_request(req, target_addr, None, peer_addr).await;
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
        let mut response = reverse_proxy_request(
            req,
            "phpmyadmin:80".to_string(),
            Some("/pma"),
            peer_addr,
        )
        .await?;
        response.extensions_mut().insert(AllowPhpMyAdminFraming);
        return Ok(response);
    }

    // 2d. Enrutamiento Oxide Control Panel L7 (`/oxide/...`)
    if uri_path.starts_with("/oxide") {
        tracing::debug!("Enrutando petición Oxide L7 al contenedor oxide_control_panel:3000...");
        return reverse_proxy_request(
            req,
            "oxide_control_panel:3000".to_string(),
            Some("/oxide"),
            peer_addr,
        )
        .await;
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

    let mut real_ip = peer_addr.ip();
    if is_private_admin_peer(peer_addr.ip()) {
        if let Some(cf_ip) = req.headers().get("cf-connecting-ip") {
            if let Ok(cf_ip_str) = cf_ip.to_str() {
                if let Ok(parsed_ip) = cf_ip_str.trim().parse::<IpAddr>() {
                    real_ip = parsed_ip;
                }
            }
        }
    }

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
                    }
                    Ok(res)
                }
                Err(err) => {
                    tracing::error!("Error en Reverse Proxy hacia {}: {}", target_addr, err);
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
