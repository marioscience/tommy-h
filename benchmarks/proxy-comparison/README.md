# Benchmark local: OxideProxy vs NGINX

Laboratorio aislado y reproducible para comparar HTTP, TCP y UDP contra el mismo backend. Ambos proxies reciben 2 vCPU, 512 MiB y el mismo límite de archivos abiertos.

```powershell
docker compose -p proxy-benchmark -f compose.yml up -d
node runner.mjs
docker compose -p proxy-benchmark -f compose.yml down --remove-orphans
```

Cada ejecución crea una carpeta fechada bajo `results/` con el informe, datos crudos y copias exactas de las configuraciones utilizadas.

La imagen de OxideProxy puede seleccionarse sin editar el laboratorio:

```powershell
$env:OXIDE_BENCH_IMAGE='ragenodes/oxideproxy:1.0.0-local'
$env:OXIDE_HTTP_CONTAINER_PORT='8088' # La imagen antigua no admite http_listen_addrs.
```

XDP/eBPF se deja desactivado porque Docker Desktop ejecuta los contenedores dentro de una VM. Medirlo ahí como si fuera el camino nativo del kernel del host daría una comparación engañosa.
