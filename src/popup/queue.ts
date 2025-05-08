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

    // --- Restore History Logic ---
    const directoryUploadInput = document.getElementById("directory-upload") as HTMLInputElement;
    const processDirectoryButton = document.getElementById("process-directory-button") as HTMLButtonElement;
    const restoreStatusDiv = document.getElementById("restore-status");

    let selectedFiles: FileList | null = null;

    if (directoryUploadInput) {
        directoryUploadInput.addEventListener("change", (event) => {
            selectedFiles = (event.target as HTMLInputElement).files;
            if (selectedFiles && selectedFiles.length > 0) {
                logger.log(`[Popup] Selected ${selectedFiles.length} files/directories for history restore.`);
                if (restoreStatusDiv) restoreStatusDiv.textContent = `${selectedFiles.length} items selected. Click "Process Directory".`;
            } else {
                if (restoreStatusDiv) restoreStatusDiv.textContent = "No directory selected.";
            }
        });
    }

    if (processDirectoryButton) {
        processDirectoryButton.addEventListener("click", async () => {
            if (!selectedFiles || selectedFiles.length === 0) {
                logger.warn("[Popup] No files selected to process.");
                if (restoreStatusDiv) restoreStatusDiv.textContent = "Please select a directory first.";
                return;
            }

            if (restoreStatusDiv) restoreStatusDiv.textContent = "Processing directory...";
            logger.log("[Popup] Processing directory for history restore. Files:", selectedFiles);

            const fileDetails = Array.from(selectedFiles).map(file => ({
                name: file.name,
                path: (file as any).webkitRelativePath || file.name, // webkitRelativePath for directory structure
                size: file.size,
                type: file.type
            }));

            logger.log("[Popup] Extracted file details:", fileDetails);

            // TODO: Implement actual parsing and sending message to background script
            // For now, we'll just log what we have.
            try {
                // Example: Send to background (you'll need to define this message type and handler in background.ts)
                /*
                const response = await sendMessageToBackend({
                    type: "PROCESS_UPLOADED_DIRECTORY",
                    files: fileDetails
                });
                logger.log("[Popup] Response from background after processing directory:", response);
                if (restoreStatusDiv) restoreStatusDiv.textContent = "Directory processing initiated. Check background logs.";
                */
                if (restoreStatusDiv) restoreStatusDiv.textContent = `Processing ${fileDetails.length} files. See console for details. (Actual processing TBD)`;
                logger.log("[Popup] Placeholder: Would send file details to background for processing.");

            } catch (error) {
                logger.error("[Popup] Error sending directory data to background:", error);
                if (restoreStatusDiv) restoreStatusDiv.textContent = "Error initiating processing. See console.";
            }
        });
    }
    // --- End Restore History Logic ---
});

logger.log("Queue popup script loaded."); 