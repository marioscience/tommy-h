import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

export const config = {
  // Configuración del Servidor
  port: Number(process.env.PORT || 3006),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  adminUser: process.env.ADMIN_BOOTSTRAP_USER,
  adminPass: process.env.ADMIN_BOOTSTRAP_PASS,
  corsOrigin: process.env.CORS_ORIGIN || process.env.PUBLIC_BASE_URL || 'http://localhost:8088',

  // 🤖 CONFIGURACIÓN DEL BOT DE DISCORD — Sin fallback inseguro: falla en arranque si no está configurada
  apiKey: process.env.API_KEY,

  // Rutas y Docker
  instanceDataRoot: process.env.INSTANCE_DATA_ROOT || '/srv/ragenodes-data',
  containerPrefix: process.env.CONTAINER_PREFIX || 'ragenodes-',
  dockerNetwork: process.env.DOCKER_NETWORK || 'ragenodes_net',
  portBaseOffset: Number(process.env.PORT_BASE_OFFSET || 0),
  projectRoot: process.env.PROJECT_ROOT || process.cwd(),
  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',

  // 📦 BACKUPS
  backupRoot: process.env.BACKUP_ROOT || '/srv/ragenodes-backups',

  // Imágenes base
  fivemBaseImage: process.env.FIVEM_BASE_IMAGE || 'ragenodes-fivem-base:latest',
  blenderBaseImage: process.env.BLENDER_BASE_IMAGE || 'ragenodes-blender-web:latest',
  minecraftBaseImage: process.env.MINECRAFT_BASE_IMAGE || 'itzg/minecraft-server:java25',
  rustBaseImage: process.env.RUST_BASE_IMAGE || 'didstopia/rust-server:latest',
  palworldBaseImage: process.env.PALWORLD_BASE_IMAGE || 'thijsvanloef/palworld-server-docker:latest',
  cs2BaseImage: process.env.CS2_BASE_IMAGE || 'cm2network/cs2:latest',
  valheimBaseImage: process.env.VALHEIM_BASE_IMAGE || 'lloesche/valheim-server:latest',
  zomboidBaseImage: process.env.ZOMBOID_BASE_IMAGE || 'ich777/projectzomboid:latest',
  arkBaseImage: process.env.ARK_BASE_IMAGE || 'auhrus/arksurvivalascended-server:latest',
  sdtdBaseImage: process.env.SDTD_BASE_IMAGE || 'didstopia/7dtd-server:latest',
  discordBotBaseImage: process.env.DISCORD_BOT_BASE_IMAGE || 'nikolaik/python-nodejs:python3.10-nodejs18',
  wordpressBaseImage: process.env.WORDPRESS_BASE_IMAGE || 'wordpress:latest',
  databaseBaseImage: process.env.DATABASE_BASE_IMAGE || 'mariadb:10.11',

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
  centralDbPass: process.env.CENTRAL_DB_PASS || 'ragenodes_mariadb_root_pass_change_me',

  // ☁️ CLOUDFLARE AUTOMATION CONFIG
  cfAccountId: process.env.CF_ACCOUNT_ID,
  cfZoneId: process.env.CF_ZONE_ID,
  cfTunnelId: process.env.CF_TUNNEL_ID,
  cfApiToken: process.env.CF_API_TOKEN,
  cfEmail: process.env.CF_EMAIL,
  cfDdnsDomain: process.env.CF_DDNS_DOMAIN,
  allowLocalAdmin: process.env.ALLOW_LOCAL_ADMIN === 'true'
};

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
  // 🤝 Plan Partner: El plan más alto para colaboradores y partners
  partner: {
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
