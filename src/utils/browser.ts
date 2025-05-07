/**
 * Browser utility functions to handle differences between browsers
 * and provide fallbacks for missing API features.
 */

import { Logger } from "./logger";

const logger = Logger.create("Browser-Utils");

/**
 * Detects which browser we're running in
 */
export function detectBrowser(): "firefox" | "chrome" | "unknown" {
    if (typeof browser !== "undefined") {
        return "firefox";
    } else if (typeof chrome !== "undefined") {
        return "chrome";
    }
    return "unknown";
}

/**
 * Detects if we're running in MV3 context
 */
export function isManifestV3(): boolean {
    try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
            return chrome.runtime.getManifest().manifest_version === 3;
        } else if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getManifest) {
            return browser.runtime.getManifest().manifest_version === 3;
        }
    } catch (e) {
        logger.infoWarn("Failed to detect manifest version:", e);
    }
    return false;
}

/**
 * Detects if we're running in a service worker context
 */
export function isServiceWorkerContext(): boolean {
    return typeof self !== "undefined" && typeof window === "undefined" && isManifestV3();
}

/**
 * Detects if the current environment (specifically Chrome MV3+) primarily uses
 * declarativeNetRequest for network modifications like adding headers or redirecting.
 */
export function usesDeclarativeNetRequestForModification(): boolean {
    // This assumes that if declarativeNetRequest is available and it's MV3,
    // we intend to use it for modifications handled by the background script.
    return typeof chrome !== "undefined" && chrome.declarativeNetRequest && isManifestV3();
}

// Define rule IDs consistently (can also be imported if defined elsewhere)
const RULE_ID_OAUTH = 1;
const RULE_ID_CLIENT_ID = 2;

/**
 * Sets or removes the OAuth header declarativeNetRequest rule if DNR is used for modification.
 * @param oauthToken The OAuth token to set, or null/undefined to remove the rule.
 */
export async function setAuthHeaderRule(oauthToken?: string | null): Promise<void> {
    if (!usesDeclarativeNetRequestForModification()) {
        logger.infoDebug("Skipping declarativeNetRequest OAuth rule update: DNR not used for modification in this environment.");
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
        // Ensure chrome.declarativeNetRequest is defined before calling updateDynamicRules
        if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: rulesToRemove,
                addRules: rulesToAdd
            });
            logger.infoInfo(`OAuth DNR rule updated. Token: ${oauthToken ? "SET" : "REMOVED"}`);
        } else {
            logger.infoError("Cannot update DNR rules: chrome.declarativeNetRequest is not defined.");
        }
    } catch (error) {
        logger.infoError("Failed to update DNR rules for OAuth token:", error);
    }
}

/**
 * Sets or removes the Client ID declarativeNetRequest rule if DNR is used for modification.
 * @param clientId The Client ID to set, or null/undefined to remove the rule.
 */
export async function setClientIdRule(clientId?: string | null): Promise<void> {
    if (!usesDeclarativeNetRequestForModification()) {
        logger.infoDebug("Skipping declarativeNetRequest ClientID rule update: DNR not used for modification in this environment.");
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
                excludedRequestDomains: [], // Potentially limit to soundcloud.com if needed
                resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
            }
        });
        // Ensure condition is set correctly based on your logic in background.ts
        rulesToAdd[0].condition = {
            urlFilter: "*://api-v2.soundcloud.com/*",
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
        };
    }

    try {
        // Ensure chrome.declarativeNetRequest is defined before calling updateDynamicRules
        if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: rulesToRemove,
                addRules: rulesToAdd
            });
            logger.infoInfo(`Client_id DNR rule updated. ClientID: ${clientId ? "SET" : "REMOVED"}`);
        } else {
            logger.infoError("Cannot update DNR rules: chrome.declarativeNetRequest is not defined.");
        }
    } catch (error) {
        logger.infoError("Failed to update DNR rules for client_id:", error);
    }
}

/**
 * Creates a URL from a Blob with fallbacks for service workers
 * @param blob The blob to create a URL for
 * @returns A URL string (object URL or data URL)
 */
export async function createURLFromBlob(blob: Blob): Promise<string> {
    // First try with URL.createObjectURL which is more efficient
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        try {
            logger.infoDebug("Using URL.createObjectURL");
            return URL.createObjectURL(blob);
        } catch (e) {
            logger.infoWarn("URL.createObjectURL failed:", e);
            // Fall through to FileReader fallback
        }
    }

    // Fallback to data URL
    logger.infoInfo("Falling back to FileReader.readAsDataURL");
    try {
        const reader = new FileReader();
        return await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (e) => reject(new Error(`FileReader failed: ${e}`));
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        logger.infoError("Both URL creation methods failed:", e);
        throw new Error(`Failed to create URL from blob: ${e.message}`);
    }
}

/**
 * Safely revokes a URL created with createURLFromBlob
 * @param url The URL to revoke (object URL or data URL)
 */
export function revokeURL(url: string): void {
    if (url && url.startsWith("blob:")) {
        try {
            URL.revokeObjectURL(url);
            logger.infoDebug("Object URL revoked");
        } catch (e) {
            logger.infoWarn("Failed to revoke object URL:", e);
        }
    }
    // Data URLs don't need to be revoked
}

/**
 * Attempts to erase download history entries matching a given filename regex.
 * This functionality is primarily for Chrome. Other browsers might not support this via the extension API.
 * @param filenameRegex The regex pattern to match against download filenames.
 */
export function eraseDownloadHistoryEntry(filenameRegex: string): void {
    // Check if chrome.downloads.erase is available (Chrome MV3+ and potentially V2)
    if (typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.erase) {
        const query: chrome.downloads.DownloadQuery = {
            filenameRegex: filenameRegex,
            state: "complete" // Only target completed downloads
        };

        chrome.downloads.erase(query, (erasedIds) => {
            if (erasedIds && erasedIds.length > 0) {
                logger.infoInfo(`Force redownload: Removed ${erasedIds.length} matching entries from browser download history.`);
            } else {
                logger.infoDebug("Force redownload: No matching entries found in browser download history to erase.");
            }
        });
    } else {
        logger.infoDebug("Skipping browser download history erase: chrome.downloads.erase is not available.");
    }
}

/**
 * Determines if a given URL represents a SoundCloud set/playlist, potentially
 * including browser-specific logic.
 * @param url The URL of the SoundCloud page/resource.
 * @param initialIsSet The initial determination of whether the URL is a set.
 * @returns True if the URL is determined to be a set/playlist.
 */
export function determineIfUrlIsSet(url: string, initialIsSet: boolean): boolean {
    let finalIsSet = initialIsSet;

    // Firefox specific check found in content.ts (circa line 650)
    // In some cases, the initial detection might miss sets in Firefox.
    if (!finalIsSet && typeof browser !== "undefined" && url) {
        if (url.includes("/sets/") || url.includes("/albums/")) {
            logger.infoDebug(`[BrowserUtils] Firefox detected, forcing isSet=true for URL: ${url}`);
            finalIsSet = true;
        }
    }

    return finalIsSet;
} 