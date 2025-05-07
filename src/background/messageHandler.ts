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

// Message Type Constants
export const DOWNLOAD_SET = "DOWNLOAD_SET";
export const DOWNLOAD = "DOWNLOAD";
export const DOWNLOAD_SET_RANGE = "DOWNLOAD_SET_RANGE";
export const PAUSE_DOWNLOAD = "PAUSE_DOWNLOAD";
export const RESUME_DOWNLOAD = "RESUME_DOWNLOAD";

// Local TrackError for message handling issues, or import a general one if suitable
class MessageHandlerError extends Error {
    constructor(message: string) {
        super(message);
    }
}

// State for paused downloads
const pausedDownloads: { [downloadId: string]: boolean } = {};

const soundcloudApi = new SoundCloudApi();
const logger = Logger.create("MessageHandler", LogLevel.Debug);

// ADDED: Semaphore for controlling downloadTrack concurrency
// const downloadTrackSemaphore = new Semaphore(3); // Old hardcoded value
const initialMaxConcurrentDownloads = Math.max(1, Math.min(Number(getConfigValue("maxConcurrentTrackDownloads")) || 3, 10));
const downloadTrackSemaphore = new Semaphore(initialMaxConcurrentDownloads);
logger.logInfo(`Download track semaphore initialized with concurrency: ${initialMaxConcurrentDownloads}`);

// Main message handling function
export async function handleIncomingMessage(message: DownloadRequest, sender: chrome.runtime.MessageSender) {
    // --- Add critical logging at the very beginning ---
    let receivedMessageForLog = {};
    try {
        receivedMessageForLog = JSON.parse(JSON.stringify(message));
    } catch (_e) {
        receivedMessageForLog = { errorParsingMessage: true, rawMessage: String(message) };
    }
    logger.logDebug("[MessageHandler DEBUG] Received message:", receivedMessageForLog);

    if (!message || (message.downloadId === undefined && message.type !== undefined && message.type !== "GET_EXTENSION_CONFIG")) {
        logger.logError(
            "CRITICAL: MessageHandler received message with undefined or missing downloadId for a relevant type!",
            receivedMessageForLog
        );
        // Depending on how you want to handle this, you might return or throw.
    }
    // --- End critical logging ---

    const tabId = sender.tab?.id;
    const { downloadId, url, type } = message;

    if (!tabId) {
        logger.logWarn("Message received without a valid tab ID", { sender, message });
        return { error: "No valid tab ID found in message sender" }; // Return a JSON-serializable error object
    }

    // Handle GET_EXTENSION_CONFIG separately as it doesn't involve typical download flow
    if (type === "GET_EXTENSION_CONFIG") {
        logger.logDebug(`[MessageHandler] Received GET_EXTENSION_CONFIG request from tab ${tabId}`);
        try {
            const currentFullConfig = await loadConfiguration(false); // monitorStorage is false, background already does this
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

    // --- IMMEDIATE TEST MESSAGE for DOWNLOAD type only to reduce noise --- 
    if (type === DOWNLOAD && downloadId) { // Ensure downloadId is present for meaningful test
        const testMessagePayload = {
            scdl_test_message: "HELLO_FROM_MESSAGE_HANDLER_EARLY_ACK_TEST",
            testForDownloadId: downloadId,
            timestamp: Date.now()
        };
        logger.logDebug(`[MessageHandler TX TestMsg] Attempting to send TEST MESSAGE to tab ${tabId} for downloadId ${downloadId}:`, JSON.parse(JSON.stringify(testMessagePayload)));
        sendMessageToTab(tabId, testMessagePayload)
            .then(() => logger.logInfo(`[MessageHandler TX TestMsg] TEST MESSAGE for downloadId ${downloadId} successfully sent to tab ${tabId} (promise resolved).`))
            .catch(e => logger.logError(`[MessageHandler TX TestMsg] TEST MESSAGE for downloadId ${downloadId} FAILED to send to tab ${tabId}:`, e));
    }
    // --- END IMMEDIATE TEST MESSAGE ---

    try {
        if (type === DOWNLOAD_SET) {
            logger.logDebug("Received set download request", { url, downloadId });

            const ackSetPayload = { success: true, originalDownloadId: downloadId, message: "Set download command received, preparing tracks." };
            logger.logDebug(`[MessageHandler TX Ack] Attempting to send EARLY ACK (DOWNLOAD_SET) to tab ${tabId} for downloadId ${downloadId}:`, JSON.parse(JSON.stringify(ackSetPayload)));
            sendMessageToTab(tabId, ackSetPayload)
                .then(() => logger.logInfo(`[MessageHandler TX Ack] EARLY ACK (DOWNLOAD_SET) for ${downloadId} sent to tab ${tabId}.`))
                .catch(e => logger.logError("[MessageHandler TX Ack] DOWNLOAD_SET: Failed to send initial command ack to tab", e));

            const set = await soundcloudApi.resolveUrl<Playlist>(url);
            if (!set) {
                throw new MessageHandlerError(`Failed to resolve SoundCloud URL. Check if you are logged in or if the URL is correct. URL: ${url}`);
            }
            delete pausedDownloads[downloadId]; // Moved here, after validation, before async block

            // Immediate response to content script
            const immediateResponse = { success: true, message: "Playlist download initiated. Processing tracks in background.", originalDownloadId: downloadId };
            logger.logInfo(`[MessageHandler] Preparing IMMEDIATE response for DOWNLOAD_SET ${downloadId}.`);

            // Asynchronous processing block
            (async () => {
                try {
                    const trackIds = set.tracks.map((i) => i.id);
                    const progresses: { [key: number]: number } = {};
                    const browserDownloadIds: { [key: number]: number } = {};

                    const reportPlaylistProgress = (trackId: number) => (progress?: number, browserDlId?: number) => {
                        if (progress !== undefined) {
                            progresses[trackId] = progress;
                        }
                        if (browserDlId !== undefined) {
                            browserDownloadIds[trackId] = browserDlId;
                        }
                        const totalProgress = Object.values(progresses).reduce((acc, cur) => acc + cur, 0);
                        const latestBrowserDlId = browserDownloadIds[trackId];
                        sendDownloadProgress(tabId, downloadId, totalProgress / trackIds.length, undefined, undefined, latestBrowserDlId);
                    };

                    const setAlbumName = set.set_type === "album" || set.set_type === "ep" ? set.title : undefined;
                    const setPlaylistName = set.set_type !== "album" && set.set_type !== "ep" ? set.title : undefined;

                    const trackIdChunkSize = 10;
                    const trackIdChunks = chunkArray(trackIds, trackIdChunkSize);
                    let currentTrackIdChunk = 0;
                    let encounteredError = false;
                    let lastError: Error | null = null;

                    for (const trackIdChunk of trackIdChunks) {
                        sendDownloadProgress(tabId, downloadId, undefined, undefined, pausedDownloads[downloadId] ? "Paused" : undefined);
                        while (pausedDownloads[downloadId]) {
                            logger.logDebug(`Download ${downloadId} is paused. Waiting...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                        const keyedTracks = await soundcloudApi.getTracks(trackIdChunk);
                        const tracks = Object.values(keyedTracks).reverse();
                        logger.logInfo(`Downloading set chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}...`);
                        const downloads: Promise<number>[] = [];

                        for (let i = 0; i < tracks.length; i++) {
                            const originalIndex = set.tracks.findIndex(t => t.id === tracks[i].id);
                            const trackNumber = originalIndex !== -1 ? originalIndex + 1 : undefined;
                            // MODIFIED: Wrap downloadTrack in semaphore
                            const trackDownloadPromise = downloadTrackSemaphore.withLock(() =>
                                downloadTrack(tracks[i], trackNumber, setAlbumName, setPlaylistName, reportPlaylistProgress(tracks[i].id))
                            );
                            downloads.push(trackDownloadPromise);
                        }

                        await Promise.all(
                            downloads.map((p) =>
                                p.catch((error) => {
                                    logger.logWarn("Failed to download track of set", error);
                                    encounteredError = true;
                                    lastError = error;
                                    return 0;
                                })
                            )
                        );
                        currentTrackIdChunk++;
                    }

                    if (encounteredError) {
                        logger.logWarn("Playlist download completed with errors. Last error:", lastError);
                        sendDownloadProgress(tabId, downloadId, 102, lastError ?? new MessageHandlerError("One or more tracks failed to download."));
                    } else {
                        logger.logInfo("Downloaded set successfully!");
                        sendDownloadProgress(tabId, downloadId, 101);
                    }
                } catch (asyncError) {
                    logger.logError(`[MessageHandler ASYNC DOWNLOAD_SET] Error during background processing for ${downloadId}:`, asyncError);
                    const errorToSend = asyncError instanceof Error ? asyncError : new MessageHandlerError(String(asyncError));
                    sendDownloadProgress(tabId, downloadId, undefined, errorToSend);
                }
            })(); // End of IIAFE

            return immediateResponse; // Return immediate response
        } else if (type === DOWNLOAD) {
            logger.logDebug("Received track download request", { url, downloadId });

            // Step 1: Send early ack to UI (already happens via sendMessageToTab)
            const ackDownloadPayload = { success: true, originalDownloadId: downloadId, message: "Download command received, preparing track." };
            logger.logDebug(`[MessageHandler TX Ack] Attempting to send EARLY ACK (DOWNLOAD) to tab ${tabId} for downloadId ${downloadId}:`, JSON.parse(JSON.stringify(ackDownloadPayload)));
            sendMessageToTab(tabId, ackDownloadPayload)
                .then(() => logger.logInfo(`[MessageHandler TX Ack] EARLY ACK (DOWNLOAD) for ${downloadId} sent to tab ${tabId}.`))
                .catch(e => logger.logError("[MessageHandler TX Ack] DOWNLOAD: Failed to send initial command ack to tab", e));

            delete pausedDownloads[downloadId];

            // Step 2: Resolve URL (still await this for basic validation)
            const track = await soundcloudApi.resolveUrl<Track>(url);
            if (!track) {
                // If resolving fails, reject the initial message promise
                throw new MessageHandlerError(`Failed to resolve SoundCloud track URL: ${url}`);
            }

            // Step 3: Define the immediate response to resolve the initial sendMessage promise
            const immediateResponse = { success: true, message: "Track resolved, download initiated.", originalDownloadId: downloadId };
            logger.logInfo(`[MessageHandler] Preparing IMMEDIATE response for ${downloadId} to content script.`);

            // Step 4: START the download asynchronously (DO NOT AWAIT HERE)
            // Use an immediately-invoked async function expression (IIAFE)
            (async () => {
                let originalSkipSetting: boolean | undefined = undefined; // Define here for finally block access
                try {
                    // Setup progress reporter (same as before)
                    const reportTrackProgress = (progress?: number, browserDlIdFromCallback?: number) => {
                        logger.logDebug(`[MessageHandler ASYNC] reportTrackProgress (for downloadId ${downloadId}) CALLED WITH: progress=${progress}, browserDlIdFromCallback=${browserDlIdFromCallback}`);
                        sendDownloadProgress(tabId, downloadId, progress, undefined, undefined, browserDlIdFromCallback);
                    };

                    // Handle force redownload flags (same as before)
                    const forceRedownload = (message as any).forceRedownload === true;
                    if (forceRedownload) {
                        logger.logInfo(`Force redownload requested for track ID ${track.id}. Temporarily bypassing all history and skip checks.`);

                        // 1. Save the current skipExistingFiles setting
                        originalSkipSetting = getConfigValue("skipExistingFiles") as boolean;

                        // 2. Temporarily disable skipExistingFiles
                        if (originalSkipSetting) {
                            logger.logInfo("Temporarily disabling skipExistingFiles for force redownload");
                            await storeConfigValue("skipExistingFiles", false);
                        }

                        // 3. Temporarily remove this track from download history
                        const trackIdKey = `track-${track.id}`;
                        const trackDownloadHistory = await loadConfigValue("track-download-history") || {};
                        if (trackDownloadHistory && trackDownloadHistory[trackIdKey]) {
                            // Save the original history entry - ASSUMING originalHistoryValue is defined elsewhere or not strictly needed for restore
                            // originalHistoryValue = { ...trackDownloadHistory[trackIdKey] }; 
                            delete trackDownloadHistory[trackIdKey];
                            await storeConfigValue("track-download-history", trackDownloadHistory);
                            logger.logInfo(`Temporarily removed track ${track.id} from download history for force redownload.`);
                        }

                        // 4. Erase from browser history (same as before)
                        try {
                            const extractor = new MetadataExtractor(track.title, track.user.username, track.user.permalink);
                            const normalizedTitle = extractor.getTitle();
                            const artistList = extractor.getArtists();
                            const normalizedArtist = artistList.map(a => a.name).join(", ");
                            const filenamePattern = `${normalizedArtist} - ${normalizedTitle}`;
                            const escapedPattern = filenamePattern.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&"); // Corrected regex escape
                            const regexPattern = escapedPattern + "\\..+$";
                            eraseDownloadHistoryEntry(regexPattern);
                        } catch (error) {
                            logger.logError("Force redownload: Failed to erase matching entries from browser download history:", error);
                        }
                    }

                    // Call downloadTrack (NO AWAIT needed here as we handle promise below)
                    logger.logInfo(`[MessageHandler ASYNC] Starting downloadTrack for ${downloadId}`);
                    downloadTrack(track, undefined, undefined, undefined, reportTrackProgress)
                        .then(actualBrowserDownloadId => {
                            logger.logInfo(`[MessageHandler ASYNC] Track download process for ${downloadId} finished by downloadTrack. Reported browser download ID: ${actualBrowserDownloadId}`);
                            // Final 101 progress is sent by downloadTrack/reportTrackProgress itself now.
                        })
                        .catch(downloadError => {
                            // If downloadTrack itself fails catastrophically (after trying all options)
                            logger.logError(`[MessageHandler ASYNC] Error during downloadTrack execution for ${downloadId}:`, downloadError);
                            // Send final error progress update
                            sendDownloadProgress(tabId, downloadId, undefined, downloadError);
                        })
                        .finally(() => {
                            // Restore skipExistingFiles setting if it was changed for force redownload
                            if (forceRedownload && originalSkipSetting !== undefined) {
                                logger.logInfo(`Restoring skipExistingFiles setting to ${originalSkipSetting} after force redownload for ${track.id}`);
                                storeConfigValue("skipExistingFiles", originalSkipSetting);
                            }
                            // TODO: Restore history entry if needed?
                        });

                } catch (asyncError) {
                    // Catch errors from the setup phase within this async IIAFE (e.g., force redownload logic)
                    logger.logError(`[MessageHandler ASYNC] Error setting up async download task for ${downloadId}:`, asyncError);
                    sendDownloadProgress(tabId, downloadId, undefined, asyncError);
                }
            })(); // Immediately invoke the async function

            // Step 5: Return the immediate response to resolve the initial sendMessage promise
            return immediateResponse;
        } else if (type === DOWNLOAD_SET_RANGE) {
            const rangeMessage = message as DownloadSetRangeRequest;
            logger.logInfo("Received set range download request", {
                url,
                start: rangeMessage.start,
                end: rangeMessage.end,
                downloadId,
                tabId
            });

            const ackRangePayload = { success: true, originalDownloadId: downloadId, message: "Set range download command received, preparing tracks." };
            logger.logDebug(`[MessageHandler TX Ack] Attempting to send EARLY ACK (DOWNLOAD_SET_RANGE) to tab ${tabId} for downloadId ${downloadId}:`, JSON.parse(JSON.stringify(ackRangePayload)));
            sendMessageToTab(tabId, ackRangePayload)
                .then(() => logger.logInfo(`[MessageHandler TX Ack] EARLY ACK (DOWNLOAD_SET_RANGE) for ${downloadId} sent to tab ${tabId}.`))
                .catch(e => logger.logError("[MessageHandler TX Ack] DOWNLOAD_SET_RANGE: Failed to send initial command ack to tab", e));

            // Perform initial validations
            const start = rangeMessage.start;
            const end = rangeMessage.end;
            const set = await soundcloudApi.resolveUrl<Playlist>(url);

            if (!set) {
                throw new MessageHandlerError(`Failed to resolve SoundCloud set. URL: ${url} returned null/undefined.`);
            }
            if (!set.tracks) {
                throw new MessageHandlerError(`SoundCloud set is missing tracks property. URL: ${url}`);
            }
            if (set.tracks.length === 0) {
                throw new MessageHandlerError(`SoundCloud set is empty (has 0 tracks). URL: ${url}`);
            }

            const totalTracks = set.tracks.length;
            const validatedStart = Math.max(1, Math.min(start, totalTracks));
            const validatedEnd = end === null ? totalTracks : Math.max(validatedStart, Math.min(end, totalTracks));

            if (validatedStart > validatedEnd) {
                throw new MessageHandlerError(`Invalid range: Start index (${validatedStart}) cannot be greater than End index (${validatedEnd}). Total tracks: ${totalTracks}`);
            }

            delete pausedDownloads[downloadId]; // Moved here, after validation, before async block

            const immediateResponse = { success: true, message: "Playlist range download initiated. Processing tracks in background.", originalDownloadId: downloadId };
            logger.logInfo(`[MessageHandler] Preparing IMMEDIATE response for DOWNLOAD_SET_RANGE ${downloadId}.`);

            // Asynchronous processing block
            (async () => {
                try {
                    logger.logInfo(`Successfully resolved playlist with ${set.tracks.length} tracks for range processing`, {
                        title: set.title,
                        set_type: set.set_type
                    });
                    logger.logInfo(`Processing range: ${validatedStart} to ${validatedEnd} (of ${totalTracks})`, {
                        originalStart: start,
                        originalEnd: end,
                        validatedStart,
                        validatedEnd,
                        totalTracks
                    });

                    const tracksToDownload = set.tracks.slice(validatedStart - 1, validatedEnd);
                    logger.logInfo(`Selected ${tracksToDownload.length} tracks for download in range`);

                    if (tracksToDownload.length === 0) {
                        logger.logWarn("Selected range resulted in zero tracks to download.");
                        sendDownloadProgress(tabId, downloadId, 101);
                        return; // Exit IIAFE, immediateResponse was already sent
                    }

                    const isAlbum = set.set_type === "album" || set.set_type === "ep";
                    const setAlbumName = isAlbum ? set.title : undefined;
                    const setPlaylistName = !isAlbum ? set.title : undefined;

                    logger.logInfo("Set metadata for range:", {
                        isAlbum,
                        title: set.title,
                        setAlbumName,
                        setPlaylistName
                    });

                    const progresses: { [key: number]: number } = {};
                    const browserDownloadIds: { [key: number]: number } = {};

                    const reportPlaylistProgress = (trackId: number) => (progress?: number, browserDlId?: number) => {
                        if (progress !== undefined) {
                            progresses[trackId] = progress;
                        }
                        if (browserDlId !== undefined) {
                            browserDownloadIds[trackId] = browserDlId;
                        }
                        const totalProgress = Object.values(progresses).reduce((acc, cur) => acc + cur, 0);
                        const averageProgress = totalProgress / tracksToDownload.length;
                        const latestBrowserDlId = browserDownloadIds[trackId];
                        sendDownloadProgress(tabId, downloadId, averageProgress, undefined, undefined, latestBrowserDlId);
                    };

                    let encounteredError = false;
                    let lastError: Error | null = null;
                    const trackIdChunkSize = 5;
                    const trackIdChunks = chunkArray(tracksToDownload.map(t => t.id), trackIdChunkSize);
                    let currentTrackIdChunk = 0;

                    logger.logInfo(`Splitting range download into ${trackIdChunks.length} chunks of size ${trackIdChunkSize}`);

                    for (const trackIdChunk of trackIdChunks) {
                        logger.logInfo(`Starting range chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}`, {
                            trackIds: trackIdChunk
                        });

                        sendDownloadProgress(tabId, downloadId, undefined, undefined, pausedDownloads[downloadId] ? "Paused" : undefined);
                        while (pausedDownloads[downloadId]) {
                            logger.logDebug(`Download ${downloadId} is paused. Waiting...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                        logger.logInfo(`Fetching track data for range chunk ${currentTrackIdChunk + 1}`);
                        const keyedTracks = await soundcloudApi.getTracks(trackIdChunk);
                        const tracksInChunk = Object.values(keyedTracks).reverse();
                        logger.logInfo(`Got ${tracksInChunk.length} tracks for range chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}`);

                        const downloads: Promise<number>[] = [];

                        for (let i = 0; i < tracksInChunk.length; i++) {
                            const trackInfo = tracksInChunk[i];
                            logger.logInfo(`Starting download for track ${i + 1}/${tracksInChunk.length} in range chunk`, {
                                id: trackInfo.id,
                                title: trackInfo.title
                            });

                            sendDownloadProgress(tabId, downloadId, undefined, undefined, pausedDownloads[downloadId] ? "Paused" : undefined);
                            while (pausedDownloads[downloadId]) {
                                logger.logDebug(`Download ${downloadId} is paused. Waiting...`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }

                            const originalIndex = set.tracks.findIndex(t => t.id === trackInfo.id);
                            const trackNumber = originalIndex !== -1 ? originalIndex + 1 : undefined;

                            try {
                                // MODIFIED: Wrap downloadTrack in semaphore
                                const download = downloadTrackSemaphore.withLock(() =>
                                    downloadTrack(
                                        trackInfo,
                                        trackNumber,
                                        setAlbumName,
                                        setPlaylistName,
                                        reportPlaylistProgress(trackInfo.id)
                                    )
                                );
                                downloads.push(download);
                            } catch (trackError) {
                                logger.logError(`Failed to start download for track ${trackInfo.title} in range`, trackError);
                                encounteredError = true;
                                lastError = trackError instanceof Error ? trackError : new Error(String(trackError));
                            }
                        }

                        logger.logInfo(`Waiting for all downloads in range chunk ${currentTrackIdChunk + 1} to complete...`);
                        await Promise.all(
                            downloads.map((p) =>
                                p.catch((error) => {
                                    logger.logWarn("Failed to download track of set range", error);
                                    encounteredError = true;
                                    lastError = error;
                                    return 0;
                                })
                            )
                        );
                        logger.logInfo(`Completed all downloads in range chunk ${currentTrackIdChunk + 1}`);
                        currentTrackIdChunk++;
                    }

                    if (encounteredError) {
                        logger.logWarn("Playlist range download completed with errors. Last error:", lastError);
                        sendDownloadProgress(tabId, downloadId, 102, lastError ?? new MessageHandlerError("One or more tracks failed to download in the selected range."));
                    } else {
                        logger.logInfo("Downloaded playlist range successfully!");
                        sendDownloadProgress(tabId, downloadId, 101);
                    }
                } catch (asyncError) {
                    logger.logError(`[MessageHandler ASYNC DOWNLOAD_SET_RANGE] Error during background processing for ${downloadId}:`, asyncError);
                    const errorToSend = asyncError instanceof Error ? asyncError : new MessageHandlerError(String(asyncError));
                    sendDownloadProgress(tabId, downloadId, undefined, errorToSend);
                }
            })(); // End of IIAFE for range download

            return immediateResponse; // Return immediate response
        } else if (type === PAUSE_DOWNLOAD) {
            const pauseMessage = message as { downloadId: string }; // Type assertion
            logger.logInfo(`Received pause request for download: ${pauseMessage.downloadId}`);
            pausedDownloads[pauseMessage.downloadId] = true;
            sendDownloadProgress(tabId, pauseMessage.downloadId, undefined, undefined, "Paused");
            return { success: true, action: "paused", downloadId: pauseMessage.downloadId }; // Return success
        } else if (type === RESUME_DOWNLOAD) {
            const resumeMessage = message as { downloadId: string }; // Type assertion
            logger.logInfo(`Received resume request for download: ${resumeMessage.downloadId}`);
            pausedDownloads[resumeMessage.downloadId] = false;
            sendDownloadProgress(tabId, resumeMessage.downloadId, undefined, undefined, "Resuming");
            return { success: true, action: "resumed", downloadId: resumeMessage.downloadId }; // Return success
        } else {
            throw new MessageHandlerError(`Unknown download type: ${type}`);
        }
    } catch (error) {
        // Ensure error is an instance of Error for sendDownloadProgress
        const errorToSend = error instanceof Error ? error : new MessageHandlerError(String(error));
        sendDownloadProgress(tabId, downloadId, undefined, errorToSend);
        logger.logError("Download failed unexpectedly in message handler", error);
        return { error: errorToSend.message }; // Return error to avoid "Failed to convert to Response" errors
    }
} 