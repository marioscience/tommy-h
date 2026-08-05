use crate::config::ProxyConfig;
use bytes::Bytes;

use http::header::{ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_TYPE, ETAG, HOST};
use http::{Request, Response, StatusCode};
use hyper::{service::service_fn, Body};
use percent_encoding::percent_decode_str;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use flate2::write::GzEncoder;
use flate2::Compression;

fn host_without_port(host: &str) -> &str {
    host.split(':').next().unwrap_or(host)
}

fn is_local_admin_host(host: &str) -> bool {
    let host = host_without_port(host).trim().to_ascii_lowercase();
    host.is_empty()
        || host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host.starts_with("192.168.")
        || host.starts_with("10.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.20.")
        || host.starts_with("172.21.")
        || host.starts_with("172.22.")
        || host.starts_with("172.23.")
        || host.starts_with("172.24.")
        || host.starts_with("172.25.")
        || host.starts_with("172.26.")
        || host.starts_with("172.27.")
        || host.starts_with("172.28.")
        || host.starts_with("172.29.")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.")
}

fn normalize_uri_path(path: &str) -> String {
    let mut current_path = path.to_string();
    let mut iterations = 0;
    loop {
        if iterations > 3 {
            break; // Prevención de DoS por bucle infinito
        }
        let decoded = percent_decode_str(&current_path).decode_utf8_lossy().into_owned();
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
        || path.starts_with("/oxide") // 🛡️ AÑADIDO: Proteger Oxide Panel
}

fn forbidden_admin_response() -> Response<Body> {
    let mut res = Response::new(Body::from("403 Forbidden: admin panel is only available from the local network"));
    *res.status_mut() = StatusCode::FORBIDDEN;
    res
}


pub async fn serve_http_connection<S>(stream: S, config: Arc<ProxyConfig>, peer_addr: SocketAddr, ban_tx: tokio::sync::mpsc::Sender<std::net::IpAddr>)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |req| {
        let cfg = Arc::clone(&config);
        let tx = ban_tx.clone();
        async move { handle_http_request(req, cfg, peer_addr, tx).await }
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
        .unwrap_or("");

    let raw_uri_path = req.uri().path();
    let uri_path_string = normalize_uri_path(raw_uri_path);
    let uri_path = uri_path_string.as_str();
    
    tracing::debug!("Petición HTTP L7: Host: '{}', Path: '{}' (Raw: '{}')", host, uri_path, raw_uri_path);

    if is_admin_surface(uri_path) && !is_local_admin_host(host) {
        tracing::warn!("Bloqueado acceso público al panel admin: Host='{}', Path='{}'", host, uri_path);
        if let Err(e) = ban_tx.send(peer_addr.ip()).await {
            tracing::error!("Fallo al enviar IP al gestor XDP (Fail2Ban): {}", e);
        } else {
            tracing::warn!("Fail2Ban: Petición de baneo enviada al canal eBPF para la IP {}", peer_addr.ip());
        }
        return Ok(forbidden_admin_response());
    }

    // 1. Enrutamiento Virtual Host & SNI para Servidores de Juego (ej. tx40121.node1.ragenodes.com)
    if host.contains(".node1.ragenodes.com") || host.starts_with("tx") || host.starts_with("blender") {
        if let Some(port_str) = host.strip_prefix("tx").and_then(|s| s.split('.').next()) {
            if let Ok(port) = port_str.parse::<u16>() {
                tracing::debug!("Virtual Host coincide con FiveM txAdmin (puerto {}). Reenviando al backend...", port);
                return reverse_proxy_request(req, format!("127.0.0.1:{}", port), None, peer_addr).await;
            }
        }
        if let Some(port_str) = host.strip_prefix("blender").and_then(|s| s.split('.').next()) {
            if let Ok(port) = port_str.parse::<u16>() {
                tracing::debug!("Virtual Host coincide con Blender Web (puerto {}). Reenviando al backend...", port);
                return reverse_proxy_request(req, format!("127.0.0.1:{}", port), None, peer_addr).await;
            }
        }
    }

    // 1b. txAdmin por subdominio estable del servidor (ej. s3a5ee6de.ragenodes.com).
    // RageNodes guarda estos hosts por server_id corto; el puerto txAdmin de FiveM
    // se asigna como puerto de juego + 10000.
    if host.starts_with('s') && host.ends_with(".ragenodes.com") {
        if let Some(short_id) = host
            .strip_prefix('s')
            .and_then(|s| s.split('.').next())
            .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            if let Some(route) = config
                .routing
                .game_servers
                .iter()
                .find(|route| route.backend_addr.contains(&format!("ragenodes-{}", short_id)))
            {
                let txadmin_port = route.game_id.saturating_add(10000);
                tracing::debug!(
                    "Virtual Host coincide con servidor {}. Reenviando txAdmin al puerto {}...",
                    short_id,
                    txadmin_port
                );
                return reverse_proxy_request(req, format!("127.0.0.1:{}", txadmin_port), None, peer_addr).await;
            }
        }
    }

    // 1c. WordPress por subdominio estable (ej. w3a5ee6de.ragenodes.com)
    if host.starts_with('w') && host.ends_with(".ragenodes.com") {
        if let Some(short_id) = host
            .strip_prefix('w')
            .and_then(|s| s.split('.').next())
            .filter(|s| s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            if let Some(route) = config
                .routing
                .game_servers
                .iter()
                .find(|route| route.backend_addr.contains(&format!("ragenodes-{}", short_id)))
            {
                let wp_port = route.game_id;
                tracing::debug!(
                    "Virtual Host coincide con WordPress {}. Reenviando al puerto HTTP {}...",
                    short_id,
                    wp_port
                );
                return reverse_proxy_request(req, format!("127.0.0.1:{}", wp_port), None, peer_addr).await;
            }
        }
    }

    // 2. Enrutamiento API de Oxide Control Panel (`/api/oxide/...`)
    if uri_path.starts_with("/api/oxide") {
        tracing::debug!("Enrutando petición API Oxide L7 al contenedor oxide_control_panel:3000...");
        return reverse_proxy_request(req, "oxide_control_panel:3000".to_string(), None, peer_addr).await;
    }

    // 2a. Enrutamiento Panel de Control Interno (OxideProxy Dashboard)
    if uri_path.starts_with("/oxide") {
        tracing::debug!("Enrutando petición al Panel de Control Oxide (oxide_control_panel:3000)...");
        return reverse_proxy_request(req, "oxide_control_panel:3000".to_string(), Some("/oxide"), peer_addr).await;
    }

    // 2b. Enrutamiento dinámico para el Editor 3D Blender (`/blender/<short_id>/...`)
    if uri_path.starts_with("/blender/") {
        let parts: Vec<&str> = uri_path.split('/').collect();
        if parts.len() >= 3 {
            let short_id = parts[2];
            if short_id.len() == 8 && short_id.chars().all(|c| c.is_ascii_hexdigit()) {
                let target_addr = format!("ragenodes-blender-{}:3000", short_id);
                tracing::debug!("Enrutando petición Blender al contenedor {}...", target_addr);
                return reverse_proxy_request(req, target_addr, None, peer_addr).await;
            }
        }
    }

    // 2b. Enrutamiento API REST al backend Node.js (`/api/...` o `api.ragenodes.com`)
    if uri_path.starts_with("/api") || host.starts_with("api.") {
        tracing::debug!("Enrutando petición API/Panel al backend Node.js (backend:3006)...");
        return reverse_proxy_request(req, "backend:3006".to_string(), None, peer_addr).await;
    }

    // 2c. Enrutamiento phpMyAdmin (`/pma/...`)
    if uri_path.starts_with("/pma") {
        tracing::debug!("Enrutando petición phpMyAdmin al contenedor phpmyadmin:80...");
        return reverse_proxy_request(req, "phpmyadmin:80".to_string(), Some("/pma"), peer_addr).await;
    }

    // 2d. Enrutamiento Oxide Control Panel L7 (`/oxide/...`)
    if uri_path.starts_with("/oxide") {
        tracing::debug!("Enrutando petición Oxide L7 al contenedor oxide_control_panel:3000...");
        return reverse_proxy_request(req, "oxide_control_panel:3000".to_string(), Some("/oxide"), peer_addr).await;
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
        if let Ok(val) = prefix.parse() { req.headers_mut().insert("x-forwarded-prefix", val); }
        if let Ok(val) = "http".parse() { req.headers_mut().insert("x-forwarded-proto", val); }
    }
    
    let mut real_ip = peer_addr.ip().to_string();
    if let Some(cf_ip) = req.headers().get("cf-connecting-ip") {
        if let Ok(cf_ip_str) = cf_ip.to_str() { real_ip = cf_ip_str.to_string(); }
    } else if let Some(xfwd) = req.headers().get("x-forwarded-for") {
        if let Ok(xfwd_str) = xfwd.to_str() {
            if let Some(first) = xfwd_str.split(',').next() { real_ip = first.trim().to_string(); }
        }
    }
    
    if let Ok(val) = real_ip.parse::<hyper::header::HeaderValue>() {
        req.headers_mut().insert("x-forwarded-for", val.clone());
        req.headers_mut().insert("x-real-ip", val);
    }

    let new_uri = format!("http://{}{}", target_addr, modified_path);
    match new_uri.parse::<hyper::Uri>() {
        Ok(uri) => {
            *req.uri_mut() = uri;

            let is_upgrade = req.headers().contains_key(hyper::header::UPGRADE);
            let req_upgrade = if is_upgrade {
                Some(hyper::upgrade::on(&mut req))
            } else {
                None
            };

            let client = hyper::Client::new();
            match client.request(req).await {
                Ok(mut res) => {
                    if res.status() == StatusCode::SWITCHING_PROTOCOLS {
                        if let Some(req_up) = req_upgrade {
                            let res_up = hyper::upgrade::on(&mut res);
                            tokio::spawn(async move {
                                match tokio::try_join!(req_up, res_up) {
                                    Ok((mut client_conn, mut server_conn)) => {
                                        if let Err(e) = tokio::io::copy_bidirectional(&mut client_conn, &mut server_conn).await {
                                            tracing::debug!("WebSocket finalizado con error: {}", e);
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!("Fallo al actualizar conexiones WebSocket: {}", e);
                                    }
                                }
                            });
                        }
                    }
                    Ok(res)
                }
                Err(err) => {
                    tracing::error!("Error en Reverse Proxy hacia {}: {}", target_addr, err);
                    let mut res = Response::new(Body::from(format!("502 Bad Gateway: {}", err)));
                    *res.status_mut() = StatusCode::BAD_GATEWAY;
                    Ok(res)
                }
            }
        }
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error: URI inválida"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
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
        base_path.join("index.html"),
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
        None => {
            let mut res = Response::new(Body::from("404 Not Found"));
            *res.status_mut() = StatusCode::NOT_FOUND;
            return Ok(res);
        }
    };

    let mime_type = match canonical_full.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
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
        tracing::warn!("¡Alerta de Seguridad! Intento de Path Traversal detectado hacia: {:?}", canonical_full);
        if let Err(e) = ban_tx.send(peer_addr.ip()).await {
            tracing::error!("Fallo al enviar IP al gestor XDP (Fail2Ban): {}", e);
        } else {
            tracing::warn!("Fail2Ban: Petición de baneo enviada al canal eBPF para la IP {}", peer_addr.ip());
        }
        let mut res = Response::new(Body::from("403 Forbidden: Path Traversal detectado"));
        *res.status_mut() = StatusCode::FORBIDDEN;
        return Ok(res);
    }

    if !canonical_full.is_file() {
        let mut res = Response::new(Body::from("404 Not Found"));
        *res.status_mut() = StatusCode::NOT_FOUND;
        return Ok(res);
    }

    let meta = match tokio::fs::metadata(&canonical_full).await {
        Ok(m) => m,
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            return Ok(res);
        }
    };

    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let etag = format!("\"{:x}-{:x}\"", mtime, meta.len());

    let cache_control_value = if mime_type.starts_with("text/html") {
        "no-cache, no-store, must-revalidate"
    } else {
        "public, max-age=31536000, immutable"
    };

    if let Some(if_none) = req.headers().get(http::header::IF_NONE_MATCH) {
        if if_none.to_str().unwrap_or("") == etag {
            let mut res = Response::new(Body::empty());
            *res.status_mut() = StatusCode::NOT_MODIFIED;
            res.headers_mut().insert(ETAG, etag.parse().unwrap());
            res.headers_mut().insert(CACHE_CONTROL, cache_control_value.parse().unwrap());
            return Ok(res);
        }
    }

    let content = match tokio::fs::read(&canonical_full).await {
        Ok(c) => c,
        Err(_) => {
            let mut res = Response::new(Body::from("500 Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            return Ok(res);
        }
    };

    let mut res = Response::new(Body::empty());
    *res.status_mut() = StatusCode::OK;
    res.headers_mut().insert(CONTENT_TYPE, mime_type.parse().unwrap());
    res.headers_mut().insert(ETAG, etag.parse().unwrap());
    res.headers_mut().insert(CACHE_CONTROL, cache_control_value.parse().unwrap());

    // COMPRESIÓN LOCAL PARA JS Y CSS
    let accept_encoding = req.headers().get(ACCEPT_ENCODING).map(|v| v.to_str().unwrap_or("")).unwrap_or("");
    if accept_encoding.contains("gzip") && (mime_type.starts_with("text/") || mime_type == "application/javascript" || mime_type == "application/json") {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        if let Ok(_) = encoder.write_all(&content).and_then(|_| encoder.finish()).map(|compressed| {
            res.headers_mut().insert(CONTENT_ENCODING, "gzip".parse().unwrap());
            *res.body_mut() = Body::from(compressed);
        }) {
            return Ok(res);
        }
    }

    *res.body_mut() = Body::from(content);
    Ok(res)
}
