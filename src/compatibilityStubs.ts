import { Logger } from "./utils/logger";
import { revokeURL } from "./utils/browser";

const logger = Logger.create("Compatibility Stubs");

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

export const onMessage = (callback: AsyncMessageCallback) => {
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message: any, sender: browser.runtime.MessageSender) => {
      if (sender.id !== browser.runtime.id || !message) {
        return Promise.resolve({ error: "Invalid message or sender from extension" });
      }
      return callback(message, sender as MinimalMessageSender)
        .catch(err => {
          logger.logError("Error in onMessage callback (Firefox):", err);
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
        .then(responsePayload => {
          sendResponse(responsePayload);
        })
        .catch(err => {
          logger.logError("Error in onMessage callback (Chrome), responding with error:", err);
          sendResponse({ error: (err as Error)?.message || "Unknown error in callback" });
        });

      return true;
    });
  } else {
    logger.logError("Browser does not support runtime.onMessage");
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
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage) {
    return browser.runtime.sendMessage(message);
  } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  } else {
    return Promise.reject("Browser does not support runtime.sendMessage");
  }
};

export const sendMessageToTab = (tabId: number, message: any): Promise<any> => {
  if (typeof browser !== "undefined" && browser.tabs && browser.tabs.sendMessage) {
    return browser.tabs.sendMessage(tabId, message);
  } else if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  } else {
    return Promise.reject("Browser does not support tabs.sendMessage");
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
