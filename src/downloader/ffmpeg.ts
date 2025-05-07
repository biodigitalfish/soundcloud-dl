import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { Logger, LogLevel } from "../utils/logger";
import { getPathFromExtensionFile } from "../compatibility/compatibilityStubs";

const baseLogger = Logger.create("FFmpegInstance", LogLevel.Debug); // Base logger for instances

// No longer a single global instance exported directly
// export const ffmpeg = new FFmpeg(); 
// let ffmpegLoaded = false;
// let ffmpegLoadPromise: Promise<boolean> | null = null;

// Removed global ffmpeg.on("log") here, will be set per instance

export async function createAndLoadFFmpegInstance(instanceId?: string | number): Promise<FFmpeg | null> {
    const instanceLogger = instanceId ? Logger.create(`FFmpegInstance:${instanceId}`, LogLevel.Debug) : baseLogger;
    const newFfmpeg = new FFmpeg();

    newFfmpeg.on("log", ({ message }) => {
        if (!message.startsWith("frame=")) {
            instanceLogger.logDebug(`[FFMPEG_WASM_LOG] ${message}`);
        }
    });

    instanceLogger.logInfo("[FFMPEG_WASM] Initializing new FFmpeg.wasm instance from local files (using toBlobURL strategy)...");

    try {
        const corePathSuffix = "ffmpeg-core/";
        // IMPORTANT: getPathFromExtensionFile needs to be robust for multiple calls
        // Assuming it consistently returns the correct path relative to the extension root.
        const coreBaseURL = getPathFromExtensionFile(corePathSuffix);
        if (!coreBaseURL) {
            instanceLogger.logError("[FFMPEG_WASM] Failed to get base URL for FFmpeg core files.");
            return null;
        }

        const coreJsPath = coreBaseURL + "ffmpeg-core.js";
        const coreWasmPath = coreBaseURL + "ffmpeg-core.wasm";

        instanceLogger.logInfo(`[FFMPEG_WASM] Base URL for Blob: ${coreBaseURL}`);
        instanceLogger.logInfo("[FFMPEG_WASM] Attempting to create Blob URLs for core files...");

        const coreBlobURL = await toBlobURL(coreJsPath, "text/javascript");
        const wasmBlobURL = await toBlobURL(coreWasmPath, "application/wasm");
        instanceLogger.logInfo("[FFMPEG_WASM] Blob URLs created. Loading FFmpeg instance...");

        await newFfmpeg.load({
            coreURL: coreBlobURL,
            wasmURL: wasmBlobURL,
        });
        instanceLogger.logInfo("[FFMPEG_WASM] FFmpeg.wasm instance loaded successfully via Blob URLs.");
        return newFfmpeg;
    } catch (error) {
        instanceLogger.logError("[FFMPEG_WASM] Failed to load FFmpeg.wasm instance via Blob URLs", error);
        return null;
    }
    // No finally block manipulating global load promise as each instance is independent
}

// The old loadFFmpeg function is effectively replaced by createAndLoadFFmpegInstance.
// If other parts of your code were calling loadFFmpeg() expecting it to prepare a global instance,
// those parts will need to be updated to work with the new instance-based approach,
// likely via an FFMPEG manager. 