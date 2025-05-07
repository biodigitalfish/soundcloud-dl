import { Logger, LogLevel } from "../utils/logger"; // Assuming logger is in utils

const logger = Logger.create("Semaphore", LogLevel.Debug);

export class Semaphore {
    private tasks: (() => void)[] = [];
    private count: number;
    private readonly maxCount: number;

    constructor(count: number) {
        if (count <= 0) {
            throw new Error("Semaphore count must be a positive integer.");
        }
        this.count = count;
        this.maxCount = count;
    }

    private async acquire(): Promise<void> {
        logger.logDebug(`Acquire attempt: current count ${this.count}, tasks in queue ${this.tasks.length}`);
        if (this.count > 0) {
            this.count--;
            logger.logDebug(`Acquired immediately. New count ${this.count}`);
            return Promise.resolve();
        }
        // Wait for a slot to be released
        return new Promise<void>((resolve) => {
            this.tasks.push(resolve);
            logger.logDebug(`Queued. New queue length ${this.tasks.length}`);
        });
    }

    private release(): void {
        this.count++;
        logger.logDebug(`Released. New count ${this.count}`);
        if (this.tasks.length > 0) {
            const nextTaskResolve = this.tasks.shift();
            if (nextTaskResolve) {
                this.count--; // Re-acquire for the new task that is about to be resolved
                logger.logDebug(`Processing queued task. New count ${this.count}, New queue length ${this.tasks.length}`);
                nextTaskResolve();
            }
        }
        if (this.count > this.maxCount) {
            logger.logWarn(`Semaphore count (${this.count}) exceeded maxCount (${this.maxCount}) after release. This might indicate an issue.`);
            this.count = this.maxCount; // Correct it
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
        return this.tasks.length;
    }
} 