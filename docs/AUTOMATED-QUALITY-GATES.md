# Puertas automáticas antes de `dev`

Esta automatización técnica es independiente del proceso humano y los playbooks
existentes en `docs/qa`; no los reemplaza ni los reescribe.

## Capas

1. **Equipo del desarrollador:** `./dev doctor`, `./dev test <componente>` y
   `./dev verify <perfil>` detectan problemas antes de consumir un runner.
2. **Merge request hacia `dev`:** GitLab ejecuta contratos de desarrollo,
   seguridad, backend, OxideProxy, Compose e integración real de PostgreSQL/Redis.
3. **Laboratorio opcional:** `./dev game-smoke <juego>` consulta un servidor real
   con GameDig usando host y puertos suministrados por el operador.
4. **Staging:** continúa siendo el lugar para pruebas manuales, clientes reales,
   red pública, DNS, certificados, rendimiento y experiencia dentro del juego.

## Criterio de aceptación

Una rama no debe entrar en `dev` si falla una prueba obligatoria. Una dependencia
externa inexistente en el equipo local debe producir una explicación clara; en CI
las dependencias obligatorias se proporcionan como servicios aislados. Las pruebas
de juegos reales no se ejecutan implícitamente porque requieren infraestructura y
puertos que no existen en todos los equipos.

## Portabilidad

- No hay direcciones IP, usuarios SSH, rutas personales ni credenciales fijas.
- Cada clon obtiene un `DEV_PROJECT_NAME` y secretos propios.
- Linux, WSL2 y Dev Container utilizan el mismo ejecutable `./dev`.
- Los valores variables se proporcionan mediante `.env.development` o variables
  `GAME_SMOKE_*`; nunca se incorporan al repositorio.
- Los comandos locales no conocen ni pueden desplegar staging o producción.

## Extensión futura del QA del equipo

`game-smoke` imprime JSON con estado, latencia, nombre, mapa, jugadores y dirección
de conexión. Un trabajo futuro puede guardar ese JSON como artefacto o actualizar
la matriz QA, pero esa conexión debe añadirse desde el proceso propietario de QA.
Esta rama solo ofrece el adaptador y no modifica archivos mantenidos por ese equipo.
