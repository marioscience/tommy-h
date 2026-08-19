import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getRagenodesTunnelHostname,
    isHostnameManagedByCurrentEnv,
    partitionIngressRulesByEnv
} from '../src/services/cloudflareService.js';

describe('☁️ Cloudflare Tunnel Namespace Isolation Tests (Seguridad Multi-Entorno)', () => {
    describe('1. Generación de Hostnames con Prefijo de Entorno', () => {
        it('debería generar hostnames limpios para Producción (sin prefijo)', () => {
            const host = getRagenodesTunnelHostname('srv-12345678', 40120, '', 'tx', '');
            assert.equal(host, 'tx40120.ragenodes.com');

            const hostWp = getRagenodesTunnelHostname('srv-12345678', 30100, '', 'wp', '');
            assert.equal(hostWp, 'wp30100.ragenodes.com');
        });

        it('debería generar hostnames prefijados para Staging (staging-)', () => {
            const host = getRagenodesTunnelHostname('srv-12345678', 40120, '', 'tx', 'staging-');
            assert.equal(host, 'staging-tx40120.ragenodes.com');

            const hostWp = getRagenodesTunnelHostname('srv-12345678', 30100, '', 'wp', 'staging-');
            assert.equal(hostWp, 'staging-wp30100.ragenodes.com');
        });

        it('debería generar hostnames prefijados para Dev (dev-)', () => {
            const host = getRagenodesTunnelHostname('srv-12345678', 40120, '', 'tx', 'dev-');
            assert.equal(host, 'dev-tx40120.ragenodes.com');
        });

        it('debería generar URLs completas de txAdmin según el entorno', () => {
            const prodUrl = `https://${getRagenodesTunnelHostname('srv-1', 40120, '', 'tx', '')}/`;
            assert.equal(prodUrl, 'https://tx40120.ragenodes.com/');

            const stagingUrl = `https://${getRagenodesTunnelHostname('srv-1', 40120, '', 'tx', 'staging-')}/`;
            assert.equal(stagingUrl, 'https://staging-tx40120.ragenodes.com/');
        });
    });

    describe('2. Verificación de Pertenencia de Hostname (isHostnameManagedByCurrentEnv)', () => {
        it('Staging NO debe reclamar ni gestionar túneles de Producción ni de Dev', () => {
            const stagingPrefix = 'staging-';
            assert.equal(isHostnameManagedByCurrentEnv('staging-tx40120.ragenodes.com', stagingPrefix), true);
            assert.equal(isHostnameManagedByCurrentEnv('staging.ragenodes.com', stagingPrefix), true);

            // Túneles protegidos que Staging NUNCA debe tocar:
            assert.equal(isHostnameManagedByCurrentEnv('tx40120.ragenodes.com', stagingPrefix), false, 'Staging no debe tocar Prod');
            assert.equal(isHostnameManagedByCurrentEnv('wp30100.ragenodes.com', stagingPrefix), false, 'Staging no debe tocar Prod');
            assert.equal(isHostnameManagedByCurrentEnv('dev-tx40120.ragenodes.com', stagingPrefix), false, 'Staging no debe tocar Dev');
        });

        it('Producción NO debe reclamar ni gestionar túneles de Staging ni de Dev', () => {
            const prodPrefix = '';
            assert.equal(isHostnameManagedByCurrentEnv('tx40120.ragenodes.com', prodPrefix), true);
            assert.equal(isHostnameManagedByCurrentEnv('wp30100.ragenodes.com', prodPrefix), true);

            // Túneles protegidos que Producción NUNCA debe tocar:
            assert.equal(isHostnameManagedByCurrentEnv('staging-tx40120.ragenodes.com', prodPrefix), false, 'Prod no debe tocar Staging');
            assert.equal(isHostnameManagedByCurrentEnv('staging.ragenodes.com', prodPrefix), false, 'Prod no debe tocar Staging legacy');
            assert.equal(isHostnameManagedByCurrentEnv('dev-tx40120.ragenodes.com', prodPrefix), false, 'Prod no debe tocar Dev');
            assert.equal(isHostnameManagedByCurrentEnv('test-tx40120.ragenodes.com', prodPrefix), false, 'Prod no debe tocar Test');
        });
    });

    describe('3. Partición y Limpieza Segura de Túneles (partitionIngressRulesByEnv)', () => {
        const mockIngressRules = [
            { hostname: 'tx40100.ragenodes.com', service: 'http://192.168.1.10:40100' },          // Prod Activo
            { hostname: 'tx40101.ragenodes.com', service: 'http://192.168.1.10:40101' },          // Prod Huérfano
            { hostname: 'staging-tx40200.ragenodes.com', service: 'http://192.168.1.20:40200' },  // Staging Activo
            { hostname: 'staging-tx40201.ragenodes.com', service: 'http://192.168.1.20:40201' },  // Staging Huérfano
            { hostname: 'dev-tx40300.ragenodes.com', service: 'http://127.0.0.1:40300' },          // Dev
            { service: 'http_status:404' }                                                         // Catch-all
        ];

        it('Limpieza en STAGING: NO debe tocar túneles de Producción aunque no existan en su DB', () => {
            // En Staging solo existe 'staging-tx40200.ragenodes.com'
            const stagingActiveHostnames = new Set(['staging-tx40200.ragenodes.com']);

            const { validIngress, orphanedHostnames } = partitionIngressRulesByEnv(
                mockIngressRules,
                stagingActiveHostnames,
                'staging-'
            );

            // Solo debe marcar como huérfano el túnel huérfano de Staging
            assert.deepEqual(orphanedHostnames, ['staging-tx40201.ragenodes.com']);

            // Todos los túneles de Producción y Dev deben permanecer en validIngress intactos
            const validHosts = validIngress.map(r => r.hostname).filter(Boolean);
            assert.ok(validHosts.includes('tx40100.ragenodes.com'), 'Prod activo debe ser protegido');
            assert.ok(validHosts.includes('tx40101.ragenodes.com'), 'Prod huérfano debe ser protegido del worker de staging');
            assert.ok(validHosts.includes('dev-tx40300.ragenodes.com'), 'Dev debe ser protegido');
            assert.ok(validHosts.includes('staging-tx40200.ragenodes.com'), 'Staging activo debe ser conservado');
        });

        it('Limpieza en PRODUCCIÓN: NO debe tocar túneles de Staging ni de Dev', () => {
            // En Producción solo existe 'tx40100.ragenodes.com'
            const prodActiveHostnames = new Set(['tx40100.ragenodes.com']);

            const { validIngress, orphanedHostnames } = partitionIngressRulesByEnv(
                mockIngressRules,
                prodActiveHostnames,
                ''
            );

            // Solo debe marcar como huérfano el túnel huérfano de Producción
            assert.deepEqual(orphanedHostnames, ['tx40101.ragenodes.com']);

            // Todos los túneles de Staging y Dev deben permanecer en validIngress intactos
            const validHosts = validIngress.map(r => r.hostname).filter(Boolean);
            assert.ok(validHosts.includes('staging-tx40200.ragenodes.com'), 'Staging activo protegido');
            assert.ok(validHosts.includes('staging-tx40201.ragenodes.com'), 'Staging huérfano protegido del worker de prod');
            assert.ok(validHosts.includes('dev-tx40300.ragenodes.com'), 'Dev protegido');
            assert.ok(validHosts.includes('tx40100.ragenodes.com'), 'Prod activo conservado');
        });
    });
});
