import { configKeys, loadConfiguration, storeConfigValue, getConfigValue, resetConfig } from "./config";
import { Logger } from "../utils/logger";
import { eraseDownloadHistoryEntry } from "../utils/browser";

const logger = Logger.create("Settings");

async function resetSettings(e: Event) {
  e.preventDefault();

  logger.logInfo("Resetting settings...");

  await resetConfig();

  await restoreSettings();
}

async function saveSettings(e: Event) {
  e.preventDefault();

  logger.logInfo("Saving settings...");

  const savePromises = [];
  for (const configKey of configKeys) {
    const elem = document.querySelector<HTMLInputElement>(`#${configKey}`);

    if (elem === null) continue;

    let value: string | number | boolean;

    if (elem.type === "checkbox") {
      value = elem.checked;
    } else if (elem.type === "number") {
      value = elem.valueAsNumber;
      if (isNaN(value)) {
        logger.logWarn(`Invalid number input for ${configKey}, skipping save.`);
        continue;
      }
    } else {
      value = elem.value;
    }

    savePromises.push(storeConfigValue(configKey, value));
  }

  await Promise.all(savePromises);

  const saveButton = document.querySelector<HTMLButtonElement>("button[type='submit']");
  if (saveButton) {
    const originalText = saveButton.textContent;
    saveButton.textContent = "Saved!";
    saveButton.disabled = true;
    setTimeout(() => {
      saveButton.textContent = originalText;
      saveButton.disabled = false;
    }, 1500);
  }
}

async function restoreSettings() {
  logger.logInfo("Restoring settings...");

  try {
    await loadConfiguration();
    logger.logInfo("Configuration loaded.");

    for (const configKey of configKeys) {
      const elem = document.querySelector<HTMLInputElement>(`#${configKey}`);

      if (elem === null) continue;

      const value = getConfigValue(configKey);
      logger.logInfo(`Restoring key: ${configKey}, Value: ${JSON.stringify(value)} (Type: ${typeof value})`);

      if (typeof value === "boolean") {
        elem.checked = value;
      } else if (typeof value === "number") {
        elem.value = String(value);
      } else if (typeof value === "string") {
        elem.value = value;
      } else {
        logger.logWarn(`Unexpected type for config key ${configKey}: ${typeof value}`);
        if (elem.type === "checkbox") elem.checked = false;
        else elem.value = "";
      }

      const changeEvent = new Event("change", { bubbles: false, cancelable: true });
      elem.dispatchEvent(changeEvent);
    }
  } catch (error) {
    logger.logError("Failed to restore settings!", error);
  }
}

const downloadWithoutPromptElem = document.querySelector<HTMLInputElement>("#download-without-prompt");
const defaultDownloadLocationElem = document.querySelector<HTMLInputElement>("#default-download-location");

downloadWithoutPromptElem.onchange = (event: any) => {
  defaultDownloadLocationElem.disabled = !event.target.checked;
};

const blockReposts = document.querySelector<HTMLInputElement>("#block-reposts");
const blockPlaylists = document.querySelector<HTMLInputElement>("#block-playlists");

blockReposts.onchange = (event: any) => {
  if (!event.target.checked) blockPlaylists.checked = false;
};

// --- HLS Rate Limiting UI Logic Start ---
const enableHlsRateLimitingElem = document.querySelector<HTMLInputElement>("#enable-hls-rate-limiting");
const hlsRateLimitDelayMsElem = document.querySelector<HTMLInputElement>("#hls-rate-limit-delay-ms");

enableHlsRateLimitingElem.onchange = (event: any) => {
  hlsRateLimitDelayMsElem.disabled = !event.target.checked;
};
// --- HLS Rate Limiting UI Logic End ---

// --- Clear Download History Logic Start ---
const clearHistoryButton = document.querySelector<HTMLButtonElement>("#clear-download-history");

async function clearDownloadHistory() {
  logger.logInfo("Clearing download history...");

  try {
    // First, clear our internal history database
    await storeConfigValue("track-download-history", {});

    // Now try to clear entries from Chrome's download history database
    logger.logInfo("Attempting to clear browser download history for SoundCloud files...");
    // Option 1: Try to clear all .mp3/.m4a files from SoundCloud 
    const soundcloudRegexPattern = "SoundCloud.*\\.(mp3|m4a|wav)$";
    eraseDownloadHistoryEntry(soundcloudRegexPattern);

    // Option 2: Try a broader search for any audio files (fallback)
    const audioRegexPattern = "\\.(mp3|m4a|wav)$";
    eraseDownloadHistoryEntry(audioRegexPattern);

    const originalText = clearHistoryButton.textContent;
    clearHistoryButton.textContent = "History Cleared!";
    clearHistoryButton.disabled = true;
    setTimeout(() => {
      clearHistoryButton.textContent = originalText;
      clearHistoryButton.disabled = false;
    }, 2000); // Keep disabled for 2 seconds
  } catch (error) {
    logger.logError("Failed to clear download history", error);
    clearHistoryButton.textContent = "Error! See Console";
    clearHistoryButton.style.backgroundColor = "#d30029";
    setTimeout(() => {
      clearHistoryButton.textContent = "Clear Download History";
      clearHistoryButton.style.backgroundColor = "";
      clearHistoryButton.disabled = false;
    }, 3000);
  }
}

clearHistoryButton.addEventListener("click", clearDownloadHistory);
// --- Clear Download History Logic End ---

document.addEventListener("DOMContentLoaded", restoreSettings);
document.querySelector("form").addEventListener("submit", saveSettings);
document.querySelector("form").addEventListener("reset", resetSettings);
