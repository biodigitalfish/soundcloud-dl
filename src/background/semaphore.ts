import { Logger, LogLevel } from "../utils/logger"; // Assuming logger is in utils

const logger = Logger.create("Semaphore", LogLevel.Debug);

export class Semaphore {
    private count: number;
    private readonly maxCount: number;
    private waiting: Array<() => void> = [];

    constructor(count: number) {
        if (count <= 0) {
            throw new Error("Semaphore count must be a positive integer.");
        }
        this.count = count;
        this.maxCount = count;
    }

    public async acquire(): Promise<void> {
        logger.logDebug(`Acquire attempt: current count ${this.count}, waiting queue ${this.waiting.length}`);
        if (this.count > 0) {
            this.count--;
            logger.logDebug(`Acquired immediately. New count ${this.count}`);
            return Promise.resolve();
        }
        // If no permits are available, wait
        return new Promise<void>((resolve) => {
            this.waiting.push(resolve);
            logger.logDebug(`Queued. New queue length ${this.waiting.length}`);
        });
    }

    public release(): void {
        if (this.waiting.length > 0) {
            const nextResolve = this.waiting.shift();
            if (nextResolve) {
                logger.logDebug(`Releasing permit to a waiting task. Queue length now ${this.waiting.length}`);
                nextResolve();
            } else {
                this.count++;
                logger.logWarn("[Semaphore] Shift from waiting queue returned undefined, but queue was not empty. Incrementing count.");
            }
        } else {
            this.count++;
            logger.logDebug(`Permit released to pool. New count ${this.count}`);
        }

        if (this.count > this.maxCount) {
            logger.logWarn(`Semaphore count (${this.count}) exceeded maxCount (${this.maxCount}) after release. Correcting.`);
            this.count = this.maxCount;
        }
    }

    public async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    public getAvailablePermits(): number {
        return this.count;
    }

    public getQueueLength(): number {
        return this.waiting.length;
    }
} 