#!/usr/bin/env bash
set -Eeuo pipefail

is_positive_integer() { [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]; }

if [ -n "${BACKEND_REPLICAS:-}" ]; then
  is_positive_integer "$BACKEND_REPLICAS" || {
    echo "BACKEND_REPLICAS debe ser un entero positivo" >&2
    exit 2
  }
  printf '%s\n' "$BACKEND_REPLICAS"
  exit 0
fi

logical_cpus="${BACKEND_HOST_CPUS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)}"
memory_mb="${BACKEND_HOST_MEMORY_MB:-$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)}"
is_positive_integer "$logical_cpus" && is_positive_integer "$memory_mb" || {
  echo "CPU o memoria detectada inválida" >&2
  exit 2
}
default_min_replicas=1
(( logical_cpus >= 8 )) && default_min_replicas=2
min_replicas="${BACKEND_REPLICA_MIN:-$default_min_replicas}"
max_replicas="${BACKEND_REPLICA_MAX:-4}"
cpu_budget_percent="${BACKEND_CPU_BUDGET_PERCENT:-20}"
memory_per_replica="${BACKEND_MEMORY_MB_PER_REPLICA:-512}"
memory_reserve="${BACKEND_MEMORY_RESERVE_MB:-2048}"

for value in "$logical_cpus" "$memory_mb" "$min_replicas" "$max_replicas" \
  "$cpu_budget_percent" "$memory_per_replica" "$memory_reserve"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Configuración de réplicas inválida" >&2; exit 2; }
done
for value in "$min_replicas" "$max_replicas" "$cpu_budget_percent" "$memory_per_replica"; do
  is_positive_integer "$value" || { echo "La capacidad configurada debe ser positiva" >&2; exit 2; }
done
(( min_replicas <= max_replicas )) || { echo "BACKEND_REPLICA_MIN supera BACKEND_REPLICA_MAX" >&2; exit 2; }

cpu_capacity=$(( logical_cpus * cpu_budget_percent / 100 ))
(( cpu_capacity < 1 )) && cpu_capacity=1
available_memory=$(( memory_mb > memory_reserve ? memory_mb - memory_reserve : 0 ))
memory_capacity=$(( available_memory / memory_per_replica ))
(( memory_capacity < 1 )) && memory_capacity=1

replicas="$cpu_capacity"
(( memory_capacity < replicas )) && replicas="$memory_capacity"
(( replicas < min_replicas )) && replicas="$min_replicas"
(( replicas > max_replicas )) && replicas="$max_replicas"
printf '%s\n' "$replicas"
