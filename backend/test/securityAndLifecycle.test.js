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
            DISCORD_API_KEY: '',
            NODE_ENROLLMENT_API_KEY: '',
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
        for (const name of ['DATABASE_URL', 'JWT_SECRET', 'DISCORD_API_KEY', 'NODE_ENROLLMENT_API_KEY', 'CENTRAL_DB_PASS']) {
            assert.match(output, new RegExp(name));
        }
    });

    it('debería exigir claves diferentes para Discord y enrolamiento de nodos', () => {
        const sharedKey = 'shared_key_that_must_not_be_reused_123456';
        const environment = {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://user:password@postgres:5432/ragenodes',
            JWT_SECRET: 'local-only-test-jwt-secret-at-least-32-characters',
            DISCORD_API_KEY: sharedKey,
            NODE_ENROLLMENT_API_KEY: sharedKey,
            CENTRAL_DB_PASS: 'production_mariadb_password',
            ADMIN_BOOTSTRAP_USER: '',
            ADMIN_BOOTSTRAP_PASS: '',
            COOKIE_SECURE: 'true',
            PUBLIC_BASE_URL: 'https://ragenodes.com',
            CORS_ORIGIN: 'https://ragenodes.com',
            DOCKER_SOCKET: '/run/user/1000/docker.sock',
            ALLOW_ROOTFUL_DOCKER_SOCKET: 'false',
            ALLOW_INSECURE_DOCKER_NODES: 'false',
            PAYPAL_WEBHOOKS_ENABLED: 'false'
        };
        const result = spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', "import('./src/config.js').then(({ assertSecureConfig }) => assertSecureConfig())"],
            { cwd: process.cwd(), env: environment, encoding: 'utf8' }
        );

        assert.notEqual(result.status, 0);
        assert.match(`${result.stdout}\n${result.stderr}`, /deben ser secretos diferentes/);
    });
});
