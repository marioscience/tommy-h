#!/usr/bin/env bash
set -Eeuo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/data/templates/sdtd-master/7dtd"
mkdir -p "$root/data/templates/.locks"
mkdir -p "$root/data/templates/.sdtd-master.previous-abandoned"
touch -d '2 days ago' "$root/data/templates/.sdtd-master.previous-abandoned"
printf 'old\n' > "$root/data/templates/sdtd-master/7dtd/server.bin"
printf 'runtime\n' > "$root/data/templates/sdtd-master/7dtd/7DaysToDieServer.x86_64"
printf 'old master\n' > "$root/data/templates/sdtd-master/identity"

cat > "$root/fake-runner" <<'RUNNER'
#!/usr/bin/env bash
set -Eeuo pipefail
staging="$2"
printf 'new\n' > "$staging/7dtd/server.bin"
printf 'runtime\n' > "$staging/7dtd/7DaysToDieServer.x86_64"
cat > "$staging/appmanifest_294420.acf" <<'MANIFEST'
"AppState"
{
  "appid" "294420"
  "StateFlags" "4"
}
MANIFEST
RUNNER
chmod +x "$root/fake-runner"

# Simula un despliegue que ya está clonando. La promoción debe esperar a que
# termine, sin impedir que SteamCMD prepare la copia temporal en paralelo.
(
  exec 9<> "$root/data/templates/.locks/sdtd.lock"
  flock -s 9
  touch "$root/read-lock-ready"
  sleep 2
) &
while [ ! -e "$root/read-lock-ready" ]; do sleep 0.05; done
SECONDS=0

INSTANCE_DATA_ROOT="$root/data" \
TEMPLATE_REFRESH_GAMES=sdtd \
TEMPLATE_LOCAL_BUILD_GAMES=sdtd \
TEMPLATE_REFRESH_RUNNER="$root/fake-runner" \
SDTD_BASE_IMAGE=test/image@sha256:deadbeef \
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/refresh_game_templates.sh"

test "$SECONDS" -ge 1

test "$(cat "$root/data/templates/sdtd-master/identity")" = 'old master'
test "$(cat "$root/data/templates/sdtd-master/7dtd/server.bin")" = 'new'
test -s "$root/data/templates/sdtd-master/.ragenodes-template-validated-at"
! find "$root/data/templates" -maxdepth 1 -name '.sdtd-master.*' | grep -q .

# Una actualización inválida nunca reemplaza la última plantilla válida.
cat > "$root/bad-runner" <<'RUNNER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'corrupt\n' > "$2/appmanifest_294420.acf"
RUNNER
chmod +x "$root/bad-runner"
if INSTANCE_DATA_ROOT="$root/data" \
  TEMPLATE_REFRESH_GAMES=sdtd \
  TEMPLATE_LOCAL_BUILD_GAMES=sdtd \
  TEMPLATE_REFRESH_RUNNER="$root/bad-runner" \
  SDTD_BASE_IMAGE=test/image@sha256:deadbeef \
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/refresh_game_templates.sh"; then
  echo 'La actualización inválida debió fallar' >&2
  exit 1
fi
test "$(cat "$root/data/templates/sdtd-master/7dtd/server.bin")" = 'new'
! find "$root/data/templates" -maxdepth 1 -name '.sdtd-master.*' | grep -q .

# El modo de adopción solo sella plantillas heredadas que tengan manifiesto y
# runtime real. Nunca convierte un directorio parcial en una plantilla válida.
rm -f "$root/data/templates/sdtd-master/.ragenodes-template-validated-at"
INSTANCE_DATA_ROOT="$root/data" \
TEMPLATE_REFRESH_GAMES=sdtd \
TEMPLATE_LOCAL_BUILD_GAMES= \
TEMPLATE_VALIDATE_EXISTING_ONLY=1 \
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/refresh_game_templates.sh"
test -s "$root/data/templates/sdtd-master/.ragenodes-template-validated-at"
test "$(stat -c %a "$root/data/templates/.locks")" = 2775
rm -f "$root/data/templates/sdtd-master/.ragenodes-template-validated-at"
rm -f "$root/data/templates/sdtd-master/7dtd/7DaysToDieServer.x86_64"
if INSTANCE_DATA_ROOT="$root/data" \
  TEMPLATE_REFRESH_GAMES=sdtd \
  TEMPLATE_LOCAL_BUILD_GAMES= \
  TEMPLATE_VALIDATE_EXISTING_ONLY=1 \
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/refresh_game_templates.sh"; then
  echo 'Una plantilla sin runtime no debe validarse' >&2
  exit 1
fi
test ! -e "$root/data/templates/sdtd-master/.ragenodes-template-validated-at"
echo 'PASS atomic template refresh'
