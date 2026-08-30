import fs from 'fs/promises';
import path from 'path';
import { query, logAudit } from '../db.js';
import { config, PLAN_LIMITS } from '../config.js';
import * as Docker from './dockerService.js';
import {
  blenderActivity,
  getServerByIdForUser,
  getServerDetails,
  repairBackoffCache,
  shouldRepairWithBackoff,
  verifyServerPort
} from './serverService.js';
import { checkSystemLoad } from './serverCreationService.js';
import { getFolderSize } from './serverNodeSelection.js';
import { assertNodeStartCapacity } from './nodeResourcePolicy.js';
import { getPlanRamGb, resolveServerPlan } from './serverPlanPolicy.js';
import { GameFactory } from './games/GameFactory.js';
import { getPublicEndpointUrl } from './publicEndpointService.js';
const MAINTENANCE_INTERVAL_MS = Math.max(300000, Number(process.env.MAINTENANCE_INTERVAL_MS || 600000));
const MAINTENANCE_CHUNK_SIZE = Math.max(1, Number(process.env.MAINTENANCE_CHUNK_SIZE || 3));

function scheduleEmbeddedTxAdminCookieRepair(server) {
  const monitorRoot = '/opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor';
  const repair = `docker exec -u 0 ${server.container_name} sh -c "find ${monitorRoot}/core ${monitorRoot}/panel -type f -name '*.js' -exec sed -i -e 's/sameSite:\\"lax\\"/sameSite:\\"none\\",secure:true,partitioned:true/g' -e 's/SameSite=Lax/SameSite=None;Secure;Partitioned/g' {} +"`;
  setTimeout(async () => {
    try {
      await Docker.runRemoteCommand(server.node_id, repair);
      await Docker.runRemoteCommand(server.node_id, `docker restart ${server.container_name}`);
    } catch (error) {
      console.error(`[txAdmin Cookie Repair] ${server.container_name}: ${error.message}`);
    }
  }, 5000);
}

export async function controlServer(id, userId, action, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");

  if (!isAdmin && (action === 'start' || action === 'restart') && s.status === 'suspended') {
      throw new Error("El servidor está suspendido por falta de pago. Por favor, renueva tu suscripción.");
  }

  if (s.owner_id !== userId && !isAdmin) {
      const suRes = await query("SELECT permissions FROM subusers WHERE server_id = $1 AND user_id = $2", [s.id, userId]);
      if (suRes.rowCount === 0) throw new Error("Acceso denegado.");
      const perms = suRes.rows[0].permissions || [];
      if (!perms.includes('power') && !perms.includes('restart')) {
          throw new Error("No tienes permiso para controlar la energía de este servidor.");
      }
  }

  if (action === 'start') {
      checkSystemLoad();
      const allocatedRamGb = Number(s.allocated_ram_gb);
      const requiredRamGb = Number.isFinite(allocatedRamGb) && allocatedRamGb > 0
          ? allocatedRamGb
          : getPlanRamGb(resolveServerPlan(s.runtime_plan).plan);
      await assertNodeStartCapacity(s.node_id, requiredRamGb);
      try {
          await Docker.startContainer(s.container_name);

          if (s.template === 'fivem') {
              setTimeout(() => {
                  Docker.runRemoteCommand(s.node_id, `docker exec -u 0 ${s.container_name} sh -c "cat /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js | sed 's/sameSite:\\"lax\\"/sameSite:\\"none\\",secure:true,partitioned:true/g' > /tmp/index.js && cp /tmp/index.js /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js" || true`);
                  Docker.runRemoteCommand(s.node_id, `docker exec -u 0 ${s.container_name} sh -c "cat /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/index-*.js | sed 's/SameSite=Lax/SameSite=None;Secure;Partitioned/g' > /tmp/panel.js && cp /tmp/panel.js /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/\\$(ls /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel | grep index-.*\\\\.js | head -n 1)" || true`);
                  setTimeout(() => { Docker.runRemoteCommand(s.node_id, `docker restart ${s.container_name}`); }, 2000);
              }, 5000);
          }
          await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
      } catch (err) {
          if (err.message.includes('No such container') || err.message.includes('404')) {
              console.log(`[Auto-Fix] Contenedor ${s.container_name} no encontrado al iniciar. Forzando recreación.`);
              action = 'restart'; // Pasa al bloque de restart de abajo
          } else {
              throw err;
          }
      }
  }
  if (action === 'stop') {
      await query("UPDATE servers SET status = 'stopping' WHERE id = $1", [s.id]);
      try {
          await Docker.stopContainer(s.container_name);
      } catch (e) {
          console.error(`[ServerService] Error al detener contenedor ${s.container_name}: ${e.message}`);
      }
      await query("UPDATE servers SET status = 'stopped' WHERE id = $1", [s.id]);
  }
  if (action === 'restart') {
      const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
      if (rowCount === 0) {
          throw new Error("El servidor ya está en proceso de reinicio o recreación. Por favor, espera unos segundos.");
      }

      checkSystemLoad();
      const basePlan = PLAN_LIMITS[s.runtime_plan] || PLAN_LIMITS.hobby;
      const plan = s.allocated_ram_gb > 0 ? { ...basePlan, memoryBytes: s.allocated_ram_gb * 1024 * 1024 * 1024 } : basePlan;
      let realLicenseKey = 'hidden';
      try {
          const inspect = await Docker.inspectContainer(s.container_name);
          const env = inspect.Config.Env || [];
          const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
          if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
      } catch (e) {}

      const opts = {
          containerName: s.container_name, dataPath: s.data_path,
          fivemPort: s.fivem_port, txadminPort: s.txadmin_port,
          serverId: s.id, serverName: s.name, licenseKey: realLicenseKey, plan, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
          gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
          clusterId: s.cluster_id, cpuset: s.cpuset
      };

      try {
          switch (s.template) {
              case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
              case 'rust': await Docker.restartRustContainer(opts); break;
              case 'palworld': await Docker.restartPalworldContainer(opts); break;
              case 'cs2': await Docker.restartCS2Container(opts); break;
              case 'valheim': await Docker.restartValheimContainer(opts); break;
              case 'zomboid': await Docker.restartZomboidContainer(opts); break;
              case 'ark': await Docker.restartARKContainer(opts); break;
              case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
              case 'discord':
              case 'discordbot': await Docker.restartDiscordBotContainer(opts); break;
              case 'wordpress': await Docker.restartWordPressContainer(opts); break;
              case 'database': await Docker.restartDatabaseContainer(opts); break;
              case 'fivem': await Docker.restartFivemContainer(opts); break;
              default: throw new Error(`Plantilla desconocida: ${s.template}`);
          }
          if (s.template === 'fivem') scheduleEmbeddedTxAdminCookieRepair(s);
          await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
      } catch (error) {
          await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
          throw error;
      }
  }

  await logAudit(userId, `SERVER.${action.toUpperCase()}`, { serverId: s.id, serverName: s.name });
  return getServerDetails(id, userId, isAdmin);
}

export async function deleteServer(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");
  if (!isAdmin && s.owner_id !== userId) throw new Error('Solo el propietario puede eliminar el servidor.');

  await query("UPDATE servers SET status = 'deleting' WHERE id = $1", [s.id]);

  await Docker.removeContainer(s.container_name);
  await Docker.removeContainer(`${s.container_name}-db`);
  await Docker.removeContainer(`ragenodes-blender-${s.id.slice(0,8)}`);
  await query('DELETE FROM servers WHERE id = $1', [s.id]);
  try { await fs.rm(s.data_path, { recursive: true, force: true }); } catch {}

  // 🧹 Limpieza de memoria en mapas locales
  repairBackoffCache.delete(s.id);
  blenderActivity.delete(s.id);

  return { success: true };
}

// El mantenimiento tiene un unico propietario. Este modulo tambien lo importan
// la API y otros workers; iniciar el intervalo en todos ellos provoca carreras
// y recreaciones duplicadas de servidores activos.
if (process.env.RAGENODES_ROLE === 'worker-docker-events') setInterval(async () => {
    try {
        console.log("🛠️ [Mantenimiento] Iniciando escaneo de salud de servidores...");

        // 🛡️ Auto-curado de infraestructura crítica
        const coreContainers = ['oxide_web', 'wg-easy', 'oxide_control_panel'];
        for (const core of coreContainers) {
            try {
                const coreState = await Docker.resolveContainerState(core);
                if (coreState.exists && !coreState.running) {
                    console.log(`⚠️ [Mantenimiento] Servicio core ${core} detectado offline. Intentando reiniciar...`);
                    await Docker.startContainer(core);
                }
            } catch (e) {}
        }

        // Limpieza automática de sub-usuarios huérfanos (Auto-Curado de Base de Datos)
        await query(`
            DELETE FROM users
            WHERE id NOT IN (SELECT owner_id FROM servers)
            AND id NOT IN (SELECT user_id FROM subusers)
            AND role != 'admin'
            AND username ~ '_[0-9a-f]{4}$'
        `);

        // Filtramos en Postgres para evitar procesamiento inútil en contenedores apagados o suspendidos
        const { rows: servers } = await query(`
            SELECT servers.*, users.extra_disk_gb
            FROM servers
            LEFT JOIN users ON servers.owner_id = users.id
            WHERE servers.status NOT IN ('stopped', 'stopping', 'suspended', 'deleting')
        `);

        // Ejecución en lotes para no asfixiar al host ni al API de Docker
        const CHUNK_SIZE = MAINTENANCE_CHUNK_SIZE;
        for (let i = 0; i < servers.length; i += CHUNK_SIZE) {
            const chunk = servers.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (s) => {
                try {
                    let needsFix = false;
                    const state = await Docker.resolveContainerState(s.container_name);

                    if (state.exists) {
                        const inspect = state.inspect || await Docker.inspectContainer(s.container_name);
                        const portBindings = inspect.HostConfig.PortBindings || {};

                        if (state.running && ['error', 'offline'].includes(s.status)) {
                            await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
                            s.status = 'running';
                        }

                        // 🛡️ Si el contenedor existe pero está apagado (Exited/Dead), se debe reparar de inmediato
                        if (!state.running) {
                            // Secondary DB check to prevent race condition if user stopped it while maintenance loop was iterating
                            const { rows: freshCheck } = await query("SELECT status FROM servers WHERE id = $1", [s.id]);
                            if (freshCheck.length > 0 && !['stopped', 'stopping', 'suspended', 'deleting'].includes(freshCheck[0].status)) {
                                console.log(`⚠️ [Mantenimiento] Contenedor ${s.name} está offline (no running). Forzando auto-curado.`);
                                needsFix = true;
                            } else {
                                console.log(`ℹ️ [Mantenimiento] Contenedor ${s.name} está offline pero su estado en DB es ${freshCheck[0]?.status}. Ignorando.`);
                            }
                        }

                        // 🛡️ Solo marcar como privado si TIENE bindings y todos son 127.0.0.1
                        const bindingsKeys = Object.keys(portBindings);
                        const isPrivate = bindingsKeys.length > 0 && Object.values(portBindings).every(bindings =>
                            bindings && bindings.every(b => b.HostIp === '127.0.0.1')
                        );
                        const isGameProxyBackend = config.oxideGameProxyEnabled
                            && inspect.Config?.Labels?.['ragenodes.game_proxy'] === 'enabled';

                        if (!needsFix && isPrivate && !isGameProxyBackend) {
                            console.log(`⚠️ [Mantenimiento] Corrigiendo red de ${s.name} a Modo Directo.`);
                            needsFix = true;
                        }

                        if (!needsFix) {
                            const uptimeStr = inspect.State.StartedAt;
                            const uptimeMs = Date.now() - new Date(uptimeStr).getTime();

                            // 🛡️ Verificar Logs para errores fatales
                            const logs = await Docker.fetchContainerLogs(s.container_name);
                            const tailLogs = logs.slice(-5000).toLowerCase();
                            const containerHealth = inspect.State?.Health?.Status;
                            const hasFatalLog = tailLogs.includes('address already in use')
                                || tailLogs.includes('segmentation fault')
                                || tailLogs.includes('core dumped');
                            // Un mensaje antiguo no demuestra que el proceso actual esté
                            // averiado. Recrear un contenedor saludable por texto persistente
                            // corta todas las sesiones de juego. Solo se usa como señal de
                            // reparación cuando Docker confirma además un healthcheck fallido.
                            if (hasFatalLog && containerHealth === 'unhealthy') {
                                console.log(`⚠️ [Mantenimiento] Error fatal detectado en los logs de ${s.name}. Forzando reinicio.`);
                                needsFix = true;
                            }

                            // 🛡️ Verificar TCP Port Ping si lleva más de 5 min arrancado
                            if (!needsFix && uptimeMs > 5 * 60 * 1000) {
                                if (isGameProxyBackend && containerHealth === 'unhealthy') {
                                    console.log(`⚠️ [Mantenimiento] Healthcheck interno fallido para ${s.name}. Posible cuelgue.`);
                                    needsFix = true;
                                }

                                let checkPort = s.fivem_port;
                                if (s.template === 'rust' || s.template === 'palworld') checkPort = s.fivem_port + 1; // RCON
                                if (s.template === 'ark') checkPort = s.fivem_port + 13; // RCON

                                // Los backends rootless del proxy se publican solo en el loopback del host.
                                // Desde este worker rootful ese loopback sería el propio contenedor, por lo
                                // que una sonda TCP produciría un falso negativo y expulsaría a los jugadores.
                                if (!needsFix && !isGameProxyBackend && s.template !== 'valheim' && s.template !== 'zomboid' && s.template !== 'ark') {
                                    const healthHost = '172.17.0.1';
                                    const isPortReachable = await verifyServerPort(healthHost, checkPort, 'tcp');
                                    if (!isPortReachable) {
                                        console.log(`⚠️ [Mantenimiento] Puerto TCP ${checkPort} no responde para ${s.name} (Uptime: ${Math.round(uptimeMs/60000)}m). Posible cuelgue.`);
                                        needsFix = true;
                                    }
                                }
                            }

                            // 🛡️ CONTROL DE CUOTA DE DISCO EN 3 PASOS
                            const usedDiskBytes = await getFolderSize(s.data_path);
                            const plan = PLAN_LIMITS[s.runtime_plan] || PLAN_LIMITS.hobby;
                            const maxDisk = (plan.diskBytes || (20 * 1024 ** 3)) + ((s.extra_disk_gb || 0) * 1024 ** 3);
                            const diskPercent = (usedDiskBytes / maxDisk) * 100;

                            const lastWarn = global.lastQuotaWarning || new Map();
                            global.lastQuotaWarning = lastWarn;

                            if (diskPercent >= 100 && !needsFix) {
                                console.log(`🛑 [Cuota de Disco] Servidor ${s.name} alcanzó el 100% de uso. Apagando por seguridad.`);
                                await Docker.stopContainer(s.container_name);
                                await query("UPDATE servers SET status = 'stopped' WHERE id = $1", [s.id]);
                                await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                    `Servidor Apagado: ${s.name}`,
                                    `El servidor superó su límite de almacenamiento (${(maxDisk / (1024**3)).toFixed(2)} GB). Fue apagado por seguridad.`,
                                    'error'
                                ]);
                                needsFix = false; // Ya lo detuvimos
                            } else if (diskPercent >= 95 && !needsFix) {
                                const last = lastWarn.get(`${s.id}_95`) || 0;
                                if (Date.now() - last > 6 * 60 * 60 * 1000) { // 6 hours
                                    console.log(`⚠️ [Cuota de Disco] Servidor ${s.name} superó el 95% de uso.`);
                                    await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                        `Alerta Crítica de Espacio: ${s.name}`,
                                        `El servidor superó el 95% de almacenamiento (${diskPercent.toFixed(1)}%). Si llega al 100% se apagará automáticamente.`,
                                        'warning'
                                    ]);
                                    lastWarn.set(`${s.id}_95`, Date.now());
                                }
                            } else if (diskPercent >= 85 && !needsFix) {
                                const last = lastWarn.get(`${s.id}_85`) || 0;
                                if (Date.now() - last > 24 * 60 * 60 * 1000) { // 24 hours
                                    await query("INSERT INTO notifications (title, content, type) VALUES ($1, $2, $3)", [
                                        `Aviso de Espacio: ${s.name}`,
                                        `El servidor superó el 85% de almacenamiento (${diskPercent.toFixed(1)}%). Considera limpiar archivos innecesarios.`,
                                        'info'
                                    ]);
                                    lastWarn.set(`${s.id}_85`, Date.now());
                                }
                            }
                        }
                    } else {
                        // El inventario agregado puede quedar momentaneamente desfasado
                        // durante una actualizacion del daemon. Antes de reemplazar un
                        // servidor activo, confirma su ausencia contra Docker de forma
                        // directa para no expulsar jugadores por un falso negativo.
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        try {
                            const retryInspect = await Docker.inspectContainer(s.container_name);
                            if (retryInspect?.State) {
                                console.warn(`⚠️ [Mantenimiento] Inventario transitorio para ${s.name}; el contenedor existe. Se omite la recreacion.`);
                            } else {
                                console.warn(`⚠️ [Mantenimiento] Contenedor ${s.name} confirmado ausente. Forzando auto-curado.`);
                                needsFix = true;
                            }
                        } catch (retryError) {
                            console.warn(`⚠️ [Mantenimiento] Contenedor ${s.name} confirmado ausente: ${retryError.message}. Forzando auto-curado.`);
                            needsFix = true;
                        }
                    }

                    if (needsFix) {
                        if (shouldRepairWithBackoff(s.id)) {
                            const repaired = await repairOneServer(s);
                            if (repaired) {
                                console.log(`✅ [Mantenimiento] ${s.name} restaurado con éxito.`);
                            }
                        } else {
                            console.log(`❌ [Mantenimiento] ${s.name} ha fallado demasiadas veces. Pausando auto-curado.`);
                            await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
                        }
                    }

                    // Mantiene la URL publica directa de txAdmin sincronizada.
                    if (s.template === 'fivem' && s.txadmin_port) {
                        const publicUrl = getPublicEndpointUrl(s.txadmin_port, { path: '' });
                        if (s.txadmin_url !== publicUrl) {
                            await query('UPDATE servers SET txadmin_url = $1 WHERE id = $2', [publicUrl, s.id]);
                        }
                    }
                } catch (e) {
                    console.error(`❌ Error en mantenimiento de ${s.name}:`, e.message);
                }
            }));

            // Ligera pausa entre lotes si quedan más por procesar
            if (i + CHUNK_SIZE < servers.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
    } catch (e) {
        console.error("❌ Mantenimiento Error:", e.message);
    }
}, MAINTENANCE_INTERVAL_MS);

// Helper para reparar un servidor individualmente
export async function repairOneServer(s) {
    const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
    if (rowCount === 0 && s.status !== 'error') {
        // Allow retry if it was already in recreating, but to prevent infinite loops without delay we set it to error if it fails
        console.warn(`⏳ [Mantenimiento] Servidor ${s.name} ya está en proceso de recreación. Omitiendo por ahora.`);
        return false;
    }

    const basePlan = PLAN_LIMITS[s.runtime_plan] || PLAN_LIMITS.hobby;
    const plan = s.allocated_ram_gb > 0 ? { ...basePlan, memoryBytes: s.allocated_ram_gb * 1024 * 1024 * 1024 } : basePlan;
    const opts = {
        containerName: s.container_name, dataPath: s.data_path, fivemPort: s.fivem_port,
        txadminPort: s.txadmin_port, serverName: s.name, licenseKey: 'hidden', plan,
        gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
        serverId: s.id, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
        clusterId: s.cluster_id
    };

    console.log(`🔧 [Mantenimiento] Reparando ${s.name} (Template: ${s.template})...`);

    try {
        switch (s.template) {
            case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
            case 'rust': await Docker.restartRustContainer(opts); break;
            case 'palworld': await Docker.restartPalworldContainer(opts); break;
            case 'cs2': await Docker.restartCS2Container(opts); break;
            case 'valheim': await Docker.restartValheimContainer(opts); break;
            case 'zomboid': await Docker.restartZomboidContainer(opts); break;
            case 'ark': await Docker.restartARKContainer(opts); break;
            case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
            case 'discord':
            case 'discordbot': await Docker.restartDiscordBotContainer(opts); break;
            case 'wordpress': await Docker.restartWordPressContainer(opts); break;
            case 'database': await Docker.restartDatabaseContainer(opts); break;
            case 'fivem':
                let realLicenseKey = 'hidden';
                try {
                    const inspect = await Docker.inspectContainer(s.container_name);
                    const env = inspect.Config.Env || [];
                    const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
                    if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
                } catch (e) {}
                opts.licenseKey = realLicenseKey;
                await Docker.restartFivemContainer(opts);
                break;
            default: throw new Error(`Plantilla desconocida: ${s.template}`);
        }
        const { rows } = await query("SELECT status FROM servers WHERE id = $1", [s.id]);
        if (rows.length > 0 && (rows[0].status === 'stopped' || rows[0].status === 'stopping')) {
            console.warn(`[Auto-Curado] Reparación de ${s.name} cancelada: El usuario solicitó detener el servidor durante la reparación.`);
            await Docker.stopContainer(s.container_name);
            return false;
        }

        await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);
        return true;

    } catch (e) {
        console.error(`❌ Error en mantenimiento de ${s.name}:`, e.message);
        await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
        return false;
    }
}

// ==========================================
// 🚀 GESTIÓN DE SUB-USUARIOS (EQUIPO)
// ==========================================


export async function repairServer(id, userId, isAdmin) {
  const s = await getServerByIdForUser(id, userId, isAdmin);
  if (!s) throw new Error("No encontrado");

  if (!isAdmin && s.status === 'suspended') {
      throw new Error("El servidor está suspendido por falta de pago. No se puede reparar en este estado.");
  }

  const { rowCount } = await query("UPDATE servers SET status = 'recreating' WHERE id = $1 AND status != 'recreating'", [s.id]);
  if (rowCount === 0) {
      console.warn(`⏳ [Repair] Servidor ${s.name} ya está en proceso de recreación/mantenimiento. Omitiendo.`);
      return { success: false, reason: 'already_recreating' };
  }

  await logAudit(userId, 'SERVER.REPAIR.START', { serverId: s.id });

  const cachePath = path.join(s.data_path, 'cache');
  try { await fs.rm(cachePath, { recursive: true, force: true }); } catch {}

  const plan = PLAN_LIMITS[s.runtime_plan] || PLAN_LIMITS.hobby;
  let realLicenseKey = 'hidden';
  try {
      const inspect = await Docker.inspectContainer(s.container_name);
      const env = inspect.Config.Env || [];
      const lkEnv = env.find(e => e.startsWith('LICENSE_KEY='));
      if (lkEnv) realLicenseKey = lkEnv.split('=')[1];
  } catch (e) {}

  const opts = {
      containerName: s.container_name, dataPath: s.data_path, fivemPort: s.fivem_port,
      txadminPort: s.txadmin_port, serverName: s.name, licenseKey: realLicenseKey, plan,
      gamePort: s.fivem_port, mcVersion: s.mc_version, mcType: s.mc_type,
      serverId: s.id, dbName: s.db_name, dbUser: s.db_user, dbPass: s.db_pass, nodeId: s.node_id,
      clusterId: s.cluster_id, cpuset: s.cpuset
  };

  try {
      switch (s.template) {
          case 'minecraft': await Docker.restartMinecraftContainer(opts); break;
          case 'rust': await Docker.restartRustContainer(opts); break;
          case 'palworld': await Docker.restartPalworldContainer(opts); break;
          case 'cs2': await Docker.restartCS2Container(opts); break;
          case 'valheim': await Docker.restartValheimContainer(opts); break;
          case 'zomboid': await Docker.restartZomboidContainer(opts); break;
          case 'ark': await Docker.restartARKContainer(opts); break;
          case 'sdtd': await Docker.restartSDTDContainer(s.container_name, s.id, s.fivem_port, plan, s.data_path); break;
          case 'discord':
          case 'discordbot': await Docker.restartDiscordBotContainer(opts); break;
          case 'wordpress': await Docker.restartWordPressContainer(opts); break;
          case 'database': await Docker.restartDatabaseContainer(opts); break;
          case 'fivem': await Docker.restartFivemContainer(opts); break;
          default: throw new Error(`Plantilla desconocida: ${s.template}`);
      }
      await query("UPDATE servers SET status = 'running' WHERE id = $1", [s.id]);

      return { success: true };
  } catch (err) {
      await query("UPDATE servers SET status = 'error' WHERE id = $1", [s.id]);
      await logAudit(userId, 'SERVER.REPAIR.FAILED', { serverId: s.id, error: err.message });
      throw err;
  }
}
