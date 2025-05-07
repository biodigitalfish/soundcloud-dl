import { SoundCloudApi } from "./soundcloudApi";
import { LogLevel, Logger } from "./utils/logger";
import {
  onBeforeSendHeaders,
  onBeforeRequest,
  onMessage,
  onPageActionClicked,
  openOptionsPage,
  getExtensionManifest,
  sendMessageToTab,
} from "./compatibilityStubs";
import { loadConfiguration, storeConfigValue, getConfigValue, registerConfigChangeHandler } from "./utils/config";
import { handleIncomingMessage } from "./messageHandler";
import { DownloadProgress } from "./types";
import { usesDeclarativeNetRequestForModification, setAuthHeaderRule, setClientIdRule } from "./utils/browser";

// --- Main TrackError class for background.ts specific errors ---
export class TrackError extends Error {
  constructor(message: string, trackId?: number) {
    super(trackId ? `${message} (TrackId: ${trackId})` : message);
  }
}

const soundcloudApi = new SoundCloudApi();
const logger = Logger.create("Background", LogLevel.Debug);
const manifest = getExtensionManifest();

const RULE_ID_OAUTH = 1;
const RULE_ID_CLIENT_ID = 2;

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

logger.infoInfo("Starting with version: " + manifest.version);

// Load configuration and THEN register message listener AND SET INITIAL DNR RULE
loadConfiguration(true).then(async () => {
  logger.infoInfo("Initial configuration loaded. Registering message listener and setting initial DNR rules.");
  onMessage(handleIncomingMessage);

  const initialOauthToken = getConfigValue("oauth-token") as string | null | undefined;
  await updateAuthHeaderRule(initialOauthToken);

  const initialClientId = getConfigValue("client-id") as string | null | undefined;
  await updateClientIdRule(initialClientId);

  if (initialOauthToken) {
    await oauthTokenChanged(initialOauthToken);
  }
});

// --- EXPORTED Utility Functions (used by messageHandler.ts) ---
export function sendDownloadProgress(tabId: number, downloadId: string, progress?: number, error?: Error | string, status?: "Paused" | "Resuming", browserDownloadId?: number) {
  // Enhanced validation of downloadId
  if (!downloadId || typeof downloadId !== "string" || downloadId.trim() === "") {
    logger.infoError(`Attempted to send download progress with invalid downloadId: ${JSON.stringify(downloadId)}`);

    // Rather than completely failing, try to log helpful diagnostic info
    const callStack = new Error().stack;
    logger.infoError(`Call stack for invalid downloadId: ${callStack}`);

    // For messages with progress codes that indicate completion, we should really
    // try to send them even without a downloadId
    if (progress === 101 || progress === 102) {
      logger.infoWarn(`Attempting to send COMPLETION message (${progress}) even with missing downloadId`);
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
        logger.infoError(`Failed to send fallback completion message: ${err}`);
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
    logger.infoInfo(`Sending COMPLETION message for download ${downloadId} to tab ${tabId}, progress=${progress}`);
  } else if (progress === 100) {
    logger.infoInfo(`Sending FINISHING message for download ${downloadId} to tab ${tabId}`);
  } else if (progress !== undefined && progress >= 0) {
    // logger.infoDebug(`Sending progress update for download ${downloadId} to tab ${tabId}, progress=${progress.toFixed(1)}%`);
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
    logger.infoInfo(`Sending SINGLE COMPLETION message for download ${downloadId} to tab ${tabId}, progress=${progress} (BrowserDownloadId: ${browserDownloadId || "N/A"})`);
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.infoWarn(`Failed to send completion message to tab ${tabId}:`, err);
    });
  } else { // For other progress, pause, resume, or general updates
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.infoWarn(`Failed to send progress/status message to tab ${tabId}:`, err);
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
              logger.infoInfo("Sniffed and storing OAuth token from request header (all envs).");
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
            logger.infoInfo("Sniffed and storing OAuth token (Firefox/non-DNR).");
            storeConfigValue("oauth-token", result[1]);
          }
          break;
        }
      }
      if (!requestHasAuth && oauthToken) {
        // logger.infoDebug(`Adding OAuth token to request for ${details.url} (Firefox/non-DNR)`);
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
      logger.infoInfo("User logged in - clearing potentially stale token.");
      storeConfigValue("oauth-token", undefined);
    } else if (url.pathname === "/sign-out") {
      logger.infoInfo("User logged out");
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
          logger.infoInfo(`Found new client_id: ${clientIdFromUrl}. Storing it.`);
          storeConfigValue("client-id", clientIdFromUrl);
        }
      } else {
        if (!usesDeclarativeNetRequestForModification()) {
          const storedClientId = getConfigValue("client-id") as string | null;
          if (storedClientId) {
            logger.infoDebug(`Adding ClientId to ${details.url} via redirect (Firefox/non-DNR)`);
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

onPageActionClicked(() => {
  openOptionsPage();
});

const oauthTokenChanged = async (token: string | null | undefined) => {
  if (!token) {
    storeConfigValue("user-id", null);
    logger.infoInfo("OAuth token cleared, user ID cleared.");
    return;
  }
  const user = await soundcloudApi.getCurrentUser();
  if (!user) {
    logger.infoError("Failed to fetch currently logged in user (after token change/init)");
    return;
  }
  storeConfigValue("user-id", user.id);
  logger.infoInfo("Logged in as", user.username);
  const followedArtistIds = await soundcloudApi.getFollowedArtistIds(user.id);
  if (!followedArtistIds) {
    logger.infoError("Failed to fetch ids of followed artists");
    return;
  }
  storeConfigValue("followed-artists", followedArtistIds);
};

registerConfigChangeHandler("oauth-token", async (newValue) => {
  await updateAuthHeaderRule(newValue as string | null | undefined);
  await oauthTokenChanged(newValue as string | null | undefined);
});

registerConfigChangeHandler("client-id", async (newClientId) => {
  logger.infoInfo(`client-id config changed to: ${newClientId}. Updating DNR rule.`);
  await updateClientIdRule(newClientId as string | null | undefined);
});

