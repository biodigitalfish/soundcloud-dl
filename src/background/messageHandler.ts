import { SoundCloudApi, Track } from "../api/soundcloudApi";
import { LogLevel, Logger } from "../utils/logger";
import { downloadTrack } from "../downloader/downloadHandler";
import {
    sendDownloadProgress,
    chunkArray,
} from "./background";
import { sendMessageToTab } from "../compatibility/compatibilityStubs";
import {
    DownloadRequest,
    DownloadSetRangeRequest,
    Playlist,
} from "../types";
import { loadConfigValue, storeConfigValue, getConfigValue, loadConfiguration, configKeys, Config } from "../settings/config";
import { MetadataExtractor } from "../downloader/metadataExtractor";
import { eraseDownloadHistoryEntry } from "../utils/browser";
import { Semaphore } from "./semaphore";
import { downloadQueue, QueueItem, triggerProcessQueue, broadcastQueueUpdate, saveQueueState } from "./background";
import { Mp4 } from "../downloader/tagWriters/mp4TagWriter";

// Message Type Constants
export const DOWNLOAD_SET = "DOWNLOAD_SET";
export const DOWNLOAD = "DOWNLOAD";
export const DOWNLOAD_SET_RANGE = "DOWNLOAD_SET_RANGE";
export const PAUSE_DOWNLOAD = "PAUSE_DOWNLOAD";
export const RESUME_DOWNLOAD = "RESUME_DOWNLOAD";
export const PAUSE_ALL_DOWNLOADS = "PAUSE_ALL_DOWNLOADS";
export const RESUME_ALL_DOWNLOADS = "RESUME_ALL_DOWNLOADS";
export const GET_GLOBAL_PAUSE_STATE = "GET_GLOBAL_PAUSE_STATE";
const GET_QUEUE_DATA = "GET_QUEUE_DATA"; // Define as const for safety
const GET_EXTENSION_CONFIG = "GET_EXTENSION_CONFIG"; // Define as const

// Local TrackError for message handling issues, or import a general one if suitable
class MessageHandlerError extends Error {
    constructor(message: string) {
        super(message);
    }
}

// State for paused downloads
const pausedDownloads: { [key: string]: boolean } = {};

// Global pause state - to be managed by new handlers
// This will be imported from background.ts or managed via functions exported from there
// For now, we assume background.ts will expose ways to set/get this
// import { getGlobalPauseState, setGlobalPauseState, clearGlobalPauseState } from './background'; // Ideal

const soundcloudApi = new SoundCloudApi();
const logger = Logger.create("MessageHandler", LogLevel.Debug);

// Main message handling function
// Temporarily using 'any' for message type to bypass linter issues with 'payload'.
// TODO: Define proper union type for BackgroundMessage (DownloadRequest | ExtractScidRequest | RestoreHistoryRequest)
// and use that here, then import it.
export async function handleIncomingMessage(message: any, sender: chrome.runtime.MessageSender) {
    // --- Add critical logging at the very beginning ---
    let receivedMessageForLog = {};
    try {
        receivedMessageForLog = JSON.parse(JSON.stringify(message));
    } catch (_e) {
        receivedMessageForLog = { errorParsingMessage: true, rawMessage: String(message) };
    }
    logger.logDebug("[MessageHandler DEBUG] Received message:", receivedMessageForLog);

    const typesAllowedWithoutDownloadId = [
        GET_EXTENSION_CONFIG,
        GET_QUEUE_DATA,
        PAUSE_ALL_DOWNLOADS,
        RESUME_ALL_DOWNLOADS,
        GET_GLOBAL_PAUSE_STATE,
        "EXTRACT_SCID_FROM_M4A",
        "RESTORE_HISTORY_FROM_IDS"
    ];
    if (!message || (message.downloadId === undefined && message.type !== undefined && !typesAllowedWithoutDownloadId.includes(message.type))) {
        logger.logError(
            `CRITICAL: MessageHandler received message with type ${message.type} that requires a downloadId, but it was missing!`,
            receivedMessageForLog
        );
    }

    const tabId = sender.tab?.id;
    const { downloadId, url, type } = message;

    const typesAllowedWithoutTabId = [
        GET_EXTENSION_CONFIG,
        GET_QUEUE_DATA,
        PAUSE_ALL_DOWNLOADS,
        RESUME_ALL_DOWNLOADS,
        GET_GLOBAL_PAUSE_STATE
    ];
    if (!tabId && type && !typesAllowedWithoutTabId.includes(type)) {
        logger.logWarn(`Message type ${type} received without a valid tab ID and is not allowed.`, { sender, message });
        return { error: `No valid tab ID found for message type ${type}` };
    }

    if (type === GET_EXTENSION_CONFIG) {
        logger.logDebug(`[MessageHandler] Received GET_EXTENSION_CONFIG request from tab ${tabId}`);
        try {
            const currentFullConfig = await loadConfiguration(false);
            const nonSecretConfig: Partial<Record<keyof Config, { value: any }>> = {};

            for (const key of configKeys) {
                if (!currentFullConfig[key].secret) {
                    nonSecretConfig[key] = { value: currentFullConfig[key].value };
                }
            }
            logger.logDebug("[MessageHandler] Sending non-secret configuration to content script:", nonSecretConfig);
            return Promise.resolve(nonSecretConfig);
        } catch (err) {
            logger.logError("[MessageHandler] Error loading or preparing configuration for content script:", err);
            return Promise.reject({ error: "Failed to retrieve extension configuration." });
        }
    }

    // Ensure tabId is valid for messages that require it (those not in typesAllowedWithoutTabId)
    // This check is somewhat redundant now given the one above but provides an additional safeguard
    // if the logic branches in a way that bypasses the first tabId check for other types.
    if (type && !typesAllowedWithoutTabId.includes(type) && !tabId) {
        logger.logError(`CRITICAL: Message type ${type} requires a tabId, but it was missing after initial checks.`, { sender, message });
        return { error: `Missing tab ID for message type ${type}` };
    }

    if (type === DOWNLOAD || type === DOWNLOAD_SET || type === DOWNLOAD_SET_RANGE) {
        if (!tabId) { // Should be caught by above, but defensive check
            logger.logError(`CRITICAL: Download operation ${type} missing tabId.`);
            return { error: "Download operations require a tabId." };
        }
        logger.logInfo(`[MessageHandler] Queuing request: ${type} for URL: ${url} with ID: ${downloadId}`);

        const queueItem: QueueItem = {
            id: downloadId, // This is the originalDownloadId from content script
            type: type as "DOWNLOAD" | "DOWNLOAD_SET" | "DOWNLOAD_SET_RANGE", // Cast to be sure
            url: url!, // url should be defined for these types
            originalMessage: message, // Store the full original message
            status: "pending",
            tabId: tabId,
            addedAt: Date.now(),
            // title: could be pre-filled if easily available, or fetched by processor
        };

        downloadQueue.push(queueItem);
        await saveQueueState();
        logger.logDebug(`[MessageHandler] Item added to queue and saved. Current queue size: ${downloadQueue.length}`, queueItem);
        broadcastQueueUpdate(); // Broadcast change after adding

        // Acknowledge to content script
        const ackPayload = {
            success: true,
            message: `${type} request added to queue.`,
            originalDownloadId: downloadId // send back the ID content script expects
        };
        // No need to await sendMessageToTab for an ack if we're not acting on its response here
        sendMessageToTab(tabId, ackPayload)
            .then(() => logger.logInfo(`[MessageHandler TX Ack] Queued ACK for ${downloadId} sent to tab ${tabId}.`))
            .catch(e => logger.logError(`[MessageHandler TX Ack] Queued ACK for ${downloadId} FAILED to send to tab ${tabId}:`, e));

        triggerProcessQueue(); // Tell background to check the queue

        // The promise from handleIncomingMessage should resolve with the ackPayload
        // The actual download processing is now detached.
        return Promise.resolve(ackPayload);

    } else if (type === PAUSE_ALL_DOWNLOADS) {
        logger.logInfo("[MessageHandler] Received PAUSE_ALL_DOWNLOADS request.");
        // This is where we'd call await setGlobalPauseState(true) from background.ts
        // For now, let's simulate the interaction with background.ts state via direct manipulation
        // Needs to be replaced with actual call to background.ts function
        // e.g. background.setGlobalPauseState(true);
        // And then broadcast this change to all content scripts / popups
        // background.broadcastGlobalPauseStateChange(true);
        Object.keys(downloadQueue).forEach(itemId => {
            // This is a conceptual illustration; direct manipulation of `pausedDownloads` for ALL items
            // might conflict if individual pause is also used. The `isGloballyPaused` flag in background.ts
            // is the primary mechanism.
            // Individual items are not marked as paused here, the global flag handles it.
        });
        // Placeholder: directly update a conceptual global pause state. This needs to be in background.ts
        // For now, this simulates the action. Background.ts will need `setGlobalPauseFlag(true)`
        globalThis.isBackgroundGloballyPaused = true; // SIMULATION
        triggerProcessQueue(); // To make queue processor re-evaluate based on new global pause state
        return Promise.resolve({ success: true, message: "All downloads paused globally." });

    } else if (type === RESUME_ALL_DOWNLOADS) {
        logger.logInfo("[MessageHandler] Received RESUME_ALL_DOWNLOADS request.");
        // e.g. background.setGlobalPauseState(false);
        // background.broadcastGlobalPauseStateChange(false);
        // Placeholder: direct manipulation
        globalThis.isBackgroundGloballyPaused = false; // SIMULATION
        triggerProcessQueue(); // Kick off processing for any pending/paused items
        return Promise.resolve({ success: true, message: "All downloads resumed globally." });

    } else if (type === GET_GLOBAL_PAUSE_STATE) {
        logger.logInfo("[MessageHandler] Received GET_GLOBAL_PAUSE_STATE request.");
        // e.g. const state = await background.getGlobalPauseState();
        // Placeholder: direct access
        const isPaused = !!globalThis.isBackgroundGloballyPaused; // SIMULATION
        return Promise.resolve({ isGloballyPaused: isPaused });

    } else if (type === "EXTRACT_SCID_FROM_M4A") {
        if (!message.payload || !message.payload.buffer || !message.payload.filename) {
            logger.logError("[MessageHandler] Invalid payload for EXTRACT_SCID_FROM_M4A:", message.payload);
            // No sendResponse here as it might be handled by original onMessage in background if error occurs early
            // However, for a clean API, this function should manage its response.
            // Let's assume sendResponse is available if called from a context that provides it.
            // The background.ts onMessage wrapper should handle sending the response.
            return Promise.reject({ error: "Invalid payload for SCID extraction." }); // Should be caught by caller
        }

        const { filename, buffer } = message.payload as { filename: string, buffer: ArrayBuffer }; // Type assertion
        logger.logInfo(`[MessageHandler] EXTRACT_SCID_FROM_M4A: Received buffer for ${filename} (size: ${buffer.byteLength})`);

        try {
            const mp4Parser = new Mp4(buffer);
            mp4Parser.parse();

            if (!mp4Parser.hasValidMp4Structure) {
                logger.logWarn(`[MessageHandler] EXTRACT_SCID_FROM_M4A: File ${filename} does not have a valid MP4 structure.`);
                return Promise.resolve({ error: `File ${filename} is not a valid MP4.` });
            }

            const scidPath = ["moov", "udta", "meta", "ilst", "scid"];
            const trackId = mp4Parser.findAndReadTextAtomData(scidPath);

            if (trackId) {
                logger.logInfo(`[MessageHandler] EXTRACT_SCID_FROM_M4A: Extracted SCID '${trackId}' from ${filename}`);
                return Promise.resolve({ trackId: trackId });
            } else {
                logger.logWarn(`[MessageHandler] EXTRACT_SCID_FROM_M4A: SCID atom not found or no data in ${filename}`);
                return Promise.resolve({ error: `SCID not found in ${filename}` });
            }
        } catch (error: any) {
            logger.logError(`[MessageHandler] EXTRACT_SCID_FROM_M4A: Error parsing ${filename}:`, error);
            return Promise.resolve({ error: `Error parsing MP4 file ${filename}: ${error.message || error}` });
        }

    } else if (type === "RESTORE_HISTORY_FROM_IDS") {
        if (!message.payload || !Array.isArray(message.payload.trackIds)) {
            logger.logError("[MessageHandler] Invalid payload for RESTORE_HISTORY_FROM_IDS:", message.payload);
            return Promise.reject({ error: "Invalid payload for history restoration." });
        }

        const { trackIds } = message.payload as { trackIds: string[] }; // Type assertion
        logger.logInfo(`[MessageHandler] RESTORE_HISTORY_FROM_IDS: Received ${trackIds.length} track IDs to restore.`);

        if (trackIds.length === 0) {
            return Promise.resolve({ message: "No track IDs provided to restore." });
        }

        try {
            const currentHistory = await getConfigValue("track-download-history") || {};
            let restoredCount = 0;
            trackIds.forEach(trackId => {
                if (typeof trackId === "string" && trackId.trim() !== "") {
                    const key = `track-${trackId}`;
                    if (!currentHistory[key]) {
                        currentHistory[key] = {
                            filename: `Restored: TrackID ${trackId}`,
                            timestamp: Date.now()
                        };
                        restoredCount++;
                    } else {
                        logger.logDebug(`[MessageHandler] RESTORE_HISTORY_FROM_IDS: Track ${trackId} already in history, skipping.`);
                    }
                }
            });

            await storeConfigValue("track-download-history", currentHistory);
            logger.logInfo(`[MessageHandler] RESTORE_HISTORY_FROM_IDS: Successfully restored ${restoredCount} new tracks to history.`);
            return Promise.resolve({ message: `Successfully restored ${restoredCount} new tracks out of ${trackIds.length} to download history.` });
        } catch (error: any) {
            logger.logError("[MessageHandler] RESTORE_HISTORY_FROM_IDS: Error accessing storage or processing IDs:", error);
            return Promise.resolve({ error: `Error restoring history: ${error.message || error}` }); // Resolve with error for client
        }

    } else if (type === PAUSE_DOWNLOAD) {
        if (!tabId) { /* ... error ... */ return { error: "Pause ops require tabId" }; }
        const pauseMessage = message as { downloadId: string };
        logger.logInfo(`Received pause request for download: ${pauseMessage.downloadId}`);
        pausedDownloads[pauseMessage.downloadId] = true;
        sendDownloadProgress(tabId, pauseMessage.downloadId, undefined, undefined, "Paused");
        return { success: true, action: "paused", downloadId: pauseMessage.downloadId };

    } else if (type === RESUME_DOWNLOAD) {
        if (!tabId) { /* ... error ... */ return { error: "Resume ops require tabId" }; }
        const resumeMessage = message as { downloadId: string };
        logger.logInfo(`Received resume request for download: ${resumeMessage.downloadId}`);
        delete pausedDownloads[resumeMessage.downloadId];

        const itemInQueue = downloadQueue.find(item => item.id === resumeMessage.downloadId);
        if (itemInQueue && itemInQueue.status === "pending") {
            logger.logInfo(`Resume for pending item ${itemInQueue.id}. Will be picked by processor.`);
        } else if (itemInQueue && itemInQueue.status === "processing") {
            logger.logInfo(`Resume for actively processing item ${itemInQueue.id}. Processor will handle.`);
        }
        triggerProcessQueue();
        sendDownloadProgress(tabId, resumeMessage.downloadId, undefined, undefined, "Resuming");
        return { success: true, action: "resumed", downloadId: resumeMessage.downloadId };

    } else if (type === GET_QUEUE_DATA) { // from popup, tabId might be undefined
        logger.logInfo("[MessageHandler] Received GET_QUEUE_DATA request (likely from popup).");
        return Promise.resolve(downloadQueue);
    } else if (type !== GET_EXTENSION_CONFIG) { // Ensure we don't drop into unknown for already handled types
        logger.logWarn(`[MessageHandler] Unknown message type received: ${type}`, message);
        return Promise.reject({ error: `Unknown message type: ${type}` });
    }
    // If type was GET_EXTENSION_CONFIG and it returned, this part is skipped.
    // If it was a download/pause/resume/get_queue, it returned from its block.
    // This implies some message types might not return explicitly if not caught above.
    // However, all current known types are handled.
} 