import { enqueueBackup, getBackupJob } from '../repositories/backupJobRepository.js';

// Fachada compartida por las rutas y los programadores; el estado vive en PostgreSQL.
export const backupQueue = {
  enqueue: enqueueBackup,
  getJob: getBackupJob
};
