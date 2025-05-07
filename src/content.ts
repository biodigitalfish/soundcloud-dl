import { DomObserver, ObserverEvent } from "./utils/domObserver";
import { Logger } from "./utils/logger";
import { sendMessageToBackend, onMessage, getPathFromExtensionFile } from "./compatibilityStubs";
import { registerConfigChangeHandler, loadConfiguration, setOnConfigValueChanged, configKeys } from "./utils/config";

// --- CSS for Range Modal ---
const modalCss = `
  #scdl-range-modal {
    display: none;
    position: fixed;
    z-index: 10000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
    background-color: rgba(0,0,0,0.6);
  }
  #scdl-range-modal-content {
    background-color: #fefefe;
    margin: 15% auto;
    padding: 20px;
    border: 1px solid #888;
    width: 80%;
    max-width: 350px;
    border-radius: 5px;
    color: #333; /* Ensure text is visible */
  }
  #scdl-range-modal label {
    display: block;
    margin-bottom: 5px;
  }
  #scdl-range-modal input[type="number"] {
    width: 60px;
    padding: 5px;
    margin-bottom: 15px;
    margin-right: 10px;
    border: 1px solid #ccc;
    border-radius: 3px;
  }
  #scdl-range-modal-actions button {
    padding: 8px 15px;
    margin-left: 10px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  #scdl-range-modal-download {
    background-color: #ff5419;
    color: white;
  }
  #scdl-range-modal-cancel {
    background-color: #ccc;
  }
  #scdl-range-modal-error {
    color: red;
    font-size: 0.9em;
    margin-top: 10px;
    display: none; /* Hidden by default */
  }
  .sc-button-download {
    transition: background-color 0.5s ease-out;
  }
`;
// -------------------------

// --- Modal HTML Structure ---
let modalElement: HTMLDivElement | null = null;
function createModal() {
  if (document.getElementById("scdl-range-modal")) return;

  const style = document.createElement("style");
  style.textContent = modalCss;
  document.head.appendChild(style);

  modalElement = document.createElement("div");
  modalElement.id = "scdl-range-modal";
  modalElement.innerHTML = `
    <div id="scdl-range-modal-content">
      <h4>Download Playlist Range</h4>
      <label for="scdl-range-from">From track:</label>
      <input type="number" id="scdl-range-from" name="from" min="1" value="1">
      <label for="scdl-range-to">To track:</label>
      <input type="number" id="scdl-range-to" name="to" min="1" value=""><br>
      <small>(Leave "To" blank to download until the end)</small>
      <div id="scdl-range-modal-error"></div>
      <div id="scdl-range-modal-actions" style="text-align: right; margin-top: 15px;">
        <button id="scdl-range-modal-cancel">Cancel</button>
        <button id="scdl-range-modal-download">Download Selection</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalElement);

  // Add listeners for the modal buttons
  document.getElementById("scdl-range-modal-cancel").addEventListener("click", hideModal);
  modalElement.addEventListener("click", (e) => {
    // Close if clicking outside the content
    if (e.target === modalElement) {
      hideModal();
    }
  });
}

function showModal(mainDownloadButton: HTMLButtonElement, onDownloadClick: (start: number, end: number | null) => void) {
  if (!modalElement) createModal();

  const fromInput = document.getElementById("scdl-range-from") as HTMLInputElement;
  const toInput = document.getElementById("scdl-range-to") as HTMLInputElement;
  const errorDiv = document.getElementById("scdl-range-modal-error");

  // Reset fields and error message
  fromInput.value = "1";
  toInput.value = "";
  errorDiv.textContent = "";
  errorDiv.style.display = "none";

  // Remove previous listener and add new one to avoid duplicates / stale closures
  const downloadBtn = document.getElementById("scdl-range-modal-download");
  const newDownloadBtn = downloadBtn.cloneNode(true) as HTMLButtonElement;
  downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);

  newDownloadBtn.addEventListener("click", () => {
    const start = parseInt(fromInput.value, 10);
    const endStr = toInput.value;
    const end = endStr ? parseInt(endStr, 10) : null; // null means download to end

    errorDiv.textContent = ""; // Clear previous error
    errorDiv.style.display = "none";

    if (isNaN(start) || start < 1) {
      errorDiv.textContent = "Invalid \"From\" number.";
      errorDiv.style.display = "block";
      return;
    }
    if (end !== null && (isNaN(end) || end < start)) {
      errorDiv.textContent = "Invalid \"To\" number. Must be greater than or equal to \"From\".";
      errorDiv.style.display = "block";
      return;
    }

    // Validation passed, call the provided handler
    onDownloadClick(start, end);
    hideModal();

    // Trigger the main button's preparing state visually
    setButtonText(mainDownloadButton, "Preparing...");
    mainDownloadButton.style.cursor = "default";
    mainDownloadButton.onclick = null;

  });

  modalElement.style.display = "block";
}

function hideModal() {
  if (modalElement) {
    modalElement.style.display = "none";
  }
}
// -----------------------------

interface DownloadButton {
  elem: HTMLButtonElement;
  onClick: any;
  state: "Idle" | "Preparing" | "Downloading" | "Pausing" | "Paused" | "Resuming" | "Finishing" | "Downloaded" | "Error";
  resetTimer?: number;
  originalUrl?: string; // Store the URL for resuming/pausing
  lastProgressTime?: number; // Add timestamp for progress tracking
  browserDownloadId?: number; // Store browser's numeric downloadId for matching
}

type KeyedButtons = { [key: string]: DownloadButton & { resetTimer?: number } };
type OnButtonClicked = (downloadId: string) => Promise<any>;

let observer: DomObserver | null = null;
const logger = Logger.create("SoundCloud-Downloader");

// --- Wrapper for sendMessageToBackend to log messages ---
const originalSendMessageToBackend = sendMessageToBackend;
const loggedSendMessageToBackend = (message: any, callContext?: string): Promise<any> => {
  // Use a deep clone for logging to avoid issues with complex objects or future modifications
  let messageToLog = {};
  try {
    messageToLog = JSON.parse(JSON.stringify(message));
  } catch (_e) {
    // Fallback if JSON.stringify fails (e.g., circular refs, though unlikely for these messages)
    messageToLog = { errorParsingMessage: true, originalType: message?.type };
  }
  logger.logDebug(`sendMessageToBackend CALLED [Context: ${callContext || "Unknown"}] Message:`, messageToLog);

  // CRITICAL: Validate downloadId for messages requiring it
  if (message && typeof message === "object") {
    // Messages with these types MUST have a valid downloadId
    const typesRequiringId = [
      "DOWNLOAD", "DOWNLOAD_SET", "DOWNLOAD_SET_RANGE",
      "PAUSE_DOWNLOAD", "RESUME_DOWNLOAD"
    ];

    if (typesRequiringId.includes(message.type) &&
      (!message.downloadId || message.downloadId === undefined || message.downloadId === "undefined")) {
      const error = new Error(`CRITICAL: Prevented sending message with type ${message.type} and missing downloadId!`);
      logger.logError(error.message, { message: messageToLog, callContext });

      // Return a rejected promise rather than allowing the invalid message to be sent
      return Promise.reject(error);
    }

    // For all messages, add timestamp to help with matching in content script if needed
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
  }

  // Safe to send the message
  return originalSendMessageToBackend(message);
};
// --- End Wrapper ---

const downloadButtons: KeyedButtons = {};

const setButtonText = (button: HTMLButtonElement, text: string, title?: string) => {
  button.innerText = text;

  button.title = title ?? text;
};

const resetButtonBackground = (button: HTMLButtonElement) => {
  // Ensure styles are fully reset, important if paused state had specific colors
  button.style.backgroundColor = "";
  button.style.background = "";
  button.style.color = ""; // Reset text color if changed
};

const handleMessageFromBackgroundScript = async (_, message: any) => {
  const { downloadId: receivedDownloadId, progress, error, status, completionWithoutId, completed, timestamp, browserDownloadId, originalDownloadId } = message;

  let finalDownloadId: string | undefined = originalDownloadId;

  logger.logInfo(
    `Message received: originalId=${originalDownloadId}, receivedId=${receivedDownloadId}, browserDlId=${browserDownloadId}, progress=${progress}, status=${status}, error=${error || "none"}`,
    { message }
  );

  // Attempt to find the finalDownloadId if it's missing from the message, using browserDownloadId
  if (!finalDownloadId && browserDownloadId) {
    const matchedDownloadIds = Object.keys(downloadButtons).filter(
      id => downloadButtons[id].browserDownloadId === browserDownloadId
    );

    if (matchedDownloadIds.length === 1) {
      finalDownloadId = matchedDownloadIds[0];
      logger.logInfo(`Matched message with browserDownloadId=${browserDownloadId} to our finalDownloadId=${finalDownloadId}`);

      if (progress === 101 || completed === true) {
        const buttonData = downloadButtons[finalDownloadId!];
        resetButtonBackground(buttonData.elem);
        buttonData.elem.style.backgroundColor = "#19a352";
        setButtonText(buttonData.elem, "Downloaded!");
        buttonData.elem.title = "Downloaded successfully (matched by browser downloadId)";
        buttonData.elem.onclick = null;
        buttonData.state = "Downloaded";
        buttonData.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
        logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from browserDownloadId match`);
        return true;
      }
    } else if (matchedDownloadIds.length > 1) {
      logger.logWarn(`Found multiple (${matchedDownloadIds.length}) buttons with browserDownloadId=${browserDownloadId}. Cannot reliably map message.`);
      // finalDownloadId remains undefined, will be caught by later checks
    }
  }

  // If, after the above, we still don't have our finalDownloadId for the message, try to match to active downloads.
  // This block handles cases where the ID was truly lost or it's a generic completion message.
  if (!finalDownloadId || finalDownloadId === "undefined_completion" || completionWithoutId) {
    const allPotentiallyActiveStates = ["Downloading", "Preparing", "Finishing", "Pausing", "Resuming"];
    const currentActiveDownloads = Object.keys(downloadButtons).filter(
      id => allPotentiallyActiveStates.includes(downloadButtons[id].state)
    );

    // Define what a "minimal" message looks like (few keys, no substantive data)
    // error is the destructured message.error. If message.error was undefined, error is undefined.
    const isMinimalMessage = progress === undefined && // destructured from message
      status === undefined && // destructured from message
      completed !== true && // destructured from message
      completionWithoutId !== true && // destructured from message
      error === undefined && // destructured from message
      typeof message === "object" &&
      Object.keys(message).length <= (originalDownloadId ? 5 : (message.type ? 2 : 1));
    // If no originalDownloadId: allow up to 2 keys if 'type' is present (type, timestamp), or 1 key (timestamp assumed)

    if (currentActiveDownloads.length === 0 && isMinimalMessage) {
      logger.logDebug(`Received minimal message (keys: ${Object.keys(message).join(", ") || "none"}) with no active downloads. Discarding.`, { message });
      return true; // Acknowledge and exit early
    }

    logger.logWarn(`Received message (keys: ${Object.keys(message).join(", ") || "none"}) without a usable finalDownloadId or it is a generic completion. Attempting to match with active downloads (found ${currentActiveDownloads.length} using states: ${allPotentiallyActiveStates.join(", ")}).`);

    // Original isCompletionMessage heuristic (now named isCompletionMessageEvaluation)
    const isCompletionMessageEvaluation = progress === 101 || progress === 102 ||
      completed === true ||
      completionWithoutId === true ||
      (status === undefined &&
        error === undefined && // destructured from message
        typeof message === "object" &&
        Object.keys(message).length <= (originalDownloadId ? 5 : 4));

    if (isCompletionMessageEvaluation) {
      // Use currentActiveDownloads which uses a comprehensive list of states.
      const activeIdsForCompletionLogic = currentActiveDownloads;

      logger.logInfo(`Attempting to match as completion message. Found ${activeIdsForCompletionLogic.length} candidates using states: ${allPotentiallyActiveStates.join(", ")}.`);

      if (activeIdsForCompletionLogic.length === 1) {
        const matchedId = activeIdsForCompletionLogic[0];
        logger.logInfo(`Matched undefined/generic ID message to single active download: ${matchedId}`);
        finalDownloadId = matchedId;

        const isActuallyComplete = progress === 101 || progress === 102 || completed === true || completionWithoutId === true;
        if (isActuallyComplete) {
          const buttonData = downloadButtons[finalDownloadId!];
          resetButtonBackground(buttonData.elem);
          buttonData.elem.style.backgroundColor = "#19a352";
          setButtonText(buttonData.elem, "Downloaded!");
          buttonData.elem.title = "Downloaded successfully (auto-matched generic completion)";
          buttonData.elem.onclick = null;
          buttonData.state = "Downloaded";
          buttonData.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
          logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from matched generic completion message.`);
          return true;
        }

      } else if (activeIdsForCompletionLogic.length > 1 && timestamp) {
        let mostRecentId = null;
        let mostRecentTime = 0;
        activeIdsForCompletionLogic.forEach(id => {
          const lastTime = downloadButtons[id].lastProgressTime || 0;
          if (lastTime > mostRecentTime) {
            mostRecentTime = lastTime;
            mostRecentId = id;
          }
        });

        if (mostRecentId) {
          logger.logInfo(`Matched undefined/generic ID to most recent active download by timestamp: ${mostRecentId}`);
          finalDownloadId = mostRecentId;
          const isActuallyComplete = progress === 101 || progress === 102 || completed === true || completionWithoutId === true;
          if (isActuallyComplete) {
            const buttonData = downloadButtons[finalDownloadId!];
            resetButtonBackground(buttonData.elem);
            buttonData.elem.style.backgroundColor = "#19a352";
            setButtonText(buttonData.elem, "Downloaded!");
            buttonData.elem.title = "Downloaded successfully (auto-matched generic completion by timestamp)";
            buttonData.elem.onclick = null;
            buttonData.state = "Downloaded";
            buttonData.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
            logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from timestamp-matched generic completion message.`);
            return true;
          }
        } else {
          logger.logWarn(`Found ${activeIdsForCompletionLogic.length} active downloads, but couldn't match generic completion message by timestamp.`);
        }
      } else if (activeIdsForCompletionLogic.length > 0) { // If length > 1 and no timestamp, or other non-matching scenarios with active downloads
        logger.logWarn(`Found ${activeIdsForCompletionLogic.length} active downloads, can't match generic completion message reliably by unique or timestamp.`);
      } else { // activeIdsForCompletionLogic.length === 0
        logger.logInfo("No active downloads to match generic completion message to.");
      }
    }
    // If, after all the above, finalDownloadId is still not set
    if (!finalDownloadId) {
      // Check if it was the minimal message case that we would have debug-logged and returned for earlier
      if (currentActiveDownloads.length === 0 && isMinimalMessage) {
        // This condition implies the earlier 'return true' for minimal messages was somehow bypassed or conditions changed. Log as debug.
        logger.logDebug("Could not determine finalDownloadId for minimal message (no active downloads) after matching attempts. Discarding.", { message });
      } else {
        logger.logWarn("Could not determine finalDownloadId from undefined/generic ID message after all attempts. Discarding.", { message });
      }
      return true;
    }
  }

  // If after all attempts, finalDownloadId is STILL not set, we cannot proceed meaningfully.
  if (!finalDownloadId) {
    logger.logError("CRITICAL: finalDownloadId is null/undefined after all matching attempts. This should not happen. Discarding message.", { message });
    return true; // Or perhaps false, to indicate a problem.
  }

  const buttonData = downloadButtons[finalDownloadId!]; // Use non-null assertion as we should have a valid ID or returned early

  if (!buttonData) {
    logger.logWarn(`Button data not found for finalDownloadId: ${finalDownloadId}. Message:`, message);
    return true;
  }

  const { elem: downloadButton, resetTimer, state: currentState } = buttonData;

  if (browserDownloadId && !buttonData.browserDownloadId) {
    logger.logInfo(`Storing browserDownloadId=${browserDownloadId} for our finalDownloadId=${finalDownloadId}`);
    buttonData.browserDownloadId = browserDownloadId;
  }

  logger.logInfo(`Button state before update: ${currentState}, finalDownloadId=${finalDownloadId}`);

  // Handle initial command success acknowledgement from background script
  // This transitions from 'Preparing' to 'Downloading'
  if (message.success === true && message.originalDownloadId === finalDownloadId &&
    currentState === "Preparing" && // Ensure we are in Preparing state
    message.progress === undefined && message.status === undefined && message.completed === undefined && !message.error) {

    logger.logInfo(`Initial command success for ${finalDownloadId}. Transitioning to Downloading state.`);
    setButtonText(downloadButton, "Downloading... (Click to Pause)");
    downloadButton.style.background = "linear-gradient(90deg, #ff5419 0%, transparent 0%)"; // Initial progress 0%
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId!);
    downloadButtons[finalDownloadId!].state = "Downloading"; // Update state here
    downloadButtons[finalDownloadId!].lastProgressTime = Date.now(); // Mark time
    // Note: We don't return here. If this ack message ALSO contained completion/progress, it will be handled by below blocks.
  }

  if (progress !== undefined || status !== undefined) {
    downloadButtons[finalDownloadId!].lastProgressTime = Date.now();
  }

  if (resetTimer) {
    clearTimeout(resetTimer);
    downloadButtons[finalDownloadId!].resetTimer = undefined;
  }

  if (completed === true || message.finalBackup === true) {
    logger.logInfo(`Download complete (explicit completion flag) for finalDownloadId=${finalDownloadId}`);
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#19a352";
    setButtonText(downloadButton, "Downloaded!");
    downloadButton.title = "Downloaded successfully";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId!].state = "Downloaded";
    downloadButtons[finalDownloadId!].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
    logger.logInfo(`Button state updated to Downloaded due to explicit flag, finalDownloadId=${finalDownloadId}`);
    return true;
  } else if (progress === 101) {
    logger.logInfo(`Download complete (101) for finalDownloadId=${finalDownloadId}`);
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#19a352";
    setButtonText(downloadButton, "Downloaded!");
    downloadButton.title = "Downloaded successfully";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId!].state = "Downloaded";
    downloadButtons[finalDownloadId!].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
    logger.logInfo(`Button state updated to Downloaded, finalDownloadId=${finalDownloadId}`);
    return true;
  } else if (progress === 102) {
    logger.logInfo(`Download complete with errors (102) for finalDownloadId=${finalDownloadId}`);
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "gold";
    downloadButton.style.color = "#333";
    setButtonText(downloadButton, "Downloaded!");
    downloadButton.title = error || "Some tracks failed to download";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId!].state = "Downloaded";
    downloadButtons[finalDownloadId!].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
    logger.logInfo(`Button state updated to Downloaded (with errors), finalDownloadId=${finalDownloadId}`);
    return true;
  }

  if (status === "Paused") {
    resetButtonBackground(downloadButton);
    setButtonText(downloadButton, "Paused (Click to Resume)");
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId!);
    downloadButtons[finalDownloadId!].state = "Paused";
    logger.logInfo(`Button state updated to Paused, finalDownloadId=${finalDownloadId}`);
  } else if (status === "Resuming") {
    setButtonText(downloadButton, "Resuming...");
    downloadButton.style.cursor = "default";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId!].state = "Resuming";
    logger.logInfo(`Button state updated to Resuming, finalDownloadId=${finalDownloadId}`);
  } else if (progress === 100) {
    if (currentState !== "Paused" && currentState !== "Pausing" && currentState !== "Resuming") {
      setButtonText(downloadButton, "Finishing...");
      downloadButton.style.background = "linear-gradient(90deg, #ff5419 100%, transparent 0%)";
      downloadButton.onclick = null;
      downloadButtons[finalDownloadId!].state = "Finishing";
      logger.logInfo(`Button state updated to Finishing, finalDownloadId=${finalDownloadId}`);
    }
  } else if (progress !== undefined && progress >= 0 && progress < 100) {
    if (currentState === "Preparing" || (currentState !== "Paused" && currentState !== "Pausing")) {
      setButtonText(downloadButton, "Downloading... (Click to Pause)");
      downloadButton.style.background = `linear-gradient(90deg, #ff5419 ${progress}%, transparent 0%)`;
      downloadButton.style.cursor = "pointer";
      downloadButton.onclick = createPauseResumeHandler(finalDownloadId!);
      downloadButtons[finalDownloadId!].state = "Downloading";
      logger.logInfo(`Button state updated to Downloading (${progress}%), finalDownloadId=${finalDownloadId}`);
    }
  } else if (error) {
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#d30029";
    setButtonText(downloadButton, "ERROR", error);
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId!].state = "Error";
    logger.logInfo(`Button state updated to Error: ${error}, finalDownloadId=${finalDownloadId}`);
  } else if (currentState === "Preparing" && progress !== undefined) {
    // This case is a bit of a fallback if a download starts sending progress before a formal "Downloading" state was set
    setButtonText(downloadButton, "Downloading... (Click to Pause)");
    downloadButton.style.background = "linear-gradient(90deg, #ff5419 " + (progress || 0) + "%, transparent 0%)";
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId!);
    downloadButtons[finalDownloadId!].state = "Downloading";
    logger.logInfo(`Button state forcibly updated from Preparing to Downloading, finalDownloadId=${finalDownloadId}`);
  } else if (currentState === "Downloading" && !progress && !status && !error) {
    // Handle ambiguous messages when already in "Downloading" state
    logger.logInfo(`Received ambiguous message for download ${finalDownloadId} in Downloading state`);
    const messageStr = JSON.stringify(message).toLowerCase();
    if (messageStr.includes("finish") || messageStr.includes("complet")) {
      logger.logInfo(`Interpreting ambiguous message as completion for finalDownloadId=${finalDownloadId}`);
      resetButtonBackground(downloadButton);
      downloadButton.style.backgroundColor = "#19a352";
      setButtonText(downloadButton, "Downloaded!");
      downloadButton.title = "Downloaded successfully";
      downloadButton.onclick = null;
      downloadButtons[finalDownloadId!].state = "Downloaded";
      downloadButtons[finalDownloadId!].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId!), 10000);
    }
  }

  return true;
};

onMessage(handleMessageFromBackgroundScript);

const createDownloadButton = (small?: boolean) => {
  const button = document.createElement("button");
  const buttonSizeClass = small ? "sc-button-small" : "sc-button-medium";

  button.className = `sc-button-download sc-button ${buttonSizeClass} sc-button-responsive`;
  setButtonText(button, "Download");

  return button;
};

const createDownloadCommand = (url: string) => {
  // Determine if the URL is for a playlist/set based on URL pattern
  const isSetUrl = url.includes("/sets/") || url.includes("/albums/");

  // DEBUG: Add extensive logging for playlist detection
  logger.logDebug(`createDownloadCommand: URL=${url}, isSetUrl=${isSetUrl}`, { url, isSetUrl });

  const command = (downloadId: string) => {
    if (!downloadId) {
      logger.logError("Attempted to send DOWNLOAD command with undefined/empty downloadId", { url });
      return Promise.reject("Undefined/empty downloadId for DOWNLOAD command");
    }
    return loggedSendMessageToBackend({ // USE WRAPPER
      type: isSetUrl ? "DOWNLOAD_SET" : "DOWNLOAD",
      url,
      downloadId,
    }, "createDownloadCommand");
  };

  // Store the URL directly on the command function for use by the context menu
  (command as any).url = url;
  // Set the isSet flag to indicate if this is a set/playlist
  (command as any).isSet = isSetUrl;

  // DEBUG: Add verification log
  logger.logDebug(`createDownloadCommand: Created command with isSet=${(command as any).isSet}`, { commandUrl: (command as any).url, isSet: (command as any).isSet });

  return command;
};

const addDownloadButtonToParent = (parent: Node & ParentNode, onClicked: OnButtonClicked & { url?: string; isSet?: boolean }, small?: boolean) => {
  const downloadButtonExists = parent.querySelector("button.sc-button-download") !== null;

  if (downloadButtonExists) {
    logger.logDebug("Download button already exists");
    return;
  }

  // Log the parent and the clicked URL details
  logger.logDebug("Adding download button", {
    parentNode: parent.nodeName,
    url: (onClicked as any).url,
    isSet: (onClicked as any).isSet
  });

  const button = createDownloadButton(small);
  const downloadUrl = (onClicked as any).url; // Store URL early to ensure it's available

  // Debug URL to ensure it's correctly captured
  logger.logInfo(`Button created with URL: ${downloadUrl}`);

  const originalOnClick = async () => {
    const downloadId: string = crypto.randomUUID();

    // Store the button and URL information *immediately* when button is clicked
    downloadButtons[downloadId] = {
      elem: button,
      onClick: originalOnClick, // Store self for potential reset
      state: "Preparing",
      originalUrl: downloadUrl, // Store URL needed for pause/resume context
      lastProgressTime: Date.now() // Add timestamp for progress tracking
    };

    logger.logInfo(`Button clicked with downloadId: ${downloadId}, URL: ${downloadUrl}`);

    button.style.cursor = "default";
    button.onclick = null; // Disable direct click while preparing
    setButtonText(button, "Preparing...");
    resetButtonBackground(button); // Ensure clean background

    // Add a safety timeout to reset button if we don't get progress updates
    const safetyTimeout = setTimeout(() => {
      const currentButtonData = downloadButtons[downloadId];
      if (currentButtonData && currentButtonData.state === "Preparing") {
        logger.logWarn(`Safety timeout triggered for downloadId=${downloadId}, button still in Preparing state`);
        setButtonText(button, "Click to retry");
        button.style.cursor = "pointer";
        button.onclick = originalOnClick; // Re-enable click to let user retry
        // Keep in download buttons but mark as idle
        downloadButtons[downloadId].state = "Idle";
      }
    }, 10000); // 10 seconds safety timeout

    // Add a completion safety timeout to prevent downloads from being stuck in Downloading state
    // This needs to be much longer to account for large downloads
    const completionTimeout = setTimeout(() => {
      const currentButtonData = downloadButtons[downloadId];
      if (currentButtonData && currentButtonData.state === "Downloading") {
        const lastProgressTime = currentButtonData.lastProgressTime || 0;
        const timeSinceLastProgress = Date.now() - lastProgressTime;

        // If no progress updates for more than 2 minutes, consider it stuck
        if (timeSinceLastProgress > 120000) { // 2 minutes
          logger.logWarn(`Completion safety timeout triggered for downloadId=${downloadId}. Download seems stuck in Downloading state for ${timeSinceLastProgress / 1000}s`);

          // Check if the download might have completed silently
          if (timeSinceLastProgress > 180000) { // 3 minutes - assume potential completion
            logger.logInfo(`Assuming potential silent completion for downloadId=${downloadId}`);
            resetButtonBackground(button);
            button.style.backgroundColor = "#19a352";
            setButtonText(button, "Downloaded!");
            button.title = "Download likely completed (auto-detected)";
            button.onclick = null;
            downloadButtons[downloadId].state = "Downloaded";
            downloadButtons[downloadId].resetTimer = window.setTimeout(() => runResetLogic(downloadId), 10000);
          } else {
            // Just mark as potentially stuck but still downloading
            logger.logInfo(`Marking download ${downloadId} as potentially stuck`);
            setButtonText(button, "Downloading... (may be stuck)");
          }
        }
      }
    }, 300000); // 5 minutes timeout

    // Execute the original download command (passed in as onClicked)
    try {
      const response = await onClicked(downloadId);
      logger.logInfo(`Download command response for ${downloadId}:`, response);

      // Clear safety timeout since we got a response
      clearTimeout(safetyTimeout);

      // Check if button is still in preparing state and update if needed
      const currentButtonData = downloadButtons[downloadId];
      if (currentButtonData && currentButtonData.state === "Preparing") {
        logger.logInfo(`Manually transitioning button from Preparing to Downloading state for ${downloadId}`);
        setButtonText(button, "Downloading... (Click to Pause)");
        button.style.background = "linear-gradient(90deg, #ff5419 0%, transparent 0%)";
        button.style.cursor = "pointer";
        button.onclick = createPauseResumeHandler(downloadId);
        downloadButtons[downloadId].state = "Downloading";
        downloadButtons[downloadId].lastProgressTime = Date.now();
      }
    } catch (err) {
      // Clear safety timeout since we got an error response
      clearTimeout(safetyTimeout);
      clearTimeout(completionTimeout);

      logger.logError(`Initial download command failed for ${downloadUrl}`, err);
      // Handle immediate failure case
      if (downloadButtons[downloadId]) {
        downloadButtons[downloadId].state = "Error";
        setButtonText(button, "ERROR", err.message || "Failed to start");
        button.style.backgroundColor = "#d30029";
      }
    }
  };

  // Add context menu for force redownload
  button.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Remove any existing context menu
    const existingMenu = document.getElementById("scdl-context-menu");
    if (existingMenu) document.body.removeChild(existingMenu);

    // Create context menu
    const menu = document.createElement("div");
    menu.id = "scdl-context-menu";
    menu.style.position = "absolute";
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    menu.style.background = "#fff";
    menu.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
    menu.style.padding = "5px 0";
    menu.style.borderRadius = "3px";
    menu.style.zIndex = "10000";

    document.body.appendChild(menu);

    // Click elsewhere to dismiss
    const dismissHandler = () => {
      if (document.getElementById("scdl-context-menu")) {
        document.body.removeChild(menu);
      }
      document.removeEventListener("click", dismissHandler);
    };

    document.addEventListener("click", dismissHandler);

    return false; // Prevent browser context menu
  };

  button.onclick = originalOnClick; // Assign the initial click handler

  parent.appendChild(button);

  // --- Add Range Button for Sets ---
  const isSet = (onClicked as any).isSet;

  // DEBUG: Add logging to verify isSet flag
  logger.logInfo("Checking if should add range button:", {
    isSet,
    url: (onClicked as any).url,
    urlIncludes: {
      sets: (onClicked as any).url?.includes("/sets/"),
      albums: (onClicked as any).url?.includes("/albums/")
    },
    browserType: typeof browser !== "undefined" ? "Firefox" : "Chrome"
  });

  // Force isSet true for Firefox if URL contains /sets/ or /albums/
  if (!isSet && typeof browser !== "undefined" && (onClicked as any).url) {
    const url = (onClicked as any).url as string;
    if (url.includes("/sets/") || url.includes("/albums/")) {
      logger.logInfo("Firefox detected, forcing isSet=true for URL:", url);
      (onClicked as any).isSet = true;
    }
  }

  // Re-check after potential Firefox fix
  const finalIsSet = (onClicked as any).isSet;

  if (finalIsSet) {
    // ... (range button logic remains the same, but ensure it uses the main button's state for updates)
    const rangeButton = document.createElement("button");

    // DEBUG: Log that we're creating a range button
    logger.logInfo("Creating range button for URL=" + ((onClicked as any).url || "unknown"));

    const rangeButtonSizeClass = small ? "sc-button-small" : "sc-button-medium"; // Match size
    rangeButton.className = `sc-button-range sc-button ${rangeButtonSizeClass} sc-button-responsive`;
    rangeButton.textContent = "Range...";
    rangeButton.title = "Download a range of tracks";
    rangeButton.style.marginLeft = "5px"; // Add some space

    rangeButton.onclick = (e) => {
      e.preventDefault(); // Prevent form submission if inside one
      e.stopPropagation(); // Prevent triggering other clicks

      // IMPORTANT: Create a downloadId and store button info BEFORE opening the modal
      const preDownloadId: string = crypto.randomUUID();

      // Store the button with the URL information before the modal is even shown
      downloadButtons[preDownloadId] = {
        elem: button,
        onClick: originalOnClick,
        state: "Idle", // Not preparing yet until user confirms
        originalUrl: downloadUrl, // Use the URL captured when the button was created
        lastProgressTime: Date.now() // Add timestamp for progress tracking
      };

      logger.logInfo(`Range button clicked. Created preDownloadId: ${preDownloadId}, with URL: ${downloadUrl}`);

      // Prepare the handler for the modal's Download button
      const handleRangeDownload = (start: number, end: number | null) => {
        // Use our pre-created downloadId instead of searching
        const mainButtonId = preDownloadId;

        logger.logInfo(`Range download handler called with start=${start}, end=${end}, mainButtonId=${mainButtonId}`);

        const buttonData = downloadButtons[mainButtonId];

        // Debug the buttonData to see what's available
        logger.logInfo("Button data for range download:", {
          hasButtonData: !!buttonData,
          originalUrl: buttonData?.originalUrl,
          state: buttonData?.state
        });

        if (!buttonData || !buttonData.originalUrl) {
          logger.logError(`Range download failed: No button data or URL for ID ${mainButtonId}`);
          const errorDiv = document.getElementById("scdl-range-modal-error");
          if (errorDiv) {
            errorDiv.textContent = "Error: Could not get original URL for the playlist.";
            errorDiv.style.display = "block";
          }
          return;
        }

        // Update button text to "Preparing..."
        setButtonText(buttonData.elem, "Preparing...");
        buttonData.elem.style.cursor = "default";
        buttonData.elem.onclick = null;
        buttonData.state = "Preparing";
        buttonData.lastProgressTime = Date.now();

        // Add safety timeout for range downloads too
        const safetyTimeout = setTimeout(() => {
          if (downloadButtons[mainButtonId] && downloadButtons[mainButtonId].state === "Preparing") {
            logger.logWarn(`Safety timeout triggered for range download with ID ${mainButtonId}`);
            setButtonText(buttonData.elem, "Range download timed out. Click to retry.");
            buttonData.elem.style.cursor = "pointer";
            buttonData.elem.onclick = originalOnClick; // Allow retrying with regular download
            downloadButtons[mainButtonId].state = "Idle";
          }
        }, 15000); // Slightly longer timeout for range downloads

        // Add a completion safety timeout specifically for range downloads
        // Since range downloads can take longer, we use a longer timeout
        const completionTimeout = setTimeout(() => {
          const currentButtonData = downloadButtons[mainButtonId];
          if (currentButtonData && (currentButtonData.state === "Downloading" || currentButtonData.state === "Preparing")) {
            const lastProgressTime = currentButtonData.lastProgressTime || 0;
            const timeSinceLastProgress = Date.now() - lastProgressTime;

            // If no progress updates for more than 5 minutes, consider it potentially stuck
            if (timeSinceLastProgress > 300000) { // 5 minutes
              logger.logWarn(`Range download completion safety timeout triggered for ID ${mainButtonId}. Download seems stuck for ${timeSinceLastProgress / 1000}s`);

              // For range downloads, after 10 minutes, assume it might have completed silently
              if (timeSinceLastProgress > 600000) { // 10 minutes
                logger.logInfo(`Assuming potential silent completion for range download ${mainButtonId}`);
                resetButtonBackground(buttonData.elem);
                buttonData.elem.style.backgroundColor = "#19a352";
                setButtonText(buttonData.elem, "Downloaded!");
                buttonData.elem.title = "Range download likely completed (auto-detected)";
                buttonData.elem.onclick = null;
                downloadButtons[mainButtonId].state = "Downloaded";
                downloadButtons[mainButtonId].resetTimer = window.setTimeout(() => runResetLogic(mainButtonId), 10000);
              } else {
                // Just mark as potentially stuck but still downloading
                logger.logInfo(`Marking range download ${mainButtonId} as potentially stuck`);
                setButtonText(buttonData.elem, "Downloading range... (may be stuck)");
              }
            }
          }
        }, 600000); // 10 minutes timeout for range downloads

        // Log the message we're about to send
        logger.logInfo("Sending range download message:", {
          type: "DOWNLOAD_SET_RANGE",
          url: buttonData.originalUrl,
          start,
          end,
          downloadId: mainButtonId
        });

        // Send the message with full logging
        loggedSendMessageToBackend({
          type: "DOWNLOAD_SET_RANGE",
          url: buttonData.originalUrl,
          start,
          end,
          downloadId: mainButtonId,
        }, "handleRangeDownload").then(response => {
          // Clear safety timeout on response
          clearTimeout(safetyTimeout);

          logger.logInfo("Range download response:", response);

          // Manually update button if still in Preparing state
          if (downloadButtons[mainButtonId] && downloadButtons[mainButtonId].state === "Preparing") {
            logger.logInfo(`Manually transitioning range button from Preparing to Downloading state for ${mainButtonId}`);
            setButtonText(buttonData.elem, "Downloading... (Click to Pause)");
            buttonData.elem.style.background = "linear-gradient(90deg, #ff5419 0%, transparent 0%)";
            buttonData.elem.style.cursor = "pointer";
            buttonData.elem.onclick = createPauseResumeHandler(mainButtonId);
            downloadButtons[mainButtonId].state = "Downloading";
            downloadButtons[mainButtonId].lastProgressTime = Date.now();
          }
        }).catch(error => {
          // Clear safety timeout on error
          clearTimeout(safetyTimeout);
          clearTimeout(completionTimeout);

          logger.logError("Range download request failed:", error);

          // Update button to error state
          if (downloadButtons[mainButtonId]) {
            resetButtonBackground(buttonData.elem);
            buttonData.elem.style.backgroundColor = "#d30029";
            setButtonText(buttonData.elem, "ERROR", error?.message || "Range download failed");
            buttonData.elem.onclick = null;
            downloadButtons[mainButtonId].state = "Error";
          }
        });
      };

      showModal(button, handleRangeDownload);
    };
    parent.appendChild(rangeButton);
  }
  // --------------------------------
};

const removeElementFromParent = (element: Element) => {
  element.parentNode.removeChild(element);
};

const removeElementsMatchingSelectors = (selectors: string) => {
  const elements = document.querySelectorAll(selectors);

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];

    removeElementFromParent(element);
  }
};

const removeBuyLinks = () => {
  const selector = "a.sc-buylink";

  removeElementsMatchingSelectors(selector);

  const event: ObserverEvent = {
    selector,
    callback: (node) => removeElementFromParent(node),
  };

  observer?.addEvent(event);
};

const removeDownloadButtons = () => {
  removeElementsMatchingSelectors("button.sc-button-download");
};

const addDownloadButtonToTrackPage = () => {
  const selector = ".sc-button-group-medium > .sc-button-like";
  logger.logDebug(`[TrackPage] Querying for selector: ${selector}`);

  const addDownloadButtonToPossiblePlaylist = (node: Element) => {
    logger.logDebug("[TrackPage] Found node matching selector:", node);
    const downloadUrl = window.location.origin + window.location.pathname;
    const downloadCommand = createDownloadCommand(downloadUrl);
    // Pass the downloadCommand which includes the isSet flag
    addDownloadButtonToParent(node.parentNode, downloadCommand, false);
  };

  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);

  const event: ObserverEvent = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist,
  };

  observer?.addEvent(event);
  logger.logDebug(`[TrackPage] Initial elements found: ${document.querySelectorAll(selector).length}`);
};

const addDownloadButtonToFeed = () => {
  const selector = ".sound.streamContext .sc-button-group > .sc-button-like";
  logger.logDebug(`[Feed] Querying for selector: ${selector}`);

  const addDownloadButtonToPossiblePlaylist = (node: Element) => {
    logger.logDebug("[Feed] Found node matching selector:", node);
    const soundBody = node.parentElement.closest(".sound__body");
    const titleLink = soundBody.querySelector("a.soundTitle__title");

    if (titleLink === null) {
      return;
    }

    const downloadUrl = window.location.origin + titleLink.getAttribute("href");
    const downloadCommand = createDownloadCommand(downloadUrl);
    // Pass the downloadCommand which includes the isSet flag
    addDownloadButtonToParent(node.parentNode, downloadCommand, true);
  };

  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);

  const event: ObserverEvent = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist,
  };

  observer?.addEvent(event);
  logger.logDebug(`[Feed] Initial elements found: ${document.querySelectorAll(selector).length}`);
};

const handleBlockRepostsConfigChange = (blockReposts: boolean) => {
  let script = document.querySelector<HTMLScriptElement>("#repost-blocker");

  if (blockReposts) {
    if (script) {
      logger.logWarn("Repost-Blocker script has already been injected!");

      return;
    }

    const payloadFile = getPathFromExtensionFile("/js/repostBlocker.js");

    if (!payloadFile) return;

    logger.logInfo("Start blocking reposts");

    script = document.createElement("script");
    script.type = "text/javascript";
    script.id = "repost-blocker";
    script.src = payloadFile;

    document.documentElement.appendChild(script);
  } else {
    if (!script) return;

    logger.logInfo("Stop blocking reposts");

    const cleanupScript = document.createElement("script");
    cleanupScript.type = "text/javascript";
    cleanupScript.id = "cleanup-repost-blocker";
    cleanupScript.innerText = "XMLHttpRequest.prototype.resetSend();";

    document.documentElement.appendChild(cleanupScript);

    document.documentElement.removeChild(script);
    document.documentElement.removeChild(cleanupScript);
  }
};

const handlePageLoaded = async () => {
  logger.logInfo("handlePageLoaded executing...");
  observer = new DomObserver();

  removeBuyLinks();

  removeDownloadButtons();

  addDownloadButtonToTrackPage();

  addDownloadButtonToFeed();

  // Add specific function for playlists/sets
  addDownloadButtonToPlaylistPage();

  observer.start(document.body);

  logger.logInfo("Attached!");
};

// Add this new function to explicitly handle playlists
const addDownloadButtonToPlaylistPage = () => {
  logger.logInfo("[PlaylistPage] Running playlist button initialization");

  // Check if we're on a playlist/set page
  const isPlaylistPage = window.location.pathname.includes("/sets/") ||
    window.location.pathname.includes("/albums/") ||
    document.querySelector(".setTrackList") !== null;

  if (!isPlaylistPage) {
    logger.logDebug("[PlaylistPage] Not on a playlist page, skipping");
    return;
  }

  logger.logInfo("[PlaylistPage] Detected playlist page, adding download button");

  // Try multiple potential targets for button placement
  const possibleSelectors = [
    // Track list header
    ".soundActions .sc-button-group",
    // Header actions
    ".soundHeader__actions .sc-button-group",
    // Like button container
    ".sc-button-like",
    // Play button
    ".playControls__play",
    // Set Actions
    ".setActions .sc-button-group"
  ];

  // Log all present elements we might try to use
  for (const selector of possibleSelectors) {
    const elements = document.querySelectorAll(selector);
    logger.logDebug(`[PlaylistPage] Found ${elements.length} elements matching "${selector}"`);
  }

  // Try to find a suitable button parent from our selector options
  let buttonParent = null;
  for (const selector of possibleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      buttonParent = element;
      logger.logInfo(`[PlaylistPage] Found button parent: ${selector}`);
      break;
    }
  }

  // If we didn't find a button parent through direct selectors, try an alternative approach
  if (!buttonParent) {
    logger.logWarn("[PlaylistPage] No direct button parent found, trying alternative approach");

    // Find the main playlist container
    const playlistContainer = document.querySelector(".trackList") ||
      document.querySelector(".setTrackList");

    if (playlistContainer) {
      // Look for existing elements that we can insert before/after
      const existingButton = document.querySelector(".sc-button-like") ||
        document.querySelector(".sc-button-share") ||
        document.querySelector(".sc-button-play");

      if (existingButton && existingButton.parentNode) {
        buttonParent = existingButton.parentNode;
        logger.logInfo("[PlaylistPage] Found button parent via existing button", buttonParent);
      } else {
        // Create our own button container if absolutely needed
        const tracklistHeader = playlistContainer.querySelector(".tracklistHeader") ||
          playlistContainer.querySelector(".setTrackList__header");

        if (tracklistHeader) {
          buttonParent = document.createElement("div");
          buttonParent.className = "sc-button-group sc-button-group-medium";
          tracklistHeader.appendChild(buttonParent);
          logger.logInfo("[PlaylistPage] Created custom button parent in tracklist header");
        }
      }
    }
  }

  if (buttonParent) {
    // Get the URL of the current page (the playlist)
    const downloadUrl = window.location.origin + window.location.pathname;
    logger.logInfo(`[PlaylistPage] Creating download command for: ${downloadUrl}`);

    // Create a command with explicit isSet flag
    const command = createDownloadCommand(downloadUrl);
    (command as any).isSet = true; // Force the isSet flag to true

    logger.logInfo("[PlaylistPage] Adding download button to parent:", buttonParent);
    addDownloadButtonToParent(buttonParent, command, false);
  } else {
    logger.logError("[PlaylistPage] Could not find or create button parent for playlist page");
  }
};

const documentState = document.readyState;

if (documentState === "complete" || documentState === "interactive") {
  setTimeout(handlePageLoaded, 0);
}

document.addEventListener("DOMContentLoaded", handlePageLoaded);

// Add a periodic check for stuck downloads that runs every 60 seconds
let stuckDownloadCheckInterval: number | null = null;

function startStuckDownloadChecker() {
  if (stuckDownloadCheckInterval !== null) {
    clearInterval(stuckDownloadCheckInterval);
  }

  stuckDownloadCheckInterval = window.setInterval(() => {
    const now = Date.now();
    const activeDownloadIds = Object.keys(downloadButtons);

    if (activeDownloadIds.length === 0) return;

    logger.logDebug(`Running stuck download check for ${activeDownloadIds.length} active downloads`);

    activeDownloadIds.forEach(downloadId => {
      const buttonData = downloadButtons[downloadId];
      if (!buttonData) return;

      // We're only concerned with buttons that might be stuck in "Downloading" state
      if (buttonData.state === "Downloading") {
        const lastProgressTime = buttonData.lastProgressTime || 0;
        const idleTime = now - lastProgressTime;

        // If no progress updates for more than 5 minutes
        if (idleTime > 300000) {
          logger.logWarn(`Download ${downloadId} has been idle for ${Math.floor(idleTime / 1000)}s`);

          // If download has been idle for more than 10 minutes, assume it completed
          if (idleTime > 600000) {
            logger.logInfo(`Auto-completing download ${downloadId} due to long inactivity (${Math.floor(idleTime / 1000)}s)`);

            resetButtonBackground(buttonData.elem);
            buttonData.elem.style.backgroundColor = "#19a352";
            setButtonText(buttonData.elem, "Downloaded!");
            buttonData.elem.title = "Download likely completed (auto-detected)";
            buttonData.elem.onclick = null;
            buttonData.state = "Downloaded";

            // Set timer to reset button to idle state
            if (buttonData.resetTimer) {
              clearTimeout(buttonData.resetTimer);
            }
            buttonData.resetTimer = window.setTimeout(() => runResetLogic(downloadId), 10000);
          }
          // If download has been idle for 5+ minutes but less than 10 minutes, update the text
          else {
            setButtonText(buttonData.elem, "Downloading... (may be stuck)");
            buttonData.elem.title = `No progress for ${Math.floor(idleTime / 60000)} minutes. Click to pause/resume.`;
          }
        }
      }
    });
  }, 60000); // Check every minute

  logger.logInfo("Started automatic stuck download checker");
}

function stopStuckDownloadChecker() {
  if (stuckDownloadCheckInterval !== null) {
    clearInterval(stuckDownloadCheckInterval);
    stuckDownloadCheckInterval = null;
    logger.logInfo("Stopped automatic stuck download checker");
  }
}

window.onbeforeunload = () => {
  observer?.stop();
  stopStuckDownloadChecker();
  logger.logDebug("Unattached!");
};

// Initialize stuck download checker along with other page initialization
function initializeDownloadCheckers() {
  startStuckDownloadChecker();
}

// Call to start the checker when page is loaded
if (documentState === "complete" || documentState === "interactive") {
  setTimeout(initializeDownloadCheckers, 1000); // Start slightly after main initialization
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(initializeDownloadCheckers, 1000);
});

function writeConfigValueToLocalStorage(key: string, value: any) {
  const item = JSON.stringify(value);

  window.localStorage.setItem("SOUNDCLOUD-DL-" + key, item);
}

loadConfiguration(true).then((config) => {
  for (const key of configKeys) {
    if (config[key].secret) continue;

    writeConfigValueToLocalStorage(key, config[key].value);
  }

  setOnConfigValueChanged(writeConfigValueToLocalStorage);

  if (config["block-reposts"].value) handleBlockRepostsConfigChange(true);

  registerConfigChangeHandler("block-reposts", handleBlockRepostsConfigChange);
});

// --- Function to create the pause/resume click handler ---
const createPauseResumeHandler = (downloadId: string): (() => Promise<void>) => {
  return async () => {
    const buttonData = downloadButtons[downloadId];
    if (!buttonData) {
      logger.logWarn(`Pause/Resume: Button data not found for downloadId: ${downloadId}`);
      return;
    }

    if (!downloadId) { // Should not happen if buttonData was found, but as a safeguard
      logger.logError("Attempted to send PAUSE/RESUME command with undefined/empty downloadId.");
      return;
    }

    if (buttonData.state === "Downloading" || buttonData.state === "Resuming") {
      setButtonText(buttonData.elem, "Pausing...");
      buttonData.state = "Pausing";
      await loggedSendMessageToBackend({ type: "PAUSE_DOWNLOAD", downloadId }, "createPauseResumeHandler-Pause"); // USE WRAPPER
    } else if (buttonData.state === "Paused") {
      setButtonText(buttonData.elem, "Resuming...");
      buttonData.state = "Resuming";
      await loggedSendMessageToBackend({ type: "RESUME_DOWNLOAD", downloadId }, "createPauseResumeHandler-Resume"); // USE WRAPPER
    }
  };
};

// Define a function to run the reset logic for any download ID
function runResetLogic(downloadId: string, newState: "Idle" | "Error" = "Idle") {
  const buttonData = downloadButtons[downloadId];
  if (!buttonData) return;

  const { elem: downloadButton, onClick: originalOnClick } = buttonData;

  // Start fade-out by resetting background
  resetButtonBackground(downloadButton);
  // After fade, reset text and handlers
  setTimeout(() => {
    if (downloadButtons[downloadId]) { // Check *again*
      setButtonText(downloadButton, newState === "Error" ? "ERROR" : "Download");
      downloadButton.title = newState === "Error" ? ("Error occurred") : "Download";
      downloadButton.style.cursor = "pointer";
      // Re-attach the *original* click handler, NOT the pause/resume one
      downloadButton.onclick = originalOnClick;
      downloadButtons[downloadId].state = newState === "Error" ? "Error" : "Idle";
      // Only delete if fully reset to Idle, not if ending in Error state
      if (newState === "Idle") {
        delete downloadButtons[downloadId];
      }
    }
  }, 500); // Delay matches CSS transition duration
}

// Add a debug function to periodically check the active downloads
let debugIntervalId: number | null = null;

function startDebugLogging() {
  if (debugIntervalId !== null) {
    clearInterval(debugIntervalId);
  }

  debugIntervalId = window.setInterval(() => {
    const activeDownloadIds = Object.keys(downloadButtons);
    if (activeDownloadIds.length === 0) return;

    logger.logDebug(`DEBUG: Currently tracking ${activeDownloadIds.length} active downloads`);

    activeDownloadIds.forEach(downloadId => {
      const buttonData = downloadButtons[downloadId];
      if (!buttonData) return;

      logger.logDebug(`DEBUG: Download ${downloadId} - State=${buttonData.state}, browserDownloadId=${buttonData.browserDownloadId || "none"}, lastProgress=${buttonData.lastProgressTime ? new Date(buttonData.lastProgressTime).toISOString() : "none"}`);
    });
  }, 10000); // Log every 10 seconds

  logger.logInfo("Started debug logging for downloads");
}

// Call to start the debug logger when page is loaded
if (documentState === "complete" || documentState === "interactive") {
  setTimeout(startDebugLogging, 2000); // Start after other initialization
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(startDebugLogging, 2000);
});
