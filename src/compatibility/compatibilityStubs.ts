import { Logger } from "../utils/logger";
import { revokeURL } from "../utils/browser";

const logger = Logger.create("Compatibility Stubs");

const SCRIPT_ID = "soundcloud-dl-bridge"; // Same ID as in bridge-content-script.ts

// Define minimal interfaces for compatibility
interface MinimalTab {
  id?: number;
  // url?: string; // Add if used by handleIncomingMessage from sender.tab
}

interface MinimalMessageSender {
  id?: string;      // Extension ID
  url?: string;     // URL of the sender (if a content script or page)
  tab?: MinimalTab; // Tab a content script is in (if applicable)
  // frameId?: number; // Add if used
}

type AsyncMessageCallback = (message: any, sender: MinimalMessageSender) => Promise<any>;

// Keep the old onMessage for non-page contexts, rename it slightly
const originalRuntimeOnMessage = (callback: AsyncMessageCallback) => {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message: any, sender: browser.runtime.MessageSender) => {
      if (sender.id !== browser.runtime.id || !message) {
        return Promise.resolve({ error: "Invalid message or sender from extension" });
      }
      return callback(message, sender as MinimalMessageSender)
        .catch(err => {
          logger.logError("Error in originalRuntimeOnMessage callback (Firefox):", err);
          return Promise.reject({ error: (err as Error)?.message || "Unknown error in callback" });
        });
    });
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (sender.id !== chrome.runtime.id || !message) {
        sendResponse({ error: "Invalid message or sender from extension" });
        return false;
      }
      callback(message, sender as MinimalMessageSender)
        .then(responsePayload => sendResponse(responsePayload))
        .catch(err => {
          logger.logError("Error in originalRuntimeOnMessage callback (Chrome), responding with error:", err);
          sendResponse({ error: (err as Error)?.message || "Unknown error in callback" });
        });
      return true;
    });
  } else {
    // This case should ideally not be hit if context detection is right for the new onMessage
    logger.logError("[CompatibilityStubs] originalRuntimeOnMessage: Browser does not support runtime.onMessage");
  }
};

// New onMessage that delegates or uses window.postMessage
export const onMessage = (callback: AsyncMessageCallback) => {
  const isPageContext = typeof chrome === "undefined" || typeof chrome.runtime === "undefined" || typeof chrome.runtime.id === "undefined";

  if (isPageContext && typeof window !== "undefined") {
    logger.logDebug("[CompatibilityStubs] onMessage: Setting up window.addEventListener for page context.");
    window.addEventListener("message", (event: MessageEvent) => {
      let eventDataString = "<No Data>";
      let dataDirection = "<No Direction Property>";
      let dataSource = "<No Source Property>";
      try {
        if (event.data) {
          eventDataString = JSON.stringify(event.data);
          if (typeof event.data.direction === "string") dataDirection = event.data.direction;
          if (typeof event.data.source === "string") dataSource = event.data.source;
        }
      } catch { eventDataString = "<Error Stringifying Data>"; }

      logger.logInfo(`[CompatStubs Listener Raw Detail] Received window message: sourceIsWindow=${event.source === window}, event.data.source='${dataSource}', SCRIPT_ID='${SCRIPT_ID}', event.data.direction='${dataDirection}', expectedDirection='from-background-via-bridge', FullData=${eventDataString}`);

      const cond1 = event.source === window;
      const cond2 = !!event.data;
      let cond3 = false;
      let cond4 = false;
      let actualEventDataSource = "<event.data was null>";
      let actualEventDataDirection = "<event.data was null>";

      if (cond2) { // only check event.data.source if event.data exists
        actualEventDataSource = event.data.source;
        actualEventDataDirection = event.data.direction;
        cond3 = event.data.source === SCRIPT_ID;
        cond4 = event.data.direction === "from-background-via-bridge";
      }

      logger.logInfo(`[CompatStubs EVAL CHECK] cond1 (event.source === window): ${cond1}`);
      logger.logInfo(`[CompatStubs EVAL CHECK] cond2 (!!event.data): ${cond2}`);
      logger.logInfo(`[CompatStubs EVAL CHECK] cond3 (event.data.source === SCRIPT_ID): ${cond3} (event.data?.source: '${actualEventDataSource}', SCRIPT_ID: '${SCRIPT_ID}')`);
      logger.logInfo(`[CompatStubs EVAL CHECK] cond4 (event.data.direction === "from-background-via-bridge"): ${cond4} (event.data?.direction: '${actualEventDataDirection}')`);
      logger.logInfo(`[CompatStubs EVAL CHECK] Full event.data for this check: ${eventDataString}`);


      if (
        cond1 && cond2 && cond3 && cond4
      ) {
        // Use logger.logDebug - it handles the check internally
        logger.logDebug(">>> COMPATIBILITY STUBS: PAGE CONTEXT LISTENER: PASSED ALL FILTERS! <<< Payload:", JSON.stringify(event.data.payload));

        const simulatedSender: MinimalMessageSender = { id: (typeof chrome !== "undefined" && chrome.runtime) ? chrome.runtime.id : undefined }; // Ensure id can be undefined safely

        // Execute the callback, but don't automatically send its response back
        callback(event.data.payload, simulatedSender)
          .catch(err => logger.logError("Error in onMessage callback (page context):", err));
      } else {
        // If cond4 is false, it might be an outgoing message.
        // Outgoing messages have:
        // cond1=true (event.source === window)
        // cond2=true (!!event.data)
        // cond3=true (event.data.source === SCRIPT_ID)
        // event.data.direction === "to-background-via-bridge" (which makes cond4 false)

        if (cond1 && cond2 && cond3 && event.data && event.data.direction === "to-background-via-bridge") {
          // This is an outgoing message (likely from sendMessageToBackend in this file)
          // that this general listener caught. This is expected and should be ignored silently.
          // logger.logDebug("[CompatStubs onMessage] Ignored self-posted outgoing message intended for the bridge.");
        } else {
          // The message failed the filter conditions for other reasons,
          // or it was an incoming message with an unexpected structure/direction. This is worth warning about.
          logger.logWarn(`[CompatStubs FILTER FAILED] Conditions: cond1=${cond1}, cond2=${cond2}, cond3=${cond3}, cond4=${cond4}. Full event.data: ${eventDataString}`);
        }
      }
    });
  } else {
    logger.logDebug("[CompatibilityStubs] onMessage: Using original runtime.onMessage for extension context.");
    originalRuntimeOnMessage(callback); // Call the old logic for background/popup/isolated content scripts
  }
};

type BeforeSendHeadersCallback = (details: chrome.webRequest.WebRequestHeadersDetails) => chrome.webRequest.BlockingResponse | void;
export const onBeforeSendHeaders = (callback: BeforeSendHeadersCallback, urls?: string[], extraInfos?: string[]) => {
  const filter = { urls: urls || [] };
  if (typeof browser !== "undefined" && browser.webRequest && browser.webRequest.onBeforeSendHeaders) {
    browser.webRequest.onBeforeSendHeaders.addListener(callback as any, filter, extraInfos as browser.webRequest.OnBeforeSendHeadersOptions[]);
  } else if (typeof chrome !== "undefined" && chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
    let mv3ExtraInfos = extraInfos;
    if (chrome.runtime.getManifest().manifest_version === 3 && extraInfos) {
      mv3ExtraInfos = extraInfos.filter(info => info !== "blocking");
    }
    chrome.webRequest.onBeforeSendHeaders.addListener(callback, filter, mv3ExtraInfos);
  } else {
    logger.logError("Browser does not support webRequest.onBeforeSendHeaders");
  }
};

type OnBeforeRequestCallback = (details: chrome.webRequest.WebRequestBodyDetails) => chrome.webRequest.BlockingResponse | void;
export const onBeforeRequest = (callback: OnBeforeRequestCallback, urls: string[], extraInfos?: string[]) => {
  const filter = { urls: urls || [] };
  if (typeof browser !== "undefined" && browser.webRequest && browser.webRequest.onBeforeRequest) {
    browser.webRequest.onBeforeRequest.addListener(callback as any, filter, extraInfos as browser.webRequest.OnBeforeRequestOptions[]);
  } else if (typeof chrome !== "undefined" && chrome.webRequest && chrome.webRequest.onBeforeRequest) {
    let mv3ExtraInfos = extraInfos;
    if (chrome.runtime.getManifest().manifest_version === 3 && extraInfos) {
      mv3ExtraInfos = extraInfos.filter(info => info !== "blocking");
    }
    chrome.webRequest.onBeforeRequest.addListener(callback, filter, mv3ExtraInfos);
  } else {
    logger.logError("Browser does not support webRequest.onBeforeRequest");
  }
};

export const downloadToFile = (url: string, filename: string, saveAs: boolean): Promise<number> => {
  const downloadOptions: chrome.downloads.DownloadOptions = {
    url,
    filename,
    saveAs,
    conflictAction: "uniquify" // A sensible default
  };

  return new Promise<number>((resolve, reject) => {
    let downloadIdInternal: number | undefined; // Renamed for clarity
    let onChangedHandlerInstance: ((delta: any) => void) | undefined;

    // MODIFIED: Takes currentDownloadId, acts as a detached listener for logging/cleanup
    const createAndRegisterOnChangedHandler = (browserOrChrome: typeof chrome | typeof browser, currentDownloadId: number) => {
      const handler = (delta: any) => {
        if (delta.id === currentDownloadId) {
          if (delta.state?.current === "complete") {
            if (onChangedHandlerInstance) browserOrChrome.downloads.onChanged.removeListener(onChangedHandlerInstance);
            revokeURL(url); // Use our utility instead of URL.revokeObjectURL
            logger.logInfo(`Download ${currentDownloadId} completed and cleaned up.`);
            // The main promise has already resolved with the ID.
          } else if (delta.state?.current === "interrupted" || (delta.error && delta.error.current !== "USER_CANCELED" && delta.error.current !== "DOWNLOAD_CANCELLED_BY_USER")) {
            if (onChangedHandlerInstance) browserOrChrome.downloads.onChanged.removeListener(onChangedHandlerInstance);
            const errorReason = delta.error?.current || delta.error?.message || "Download was interrupted";
            logger.logWarn(`Download ${currentDownloadId} failed or interrupted post-initiation: ${errorReason}`);
            revokeURL(url); // Use our utility instead of URL.revokeObjectURL
            // The main promise might have already resolved. This failure is post-initiation.
          } else if (delta.error && (delta.error.current === "USER_CANCELED" || delta.error.current === "DOWNLOAD_CANCELLED_BY_USER")) {
            logger.logInfo(`Download ${currentDownloadId} was canceled by the user.`);
            if (onChangedHandlerInstance) browserOrChrome.downloads.onChanged.removeListener(onChangedHandlerInstance);
            revokeURL(url); // Use our utility instead of URL.revokeObjectURL
          }
        }
      };
      onChangedHandlerInstance = handler; // Assign to the outer scope variable
      browserOrChrome.downloads.onChanged.addListener(onChangedHandlerInstance as any);
    };

    if (typeof browser !== "undefined" && browser.downloads) { // Firefox path
      browser.downloads.download(downloadOptions as browser.downloads._DownloadOptions).then((id) => {
        if (id === undefined) {
          const errMsg = browser.runtime.lastError?.message || "Download initiation failed in Firefox: No downloadId returned.";
          logger.logError("Firefox download initiation error (no id):", errMsg);
          revokeURL(url); // Use our utility instead of URL.revokeObjectURL
          reject(new Error(errMsg)); // Reject the promise that should return an ID
          return;
        }
        downloadIdInternal = id;
        createAndRegisterOnChangedHandler(browser, downloadIdInternal);
        resolve(downloadIdInternal); // Resolve with the ID
      }).catch(err => {
        const errMsg = (err as Error)?.message || String(err) || "browser.downloads.download call failed";
        logger.logError("Firefox browser.downloads.download promise rejected:", errMsg);
        revokeURL(url); // Use our utility instead of URL.revokeObjectURL
        reject(new Error(`Firefox download failed: ${errMsg}`)); // Reject the promise
      });
    } else if (typeof chrome !== "undefined" && chrome.downloads) { // Chrome path
      chrome.downloads.download(downloadOptions, (idCallbackValue) => { // Renamed 'id' to 'idCallbackValue'
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "Download initiation failed in Chrome (callback error)";
          logger.logError("Chrome download initiation error (lastError):", errMsg);
          revokeURL(url); // Use our utility instead of URL.revokeObjectURL
          reject(new Error(errMsg)); // Reject the promise
          return;
        }
        if (idCallbackValue === undefined) {
          const errMsg = "Download initiation failed: no downloadId returned (Chrome).";
          logger.logError(errMsg);
          revokeURL(url); // Use our utility instead of URL.revokeObjectURL
          reject(new Error(errMsg)); // Reject the promise
          return;
        }
        downloadIdInternal = idCallbackValue;
        createAndRegisterOnChangedHandler(chrome, downloadIdInternal);
        resolve(downloadIdInternal); // Resolve with the ID
      });
    } else {
      revokeURL(url); // Use our utility instead of URL.revokeObjectURL
      reject(new Error("Browser does not support downloads.download API"));
    }
  });
};

export const sendMessageToBackend = (message: any): Promise<any> => {
  // Heuristic: If chrome.runtime.id is not available, we are likely in page context.
  // Or, if window object exists and this isn't a service worker context (where window is undefined).
  const isPageContext = typeof chrome === "undefined" || typeof chrome.runtime === "undefined" || typeof chrome.runtime.id === "undefined";

  if (isPageContext && typeof window !== "undefined") {
    logger.logDebug("[CompatibilityStubs] sendMessageToBackend: Using window.postMessage via bridge.", message);
    return new Promise((resolve, reject) => {
      const messageId = crypto.randomUUID(); // To correlate responses
      const messageToSend = {
        source: SCRIPT_ID,
        direction: "to-background-via-bridge",
        payload: message,
        messageId: messageId
      };

      const responseListener = (event: MessageEvent) => {
        if (
          event.source === window &&
          event.data &&
          event.data.source === SCRIPT_ID &&
          event.data.direction === "from-background-via-bridge" &&
          event.data.payload &&
          event.data.messageId === messageId // Check if this response is for our message
        ) {
          window.removeEventListener("message", responseListener);
          if (event.data.payload.error) {
            logger.logWarn("[CompatibilityStubs] Error response from bridge:", event.data.payload.error);
            reject(new Error(event.data.payload.error));
          } else {
            resolve(event.data.payload);
          }
        }
      };

      window.addEventListener("message", responseListener);
      window.postMessage(messageToSend, "*");

      // Timeout for the response
      setTimeout(() => {
        window.removeEventListener("message", responseListener);
        reject(new Error("Timeout waiting for response from bridge for sendMessageToBackend"));
      }, 15000); // 15-second timeout
    });
  } else if (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage) {
    logger.logDebug("[CompatibilityStubs] sendMessageToBackend: Using browser.runtime.sendMessage.", message);
    return browser.runtime.sendMessage(message);
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    logger.logDebug("[CompatibilityStubs] sendMessageToBackend: Using chrome.runtime.sendMessage.", message);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          logger.logError("[CompatibilityStubs] sendMessageToBackend lastError:", chrome.runtime.lastError);
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  } else {
    logger.logError("[CompatibilityStubs] sendMessageToBackend: Browser does not support runtime.sendMessage and not in page context for bridge.");
    return Promise.reject(new Error("Browser does not support runtime.sendMessage"));
  }
};

export const sendMessageToTab = (tabId: number, message: any): Promise<any> => {
  if (typeof browser !== "undefined" && browser.tabs && browser.tabs.sendMessage) {
    return browser.tabs.sendMessage(tabId, message)
      .catch(error => {
        // For Firefox, check the error message directly
        const errorMessage = error && error.message ? error.message.toLowerCase() : "";
        if (errorMessage.includes("receiving end does not exist") || errorMessage.includes("could not establish connection")) {
          logger.logDebug(`[CompatibilityStubs sendMessageToTab FF] Tab ${tabId} not available or content script not ready. Message:`, message);
          return Promise.resolve({ ScdlCompatStubTabUnavailable: true, tabId, browser: "firefox" }); // Resolve instead of reject
        }
        logger.logWarn(`[CompatibilityStubs sendMessageToTab FF] Error sending message to tab ${tabId}:`, error, "Original message:", message);
        return Promise.reject(error); // Re-reject for other errors
      });
  } else if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message ? chrome.runtime.lastError.message.toLowerCase() : "";
          if (errorMessage.includes("receiving end does not exist") || errorMessage.includes("could not establish connection")) {
            logger.logDebug(`[CompatibilityStubs sendMessageToTab Chrome] Tab ${tabId} not available or content script not ready (lastError: ${chrome.runtime.lastError.message}). Message:`, message);
            // Resolve with a special object or undefined to indicate non-critical failure
            resolve({ ScdlCompatStubTabUnavailable: true, tabId, browser: "chrome" });
          } else {
            // For other errors, reject as before
            logger.logWarn(`[CompatibilityStubs sendMessageToTab Chrome] chrome.runtime.lastError sending to tab ${tabId}:`, chrome.runtime.lastError, "Original message:", message);
            reject(chrome.runtime.lastError);
          }
        } else {
          resolve(response);
        }
      });
    });
  } else {
    logger.logError("[CompatibilityStubs sendMessageToTab] Browser does not support tabs.sendMessage");
    return Promise.reject(new Error("Browser does not support tabs.sendMessage"));
  }
};

export const onPageActionClicked = (callback: (tabId?: number) => void) => {
  if (typeof browser !== "undefined" && browser.pageAction) {
    browser.pageAction.onClicked.addListener((tab) => callback(tab.id));
  } else if (typeof chrome !== "undefined" && chrome.action) {
    chrome.action.onClicked.addListener((tab) => callback(tab.id));
  } else {
    logger.logError("Browser does not support pageAction.onClicked or action.onClicked");
  }
};

export const openOptionsPage = () => {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.openOptionsPage) {
    browser.runtime.openOptionsPage();
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    logger.logError("Browser does not support runtime.openOptionsPage");
  }
};

export interface StorageChange {
  newValue?: any;
  oldValue?: any;
}

export const onStorageChanged = (callback: (changes: { [key: string]: StorageChange }, areaName: string) => void) => {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener(callback);
  } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(callback);
  } else {
    logger.logError("Browser does not support storage.onChanged");
  }
};

export const setSyncStorage = (values: { [key: string]: any }): Promise<void> => {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.sync) {
    return browser.storage.sync.set(values);
  } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.sync.set(values, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  } else {
    return Promise.reject("Browser does not support storage.sync.set");
  }
};

export const getSyncStorage = (keys?: string | string[] | null): Promise<{ [key: string]: any }> => {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.sync) {
    return browser.storage.sync.get(keys as any);
  } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
    return new Promise<{ [key: string]: any }>((resolve, reject) => {
      chrome.storage.sync.get(keys ?? null, (items) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(items);
      });
    });
  } else {
    return Promise.reject("Browser does not support storage.sync.get");
  }
};

export const setLocalStorage = (values: { [key: string]: any }): Promise<void> => {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
    return browser.storage.local.set(values);
  } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  } else {
    return Promise.reject("Browser does not support storage.local.set");
  }
};

export const getLocalStorage = (keys?: string | string[] | null): Promise<{ [key: string]: any }> => {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
    return browser.storage.local.get(keys as any);
  } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return new Promise<{ [key: string]: any }>((resolve, reject) => {
      chrome.storage.local.get(keys ?? null, (items) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(items);
      });
    });
  } else {
    return Promise.reject("Browser does not support storage.local.get");
  }
};

// Define a minimal Manifest type for browser compatibility if specific one is not found
interface MinimalManifest {
  manifest_version: number;
  name: string;
  version: string;
  [key: string]: any; // Allow other properties
}

export const getExtensionManifest = (): chrome.runtime.Manifest | MinimalManifest | null => {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getManifest) {
    return browser.runtime.getManifest() as unknown as MinimalManifest; // Cast to MinimalManifest
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
    return chrome.runtime.getManifest();
  } else {
    logger.logError("Browser does not support runtime.getManifest");
    return null;
  }
};

export const getPathFromExtensionFile = (relativePath: string): string | null => {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL) { // Modern Firefox
    return browser.runtime.getURL(relativePath);
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) { // Chrome and compatible
    return chrome.runtime.getURL(relativePath);
  } else {
    logger.logError("Browser does not support runtime.getURL");
    return null;
  }
};

export const searchDownloads = (query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]> => {
  if (typeof browser !== "undefined" && browser.downloads && browser.downloads.search) {
    return browser.downloads.search(query as any).then(items => {
      return items.map(item => ({
        ...item,
        finalUrl: item.url, // Add finalUrl, using url as a fallback for compatibility
      })) as chrome.downloads.DownloadItem[]; // Cast to chrome.downloads.DownloadItem[]
    });
  } else if (typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.search) {
    return new Promise<chrome.downloads.DownloadItem[]>((resolve) => {
      chrome.downloads.search(query, resolve);
    });
  } else {
    logger.logError("Browser does not support downloads.search");
    return Promise.resolve([]);
  }
};
