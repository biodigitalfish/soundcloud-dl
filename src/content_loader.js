// content_loader.js
function getExtensionURL(relativePath) {
    if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL) {
        return browser.runtime.getURL(relativePath);
    } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(relativePath);
    }
    console.error("SOUNDCLOUD-DL: Cannot get extension URL for path:", relativePath);
    return null;
}

(async () => {
    const modulePath = "js/content.js"; // This is the path to your main content script module
    const src = getExtensionURL(modulePath);

    if (src) {
        try {
            // Dynamically import the module. The browser handles this as a module script.
            await import(src);
            console.log("SOUNDCLOUD-DL: content.js module initiated via content_loader.js");
        } catch (e) {
            console.error("SOUNDCLOUD-DL: Error dynamically importing content.js module at", src, e);
        }
    } else {
        console.error("SOUNDCLOUD-DL: Could not resolve extension URL for content.js module.");
    }
})(); 