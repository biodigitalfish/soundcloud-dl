import { SoundCloudApi, Track, Playlist } from "../api/soundcloudApi";
import { LogLevel, Logger } from "../utils/logger";
import {
  onBeforeSendHeaders,
  onBeforeRequest,
  onMessage,
  onPageActionClicked,
  openOptionsPage,
  getExtensionManifest,
  sendMessageToTab,
} from "../compatibility/compatibilityStubs";
import { loadConfiguration, storeConfigValue, getConfigValue, registerConfigChangeHandler } from "../settings/config";
import { handleIncomingMessage } from "./messageHandler";
import { DownloadProgress } from "../types";
import { usesDeclarativeNetRequestForModification, setAuthHeaderRule, setClientIdRule } from "../utils/browser";
import { preInitializeFFmpegPool } from "../downloader/ffmpegManager";
import { downloadTrack, saveTextFileAsDownload } from "../downloader/downloadHandler";
import { sanitizeFilenameForDownload } from "../downloader/download";
import { Semaphore } from "./semaphore";
import { Mp4 } from "../downloader/tagWriters/mp4TagWriter";

// --- Main TrackError class for background.ts specific errors ---
export class TrackError extends Error {
  constructor(message: string, trackId?: number) {
    super(trackId ? `${message} (TrackId: ${trackId})` : message);
  }
}

const soundcloudApi = new SoundCloudApi();
const logger = Logger.create("Background", LogLevel.Debug);
const manifest = getExtensionManifest();

// --- Global Pause State --- ADDED
let isGloballyPaused: boolean = false;

export const setGlobalPauseState = (shouldPause: boolean) => {
  isGloballyPaused = shouldPause;
  logger.logInfo(`[Background] Global pause state set to: ${isGloballyPaused}`);
  // Potentially broadcast this change if UI elements in other parts of the extension need to react
  // broadcastGlobalPauseStateChange(isGloballyPaused); // Example call
  if (!isGloballyPaused) {
    triggerProcessQueue(); // If resuming globally, trigger queue processing
  }
};

export const getGlobalPauseState = () => isGloballyPaused;
// --- End Global Pause State ---

// --- Download Queue Definition ---
export interface QueueItem {
  id: string; // Unique ID for this queue item (can be same as originalDownloadIdFromContentScript initially)
  type: "DOWNLOAD" | "DOWNLOAD_SET" | "DOWNLOAD_SET_RANGE";
  url: string;
  originalMessage: any; // Store the original message from content script for processing
  status: "pending" | "processing" | "completed" | "error";
  progress?: number;
  error?: string;
  tabId?: number; // Original tabId that requested it
  title?: string; // Optional: to be fetched or set later for display
  artworkUrl?: string; // Added for UI
  addedAt: number; // Timestamp when added to queue
}

export const downloadQueue: QueueItem[] = [];
let isProcessingQueue = false; // Simple flag to prevent concurrent processing for now

// --- QUEUE PERSISTENCE (Using direct storage access) ---
const QUEUE_STORAGE_KEY = "persistentDownloadQueue_v1"; // Added version suffix

// Function to save the current queue state to storage
export async function saveQueueState(): Promise<void> {
  try {
    // Use a deep copy to avoid storing references that might change
    const queueToSave = JSON.parse(JSON.stringify(downloadQueue));
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: queueToSave });
    logger.logDebug("[Queue Persistence] Queue state saved.");
  } catch (error) {
    logger.logError("[Queue Persistence] Failed to save queue state:", error);
  }
}

// Function to load the queue state from storage on startup
async function loadAndInitializeQueue(): Promise<void> {
  try {
    const storageResult = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    const savedQueue = storageResult[QUEUE_STORAGE_KEY]; // Access the value using the key

    if (Array.isArray(savedQueue)) {
      logger.logInfo(`[Queue Persistence] Loading ${savedQueue.length} items from storage (key: ${QUEUE_STORAGE_KEY}).`);
      const restoredQueue: QueueItem[] = [];
      let itemsReset = 0;
      // Iterate with proper type checking
      for (const item of savedQueue as any[]) { // Iterate as any[] for flexibility
        // Basic validation: Check essential properties and types
        if (item &&
          typeof item.id === "string" &&
          typeof item.type === "string" &&
          typeof item.status === "string" &&
          typeof item.url === "string" &&
          typeof item.addedAt === "number" &&
          item.originalMessage !== undefined) {
          const queueItem = item as QueueItem; // Now cast to QueueItem
          if (queueItem.status === "processing") {
            queueItem.status = "pending"; // Reset interrupted processing items
            queueItem.progress = 0; // Reset progress too
            itemsReset++;
          }
          restoredQueue.push(queueItem);
        } else {
          logger.logWarn("[Queue Persistence] Discarding invalid item from saved queue:", item);
        }
      }
      // Replace in-memory queue completely
      downloadQueue.splice(0, downloadQueue.length, ...restoredQueue);
      logger.logInfo(`[Queue Persistence] Queue initialized. ${itemsReset} items reset from processing to pending.`);
      broadcastQueueUpdate(); // Notify UI of loaded queue
      triggerProcessQueue(); // Check if any pending items need processing
    } else {
      logger.logInfo("[Queue Persistence] No saved queue found or invalid format.");
    }
  } catch (error) {
    const logMessage = "[Queue Persistence] Failed to load queue state";
    if (error instanceof Error) {
      // Construct a single string message for the logger
      const errorMessage = error.message || "[No message property]";
      const errorStack = error.stack || "[No stack trace]";
      logger.logError(`${logMessage}: ${errorMessage}\nStack: ${errorStack}`);
    } else if (error) {
      // For truthy non-Error objects, log their string representation safely.
      logger.logError(`${logMessage}. Caught non-Error object: ${String(error)}`);
    } else {
      // For null/undefined errors.
      logger.logError(`${logMessage}. An undefined or null error was caught.`);
      // Log the raw problematic value directly to console for inspection, as it might be unusual.
      console.error("[Queue Persistence] Raw undefined/null error value that was caught by loadAndInitializeQueue:", error);
    }
  }
}
// --- END QUEUE PERSISTENCE ---

// Function to broadcast queue changes (simple version)
export const broadcastQueueUpdate = () => {
  logger.logDebug("[Queue Broadcast] Sending queue update.");
  // This sends to all extension contexts (popups, options pages, etc.)
  // We don't use sendMessageToTab because we don't know the popup's "tabId"
  // Note: compatibilityStubs doesn't have a generic runtime.sendMessage wrapper yet, so we use chrome directly.
  // TODO: Add a broadcastMessage wrapper to compatibilityStubs
  if (chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "QUEUE_UPDATED_BROADCAST", queuePayload: downloadQueue }, (response) => {
      if (chrome.runtime.lastError) {
        // Expected error if no popups/listeners are open: "The message port closed before a response was received."
        const msg = chrome.runtime.lastError.message?.toLowerCase() || "";
        if (!msg.includes("message port closed") && !msg.includes("receiving end does not exist")) {
          logger.logWarn("[Queue Broadcast] Error sending queue update:", chrome.runtime.lastError.message);
        }
      }
      // Handle response if needed, often not needed for broadcasts
    });
  } else {
    logger.logWarn("[Queue Broadcast] chrome.runtime.sendMessage not available?");
  }
};

// Function to actually execute a download task from the queue
const _executeDownloadTask = async (item: QueueItem): Promise<void> => {
  logger.logInfo(`[QueueProcessor _executeDownloadTask] Starting task for ID: ${item.id}, Type: ${item.type}, URL: ${item.url}`);
  item.status = "processing";
  await saveQueueState(); // <<< ADDED SAVE (Task started)
  // Attempt to set title and artwork early if possible
  if (item.originalMessage?.track?.title) item.title = item.originalMessage.track.title;
  if (item.originalMessage?.track?.artwork_url) item.artworkUrl = item.originalMessage.track.artwork_url;
  else if (item.originalMessage?.set?.title) item.title = item.originalMessage.set.title;
  else if (item.originalMessage?.set?.artwork_url) item.artworkUrl = item.originalMessage.set.artwork_url;

  broadcastQueueUpdate(); // Broadcast status change
  if (item.tabId) {
    sendDownloadProgress(item.tabId, item.id, 0, undefined, "Resuming");
  }

  const reportProgressForQueueItem = (progress?: number, browserDownloadId?: number) => {
    if (progress !== undefined) {
      item.progress = progress;
      if (item.tabId) {
        sendDownloadProgress(item.tabId, item.id, progress, undefined, browserDownloadId ? undefined : "Resuming", browserDownloadId);
      }
      // Broadcast frequent progress updates (maybe throttle this later)
      // broadcastQueueUpdate(); 
    }
  };

  try {
    if (item.type === "DOWNLOAD") {
      const trackUrl = item.originalMessage.url;
      if (!trackUrl) {
        throw new Error("Missing URL in original message for DOWNLOAD item");
      }
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Resolving track URL: ${trackUrl} for item ${item.id}`);
      // --- Restore actual download logic --- 
      const track = await soundcloudApi.resolveUrl<Track>(trackUrl);
      if (!track || track.kind !== "track") {
        throw new Error(`Failed to resolve URL to a valid track: ${trackUrl}`);
      }
      item.title = track.title; // Ensure title is updated
      item.artworkUrl = track.artwork_url; // Ensure artwork is updated
      broadcastQueueUpdate(); // Update with title/artwork before download starts
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Track resolved: ${track.title}. Starting download for item ${item.id}`);
      const downloadResult = await downloadTrack(track, undefined, undefined, undefined, reportProgressForQueueItem);
      item.status = "completed";
      await saveQueueState(); // <<< ADDED SAVE (Task completed)
      logger.logInfo(`[QueueProcessor _executeDownloadTask] DOWNLOAD complete for item ${item.id}: ${track.title}`);
      // --- Simulation code removed --- 

    } else if (item.type === "DOWNLOAD_SET") {
      const setUrl = item.originalMessage.url;
      if (!setUrl) {
        throw new Error("Missing URL in original message for DOWNLOAD_SET item");
      }
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Resolving set URL: ${setUrl} for item ${item.id}`);
      const set = await soundcloudApi.resolveUrl<Playlist>(setUrl);
      if (!set || !set.tracks || set.tracks.length === 0) {
        throw new Error(`Failed to resolve URL to a valid playlist or playlist is empty: ${setUrl}`);
      }
      item.title = set.title; // Ensure title is updated
      // Artwork for set will be assigned after fetching track details
      // item.artworkUrl = set.artwork_url; // REMOVED - Playlist type might not have this
      // broadcastQueueUpdate(); // Broadcast moved to after track fetch

      // --- Fetch Full Track Details --- 
      const trackIds = set.tracks.map((t) => t.id);
      if (trackIds.length === 0) {
        logger.logWarn(`[Queue Set ${item.id}] Playlist resolved but contains no track IDs?`);
        item.status = "completed"; // Mark as completed if no tracks
        return; // Nothing to download
      }
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Set resolved: ${set.title}. Fetching full details for ${trackIds.length} tracks for item ${item.id}`);
      // Fetch tracks in batches if necessary (SoundCloud API might have limits)
      // Let's use a reasonable chunk size, e.g., 50 (adjust if needed)
      const trackIdChunkSize = 50;
      const trackIdChunks = chunkArray(trackIds, trackIdChunkSize);
      const allFullTracks: Track[] = [];
      for (const chunk of trackIdChunks) {
        const keyedTracks = await soundcloudApi.getTracks(chunk);
        allFullTracks.push(...Object.values(keyedTracks));
      }
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Fetched full details for ${allFullTracks.length} tracks.`);
      // --- End Fetch Full Track Details --- 

      // --- Assign artwork from first track --- ADDED
      if (!item.artworkUrl && allFullTracks.length > 0) {
        item.artworkUrl = allFullTracks[0].artwork_url; // Use first track's artwork as fallback/primary for set
      }
      broadcastQueueUpdate(); // Broadcast update with fetched title/artwork now
      // --- End Assign artwork ---

      let tracksProcessed = 0;
      let encounteredError = false;
      let lastError: string | undefined;

      const m3uTrackEntries: string[] = []; // INITIALIZE M3U track entries array

      // --- START Re-implemented calculateSetProgress ---
      const calculateSetProgress = (): number => {
        if (allFullTracks.length === 0) return 0;
        // Calculate progress based on tracksProcessed. 
        // Each fully processed track (progress 101) counts as 1 unit.
        // Partial progress of the currently processing track isn't easily factored here without more state.
        // So, this will jump as each track completes.
        // Alternative: could try to average based on item.progress of sub-tasks if we had that.
        const overallProgress = (tracksProcessed / allFullTracks.length) * 100;
        // Cap progress at 100 until the very end (101 signal)
        return Math.min(overallProgress, 100);
      };
      // --- END Re-implemented calculateSetProgress ---

      const downloadConcurrency = getConfigValue("concurrentSetDownloads") as boolean ?? false;
      const maxConcurrent = downloadConcurrency ? getMaxConcurrent() : 1;
      const downloadSemaphore = new Semaphore(maxConcurrent);

      logger.logInfo(`[Queue Set ${item.id}] Processing ${allFullTracks.length} tracks. Concurrency: ${maxConcurrent}`);

      const downloadPromises = allFullTracks.map(async (trackToDownload, index) => {
        if (getGlobalPauseState()) { // Check global pause before each track
          logger.logInfo(`[Queue Set ${item.id}] Global pause detected. Skipping download for track: ${trackToDownload.title}`);
          // How to handle progress here? Maybe mark as skipped or paused.
          // For now, just don't process. It will remain in pending state within the set processing context.
          return;
        }
        await downloadSemaphore.acquire();
        try {
          if (item.status === "error" && getConfigValue("stopSetDownloadOnError")) {
            logger.logInfo(`[Queue Set ${item.id}] Set download marked as error and stopOnError is true. Skipping remaining tracks.`);
            return;
          }

          const trackNumber = index + 1;
          const reportTrackInSetProgress = (progress?: number, browserDownloadId?: number) => {
            tracksProcessed = Math.max(tracksProcessed, index + (progress !== undefined && progress >= 101 ? 1 : 0));
            const overallProgress = calculateSetProgress();
            item.progress = overallProgress;
            if (item.tabId) {
              // Send individual track progress too if needed, or just overall set progress
              sendDownloadProgress(item.tabId, item.id, overallProgress, undefined, browserDownloadId ? undefined : "Resuming", browserDownloadId);
            }
            // Optional: Broadcast finer-grained progress for the set
            // if (progress !== undefined) broadcastQueueUpdate(); 
          };

          logger.logInfo(`[Queue Set ${item.id}] Starting download for track ${trackNumber}/${allFullTracks.length}: ${trackToDownload.title}`);

          // MODIFIED: Call downloadTrack and expect an object
          const trackDownloadResult = await downloadTrack(
            trackToDownload,
            trackNumber,
            set.title, // albumName
            set.title, // playlistNameString
            reportTrackInSetProgress
          );

          // ADDED: Add to M3U list
          if (trackDownloadResult && trackDownloadResult.finalFilenameForM3U) {
            const durationInSeconds = trackToDownload.duration ? Math.round(trackToDownload.duration / 1000) : 0;
            // MODIFIED: Use extInfDisplayTitle from trackDownloadResult for the #EXTINF line
            const extInfLine = `#EXTINF:${durationInSeconds},${trackDownloadResult.extInfDisplayTitle}`;
            m3uTrackEntries.push(extInfLine);
            // --- ADDED DETAILED LOG FOR M3U FILENAME --- 
            logger.logInfo(`[M3U Set ${item.id}] Pushing to M3U file path entry: '${trackDownloadResult.finalFilenameForM3U}' (Original title for EXTINF: '${trackDownloadResult.extInfDisplayTitle}')`);
            // --- END ADDED LOG ---
            m3uTrackEntries.push(trackDownloadResult.finalFilenameForM3U);
            logger.logDebug(`[M3U Set ${item.id}] Added to M3U: ${trackDownloadResult.finalFilenameForM3U}`);
          }

          logger.logInfo(`[Queue Set ${item.id}] Completed download for track ${trackNumber}/${allFullTracks.length}: ${trackToDownload.title}`);

        } catch (err: any) {
          encounteredError = true;
          lastError = err.message || "Unknown error downloading a track in the set.";
          logger.logError(`[Queue Set ${item.id}] Error downloading track ${trackToDownload.title}:`, err);
          if (getConfigValue("stopSetDownloadOnError")) {
            item.status = "error"; // Mark the whole set as error
            item.error = `Failed on track: ${trackToDownload.title}. ${lastError}`;
            // No need to await saveQueueState here, will be saved after loop
          }
          // report progress for this track as an error if desired
          // reportTrackInSetProgress(undefined, undefined); // Or some error code
        } finally {
          downloadSemaphore.release();
          // Update overall progress after each track, regardless of success/failure
          item.progress = calculateSetProgress();
          broadcastQueueUpdate(); // Broadcast after each track finishes or errors
        }
      });

      await Promise.all(downloadPromises);
      logger.logInfo(`[Queue Set ${item.id}] All track download promises resolved/rejected. Attempting to save queue state next.`); // ADDED LOG
      await saveQueueState(); // <<< ADDED SAVE (After all tracks in set attempted)
      logger.logInfo(`[Queue Set ${item.id}] Queue state saved after processing all tracks. EncounteredError: ${encounteredError}`); // ADDED LOG

      if (encounteredError) {
        item.status = "error"; // Ensure status is error if any track failed
        item.error = item.error || `One or more tracks failed to download within the set. Last error: ${lastError || "None recorded"}`; // Preserve earlier error message if stopSetDownloadOnError was true
        await saveQueueState();
        logger.logWarn(`[Queue Set ${item.id}] DOWNLOAD_SET completed with errors. Last individual error logged was: ${lastError || "None recorded"}`);
        if (item.tabId) sendDownloadProgress(item.tabId, item.id, item.progress, item.error); // Send final progress/error
      } else {
        item.status = "completed";
        item.progress = 101; // Explicitly set 101
        await saveQueueState();
        logger.logInfo(`[Queue Set ${item.id}] DOWNLOAD_SET completed successfully.`);
        if (item.tabId) sendDownloadProgress(item.tabId, item.id, 101);

        // ADDED: M3U Generation and Saving
        logger.logDebug(
          `[M3U Set ${item.id}] Checking M3U conditions: entries=${m3uTrackEntries.length}, createM3uConfig=${getConfigValue("createM3uPlaylistFile")}`
        ); // ADDED LOG
        if (m3uTrackEntries.length > 0 && getConfigValue("createM3uPlaylistFile")) { // Added config check
          logger.logInfo(`[M3U Set ${item.id}] Generating M3U file for set: ${set.title}`);
          // MODIFIED: Use CRLF line endings for M3U content
          const m3uContent = "#EXTM3U\r\n" + m3uTrackEntries.join("\r\n");
          const m3uFilename = sanitizeFilenameForDownload(set.title) + ".m3u";

          const defaultDownloadLocation = getConfigValue("default-download-location") as string | undefined;
          let m3uSavePath = m3uFilename; // Default to just filename (for browser's default download location)

          if (defaultDownloadLocation) {
            const playlistFolderName = sanitizeFilenameForDownload(set.title);
            // Assuming tracks were saved in a subfolder named after the playlist,
            // the M3U should also go there.
            // The track paths in m3uTrackEntries are already relative to this folder.
            m3uSavePath = `${defaultDownloadLocation.replace(/\/$/, "")}/${playlistFolderName}/${m3uFilename}`;
            logger.logDebug(`[M3U Set ${item.id}] M3U save path with location & playlist folder: ${m3uSavePath}`);
          } else {
            logger.logInfo(`[M3U Set ${item.id}] No default download location. M3U will be saved to browser default with name: ${m3uFilename}. Relative paths might not work as expected.`);
          }

          try {
            const saveAsM3u = !getConfigValue("download-without-prompt"); // Respect user's choice for "save as" dialog
            logger.logInfo(`[M3U Set ${item.id}] Saving M3U file: ${m3uSavePath}. SaveAs dialog: ${saveAsM3u}`);
            await saveTextFileAsDownload(m3uContent, m3uSavePath, saveAsM3u, "audio/x-mpegurl");
            logger.logInfo(`[M3U Set ${item.id}] Successfully initiated M3U file download for: ${set.title}`);
          } catch (m3uError) {
            logger.logError(`[M3U Set ${item.id}] Failed to save M3U file for set ${set.title}:`, m3uError);
            // Do not mark the whole set as failed just because M3U saving failed.
          }
        } else if (getConfigValue("createM3uPlaylistFile")) {
          logger.logWarn(`[M3U Set ${item.id}] No track entries collected for M3U, or M3U creation disabled. Skipping M3U for set: ${set.title}`);
        }
      }

    } else if (item.type === "DOWNLOAD_SET_RANGE") {
      logger.logWarn(`[QueueProcessor _executeDownloadTask] DOWNLOAD_SET_RANGE for ${item.id} not yet implemented in queue processor.`);
      item.status = "error";
      item.error = "Set range downloads via queue not yet implemented.";
      await saveQueueState(); // <<< ADDED SAVE (Task errored)
      if (item.tabId) sendDownloadProgress(item.tabId, item.id, undefined, item.error);
    } else {
      logger.logError(`[QueueProcessor _executeDownloadTask] Unknown item type: ${item.type} for item ID: ${item.id}`);
      item.status = "error";
      item.error = "Unknown download type";
      await saveQueueState(); // <<< ADDED SAVE (Task errored)
      if (item.tabId) sendDownloadProgress(item.tabId, item.id, undefined, item.error);
    }
  } catch (err: any) {
    logger.logError(`[QueueProcessor _executeDownloadTask] Error processing item ${item.id}:`, err);
    item.status = "error";
    item.error = err.message || "Unknown error during processing";
    await saveQueueState(); // <<< ADDED SAVE (Task errored)
    if (item.tabId) sendDownloadProgress(item.tabId, item.id, undefined, item.error, undefined);
  } finally {
    // Broadcast final status change regardless of success/error
    broadcastQueueUpdate();
  }
};

const processQueue = async () => {
  if (isProcessingQueue) {
    return;
  }
  isProcessingQueue = true;

  // --- ADDED: Check global pause state before processing --- 
  if (getGlobalPauseState()) {
    logger.logInfo("[QueueProcessor] Global pause is active. Queue processing deferred.");
    isProcessingQueue = false;
    return; // Do not process if globally paused
  }
  // --- END ADDED --- 

  // Find the first pending item
  const itemIndex = downloadQueue.findIndex(item => item.status === "pending");

  if (itemIndex !== -1) {
    const itemToProcess = downloadQueue[itemIndex];
    await _executeDownloadTask(itemToProcess);

    // After task execution (success or error), remove the item if it's finalized
    // We check the index again in case the queue was modified concurrently (though it shouldn't be with isProcessingQueue flag)
    const finalIndex = downloadQueue.findIndex(item => item.id === itemToProcess.id);
    if (finalIndex !== -1 && (downloadQueue[finalIndex].status === "completed" || downloadQueue[finalIndex].status === "error")) {
      logger.logInfo(`[QueueProcessor] Removing finalized item ${downloadQueue[finalIndex].id} (Status: ${downloadQueue[finalIndex].status}) from queue.`);
      downloadQueue.splice(finalIndex, 1);
      await saveQueueState(); // <<< ADDED SAVE (Item removed)
      broadcastQueueUpdate(); // Broadcast removal
    }
  } else {
    // No pending items found
  }

  isProcessingQueue = false;

  // Check if there are still pending items to process immediately
  if (downloadQueue.some(item => item.status === "pending")) {
    triggerProcessQueue();
  }
};

export const triggerProcessQueue = () => {
  setTimeout(() => {
    logger.logInfo("[QueueProcessor trigger] Checking queue...");
    processQueue();
  }, 0);
};
// --- End Download Queue Definition ---

// --- Global Initializations ---
const RULE_ID_OAUTH = 1;
const RULE_ID_CLIENT_ID = 2;

const getMaxConcurrent = () => Math.max(1, Math.min(Number(getConfigValue("maxConcurrentTrackDownloads")) || 3, 10));
let downloadTrackSemaphore = new Semaphore(getMaxConcurrent());
logger.logInfo(`Download track semaphore initialized with concurrency: ${getMaxConcurrent()}`);

registerConfigChangeHandler("maxConcurrentTrackDownloads", (newValue) => {
  const newConcurrency = Math.max(1, Math.min(Number(newValue) || 3, 10));
  logger.logInfo(`Updating download track semaphore concurrency to: ${newConcurrency}`);
  downloadTrackSemaphore = new Semaphore(newConcurrency);
});

// --- End Global Initializations ---

// --- PROGRESS SENDING STATE CACHE ---
const finishingMessageSentCache: Record<string, boolean> = {};
// --- END PROGRESS SENDING STATE CACHE ---

/**
 * Updates the declarativeNetRequest rule for adding the OAuth token header.
 * If oauthToken is null or undefined, the rule is removed.
 */
async function updateAuthHeaderRule(oauthToken?: string | null): Promise<void> {
  await setAuthHeaderRule(oauthToken);
}

/**
 * Updates the declarativeNetRequest rule for redirecting with the client_id parameter.
 * If clientId is null or undefined, the rule is removed.
 */
async function updateClientIdRule(clientId?: string | null): Promise<void> {
  await setClientIdRule(clientId);
}

logger.logInfo("Starting with version: " + manifest.version);

// Register message listener EARLIER
onMessage(handleIncomingMessage);
logger.logInfo("Initial message listener registered.");

// Load configuration and THEN load queue, set rules etc.
loadConfiguration(true).then(async () => {
  logger.logInfo("Initial configuration loaded.");

  // --- Load the persistent queue AFTER config --- ADDED
  await loadAndInitializeQueue();

  logger.logInfo("Setting initial DNR rules.");

  const initialOauthToken = getConfigValue("oauth-token") as string | null | undefined;
  await updateAuthHeaderRule(initialOauthToken);

  const initialClientId = getConfigValue("client-id") as string | null | undefined;
  await updateClientIdRule(initialClientId);

  if (initialOauthToken) {
    await oauthTokenChanged(initialOauthToken);
  }

  preInitializeFFmpegPool();
});

// --- EXPORTED Utility Functions (used by messageHandler.ts) ---
export function sendDownloadProgress(tabId: number, downloadId: string, progress?: number, error?: Error | string, status?: "Paused" | "Resuming", browserDownloadId?: number) {
  // Enhanced validation of downloadId
  if (!downloadId || typeof downloadId !== "string" || downloadId.trim() === "") {
    logger.logError(`Attempted to send download progress with invalid downloadId: ${JSON.stringify(downloadId)}`);

    // Rather than completely failing, try to log helpful diagnostic info
    const callStack = new Error().stack;
    logger.logError(`Call stack for invalid downloadId: ${callStack}`);

    // For messages with progress codes that indicate completion, we should really
    // try to send them even without a downloadId
    if (progress === 101 || progress === 102) {
      logger.logWarn(`Attempting to send COMPLETION message (${progress}) even with missing downloadId`);
      // Try sending a special message that content.ts can try to match to an active download
      const fallbackMessage = {
        downloadId: "undefined_completion",
        progress,
        error: typeof error === "string" ? error : error instanceof Error ? error.message : "",
        status,
        completionWithoutId: true,
        timestamp: Date.now(),
        browserDownloadId // Include browserDownloadId if it exists
      };

      sendMessageToTab(tabId, fallbackMessage).catch(err => {
        logger.logError(`Failed to send fallback completion message: ${err}`);
      });
    }
    return;
  }

  let errorMessage: string = "";
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === "string") {
    errorMessage = error;
  }

  if (progress === 101 || progress === 102) {
    logger.logInfo(`Sending COMPLETION message for download ${downloadId} to tab ${tabId}, progress=${progress}`);
    delete finishingMessageSentCache[downloadId]; // Clear cache on completion/error
  } else if (progress === 100) {
    if (!finishingMessageSentCache[downloadId]) {
      logger.logInfo(`Sending FINISHING message for download ${downloadId} to tab ${tabId}`);
      finishingMessageSentCache[downloadId] = true;
    }
  } else if (progress !== undefined && progress >= 0) {
    // logger.logDebug(`Sending progress update for download ${downloadId} to tab ${tabId}, progress=${progress.toFixed(1)}%`);
    delete finishingMessageSentCache[downloadId]; // Clear cache if progress drops below 100
  }

  const downloadProgressMessage: DownloadProgress = {
    downloadId,
    progress,
    error: errorMessage,
    status,
    timestamp: Date.now(), // Add timestamp to help with matching in content.ts
    browserDownloadId      // Include browserDownloadId in all messages
  };

  // SIMPLIFIED SENDING LOGIC:
  // Only send one message, regardless of progress type.
  // The previous logic for multiple timed messages for 101/102 is removed for testing.
  if (progress === 101 || progress === 102) {
    logger.logInfo(`Sending SINGLE COMPLETION message for download ${downloadId} to tab ${tabId}, progress=${progress} (BrowserDownloadId: ${browserDownloadId || "N/A"})`);
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.logWarn(`Failed to send completion message to tab ${tabId}:`, err);
    });
  } else { // For other progress, pause, resume, or general updates
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.logWarn(`Failed to send progress/status message to tab ${tabId}:`, err);
    });
  }
}

export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize < 1) throw new Error("Invalid chunk size");
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    chunks.push(chunk);
  }
  return chunks;
}
// --- End Exported Utility Functions ---

// --- Event Handlers (onBeforeSendHeaders, onBeforeRequest, onPageActionClicked, oauthTokenChanged, registerConfigChangeHandler) ---
const authRegex = new RegExp("OAuth (.+)");
const followerIdRegex = new RegExp("/me/followings/(\\d+)");

// Restore onBeforeSendHeaders for Firefox & non-DNR environments
onBeforeSendHeaders(
  (details: chrome.webRequest.WebRequestHeadersDetails) => {
    if (usesDeclarativeNetRequestForModification()) {
      const oauthTokenFromStorage = getConfigValue("oauth-token") as string | null;
      if (details.requestHeaders) {
        for (let i = 0; i < details.requestHeaders.length; i++) {
          if (details.requestHeaders[i].name.toLowerCase() === "authorization") {
            const authHeader = details.requestHeaders[i].value as string;
            const result = authRegex.exec(authHeader);
            if (result && result.length >= 2 && result[1] !== oauthTokenFromStorage) {
              logger.logInfo("Sniffed and storing OAuth token from request header (all envs).");
              storeConfigValue("oauth-token", result[1]);
            }
            break;
          }
        }
      }
      return {};
    }

    let requestHasAuth = false;
    const oauthToken = getConfigValue("oauth-token") as string | null;

    if (details.requestHeaders) {
      for (let i = 0; i < details.requestHeaders.length; i++) {
        if (details.requestHeaders[i].name.toLowerCase() === "authorization") {
          requestHasAuth = true;
          const authHeader = details.requestHeaders[i].value as string;
          const result = authRegex.exec(authHeader);
          if (result && result.length >= 2 && result[1] !== oauthToken) {
            logger.logInfo("Sniffed and storing OAuth token (Firefox/non-DNR).");
            storeConfigValue("oauth-token", result[1]);
          }
          break;
        }
      }
      if (!requestHasAuth && oauthToken) {
        // logger.logDebug(`Adding OAuth token to request for ${details.url} (Firefox/non-DNR)`);
        details.requestHeaders.push({
          name: "Authorization",
          value: "OAuth " + oauthToken,
        });
        return { requestHeaders: details.requestHeaders };
      }
    }
    return {};
  },
  ["*://api-v2.soundcloud.com/*"],
  ["blocking", "requestHeaders"]
);

onBeforeRequest(
  (details: chrome.webRequest.WebRequestBodyDetails) => {
    const url = new URL(details.url);
    if (url.pathname === "/connect/session" && getConfigValue("oauth-token") === null) {
      logger.logInfo("User logged in - clearing potentially stale token.");
      storeConfigValue("oauth-token", undefined);
    } else if (url.pathname === "/sign-out") {
      logger.logInfo("User logged out");
      storeConfigValue("oauth-token", null);
      storeConfigValue("user-id", null);
      storeConfigValue("followed-artists", []);
    } else if (url.pathname.startsWith("/me/followings/")) {
      const followerIdMatch = followerIdRegex.exec(url.pathname);
      if (followerIdMatch && followerIdMatch.length === 2) {
        const followerId = +followerIdMatch[1];
        if (followerId) {
          let followedArtists = (getConfigValue("followed-artists") as number[] | null) || [];
          if (details.method === "POST") {
            if (!followedArtists.includes(followerId)) followedArtists.push(followerId);
          } else if (details.method === "DELETE") {
            followedArtists = followedArtists.filter((i) => i !== followerId);
          }
          storeConfigValue("followed-artists", followedArtists);
        }
      }
    } else {
      const clientIdFromUrl = url.searchParams.get("client_id");
      if (clientIdFromUrl) {
        const storedClientId = getConfigValue("client-id") as string | null;
        if (clientIdFromUrl !== storedClientId) {
          logger.logInfo(`Found new client_id: ${clientIdFromUrl}. Storing it.`);
          storeConfigValue("client-id", clientIdFromUrl);
        }
      } else {
        if (!usesDeclarativeNetRequestForModification()) {
          const storedClientId = getConfigValue("client-id") as string | null;
          if (storedClientId) {
            logger.logDebug(`Adding ClientId to ${details.url} via redirect (Firefox/non-DNR)`);
            url.searchParams.append("client_id", storedClientId);
            return { redirectUrl: url.toString() };
          }
        }
      }
    }
    return {};
  },
  ["*://api-v2.soundcloud.com/*", "*://api-auth.soundcloud.com/*"],
  ["blocking"]
);

// onPageActionClicked(() => {
// openOptionsPage();
// });

const oauthTokenChanged = async (token: string | null | undefined) => {
  if (!token) {
    storeConfigValue("user-id", null);
    logger.logInfo("OAuth token cleared, user ID cleared.");
    return;
  }
  const user = await soundcloudApi.getCurrentUser();
  if (!user) {
    logger.logError("Failed to fetch currently logged in user (after token change/init)");
    return;
  }
  storeConfigValue("user-id", user.id);
  logger.logInfo("Logged in as", user.username);
  const followedArtistIds = await soundcloudApi.getFollowedArtistIds(user.id);
  if (!followedArtistIds) {
    logger.logError("Failed to fetch ids of followed artists");
    return;
  }
  storeConfigValue("followed-artists", followedArtistIds);
};

registerConfigChangeHandler("oauth-token", async (newValue) => {
  await updateAuthHeaderRule(newValue as string | null | undefined);
  await oauthTokenChanged(newValue as string | null | undefined);
});

registerConfigChangeHandler("client-id", async (newClientId) => {
  logger.logInfo(`client-id config changed to: ${newClientId}. Updating DNR rule.`);
  await updateClientIdRule(newClientId as string | null | undefined);
});

