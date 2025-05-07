const SCRIPT_ID = "soundcloud-dl-bridge";
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.source !== SCRIPT_ID || event.data.direction !== "to-background-via-bridge") {
    return;
  }
  const message = event.data.payload;
  const originalMessageId = event.data.messageId;
  if (message && message.type && originalMessageId) {
    console.log(`[Bridge] Received from page for background (ID: ${originalMessageId}):`, message);
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Bridge] Error sending message to background or receiving response:", chrome.runtime.lastError);
        window.postMessage({
          source: SCRIPT_ID,
          direction: "from-background-via-bridge",
          payload: { error: chrome.runtime.lastError.message, originalMessage: message },
          messageId: originalMessageId
          // Include messageId in error response
        }, "*");
      } else {
        console.log(`[Bridge] Received response from background for ID ${originalMessageId}, sending to page:`, response);
        window.postMessage({
          source: SCRIPT_ID,
          direction: "from-background-via-bridge",
          payload: response,
          messageId: originalMessageId
          // Include the messageId in the success response
        }, "*");
      }
    });
  } else {
    console.warn("[Bridge] Received message from page is invalid or missing messageId:", event.data);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && !sender.tab) {
    console.log("[Bridge] Received broadcast from background, sending to page:", message);
    window.postMessage({
      source: SCRIPT_ID,
      direction: "from-background-via-bridge",
      payload: message
      // No messageId needed here as it wasn't a request-response
    }, "*");
  }
  return false;
});
console.log("[SoundCloud DL] Bridge content script loaded and listening.");
