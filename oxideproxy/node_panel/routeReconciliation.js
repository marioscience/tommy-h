'use strict';

function routeKey(route) {
    return String(route?.name || '');
}

function stableRouteSort(left, right) {
    return routeKey(left).localeCompare(routeKey(right))
        || Number(left?.game_id || 0) - Number(right?.game_id || 0)
        || String(left?.protocol || '').localeCompare(String(right?.protocol || ''));
}

/**
 * Conserva una ruta automática durante varias instantáneas ausentes. Docker y
 * el backend pueden devolver inventarios parciales mientras recopilan métricas
 * o reinician un worker; una sola omisión no debe reiniciar el plano de datos
 * ni expulsar jugadores conectados.
 */
function reconcileAutomaticRoutes(currentRoutes, discoveredRoutes, misses, confirmations = 3) {
    const requiredConfirmations = Math.max(2, Number(confirmations) || 3);
    const currentByName = new Map((currentRoutes || []).map(route => [routeKey(route), route]));
    const discoveredByName = new Map((discoveredRoutes || []).map(route => [routeKey(route), route]));
    const next = [];

    for (const [name, route] of discoveredByName) {
        misses.delete(name);
        next.push(route);
    }

    for (const [name, route] of currentByName) {
        if (discoveredByName.has(name)) continue;
        const count = (misses.get(name) || 0) + 1;
        if (count < requiredConfirmations) {
            misses.set(name, count);
            next.push(route);
        } else {
            misses.delete(name);
        }
    }

    for (const name of [...misses.keys()]) {
        if (!currentByName.has(name) && !discoveredByName.has(name)) misses.delete(name);
    }

    return next.sort(stableRouteSort);
}

module.exports = { reconcileAutomaticRoutes };
