#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use napi::threadsafe_function::{ThreadsafeFunction, ErrorStrategy, ThreadsafeFunctionCallMode};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufReader, Read, Seek};
use std::path::{Component, Path};
use zip::ZipArchive;
use jwalk::WalkDir;
use sha2::{Digest, Sha256};

// Removed Jemalloc due to initial-exec TLS conflict with Alpine musl

// --- Helper para convertir anyhow::Error a napi::Error ---
fn map_err<E: std::fmt::Display>(e: E) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, e.to_string())
}

#[derive(Deserialize)]
struct DockerStats {
    cpu_stats: CpuStats,
    precpu_stats: Option<CpuStats>,
    memory_stats: MemoryStats,
    networks: Option<std::collections::HashMap<String, NetworkStats>>,
}

#[derive(Deserialize)]
struct NetworkStats {
    rx_bytes: u64,
    tx_bytes: u64,
}

#[derive(Deserialize)]
struct CpuStats {
    cpu_usage: CpuUsage,
    system_cpu_usage: Option<u64>,
    online_cpus: Option<u64>,
}

#[derive(Deserialize)]
struct CpuUsage {
    total_usage: u64,
}

#[derive(Deserialize)]
struct MemoryStats {
    usage: Option<u64>,
    limit: Option<u64>,
    stats: Option<MemoryInnerStats>,
}

#[derive(Deserialize)]
struct MemoryInnerStats {
    inactive_file: Option<u64>,
}

#[napi(object)]
#[derive(Serialize)]
pub struct StatsResult {
    pub cpu: String,
    pub ram: String,
    pub ram_gb: String,
    pub net_rx: String,
    pub net_tx: String,
}

fn unzip_validated(source: &str, dest: &str, max_expanded_bytes: u64) -> Result<()> {
    let file = fs::File::open(source).map_err(map_err)?;
    let mut archive = ZipArchive::new(file).map_err(map_err)?;
    fs::create_dir_all(dest).map_err(map_err)?;
    let mut expanded_bytes = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(map_err)?;
        let relative = entry.enclosed_name().ok_or_else(|| {
            napi::Error::new(napi::Status::InvalidArg, "ZIP contiene una ruta no permitida")
        })?;
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err(napi::Error::new(napi::Status::InvalidArg, "ZIP contiene un enlace simbolico"));
        }
        expanded_bytes = expanded_bytes.checked_add(entry.size()).ok_or_else(|| {
            napi::Error::new(napi::Status::InvalidArg, "Tamano expandido fuera de rango")
        })?;
        if expanded_bytes > max_expanded_bytes {
            return Err(napi::Error::new(napi::Status::InvalidArg, "ZIP excede el almacenamiento disponible"));
        }

        let output = Path::new(dest).join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(map_err)?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(map_err)?;
            }
            let mut target = fs::File::create(output).map_err(map_err)?;
            io::copy(&mut entry, &mut target).map_err(map_err)?;
        }
    }
    Ok(())
}

#[napi]
pub async fn unzip_file(source: String, dest: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        unzip_validated(&source, &dest, u64::MAX)
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn unzip_file_validated(source: String, dest: String, max_expanded_bytes: f64) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        if !max_expanded_bytes.is_finite() || max_expanded_bytes < 0.0 || max_expanded_bytes > u64::MAX as f64 {
            return Err(napi::Error::new(napi::Status::InvalidArg, "Limite ZIP invalido"));
        }
        unzip_validated(&source, &dest, max_expanded_bytes as u64)
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn sha256_file(file_path: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(file_path).map_err(map_err)?;
        let mut reader = BufReader::with_capacity(1024 * 1024, file);
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 1024 * 1024];
        loop {
            let read = reader.read(&mut buffer).map_err(map_err)?;
            if read == 0 { break; }
            hasher.update(&buffer[..read]);
        }
        Ok::<String, napi::Error>(format!("{:x}", hasher.finalize()))
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn get_dir_size(path: String) -> Result<f64> {
    tokio::task::spawn_blocking(move || {
        let total_size: u64 = WalkDir::new(&path)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                if entry.file_type.is_file() {
                    entry.metadata().ok().map(|m| m.len())
                } else {
                    None
                }
            })
            .sum();
        Ok(total_size as f64)
    })
    .await
    .map_err(map_err)?
}

#[napi]
fn calculate_stats_inner(mut json: String) -> Result<StatsResult> {
    let mut bytes = unsafe { json.as_mut_vec() };
    let stats: DockerStats = simd_json::from_slice(&mut bytes).map_err(map_err)?;

    let mut cpu_percent = 0.0;
    let cpu_total = stats.cpu_stats.cpu_usage.total_usage;
    let pre_cpu_total = stats.precpu_stats.as_ref().map(|s| s.cpu_usage.total_usage).unwrap_or(0);
    
    let system_total = stats.cpu_stats.system_cpu_usage.unwrap_or(0);
    let pre_system_total = stats.precpu_stats.as_ref().and_then(|s| s.system_cpu_usage).unwrap_or(0);

    let cpu_delta = cpu_total as i64 - pre_cpu_total as i64;
    let system_delta = system_total as i64 - pre_system_total as i64;

    if system_delta > 0 && cpu_delta > 0 {
        let online_cpus = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;
        cpu_percent = (cpu_delta as f64 / system_delta as f64) * online_cpus * 100.0;
    }

    let mut mem_usage = stats.memory_stats.usage.unwrap_or(0);
    let inactive_file = stats.memory_stats.stats.and_then(|s| s.inactive_file).unwrap_or(0);
    
    if mem_usage > inactive_file {
        mem_usage -= inactive_file;
    } else {
        mem_usage = 0;
    }

    let mem_limit = stats.memory_stats.limit.unwrap_or(1);
    let mem_percent = (mem_usage as f64 / mem_limit as f64) * 100.0;
    let mem_gb = mem_usage as f64 / (1024.0 * 1024.0 * 1024.0);

    let mut net_rx = 0;
    let mut net_tx = 0;
    if let Some(nets) = stats.networks {
        for net in nets.values() {
            net_rx += net.rx_bytes;
            net_tx += net.tx_bytes;
        }
    }

    Ok(StatsResult {
        cpu: format!("{:.1}", cpu_percent),
        ram: format!("{:.1}", mem_percent),
        ram_gb: format!("{:.2}", mem_gb),
        net_rx: net_rx.to_string(),
        net_tx: net_tx.to_string(),
    })
}

#[napi]
pub fn calculate_stats(json: String) -> Result<StatsResult> {
    calculate_stats_inner(json)
}

#[napi]
pub fn calculate_stats_batch(json_items: Vec<String>) -> Result<Vec<StatsResult>> {
    json_items.into_iter().map(calculate_stats_inner).collect()
}

#[napi]
pub async fn patch_html(file_path: String, style_tag: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let content = fs::read_to_string(&file_path).map_err(map_err)?;
        
        if content.contains(&style_tag) {
            return Ok(());
        }
        
        // Optimización: búsqueda case-insensitive sin to_lowercase() para evitar allocations
        let bytes = content.as_bytes();
        let target = b"</head>";
        let mut found_idx = None;
        
        for i in 0..=bytes.len().saturating_sub(target.len()) {
            if bytes[i..i+target.len()].eq_ignore_ascii_case(target) {
                found_idx = Some(i);
                break;
            }
        }
        
        if let Some(idx) = found_idx {
            let mut patched = String::with_capacity(content.len() + style_tag.len());
            patched.push_str(&content[..idx]);
            patched.push_str(&style_tag);
            patched.push_str(&content[idx..]);
            
            fs::write(&file_path, patched).map_err(map_err)?;
        } else {
            return Err(napi::Error::new(napi::Status::GenericFailure, "No se encontró la etiqueta </head> en el archivo.".to_string()));
        }
        
        Ok::<(), napi::Error>(())
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn compress_dir(source_dir: String, output_file: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let file = fs::File::create(&output_file).map_err(map_err)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        for entry in WalkDir::new(&source_dir).into_iter().flatten() {
            let path = entry.path();
            let name = path.strip_prefix(Path::new(&source_dir)).map_err(map_err)?;

            if path.is_file() {
                zip.start_file(name.to_string_lossy(), options).map_err(map_err)?;
                let mut f = fs::File::open(path).map_err(map_err)?;
                io::copy(&mut f, &mut zip).map_err(map_err)?;
            } else if !name.as_os_str().is_empty() {
                zip.add_directory(name.to_string_lossy(), options).map_err(map_err)?;
            }
        }
        
        zip.finish().map_err(map_err)?;
        Ok::<(), napi::Error>(())
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn tar_gz_dir(source_dir: String, output_file: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let tar_gz = fs::File::create(&output_file).map_err(map_err)?;
        let enc = flate2::write::GzEncoder::new(tar_gz, flate2::Compression::default());
        let mut tar = tar::Builder::new(enc);

        tar.append_dir_all(".", &source_dir).map_err(map_err)?;
        tar.finish().map_err(map_err)?;
        Ok::<(), napi::Error>(())
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn tail_file(file_path: String, lines_count: u32) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let mut file = fs::File::open(&file_path).map_err(map_err)?;
        let file_size = file.metadata().map_err(map_err)?.len();
        
        if file_size == 0 || lines_count == 0 {
            return Ok("".to_string());
        }

        let chunk_size = 8192;
        let mut chunk = vec![0; chunk_size];
        let mut pos = file_size;
        let mut newlines_found = 0;

        while pos > 0 {
            let to_read = std::cmp::min(chunk_size as u64, pos) as usize;
            pos -= to_read as u64;
            
            file.seek(io::SeekFrom::Start(pos)).map_err(map_err)?;
            file.read_exact(&mut chunk[..to_read]).map_err(map_err)?;

            for i in (0..to_read).rev() {
                if chunk[i] == b'\n' {
                    if pos + i as u64 == file_size - 1 {
                        continue;
                    }
                    newlines_found += 1;
                    
                    if newlines_found == lines_count {
                        let start_pos = pos + i as u64 + 1;
                        let mut result = String::new();
                        file.seek(io::SeekFrom::Start(start_pos)).map_err(map_err)?;
                        file.read_to_string(&mut result).map_err(map_err)?;
                        return Ok(result);
                    }
                }
            }
        }

        file.seek(io::SeekFrom::Start(0)).map_err(map_err)?;
        let mut result = String::new();
        file.read_to_string(&mut result).map_err(map_err)?;
        Ok(result)
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn zstd_dir(source_dir: String, output_file: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let zst = fs::File::create(&output_file).map_err(map_err)?;
        let mut enc = zstd::stream::write::Encoder::new(zst, 3).map_err(map_err)?;
        enc.multithread(0).map_err(map_err)?; 
        let mut tar = tar::Builder::new(enc.auto_finish());

        tar.append_dir_all(".", &source_dir).map_err(map_err)?;
        tar.finish().map_err(map_err)?;
        Ok::<(), napi::Error>(())
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn unzstd_dir(source_file: String, output_dir: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let zst = fs::File::open(&source_file).map_err(map_err)?;
        let dec = zstd::stream::read::Decoder::new(zst).map_err(map_err)?;
        let mut tar = tar::Archive::new(dec);
        fs::create_dir_all(&output_dir).map_err(map_err)?;
        for entry in tar.entries().map_err(map_err)? {
            let mut entry = entry.map_err(map_err)?;
            let entry_type = entry.header().entry_type();
            if entry_type.is_symlink() || entry_type.is_hard_link() {
                return Err(napi::Error::new(napi::Status::InvalidArg, "Backup contiene enlaces no permitidos"));
            }
            let relative = entry.path().map_err(map_err)?.into_owned();
            if relative.components().any(|part| !matches!(part, Component::Normal(_) | Component::CurDir)) {
                return Err(napi::Error::new(napi::Status::InvalidArg, "Backup contiene una ruta no permitida"));
            }
            if !entry.unpack_in(&output_dir).map_err(map_err)? {
                return Err(napi::Error::new(napi::Status::InvalidArg, "No se pudo extraer una ruta de forma segura"));
            }
        }
        Ok::<(), napi::Error>(())
    })
    .await
    .map_err(map_err)?
}

#[napi]
pub async fn clean_zombies(valid_names_json: String) -> Result<()> {
    use bollard::Docker;
    use bollard::container::{ListContainersOptions, RemoveContainerOptions, StopContainerOptions};
    use std::collections::HashSet;

    let valid_names: Vec<String> = serde_json::from_str(&valid_names_json)
        .map_err(map_err)?;
    let valid_set: HashSet<String> = valid_names.into_iter().collect();

    let docker = Docker::connect_with_local_defaults()
        .map_err(map_err)?;

    let options = Some(ListContainersOptions::<String> {
        all: true,
        ..Default::default()
    });

    let containers = docker.list_containers(options).await.map_err(map_err)?;
    let mut zombies_found = 0;

    for c in containers {
        if let Some(names) = c.names {
            if let Some(name) = names.first() {
                let clean_name = name.trim_start_matches('/');
                if clean_name.starts_with("ragenodes-") && clean_name.len() == 18 {
                    if !valid_set.contains(clean_name) {
                        zombies_found += 1;
                        if let Some(id) = c.id {
                            println!("⚠️ [Rust] Contenedor ZOMBIE detectado: {} (ID: {}). Procediendo a su purga nativa...", clean_name, &id[..std::cmp::min(12, id.len())]);
                            let _ = docker.stop_container(&id, None::<StopContainerOptions>).await;
                            match docker.remove_container(&id, Some(RemoveContainerOptions { force: true, ..Default::default() })).await {
                                Ok(_) => println!("✅ [Rust] Contenedor zombie {} purgado con éxito.", clean_name),
                                Err(e) => eprintln!("❌ [Rust] Error purgando {}: {}", clean_name, e),
                            }
                        }
                    }
                }
            }
        }
    }

    if zombies_found == 0 {
        println!("✨ [Rust] No se encontraron contenedores zombies.");
    } else {
        println!("🎉 [Rust] Purga completada. Se eliminaron {} servidores zombies huerfanos.", zombies_found);
    }

    Ok(())
}

#[napi]
pub fn stream_docker_events(callback: ThreadsafeFunction<String, ErrorStrategy::Fatal>) -> Result<()> {
    tokio::spawn(async move {
        use bollard::Docker;
        use bollard::system::EventsOptions;
        use futures_util::stream::StreamExt;
        use std::collections::HashMap;

        if let Ok(docker) = Docker::connect_with_local_defaults() {
            let mut filters = HashMap::new();
            filters.insert("type".to_string(), vec!["container".to_string()]);
            filters.insert("event".to_string(), vec!["start".to_string(), "die".to_string(), "stop".to_string(), "oom".to_string(), "health_status".to_string()]);

            let options = Some(EventsOptions {
                since: None,
                until: None,
                filters,
            });

            let mut stream = docker.events(options);

            while let Some(event_result) = stream.next().await {
                if let Ok(event) = event_result {
                    if let Ok(json) = serde_json::to_string(&event) {
                        callback.call(json, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                }
            }
        }
    });
    
    Ok(())
}
