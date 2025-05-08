// Popup script for the download queue
import { sendMessageToBackend, onMessage } from "../compatibility/compatibilityStubs";
import { QueueItem } from "../background/background"; // Assuming QueueItem is exported from background

const logger = console; // Simple logger for popup

const queueContainer = document.getElementById("queue-container");

function renderQueue(queue: QueueItem[]) {
    if (!queueContainer) return;

    if (queue.length === 0) {
        queueContainer.innerHTML = "<p>The download queue is currently empty.</p>";
        return;
    }

    // Basic rendering for now
    let html = "<ul>";
    queue.forEach(item => {
        html += `<li>
            <strong>ID:</strong> ${item.id}<br>
            <strong>Type:</strong> ${item.type}<br>
            <strong>URL:</strong> ${item.url?.substring(0, 50)}...<br>
            <strong>Status:</strong> ${item.status}<br>
            ${item.progress !== undefined ? `<strong>Progress:</strong> ${item.progress.toFixed(1)}%<br>` : ""}
            ${item.error ? `<strong>Error:</strong> ${item.error}<br>` : ""}
            <strong>Added:</strong> ${new Date(item.addedAt).toLocaleTimeString()}
        </li>`;
    });
    html += "</ul>";
    queueContainer.innerHTML = html;
}

async function fetchAndRenderQueue() {
    logger.log("[Popup] Requesting queue data from background...");
    try {
        const currentQueue = await sendMessageToBackend({ type: "GET_QUEUE_DATA" });
        logger.log("[Popup] Received raw data from sendMessageToBackend:", JSON.stringify(currentQueue, null, 2));

        if (Array.isArray(currentQueue)) {
            logger.log("[Popup] Received queue data (is array):", currentQueue);
            renderQueue(currentQueue as QueueItem[]);
        } else {
            logger.error("[Popup] Received invalid queue data (not array) from background:", currentQueue);
            if (queueContainer) queueContainer.innerHTML = "<p>Error: Could not load queue data (format error).</p>";
        }
    } catch (error) {
        logger.error("[Popup] Error requesting queue data:", error);
        if (queueContainer) queueContainer.innerHTML = "<p>Error: Failed to connect to background script.</p>";
    }
}

// Listen for updates from the background (e.g., when queue changes)
// This is a simple listener; a more robust solution might involve specific update messages.
onMessage(async (message: any, sender: any) => {
    // We expect the background to send the entire queue on updates for now.
    // Or, it could send a specific message like { type: "QUEUE_UPDATED", newQueue: [...] }
    if (message && message.type === "QUEUE_UPDATED_BROADCAST" && Array.isArray(message.queuePayload)) {
        logger.log("[Popup] Received QUEUE_UPDATED_BROADCAST from background:", message.queuePayload);
        renderQueue(message.queuePayload as QueueItem[]);
    } else if (message && Array.isArray(message)) {
        // Fallback if background just sends the array directly (less explicit)
        logger.log("[Popup] Received a direct array message (assumed queue update):", message);
        renderQueue(message as QueueItem[]);
    }
    // Return true if you want to send an async response (not needed for simple broadcast handling)
    return false;
});

// Initial fetch when popup opens
document.addEventListener("DOMContentLoaded", () => {
    logger.log("Queue popup DOM loaded. Fetching initial queue.");
    fetchAndRenderQueue();

    // --- Restore History Logic --- MODIFIED
    const openRestorePageButton = document.getElementById("open-restore-history-page-button") as HTMLButtonElement;

    if (openRestorePageButton) {
        openRestorePageButton.addEventListener("click", () => {
            logger.log("[Popup] Opening Restore History page...");
            try {
                // Assuming 'browser' is available (e.g. via webextension-polyfill)
                // or use 'chrome.tabs.create' directly if not using polyfill
                const tabsApi = typeof browser !== "undefined" ? browser.tabs : chrome.tabs;
                tabsApi.create({
                    url: chrome.runtime.getURL("src/pages/restore_history.html") // Adjust path if necessary based on your build output
                });
            } catch (error) {
                logger.error("[Popup] Error opening restore history page:", error);
                // Optionally, display an error message in the popup itself
                if (queueContainer) { // Re-using queueContainer for a quick error message spot
                    const errorDiv = document.createElement("p");
                    errorDiv.textContent = "Error: Could not open the restore history page. See console.";
                    errorDiv.style.color = "red";
                    queueContainer.appendChild(errorDiv);
                }
            }
        });
    } else {
        logger.warn("[Popup] 'Open Restore Page' button not found.");
    }
    // --- End Restore History Logic ---
});

logger.log("Queue popup script loaded."); 