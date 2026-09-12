import * as Docker from './dockerService.js';

/**
 * Reverts a legacy txAdmin cookie patch after a FiveM container starts.
 *
 * OxideProxy owns Set-Cookie normalization at the edge. Older containers may
 * still contain a CHIPS patch that separates popup and OAuth callback state;
 * this delayed repair keeps existing installations compatible.
 */
export function scheduleEmbeddedTxAdminCookieRepair(server) {
  const monitorRoot = '/opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor';
  const repair = `docker exec -u 0 ${server.container_name} sh -c "find ${monitorRoot}/core ${monitorRoot}/panel -type f -name '*.js' -exec sed -i -e 's/sameSite:\\"none\\",secure:true,partitioned:true/sameSite:\\"lax\\"/g' -e 's/SameSite=None;Secure;Partitioned/SameSite=Lax/g' {} +"`;

  setTimeout(async () => {
    try {
      await Docker.runRemoteCommand(server.node_id, repair);
      await Docker.runRemoteCommand(server.node_id, `docker restart ${server.container_name}`);
    } catch (error) {
      console.error(`[txAdmin Cookie Repair] ${server.container_name}: ${error.message}`);
    }
  }, 5000);
}
