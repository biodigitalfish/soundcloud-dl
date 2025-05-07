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
        logger.logWarn("Failed to detect manifest version:", e);
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
 * Creates a URL from a Blob with fallbacks for service workers
 * @param blob The blob to create a URL for
 * @returns A URL string (object URL or data URL)
 */
export async function createURLFromBlob(blob: Blob): Promise<string> {
    // First try with URL.createObjectURL which is more efficient
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        try {
            logger.logDebug("Using URL.createObjectURL");
            return URL.createObjectURL(blob);
        } catch (e) {
            logger.logWarn("URL.createObjectURL failed:", e);
            // Fall through to FileReader fallback
        }
    }

    // Fallback to data URL
    logger.logInfo("Falling back to FileReader.readAsDataURL");
    try {
        const reader = new FileReader();
        return await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (e) => reject(new Error(`FileReader failed: ${e}`));
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        logger.logError("Both URL creation methods failed:", e);
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
            logger.logDebug("Object URL revoked");
        } catch (e) {
            logger.logWarn("Failed to revoke object URL:", e);
        }
    }
    // Data URLs don't need to be revoked
} 