import { createFullBackup } from './backupService.js';

const RESULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.BACKUP_CONCURRENCY || 1));

class BackupQueue {
    constructor(maxConcurrency = DEFAULT_CONCURRENCY) {
        this.queue = [];
        this.activeCount = 0;
        this.maxConcurrency = maxConcurrency;
        this.jobs = new Map();
        this.activeByServer = new Map();
    }

    enqueue(serverId, userId, isAdmin, customName, plan = 'hobby') {
        const existingJobId = this.activeByServer.get(serverId);
        if (existingJobId) {
            const existing = this.jobs.get(existingJobId);
            if (existing && ['queued', 'processing'].includes(existing.status)) {
                return this.publicJob(existing);
            }
        }

        const jobId = `${serverId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job = {
            jobId,
            serverId,
            userId,
            isAdmin,
            customName,
            plan,
            priority: this.getPriority(plan),
            status: 'queued',
            addedAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            result: null,
            error: null
        };

        this.jobs.set(jobId, job);
        this.activeByServer.set(serverId, jobId);
        this.queue.push(job);
        this.sortQueue();
        this.cleanup();

        console.log(`[BackupQueue] Job ${jobId} encolado. Servidor: ${serverId} | Plan: ${plan} | Prioridad: ${job.priority}`);
        queueMicrotask(() => this.process());
        return this.publicJob(job);
    }

    getPriority(plan) {
        const p = String(plan || '').toLowerCase();
        if (p === 'partner') return 120;
        if (p === 'platinum' || p === 'elite' || p === 'premium') return 100;
        if (p === 'standard') return 50;
        return 10;
    }

    sortQueue() {
        this.queue.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return a.addedAt - b.addedAt;
        });
    }

    process() {
        while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
            const job = this.queue.shift();
            this.runJob(job).catch((err) => {
                console.error(`[BackupQueue] Error no capturado en ${job.jobId}:`, err);
            });
        }
    }

    async runJob(job) {
        this.activeCount += 1;
        job.status = 'processing';
        job.startedAt = Date.now();
        console.log(`[BackupQueue] Procesando ${job.jobId} (${this.activeCount}/${this.maxConcurrency})`);

        try {
            job.result = await createFullBackup(job.serverId, job.userId, job.isAdmin, job.customName);
            job.status = 'completed';
        } catch (err) {
            console.error(`[BackupQueue] Error en backup ${job.jobId}:`, err.message);
            job.status = 'failed';
            job.error = err.message;
        } finally {
            job.finishedAt = Date.now();
            this.activeCount -= 1;
            if (this.activeByServer.get(job.serverId) === job.jobId) {
                this.activeByServer.delete(job.serverId);
            }
            this.cleanup();
            this.process();
        }
    }

    getJob(jobId, requesterId, isAdmin = false) {
        const job = this.jobs.get(jobId);
        if (!job) return null;
        if (!isAdmin && String(job.userId) !== String(requesterId)) return null;
        return this.publicJob(job);
    }

    publicJob(job) {
        return {
            jobId: job.jobId,
            serverId: job.serverId,
            status: job.status,
            plan: job.plan,
            queuePosition: job.status === 'queued' ? this.queue.findIndex(item => item.jobId === job.jobId) + 1 : 0,
            activeCount: this.activeCount,
            maxConcurrency: this.maxConcurrency,
            addedAt: job.addedAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            result: job.result,
            error: job.error
        };
    }

    cleanup() {
        const cutoff = Date.now() - RESULT_TTL_MS;
        for (const [jobId, job] of this.jobs.entries()) {
            if (['completed', 'failed'].includes(job.status) && job.finishedAt && job.finishedAt < cutoff) {
                this.jobs.delete(jobId);
            }
        }
    }
}

export const backupQueue = new BackupQueue();