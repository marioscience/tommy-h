import express from 'express';
import si from 'systeminformation';
import { config } from '../config.js';
import { query } from '../db.js';
import { getNodeConnection } from '../services/dockerService.js';

const router = express.Router();

async function getLocalNodeHealth(nodeMeta = {}) {
  const mem = await si.mem();
  const ramPercent = (mem.active / mem.total) * 100;
  const load = await si.currentLoad();
  const disks = await si.fsSize();
  const heavyMounts = [
    config.instanceDataRoot,
    '/mnt/ragenodes-heavy',
    `${config.instanceDataRoot}/templates`,
    config.backupRoot
  ];
  const dataDisk = heavyMounts
    .map(mount => disks.find(d => d.mount === mount))
    .find(Boolean) || disks[0];
  const diskPercent = dataDisk ? dataDisk.use : 0;
  return {
    id: 0,
    name: nodeMeta.name || 'Master Node Titan R1',
    ip_address: nodeMeta.ip_address || 'localhost',
    status: nodeMeta.status || 'active',
    cpu: load.currentLoad,
    ram: ramPercent,
    ramGb: Number((mem.active / 1024 ** 3).toFixed(1)),
    ramTotal: Math.round(mem.total / 1024 ** 3),
    disk: diskPercent,
    diskGb: dataDisk ? Number((dataDisk.used / 1024 ** 3).toFixed(1)) : 0,
    diskTotal: dataDisk ? Math.round(dataDisk.size / 1024 ** 3) : 0,
    cpuCores: load.cpus?.length || nodeMeta.cpu_cores || 0,
    diskMount: dataDisk?.mount || null,
    source: dataDisk?.mount === config.instanceDataRoot ? 'host' : 'heavy-storage'
  };
}

async function getRemoteNodeHealth(node) {
  const docker = await getNodeConnection(node.id);
  const [info, containers, df] = await Promise.all([
    docker.info(),
    docker.listContainers({ all: false }),
    docker.df().catch(() => null)
  ]);

  let ramBytes = 0;
  let cpuDockerPercent = 0;
  const ragenodeContainers = containers.filter(c => c.Names?.some(n => n.startsWith('/ragenodes-')));
  await Promise.all(ragenodeContainers.map(async c => {
    try {
      const stats = await docker.getContainer(c.Id).stats({ stream: false });
      const memUsage = stats.memory_stats?.usage || 0;
      const memCache = stats.memory_stats?.stats?.cache || 0;
      ramBytes += Math.max(0, memUsage - memCache);

      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
      const onlineCpus = stats.cpu_stats?.online_cpus || info.NCPU || 1;
      if (cpuDelta > 0 && systemDelta > 0) cpuDockerPercent += (cpuDelta / systemDelta) * onlineCpus * 100;
    } catch (_) {}
  }));

  const totalRam = info.MemTotal || 0;
  const layersSize = df?.LayersSize || 0;
  const cpuPercentOfNode = info.NCPU ? Math.min(100, cpuDockerPercent / info.NCPU) : 0;

  return {
    id: Number(node.id),
    name: node.name,
    ip_address: node.ip_address,
    status: node.status,
    cpu: cpuPercentOfNode,
    ram: totalRam ? (ramBytes / totalRam) * 100 : 0,
    ramGb: Number((ramBytes / 1024 ** 3).toFixed(1)),
    ramTotal: Math.round(totalRam / 1024 ** 3),
    disk: 0,
    diskGb: Number((layersSize / 1024 ** 3).toFixed(1)),
    diskTotal: null,
    cpuCores: info.NCPU || node.cpu_cores || 0,
    containers: ragenodeContainers.length,
    source: 'docker'
  };
}

router.get('/system-health', async (req, res) => {
  try {
    const nodesResult = await query("SELECT * FROM nodes ORDER BY id ASC");
    const nodes = nodesResult.rows;
    const selectedId = Number(req.query.nodeId ?? 0);
    const selectedMeta = nodes.find(n => Number(n.id) === selectedId) || nodes.find(n => Number(n.id) === 0) || {};
    const selected = selectedId === 0
      ? await getLocalNodeHealth(selectedMeta)
      : await getRemoteNodeHealth(selectedMeta);

    res.json({
      ...selected,
      selectedNodeId: selected.id,
      nodes: nodes.map(n => ({
        id: Number(n.id),
        name: n.name,
        ip_address: n.ip_address,
        status: n.status,
        cpu_cores: n.cpu_cores,
        ram_total_gb: n.ram_total_gb
      }))
    });
  } catch (e) {
    console.error("Error leyendo métricas:", e);
    res.status(500).json({ error: 'Fallo al leer métricas del Host' });
  }
});

export default router;
