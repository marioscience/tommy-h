/** Builds the canonical restart contract consumed by every lifecycle path. */
export function buildRestartOptions(server, plan, licenseKey = 'hidden') {
  return {
    containerName: server.container_name,
    dataPath: server.data_path,
    fivemPort: server.fivem_port,
    txadminPort: server.txadmin_port,
    serverName: server.name,
    licenseKey,
    plan,
    gamePort: server.fivem_port,
    mcVersion: server.mc_version,
    mcType: server.mc_type,
    serverId: server.id,
    dbName: server.db_name,
    dbUser: server.db_user,
    dbPass: server.db_pass,
    nodeId: server.node_id,
    clusterId: server.cluster_id,
    cpuset: server.cpuset
  };
}
