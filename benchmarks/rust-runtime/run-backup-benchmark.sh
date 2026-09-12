#!/usr/bin/env bash
set -Eeuo pipefail

command -v node >/dev/null
command -v tar >/dev/null
command -v zstd >/dev/null
command -v /usr/bin/time >/dev/null

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${BACKUP_BENCH_WORK:-/tmp/ragenodes-backup-benchmark}"
SIZE_MIB="${BACKUP_BENCH_SIZE_MIB:-256}"
ROUNDS="${BACKUP_BENCH_ROUNDS:-3}"
RESULTS="$ROOT/benchmarks/rust-runtime/results"
WORKER="$ROOT/benchmarks/rust-runtime/backup-worker.mjs"

rm -rf "$WORK"
mkdir -p "$WORK" "$RESULTS"
printf 'profile,engine,round,elapsed_s,user_s,system_s,max_rss_kib,archive_bytes,digest_ok\n' > "$RESULTS/backup-results.csv"

for profile in compressible mixed; do
  source="$WORK/source-$profile"
  node "$WORKER" prepare "$source" "$SIZE_MIB" "$profile"
  expected="$(node "$WORKER" digest "$source")"
  for engine in tar rust; do
    for round in $(seq 1 "$ROUNDS"); do
      archive="$WORK/$profile-$engine-$round.tar.zst"
      timing="$WORK/$profile-$engine-$round.time"
      extract="$WORK/extract-$profile-$engine-$round"
      /usr/bin/time -f '%e,%U,%S,%M' -o "$timing" node "$WORKER" "$engine" "$source" "$archive"
      mkdir -p "$extract"
      tar --zstd -xf "$archive" -C "$extract"
      actual="$(node "$WORKER" digest "$extract")"
      [ "$expected" = "$actual" ] && digest_ok=true || digest_ok=false
      printf '%s,%s,%s,%s,%s,%s\n' "$profile" "$engine" "$round" "$(cat "$timing")" "$(stat -c %s "$archive")" "$digest_ok" >> "$RESULTS/backup-results.csv"
      rm -rf "$extract" "$archive"
    done
  done
done

node "$ROOT/benchmarks/rust-runtime/summarize-backup-results.mjs" "$RESULTS/backup-results.csv" > "$RESULTS/backup-summary.json"
printf 'Resultados: %s\n' "$RESULTS/backup-summary.json"
