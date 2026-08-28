export function prepareGameProxyBindings(portBindings, {
    enabled = false,
    proxiedPorts = Object.keys(portBindings || {}),
    backendOffset = 10000,
    backendBindIp = '127.0.0.1'
} = {}) {
    const bindings = structuredClone(portBindings || {});
    const selected = new Set(proxiedPorts);
    if (!enabled) return { bindings, labels: { 'ragenodes.game_proxy': 'direct' } };

    const offset = Number(backendOffset);
    if (!Number.isInteger(offset) || offset < 1) throw new Error('Offset de backend invalido para proxy de juego.');
    for (const [containerPort, entries] of Object.entries(bindings)) {
        if (!selected.has(containerPort)) continue;
        for (const binding of entries || []) {
            const publicPort = Number(binding.HostPort);
            if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort + offset > 65535) {
                throw new Error(`Puerto publico invalido para proxy de juego: ${binding.HostPort}`);
            }
            binding.HostIp = backendBindIp;
            binding.HostPort = String(publicPort + offset);
        }
    }
    return {
        bindings,
        labels: {
            'ragenodes.game_proxy': 'enabled',
            'ragenodes.game_proxy_offset': String(offset),
            'ragenodes.game_proxy_ports': [...selected].sort().join(',')
        }
    };
}
