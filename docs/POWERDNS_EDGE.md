# PowerDNS y TLS wildcard para OxideProxy

Este perfil sustituye los túneles individuales por un único registro DNS
comodín. `tx40120.edge.ragenodes.app` se traduce algorítmicamente al puerto 40120;
no se crea ni se elimina un túnel por servidor.

La zona pública de producción es `edge.ragenodes.app`. Su primario autoritativo
corre junto al borde y el secundario en otra red. Ambos publican el mismo
wildcard hacia el borde, mientras OxideProxy termina TLS y enruta el hostname
al puerto de txAdmin o de otra aplicación compatible.

## Límites de seguridad

- La API de PowerDNS sólo se publica en `127.0.0.1`; el ayudante ACME usa la
  red del host únicamente para alcanzar esa API y no publica puertos.
- OxideProxy sólo reenvía dominios y rangos de puertos declarados.
- `powerdns-sync-wildcard.sh` nunca crea una zona: exige que el operador la
  haya creado y delegado previamente.
- No se debe activar el certificado wildcard hasta que los NS públicos y la
  redundancia autoritativa estén probados. Lo recomendable son al menos dos
  servidores DNS autoritativos en redes independientes.

## Puesta en marcha controlada

1. Copiar los valores PowerDNS de `.env.example` al `.env` real. Guardar la
   clave aleatoria de la API en `/etc/ragenodes/powerdns-api-key`, con acceso
   sólo para el operador del despliegue. No guardar esa clave en Git.
2. Iniciar sólo PowerDNS en puertos locales de laboratorio:

   `docker compose -f docker-compose.yml -f docker-compose.powerdns.yml --profile dns-authority up -d powerdns-authoritative`

3. Crear la zona mediante la API o `pdnsutil`, añadir SOA/NS y verificarla en
   el puerto 5353 antes de cambiar los nameservers del registrador.
4. Tras delegar la zona, ejecutar `scripts/powerdns-sync-wildcard.sh` para
   crear `*.zona -> IP_DEL_BORDE`.
5. Probar primero con el directorio staging de Let's Encrypt. En producción,
   usar el directorio público y establecer `EDGE_TLS_ENABLED=true`.
6. `deploy.sh` añade `docker-compose.edge-tls.yml`, emite el certificado si no
   existe o intenta renovarlo si ya está presente, y sólo después recrea
   `oxide_web`. El certificado reside en un volumen persistente de sólo lectura
   para OxideProxy.
7. Verificar HTTPS en un hostname de prueba y después en el hostname txAdmin.
   No se monta el socket Docker dentro de ningún contenedor.

El perfil `docker-compose.powerdns.yml` se conserva para laboratorios donde la
autoridad DNS también forma parte del Compose. Producción usa
`docker-compose.edge-tls.yml`: PowerDNS permanece aislado y no se reinicia ni
se elimina durante una actualización normal de RageNodes.

Si el mismo OxideProxy atiende varias zonas (por ejemplo `.com` y `.dev`), el
certificado debe incluir todas antes de desactivar el ACME integrado. Nunca se
debe sustituir el certificado del borde por uno que no cubra todos sus hosts.
