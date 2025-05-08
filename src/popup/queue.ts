// Popup script for the download queue
import { sendMessageToBackend, onMessage } from "../compatibility/compatibilityStubs";
import { QueueItem } from "../background/background"; // Assuming QueueItem is exported from background

const logger = console; // Simple logger for popup

const queueContainer = document.getElementById("queue-container");
let queueUpdateIntervalId: number | null = null; // Variable to hold the interval ID

// Placeholder image for missing artwork
const PLACEHOLDER_ARTWORK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e0e0e0'/%3E%3Ctext x='50' y='55' font-size='20' text-anchor='middle' fill='%23aaa'%3E?%3C/text%3E%3C/svg%3E";

function renderQueue(queue: QueueItem[]) {
    if (!queueContainer) return;

    if (queue.length === 0) {
        queueContainer.innerHTML = "<p>The download queue is currently empty.</p>";
        return;
    }

    let html = ""; // Build HTML string
    queue.forEach(item => {
        const artworkSrc = item.artworkUrl || PLACEHOLDER_ARTWORK;
        const title = item.title || item.url?.split("/").pop() || "Untitled Track";
        const progressValue = item.progress !== undefined && item.progress >= 0 && item.progress <= 100 ? item.progress : 0;
        const isProcessingOrPending = item.status === "processing" || item.status === "pending";
        const displayProgress = item.progress !== undefined && item.progress < 101; // Only show progress if it's not at a final state like 101/102

        html += `
            <div class="queue-item">
                <img src="${artworkSrc}" alt="Artwork" class="queue-item-artwork" />
                <div class="queue-item-details">
                    <div class="queue-item-title" title="${title}">${title}</div>
                    <div class="queue-item-url" title="${item.url}">Type: ${item.type}</div>
                    <div class="queue-item-status">Status: <strong>${item.status}</strong></div>
                    ${displayProgress ? `
                        <div class="queue-item-progress-container">
                            <span>Progress: ${item.progress?.toFixed(1)}%</span>
                            <progress value="${progressValue}" max="100"></progress>
                        </div>
                    ` : ""}
                    ${item.error ? `<div class="queue-item-error">Error: ${item.error}</div>` : ""}
                    <div style="font-size: 0.8em; color: #888; margin-top: 5px;">Added: ${new Date(item.addedAt).toLocaleTimeString()} (ID: ${item.id.substring(0, 8)})</div>
                </div>
            </div>
        `;
    });
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
    logger.log("Queue popup DOM loaded. Fetching initial queue and starting interval.");
    fetchAndRenderQueue(); // Initial fetch

    // Start interval to update queue every second
    if (queueUpdateIntervalId !== null) {
        clearInterval(queueUpdateIntervalId); // Clear any existing interval (defensive)
    }
    queueUpdateIntervalId = window.setInterval(fetchAndRenderQueue, 1000); // Update every 1 second

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

// Clear the interval when the popup is closed/unloaded
window.addEventListener("unload", () => {
    if (queueUpdateIntervalId !== null) {
        logger.log("Queue popup unloading. Clearing update interval.");
        clearInterval(queueUpdateIntervalId);
        queueUpdateIntervalId = null;
    }
});

logger.log("Queue popup script loaded."); 