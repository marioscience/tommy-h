use rcgen::{generate_simple_self_signed, CertifiedKey};
use std::fs::{create_dir_all, File};
use std::io::Write;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("[OxideProxy] Generando certificados auto-firmados de prueba de alto rendimiento...");
    let subject_alt_names = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "0.0.0.0".to_string(),
    ];
    let CertifiedKey { cert, signing_key } = generate_simple_self_signed(subject_alt_names)?;

    let cert_dir = Path::new("config/certs");
    create_dir_all(cert_dir)?;

    let cert_path = cert_dir.join("cert.pem");
    let key_path = cert_dir.join("key.pem");

    let mut cert_file = File::create(&cert_path)?;
    cert_file.write_all(cert.pem().as_bytes())?;

    let mut key_file = File::create(&key_path)?;
    key_file.write_all(signing_key.serialize_pem().as_bytes())?;

    println!("[OxideProxy] ¡Certificados generados exitosamente en config/certs/!");
    println!(" - Certificado: {}", cert_path.display());
    println!(" - Llave Privada: {}", key_path.display());

    Ok(())
}
