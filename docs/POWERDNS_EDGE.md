# PowerDNS y TLS wildcard para OxideProxy

Este perfil sustituye los túneles individuales por un único registro DNS
comodín. `tx40120.ragenodes.dev` se traduce algorítmicamente al puerto 40120;
no se crea ni se elimina un túnel por servidor.

## Límites de seguridad

- La API de PowerDNS sólo se publica en `127.0.0.1`.
- OxideProxy sólo reenvía dominios y rangos de puertos declarados.
- `powerdns-sync-wildcard.sh` nunca crea una zona: exige que el operador la
  haya creado y delegado previamente.
- No se debe activar el certificado wildcard hasta que los NS públicos y la
  redundancia autoritativa estén probados. Lo recomendable son al menos dos
  servidores DNS autoritativos en redes independientes.

## Puesta en marcha controlada

1. Copiar los valores PowerDNS de `.env.example` al `.env` real y generar un
   `PDNS_API_KEY` aleatorio.
2. Iniciar sólo PowerDNS en puertos locales de laboratorio:

   `docker compose -f docker-compose.yml -f docker-compose.powerdns.yml --profile dns-authority up -d powerdns-authoritative`

3. Crear la zona mediante la API o `pdnsutil`, añadir SOA/NS y verificarla en
   el puerto 5353 antes de cambiar los nameservers del registrador.
4. Tras delegar la zona, ejecutar `scripts/powerdns-sync-wildcard.sh` para
   crear `*.zona -> IP_DEL_BORDE`.
5. Mantener `LEGO_ACME_SERVER` en Let's Encrypt staging y obtener el primer
   certificado con el servicio `oxide_wildcard_certificate`.
6. Verificar el certificado y todos los dominios que comparten el borde. Sólo
   entonces cambiar al directorio ACME de producción y superponer el volumen
   de certificados sobre `oxide_web`.
7. Programar `scripts/renew-oxide-wildcard.sh` con un timer del host. No se
   monta el socket Docker dentro de ningún contenedor.

Si el mismo OxideProxy atiende varias zonas (por ejemplo `.com` y `.dev`), el
certificado debe incluir todas antes de desactivar el ACME integrado. Nunca se
debe sustituir el certificado del borde por uno que no cubra todos sus hosts.
