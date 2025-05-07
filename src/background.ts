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

async function updateAuthHeaderRule(oauthToken?: string | null) {
  if (!(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
    logger.logDebug("Skipping DNR update for OAuth: Not a Chrome MV3+ env or DNR unavailable.");
    return;
  }
  const rulesToAdd: chrome.declarativeNetRequest.Rule[] = [];
  const rulesToRemove: number[] = [RULE_ID_OAUTH];

  if (oauthToken) {
    rulesToAdd.push({
      id: RULE_ID_OAUTH,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          { header: "authorization", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: `OAuth ${oauthToken}` }
        ]
      },
      condition: {
        urlFilter: "*://api-v2.soundcloud.com/*",
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
        ]
      }
    });
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rulesToRemove,
      addRules: rulesToAdd
    });
    logger.logInfo(`OAuth DNR rule updated. Token: ${oauthToken ? "SET" : "REMOVED"}`);
  } catch (error) {
    logger.logError("Failed to update DNR rules for OAuth token:", error);
  }
}

async function updateClientIdRule(clientId?: string | null) {
  if (!(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
    logger.logDebug("Skipping DNR update for ClientID: Not a Chrome MV3+ env or DNR unavailable.");
    return;
  }
  const rulesToAdd: chrome.declarativeNetRequest.Rule[] = [];
  const rulesToRemove: number[] = [RULE_ID_CLIENT_ID];

  if (clientId) {
    rulesToAdd.push({
      id: RULE_ID_CLIENT_ID,
      priority: 2,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: "client_id", value: clientId }]
            }
          }
        }
      },
      condition: {
        urlFilter: "*://api-v2.soundcloud.com/*",
        excludedRequestDomains: [],
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
      }
    });
    rulesToAdd[0].condition = {
      urlFilter: "*://api-v2.soundcloud.com/*",
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
    };
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rulesToRemove,
      addRules: rulesToAdd
    });
    logger.logInfo(`Client_id DNR rule updated. ClientID: ${clientId ? "SET" : "REMOVED"}`);
  } catch (error) {
    logger.logError("Failed to update DNR rules for client_id:", error);
  }
}

logger.logInfo("Starting with version: " + manifest.version);

// Load configuration and THEN register message listener AND SET INITIAL DNR RULE
loadConfiguration(true).then(async () => {
  logger.logInfo("Initial configuration loaded. Registering message listener and setting initial DNR rules.");
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
    logger.logDebug(`Sending progress update for download ${downloadId} to tab ${tabId}, progress=${progress.toFixed(1)}%`);
  }

  const downloadProgressMessage: DownloadProgress = {
    downloadId,
    progress,
    error: errorMessage,
    status,
    timestamp: Date.now(), // Add timestamp to help with matching in content.ts
    browserDownloadId      // Include browserDownloadId in all messages
  };

  if (progress === 101 || progress === 102) {
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.logWarn(`Failed to send completion message to tab ${tabId} on first attempt:`, err);

      setTimeout(() => {
        logger.logInfo(`Retrying completion message for download ${downloadId} to tab ${tabId}`);
        sendMessageToTab(tabId, downloadProgressMessage).catch(retryErr => {
          logger.logError("Failed to send completion message on retry:", retryErr);
        });
      }, 500);
    });

    setTimeout(() => {
      logger.logInfo(`Sending backup completion message for download ${downloadId} to tab ${tabId}`);

      const backupMessage = {
        ...downloadProgressMessage,
        completed: true,
        backupMessage: true,
        timestamp: Date.now()
      };

      sendMessageToTab(tabId, backupMessage).catch(err => {
        logger.logError("Failed to send backup completion message:", err);
      });
    }, 1000);

    // Send one more final completion message with an even longer delay
    // This helps catch cases where the tab might have been temporarily unresponsive
    setTimeout(() => {
      logger.logInfo(`Sending final backup completion message for download ${downloadId} to tab ${tabId}`);

      const finalBackupMessage = {
        ...downloadProgressMessage,
        completed: true,
        backupMessage: true,
        finalBackup: true,
        timestamp: Date.now()
      };

      sendMessageToTab(tabId, finalBackupMessage).catch(err => {
        logger.logError("Failed to send final backup completion message:", err);
      });
    }, 5000);
  } else {
    sendMessageToTab(tabId, downloadProgressMessage).catch(err => {
      logger.logWarn(`Failed to send progress message to tab ${tabId}:`, err);
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
    if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
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
        if (typeof browser !== "undefined" && !(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
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

onPageActionClicked(() => {
  openOptionsPage();
});

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

