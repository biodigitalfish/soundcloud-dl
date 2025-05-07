import { L as Logger, f as storeConfigValue, m as loadConfiguration, v as configKeys, d as getConfigValue, w as resetConfig } from "./config-BfcQhoHG.js";
const logger = Logger.create("Settings");
async function resetSettings(e) {
  e.preventDefault();
  logger.logInfo("Resetting settings...");
  await resetConfig();
  await restoreSettings();
}
async function saveSettings(e) {
  e.preventDefault();
  logger.logInfo("Saving settings...");
  const savePromises = [];
  for (const configKey of configKeys) {
    const elem = document.querySelector(`#${configKey}`);
    if (elem === null) continue;
    let value;
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
  const saveButton = document.querySelector("button[type='submit']");
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
      const elem = document.querySelector(`#${configKey}`);
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
const downloadWithoutPromptElem = document.querySelector("#download-without-prompt");
const defaultDownloadLocationElem = document.querySelector("#default-download-location");
downloadWithoutPromptElem.onchange = (event) => {
  defaultDownloadLocationElem.disabled = !event.target.checked;
};
const blockReposts = document.querySelector("#block-reposts");
const blockPlaylists = document.querySelector("#block-playlists");
blockReposts.onchange = (event) => {
  if (!event.target.checked) blockPlaylists.checked = false;
};
const enableHlsRateLimitingElem = document.querySelector("#enable-hls-rate-limiting");
const hlsRateLimitDelayMsElem = document.querySelector("#hls-rate-limit-delay-ms");
enableHlsRateLimitingElem.onchange = (event) => {
  hlsRateLimitDelayMsElem.disabled = !event.target.checked;
};
const clearHistoryButton = document.querySelector("#clear-download-history");
async function clearDownloadHistory() {
  logger.logInfo("Clearing download history...");
  try {
    await storeConfigValue("track-download-history", {});
    logger.logInfo("Attempting to clear browser download history for SoundCloud files...");
    if (typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.erase) {
      try {
        const soundcloudRegexPattern = "SoundCloud.*\\.(mp3|m4a|wav)$";
        chrome.downloads.erase({ filenameRegex: soundcloudRegexPattern, state: "complete" }, (erasedIds) => {
          if (erasedIds && erasedIds.length > 0) {
            logger.logInfo(`Cleared ${erasedIds.length} SoundCloud downloads from browser history.`);
          } else {
            logger.logInfo("No SoundCloud downloads found in browser history.");
            const audioRegexPattern = "\\.(mp3|m4a|wav)$";
            chrome.downloads.erase({ filenameRegex: audioRegexPattern, state: "complete" }, (audioErased) => {
              if (audioErased && audioErased.length > 0) {
                logger.logInfo(`Cleared ${audioErased.length} audio files from browser history.`);
              } else {
                logger.logInfo("No audio downloads found in browser history.");
              }
            });
          }
        });
      } catch (eraseError) {
        logger.logWarn("Failed to clear browser download history:", eraseError);
      }
    } else {
      logger.logInfo("Browser does not support downloading history clearing API.");
    }
    const originalText = clearHistoryButton.textContent;
    clearHistoryButton.textContent = "History Cleared!";
    clearHistoryButton.disabled = true;
    setTimeout(() => {
      clearHistoryButton.textContent = originalText;
      clearHistoryButton.disabled = false;
    }, 2e3);
  } catch (error) {
    logger.logError("Failed to clear download history", error);
    clearHistoryButton.textContent = "Error! See Console";
    clearHistoryButton.style.backgroundColor = "#d30029";
    setTimeout(() => {
      clearHistoryButton.textContent = "Clear Download History";
      clearHistoryButton.style.backgroundColor = "";
      clearHistoryButton.disabled = false;
    }, 3e3);
  }
}
clearHistoryButton.addEventListener("click", clearDownloadHistory);
document.addEventListener("DOMContentLoaded", restoreSettings);
document.querySelector("form").addEventListener("submit", saveSettings);
document.querySelector("form").addEventListener("reset", resetSettings);
