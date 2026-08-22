import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query, logAudit } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getServerByIdForUser } from '../services/serverService.js';
import { rustUtil } from '../utils/rustUtil.js';
import {
    activeDownloads,
    storageCache,
    getSafePath,
    isVaultProtected,
    getStorageAllowance,
    checkStorageLimit,
    validateRemoteTargetUrl,
    ensureDownloadJobsTable,
    jobToTask
} from '../services/remoteDownloadWorker.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/ragenodes_uploads/' });

function validateZipArchive(filePath, destination, remainingBytes = 10 * 1024 * 1024 * 1024) {
    const destinationRoot = path.resolve(destination);
    const archive = new (require('adm-zip'))(filePath);
    let expandedBytes = 0;
    for (const entry of archive.getEntries()) {
        const resolvedEntry = path.resolve(destinationRoot, entry.entryName);
        if (resolvedEntry !== destinationRoot && !resolvedEntry.startsWith(`${destinationRoot}${path.sep}`)) {
            throw new Error('El archivo ZIP contiene rutas de escape no permitidas.');
        }
        const unixMode = (Number(entry.header?.attr || 0) >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
            throw new Error('El archivo ZIP contiene enlaces simbolicos no permitidos.');
        }
        expandedBytes += Number(entry.header?.size || 0);
        if (expandedBytes > remainingBytes) {
            throw new Error('La descompresion del ZIP excede el almacenamiento restante disponible.');
        }
    }
}

router.get('/list', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.query.path || '/';
        const targetPath = getSafePath(row.data_path, reqPath);
        const items = await fsPromises.readdir(targetPath, { withFileTypes: true });
        
        let formatted = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.join(reqPath, item.name)
        }));

        if (reqPath.includes('[market]')) {
            formatted = formatted.filter(item => {
                if (item.isDirectory) return true;
                return !isVaultProtected(path.join(reqPath, item.name));
            });
        }

        formatted.sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
        res.json({ items: formatted });
    } catch(e) { res.status(500).json({error: "Error listando el directorio: " + e.message}); }
});

router.get('/read', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.query.path || 'server.cfg';
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault Protection: Archivo fuente protegido. Solo se pueden editar archivos de configuracion.' });
        }
        
        const targetPath = getSafePath(row.data_path, reqPath);
        const content = await fsPromises.readFile(targetPath, 'utf8');
        res.json({ content });
    } catch(e) { res.status(500).json({error: `Error de lectura: ${e.message}`}); }
});

router.put('/write', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.body.path || 'server.cfg';
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault Protection: No puedes editar el codigo fuente de este script.' });
        }

        await checkStorageLimit(row, 1024 * 1024);
        const targetPath = getSafePath(row.data_path, reqPath);
        await fsPromises.writeFile(targetPath, req.body.content, 'utf8');
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({error: e.message || "Error guardando el archivo"});
    }
});

router.post('/action', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
        const reqPath = req.body.path;
        if (isVaultProtected(reqPath)) {
            return res.status(403).json({ error: 'Vault Protection: Accion denegada en archivo protegido.' });
        }

        const targetPath = getSafePath(row.data_path, reqPath);

        if (req.body.action === 'mkdir') {
            await fsPromises.mkdir(targetPath, { recursive: true });
        }
        else if (req.body.action === 'delete') {
            await fsPromises.rm(targetPath, { recursive: true, force: true });
        }
        else if (req.body.action === 'createFile') {
            await fsPromises.writeFile(targetPath, '', 'utf8');
        }
        else if (req.body.action === 'rename') {
            if (!req.body.newName) throw new Error("Nuevo nombre no proporcionado");
            const baseDir = path.dirname(targetPath);
            const newPathRelative = path.join(path.dirname(reqPath), req.body.newName);
            
            if (reqPath.includes('[market]') && !newPathRelative.includes('[market]')) {
                return res.status(403).json({ error: 'Vault Protection: No puedes mover recursos del mercado fuera de su carpeta protegida.' });
            }

            const newPath = getSafePath(baseDir, req.body.newName);
            await fsPromises.rename(targetPath, newPath);
        }
        else if (req.body.action === 'move') {
            if (!req.body.newPath) throw new Error("Ruta de destino no proporcionada");
            
            if (reqPath.includes('[market]') && !req.body.newPath.includes('[market]')) {
                return res.status(403).json({ error: 'Vault Protection: No puedes mover recursos del mercado fuera de su carpeta protegida.' });
            }

            const newPath = getSafePath(row.data_path, req.body.newPath);
            await fsPromises.mkdir(path.dirname(newPath), { recursive: true });
            await fsPromises.rename(targetPath, newPath);
        }
        else if (req.body.action === 'unzip') {
             const extractDir = path.dirname(targetPath);
             const allowance = await getStorageAllowance(row, true);
             validateZipArchive(targetPath, extractDir, allowance.remainingBytes);
             const result = await rustUtil.unzip(targetPath, extractDir);
             if (!result.success) throw new Error(`Fallo en descompresion nativa: ${result.error}`);
             storageCache.delete(row.id);
             await checkStorageLimit(row, 0, true);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message || "Error ejecutando la accion"}); }
});

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    if(!req.file) return res.status(400).json({error: "No hay archivo"});
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) {
        await fsPromises.unlink(req.file.path).catch(()=>{});
        return res.status(404).json({ error: 'No encontrado' });
    }

    try {
        await checkStorageLimit(row, req.file.size);

        const targetPath = getSafePath(row.data_path, req.body.path);
        await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
        await fsPromises.copyFile(req.file.path, targetPath);
        await fsPromises.unlink(req.file.path);
        res.json({ success: true });
    } catch(e) {
        await fsPromises.unlink(req.file.path).catch(()=>{});
        res.status(500).json({error: e.message || "Error subiendo archivo."});
    }
});

router.post('/upload-chunk', requireAuth, upload.single('file'), async (req, res) => {
    if(!req.file) return res.status(400).json({error: "No hay archivo"});
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined) return res.status(400).json({error: "Faltan parametros de chunk"});
    
    try {
        const chunkPath = path.join('/tmp/ragenodes_uploads', `${uploadId}.part${chunkIndex}`);
        await fsPromises.rename(req.file.path, chunkPath);
        res.json({ success: true });
    } catch(e) {
        await fsPromises.unlink(req.file.path).catch(()=>{});
        res.status(500).json({error: e.message || "Error subiendo chunk."});
    }
});

router.post('/upload-finish', requireAuth, async (req, res) => {
    const { uploadId, totalChunks, serverId, path: destPath, fileName, totalSize } = req.body;
    
    const row = await getServerByIdForUser(serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    try {
        if (totalSize) await checkStorageLimit(row, Number(totalSize));

        const targetPath = getSafePath(row.data_path, destPath);
        const finalPath = getSafePath(path.dirname(targetPath), fileName);
        await fsPromises.mkdir(path.dirname(finalPath), { recursive: true });

        const writeStream = createWriteStream(finalPath, { flags: 'w' });
        
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join('/tmp/ragenodes_uploads', `${uploadId}.part${i}`);
            const data = await fsPromises.readFile(chunkPath);
            writeStream.write(data);
            await fsPromises.unlink(chunkPath).catch(()=>{}); 
        }
        
        writeStream.end();
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        res.json({ success: true });
    } catch(e) {
        for (let i = 0; i < totalChunks; i++) {
            await fsPromises.unlink(path.join('/tmp/ragenodes_uploads', `${uploadId}.part${i}`)).catch(()=>{});
        }
        res.status(500).json({error: e.message || "Error finalizando subida."});
    }
});

router.get('/download', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).send('No encontrado');
    try {
        const reqPath = req.query.path;
        if (isVaultProtected(reqPath)) {
            return res.status(403).send('Vault Protection: Descarga del codigo fuente bloqueada.');
        }

        const targetPath = getSafePath(row.data_path, reqPath);
        res.download(targetPath);
    } catch (e) { res.status(400).send("Bad request"); }
});

router.get('/download-folder', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).send('No encontrado');
    try {
        const reqPath = req.query.path || '';
        if (reqPath.includes('[market]') || reqPath.endsWith('resources') || reqPath === '/' || reqPath === '') {
            return res.status(403).send('Vault Protection: No puedes descargar esta carpeta porque contiene codigo fuente protegido.');
        }

        const targetPath = getSafePath(row.data_path, reqPath);
        const folderName = path.basename(targetPath) || 'carpeta';

        const tempZipPath = `/tmp/RageNodes_${Date.now()}_${folderName}.zip`;
        const result = await rustUtil.compress(targetPath, tempZipPath);

        if (!result.success) throw new Error("Fallo en la compresion nativa.");

        res.download(tempZipPath, `${folderName}.zip`, (err) => {
            fsPromises.unlink(tempZipPath).catch(() => {});
        });
    } catch (e) {
        res.status(500).send("Error empaquetando carpeta. Detalle: " + e.message);
    }
});

router.get('/download-status', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.query.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    const { rows } = await query(`
        SELECT *
        FROM download_jobs
        WHERE server_id = $1
          AND created_at > NOW() - INTERVAL '24 hours'
          AND (status IN ('queued', 'retry', 'running') OR finished_at > NOW() - INTERVAL '10 minutes' OR (is_error = true AND updated_at > NOW() - INTERVAL '1 minute'))
        ORDER BY created_at DESC
        LIMIT 20
    `, [row.id]);
    const tasks = rows.map(jobToTask);
    for (const task of activeDownloads.values()) {
        if (task.serverId === row.id && !tasks.find(t => t.id === task.id)) tasks.unshift(task);
    }
    res.json({ tasks });
});

router.post('/download-remote', requireAuth, async (req, res) => {
    const row = await getServerByIdForUser(req.body.serverId, req.user.sub, req.user.role === 'admin', 'files');
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    try {
        if (!req.body.url || !req.body.fileName) {
            return res.status(400).json({ error: 'URL y nombre de archivo son obligatorios.' });
        }

        await validateRemoteTargetUrl(req.body.url);

        const targetDir = getSafePath(row.data_path, req.body.path || '/');
        getSafePath(targetDir, req.body.fileName);

        const taskId = `dl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await ensureDownloadJobsTable();
        const { rows } = await query(`
            INSERT INTO download_jobs (id, server_id, user_id, url, target_path, file_name, status, status_message, progress)
            VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'En cola...', 0)
            RETURNING *
        `, [taskId, row.id, req.user.sub, req.body.url, req.body.path || '/', req.body.fileName]);

        activeDownloads.set(taskId, jobToTask(rows[0]));
        res.json({ success: true, taskId, message: "Descarga encolada. Puedes ver el progreso en la esquina inferior derecha." });
    } catch(e) {
        res.status(500).json({ error: e.message || 'Error encolando descarga remota.' });
    }
});

export default router;
