import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { Logger, LogLevel } from "./utils/logger"; // Assuming logger is in utils
import { getPathFromExtensionFile } from "./compatibilityStubs";

const logger = Logger.create("FFmpegSetup", LogLevel.Debug); // Or adjust logger name/level

// --- FFmpeg.wasm setup ---
export const ffmpeg = new FFmpeg(); // Export if needed by other parts, or keep internal
let ffmpegLoaded = false;
let ffmpegLoadPromise: Promise<boolean> | null = null;

ffmpeg.on("log", ({ message }) => {
    // Avoid logging every single progress line if too verbose, or filter by type
    if (!message.startsWith("frame=")) { // Example filter
        logger.infoDebug(`[FFMPEG_WASM] ${message}`);
    }
});

export async function loadFFmpeg(): Promise<boolean> {
    if (ffmpegLoaded) return true;
    if (ffmpegLoadPromise) return ffmpegLoadPromise;

    logger.infoInfo("[FFMPEG_WASM] Initializing FFmpeg.wasm from local files (using toBlobURL strategy)...");
    ffmpegLoadPromise = (async () => {
        try {
            const corePathSuffix = "ffmpeg-core/";
            const coreBaseURL = getPathFromExtensionFile(corePathSuffix);
            if (!coreBaseURL) {
                logger.infoError("[FFMPEG_WASM] Failed to get base URL for FFmpeg core files.");
                return false;
            }

            const coreJsPath = coreBaseURL + "ffmpeg-core.js";
            const coreWasmPath = coreBaseURL + "ffmpeg-core.wasm";

            logger.infoInfo(`[FFMPEG_WASM] Base URL for Blob: ${coreBaseURL}`);
            logger.infoInfo("[FFMPEG_WASM] Attempting to create Blob URLs for core files...");

            // Use toBlobURL for both core JS and WASM
            const coreBlobURL = await toBlobURL(coreJsPath, "text/javascript");
            const wasmBlobURL = await toBlobURL(coreWasmPath, "application/wasm");
            logger.infoInfo("[FFMPEG_WASM] Blob URLs created. Loading FFmpeg...");

            await ffmpeg.load({
                coreURL: coreBlobURL,
                wasmURL: wasmBlobURL,
            });
            ffmpegLoaded = true;
            logger.infoInfo("[FFMPEG_WASM] FFmpeg.wasm loaded successfully via Blob URLs.");
            return true;
        } catch (error) {
            logger.infoError("[FFMPEG_WASM] Failed to load FFmpeg.wasm via Blob URLs", error);
            ffmpegLoaded = false;
            return false;
        } finally {
            if (!ffmpegLoaded) ffmpegLoadPromise = null;
        }
    })();
    return ffmpegLoadPromise;
}
// --- End FFmpeg.wasm setup --- 