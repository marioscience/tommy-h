import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

/**
 * Función para probar la conexión con un Nodo Remoto (Docker Daemon) vía mTLS.
 * Extrae la CPU y la RAM total del motor de Docker.
 */
export async function testNodeConnection(nodeId, ipAddress) {
    return new Promise(async (resolve, reject) => {
        try {
            // Localizar los certificados del nodo
            const certsDir = path.join(config.projectRoot, 'certs');
            const caPath = path.join(certsDir, 'ca', 'ca.pem');
            const certPath = path.join(certsDir, 'nodes', String(nodeId), 'cert.pem');
            const keyPath = path.join(certsDir, 'nodes', String(nodeId), 'key.pem');

            // Leer los archivos de certificado
            const [ca, cert, key] = await Promise.all([
                fs.readFile(caPath),
                fs.readFile(certPath),
                fs.readFile(keyPath)
            ]);

            const options = {
                hostname: ipAddress,
                port: 2376, // Puerto seguro por defecto de Docker
                path: '/info',
                method: 'GET',
                ca: ca,
                cert: cert,
                key: key,
                rejectUnauthorized: true, // Forzar la validación mTLS
                timeout: 5000 // Timeout de 5 segundos
            };

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Docker API respondió con código: ${res.statusCode}`));
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        // Convertir memoria de bytes a GB enteros (aprox)
                        const ramTotalGb = Math.round(info.MemTotal / (1024 * 1024 * 1024));
                        const cpuCores = info.NCPU;

                        resolve({
                            status: 'active',
                            cpuCores: cpuCores,
                            ramTotalGb: ramTotalGb,
                            dockerVersion: info.ServerVersion
                        });
                    } catch (err) {
                        reject(new Error('Error al parsear respuesta JSON de Docker.'));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`No se pudo conectar al Nodo: ${e.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout al intentar conectar con el Nodo.'));
            });

            req.end();
        } catch (e) {
            reject(new Error(`Certificados no encontrados o inválidos: ${e.message}`));
        }
    });
}
