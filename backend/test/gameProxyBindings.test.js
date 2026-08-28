import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { prepareGameProxyBindings } from '../src/services/gameProxyPolicy.js';

describe('OxideProxy game bindings', () => {
    it('desplaza todos los puertos declarados conservando TCP y UDP', () => {
        const result = prepareGameProxyBindings({
            '16261/udp': [{ HostIp: '0.0.0.0', HostPort: '16200' }],
            '16262/udp': [{ HostIp: '0.0.0.0', HostPort: '16201' }],
            '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }]
        }, { enabled: true, proxiedPorts: ['16261/udp', '16262/udp'], backendOffset: 10000, backendBindIp: '127.0.0.1' });

        assert.deepEqual(result.bindings['16261/udp'], [{ HostIp: '127.0.0.1', HostPort: '26200' }]);
        assert.deepEqual(result.bindings['16262/udp'], [{ HostIp: '127.0.0.1', HostPort: '26201' }]);
        assert.deepEqual(result.bindings['8080/tcp'], [{ HostIp: '0.0.0.0', HostPort: '8080' }]);
        assert.equal(result.labels['ragenodes.game_proxy'], 'enabled');
        assert.equal(result.labels['ragenodes.game_proxy_ports'], '16261/udp,16262/udp');
    });

    it('rechaza puertos cuyo backend saldria del rango valido', () => {
        assert.throws(
            () => prepareGameProxyBindings({ '1/udp': [{ HostPort: '60000' }] }, { enabled: true, backendOffset: 10000 }),
            /Puerto publico invalido/
        );
    });
});
