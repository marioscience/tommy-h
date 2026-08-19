import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

export const config = {
  // Configuración del Servidor
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3006),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:8088',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  adminUser: process.env.ADMIN_BOOTSTRAP_USER,
  adminPass: process.env.ADMIN_BOOTSTRAP_PASS,
  corsOrigin: process.env.CORS_ORIGIN || process.env.PUBLIC_BASE_URL || 'http://localhost:8088',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'rn_session',
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  cookieSameSite: process.env.COOKIE_SAMESITE || 'Strict',

  // 🤖 CONFIGURACIÓN DEL BOT DE DISCORD — Sin fallback inseguro: falla en arranque si no está configurada
  apiKey: process.env.API_KEY,
  paypalWebhooksEnabled: process.env.PAYPAL_WEBHOOKS_ENABLED !== 'false',
  paypalClient: process.env.PAYPAL_CLIENT,
  paypalSecret: process.env.PAYPAL_SECRET,
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID,
  paypalMode: process.env.PAYPAL_MODE || 'sandbox',

  // Rutas y Docker
  instanceDataRoot: process.env.INSTANCE_DATA_ROOT || '/srv/ragenodes-data',
  containerPrefix: process.env.CONTAINER_PREFIX || 'ragenodes-',
  dockerNetwork: process.env.DOCKER_NETWORK || 'ragenodes_net',
  portBaseOffset: Number(process.env.PORT_BASE_OFFSET || 0),
  projectRoot: process.env.PROJECT_ROOT || process.cwd(),
  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  dockerBlkioWeight: Number(process.env.DOCKER_BLKIO_WEIGHT ?? (process.env.NODE_ENV === 'production' ? 100 : 0)),
  allowRootfulDockerSocket: process.env.ALLOW_ROOTFUL_DOCKER_SOCKET === 'true',
  allowInsecureDockerNodes: process.env.ALLOW_INSECURE_DOCKER_NODES === 'true',

  // 📦 BACKUPS
  backupRoot: process.env.BACKUP_ROOT || '/srv/ragenodes-backups',

  // Imágenes base
  fivemBaseImage: process.env.FIVEM_BASE_IMAGE || 'ragenodes-fivem-base:1.0.0-local',
  blenderBaseImage: process.env.BLENDER_BASE_IMAGE || 'ragenodes-blender-web:1.0.0-local',
  minecraftBaseImage: process.env.MINECRAFT_BASE_IMAGE || 'itzg/minecraft-server:java25@sha256:997e32aeb8742a4904d900140f684cf6a2723aa713ae431c7327adeb62faf25d',
  rustBaseImage: process.env.RUST_BASE_IMAGE || 'indifferentbroccoli/rust-server-docker@sha256:65d0b48cb2130041c59837a25351e985a680e5289f6219619ae2c4771e6c797a',
  palworldBaseImage: process.env.PALWORLD_BASE_IMAGE || 'thijsvanloef/palworld-server-docker@sha256:39059e157ea5148f7c4f66c2913c9e844fd62b9fd9de1e7200de8bb4d9bd7a8f',
  cs2BaseImage: process.env.CS2_BASE_IMAGE || 'cm2network/cs2@sha256:182f37326df93a8893d3c604a2c2c2a2164e40d126d4d5a71835b2610b913af7',
  valheimBaseImage: process.env.VALHEIM_BASE_IMAGE || 'lloesche/valheim-server@sha256:20fde516ce311e6084f82f295c9eb6934af57b357c657937a04f62bdf5946149',
  zomboidBaseImage: process.env.ZOMBOID_BASE_IMAGE || 'renegademaster/zomboid-dedicated-server@sha256:5e3479ea2ef66a4f14686fd3abc3286cf31a82c0e37f737b4b5976ff37da9951',
  arkBaseImage: process.env.ARK_BASE_IMAGE || 'auhrus/arksurvivalascended-server@sha256:b823987de2e84a2af73e74ee2cdb6e7bc0fc01bdf79409abe930bb091e93927a',
  sdtdBaseImage: process.env.SDTD_BASE_IMAGE || 'didstopia/7dtd-server@sha256:b7d5822cbcb73116d6d1a04948f27e2edb38739dd62af0fdc41f8dbffb7af9ed',
  discordBotBaseImage: process.env.DISCORD_BOT_BASE_IMAGE || 'nikolaik/python-nodejs:python3.10-nodejs18@sha256:107fb5d4b4dc625b8c3b38186655a1368673d47a26db1f6f502de17c1658d5a7',
  wordpressBaseImage: process.env.WORDPRESS_BASE_IMAGE || 'wordpress@sha256:b427cec767f5de2aa649390cb8805aa1fe320e1e0d57fc1f467754edb6cc0a49',
  databaseBaseImage: process.env.DATABASE_BASE_IMAGE || 'mariadb:10.11@sha256:de61fed4a40d3842f3ee09944ba52792156cfd9adf489b2cc670fc6ded28df8d',

  // Host y Puertos
  fivemPublicHost: process.env.FIVEM_PUBLIC_HOST || 'localhost',
  fivemPortStart: Number(process.env.FIVEM_PORT_START || 30100),
  txAdminPortStart: Number(process.env.TXADMIN_PORT_START || 40100),
  blenderPortStart: Number(process.env.BLENDER_PORT_START || 50100),
  minecraftPortStart: Number(process.env.MINECRAFT_PORT_START || 25500),
  rustPortStart: Number(process.env.RUST_PORT_START || 28000),
  palworldPortStart: Number(process.env.PALWORLD_PORT_START || 8200),
  cs2PortStart: Number(process.env.CS2_PORT_START || 27000),
  valheimPortStart: Number(process.env.VALHEIM_PORT_START || 24500),
  zomboidPortStart: Number(process.env.ZOMBOID_PORT_START || 16200),
  arkPortStart: Number(process.env.ARK_PORT_START || 7700),
  sdtdPortStart: Number(process.env.SDTD_PORT_START || 26900),

  // Límites y Seguridad
  serverLimitPerUser: Number(process.env.SERVER_LIMIT_PER_USER || 1),
  centralDbPass: process.env.CENTRAL_DB_PASS,

  // ☁️ CLOUDFLARE AUTOMATION & NAMESPACE ISOLATION
  cfAccountId: process.env.CF_ACCOUNT_ID,
  cfZoneId: process.env.CF_ZONE_ID,
  cfTunnelId: process.env.CF_TUNNEL_ID,
  cfApiToken: process.env.CF_API_TOKEN,
  cfEmail: process.env.CF_EMAIL,
  cfDdnsDomain: process.env.CF_DDNS_DOMAIN,
  cfTunnelEnvPrefix: process.env.CF_TUNNEL_ENV_PREFIX !== undefined
    ? String(process.env.CF_TUNNEL_ENV_PREFIX).trim()
    : (process.env.NODE_ENV === 'staging' ? 'staging-' : (process.env.NODE_ENV === 'production' ? '' : 'dev-')),
  allowLocalAdmin: process.env.ALLOW_LOCAL_ADMIN === 'true'
};

export function assertSecureConfig() {
  const errors = [];
  const placeholder = /change[_-]?me|changeme|admin123|example/i;
  const required = [
    ['DATABASE_URL', config.databaseUrl, 12],
    ['JWT_SECRET', config.jwtSecret, 32],
    ['API_KEY', config.apiKey, 24],
    ['CENTRAL_DB_PASS', config.centralDbPass, 16]
  ];

  for (const [name, value, minLength] of required) {
    if (typeof value !== 'string' || value.length < minLength || placeholder.test(value)) {
      errors.push(`${name} debe estar configurada con al menos ${minLength} caracteres y no ser un placeholder.`);
    }
  }

  if ((config.adminUser && !config.adminPass) || (!config.adminUser && config.adminPass)) {
    errors.push('ADMIN_BOOTSTRAP_USER y ADMIN_BOOTSTRAP_PASS deben definirse juntos.');
  }
  if (!Number.isInteger(config.dockerBlkioWeight)
      || (config.dockerBlkioWeight !== 0 && (config.dockerBlkioWeight < 10 || config.dockerBlkioWeight > 1000))) {
    errors.push('DOCKER_BLKIO_WEIGHT debe ser 0 (deshabilitado) o un entero entre 10 y 1000.');
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

// 🔥 DEFINICIÓN DE LÍMITES POR PLAN (Escala 2-4-6 Cores + Backups)
export const PLAN_LIMITS = {
  hobby: {
    maxSlots: 1,
    minRamGb: 2,
    memoryBytes: 4 * 1024 * 1024 * 1024, // 4GB RAM
    nanoCpus: 2 * 10**9,                // 2.0 Cores
    storageLimit: '30G',                // 30GB NVMe
    diskBytes: 30 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem'],
    backups: { maxManual: 1, autoIntervalHours: 0, retentionDays: 0 }
  },
  standard: {
    maxSlots: 1,
    minRamGb: 2,
    memoryBytes: 8 * 1024 * 1024 * 1024, // 8GB RAM
    nanoCpus: 4 * 10**9,                // 4.0 Cores
    storageLimit: '80G',                // 80GB NVMe
    diskBytes: 80 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem', 'rust', 'cs2', 'valheim', 'zomboid', 'sdtd'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  premium: {
    maxSlots: 2,
    minRamGb: 2,
    memoryBytes: 16 * 1024 * 1024 * 1024, // 16GB RAM
    nanoCpus: 6 * 10**9,                 // 6.0 Cores
    storageLimit: '150G',                // 150GB NVMe
    diskBytes: 150 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem', 'rust', 'cs2', 'valheim', 'zomboid', 'sdtd', 'palworld'],
    backups: { maxManual: 5, autoIntervalHours: 12, retentionDays: 7 }
  },
  // 🦕 Plan Platinum: Soporte total para ARK y todos los juegos de alto rendimiento
  platinum: {
    maxSlots: 4,
    minRamGb: 2,
    memoryBytes: 32 * 1024 * 1024 * 1024, // 32GB RAM
    nanoCpus: 8 * 10**9,                  // 8.0 Cores
    storageLimit: '300G',                 // 300GB NVMe
    diskBytes: 300 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem', 'rust', 'cs2', 'valheim', 'zomboid', 'sdtd', 'palworld', 'ark'],
    backups: { maxManual: 10, autoIntervalHours: 6, retentionDays: 14 }
  },
  // 👑 Plan Ultimate: Acceso total a todos los servicios (sin restricciones para administradores)
  ultimate: {
    maxSlots: 999,
    minRamGb: 2,
    memoryBytes: 128 * 1024 * 1024 * 1024, // 128GB RAM
    nanoCpus: 32 * 10**9,                  // 32.0 Cores
    storageLimit: '1000G',                 // 1000GB NVMe
    diskBytes: 1000 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem', 'rust', 'cs2', 'valheim', 'zomboid', 'sdtd', 'palworld', 'ark', 'wordpress', 'discord_bot', 'blender'],
    backups: { maxManual: 50, autoIntervalHours: 6, retentionDays: 30 }
  },
  // 🤝 Plan Partner: El plan más alto para colaboradores y partners
  partner: {
    maxSlots: 10,
    memoryBytes: 32 * 1024 * 1024 * 1024, // 32GB RAM
    nanoCpus: 8 * 10**9,                  // 8.0 Cores
    storageLimit: '250G',                 // 250GB NVMe
    diskBytes: 250 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
    backups: { maxManual: 10, autoIntervalHours: 6, retentionDays: 14 }
  },
  // 🎮 PLANES DE SERVIDORES DEDICADOS MONOJUEGO
  game_cs2: {
    memoryBytes: 4 * 1024 * 1024 * 1024, // 4GB RAM
    nanoCpus: 2 * 10**9,                 // 2.0 Cores
    storageLimit: '20G',
    diskBytes: 20 * 1024 * 1024 * 1024,
    allowedTemplates: ['cs2'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_valheim: {
    memoryBytes: 4 * 1024 * 1024 * 1024, // 4GB RAM
    nanoCpus: 2 * 10**9,                 // 2.0 Cores
    storageLimit: '10G',
    diskBytes: 10 * 1024 * 1024 * 1024,
    allowedTemplates: ['valheim'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_minecraft: {
    memoryBytes: 4 * 1024 * 1024 * 1024, // 4GB RAM
    nanoCpus: 2 * 10**9,                 // 2.0 Cores
    storageLimit: '15G',
    diskBytes: 15 * 1024 * 1024 * 1024,
    allowedTemplates: ['minecraft'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_fivem: {
    memoryBytes: 6 * 1024 * 1024 * 1024, // 6GB RAM
    nanoCpus: 2.5 * 10**9,               // 2.5 Cores
    storageLimit: '15G',
    diskBytes: 15 * 1024 * 1024 * 1024,
    allowedTemplates: ['fivem'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_zomboid: {
    memoryBytes: 6 * 1024 * 1024 * 1024, // 6GB RAM
    nanoCpus: 2.5 * 10**9,               // 2.5 Cores
    storageLimit: '20G',
    diskBytes: 20 * 1024 * 1024 * 1024,
    allowedTemplates: ['zomboid'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_sdtd: {
    memoryBytes: 8 * 1024 * 1024 * 1024, // 8GB RAM
    nanoCpus: 3 * 10**9,                 // 3.0 Cores
    storageLimit: '25G',
    diskBytes: 25 * 1024 * 1024 * 1024,
    allowedTemplates: ['sdtd'],
    backups: { maxManual: 2, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_rust: {
    memoryBytes: 8 * 1024 * 1024 * 1024, // 8GB RAM
    nanoCpus: 3.5 * 10**9,               // 3.5 Cores
    storageLimit: '25G',
    diskBytes: 25 * 1024 * 1024 * 1024,
    allowedTemplates: ['rust'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_palworld: {
    memoryBytes: 12 * 1024 * 1024 * 1024, // 12GB RAM
    nanoCpus: 4 * 10**9,                  // 4.0 Cores
    storageLimit: '20G',
    diskBytes: 20 * 1024 * 1024 * 1024,
    allowedTemplates: ['palworld'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  game_ark: {
    memoryBytes: 16 * 1024 * 1024 * 1024, // 16GB RAM
    nanoCpus: 5 * 10**9,                  // 5.0 Cores
    storageLimit: '60G',
    diskBytes: 60 * 1024 * 1024 * 1024,
    allowedTemplates: ['ark'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  app_discordbot: {
    memoryBytes: 512 * 1024 * 1024,
    nanoCpus: 1 * 10**9,
    storageLimit: '5G',
    diskBytes: 5 * 1024 * 1024 * 1024,
    allowedTemplates: ['discordbot'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  app_wordpress: {
    memoryBytes: 2 * 1024 * 1024 * 1024,
    nanoCpus: 2 * 10**9,
    storageLimit: '15G',
    diskBytes: 15 * 1024 * 1024 * 1024,
    allowedTemplates: ['wordpress'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  },
  app_database: {
    memoryBytes: 1 * 1024 * 1024 * 1024,
    nanoCpus: 1 * 10**9,
    storageLimit: '10G',
    diskBytes: 10 * 1024 * 1024 * 1024,
    allowedTemplates: ['database'],
    backups: { maxManual: 3, autoIntervalHours: 24, retentionDays: 3 }
  }
};

export const generateSecurePassword = () => crypto.randomBytes(8).toString('hex');
