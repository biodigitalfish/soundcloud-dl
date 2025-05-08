import { sendMessageToBackend } from "../compatibility/compatibilityStubs";

// Simple logger for this page
const logger = console;

logger.log("Restore History page script loaded.");

document.addEventListener("DOMContentLoaded", () => {
    logger.log("Restore History DOM loaded.");

    const directoryUploadInput = document.getElementById("directory-upload") as HTMLInputElement;
    const restoreStatusDiv = document.getElementById("restore-status");

    if (!directoryUploadInput || !restoreStatusDiv) {
        logger.error("Required UI elements (directory-upload or restore-status) not found!");
        if (restoreStatusDiv) restoreStatusDiv.textContent = "Error: Page UI elements missing.";
        return;
    }

    directoryUploadInput.addEventListener("change", async (event) => {
        const selectedFiles = (event.target as HTMLInputElement).files;

        if (selectedFiles && selectedFiles.length > 0) {
            logger.log(`[RestorePage] Selected ${selectedFiles.length} files/directories. Processing immediately.`);
            restoreStatusDiv.textContent = `Selected ${selectedFiles.length} items. Starting processing...`;

            const trackIdsFromFiles: string[] = [];
            let filesProcessed = 0;
            let m4aFilesFound = 0;

            for (const file of Array.from(selectedFiles)) {
                if (file.name.toLowerCase().endsWith(".m4a")) {
                    m4aFilesFound++;
                    restoreStatusDiv.textContent = `Processing file ${file.name}... (${filesProcessed + 1}/${selectedFiles.length})`;
                    logger.log(`[RestorePage] Reading M4A file: ${file.name}`);
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        logger.log(`[RestorePage] Sending ${file.name} (size: ${arrayBuffer.byteLength}) to background for SCID extraction.`);

                        const response = await sendMessageToBackend({
                            type: "EXTRACT_SCID_FROM_M4A",
                            payload: {
                                filename: file.name,
                                buffer: arrayBuffer
                            }
                        });

                        if (response && response.trackId) {
                            logger.log(`[RestorePage] Received SCID ${response.trackId} for ${file.name}`);
                            trackIdsFromFiles.push(response.trackId);
                            restoreStatusDiv.textContent = `Found SCID ${response.trackId} in ${file.name}.`;
                        } else if (response && response.error) {
                            logger.warn(`[RestorePage] Error extracting SCID from ${file.name}: ${response.error}`);
                            restoreStatusDiv.textContent = `Error for ${file.name}: ${response.error}.`;
                        } else {
                            logger.warn(`[RestorePage] No SCID found or unknown error for ${file.name}`);
                            restoreStatusDiv.textContent = `No SCID found in ${file.name}.`;
                        }
                    } catch (error) {
                        logger.error(`[RestorePage] Error processing file ${file.name}:`, error);
                        restoreStatusDiv.textContent = `Error reading ${file.name}. See console.`;
                    }
                }
                filesProcessed++;
            }

            logger.log("[RestorePage] Finished processing local files. M4A files found:", m4aFilesFound, "Extracted SCIDs:", trackIdsFromFiles);
            restoreStatusDiv.textContent = `Processed ${filesProcessed} items. Found ${m4aFilesFound} M4A files. Extracted ${trackIdsFromFiles.length} track IDs.`;

            if (trackIdsFromFiles.length > 0) {
                restoreStatusDiv.textContent += " Sending to background to restore history...";
                try {
                    const restoreResponse = await sendMessageToBackend({
                        type: "RESTORE_HISTORY_FROM_IDS",
                        payload: {
                            trackIds: trackIdsFromFiles
                        }
                    });
                    logger.log("[RestorePage] Response from background after sending track IDs for history restore:", restoreResponse);
                    restoreStatusDiv.textContent = restoreResponse?.message || "History restoration request sent. Check main extension for updates.";
                } catch (error) {
                    logger.error("[RestorePage] Error sending track IDs for history restore:", error);
                    restoreStatusDiv.textContent = "Error sending IDs for history restore. See console.";
                }
            } else if (m4aFilesFound > 0) {
                restoreStatusDiv.textContent = "Processed M4A files, but no track IDs were extracted. Ensure files have SCID metadata.";
            } else {
                restoreStatusDiv.textContent = "No M4A files found in the selection. Please select a directory containing .m4a SoundCloud downloads.";
            }
        } else {
            restoreStatusDiv.textContent = "No directory selected or directory is empty. Please select a directory.";
        }
    });
}); 