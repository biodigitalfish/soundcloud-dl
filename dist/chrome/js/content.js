import { L as Logger, o as onMessage, m as loadConfiguration, v as configKeys, r as registerConfigChangeHandler, x as getPathFromExtensionFile, y as sendMessageToBackend, z as setOnConfigValueChanged } from "./config-BfcQhoHG.js";
class DomObserver {
  observer;
  events = [];
  unqiueNodeId = 0;
  logger;
  constructor() {
    this.observer = new MutationObserver((mutations) => mutations.forEach((mutation) => this.handleMutation(mutation)));
    this.logger = Logger.create("Observer");
  }
  start(node) {
    this.observer.observe(node, { subtree: true, attributes: true, childList: true });
    this.logger.logDebug("Started");
  }
  stop() {
    this.observer.disconnect();
    this.logger.logDebug("Stopped");
  }
  addEvent(event) {
    if (!event.selector) {
      this.logger.logWarn("Selector was not specified");
      return;
    }
    if (!event.callback) {
      this.logger.logWarn("Callback was not specified");
      return;
    }
    this.events.push(event);
    this.logger.logDebug("Event added", event);
  }
  removeEvent(name) {
    this.events = this.events.filter((event) => event.name !== name);
  }
  handleMutation(mutation) {
    const target = mutation.target;
    const newNodes = mutation.addedNodes ?? [];
    for (const event of this.events) {
      if (newNodes.length > 0) {
        this.handleNodes(newNodes, event);
      } else if (mutation.type === "attributes") {
        this.handleNodes([target], event, false);
      }
    }
  }
  handleNodes(nodes, event, recursive = true) {
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (this.matchesSelectors(node, event.selector)) {
        if (node._id !== void 0) return;
        node._id = ++this.unqiueNodeId;
        event.callback(node);
      }
      if (recursive && node.childNodes?.length > 0) this.handleNodes(node.childNodes, event);
    }
  }
  matchesSelectors(element, selectors) {
    return element && element instanceof HTMLElement && element.matches(selectors);
  }
}
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
let modalElement = null;
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
  document.getElementById("scdl-range-modal-cancel").addEventListener("click", hideModal);
  modalElement.addEventListener("click", (e) => {
    if (e.target === modalElement) {
      hideModal();
    }
  });
}
function showModal(mainDownloadButton, onDownloadClick) {
  if (!modalElement) createModal();
  const fromInput = document.getElementById("scdl-range-from");
  const toInput = document.getElementById("scdl-range-to");
  const errorDiv = document.getElementById("scdl-range-modal-error");
  fromInput.value = "1";
  toInput.value = "";
  errorDiv.textContent = "";
  errorDiv.style.display = "none";
  const downloadBtn = document.getElementById("scdl-range-modal-download");
  const newDownloadBtn = downloadBtn.cloneNode(true);
  downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
  newDownloadBtn.addEventListener("click", () => {
    const start = parseInt(fromInput.value, 10);
    const endStr = toInput.value;
    const end = endStr ? parseInt(endStr, 10) : null;
    errorDiv.textContent = "";
    errorDiv.style.display = "none";
    if (isNaN(start) || start < 1) {
      errorDiv.textContent = 'Invalid "From" number.';
      errorDiv.style.display = "block";
      return;
    }
    if (end !== null && (isNaN(end) || end < start)) {
      errorDiv.textContent = 'Invalid "To" number. Must be greater than or equal to "From".';
      errorDiv.style.display = "block";
      return;
    }
    onDownloadClick(start, end);
    hideModal();
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
let observer = null;
const logger = Logger.create("SoundCloud-Downloader");
const originalSendMessageToBackend = sendMessageToBackend;
const loggedSendMessageToBackend = (message, callContext) => {
  let messageToLog = {};
  try {
    messageToLog = JSON.parse(JSON.stringify(message));
  } catch (_e) {
    messageToLog = { errorParsingMessage: true, originalType: message?.type };
  }
  logger.logDebug(`sendMessageToBackend CALLED [Context: ${callContext || "Unknown"}] Message:`, messageToLog);
  if (message && typeof message === "object") {
    const typesRequiringId = [
      "DOWNLOAD",
      "DOWNLOAD_SET",
      "DOWNLOAD_SET_RANGE",
      "PAUSE_DOWNLOAD",
      "RESUME_DOWNLOAD"
    ];
    if (typesRequiringId.includes(message.type) && (!message.downloadId || message.downloadId === void 0 || message.downloadId === "undefined")) {
      const error = new Error(`CRITICAL: Prevented sending message with type ${message.type} and missing downloadId!`);
      logger.logError(error.message, { message: messageToLog, callContext });
      return Promise.reject(error);
    }
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
  }
  return originalSendMessageToBackend(message);
};
const downloadButtons = {};
const setButtonText = (button, text, title) => {
  button.innerText = text;
  button.title = title ?? text;
};
const resetButtonBackground = (button) => {
  button.style.backgroundColor = "";
  button.style.background = "";
  button.style.color = "";
};
const handleMessageFromBackgroundScript = async (_, message) => {
  const { downloadId: receivedDownloadId, progress, error, status, completionWithoutId, completed, timestamp, browserDownloadId, originalDownloadId } = message;
  let finalDownloadId = originalDownloadId;
  logger.logInfo(
    `Message received: originalId=${originalDownloadId}, receivedId=${receivedDownloadId}, browserDlId=${browserDownloadId}, progress=${progress}, status=${status}, error=${error || "none"}`,
    { message }
  );
  if (!finalDownloadId && browserDownloadId) {
    const matchedDownloadIds = Object.keys(downloadButtons).filter(
      (id) => downloadButtons[id].browserDownloadId === browserDownloadId
    );
    if (matchedDownloadIds.length === 1) {
      finalDownloadId = matchedDownloadIds[0];
      logger.logInfo(`Matched message with browserDownloadId=${browserDownloadId} to our finalDownloadId=${finalDownloadId}`);
      if (progress === 101 || completed === true) {
        const buttonData2 = downloadButtons[finalDownloadId];
        resetButtonBackground(buttonData2.elem);
        buttonData2.elem.style.backgroundColor = "#19a352";
        setButtonText(buttonData2.elem, "Downloaded!");
        buttonData2.elem.title = "Downloaded successfully (matched by browser downloadId)";
        buttonData2.elem.onclick = null;
        buttonData2.state = "Downloaded";
        buttonData2.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
        logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from browserDownloadId match`);
        return true;
      }
    } else if (matchedDownloadIds.length > 1) {
      logger.logWarn(`Found multiple (${matchedDownloadIds.length}) buttons with browserDownloadId=${browserDownloadId}. Cannot reliably map message.`);
    }
  }
  if (!finalDownloadId || finalDownloadId === "undefined_completion" || completionWithoutId) {
    const allPotentiallyActiveStates = ["Downloading", "Preparing", "Finishing", "Pausing", "Resuming"];
    const currentActiveDownloads = Object.keys(downloadButtons).filter(
      (id) => allPotentiallyActiveStates.includes(downloadButtons[id].state)
    );
    const isMinimalMessage = progress === void 0 && // destructured from message
    status === void 0 && // destructured from message
    completed !== true && // destructured from message
    completionWithoutId !== true && // destructured from message
    error === void 0 && // destructured from message
    typeof message === "object" && Object.keys(message).length <= (originalDownloadId ? 5 : message.type ? 2 : 1);
    if (currentActiveDownloads.length === 0 && isMinimalMessage) {
      logger.logDebug(`Received minimal message (keys: ${Object.keys(message).join(", ") || "none"}) with no active downloads. Discarding.`, { message });
      return true;
    }
    logger.logWarn(`Received message (keys: ${Object.keys(message).join(", ") || "none"}) without a usable finalDownloadId or it is a generic completion. Attempting to match with active downloads (found ${currentActiveDownloads.length} using states: ${allPotentiallyActiveStates.join(", ")}).`);
    const isCompletionMessageEvaluation = progress === 101 || progress === 102 || completed === true || completionWithoutId === true || status === void 0 && error === void 0 && // destructured from message
    typeof message === "object" && Object.keys(message).length <= (originalDownloadId ? 5 : 4);
    if (isCompletionMessageEvaluation) {
      const activeIdsForCompletionLogic = currentActiveDownloads;
      logger.logInfo(`Attempting to match as completion message. Found ${activeIdsForCompletionLogic.length} candidates using states: ${allPotentiallyActiveStates.join(", ")}.`);
      if (activeIdsForCompletionLogic.length === 1) {
        const matchedId = activeIdsForCompletionLogic[0];
        logger.logInfo(`Matched undefined/generic ID message to single active download: ${matchedId}`);
        finalDownloadId = matchedId;
        const isActuallyComplete = progress === 101 || progress === 102 || completed === true || completionWithoutId === true;
        if (isActuallyComplete) {
          const buttonData2 = downloadButtons[finalDownloadId];
          resetButtonBackground(buttonData2.elem);
          buttonData2.elem.style.backgroundColor = "#19a352";
          setButtonText(buttonData2.elem, "Downloaded!");
          buttonData2.elem.title = "Downloaded successfully (auto-matched generic completion)";
          buttonData2.elem.onclick = null;
          buttonData2.state = "Downloaded";
          buttonData2.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
          logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from matched generic completion message.`);
          return true;
        }
      } else if (activeIdsForCompletionLogic.length > 1 && timestamp) {
        let mostRecentId = null;
        let mostRecentTime = 0;
        activeIdsForCompletionLogic.forEach((id) => {
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
            const buttonData2 = downloadButtons[finalDownloadId];
            resetButtonBackground(buttonData2.elem);
            buttonData2.elem.style.backgroundColor = "#19a352";
            setButtonText(buttonData2.elem, "Downloaded!");
            buttonData2.elem.title = "Downloaded successfully (auto-matched generic completion by timestamp)";
            buttonData2.elem.onclick = null;
            buttonData2.state = "Downloaded";
            buttonData2.resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
            logger.logInfo(`Updated button ${finalDownloadId} to Downloaded state from timestamp-matched generic completion message.`);
            return true;
          }
        } else {
          logger.logWarn(`Found ${activeIdsForCompletionLogic.length} active downloads, but couldn't match generic completion message by timestamp.`);
        }
      } else if (activeIdsForCompletionLogic.length > 0) {
        logger.logWarn(`Found ${activeIdsForCompletionLogic.length} active downloads, can't match generic completion message reliably by unique or timestamp.`);
      } else {
        logger.logInfo("No active downloads to match generic completion message to.");
      }
    }
    if (!finalDownloadId) {
      if (currentActiveDownloads.length === 0 && isMinimalMessage) {
        logger.logDebug("Could not determine finalDownloadId for minimal message (no active downloads) after matching attempts. Discarding.", { message });
      } else {
        logger.logWarn("Could not determine finalDownloadId from undefined/generic ID message after all attempts. Discarding.", { message });
      }
      return true;
    }
  }
  if (!finalDownloadId) {
    logger.logError("CRITICAL: finalDownloadId is null/undefined after all matching attempts. This should not happen. Discarding message.", { message });
    return true;
  }
  const buttonData = downloadButtons[finalDownloadId];
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
  if (message.success === true && message.originalDownloadId === finalDownloadId && currentState === "Preparing" && // Ensure we are in Preparing state
  message.progress === void 0 && message.status === void 0 && message.completed === void 0 && !message.error) {
    logger.logInfo(`Initial command success for ${finalDownloadId}. Transitioning to Downloading state.`);
    setButtonText(downloadButton, "Downloading... (Click to Pause)");
    downloadButton.style.background = "linear-gradient(90deg, #ff5419 0%, transparent 0%)";
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId);
    downloadButtons[finalDownloadId].state = "Downloading";
    downloadButtons[finalDownloadId].lastProgressTime = Date.now();
  }
  if (progress !== void 0 || status !== void 0) {
    downloadButtons[finalDownloadId].lastProgressTime = Date.now();
  }
  if (resetTimer) {
    clearTimeout(resetTimer);
    downloadButtons[finalDownloadId].resetTimer = void 0;
  }
  if (completed === true || message.finalBackup === true) {
    logger.logInfo(`Download complete (explicit completion flag) for finalDownloadId=${finalDownloadId}`);
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#19a352";
    setButtonText(downloadButton, "Downloaded!");
    downloadButton.title = "Downloaded successfully";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId].state = "Downloaded";
    downloadButtons[finalDownloadId].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
    logger.logInfo(`Button state updated to Downloaded due to explicit flag, finalDownloadId=${finalDownloadId}`);
    return true;
  } else if (progress === 101) {
    logger.logInfo(`Download complete (101) for finalDownloadId=${finalDownloadId}`);
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#19a352";
    setButtonText(downloadButton, "Downloaded!");
    downloadButton.title = "Downloaded successfully";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId].state = "Downloaded";
    downloadButtons[finalDownloadId].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
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
    downloadButtons[finalDownloadId].state = "Downloaded";
    downloadButtons[finalDownloadId].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
    logger.logInfo(`Button state updated to Downloaded (with errors), finalDownloadId=${finalDownloadId}`);
    return true;
  }
  if (status === "Paused") {
    resetButtonBackground(downloadButton);
    setButtonText(downloadButton, "Paused (Click to Resume)");
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId);
    downloadButtons[finalDownloadId].state = "Paused";
    logger.logInfo(`Button state updated to Paused, finalDownloadId=${finalDownloadId}`);
  } else if (status === "Resuming") {
    setButtonText(downloadButton, "Resuming...");
    downloadButton.style.cursor = "default";
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId].state = "Resuming";
    logger.logInfo(`Button state updated to Resuming, finalDownloadId=${finalDownloadId}`);
  } else if (progress === 100) {
    if (currentState !== "Paused" && currentState !== "Pausing" && currentState !== "Resuming") {
      setButtonText(downloadButton, "Finishing...");
      downloadButton.style.background = "linear-gradient(90deg, #ff5419 100%, transparent 0%)";
      downloadButton.onclick = null;
      downloadButtons[finalDownloadId].state = "Finishing";
      logger.logInfo(`Button state updated to Finishing, finalDownloadId=${finalDownloadId}`);
    }
  } else if (progress !== void 0 && progress >= 0 && progress < 100) {
    if (currentState === "Preparing" || currentState !== "Paused" && currentState !== "Pausing") {
      setButtonText(downloadButton, "Downloading... (Click to Pause)");
      downloadButton.style.background = `linear-gradient(90deg, #ff5419 ${progress}%, transparent 0%)`;
      downloadButton.style.cursor = "pointer";
      downloadButton.onclick = createPauseResumeHandler(finalDownloadId);
      downloadButtons[finalDownloadId].state = "Downloading";
      logger.logInfo(`Button state updated to Downloading (${progress}%), finalDownloadId=${finalDownloadId}`);
    }
  } else if (error) {
    resetButtonBackground(downloadButton);
    downloadButton.style.backgroundColor = "#d30029";
    setButtonText(downloadButton, "ERROR", error);
    downloadButton.onclick = null;
    downloadButtons[finalDownloadId].state = "Error";
    logger.logInfo(`Button state updated to Error: ${error}, finalDownloadId=${finalDownloadId}`);
  } else if (currentState === "Preparing" && progress !== void 0) {
    setButtonText(downloadButton, "Downloading... (Click to Pause)");
    downloadButton.style.background = "linear-gradient(90deg, #ff5419 " + (progress || 0) + "%, transparent 0%)";
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = createPauseResumeHandler(finalDownloadId);
    downloadButtons[finalDownloadId].state = "Downloading";
    logger.logInfo(`Button state forcibly updated from Preparing to Downloading, finalDownloadId=${finalDownloadId}`);
  } else if (currentState === "Downloading" && !progress && !status && !error) {
    logger.logInfo(`Received ambiguous message for download ${finalDownloadId} in Downloading state`);
    const messageStr = JSON.stringify(message).toLowerCase();
    if (messageStr.includes("finish") || messageStr.includes("complet")) {
      logger.logInfo(`Interpreting ambiguous message as completion for finalDownloadId=${finalDownloadId}`);
      resetButtonBackground(downloadButton);
      downloadButton.style.backgroundColor = "#19a352";
      setButtonText(downloadButton, "Downloaded!");
      downloadButton.title = "Downloaded successfully";
      downloadButton.onclick = null;
      downloadButtons[finalDownloadId].state = "Downloaded";
      downloadButtons[finalDownloadId].resetTimer = window.setTimeout(() => runResetLogic(finalDownloadId), 1e4);
    }
  }
  return true;
};
onMessage(handleMessageFromBackgroundScript);
const createDownloadButton = (small) => {
  const button = document.createElement("button");
  const buttonSizeClass = small ? "sc-button-small" : "sc-button-medium";
  button.className = `sc-button-download sc-button ${buttonSizeClass} sc-button-responsive`;
  setButtonText(button, "Download");
  return button;
};
const createDownloadCommand = (url) => {
  const isSetUrl = url.includes("/sets/") || url.includes("/albums/");
  logger.logDebug(`createDownloadCommand: URL=${url}, isSetUrl=${isSetUrl}`, { url, isSetUrl });
  const command = (downloadId) => {
    if (!downloadId) {
      logger.logError("Attempted to send DOWNLOAD command with undefined/empty downloadId", { url });
      return Promise.reject("Undefined/empty downloadId for DOWNLOAD command");
    }
    return loggedSendMessageToBackend({
      // USE WRAPPER
      type: isSetUrl ? "DOWNLOAD_SET" : "DOWNLOAD",
      url,
      downloadId
    }, "createDownloadCommand");
  };
  command.url = url;
  command.isSet = isSetUrl;
  logger.logDebug(`createDownloadCommand: Created command with isSet=${command.isSet}`, { commandUrl: command.url, isSet: command.isSet });
  return command;
};
const addDownloadButtonToParent = (parent, onClicked, small) => {
  const downloadButtonExists = parent.querySelector("button.sc-button-download") !== null;
  if (downloadButtonExists) {
    logger.logDebug("Download button already exists");
    return;
  }
  logger.logDebug("Adding download button", {
    parentNode: parent.nodeName,
    url: onClicked.url,
    isSet: onClicked.isSet
  });
  const button = createDownloadButton(small);
  const downloadUrl = onClicked.url;
  logger.logInfo(`Button created with URL: ${downloadUrl}`);
  const originalOnClick = async () => {
    const downloadId = crypto.randomUUID();
    downloadButtons[downloadId] = {
      elem: button,
      onClick: originalOnClick,
      // Store self for potential reset
      state: "Preparing",
      originalUrl: downloadUrl,
      // Store URL needed for pause/resume context
      lastProgressTime: Date.now()
      // Add timestamp for progress tracking
    };
    logger.logInfo(`Button clicked with downloadId: ${downloadId}, URL: ${downloadUrl}`);
    button.style.cursor = "default";
    button.onclick = null;
    setButtonText(button, "Preparing...");
    resetButtonBackground(button);
    const safetyTimeout = setTimeout(() => {
      const currentButtonData = downloadButtons[downloadId];
      if (currentButtonData && currentButtonData.state === "Preparing") {
        logger.logWarn(`Safety timeout triggered for downloadId=${downloadId}, button still in Preparing state`);
        setButtonText(button, "Click to retry");
        button.style.cursor = "pointer";
        button.onclick = originalOnClick;
        downloadButtons[downloadId].state = "Idle";
      }
    }, 1e4);
    const completionTimeout = setTimeout(() => {
      const currentButtonData = downloadButtons[downloadId];
      if (currentButtonData && currentButtonData.state === "Downloading") {
        const lastProgressTime = currentButtonData.lastProgressTime || 0;
        const timeSinceLastProgress = Date.now() - lastProgressTime;
        if (timeSinceLastProgress > 12e4) {
          logger.logWarn(`Completion safety timeout triggered for downloadId=${downloadId}. Download seems stuck in Downloading state for ${timeSinceLastProgress / 1e3}s`);
          if (timeSinceLastProgress > 18e4) {
            logger.logInfo(`Assuming potential silent completion for downloadId=${downloadId}`);
            resetButtonBackground(button);
            button.style.backgroundColor = "#19a352";
            setButtonText(button, "Downloaded!");
            button.title = "Download likely completed (auto-detected)";
            button.onclick = null;
            downloadButtons[downloadId].state = "Downloaded";
            downloadButtons[downloadId].resetTimer = window.setTimeout(() => runResetLogic(downloadId), 1e4);
          } else {
            logger.logInfo(`Marking download ${downloadId} as potentially stuck`);
            setButtonText(button, "Downloading... (may be stuck)");
          }
        }
      }
    }, 3e5);
    try {
      const response = await onClicked(downloadId);
      logger.logInfo(`Download command response for ${downloadId}:`, response);
      clearTimeout(safetyTimeout);
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
      clearTimeout(safetyTimeout);
      clearTimeout(completionTimeout);
      logger.logError(`Initial download command failed for ${downloadUrl}`, err);
      if (downloadButtons[downloadId]) {
        downloadButtons[downloadId].state = "Error";
        setButtonText(button, "ERROR", err.message || "Failed to start");
        button.style.backgroundColor = "#d30029";
      }
    }
  };
  button.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const existingMenu = document.getElementById("scdl-context-menu");
    if (existingMenu) document.body.removeChild(existingMenu);
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
    const dismissHandler = () => {
      if (document.getElementById("scdl-context-menu")) {
        document.body.removeChild(menu);
      }
      document.removeEventListener("click", dismissHandler);
    };
    document.addEventListener("click", dismissHandler);
    return false;
  };
  button.onclick = originalOnClick;
  parent.appendChild(button);
  const isSet = onClicked.isSet;
  logger.logInfo("Checking if should add range button:", {
    isSet,
    url: onClicked.url,
    urlIncludes: {
      sets: onClicked.url?.includes("/sets/"),
      albums: onClicked.url?.includes("/albums/")
    },
    browserType: typeof browser !== "undefined" ? "Firefox" : "Chrome"
  });
  if (!isSet && typeof browser !== "undefined" && onClicked.url) {
    const url = onClicked.url;
    if (url.includes("/sets/") || url.includes("/albums/")) {
      logger.logInfo("Firefox detected, forcing isSet=true for URL:", url);
      onClicked.isSet = true;
    }
  }
  const finalIsSet = onClicked.isSet;
  if (finalIsSet) {
    const rangeButton = document.createElement("button");
    logger.logInfo("Creating range button for URL=" + (onClicked.url || "unknown"));
    const rangeButtonSizeClass = small ? "sc-button-small" : "sc-button-medium";
    rangeButton.className = `sc-button-range sc-button ${rangeButtonSizeClass} sc-button-responsive`;
    rangeButton.textContent = "Range...";
    rangeButton.title = "Download a range of tracks";
    rangeButton.style.marginLeft = "5px";
    rangeButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const preDownloadId = crypto.randomUUID();
      downloadButtons[preDownloadId] = {
        elem: button,
        onClick: originalOnClick,
        state: "Idle",
        // Not preparing yet until user confirms
        originalUrl: downloadUrl,
        // Use the URL captured when the button was created
        lastProgressTime: Date.now()
        // Add timestamp for progress tracking
      };
      logger.logInfo(`Range button clicked. Created preDownloadId: ${preDownloadId}, with URL: ${downloadUrl}`);
      const handleRangeDownload = (start, end) => {
        const mainButtonId = preDownloadId;
        logger.logInfo(`Range download handler called with start=${start}, end=${end}, mainButtonId=${mainButtonId}`);
        const buttonData = downloadButtons[mainButtonId];
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
        setButtonText(buttonData.elem, "Preparing...");
        buttonData.elem.style.cursor = "default";
        buttonData.elem.onclick = null;
        buttonData.state = "Preparing";
        buttonData.lastProgressTime = Date.now();
        const safetyTimeout = setTimeout(() => {
          if (downloadButtons[mainButtonId] && downloadButtons[mainButtonId].state === "Preparing") {
            logger.logWarn(`Safety timeout triggered for range download with ID ${mainButtonId}`);
            setButtonText(buttonData.elem, "Range download timed out. Click to retry.");
            buttonData.elem.style.cursor = "pointer";
            buttonData.elem.onclick = originalOnClick;
            downloadButtons[mainButtonId].state = "Idle";
          }
        }, 15e3);
        const completionTimeout = setTimeout(() => {
          const currentButtonData = downloadButtons[mainButtonId];
          if (currentButtonData && (currentButtonData.state === "Downloading" || currentButtonData.state === "Preparing")) {
            const lastProgressTime = currentButtonData.lastProgressTime || 0;
            const timeSinceLastProgress = Date.now() - lastProgressTime;
            if (timeSinceLastProgress > 3e5) {
              logger.logWarn(`Range download completion safety timeout triggered for ID ${mainButtonId}. Download seems stuck for ${timeSinceLastProgress / 1e3}s`);
              if (timeSinceLastProgress > 6e5) {
                logger.logInfo(`Assuming potential silent completion for range download ${mainButtonId}`);
                resetButtonBackground(buttonData.elem);
                buttonData.elem.style.backgroundColor = "#19a352";
                setButtonText(buttonData.elem, "Downloaded!");
                buttonData.elem.title = "Range download likely completed (auto-detected)";
                buttonData.elem.onclick = null;
                downloadButtons[mainButtonId].state = "Downloaded";
                downloadButtons[mainButtonId].resetTimer = window.setTimeout(() => runResetLogic(mainButtonId), 1e4);
              } else {
                logger.logInfo(`Marking range download ${mainButtonId} as potentially stuck`);
                setButtonText(buttonData.elem, "Downloading range... (may be stuck)");
              }
            }
          }
        }, 6e5);
        logger.logInfo("Sending range download message:", {
          type: "DOWNLOAD_SET_RANGE",
          url: buttonData.originalUrl,
          start,
          end,
          downloadId: mainButtonId
        });
        loggedSendMessageToBackend({
          type: "DOWNLOAD_SET_RANGE",
          url: buttonData.originalUrl,
          start,
          end,
          downloadId: mainButtonId
        }, "handleRangeDownload").then((response) => {
          clearTimeout(safetyTimeout);
          logger.logInfo("Range download response:", response);
          if (downloadButtons[mainButtonId] && downloadButtons[mainButtonId].state === "Preparing") {
            logger.logInfo(`Manually transitioning range button from Preparing to Downloading state for ${mainButtonId}`);
            setButtonText(buttonData.elem, "Downloading... (Click to Pause)");
            buttonData.elem.style.background = "linear-gradient(90deg, #ff5419 0%, transparent 0%)";
            buttonData.elem.style.cursor = "pointer";
            buttonData.elem.onclick = createPauseResumeHandler(mainButtonId);
            downloadButtons[mainButtonId].state = "Downloading";
            downloadButtons[mainButtonId].lastProgressTime = Date.now();
          }
        }).catch((error) => {
          clearTimeout(safetyTimeout);
          clearTimeout(completionTimeout);
          logger.logError("Range download request failed:", error);
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
};
const removeElementFromParent = (element) => {
  element.parentNode.removeChild(element);
};
const removeElementsMatchingSelectors = (selectors) => {
  const elements = document.querySelectorAll(selectors);
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    removeElementFromParent(element);
  }
};
const removeBuyLinks = () => {
  const selector = "a.sc-buylink";
  removeElementsMatchingSelectors(selector);
  const event = {
    selector,
    callback: (node) => removeElementFromParent(node)
  };
  observer?.addEvent(event);
};
const removeDownloadButtons = () => {
  removeElementsMatchingSelectors("button.sc-button-download");
};
const addDownloadButtonToTrackPage = () => {
  const selector = ".sc-button-group-medium > .sc-button-like";
  logger.logDebug(`[TrackPage] Querying for selector: ${selector}`);
  const addDownloadButtonToPossiblePlaylist = (node) => {
    logger.logDebug("[TrackPage] Found node matching selector:", node);
    const downloadUrl = window.location.origin + window.location.pathname;
    const downloadCommand = createDownloadCommand(downloadUrl);
    addDownloadButtonToParent(node.parentNode, downloadCommand, false);
  };
  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);
  const event = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist
  };
  observer?.addEvent(event);
  logger.logDebug(`[TrackPage] Initial elements found: ${document.querySelectorAll(selector).length}`);
};
const addDownloadButtonToFeed = () => {
  const selector = ".sound.streamContext .sc-button-group > .sc-button-like";
  logger.logDebug(`[Feed] Querying for selector: ${selector}`);
  const addDownloadButtonToPossiblePlaylist = (node) => {
    logger.logDebug("[Feed] Found node matching selector:", node);
    const soundBody = node.parentElement.closest(".sound__body");
    const titleLink = soundBody.querySelector("a.soundTitle__title");
    if (titleLink === null) {
      return;
    }
    const downloadUrl = window.location.origin + titleLink.getAttribute("href");
    const downloadCommand = createDownloadCommand(downloadUrl);
    addDownloadButtonToParent(node.parentNode, downloadCommand, true);
  };
  document.querySelectorAll(selector).forEach(addDownloadButtonToPossiblePlaylist);
  const event = {
    selector,
    callback: addDownloadButtonToPossiblePlaylist
  };
  observer?.addEvent(event);
  logger.logDebug(`[Feed] Initial elements found: ${document.querySelectorAll(selector).length}`);
};
const handleBlockRepostsConfigChange = (blockReposts) => {
  let script = document.querySelector("#repost-blocker");
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
  addDownloadButtonToPlaylistPage();
  observer.start(document.body);
  logger.logInfo("Attached!");
};
const addDownloadButtonToPlaylistPage = () => {
  logger.logInfo("[PlaylistPage] Running playlist button initialization");
  const isPlaylistPage = window.location.pathname.includes("/sets/") || window.location.pathname.includes("/albums/") || document.querySelector(".setTrackList") !== null;
  if (!isPlaylistPage) {
    logger.logDebug("[PlaylistPage] Not on a playlist page, skipping");
    return;
  }
  logger.logInfo("[PlaylistPage] Detected playlist page, adding download button");
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
  for (const selector of possibleSelectors) {
    const elements = document.querySelectorAll(selector);
    logger.logDebug(`[PlaylistPage] Found ${elements.length} elements matching "${selector}"`);
  }
  let buttonParent = null;
  for (const selector of possibleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      buttonParent = element;
      logger.logInfo(`[PlaylistPage] Found button parent: ${selector}`);
      break;
    }
  }
  if (!buttonParent) {
    logger.logWarn("[PlaylistPage] No direct button parent found, trying alternative approach");
    const playlistContainer = document.querySelector(".trackList") || document.querySelector(".setTrackList");
    if (playlistContainer) {
      const existingButton = document.querySelector(".sc-button-like") || document.querySelector(".sc-button-share") || document.querySelector(".sc-button-play");
      if (existingButton && existingButton.parentNode) {
        buttonParent = existingButton.parentNode;
        logger.logInfo("[PlaylistPage] Found button parent via existing button", buttonParent);
      } else {
        const tracklistHeader = playlistContainer.querySelector(".tracklistHeader") || playlistContainer.querySelector(".setTrackList__header");
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
    const downloadUrl = window.location.origin + window.location.pathname;
    logger.logInfo(`[PlaylistPage] Creating download command for: ${downloadUrl}`);
    const command = createDownloadCommand(downloadUrl);
    command.isSet = true;
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
let stuckDownloadCheckInterval = null;
function startStuckDownloadChecker() {
  if (stuckDownloadCheckInterval !== null) {
    clearInterval(stuckDownloadCheckInterval);
  }
  stuckDownloadCheckInterval = window.setInterval(() => {
    const now = Date.now();
    const activeDownloadIds = Object.keys(downloadButtons);
    if (activeDownloadIds.length === 0) return;
    logger.logDebug(`Running stuck download check for ${activeDownloadIds.length} active downloads`);
    activeDownloadIds.forEach((downloadId) => {
      const buttonData = downloadButtons[downloadId];
      if (!buttonData) return;
      if (buttonData.state === "Downloading") {
        const lastProgressTime = buttonData.lastProgressTime || 0;
        const idleTime = now - lastProgressTime;
        if (idleTime > 3e5) {
          logger.logWarn(`Download ${downloadId} has been idle for ${Math.floor(idleTime / 1e3)}s`);
          if (idleTime > 6e5) {
            logger.logInfo(`Auto-completing download ${downloadId} due to long inactivity (${Math.floor(idleTime / 1e3)}s)`);
            resetButtonBackground(buttonData.elem);
            buttonData.elem.style.backgroundColor = "#19a352";
            setButtonText(buttonData.elem, "Downloaded!");
            buttonData.elem.title = "Download likely completed (auto-detected)";
            buttonData.elem.onclick = null;
            buttonData.state = "Downloaded";
            if (buttonData.resetTimer) {
              clearTimeout(buttonData.resetTimer);
            }
            buttonData.resetTimer = window.setTimeout(() => runResetLogic(downloadId), 1e4);
          } else {
            setButtonText(buttonData.elem, "Downloading... (may be stuck)");
            buttonData.elem.title = `No progress for ${Math.floor(idleTime / 6e4)} minutes. Click to pause/resume.`;
          }
        }
      }
    });
  }, 6e4);
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
function initializeDownloadCheckers() {
  startStuckDownloadChecker();
}
if (documentState === "complete" || documentState === "interactive") {
  setTimeout(initializeDownloadCheckers, 1e3);
}
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(initializeDownloadCheckers, 1e3);
});
function writeConfigValueToLocalStorage(key, value) {
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
const createPauseResumeHandler = (downloadId) => {
  return async () => {
    const buttonData = downloadButtons[downloadId];
    if (!buttonData) {
      logger.logWarn(`Pause/Resume: Button data not found for downloadId: ${downloadId}`);
      return;
    }
    if (!downloadId) {
      logger.logError("Attempted to send PAUSE/RESUME command with undefined/empty downloadId.");
      return;
    }
    if (buttonData.state === "Downloading" || buttonData.state === "Resuming") {
      setButtonText(buttonData.elem, "Pausing...");
      buttonData.state = "Pausing";
      await loggedSendMessageToBackend({ type: "PAUSE_DOWNLOAD", downloadId }, "createPauseResumeHandler-Pause");
    } else if (buttonData.state === "Paused") {
      setButtonText(buttonData.elem, "Resuming...");
      buttonData.state = "Resuming";
      await loggedSendMessageToBackend({ type: "RESUME_DOWNLOAD", downloadId }, "createPauseResumeHandler-Resume");
    }
  };
};
function runResetLogic(downloadId, newState = "Idle") {
  const buttonData = downloadButtons[downloadId];
  if (!buttonData) return;
  const { elem: downloadButton, onClick: originalOnClick } = buttonData;
  resetButtonBackground(downloadButton);
  setTimeout(() => {
    if (downloadButtons[downloadId]) {
      setButtonText(downloadButton, newState === "Error" ? "ERROR" : "Download");
      downloadButton.title = newState === "Error" ? "Error occurred" : "Download";
      downloadButton.style.cursor = "pointer";
      downloadButton.onclick = originalOnClick;
      downloadButtons[downloadId].state = newState === "Error" ? "Error" : "Idle";
      if (newState === "Idle") {
        delete downloadButtons[downloadId];
      }
    }
  }, 500);
}
let debugIntervalId = null;
function startDebugLogging() {
  if (debugIntervalId !== null) {
    clearInterval(debugIntervalId);
  }
  debugIntervalId = window.setInterval(() => {
    const activeDownloadIds = Object.keys(downloadButtons);
    if (activeDownloadIds.length === 0) return;
    logger.logDebug(`DEBUG: Currently tracking ${activeDownloadIds.length} active downloads`);
    activeDownloadIds.forEach((downloadId) => {
      const buttonData = downloadButtons[downloadId];
      if (!buttonData) return;
      logger.logDebug(`DEBUG: Download ${downloadId} - State=${buttonData.state}, browserDownloadId=${buttonData.browserDownloadId || "none"}, lastProgress=${buttonData.lastProgressTime ? new Date(buttonData.lastProgressTime).toISOString() : "none"}`);
    });
  }, 1e4);
  logger.logInfo("Started debug logging for downloads");
}
if (documentState === "complete" || documentState === "interactive") {
  setTimeout(startDebugLogging, 2e3);
}
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(startDebugLogging, 2e3);
});
