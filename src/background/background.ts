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
import { downloadTrack } from "../downloader/downloadHandler";
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
  addedAt: number; // Timestamp when added to queue
}

export const downloadQueue: QueueItem[] = [];
let isProcessingQueue = false; // Simple flag to prevent concurrent processing for now

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
      broadcastQueueUpdate();
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
      logger.logInfo(`[QueueProcessor _executeDownloadTask] Track resolved: ${track.title}. Starting download for item ${item.id}`);
      await downloadTrack(track, undefined, undefined, undefined, reportProgressForQueueItem);
      item.status = "completed";
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

      const progresses: { [trackId: number]: number } = {};
      let encounteredError = false;
      let lastError: Error | string | null = null;

      const calculateSetProgress = () => {
        const totalProgressSum = Object.values(progresses).reduce((acc, cur) => acc + cur, 0);
        // Use allFullTracks.length as the denominator now
        return allFullTracks.length > 0 ? totalProgressSum / allFullTracks.length : 0;
      };

      item.progress = 0;
      reportProgressForQueueItem(0);

      const setAlbumName = set.set_type === "album" || set.set_type === "ep" ? set.title : undefined;
      const setPlaylistName = set.set_type !== "album" && set.set_type !== "ep" ? set.title : undefined;

      const downloadPromises: Promise<any>[] = [];

      // Iterate over the fetched full track details
      for (let i = 0; i < allFullTracks.length; i++) {
        const track = allFullTracks[i]; // Use the full track object
        const trackNumber = i + 1;

        const reportTrackInSetProgress = (progress?: number, browserDownloadId?: number) => {
          if (progress !== undefined) {
            progresses[track.id] = progress;
            const overallProgress = calculateSetProgress();
            reportProgressForQueueItem(overallProgress, browserDownloadId);
          }
          // Don't broadcast on every single sub-track progress, only on overall update via reportProgressForQueueItem
        };

        downloadPromises.push(
          downloadTrackSemaphore.withLock(() => {
            logger.logDebug(`[Queue Set ${item.id}] Starting download for track ${trackNumber}/${allFullTracks.length}: ${track.title} (ID: ${track.id})`);
            // Pass the full track object
            return downloadTrack(track, trackNumber, setAlbumName, setPlaylistName, reportTrackInSetProgress);
          }).catch((error) => {
            logger.logWarn(`[Queue Set ${item.id}] Failed to download track ${trackNumber}: ${track.title}`, error);
            encounteredError = true;
            lastError = error?.message || String(error);
            progresses[track.id] = 100; // Mark failed track as 'complete' for avg calculation purposes
            const overallProgress = calculateSetProgress(); // Recalculate overall progress
            reportProgressForQueueItem(overallProgress);
            // Don't rethrow, let Promise.all complete
          })
        );
      }

      logger.logInfo(`[Queue Set ${item.id}] Waiting for ${downloadPromises.length} track downloads to complete...`);
      await Promise.all(downloadPromises);
      logger.logInfo(`[Queue Set ${item.id}] All track download attempts finished.`);

      if (encounteredError) {
        item.status = "error";
        item.error = "One or more tracks failed to download within the set.";
        logger.logWarn(`[Queue Set ${item.id}] DOWNLOAD_SET completed with errors. Last individual error logged was: ${lastError || "None recorded"}`);
        if (item.tabId) sendDownloadProgress(item.tabId, item.id, 102, item.error);
      } else {
        item.status = "completed";
        item.progress = 101; // Explicitly set 101
        logger.logInfo(`[Queue Set ${item.id}] DOWNLOAD_SET completed successfully.`);
        if (item.tabId) sendDownloadProgress(item.tabId, item.id, 101);
      }

    } else if (item.type === "DOWNLOAD_SET_RANGE") {
      logger.logWarn(`[QueueProcessor _executeDownloadTask] DOWNLOAD_SET_RANGE for ${item.id} not yet implemented in queue processor.`);
      item.status = "error";
      item.error = "Set range downloads via queue not yet implemented.";
      if (item.tabId) sendDownloadProgress(item.tabId, item.id, undefined, item.error);
    } else {
      logger.logError(`[QueueProcessor _executeDownloadTask] Unknown item type: ${item.type} for item ID: ${item.id}`);
      item.status = "error";
      item.error = "Unknown download type";
      if (item.tabId) sendDownloadProgress(item.tabId, item.id, undefined, item.error);
    }
  } catch (err: any) {
    logger.logError(`[QueueProcessor _executeDownloadTask] Error processing item ${item.id}:`, err);
    item.status = "error";
    item.error = err.message || "Unknown error during processing";
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

// Load configuration and THEN register message listener AND SET INITIAL DNR RULE
loadConfiguration(true).then(async () => {
  logger.logInfo("Initial configuration loaded. Setting initial DNR rules.");

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
  } else if (progress === 100) {
    logger.logInfo(`Sending FINISHING message for download ${downloadId} to tab ${tabId}`);
  } else if (progress !== undefined && progress >= 0) {
    // logger.logDebug(`Sending progress update for download ${downloadId} to tab ${tabId}, progress=${progress.toFixed(1)}%`);
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

// Example existing message listener structure (adapt to your actual structure)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.logDebug("[Background] Received message:", message);

  // --- START NEW HANDLERS ---
  if (message.type === "EXTRACT_SCID_FROM_M4A") {
    if (!message.payload || !message.payload.buffer || !message.payload.filename) {
      logger.logError("[Background] Invalid payload for EXTRACT_SCID_FROM_M4A:", message.payload);
      sendResponse({ error: "Invalid payload for SCID extraction." });
      return true; // Indicate async response
    }

    const { filename, buffer } = message.payload;
    logger.logInfo(`[Background] EXTRACT_SCID_FROM_M4A: Received buffer for ${filename} (size: ${buffer.byteLength})`);

    try {
      const mp4Parser = new Mp4(buffer as ArrayBuffer);
      mp4Parser.parse(); // This initializes the atom structure

      if (!mp4Parser.hasValidMp4Structure) {
        logger.logWarn(`[Background] EXTRACT_SCID_FROM_M4A: File ${filename} does not have a valid MP4 structure.`);
        sendResponse({ error: `File ${filename} is not a valid MP4.` });
        return true;
      }

      // Path to the scid atom: moov -> udta -> meta -> ilst -> scid
      const scidPath = ["moov", "udta", "meta", "ilst", "scid"];
      const trackId = mp4Parser.findAndReadTextAtomData(scidPath);

      if (trackId) {
        logger.logInfo(`[Background] EXTRACT_SCID_FROM_M4A: Extracted SCID '${trackId}' from ${filename}`);
        sendResponse({ trackId: trackId });
      } else {
        logger.logWarn(`[Background] EXTRACT_SCID_FROM_M4A: SCID atom not found or no data in ${filename}`);
        sendResponse({ error: `SCID not found in ${filename}` });
      }
    } catch (error) {
      logger.logError(`[Background] EXTRACT_SCID_FROM_M4A: Error parsing ${filename}:`, error);
      sendResponse({ error: `Error parsing MP4 file ${filename}: ${error.message || error}` });
    }
    return true; // Indicate async response
  }

  if (message.type === "RESTORE_HISTORY_FROM_IDS") {
    if (!message.payload || !Array.isArray(message.payload.trackIds)) {
      logger.logError("[Background] Invalid payload for RESTORE_HISTORY_FROM_IDS:", message.payload);
      sendResponse({ error: "Invalid payload for history restoration." });
      return true; // Indicate async response
    }

    const { trackIds } = message.payload;
    logger.logInfo(`[Background] RESTORE_HISTORY_FROM_IDS: Received ${trackIds.length} track IDs to restore.`);

    if (trackIds.length === 0) {
      sendResponse({ message: "No track IDs provided to restore." });
      return true;
    }

    // Async IIFE to handle storage operations
    (async () => {
      try {
        const currentHistory = await getConfigValue("track-download-history") || {};
        let restoredCount = 0;
        trackIds.forEach(trackId => {
          if (typeof trackId === "string" && trackId.trim() !== "") {
            const key = `track-${trackId}`;
            if (!currentHistory[key]) { // Only add if not already present, or decide on update logic
              currentHistory[key] = {
                filename: `Restored: TrackID ${trackId}`,
                timestamp: Date.now()
              };
              restoredCount++;
            } else {
              logger.logDebug(`[Background] RESTORE_HISTORY_FROM_IDS: Track ${trackId} already in history, skipping.`);
            }
          }
        });

        await storeConfigValue("track-download-history", currentHistory);
        logger.logInfo(`[Background] RESTORE_HISTORY_FROM_IDS: Successfully restored ${restoredCount} new tracks to history.`);
        sendResponse({ message: `Successfully restored ${restoredCount} new tracks out of ${trackIds.length} to download history.` });
      } catch (error) {
        logger.logError("[Background] RESTORE_HISTORY_FROM_IDS: Error accessing storage or processing IDs:", error);
        sendResponse({ error: `Error restoring history: ${error.message || error}` });
      }
    })();
    return true; // Indicate async response for the storage operations
  }
  // --- END NEW HANDLERS ---

  // ... your other existing message handlers ...
  // For example:
  // if (message.type === "GET_QUEUE_DATA") { ... }

  // If no specific handler matched and it's not an async response, 
  // you might have a fallback or just let it be.
  // IMPORTANT: Ensure that sendResponse is called only once per message, 
  // or not at all if you don't intend to send a response from a particular branch.
  // If you have synchronous handlers that don't sendResponse, returning false or undefined is fine.
  // For async handlers like these new ones, returning true is crucial.
});

