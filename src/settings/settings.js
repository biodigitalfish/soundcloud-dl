// Add event handler for the clear download history button
import { Logger } from "../utils/logger";
const logger = Logger.create("Settings");

document.getElementById("clear-download-history").addEventListener("click", function () {
  browser.storage.sync.set({ "track-download-history": {} }).then(() => {
    alert("Download history cleared successfully!");
  }).catch((error) => {
    logger.logError("Failed to clear download history:", error);
    alert("Failed to clear download history: " + error.message);
  });
}); 