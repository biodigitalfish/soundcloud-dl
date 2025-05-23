import { FFmpeg } from "@ffmpeg/ffmpeg";
import { Logger, LogLevel } from "../utils/logger";
import { createAndLoadFFmpegInstance } from "./ffmpeg";
import { getConfigValue } from "../settings/config";

const logger = Logger.create("FFmpegManager", LogLevel.Debug);

// const MAX_CONCURRENT_OPERATIONS = 2; // Old hardcoded value
const initialMaxFFmpegOperations = Math.max(1, Math.min(Number(getConfigValue("maxConcurrentTrackDownloads")) || 2, 10));
// Defaulting to 2 if config is not found, and clamped 1-10. 
// This uses the same config key as general track downloads for simplicity.
const MAX_CONCURRENT_OPERATIONS = initialMaxFFmpegOperations;
logger.logInfo(`FFmpegManager initialized with MAX_CONCURRENT_OPERATIONS: ${MAX_CONCURRENT_OPERATIONS}`);

interface FFmpegInstanceWrapper {
    id: number;
    instance: FFmpeg;
    isAvailable: boolean;
    isCompromised: boolean;
}

interface RemuxTask {
    taskId: string; // Typically the downloadId
    inputBuffer: ArrayBuffer;
    fileExtension: string;
    progressCallback?: (progress: number) => void; // For FFMPEG internal progress
    resolve: (outputBuffer: ArrayBuffer) => void;
    reject: (error: any) => void;
}

const ffmpegPool: FFmpegInstanceWrapper[] = [];
const taskQueue: RemuxTask[] = [];
let poolInitialized = false;
let poolInitializationPromise: Promise<void> | null = null;

async function initializePool(): Promise<void> {
    if (poolInitialized) return Promise.resolve();
    if (poolInitializationPromise) return poolInitializationPromise;

    logger.logInfo(`Initializing FFmpeg instance pool with size: ${MAX_CONCURRENT_OPERATIONS}`);
    poolInitializationPromise = (async () => {
        try {
            const loadPromises: Promise<FFmpeg | null>[] = [];
            for (let i = 0; i < MAX_CONCURRENT_OPERATIONS; i++) {
                loadPromises.push(createAndLoadFFmpegInstance(i));
            }

            const loadedInstances = await Promise.all(loadPromises);

            for (let i = 0; i < loadedInstances.length; i++) {
                const instance = loadedInstances[i];
                if (instance) {
                    ffmpegPool.push({ id: i, instance, isAvailable: true, isCompromised: false });
                } else {
                    logger.logError(`Failed to load FFmpeg instance ${i} for the pool.`);
                }
            }

            if (ffmpegPool.length === 0 && MAX_CONCURRENT_OPERATIONS > 0) {
                throw new Error("No FFmpeg instances could be initialized for the pool.");
            }

            poolInitialized = true;
            logger.logInfo(`FFmpeg instance pool initialized with ${ffmpegPool.length} instances.`);
        } catch (error) {
            logger.logError("Failed to initialize FFmpeg pool", error);
            poolInitialized = false; // Ensure it can be retried if needed
            poolInitializationPromise = null; // Reset promise on failure
            throw error; // Re-throw to propagate the error
        }
    })();
    return poolInitializationPromise;
}

async function _performRemux(instanceWrapper: FFmpegInstanceWrapper, task: RemuxTask): Promise<void> {
    const { instance, id: instanceId } = instanceWrapper;
    const { taskId, inputBuffer, fileExtension, progressCallback, resolve, reject } = task;

    const inputFilename = `input_${taskId}_${instanceId}.${fileExtension || "mp4"}`;
    const outputFilename = `output_remuxed_${taskId}_${instanceId}.${fileExtension || "mp4"}`;
    logger.logInfo(`[FFmpegManager] Instance ${instanceId} starting remux for task ${taskId}: ${inputFilename} -> ${outputFilename}`);

    let ffmpegProgressHandler: (({ progress }: { progress: number; }) => void) | undefined;

    try {
        let uInt8ArrayBuffer: Uint8Array;
        try {
            logger.logDebug(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: Attempting inputBuffer.slice(0). Input buffer byteLength: ${inputBuffer?.byteLength}`);
            const slicedBuffer = inputBuffer.slice(0);
            logger.logDebug(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: Successfully sliced buffer. Slice byteLength: ${slicedBuffer?.byteLength}. Attempting new Uint8Array().`);
            uInt8ArrayBuffer = new Uint8Array(slicedBuffer);
            logger.logDebug(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: Created Uint8Array with byteLength: ${uInt8ArrayBuffer?.byteLength}. About to call instance.writeFile with ${inputFilename}.`);
        } catch (bufferError) {
            logger.logError(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: ERROR during buffer slice or Uint8Array creation:`, bufferError);
            throw bufferError; // Re-throw to be caught by the outer catch
        }

        await instance.writeFile(inputFilename, uInt8ArrayBuffer);
        logger.logDebug(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: Successfully called instance.writeFile with ${inputFilename}.`);

        const ffmpegArgs = ["-loglevel", "debug", "-i", inputFilename, "-c", "copy", outputFilename];
        logger.logDebug(`[FFmpegManager] Instance ${instanceId}, Task ${taskId}: FFmpeg exec arguments:`, ffmpegArgs);

        if (progressCallback) {
            let lastReportedFFmpegProgress = -1;
            ffmpegProgressHandler = ({ progress }: { progress: number }) => {
                const currentFFmpegProgress = Math.round(progress * 100);
                if (currentFFmpegProgress > lastReportedFFmpegProgress && currentFFmpegProgress <= 100) {
                    // Example: FFMPEG remuxing can be considered a part of total progress,
                    // e.g., from 85% to 98%. The caller needs to scale this.
                    progressCallback(currentFFmpegProgress);
                    lastReportedFFmpegProgress = currentFFmpegProgress;
                }
            };
            instance.on("progress", ffmpegProgressHandler);
        }

        await instance.exec(ffmpegArgs);
        const outputData = await instance.readFile(outputFilename);

        if (typeof outputData === "string") {
            throw new Error("FFmpeg remux output was a string, expected Uint8Array");
        }

        logger.logInfo(`[FFmpegManager] Instance ${instanceId} finished remux for task ${taskId}`);
        resolve(outputData.buffer.slice(0)); // Resolve with a copy of the buffer

    } catch (error) {
        logger.logError(`[FFmpegManager] Instance ${instanceId} FAILED remux for task ${taskId}`, error);
        instanceWrapper.isCompromised = true; // Mark as compromised
        reject(error);
    } finally {
        if (ffmpegProgressHandler && typeof instance.off === "function") {
            instance.off("progress", ffmpegProgressHandler);
        }
        try {
            await instance.deleteFile(inputFilename);
            await instance.deleteFile(outputFilename);
        } catch (cleanupError) {
            logger.logWarn(`[FFmpegManager] Instance ${instanceId} failed to cleanup files for task ${taskId}`, cleanupError);
            instanceWrapper.isCompromised = true; // Mark as compromised if cleanup fails too
        }
    }
}

function processQueue(): void {
    if (!poolInitialized || taskQueue.length === 0) {
        return;
    }

    const availableInstanceWrapper = ffmpegPool.find(iw => iw.isAvailable);
    if (!availableInstanceWrapper) {
        logger.logDebug("No FFmpeg instance available right now, queue length: " + taskQueue.length);
        return;
    }

    const taskToProcess = taskQueue.shift();
    if (!taskToProcess) {
        return; // Should not happen if queue.length > 0
    }

    availableInstanceWrapper.isAvailable = false;
    logger.logDebug(`Assigning task ${taskToProcess.taskId} to FFmpeg instance ${availableInstanceWrapper.id}`);

    _performRemux(availableInstanceWrapper, taskToProcess)
        .finally(async () => {
            if (availableInstanceWrapper.isCompromised) {
                logger.logWarn(`[FFmpegManager] Instance ${availableInstanceWrapper.id} is compromised. Terminating and attempting to replace.`);
                try {
                    await availableInstanceWrapper.instance.terminate();
                    logger.logInfo(`[FFmpegManager] Terminated compromised instance ${availableInstanceWrapper.id}.`);
                } catch (terminateError) {
                    logger.logError(`[FFmpegManager] Error terminating compromised instance ${availableInstanceWrapper.id}:`, terminateError);
                }

                // Remove from pool
                const poolIndex = ffmpegPool.findIndex(iw => iw.id === availableInstanceWrapper.id);
                if (poolIndex > -1) {
                    ffmpegPool.splice(poolIndex, 1);
                }

                // Attempt to create and add a new instance
                logger.logInfo(`[FFmpegManager] Attempting to create new FFmpeg instance to replace ${availableInstanceWrapper.id}.`);
                const newInstance = await createAndLoadFFmpegInstance(availableInstanceWrapper.id); // Reuse ID for logging context
                if (newInstance) {
                    ffmpegPool.push({
                        id: availableInstanceWrapper.id, // Keep original ID for slot reference
                        instance: newInstance,
                        isAvailable: true,
                        isCompromised: false
                    });
                    logger.logInfo(`[FFmpegManager] Successfully replaced instance ${availableInstanceWrapper.id}. Pool size: ${ffmpegPool.length}`);
                } else {
                    logger.logError(`[FFmpegManager] Failed to create new FFmpeg instance to replace ${availableInstanceWrapper.id}. Pool size will be reduced.`);
                }
            } else {
                availableInstanceWrapper.isAvailable = true;
                logger.logDebug(`FFmpeg instance ${availableInstanceWrapper.id} is now available.`);
            }
            processQueue(); // Attempt to process next task
        });
}

export async function requestRemux(
    taskId: string, // Typically the downloadId
    inputBuffer: ArrayBuffer,
    fileExtension: string,
    ffmpegProgress?: (ffmpegInternalProgress: number) => void // Callback for FFMPEG's own 0-100% progress
): Promise<ArrayBuffer> {
    if (!poolInitialized && !poolInitializationPromise) {
        initializePool().catch(err => {
            logger.logError("FFmpeg Pool Initialization failed lazily, subsequent requests might fail.", err);
            // Don't rethrow here as the promise for this request will handle it.
        });
    }
    // Wait for initialization if it's in progress
    if (poolInitializationPromise) {
        await poolInitializationPromise;
    }

    if (!poolInitialized || ffmpegPool.length === 0) {
        return Promise.reject(new Error("FFmpegManager: Pool not initialized or no instances available after init attempt."));
    }

    return new Promise<ArrayBuffer>((resolve, reject) => {
        logger.logDebug(`Task ${taskId} added to FFmpeg remux queue.`);
        taskQueue.push({
            taskId,
            inputBuffer,
            fileExtension,
            progressCallback: ffmpegProgress, // Pass the FFMPEG specific progress callback
            resolve,
            reject,
        });
        processQueue();
    });
}

// Optional: Pre-initialize the pool when the background script starts.
// This can be called from background.ts after initial config load.
export function preInitializeFFmpegPool(): void {
    if (!poolInitialized && !poolInitializationPromise) {
        initializePool().catch(err => {
            logger.logError("Pre-initialization of FFmpeg Pool failed.", err);
        });
    }
} 