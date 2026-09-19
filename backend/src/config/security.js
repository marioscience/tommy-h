/**
 * Validate deployment configuration without reading global environment state.
 *
 * Keeping this policy pure makes it straightforward to audit and test with
 * explicit configuration fixtures. The public `assertSecureConfig` wrapper
 * remains in config.js for backwards compatibility.
 */
export function validateSecureConfig(config) {
  const errors = [];
  const placeholder = /change[_-]?me|changeme|admin123|example/i;
  const required = [
    ['DATABASE_URL', config.databaseUrl, 12],
    ['JWT_SECRET', config.jwtSecret, 32],
    ['DEPLOYMENT_PAYLOAD_KEY', config.deploymentPayloadKey, 32],
    ['DISCORD_API_KEY', config.discordApiKey, 24],
    ['NODE_ENROLLMENT_API_KEY', config.nodeEnrollmentApiKey, 24],
    ['CENTRAL_DB_PASS', config.centralDbPass, 16]
  ];

  if (config.nodeEnv === 'production') {
    for (const [name, value, minLength] of required) {
      if (typeof value !== 'string' || value.length < minLength || placeholder.test(value)) {
        errors.push(`${name} debe estar configurada con al menos ${minLength} caracteres y no ser un placeholder.`);
      }
    }
  }

  if ((config.adminUser && !config.adminPass) || (!config.adminUser && config.adminPass)) {
    errors.push('ADMIN_BOOTSTRAP_USER y ADMIN_BOOTSTRAP_PASS deben definirse juntos.');
  }
  if (config.nodeEnv === 'production' && config.discordApiKey === config.nodeEnrollmentApiKey) {
    errors.push('DISCORD_API_KEY y NODE_ENROLLMENT_API_KEY deben ser secretos diferentes.');
  }
  if (!Number.isInteger(config.dockerBlkioWeight)
      || (config.dockerBlkioWeight !== 0 && (config.dockerBlkioWeight < 10 || config.dockerBlkioWeight > 1000))) {
    errors.push('DOCKER_BLKIO_WEIGHT debe ser 0 (deshabilitado) o un entero entre 10 y 1000.');
  }
  if (!Number.isInteger(config.gameContainerSharedGid)
      || config.gameContainerSharedGid < 0
      || config.gameContainerSharedGid > 65535) {
    errors.push('GAME_CONTAINER_SHARED_GID debe ser un entero entre 0 y 65535.');
  }
  if (!['http', 'https'].includes(config.publicEndpointScheme)) {
    errors.push('PUBLIC_ENDPOINT_SCHEME debe ser http o https.');
  }
  if (!['port', 'subdomain'].includes(config.publicEndpointMode)) {
    errors.push('PUBLIC_ENDPOINT_MODE debe ser port o subdomain.');
  }
  if (!['tar', 'rust'].includes(config.backupArchiveEngine)) {
    errors.push('BACKUP_ARCHIVE_ENGINE debe ser tar o rust.');
  }
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(config.publicEndpointPrefix)) {
    errors.push('PUBLIC_ENDPOINT_PREFIX debe ser una etiqueta DNS corta y valida.');
  }
  if (config.trustedBaseDomains.length === 0
      || config.trustedBaseDomains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) {
    errors.push('TRUSTED_BASE_DOMAINS debe contener dominios base validos separados por comas.');
  }

  if (Boolean(config.paypalClient) !== Boolean(config.paypalSecret)) {
    errors.push('PAYPAL_CLIENT y PAYPAL_SECRET deben definirse juntos o dejarse ambos vacíos.');
  }
  if (config.paypalWebhooksEnabled && (config.paypalClient || config.paypalSecret)) {
    if (!config.paypalWebhookId || config.paypalWebhookId.length < 8 || placeholder.test(config.paypalWebhookId)) {
      errors.push('PAYPAL_WEBHOOK_ID debe configurarse antes de habilitar los webhooks de PayPal.');
    }
  }
  if (config.adminPass && (config.adminPass.length < 12 || placeholder.test(config.adminPass))) {
    errors.push('ADMIN_BOOTSTRAP_PASS debe tener al menos 12 caracteres y no ser un placeholder.');
  }

  if (config.nodeEnv === 'production') {
    if (!config.cookieSecure) {
      errors.push('COOKIE_SECURE debe ser true en producción.');
    }

    try {
      if (new URL(config.publicBaseUrl).protocol !== 'https:') {
        errors.push('PUBLIC_BASE_URL debe usar HTTPS en producción.');
      }
    } catch {
      errors.push('PUBLIC_BASE_URL debe ser una URL HTTPS válida en producción.');
    }

    const productionOrigins = String(config.corsOrigin || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
    if (productionOrigins.length === 0 || productionOrigins.some(origin => {
      try { return new URL(origin).protocol !== 'https:'; } catch { return true; }
    })) {
      errors.push('Todos los CORS_ORIGIN deben ser URLs HTTPS válidas en producción.');
    }

    const normalizedSocket = String(config.dockerSocket || '').replace(/\\/g, '/');
    const rootlessSocket = /^\/run\/user\/\d+\/docker\.sock$/.test(normalizedSocket);
    if (!rootlessSocket && !config.allowRootfulDockerSocket) {
      errors.push('Producción requiere un socket Docker rootless (/run/user/<uid>/docker.sock). La excepción ALLOW_ROOTFUL_DOCKER_SOCKET=true debe ser explícita.');
    }
    if (config.allowInsecureDockerNodes) {
      errors.push('ALLOW_INSECURE_DOCKER_NODES no puede habilitarse en producción.');
    }
  }

  if (config.nodeEnv !== 'production' && config.paypalMode === 'live') {
    errors.push('PAYPAL_MODE=live no esta permitido fuera de produccion. Usa sandbox en desarrollo y staging.');
  }

  if (errors.length > 0) {
    throw new Error(`Configuracion insegura:\n- ${errors.join('\n- ')}`);
  }
}
