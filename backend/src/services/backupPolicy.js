export function hasManagedDatabase(server) {
  return typeof server?.db_name === 'string' && server.db_name.length > 0;
}
