# ADR-003: Aislamiento de Espacio de Nombres para Túneles Cloudflare (Multi-Entorno)

## Estado
Aceptado

## Contexto
En arquitecturas donde los entornos de Desarrollo, Staging y Producción comparten la misma cuenta o zona de Cloudflare, la rutina periódica de limpieza de túneles huérfanos (`cleanOrphanedTunnels`) borraba túneles de otros entornos al no encontrarlos en la base de datos local de ese worker.

## Decisión
Implementar un sistema de **Espacio de Nombres por Prefijo (*Environment Namespace Prefix*)**:
1. **Configuración:** Variable `CF_TUNNEL_ENV_PREFIX` (`""` en Producción, `"staging-"` en Staging, `"dev-"` en Desarrollo).
2. **Generación:** Los túneles de FiveM/Wordpress/txAdmin se crean con el prefijo correspondiente (ej. `staging-tx40120.ragenodes.com` vs `tx40120.ragenodes.com`).
3. **Limpieza Aislada:** La función `partitionIngressRulesByEnv` evalúa la pertenencia con `isHostnameManagedByCurrentEnv`. Un worker de Staging **SOLO** puede evaluar y eliminar hostnames con `staging-`, preservando incondicionalmente todos los de Producción y Dev. Producción a su vez preserva incondicionalmente todos los de Staging y Dev.
4. **Optimización de Conexiones:** Conexión a Redis y recolección de telemetría desacoplada en modo de pruebas (`NODE_ENV=test`) para ejecución instantánea sin bloqueos de red.

## Consecuencias
### Positivas:
- Cero riesgo de que Staging o Dev borren túneles de Producción activa.
- Cero riesgo de que Producción borre túneles de prueba en Staging.
- Trazabilidad y orden transparente en el panel de Cloudflare DNS y Argo Tunnel.
