// This script dynamically imports the main content script module.
(async () => {
    try {
        // Construct the URL to the main content script module
        const modulePath = "/js/content.js";
        // Use chrome.runtime.getURL to get the correct extension URL
        const moduleURL = chrome.runtime.getURL ? chrome.runtime.getURL(modulePath) : browser.runtime.getURL(modulePath);

        console.log("[SOUNDCLOUD-DL Loader] Importing module:", moduleURL);
        await import(moduleURL);
        console.log("[SOUNDCLOUD-DL Loader] Module imported successfully.");
    } catch (error) {
        console.error("[SOUNDCLOUD-DL Loader] Error importing content script module:", error);
    }
})(); 