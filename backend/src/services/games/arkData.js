import crypto from 'node:crypto';
import path from 'node:path';

// All filesystem preparation runs in the SAME Docker user namespace as ARK.
// Binding the common data root exposes the shared master without downloading
// ARK again. A tar stream is deliberately used instead of recursive cp: the
// production template is NFS-backed while instances are Btrfs/rootless, and
// tar can safely merge a partially copied destination during bounded retries.
export const ARK_PREPARE_SCRIPT = `set -eu
target="/data/$ARK_SERVER_ID"
master='/data/templates/ark-master'
echo 'ARK prepare: validating paths'
if [ -L "$target" ]; then echo 'ARK preparation rejected a symlinked instance directory' >&2; exit 1; fi
if [ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo 'ARK instance already contains data; preserving it'
elif [ -d "$master/common" ]; then
    echo 'ARK prepare: cloning master template'
    copy_attempt=1
    while ! (cd "$master" && tar -cf - .) | (cd "$target" && tar -xf -); do
        if [ "$copy_attempt" -ge 3 ]; then
            echo 'ARK master template copy failed after 3 resumable attempts' >&2
            exit 1
        fi
        copy_attempt=$((copy_attempt + 1))
        echo "ARK master template copy interrupted; resuming attempt $copy_attempt/3" >&2
        sleep 2
    done
    echo 'ARK master template cloned'
else
    echo 'ARK master template unavailable; instance will download files'
fi
echo 'ARK prepare: validating copied layout'
base="$target/common/ARK Survival Ascended Dedicated Server/ShooterGame"
for entry in "$target/common" "$target/common/ARK Survival Ascended Dedicated Server" "$base" "$base/Binaries" "$base/Binaries/Win64" "$target/compatdata" "$target/compatdata/2430930"; do
    if [ -L "$entry" ]; then echo 'ARK preparation rejected a symlinked directory' >&2; exit 1; fi
done
mkdir -p "$base/Binaries/Win64" "$target/compatdata/2430930"
echo 'ARK prepare: updating runtime files'
rm -f -- "$target/compatdata/2430930/pfx.lock"
for entry in "$target/common/ARK Survival Ascended Dedicated Server/steam_appid.txt" "$base/steam_appid.txt" "$base/Binaries/Win64/steam_appid.txt"; do
    if [ -L "$entry" ]; then echo 'ARK preparation rejected a symlinked app id' >&2; exit 1; fi
    printf '2430930\\n' > "$entry"
done
echo 'ARK prepare: normalizing ownership'
chown -R -P 1000:1000 "$target"
echo 'ARK prepare: complete'
`;

function readableHelperLog(value) {
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
    return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(-4000);
}

export async function prepareArkData({ docker, image, dataRoot, dataPath }) {
    const root = path.posix.resolve(dataRoot);
    const target = path.posix.resolve(dataPath);
    if (root === '/' || path.posix.dirname(target) !== root ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path.posix.basename(target))) {
        throw new Error('ARK preparation requires one UUID instance directory.');
    }
    let helper;
    try {
        helper = await docker.createContainer({
            Image: image,
            name: `ragenodes-ark-prepare-${crypto.randomBytes(6).toString('hex')}`,
            User: '0:0',
            Env: [`ARK_SERVER_ID=${path.posix.basename(target)}`],
            Entrypoint: ['/bin/sh', '-c'],
            Cmd: [ARK_PREPARE_SCRIPT],
            Tty: true,
            HostConfig: {
                Binds: [`${root}:/data:rw`],
                NetworkMode: 'none', ReadonlyRootfs: true,
                CapDrop: ['ALL'], CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
                SecurityOpt: ['no-new-privileges:true'], PidsLimit: 64,
                Memory: 128 * 1024 * 1024
            }
        });
        await helper.start();
        const result = await helper.wait();
        if (Number(result?.StatusCode) !== 0) {
            const output = typeof helper.logs === 'function'
                ? readableHelperLog(await helper.logs({ stdout: true, stderr: true })) : '';
            const detail = output ? ` Last output: ${output}` : '';
            throw new Error(`ARK data preparation failed (exit ${result?.StatusCode}); files preserved.${detail}`);
        }
    } finally {
        if (helper) await helper.remove({ force: true }).catch(() => {});
    }
}
