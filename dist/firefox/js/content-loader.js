// This script is a loader for the main content.js script.
// It is injected directly into the page context to bypass Chrome's content script isolation
// and allow content.js to access the page's JavaScript environment if needed.

// Removed Logger import and usage as this script runs directly in page context
// and cannot resolve module imports relative to the extension.


(function () {
    // Use the appropriate runtime API to get the URL
    var runtimeAPI = typeof browser !== "undefined" && browser.runtime ? browser.runtime : chrome.runtime;
    var contentScriptUrl = runtimeAPI.getURL("js/content.js");

    // Create a script element
    var script = document.createElement("script");
    script.setAttribute("type", "module");
    script.setAttribute("src", contentScriptUrl);

    // Append the script element to the document body (or head)
    // Using document.body is generally safer to ensure the body exists.
    if (document.body) {
        document.body.appendChild(script);
    } else {
        // Fallback to head if body is not yet available (less common for document_idle)
        document.head.appendChild(script);
    }
})(); 