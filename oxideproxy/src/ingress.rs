use crate::config::ProxyConfig;
use crate::ebpf_xdp::XdpFilter;
use crate::pipeline::tls_quic::TlsRuntime;
use crate::pipeline::{process_tcp_stream, process_udp_packet_inline};
use bytes::BytesMut;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use tokio::net::{TcpListener, UdpSocket};

pub async fn start_ingress(
    config: ProxyConfig,
    worker_threads: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let tls_runtime = Arc::new(
        TlsRuntime::initialize(&config.tls.cert_path, &config.tls.key_path)
            .await
            .map_err(|err| format!("No se pudo inicializar TLS: {err}"))?,
    );
    let config_arc = Arc::new(config);
    let tcp_addr = config_arc.ingress.tcp_listen_addr;
    let udp_addr = config_arc.ingress.udp_listen_addr;
    let initial_buf_size = config_arc.ingress.initial_buffer_size;

    let mut xdp = XdpFilter::new("eth0");
    xdp.reload_from_config("config/oxide_proxy.yml");
    let _ = xdp.attach();
    let xdp_arc = Arc::new(RwLock::new(xdp));

    // --- MPSC Fail2Ban Channel ---
    let (ban_tx, mut ban_rx) = tokio::sync::mpsc::channel::<std::net::IpAddr>(1024);

    let consumer_xdp_arc = Arc::clone(&xdp_arc);
    tokio::spawn(async move {
        tracing::info!("[Fail2Ban] Consumidor MPSC asíncrono iniciado para baneos L7->L4.");
        while let Some(ip) = ban_rx.recv().await {
            if let Ok(xdp_read) = consumer_xdp_arc.read() {
                xdp_read.block_ip(ip);
                tracing::warn!(
                    "[eBPF/XDP] IP {} bloqueada permanentemente (Fail2Ban L7).",
                    ip
                );
            }
        }
    });

    let xdp_reload = Arc::clone(&xdp_arc);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if let Ok(mut xdp_write) = xdp_reload.write() {
                xdp_write.reload_from_config("config/oxide_proxy.yml");
            }
        }
    });

    let mut handles = Vec::new();

    let tcp_config = Arc::clone(&config_arc);
    let tcp_xdp = Arc::clone(&xdp_arc);
    let tcp_ban_tx = ban_tx.clone();
    let tcp_tls_runtime = Arc::clone(&tls_runtime);
    let tcp_handle = tokio::spawn(async move {
        tracing::info!(
            "Ingress TCP Principal escuchando en {} con SO_REUSEPORT",
            tcp_addr
        );
        match create_reuseport_tcp_listener(tcp_addr) {
            Ok(listener) => loop {
                match listener.accept().await {
                    Ok((mut stream, peer_addr)) => {
                        let allowed = if let Ok(xdp_read) = tcp_xdp.read() {
                            xdp_read.inspect_and_filter(peer_addr.ip())
                        } else {
                            true
                        };
                        if !allowed {
                            continue;
                        }
                        tracing::debug!("Conexion TCP aceptada de {}", peer_addr);
                        let cfg = Arc::clone(&tcp_config);
                        let ban_sender = tcp_ban_tx.clone();
                        let tls = Arc::clone(&tcp_tls_runtime);
                        tokio::spawn(async move {
                            let mut buffer = BytesMut::with_capacity(initial_buf_size);
                            match tokio::io::AsyncReadExt::read_buf(&mut stream, &mut buffer).await
                            {
                                Ok(0) => {
                                    tracing::debug!("Conexion cerrada por el cliente {}", peer_addr)
                                }
                                Ok(_) => {
                                    process_tcp_stream(
                                        stream, buffer, cfg, None, false, ban_sender, tls,
                                    )
                                    .await
                                }
                                Err(e) => tracing::error!("Error leyendo de {}: {}", peer_addr, e),
                            }
                        });
                    }
                    Err(e) => tracing::error!("Error aceptando conexion TCP: {}", e),
                }
            },
            Err(e) => tracing::error!(
                "Fallo al vincular Ingress TCP Principal en {}: {}",
                tcp_addr,
                e
            ),
        }
    });
    handles.push(tcp_handle);

    for http_addr in [
        "0.0.0.0:80".parse::<SocketAddr>().unwrap(),
        "0.0.0.0:8088".parse::<SocketAddr>().unwrap(),
    ] {
        let http_config = Arc::clone(&config_arc);
        let http_xdp = Arc::clone(&xdp_arc);
        let http_ban_tx = ban_tx.clone();
        let http_tls_runtime = Arc::clone(&tls_runtime);
        let http_handle = tokio::spawn(async move {
            tracing::info!(
                "Ingress TCP HTTP Principal escuchando en {} con SO_REUSEPORT",
                http_addr
            );
            match create_reuseport_tcp_listener(http_addr) {
                Ok(listener) => loop {
                    match listener.accept().await {
                        Ok((mut stream, peer_addr)) => {
                            let allowed = if let Ok(xdp_read) = http_xdp.read() {
                                xdp_read.inspect_and_filter(peer_addr.ip())
                            } else {
                                true
                            };
                            if !allowed {
                                continue;
                            }
                            tracing::debug!("Conexion HTTP TCP aceptada de {}", peer_addr);
                            let cfg = Arc::clone(&http_config);
                            let ban_sender = http_ban_tx.clone();
                            let tls = Arc::clone(&http_tls_runtime);
                            tokio::spawn(async move {
                                let mut buffer = BytesMut::with_capacity(initial_buf_size);
                                match tokio::io::AsyncReadExt::read_buf(&mut stream, &mut buffer)
                                    .await
                                {
                                    Ok(0) => tracing::debug!(
                                        "Conexion cerrada por el cliente {}",
                                        peer_addr
                                    ),
                                    Ok(_) => {
                                        process_tcp_stream(
                                            stream, buffer, cfg, None, true, ban_sender, tls,
                                        )
                                        .await
                                    }
                                    Err(e) => {
                                        tracing::error!("Error leyendo de {}: {}", peer_addr, e)
                                    }
                                }
                            });
                        }
                        Err(e) => tracing::error!("Error aceptando conexion HTTP TCP: {}", e),
                    }
                },
                Err(e) => {
                    tracing::error!("Fallo al vincular Ingress TCP HTTP en {}: {}", http_addr, e)
                }
            }
        });
        handles.push(http_handle);
    }

    tracing::info!(
        "Iniciando {} bucles Ingress UDP Principal independientes con SO_REUSEPORT en {}",
        worker_threads,
        udp_addr
    );
    for i in 0..worker_threads {
        let udp_config = Arc::clone(&config_arc);
        let udp_xdp = Arc::clone(&xdp_arc);
        let handle = tokio::spawn(async move {
            match create_reuseport_udp_socket(udp_addr) {
                Ok(socket) => {
                    let socket_arc = Arc::new(socket);
                    tracing::debug!("Bucle UDP Ingress Principal #{} vinculado exitosamente.", i);
                    let mut buffer = BytesMut::with_capacity(64 * 1024);
                    loop {
                        if buffer.capacity() < initial_buf_size {
                            buffer.reserve(64 * 1024);
                        }
                        let sock = Arc::clone(&socket_arc);
                        let cfg = Arc::clone(&udp_config);
                        let xdp_ref = Arc::clone(&udp_xdp);
                        match sock.recv_buf_from(&mut buffer).await {
                            Ok((size, peer_addr)) => {
                                let allowed = if let Ok(xdp_read) = xdp_ref.read() {
                                    xdp_read.inspect_and_filter(peer_addr.ip())
                                } else {
                                    true
                                };
                                if !allowed {
                                    let _ = buffer.split_to(size);
                                    continue;
                                }
                                let packet_data = buffer.split_to(size).freeze();
                                process_udp_packet_inline(sock, packet_data, peer_addr, cfg, None)
                                    .await;
                            }
                            Err(e) => tracing::error!("Error en bucle UDP Principal #{}: {}", i, e),
                        }
                    }
                }
                Err(e) => tracing::error!(
                    "Fallo al vincular Ingress UDP Principal #{} en {}: {}",
                    i,
                    udp_addr,
                    e
                ),
            }
        });
        handles.push(handle);
    }

    for route in &config_arc.routing.game_servers {
        let backend_addr = route.backend_addr.clone();
        let backend_port = backend_addr
            .rsplit_once(':')
            .and_then(|(_, port)| port.parse::<u16>().ok())
            .unwrap_or(route.game_id);
        let port = match route.port_range.as_deref() {
            Some(p_str) => p_str.parse::<u16>().unwrap_or(backend_port),
            None => backend_port,
        };

        if port == tcp_addr.port() || port == udp_addr.port() {
            tracing::debug!("Saltando binding dedicado para puerto {} (ya cubierto por los listeners principales).", port);
            continue;
        }

        let proto = route.protocol.as_deref().unwrap_or("DUAL").to_uppercase();
        let listen_ip = tcp_addr.ip();
        let custom_addr = SocketAddr::new(listen_ip, port);
        let route_name = route
            .name
            .clone()
            .unwrap_or_else(|| format!("GameID {}", route.game_id));

        if proto == "TCP" || proto == "DUAL" {
            let tcp_cfg = Arc::clone(&config_arc);
            let tcp_xdp = Arc::clone(&xdp_arc);
            let tcp_ban_tx = ban_tx.clone();
            let dedicated_tls_runtime = Arc::clone(&tls_runtime);
            let r_name = route_name.clone();
            let backend = backend_addr.clone();
            let h = tokio::spawn(async move {
                tracing::info!(
                    "Ingress TCP Dedicado para [{}] escuchando en {} -> {}",
                    r_name,
                    custom_addr,
                    backend
                );
                match create_reuseport_tcp_listener(custom_addr) {
                    Ok(listener) => loop {
                        match listener.accept().await {
                            Ok((mut stream, peer_addr)) => {
                                let allowed = if let Ok(xdp_read) = tcp_xdp.read() {
                                    xdp_read.inspect_and_filter(peer_addr.ip())
                                } else {
                                    true
                                };
                                if !allowed {
                                    continue;
                                }
                                let cfg = Arc::clone(&tcp_cfg);
                                let backend_for_conn = backend.clone();
                                let ban_sender = tcp_ban_tx.clone();
                                let tls = Arc::clone(&dedicated_tls_runtime);
                                tokio::spawn(async move {
                                    let mut buffer = BytesMut::with_capacity(initial_buf_size);
                                    match tokio::io::AsyncReadExt::read_buf(
                                        &mut stream,
                                        &mut buffer,
                                    )
                                    .await
                                    {
                                        Ok(0) => {}
                                        Ok(_) => {
                                            process_tcp_stream(
                                                stream,
                                                buffer,
                                                cfg,
                                                Some(backend_for_conn),
                                                false,
                                                ban_sender,
                                                tls,
                                            )
                                            .await
                                        }
                                        Err(e) => tracing::error!(
                                            "Error leyendo TCP de {}: {}",
                                            peer_addr,
                                            e
                                        ),
                                    }
                                });
                            }
                            Err(e) => tracing::error!(
                                "Error aceptando conexion TCP dedicado en {}: {}",
                                custom_addr,
                                e
                            ),
                        }
                    },
                    Err(e) => tracing::error!(
                        "Fallo al vincular Ingress TCP Dedicado en {}: {}",
                        custom_addr,
                        e
                    ),
                }
            });
            handles.push(h);
        }

        if proto == "UDP" || proto == "DUAL" {
            for i in 0..worker_threads {
                let udp_cfg = Arc::clone(&config_arc);
                let udp_xdp = Arc::clone(&xdp_arc);
                let r_name = route_name.clone();
                let backend = backend_addr.clone();
                let h = tokio::spawn(async move {
                    match create_reuseport_udp_socket(custom_addr) {
                        Ok(socket) => {
                            let socket_arc = Arc::new(socket);
                            tracing::debug!(
                                "Bucle UDP Dedicado #{} para [{}] vinculado en {}",
                                i,
                                r_name,
                                custom_addr
                            );
                            let mut buffer = BytesMut::with_capacity(64 * 1024);
                            loop {
                                if buffer.capacity() < initial_buf_size {
                                    buffer.reserve(64 * 1024);
                                }
                                let sock = Arc::clone(&socket_arc);
                                let cfg = Arc::clone(&udp_cfg);
                                let xdp_ref = Arc::clone(&udp_xdp);
                                match sock.recv_buf_from(&mut buffer).await {
                                    Ok((size, peer_addr)) => {
                                        let allowed = if let Ok(xdp_read) = xdp_ref.read() {
                                            xdp_read.inspect_and_filter(peer_addr.ip())
                                        } else {
                                            true
                                        };
                                        if !allowed {
                                            let _ = buffer.split_to(size);
                                            continue;
                                        }
                                        let packet_data = buffer.split_to(size).freeze();
                                        process_udp_packet_inline(
                                            sock,
                                            packet_data,
                                            peer_addr,
                                            cfg,
                                            Some(backend.clone()),
                                        )
                                        .await;
                                    }
                                    Err(e) => {
                                        tracing::error!("Error en bucle UDP Dedicado #{}: {}", i, e)
                                    }
                                }
                            }
                        }
                        Err(e) => tracing::error!(
                            "Fallo al vincular Ingress UDP Dedicado #{} en {}: {}",
                            i,
                            custom_addr,
                            e
                        ),
                    }
                });
                handles.push(h);
            }
        }
    }

    for handle in handles {
        let _ = handle.await;
    }

    Ok(())
}

fn create_reuseport_tcp_listener(addr: SocketAddr) -> Result<TcpListener, std::io::Error> {
    let domain = match addr {
        SocketAddr::V4(_) => Domain::IPV4,
        SocketAddr::V6(_) => Domain::IPV6,
    };
    let socket = Socket::new(domain, Type::STREAM, Some(Protocol::TCP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&addr.into())?;
    socket.listen(1024)?;

    let std_listener: std::net::TcpListener = socket.into();
    TcpListener::from_std(std_listener)
}

fn create_reuseport_udp_socket(addr: SocketAddr) -> Result<UdpSocket, std::io::Error> {
    let domain = match addr {
        SocketAddr::V4(_) => Domain::IPV4,
        SocketAddr::V6(_) => Domain::IPV6,
    };
    let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&addr.into())?;

    let std_socket: std::net::UdpSocket = socket.into();
    UdpSocket::from_std(std_socket)
}
