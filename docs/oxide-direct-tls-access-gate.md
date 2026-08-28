# TLS directo y acceso restringido de preproducción

OxideProxy puede obtener y renovar el certificado de `ragenodes.dev` directamente mediante Let's Encrypt y `TLS-ALPN-01`. No necesita Cloudflare, PowerDNS ni una API DNS.

## Requisitos de red

1. Crear un registro `A` para `ragenodes.dev` que apunte a la IP pública del proxy de borde.
2. Enviar TCP 443 de la IP pública al puerto TCP 443 de ese proxy.
3. Permitir TCP 443 en el firewall. El puerto 80 solo se usa para redirigir HTTP a HTTPS.
4. No colocar otro terminador TLS delante de OxideProxy durante la validación ACME.

Un único registro cubre exclusivamente `ragenodes.dev`. Los subdominios requieren registros y certificados adicionales.

Si producción es la máquina que recibe el único puerto 443 público, debe actuar
como proxy de borde y reenviar exclusivamente el dominio de desarrollo a la red
privada de staging:

```dotenv
STAGING_MODE=false
STAGING_DOMAIN=ragenodes.dev
STAGING_UPSTREAM=192.168.1.106:80
ACCESS_GATE_SHARED_EDGE=true
```

En la VPS de staging debe mantenerse `STAGING_MODE=true` y
`ACCESS_GATE_SHARED_EDGE=false`. La IP privada anterior
es solo el ejemplo de esta instalación y debe ajustarse si cambia la red. No se
debe publicar directamente el puerto 80 de staging en Internet.

## Primera prueba en staging de Let's Encrypt

Configurar en el `.env` privado de preproducción:

```dotenv
PROXY_BIND_IP=0.0.0.0
PUBLIC_BASE_URL=https://ragenodes.dev
CORS_ORIGIN=https://ragenodes.dev
COOKIE_SECURE=true

OXIDE_ACME_ENABLED=true
OXIDE_ACME_DOMAINS=ragenodes.dev
OXIDE_ACME_EMAIL=correo-operaciones@example.com
OXIDE_ACME_PRODUCTION=false

ACCESS_GATE_ENABLED=true
ACCESS_GATE_DOMAIN=ragenodes.dev
ACCESS_GATE_ALLOWED_EMAIL_DOMAIN=ragenodes.com
ACCESS_GATE_SESSION_SECRET=[INSERT_SECRET_HERE]
ACCESS_GATE_REDIS_URL=redis://redis:6379/0
ACCESS_GATE_FROM_EMAIL="RageNodes Access <info@ragenodes.com>"
RESEND_API_KEY=establecer-en-el-entorno-privado
```

La comprobación operativa recomendada usa una cuenta corporativa real, por
ejemplo `bnfire@ragenodes.com`, sin registrar el código recibido ni ningún
secreto en logs, artefactos o variables versionadas.

Solo se aceptan direcciones cuyo dominio sea exactamente `ragenodes.com`. El
dominio corporativo permite solicitar el código, pero no concede acceso por sí
solo: el usuario debe introducir el OTP recibido por correo. El código caduca
en 10 minutos, se consume una sola vez y la verificación correcta concede una
sesión de 24 horas.

La cuenta y los certificados ACME se conservan en el volumen `oxide_acme_data_staging`. No deben almacenarse en Git.

Cuando la emisión y la renovación se hayan comprobado, cambiar únicamente:

```dotenv
OXIDE_ACME_PRODUCTION=true
```

No alternar repetidamente entre staging y producción para evitar límites de emisión.

## Comportamiento de la puerta de acceso

- Solo acepta el dominio configurado y rechaza otros valores de SNI o `Host`.
- No revela si un correo pertenece al dominio autorizado.
- Envía mediante Resend un código numérico de un solo uso que caduca en 10 minutos.
- El desafío OTP se conserva en Redis y sobrevive a reinicios o cambios de instancia del proxy.
- La validación consume el desafío de forma atómica, por lo que un código aceptado no puede reutilizarse.
- La sesión se guarda en una cookie `Secure`, `HttpOnly`, `SameSite=Strict` y dura 24 horas.
- Tres intentos con correos ajenos a `@ragenodes.com` bloquean la IP de origen observada directamente por OxideProxy.
- Cinco códigos incorrectos bloquean igualmente la IP.
- La lista negra dinámica persiste en `oxide_runtime_data_staging` y sobrevive a reinicios.
- `/healthz` queda disponible para las comprobaciones internas de salud.

Para generar el secreto de sesión puede usarse un generador criptográfico del sistema. Nunca debe reutilizarse `JWT_SECRET`, una contraseña o una clave de producción.
