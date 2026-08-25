# GitLab Runner local

Este servicio mantiene un coordinador ligero conectado a GitLab. Los contenedores que ejecutan las pruebas solo existen mientras hay jobs pendientes y se eliminan al finalizar.

## Perfiles

- `ragenodes-general`: hasta 3 jobs simultáneos, 3 CPU y 4 GiB por job.
- `ragenodes-rust`: 1 job Rust, 6 CPU y 8 GiB.
- Máximo global: 4 jobs simultáneos.

Los jobs no reciben el socket Docker del host y se ejecutan sin modo privilegiado. El socket solo se monta en el coordinador porque el executor Docker lo necesita para crear y retirar los contenedores efímeros.

## Registro inicial

1. En GitLab, crea dos project runners bloqueados a este proyecto, sin `Run untagged`:
   - etiqueta `ragenodes-general`;
   - etiqueta `ragenodes-rust`.
2. Copia `.env.example` a `.env` y coloca los dos tokens `glrt-...`. Nunca confirmes ese archivo en Git.
3. Ejecuta `./register.sh` desde WSL/Linux.

El registro es una operación única. Después se puede usar `./start.sh` y `./stop.sh`. Si el coordinador está detenido, GitLab dejará los jobs pendientes hasta que vuelva a arrancar.

## Seguridad operativa

- Acepta únicamente pipelines de este proyecto privado.
- Marca ambos runners como `Protected` cuando solo deban ejecutar ramas protegidas.
- Mantén desactivados los instance runners para evitar consumir minutos por error.
- No reutilices los tokens fuera de este equipo; rótalos desde GitLab si se exponen.
