import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { getSafePath } from '../src/services/remoteDownloadWorker.js';

describe('🛡️ Security & Path Traversal Defensive Tests', () => {
    it('debería permitir rutas válidas dentro del directorio base', () => {
        const base = path.resolve('/srv/data/srv-1');
        const safePath = getSafePath(base, 'server.cfg');
        assert.equal(safePath, path.join(base, 'server.cfg'));

        const nestedPath = getSafePath(base, 'resources/my-mod/fxmanifest.lua');
        assert.equal(nestedPath, path.join(base, 'resources', 'my-mod', 'fxmanifest.lua'));
    });

    it('debería bloquear estrictamente ataques de Path Traversal (../)', () => {
        const base = path.resolve('/srv/data/srv-1');
        
        assert.throws(() => {
            getSafePath(base, '../../etc/passwd');
        }, /Intento de Path Traversal detectado/);

        assert.throws(() => {
            getSafePath(base, '../srv-2/database.db');
        }, /Intento de Path Traversal detectado/);

        assert.throws(() => {
            getSafePath(base, '..\\..\\Windows\\System32');
        }, /Intento de Path Traversal detectado/);
    });

    it('debería validar rangos de red prohibidos para SSRF (Loopback, Link-Local, Private IPs)', () => {
        const isForbiddenRemoteAddress = (address) => {
            const normalized = String(address || '').toLowerCase().split('%')[0];
            if (normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1') return true;
            if (normalized.startsWith('10.') || normalized.startsWith('192.168.') || normalized.startsWith('169.254.')) return true;
            return false;
        };

        assert.equal(isForbiddenRemoteAddress('127.0.0.1'), true, 'Debe bloquear localhost');
        assert.equal(isForbiddenRemoteAddress('169.254.169.254'), true, 'Debe bloquear AWS metadata IP');
        assert.equal(isForbiddenRemoteAddress('192.168.1.1'), true, 'Debe bloquear IP privada local');
        assert.equal(isForbiddenRemoteAddress('8.8.8.8'), false, 'Debe permitir IP pública');
    });

    it('debería rechazar producción cuando faltan secretos obligatorios', () => {
        const environment = {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: '',
            JWT_SECRET: '',
            API_KEY: '',
            CENTRAL_DB_PASS: '',
            ADMIN_BOOTSTRAP_USER: '',
            ADMIN_BOOTSTRAP_PASS: '',
            COOKIE_SECURE: 'true',
            PUBLIC_BASE_URL: 'https://ragenodes.test',
            CORS_ORIGIN: 'https://ragenodes.test',
            DOCKER_SOCKET: '/run/user/1000/docker.sock',
            ALLOW_ROOTFUL_DOCKER_SOCKET: 'false',
            ALLOW_INSECURE_DOCKER_NODES: 'false',
            PAYPAL_WEBHOOKS_ENABLED: 'false'
        };
        const result = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                "import('./src/config.js').then(({ assertSecureConfig }) => assertSecureConfig())"
            ],
            { cwd: process.cwd(), env: environment, encoding: 'utf8' }
        );
        const output = `${result.stdout}\n${result.stderr}`;

        assert.notEqual(result.status, 0);
        for (const name of ['DATABASE_URL', 'JWT_SECRET', 'API_KEY', 'CENTRAL_DB_PASS']) {
            assert.match(output, new RegExp(name));
        }
    });
});
