/**
 * This script acts as a bridge between the main page world (where content.js runs after injection)
 * and the extension's background script. It runs in the isolated content script world
 * and has access to chrome.runtime APIs.
 */

const SCRIPT_ID = "soundcloud-dl-bridge"; // For identifying messages

// Listen for messages from the page (content.js)
window.addEventListener("message", (event) => {
    // We only accept messages from ourselves
    if (event.source !== window || !event.data || event.data.source !== SCRIPT_ID || event.data.direction !== "to-background-via-bridge") {
        return;
    }

    const message = event.data.payload;
    const originalMessageId = event.data.messageId; // Capture the messageId

    if (message && message.type && originalMessageId) { // Basic validation + check for messageId
        chrome.runtime.sendMessage(message, (response) => {
            // Send response from background back to the page, including the original messageId
            if (chrome.runtime.lastError) {
                console.error("[Bridge] Error sending message to background or receiving response:", chrome.runtime.lastError);
                window.postMessage({
                    source: SCRIPT_ID,
                    direction: "from-background-via-bridge",
                    payload: { error: chrome.runtime.lastError.message, originalMessage: message },
                    messageId: originalMessageId // Include messageId in error response
                }, "*");
            } else {
                // console.debug(`[Bridge] Received response from background for ID ${originalMessageId}, sending to page:`, response);
                window.postMessage({
                    source: SCRIPT_ID,
                    direction: "from-background-via-bridge",
                    payload: response,
                    messageId: originalMessageId // Include the messageId in the success response
                }, "*");
            }
        });
    } else {
        console.warn("[Bridge] Received message from page is invalid or missing messageId:", event.data);
    }
});

// Listen for messages from the background script (broadcasts/pushes)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure it's from our extension's background
    if (sender.id === chrome.runtime.id && (!sender.tab)) { // sender.tab check ensures it's from background/popup
        // console.debug("[Bridge] Received broadcast from background, sending to page:", message);
        // Broadcast messages don't have a specific messageId to correlate
        window.postMessage({
            source: SCRIPT_ID,
            direction: "from-background-via-bridge",
            payload: message,
            // No messageId needed here as it wasn't a request-response
        }, "*");
    }
    return false; // Indicate we are not sending an async response from this specific listener.
});

console.debug("[SoundCloud DL] Bridge content script loaded and listening."); 