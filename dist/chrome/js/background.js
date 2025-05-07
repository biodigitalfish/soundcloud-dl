import { L as Logger, a as LogLevel, c as concatArrayBuffers, X as XRegExp, b as commonjsGlobal, g as getDefaultExportFromCjs, d as getConfigValue, s as sanitizeFilenameForDownload, l as loadConfigValue, e as searchDownloads, f as storeConfigValue, i as isServiceWorkerContext, h as createURLFromBlob, j as downloadToFile, k as getExtensionManifest, m as loadConfiguration, o as onMessage, n as onBeforeSendHeaders, p as onBeforeRequest, q as onPageActionClicked, r as registerConfigChangeHandler, t as openOptionsPage, u as sendMessageToTab } from "./config-BfcQhoHG.js";
class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}
class SoundCloudApi {
  baseUrl = "https://api-v2.soundcloud.com";
  logger;
  constructor() {
    this.logger = Logger.create("SoundCloudApi");
  }
  resolveUrl(url) {
    const reqUrl = `${this.baseUrl}/resolve?url=${url}`;
    return this.fetchJson(reqUrl);
  }
  getCurrentUser() {
    const url = `${this.baseUrl}/me`;
    return this.fetchJson(url);
  }
  async getFollowedArtistIds(userId) {
    const url = `${this.baseUrl}/users/${userId}/followings/ids`;
    const data = await this.fetchJson(url);
    if (!data || !data.collection) return null;
    return data.collection;
  }
  async getTracks(trackIds) {
    const url = `${this.baseUrl}/tracks?ids=${trackIds.join(",")}`;
    this.logger.logInfo("Fetching tracks with Ids", { trackIds });
    const tracks = await this.fetchJson(url);
    return trackIds.reduce((acc, cur, index) => {
      acc[cur] = tracks[index];
      return acc;
    }, {});
  }
  async getStreamDetails(url) {
    const stream = await this.fetchJson(url);
    if (!stream || !stream.url) {
      this.logger.logError("Invalid stream response", stream);
      return null;
    }
    let extension;
    let hls = false;
    const regexResult = /(?:(\w{3,4})\/playlist)?\.(\w{3,4})(?:$|\?)/.exec(stream.url);
    if (regexResult.length >= 2) {
      if (regexResult[2] === "m3u8") {
        extension = regexResult[1];
        hls = true;
      } else {
        extension = regexResult[2];
      }
    }
    return {
      url: stream.url,
      extension,
      hls
    };
  }
  async getOriginalDownloadUrl(id) {
    const url = `${this.baseUrl}/tracks/${id}/download`;
    this.logger.logInfo("Getting original download URL for track with Id", id);
    try {
      const downloadObj = await this.fetchJson(url);
      if (!downloadObj || !downloadObj.redirectUri) {
        this.logger.logError("Invalid original file response", downloadObj);
        return null;
      }
      return downloadObj.redirectUri;
    } catch (_error) {
      this.logger.logError(`Failed to get original download URL for track ${id}`, _error);
      return null;
    }
  }
  async downloadArtwork(artworkUrl) {
    const [buffer] = await this.fetchArrayBuffer(artworkUrl);
    return buffer;
  }
  downloadStream(streamUrl, reportProgress) {
    return this.fetchArrayBuffer(streamUrl, reportProgress);
  }
  async fetchArrayBuffer(url, reportProgress) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          this.logger.logDebug(`[fetchArrayBuffer] Resource not found (404) for ${url}`);
          return [null, response.headers];
        }
        if (response.status === 429) {
          this.logger.logWarn(`[fetchArrayBuffer] Rate limited (429) while fetching ${url}.`);
          throw new RateLimitError(`Rate limited (status 429) on ${url}`);
        }
        const errorText = `[fetchArrayBuffer] HTTP error for ${url} - Status: ${response.status} ${response.statusText}`;
        throw new Error(errorText);
      }
      if (!response.body) {
        this.logger.logError(`Response for ${url} has no body, despite response.ok being true.`);
        throw new Error(`Response for ${url} has no body.`);
      }
      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;
      const chunks = [];
      const reader = response.body.getReader();
      if (reportProgress && total > 0) {
        reportProgress(0);
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        loaded += value.byteLength;
        if (reportProgress && total > 0) {
          reportProgress(Math.round(loaded / total * 100));
        }
      }
      if (reportProgress) {
        reportProgress(100);
      }
      const completeBuffer = new ArrayBuffer(loaded);
      const view = new Uint8Array(completeBuffer);
      let offset = 0;
      for (const chunk of chunks) {
        view.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (loaded === 0 && response.status === 200) {
        this.logger.logWarn(`[fetchArrayBuffer] Fetched ${url} (Status: ${response.status}) but received an empty (0 bytes) buffer.`);
      }
      return [completeBuffer, response.headers];
    } catch (error) {
      this.logger.logError(`[fetchArrayBuffer] Generic error for ${url}:`, error);
      if (error instanceof RateLimitError) {
        throw error;
      }
      throw new Error(`Failed to fetch array buffer from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async fetchJson(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (resp.status === 429) {
          const errorMsg = `Rate limited while fetching from ${url}. Please wait and try again later.`;
          this.logger.logWarn(errorMsg);
          throw new RateLimitError(errorMsg);
        } else {
          const errorMsg = `HTTP error ${resp.status} while fetching from ${url}`;
          this.logger.logError(errorMsg);
          throw new Error(errorMsg);
        }
      }
      const json = await resp.json();
      if (!json) return null;
      return json;
    } catch (error) {
      this.logger.logError("Failed to fetch JSON from", url);
      return null;
    }
  }
}
var FFMessageType;
(function(FFMessageType2) {
  FFMessageType2["LOAD"] = "LOAD";
  FFMessageType2["EXEC"] = "EXEC";
  FFMessageType2["FFPROBE"] = "FFPROBE";
  FFMessageType2["WRITE_FILE"] = "WRITE_FILE";
  FFMessageType2["READ_FILE"] = "READ_FILE";
  FFMessageType2["DELETE_FILE"] = "DELETE_FILE";
  FFMessageType2["RENAME"] = "RENAME";
  FFMessageType2["CREATE_DIR"] = "CREATE_DIR";
  FFMessageType2["LIST_DIR"] = "LIST_DIR";
  FFMessageType2["DELETE_DIR"] = "DELETE_DIR";
  FFMessageType2["ERROR"] = "ERROR";
  FFMessageType2["DOWNLOAD"] = "DOWNLOAD";
  FFMessageType2["PROGRESS"] = "PROGRESS";
  FFMessageType2["LOG"] = "LOG";
  FFMessageType2["MOUNT"] = "MOUNT";
  FFMessageType2["UNMOUNT"] = "UNMOUNT";
})(FFMessageType || (FFMessageType = {}));
const getMessageID = /* @__PURE__ */ (() => {
  let messageID = 0;
  return () => messageID++;
})();
const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_TERMINATED = new Error("called FFmpeg.terminate()");
class FFmpeg {
  #worker = null;
  /**
   * #resolves and #rejects tracks Promise resolves and rejects to
   * be called when we receive message from web worker.
   */
  #resolves = {};
  #rejects = {};
  #logEventCallbacks = [];
  #progressEventCallbacks = [];
  loaded = false;
  /**
   * register worker message event handlers.
   */
  #registerHandlers = () => {
    if (this.#worker) {
      this.#worker.onmessage = ({ data: { id, type, data } }) => {
        switch (type) {
          case FFMessageType.LOAD:
            this.loaded = true;
            this.#resolves[id](data);
            break;
          case FFMessageType.MOUNT:
          case FFMessageType.UNMOUNT:
          case FFMessageType.EXEC:
          case FFMessageType.FFPROBE:
          case FFMessageType.WRITE_FILE:
          case FFMessageType.READ_FILE:
          case FFMessageType.DELETE_FILE:
          case FFMessageType.RENAME:
          case FFMessageType.CREATE_DIR:
          case FFMessageType.LIST_DIR:
          case FFMessageType.DELETE_DIR:
            this.#resolves[id](data);
            break;
          case FFMessageType.LOG:
            this.#logEventCallbacks.forEach((f) => f(data));
            break;
          case FFMessageType.PROGRESS:
            this.#progressEventCallbacks.forEach((f) => f(data));
            break;
          case FFMessageType.ERROR:
            this.#rejects[id](data);
            break;
        }
        delete this.#resolves[id];
        delete this.#rejects[id];
      };
    }
  };
  /**
   * Generic function to send messages to web worker.
   */
  #send = ({ type, data }, trans = [], signal) => {
    if (!this.#worker) {
      return Promise.reject(ERROR_NOT_LOADED);
    }
    return new Promise((resolve, reject) => {
      const id = getMessageID();
      this.#worker && this.#worker.postMessage({ id, type, data }, trans);
      this.#resolves[id] = resolve;
      this.#rejects[id] = reject;
      signal?.addEventListener("abort", () => {
        reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
      }, { once: true });
    });
  };
  on(event, callback) {
    if (event === "log") {
      this.#logEventCallbacks.push(callback);
    } else if (event === "progress") {
      this.#progressEventCallbacks.push(callback);
    }
  }
  off(event, callback) {
    if (event === "log") {
      this.#logEventCallbacks = this.#logEventCallbacks.filter((f) => f !== callback);
    } else if (event === "progress") {
      this.#progressEventCallbacks = this.#progressEventCallbacks.filter((f) => f !== callback);
    }
  }
  /**
   * Loads ffmpeg-core inside web worker. It is required to call this method first
   * as it initializes WebAssembly and other essential variables.
   *
   * @category FFmpeg
   * @returns `true` if ffmpeg core is loaded for the first time.
   */
  load = ({ classWorkerURL, ...config } = {}, { signal } = {}) => {
    if (!this.#worker) {
      this.#worker = classWorkerURL ? new Worker(new URL(classWorkerURL, import.meta.url), {
        type: "module"
      }) : (
        // We need to duplicated the code here to enable webpack
        // to bundle worekr.js here.
        new Worker(new URL(
          /* @vite-ignore */
          "/assets/worker-CnwqaRGh.js",
          import.meta.url
        ), {
          type: "module"
        })
      );
      this.#registerHandlers();
    }
    return this.#send({
      type: FFMessageType.LOAD,
      data: config
    }, void 0, signal);
  };
  /**
   * Execute ffmpeg command.
   *
   * @remarks
   * To avoid common I/O issues, ["-nostdin", "-y"] are prepended to the args
   * by default.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", ...);
   * // ffmpeg -i video.avi video.mp4
   * await ffmpeg.exec(["-i", "video.avi", "video.mp4"]);
   * const data = ffmpeg.readFile("video.mp4");
   * ```
   *
   * @returns `0` if no error, `!= 0` if timeout (1) or error.
   * @category FFmpeg
   */
  exec = (args, timeout = -1, { signal } = {}) => this.#send({
    type: FFMessageType.EXEC,
    data: { args, timeout }
  }, void 0, signal);
  /**
   * Execute ffprobe command.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", ...);
   * // Getting duration of a video in seconds: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.avi -o output.txt
   * await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "video.avi", "-o", "output.txt"]);
   * const data = ffmpeg.readFile("output.txt");
   * ```
   *
   * @returns `0` if no error, `!= 0` if timeout (1) or error.
   * @category FFmpeg
   */
  ffprobe = (args, timeout = -1, { signal } = {}) => this.#send({
    type: FFMessageType.FFPROBE,
    data: { args, timeout }
  }, void 0, signal);
  /**
   * Terminate all ongoing API calls and terminate web worker.
   * `FFmpeg.load()` must be called again before calling any other APIs.
   *
   * @category FFmpeg
   */
  terminate = () => {
    const ids = Object.keys(this.#rejects);
    for (const id of ids) {
      this.#rejects[id](ERROR_TERMINATED);
      delete this.#rejects[id];
      delete this.#resolves[id];
    }
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
      this.loaded = false;
    }
  };
  /**
   * Write data to ffmpeg.wasm.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", await fetchFile("../video.avi"));
   * await ffmpeg.writeFile("text.txt", "hello world");
   * ```
   *
   * @category File System
   */
  writeFile = (path, data, { signal } = {}) => {
    const trans = [];
    if (data instanceof Uint8Array) {
      trans.push(data.buffer);
    }
    return this.#send({
      type: FFMessageType.WRITE_FILE,
      data: { path, data }
    }, trans, signal);
  };
  mount = (fsType, options, mountPoint) => {
    const trans = [];
    return this.#send({
      type: FFMessageType.MOUNT,
      data: { fsType, options, mountPoint }
    }, trans);
  };
  unmount = (mountPoint) => {
    const trans = [];
    return this.#send({
      type: FFMessageType.UNMOUNT,
      data: { mountPoint }
    }, trans);
  };
  /**
   * Read data from ffmpeg.wasm.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * const data = await ffmpeg.readFile("video.mp4");
   * ```
   *
   * @category File System
   */
  readFile = (path, encoding = "binary", { signal } = {}) => this.#send({
    type: FFMessageType.READ_FILE,
    data: { path, encoding }
  }, void 0, signal);
  /**
   * Delete a file.
   *
   * @category File System
   */
  deleteFile = (path, { signal } = {}) => this.#send({
    type: FFMessageType.DELETE_FILE,
    data: { path }
  }, void 0, signal);
  /**
   * Rename a file or directory.
   *
   * @category File System
   */
  rename = (oldPath, newPath, { signal } = {}) => this.#send({
    type: FFMessageType.RENAME,
    data: { oldPath, newPath }
  }, void 0, signal);
  /**
   * Create a directory.
   *
   * @category File System
   */
  createDir = (path, { signal } = {}) => this.#send({
    type: FFMessageType.CREATE_DIR,
    data: { path }
  }, void 0, signal);
  /**
   * List directory contents.
   *
   * @category File System
   */
  listDir = (path, { signal } = {}) => this.#send({
    type: FFMessageType.LIST_DIR,
    data: { path }
  }, void 0, signal);
  /**
   * Delete an empty directory.
   *
   * @category File System
   */
  deleteDir = (path, { signal } = {}) => this.#send({
    type: FFMessageType.DELETE_DIR,
    data: { path }
  }, void 0, signal);
}
var FFFSType;
(function(FFFSType2) {
  FFFSType2["MEMFS"] = "MEMFS";
  FFFSType2["NODEFS"] = "NODEFS";
  FFFSType2["NODERAWFS"] = "NODERAWFS";
  FFFSType2["IDBFS"] = "IDBFS";
  FFFSType2["WORKERFS"] = "WORKERFS";
  FFFSType2["PROXYFS"] = "PROXYFS";
})(FFFSType || (FFFSType = {}));
const ERROR_RESPONSE_BODY_READER = new Error("failed to get response body reader");
const ERROR_INCOMPLETED_DOWNLOAD = new Error("failed to complete download");
const HeaderContentLength = "Content-Length";
const downloadWithProgress = async (url, cb) => {
  const resp = await fetch(url);
  let buf;
  try {
    const total = parseInt(resp.headers.get(HeaderContentLength) || "-1");
    const reader = resp.body?.getReader();
    if (!reader)
      throw ERROR_RESPONSE_BODY_READER;
    const chunks = [];
    let received = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      const delta = value ? value.length : 0;
      if (done) {
        if (total != -1 && total !== received)
          throw ERROR_INCOMPLETED_DOWNLOAD;
        cb && cb({ url, total, received, delta, done });
        break;
      }
      chunks.push(value);
      received += delta;
      cb && cb({ url, total, received, delta, done });
    }
    const data = new Uint8Array(received);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.length;
    }
    buf = data.buffer;
  } catch (e2) {
    console.log(`failed to send download progress event: `, e2);
    buf = await resp.arrayBuffer();
  }
  return buf;
};
const toBlobURL = async (url, mimeType, progress = false, cb) => {
  const buf = progress ? await downloadWithProgress(url, cb) : await (await fetch(url)).arrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
};
const logger$3 = Logger.create("FFmpegSetup", LogLevel.Debug);
const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let ffmpegLoadPromise = null;
ffmpeg.on("log", ({ message }) => {
  if (!message.startsWith("frame=")) {
    logger$3.logDebug(`[FFMPEG_WASM] ${message}`);
  }
});
async function loadFFmpeg() {
  if (ffmpegLoaded) return true;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;
  logger$3.logInfo("[FFMPEG_WASM] Initializing FFmpeg.wasm from local files (using toBlobURL strategy)...");
  ffmpegLoadPromise = (async () => {
    try {
      const corePathSuffix = "ffmpeg-core/";
      const getURL = typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL ? browser.runtime.getURL : chrome.runtime.getURL;
      const coreBaseURL = getURL(corePathSuffix);
      const coreJsPath = coreBaseURL + "ffmpeg-core.js";
      const coreWasmPath = coreBaseURL + "ffmpeg-core.wasm";
      logger$3.logInfo(`[FFMPEG_WASM] Base URL for Blob: ${coreBaseURL}`);
      logger$3.logInfo("[FFMPEG_WASM] Attempting to create Blob URLs for core files...");
      const coreBlobURL = await toBlobURL(coreJsPath, "text/javascript");
      const wasmBlobURL = await toBlobURL(coreWasmPath, "application/wasm");
      logger$3.logInfo("[FFMPEG_WASM] Blob URLs created. Loading FFmpeg...");
      await ffmpeg.load({
        coreURL: coreBlobURL,
        wasmURL: wasmBlobURL
      });
      ffmpegLoaded = true;
      logger$3.logInfo("[FFMPEG_WASM] FFmpeg.wasm loaded successfully via Blob URLs.");
      return true;
    } catch (error) {
      logger$3.logError("[FFMPEG_WASM] Failed to load FFmpeg.wasm via Blob URLs", error);
      ffmpegLoaded = false;
      return false;
    } finally {
      if (!ffmpegLoaded) ffmpegLoadPromise = null;
    }
  })();
  return ffmpegLoadPromise;
}
function e(e2) {
  return String(e2).split("").map((e3) => e3.charCodeAt(0));
}
function t(t2) {
  return new Uint8Array(e(t2));
}
function a(t2) {
  const a2 = new ArrayBuffer(2 * t2.length), r2 = new Uint8Array(a2);
  return new Uint16Array(a2).set(e(t2)), r2;
}
function r(e2) {
  const t2 = 255;
  return [e2 >>> 24 & t2, e2 >>> 16 & t2, e2 >>> 8 & t2, e2 & t2];
}
function n(e2) {
  return 11 + e2;
}
function s(e2, t2, a2, r2) {
  return 11 + t2 + 1 + 1 + (r2 ? 2 + 2 * (a2 + 1) : a2 + 1) + e2;
}
function i(e2) {
  let t2 = 0;
  return e2.forEach((e3) => {
    t2 += 2 + 2 * e3[0].length + 2 + 2 + 2 * e3[1].length + 2;
  }), 11 + t2;
}
function c(e2, t2) {
  const a2 = 2 * t2;
  let r2 = 0;
  return e2.forEach((e3) => {
    r2 += 2 + 2 * e3[0].length + 2 + 4;
  }), 18 + a2 + 2 + r2;
}
class o {
  _setIntegerFrame(e2, t2) {
    const a2 = parseInt(t2, 10);
    this.frames.push({ name: e2, value: a2, size: n(a2.toString().length) });
  }
  _setStringFrame(e2, t2) {
    const a2 = t2.toString();
    let r2 = 13 + 2 * a2.length;
    "TDAT" === e2 && (r2 = n(a2.length)), this.frames.push({ name: e2, value: a2, size: r2 });
  }
  _setPictureFrame(e2, t2, a2, r2) {
    const n2 = function(e3) {
      if (!e3 || !e3.length) return null;
      if (255 === e3[0] && 216 === e3[1] && 255 === e3[2]) return "image/jpeg";
      if (137 === e3[0] && 80 === e3[1] && 78 === e3[2] && 71 === e3[3]) return "image/png";
      if (71 === e3[0] && 73 === e3[1] && 70 === e3[2]) return "image/gif";
      if (87 === e3[8] && 69 === e3[9] && 66 === e3[10] && 80 === e3[11]) return "image/webp";
      const t3 = 73 === e3[0] && 73 === e3[1] && 42 === e3[2] && 0 === e3[3], a3 = 77 === e3[0] && 77 === e3[1] && 0 === e3[2] && 42 === e3[3];
      return t3 || a3 ? "image/tiff" : 66 === e3[0] && 77 === e3[1] ? "image/bmp" : 0 === e3[0] && 0 === e3[1] && 1 === e3[2] && 0 === e3[3] ? "image/x-icon" : null;
    }(new Uint8Array(t2)), i2 = a2.toString();
    if (!n2) throw new Error("Unknown picture MIME type");
    a2 || (r2 = false), this.frames.push({ name: "APIC", value: t2, pictureType: e2, mimeType: n2, useUnicodeEncoding: r2, description: i2, size: s(t2.byteLength, n2.length, i2.length, r2) });
  }
  _setLyricsFrame(e2, t2, a2) {
    const r2 = e2.split("").map((e3) => e3.charCodeAt(0)), n2 = t2.toString(), s2 = a2.toString();
    var i2, c2;
    this.frames.push({ name: "USLT", value: s2, language: r2, description: n2, size: (i2 = n2.length, c2 = s2.length, 16 + 2 * i2 + 2 + 2 + 2 * c2) });
  }
  _setCommentFrame(e2, t2, a2) {
    const r2 = e2.split("").map((e3) => e3.charCodeAt(0)), n2 = t2.toString(), s2 = a2.toString();
    var i2, c2;
    this.frames.push({ name: "COMM", value: s2, language: r2, description: n2, size: (i2 = n2.length, c2 = s2.length, 16 + 2 * i2 + 2 + 2 + 2 * c2) });
  }
  _setPrivateFrame(e2, t2) {
    const a2 = e2.toString();
    var r2, n2;
    this.frames.push({ name: "PRIV", value: t2, id: a2, size: (r2 = a2.length, n2 = t2.byteLength, 10 + r2 + 1 + n2) });
  }
  _setUserStringFrame(e2, t2) {
    const a2 = e2.toString(), r2 = t2.toString();
    var n2, s2;
    this.frames.push({ name: "TXXX", description: a2, value: r2, size: (n2 = a2.length, s2 = r2.length, 13 + 2 * n2 + 2 + 2 + 2 * s2) });
  }
  _setUrlLinkFrame(e2, t2) {
    const a2 = t2.toString();
    var r2;
    this.frames.push({ name: e2, value: a2, size: (r2 = a2.length, 10 + r2) });
  }
  _setPairedTextFrame(e2, t2) {
    this.frames.push({ name: e2, value: t2, size: i(t2) });
  }
  _setSynchronisedLyricsFrame(e2, t2, a2, r2, n2) {
    const s2 = n2.toString(), i2 = r2.split("").map((e3) => e3.charCodeAt(0));
    this.frames.push({ name: "SYLT", value: t2, language: i2, description: s2, type: e2, timestampFormat: a2, size: c(t2, s2.length) });
  }
  constructor(e2) {
    if (!e2 || "object" != typeof e2 || !("byteLength" in e2)) throw new Error("First argument should be an instance of ArrayBuffer or Buffer");
    this.arrayBuffer = e2, this.padding = 4096, this.frames = [], this.url = "";
  }
  setFrame(e2, t2) {
    switch (e2) {
      case "TPE1":
      case "TCOM":
      case "TCON": {
        if (!Array.isArray(t2)) throw new Error(`${e2} frame value should be an array of strings`);
        const a2 = "TCON" === e2 ? ";" : "/", r2 = t2.join(a2);
        this._setStringFrame(e2, r2);
        break;
      }
      case "TLAN":
      case "TIT1":
      case "TIT2":
      case "TIT3":
      case "TALB":
      case "TPE2":
      case "TPE3":
      case "TPE4":
      case "TRCK":
      case "TPOS":
      case "TMED":
      case "TPUB":
      case "TCOP":
      case "TKEY":
      case "TEXT":
      case "TDAT":
      case "TCMP":
      case "TSRC":
        this._setStringFrame(e2, t2);
        break;
      case "TBPM":
      case "TLEN":
      case "TYER":
        this._setIntegerFrame(e2, t2);
        break;
      case "USLT":
        if (t2.language = t2.language || "eng", "object" != typeof t2 || !("description" in t2) || !("lyrics" in t2)) throw new Error("USLT frame value should be an object with keys description and lyrics");
        if (t2.language && !t2.language.match(/[a-z]{3}/i)) throw new Error("Language must be coded following the ISO 639-2 standards");
        this._setLyricsFrame(t2.language, t2.description, t2.lyrics);
        break;
      case "APIC":
        if ("object" != typeof t2 || !("type" in t2) || !("data" in t2) || !("description" in t2)) throw new Error("APIC frame value should be an object with keys type, data and description");
        if (t2.type < 0 || t2.type > 20) throw new Error("Incorrect APIC frame picture type");
        this._setPictureFrame(t2.type, t2.data, t2.description, !!t2.useUnicodeEncoding);
        break;
      case "TXXX":
        if ("object" != typeof t2 || !("description" in t2) || !("value" in t2)) throw new Error("TXXX frame value should be an object with keys description and value");
        this._setUserStringFrame(t2.description, t2.value);
        break;
      case "WCOM":
      case "WCOP":
      case "WOAF":
      case "WOAR":
      case "WOAS":
      case "WORS":
      case "WPAY":
      case "WPUB":
        this._setUrlLinkFrame(e2, t2);
        break;
      case "COMM":
        if (t2.language = t2.language || "eng", "object" != typeof t2 || !("description" in t2) || !("text" in t2)) throw new Error("COMM frame value should be an object with keys description and text");
        if (t2.language && !t2.language.match(/[a-z]{3}/i)) throw new Error("Language must be coded following the ISO 639-2 standards");
        this._setCommentFrame(t2.language, t2.description, t2.text);
        break;
      case "PRIV":
        if ("object" != typeof t2 || !("id" in t2) || !("data" in t2)) throw new Error("PRIV frame value should be an object with keys id and data");
        this._setPrivateFrame(t2.id, t2.data);
        break;
      case "IPLS":
        if (!Array.isArray(t2) || !Array.isArray(t2[0])) throw new Error("IPLS frame value should be an array of pairs");
        this._setPairedTextFrame(e2, t2);
        break;
      case "SYLT":
        if ("object" != typeof t2 || !("type" in t2) || !("text" in t2) || !("timestampFormat" in t2)) throw new Error("SYLT frame value should be an object with keys type, text and timestampFormat");
        if (!Array.isArray(t2.text) || !Array.isArray(t2.text[0])) throw new Error("SYLT frame text value should be an array of pairs");
        if (t2.type < 0 || t2.type > 6) throw new Error("Incorrect SYLT frame content type");
        if (t2.timestampFormat < 1 || t2.timestampFormat > 2) throw new Error("Incorrect SYLT frame time stamp format");
        t2.language = t2.language || "eng", t2.description = t2.description || "", this._setSynchronisedLyricsFrame(t2.type, t2.text, t2.timestampFormat, t2.language, t2.description);
        break;
      default:
        throw new Error(`Unsupported frame ${e2}`);
    }
    return this;
  }
  removeTag() {
    if (this.arrayBuffer.byteLength < 10) return;
    const e2 = new Uint8Array(this.arrayBuffer), t2 = e2[3], a2 = ((r2 = [e2[6], e2[7], e2[8], e2[9]])[0] << 21) + (r2[1] << 14) + (r2[2] << 7) + r2[3] + 10;
    var r2, n2;
    73 !== (n2 = e2)[0] || 68 !== n2[1] || 51 !== n2[2] || t2 < 2 || t2 > 4 || (this.arrayBuffer = new Uint8Array(e2.subarray(a2)).buffer);
  }
  addTag() {
    this.removeTag();
    const e2 = [255, 254], n2 = 10 + this.frames.reduce((e3, t2) => e3 + t2.size, 0) + this.padding, s2 = new ArrayBuffer(this.arrayBuffer.byteLength + n2), i2 = new Uint8Array(s2);
    let c2 = 0, o2 = [];
    return o2 = [73, 68, 51, 3], i2.set(o2, c2), c2 += o2.length, c2++, c2++, o2 = function(e3) {
      const t2 = 127;
      return [e3 >>> 21 & t2, e3 >>> 14 & t2, e3 >>> 7 & t2, e3 & t2];
    }(n2 - 10), i2.set(o2, c2), c2 += o2.length, this.frames.forEach((n3) => {
      switch (o2 = t(n3.name), i2.set(o2, c2), c2 += o2.length, o2 = r(n3.size - 10), i2.set(o2, c2), c2 += o2.length, c2 += 2, n3.name) {
        case "WCOM":
        case "WCOP":
        case "WOAF":
        case "WOAR":
        case "WOAS":
        case "WORS":
        case "WPAY":
        case "WPUB":
          o2 = t(n3.value), i2.set(o2, c2), c2 += o2.length;
          break;
        case "TPE1":
        case "TCOM":
        case "TCON":
        case "TLAN":
        case "TIT1":
        case "TIT2":
        case "TIT3":
        case "TALB":
        case "TPE2":
        case "TPE3":
        case "TPE4":
        case "TRCK":
        case "TPOS":
        case "TKEY":
        case "TMED":
        case "TPUB":
        case "TCOP":
        case "TEXT":
        case "TSRC":
          o2 = [1].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(n3.value), i2.set(o2, c2), c2 += o2.length;
          break;
        case "TXXX":
        case "USLT":
        case "COMM":
          o2 = [1], "USLT" !== n3.name && "COMM" !== n3.name || (o2 = o2.concat(n3.language)), o2 = o2.concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(n3.description), i2.set(o2, c2), c2 += o2.length, o2 = [0, 0].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(n3.value), i2.set(o2, c2), c2 += o2.length;
          break;
        case "TBPM":
        case "TLEN":
        case "TDAT":
        case "TYER":
          c2++, o2 = t(n3.value), i2.set(o2, c2), c2 += o2.length;
          break;
        case "PRIV":
          o2 = t(n3.id), i2.set(o2, c2), c2 += o2.length, c2++, i2.set(new Uint8Array(n3.value), c2), c2 += n3.value.byteLength;
          break;
        case "APIC":
          o2 = [n3.useUnicodeEncoding ? 1 : 0], i2.set(o2, c2), c2 += o2.length, o2 = t(n3.mimeType), i2.set(o2, c2), c2 += o2.length, o2 = [0, n3.pictureType], i2.set(o2, c2), c2 += o2.length, n3.useUnicodeEncoding ? (o2 = [].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(n3.description), i2.set(o2, c2), c2 += o2.length, c2 += 2) : (o2 = t(n3.description), i2.set(o2, c2), c2 += o2.length, c2++), i2.set(new Uint8Array(n3.value), c2), c2 += n3.value.byteLength;
          break;
        case "IPLS":
          o2 = [1], i2.set(o2, c2), c2 += o2.length, n3.value.forEach((t2) => {
            o2 = [].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(t2[0].toString()), i2.set(o2, c2), c2 += o2.length, o2 = [0, 0].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(t2[1].toString()), i2.set(o2, c2), c2 += o2.length, o2 = [0, 0], i2.set(o2, c2), c2 += o2.length;
          });
          break;
        case "SYLT":
          o2 = [1].concat(n3.language).concat(n3.timestampFormat).concat(n3.type), i2.set(o2, c2), c2 += o2.length, o2 = [].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(n3.description), i2.set(o2, c2), c2 += o2.length, c2 += 2, n3.value.forEach((t2) => {
            o2 = [].concat(e2), i2.set(o2, c2), c2 += o2.length, o2 = a(t2[0].toString()), i2.set(o2, c2), c2 += o2.length, o2 = [0, 0], i2.set(o2, c2), c2 += o2.length, o2 = r(t2[1]), i2.set(o2, c2), c2 += o2.length;
          });
      }
    }), c2 += this.padding, i2.set(new Uint8Array(this.arrayBuffer), c2), this.arrayBuffer = s2, s2;
  }
  getBlob() {
    return new Blob([this.arrayBuffer], { type: "audio/mpeg" });
  }
  getURL() {
    return this.url || (this.url = URL.createObjectURL(this.getBlob())), this.url;
  }
  revokeURL() {
    URL.revokeObjectURL(this.url);
  }
}
class Mp3TagWriter {
  writer;
  constructor(buffer) {
    this.writer = new o(buffer);
  }
  setTitle(title) {
    if (!title) throw new Error("Invalid value for title");
    this.writer.setFrame("TIT2", title);
  }
  setArtists(artists) {
    if (!artists || artists.length < 1) throw new Error("Invalid value for artists");
    this.writer.setFrame("TPE1", artists);
  }
  setAlbum(album) {
    if (!album) throw new Error("Invalid value for album");
    this.writer.setFrame("TALB", album);
  }
  setComment(comment) {
    if (!comment) throw new Error("Invalid value for comment");
    this.writer.setFrame("COMM", {
      text: comment,
      description: ""
    });
  }
  setTrackNumber(trackNumber) {
    if (trackNumber < 1 || trackNumber > 32767) throw new Error("Invalid value for trackNumber");
    this.writer.setFrame("TRCK", trackNumber.toString());
  }
  setYear(year) {
    if (year < 1) throw new Error("Invalud value for year");
    this.writer.setFrame("TYER", year);
  }
  setGrouping(grouping) {
    if (!grouping) throw new Error("Invalid value for grouping");
    this.writer.setFrame("TIT1", grouping);
  }
  setArtwork(artworkBuffer) {
    if (!artworkBuffer || artworkBuffer.byteLength < 1) throw new Error("Invalid value for artworkBuffer");
    this.writer.setFrame("APIC", {
      type: 3,
      data: artworkBuffer,
      description: ""
    });
  }
  getBuffer() {
    this.writer.addTag();
    const blob = this.writer.getBlob();
    return blob.arrayBuffer().then((buffer) => {
      return { buffer, tagsApplied: true };
    });
  }
}
const ATOM_HEAD_LENGTH = 8;
const ATOM_DATA_HEAD_LENGTH = 16;
const ATOM_HEADER_LENGTH = ATOM_HEAD_LENGTH + ATOM_DATA_HEAD_LENGTH;
class Mp4 {
  _metadataPath = ["moov", "udta", "meta", "ilst"];
  _buffer;
  _bufferView;
  _atoms = [];
  _loggedErrors = /* @__PURE__ */ new Set();
  _hasValidStructure = false;
  _logger;
  get hasValidMp4Structure() {
    return this._hasValidStructure;
  }
  _logError(message) {
    if (!this._loggedErrors.has(message)) {
      this._logger.logDebug(`MP4 metadata: ${message}`);
      this._loggedErrors.add(message);
    }
  }
  constructor(buffer) {
    this._buffer = buffer;
    this._bufferView = new DataView(buffer);
    this._logger = Logger.create("MP4TagWriterInternals", LogLevel.Debug);
  }
  parse() {
    if (!this._buffer) throw new Error("Buffer can not be null");
    if (this._atoms.length > 0) throw new Error("Buffer already parsed");
    this._logger.logDebug("Starting MP4 parse...");
    let offset = 0;
    let atom;
    let atomsFound = [];
    while (true) {
      atom = this._readAtom(offset);
      if (!atom || atom.length < 1 || offset >= this._buffer.byteLength) {
        if (offset < this._buffer.byteLength) {
          this._logger.logDebug(`Parsing stopped: _readAtom returned invalid atom or zero length at offset ${offset}.`);
        } else {
          this._logger.logDebug(`Parsing stopped: Reached end of buffer at offset ${offset}.`);
        }
        break;
      }
      atomsFound.push({ name: atom.name || "undefined", length: atom.length, offset: atom.offset });
      this._atoms.push(atom);
      offset = atom.offset + atom.length;
      if (offset <= atom.offset) {
        this._logger.logError(`Parsing stopped: Invalid offset progression. Current offset ${atom.offset}, next offset calculated as ${offset}.`);
        break;
      }
    }
    this._logger.logDebug(`Finished MP4 parse. Found ${this._atoms.length} top-level atoms.`);
    this._logger.logDebug(`Top-level atoms summary: ${JSON.stringify(atomsFound)}`);
    if (this._atoms.length < 1) {
      this._logError("Buffer could not be parsed - no valid top-level atoms found.");
      this._hasValidStructure = false;
      return;
    }
    const moovAtom = this._atoms.find((a2) => a2.name?.toLowerCase() === "moov");
    this._hasValidStructure = !!moovAtom;
    if (!this._hasValidStructure) {
      this._logError("File structure check failed: Did not find a top-level 'moov' atom (checked case-insensitively).");
    } else {
      this._logger.logDebug("File structure check passed: Found top-level 'moov' atom (case-insensitive check).");
    }
  }
  setDuration(duration) {
    try {
      if (!this._hasValidStructure) {
        this._logError("Cannot set duration - file doesn't have a valid MP4 structure");
        return;
      }
      const mvhdAtom = this._findAtom(this._atoms, ["moov", "mvhd"]);
      if (!mvhdAtom) throw new Error("'mvhd' atom could not be found");
      const precedingDataLength = 16;
      this._bufferView.setUint32(mvhdAtom.offset + ATOM_HEAD_LENGTH + precedingDataLength, duration);
    } catch (error) {
      this._logError(`Failed to set duration: ${error.message}`);
    }
  }
  addMetadataAtom(name, data) {
    try {
      if (!this._hasValidStructure) {
        this._logError(`Cannot add ${name} metadata - file doesn't have a valid MP4 structure`);
        return;
      }
      if (name.length > 4 || name.length < 1) throw new Error(`Unsupported atom name: '${name}'`);
      let dataBuffer;
      if (data instanceof ArrayBuffer) {
        dataBuffer = data;
      } else if (typeof data === "string") {
        dataBuffer = this._getBufferFromString(data);
      } else if (typeof data === "number") {
        dataBuffer = new ArrayBuffer(4);
        const dataView = new DataView(dataBuffer);
        dataView.setUint32(0, data);
      } else {
        throw new Error(`Unsupported data: '${data}'`);
      }
      const atom = {
        name,
        length: ATOM_HEADER_LENGTH + dataBuffer.byteLength,
        data: dataBuffer
      };
      this._insertAtom(atom, this._metadataPath);
    } catch (error) {
      this._logError(`Failed to add metadata atom '${name}': ${error.message}`);
    }
  }
  getBuffer() {
    const buffers = [];
    let bufferIndex = 0;
    for (const atom of this._atoms) {
      if (!atom.children) {
        const slice = this._buffer.slice(atom.offset, atom.offset + atom.length);
        buffers.push(slice);
        bufferIndex++;
        continue;
      }
      atom.length = ATOM_HEAD_LENGTH;
      const levels = [{ parent: atom, offset: bufferIndex, childIndex: 0 }];
      let levelIndex = 0;
      while (true) {
        const { parent, offset, childIndex } = levels[levelIndex];
        if (childIndex >= parent.children.length) {
          levelIndex--;
          levels.pop();
          let parentHeadLength = ATOM_HEAD_LENGTH;
          if (parent.name === "meta") {
            parent.length += 4;
            parentHeadLength += 4;
          } else if (parent.name === "stsd") {
            parent.length += 8;
            parentHeadLength += 8;
          }
          this._bufferView.setUint32(parent.offset, parent.length);
          const parentHeader = this._buffer.slice(parent.offset, parent.offset + parentHeadLength);
          buffers.splice(offset, 0, parentHeader);
          if (levelIndex < 0) break;
          const newParent = levels[levelIndex].parent;
          newParent.length += parent.length;
          levels[levelIndex].childIndex++;
          continue;
        }
        const child = parent.children[childIndex];
        if (child.children) {
          child.length = ATOM_HEAD_LENGTH;
          levels.push({ parent: child, offset: bufferIndex, childIndex: 0 });
          levelIndex++;
          continue;
        } else if (child.data) {
          const headerBuffer = this._getHeaderBufferFromAtom(child);
          buffers.push(headerBuffer);
          buffers.push(child.data);
        } else {
          const slice = this._buffer.slice(child.offset, child.offset + child.length);
          buffers.push(slice);
        }
        bufferIndex++;
        parent.length += child.length;
        levels[levelIndex].childIndex++;
      }
    }
    this._bufferView = null;
    this._buffer = null;
    this._atoms = [];
    return concatArrayBuffers(buffers);
  }
  _insertAtom(atom, path) {
    try {
      this._logger.logDebug(`Attempting to insert atom '${atom.name}' at path '${path.join(" > ")}'.`);
      if (!path || path[path.length - 1] !== "ilst") {
        this._logError(`Cannot insert tag atom '${atom.name}': Path does not end in 'ilst'.`);
        return;
      }
      const parentAtom = this._createMetadataPath();
      if (!parentAtom) {
        this._logError(`Cannot insert atom '${atom.name}': Failed to find or create parent 'ilst' atom.`);
        return;
      }
      if (parentAtom.children === void 0) {
        parentAtom.children = this._readChildAtoms(parentAtom);
        this._logger.logDebug(`Loaded children for '${parentAtom.name}' in _insertAtom.`);
      }
      const existingIndex = parentAtom.children.findIndex((child) => child.name === atom.name);
      if (existingIndex !== -1) {
        this._logger.logDebug(`Replacing existing atom '${atom.name}' in '${parentAtom.name}'.`);
        parentAtom.children.splice(existingIndex, 1);
      }
      let offset = parentAtom.offset + this._getAtomHeaderLength(parentAtom);
      if (parentAtom.children.length > 0) {
        const lastChild = parentAtom.children[parentAtom.children.length - 1];
        offset = lastChild.offset + lastChild.length;
      }
      atom.offset = offset;
      parentAtom.children.push(atom);
      this._logger.logDebug(`Successfully prepared atom '${atom.name}' for insertion into '${parentAtom.name}'.`);
    } catch (error) {
      this._logError(`Error during _insertAtom for '${atom.name}': ${error.message}`);
    }
  }
  _findAtom(atoms, path) {
    if (!path || path.length < 1) throw new Error("Path can not be empty");
    const curPath = [...path];
    const curName = curPath.shift();
    const curElem = atoms.find((i2) => i2.name === curName);
    if (curPath.length < 1) return curElem;
    if (!curElem) return null;
    if (curElem.children === void 0) {
      curElem.children = this._readChildAtoms(curElem);
    }
    if (curElem.children.length < 1) return null;
    return this._findAtom(curElem.children, curPath);
  }
  _readChildAtoms(atom) {
    const children = [];
    const childEnd = atom.offset + atom.length;
    let childOffset = atom.offset + ATOM_HEAD_LENGTH;
    if (atom.name === "meta") {
      childOffset += 4;
    } else if (atom.name === "stsd") {
      childOffset += 8;
    }
    while (true) {
      if (childOffset >= childEnd) break;
      const childAtom = this._readAtom(childOffset);
      if (!childAtom || childAtom.length < 1) break;
      childOffset = childAtom.offset + childAtom.length;
      children.push(childAtom);
    }
    return children;
  }
  _readAtom(offset) {
    const begin = offset;
    const end = offset + ATOM_HEAD_LENGTH;
    const buffer = this._buffer.slice(begin, end);
    if (buffer.byteLength < ATOM_HEAD_LENGTH) {
      return {
        length: buffer.byteLength,
        offset
      };
    }
    const dataView = new DataView(buffer);
    let length = dataView.getUint32(0, false);
    let name = "";
    for (let i2 = 0; i2 < 4; i2++) {
      name += String.fromCharCode(dataView.getUint8(4 + i2));
    }
    return {
      name,
      length,
      offset
    };
  }
  _getHeaderBufferFromAtom(atom) {
    if (!atom || atom.length < 1 || !atom.name || !atom.data)
      throw new Error("Can not compute header buffer for this atom");
    const headerBuffer = new ArrayBuffer(ATOM_HEADER_LENGTH);
    const headerBufferView = new DataView(headerBuffer);
    headerBufferView.setUint32(0, atom.length);
    const nameChars = this._getCharCodes(atom.name);
    for (let i2 = 0; i2 < nameChars.length; i2++) {
      headerBufferView.setUint8(4 + i2, nameChars[i2]);
    }
    headerBufferView.setUint32(8, ATOM_DATA_HEAD_LENGTH + atom.data.byteLength);
    const dataNameChars = this._getCharCodes("data");
    for (let i2 = 0; i2 < dataNameChars.length; i2++) {
      headerBufferView.setUint8(12 + i2, dataNameChars[i2]);
    }
    headerBufferView.setUint32(16, this._getFlags(atom.name));
    return headerBuffer;
  }
  _getBufferFromString(input) {
    const buffer = new ArrayBuffer(input.length);
    const bufferView = new DataView(buffer);
    const chars = this._getCharCodes(input);
    for (let i2 = 0; i2 < chars.length; i2++) {
      bufferView.setUint8(i2, chars[i2]);
    }
    return buffer;
  }
  _getCharCodes(input) {
    const chars = [];
    for (let i2 = 0; i2 < input.length; i2++) {
      chars.push(input.charCodeAt(i2));
    }
    return chars;
  }
  _getFlags(name) {
    switch (name) {
      case "covr":
        return 13;
      case "trkn":
      case "disk":
        return 0;
      case "tmpo":
      case "cpil":
      case "rtng":
        return 21;
      default:
        return 1;
    }
  }
  // Helper method to create the metadata path if it doesn't exist
  _createMetadataPath() {
    try {
      this._logger.logDebug("Attempting to ensure metadata path moov > udta > meta > ilst exists.");
      const moovAtom = this._findAtom(this._atoms, ["moov"]);
      if (!moovAtom) {
        this._logError("Cannot create metadata path: Required 'moov' atom not found.");
        return null;
      }
      if (moovAtom.children === void 0) {
        moovAtom.children = this._readChildAtoms(moovAtom);
      }
      let currentParent = moovAtom;
      const pathSegments = ["udta", "meta", "ilst"];
      for (const segmentName of pathSegments) {
        let segmentAtom = this._findAtom(currentParent.children, [segmentName]);
        if (!segmentAtom) {
          this._logger.logDebug(`Creating missing '${segmentName}' atom.`);
          let newAtomOffset = currentParent.offset + this._getAtomHeaderLength(currentParent);
          if (currentParent.children.length > 0) {
            const lastChild = currentParent.children[currentParent.children.length - 1];
            newAtomOffset = lastChild.offset + lastChild.length;
          }
          const newAtomLength = this._getAtomHeaderLength({ name: segmentName });
          segmentAtom = {
            name: segmentName,
            length: newAtomLength,
            offset: newAtomOffset,
            // Placeholder offset, might not be perfectly sequential if gaps exist
            children: []
            // Initialize children array
          };
          currentParent.children.push(segmentAtom);
          this._logger.logDebug(`Created '${segmentName}' atom.`);
        } else {
          this._logger.logDebug(`Found existing '${segmentName}' atom.`);
          if (segmentAtom.children === void 0) {
            segmentAtom.children = this._readChildAtoms(segmentAtom);
          }
        }
        currentParent = segmentAtom;
      }
      this._logger.logDebug("Metadata path creation/verification successful. Returning 'ilst' atom.");
      return currentParent;
    } catch (error) {
      this._logError(`Failed during _createMetadataPath: ${error.message}`);
      return null;
    }
  }
  // Helper to get header length (including meta/stsd variations)
  _getAtomHeaderLength(atom) {
    let headLength = ATOM_HEAD_LENGTH;
    if (atom.name === "meta") {
      headLength += 4;
    } else if (atom.name === "stsd") {
      headLength += 8;
    }
    return headLength;
  }
}
class Mp4TagWriter {
  _originalBuffer;
  _mp4;
  _hasValidMp4 = false;
  // Track errors that have already been logged to avoid spamming console
  static _loggedErrors = /* @__PURE__ */ new Set();
  static _logger = Logger.create("MP4TagWriter", LogLevel.Debug);
  static _logError(message) {
    if (!Mp4TagWriter._loggedErrors.has(message)) {
      Mp4TagWriter._logger.logDebug(`MP4 metadata: ${message}`);
      Mp4TagWriter._loggedErrors.add(message);
    }
  }
  constructor(buffer) {
    try {
      this._originalBuffer = buffer.slice(0);
      Mp4TagWriter._logger.logDebug(`Creating Mp4TagWriter with buffer of size: ${this._originalBuffer.byteLength}`);
      try {
        this._mp4 = new Mp4(this._originalBuffer);
        this._mp4.parse();
        this._hasValidMp4 = this._mp4.hasValidMp4Structure;
        if (!this._hasValidMp4) {
          Mp4TagWriter._logError("MP4 structure validation failed. Tags will not be applied but original audio will still be saved.");
        } else {
          Mp4TagWriter._logger.logDebug("MP4 structure validation passed. TagWriter ready for use.");
        }
      } catch (parseError) {
        this._hasValidMp4 = false;
        Mp4TagWriter._logError(`Failed to initialize MP4 parser: ${parseError.message}`);
      }
    } catch (constructorError) {
      Mp4TagWriter._logError(`Mp4TagWriter constructor error: ${constructorError.message}`);
      this._originalBuffer = new ArrayBuffer(0);
      this._hasValidMp4 = false;
    }
  }
  setTitle(title) {
    try {
      if (!title) throw new Error("Invalid value for title");
      this._mp4.addMetadataAtom("\xA9nam", title);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set title: ${error.message}`);
    }
  }
  setArtists(artists) {
    try {
      if (!artists || artists.length < 1) throw new Error("Invalid value for artists");
      this._mp4.addMetadataAtom("\xA9ART", artists.join(", "));
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set artists: ${error.message}`);
    }
  }
  setAlbum(album) {
    try {
      if (!album) throw new Error("Invalid value for album");
      this._mp4.addMetadataAtom("\xA9alb", album);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set album: ${error.message}`);
    }
  }
  setComment(comment) {
    try {
      if (!comment) throw new Error("Invalid value for comment");
      this._mp4.addMetadataAtom("\xA9cmt", comment);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set comment: ${error.message}`);
    }
  }
  setTrackNumber(trackNumber) {
    try {
      if (trackNumber < 1 || trackNumber > 32767) throw new Error("Invalid value for trackNumber");
      this._mp4.addMetadataAtom("trkn", trackNumber);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set track number: ${error.message}`);
    }
  }
  setYear(year) {
    try {
      if (year < 1) throw new Error("Invalid value for year");
      this._mp4.addMetadataAtom("\xA9day", year.toString());
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set year: ${error.message}`);
    }
  }
  setGrouping(grouping) {
    try {
      if (!grouping) throw new Error("Invalid value for grouping");
      this._mp4.addMetadataAtom("\xA9grp", grouping);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set grouping: ${error.message}`);
    }
  }
  setArtwork(artworkBuffer) {
    try {
      if (!artworkBuffer || artworkBuffer.byteLength < 1) throw new Error("Invalid value for artworkBuffer");
      this._mp4.addMetadataAtom("covr", artworkBuffer);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set artwork: ${error.message}`);
    }
  }
  setDuration(duration) {
    try {
      if (duration < 1) throw new Error("Invalid value for duration");
      this._mp4.setDuration(duration);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set duration: ${error.message}`);
    }
  }
  getBuffer() {
    try {
      if (!this._originalBuffer || this._originalBuffer.byteLength === 0) {
        throw new Error("Original buffer is missing or empty");
      }
      if (!this._mp4 || !this._hasValidMp4) {
        Mp4TagWriter._logError(
          "MP4 structure check failed. Returning original buffer without applying tags."
        );
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0),
          // Create a fresh copy to avoid detached buffer issues
          tagsApplied: false,
          message: "Invalid MP4 structure for tagging."
        });
      }
      let processedBuffer;
      try {
        processedBuffer = this._mp4.getBuffer();
        if (!processedBuffer || processedBuffer.byteLength === 0) {
          throw new Error("Processed buffer is empty or null");
        }
        processedBuffer = processedBuffer.slice(0);
      } catch (bufferError) {
        Mp4TagWriter._logError(`Failed to get processed buffer: ${bufferError.message}`);
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0),
          // Create a fresh copy
          tagsApplied: false,
          message: `Failed to process MP4 buffer: ${bufferError.message}`
        });
      }
      let tagsSuccessfullyApplied = true;
      let message = void 0;
      if (processedBuffer.byteLength !== this._originalBuffer.byteLength) {
        tagsSuccessfullyApplied = true;
        message = `Successfully applied tags (original: ${this._originalBuffer.byteLength}, new: ${processedBuffer.byteLength})`;
      }
      return Promise.resolve({
        buffer: processedBuffer,
        tagsApplied: tagsSuccessfullyApplied,
        message
      });
    } catch (error) {
      const errorMessage = `Failed to get processed buffer: ${error.message}. Using original buffer as fallback.`;
      Mp4TagWriter._logError(errorMessage);
      try {
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0),
          tagsApplied: false,
          message: errorMessage
        });
      } catch (finalError) {
        Mp4TagWriter._logError(`CRITICAL: Failed to create copy of original buffer: ${finalError.message}`);
        return Promise.resolve({
          buffer: new ArrayBuffer(0),
          tagsApplied: false,
          message: `CRITICAL ERROR: ${errorMessage} + ${finalError.message}`
        });
      }
    }
  }
}
function escapeStringRegexp(string) {
  if (typeof string !== "string") {
    throw new TypeError("Expected a string");
  }
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
var ArtistType = /* @__PURE__ */ ((ArtistType2) => {
  ArtistType2[ArtistType2["Main"] = 0] = "Main";
  ArtistType2[ArtistType2["Feature"] = 1] = "Feature";
  ArtistType2[ArtistType2["Remixer"] = 2] = "Remixer";
  ArtistType2[ArtistType2["Producer"] = 3] = "Producer";
  return ArtistType2;
})(ArtistType || {});
var RemixType = /* @__PURE__ */ ((RemixType2) => {
  RemixType2[RemixType2["Remix"] = 0] = "Remix";
  RemixType2[RemixType2["Flip"] = 1] = "Flip";
  RemixType2[RemixType2["Bootleg"] = 2] = "Bootleg";
  RemixType2[RemixType2["Mashup"] = 3] = "Mashup";
  RemixType2[RemixType2["Edit"] = 4] = "Edit";
  return RemixType2;
})(RemixType || {});
function getRemixTypeFromString(input) {
  const loweredInput = input.toLowerCase().trim();
  switch (loweredInput) {
    case "flip":
      return 1;
    case "bootleg":
      return 2;
    case "mashup":
      return 3;
    case "edit":
      return 4;
    case "remix":
    default:
      return 0;
  }
}
function stableSort(input, prop) {
  const storedPositions = input.map((data, index) => ({
    data,
    index
  }));
  return storedPositions.sort((a2, b) => {
    if (a2.data[prop] < b.data[prop]) return -1;
    if (a2.data[prop] > b.data[prop]) return 1;
    return a2.index - b.index;
  }).map((i2) => i2.data);
}
class MetadataExtractor {
  constructor(title, username, userPermalink) {
    this.title = title;
    this.username = username;
    this.userPermalink = userPermalink;
  }
  static titleSeparators = ["-", "\u2013", "\u2014", "~"];
  static featureSeparators = ["featuring", "feat.", "feat", "ft.", " ft ", "w/", " w /", " w ", "+"];
  static combiningFeatureSeparators = [...MetadataExtractor.featureSeparators, ", ", " & ", " x "];
  static remixIndicators = ["remix", "flip", "bootleg", "mashup", "edit"];
  static producerIndicators = [
    "prod. by ",
    "prod by ",
    "prod. ",
    "p. ",
    "prod "
  ];
  static promotions = ["free download", "video in description", "video in desc", "vid in desc", "Original Mix"];
  getArtists() {
    const title = this.preprocessTitle(this.title);
    let artists = [];
    const titleSplit = this.splitByTitleSeparators(title, true);
    artists = artists.concat(
      titleSplit.artistNames.map((name, index) => ({
        name,
        type: index === 0 ? 0 : 1
        /* Feature */
      }))
    );
    const producerSplit = this.splitByProducer(titleSplit.title, true);
    artists = artists.concat(
      producerSplit.artistNames.map((name) => ({
        name,
        type: 3
        /* Producer */
      }))
    );
    const remixSplit = this.splitByRemix(producerSplit.title, true);
    artists = artists.concat(remixSplit.artists);
    const unsafeProducerSplit = this.splitByUnsafeProducers(remixSplit.title, true);
    artists = artists.concat(
      unsafeProducerSplit.artistNames.map((name) => ({
        name,
        type: 3
        /* Producer */
      }))
    );
    const featureSplit = this.splitByFeatures(remixSplit.title, true);
    artists = artists.concat(
      featureSplit.artistNames.map((name) => ({
        name,
        type: 1
        /* Feature */
      }))
    );
    const hasMainArtist = artists.some(
      (i2) => i2.type === 0
      /* Main */
    );
    if (!hasMainArtist) {
      const user = {
        name: this.sanitizeArtistName(this.username) || this.userPermalink,
        type: 0
        /* Main */
      };
      if (user.name) {
        if (artists.length > 0) {
          artists = [user, ...artists];
        } else {
          artists.push(user);
        }
      }
    }
    artists = artists.map((artist) => this.removeTwitterHandle(artist));
    const distinctArtists = [];
    for (const artist of artists) {
      if (distinctArtists.some((i2) => i2.name == artist.name)) continue;
      distinctArtists.push(artist);
    }
    return stableSort(distinctArtists, "type");
  }
  getTitle() {
    let title = this.preprocessTitle(this.title);
    title = this.splitByTitleSeparators(title, false).title;
    title = this.splitByProducer(title, false).title;
    title = this.splitByRemix(title, false).title;
    title = this.splitByFeatures(title, false).title;
    title = this.splitByUnsafeProducers(title, false).title;
    return this.sanitizeTitle(title);
  }
  removeTwitterHandle(artist) {
    artist.name = artist.name.replace(/^[@]+/, "");
    const result = /^([^(]+)\s?\(\s?@.+\)?$/.exec(artist.name);
    if (result && result.length > 1) {
      artist.name = result[1].trimEnd();
    }
    return artist;
  }
  splitByTitleSeparators(title, extractArtists) {
    let artistNames = [];
    if (this.includes(title, MetadataExtractor.titleSeparators)) {
      const separators = this.escapeRegexArray(MetadataExtractor.titleSeparators);
      const regex = new RegExp(`^((.+)\\s[${separators}]\\s)(.+)$`);
      const result = regex.exec(title);
      if (result && result.length > 0) {
        const [_, artistSection, artistString] = result;
        if (extractArtists) {
          artistNames = this.getArtistNames(artistString);
        }
        title = title.replace(artistSection, "");
      }
    }
    return {
      artistNames,
      title
    };
  }
  splitByFeatures(title, extractArtists) {
    let artistNames = [];
    if (this.includes(title, MetadataExtractor.featureSeparators)) {
      const separators = this.escapeRegexArray(MetadataExtractor.featureSeparators).join("|");
      const regex = new RegExp(`(?:${separators})([^\\[\\]\\(\\)]+)`, "i");
      const result = regex.exec(title);
      if (result && result.length > 0) {
        const [featureSection, artistsString] = result;
        if (extractArtists) {
          artistNames = this.getArtistNames(artistsString);
        }
        title = title.replace(featureSection, "");
      }
    }
    return {
      artistNames,
      title
    };
  }
  splitByProducer(title, extractArtists) {
    let artistNames = [];
    if (this.includes(title, MetadataExtractor.producerIndicators)) {
      const separators = this.escapeRegexArray(MetadataExtractor.producerIndicators).join("|");
      const regex = new RegExp(`(?:${separators})([^\\[\\]\\(\\)]+)`, "i");
      const result = regex.exec(title);
      if (result && result.length > 0) {
        const [producerSection, artistsString] = result;
        if (extractArtists) {
          artistNames = this.getArtistNames(artistsString);
        }
        title = title.replace(producerSection, "");
      }
    }
    return {
      artistNames,
      title
    };
  }
  splitByUnsafeProducers(title, extractArtists) {
    let artistNames = [];
    const featureSeparators = this.escapeRegexArray(MetadataExtractor.featureSeparators).join("|");
    const regex = new RegExp(`[\\(\\[](?!${featureSeparators})(.+)[\\)\\]]`, "i");
    const result = regex.exec(title);
    if (result && result.length > 0) {
      const [producerSection, artistsString] = result;
      if (extractArtists) {
        artistNames = this.getArtistNames(artistsString);
      }
      title = title.replace(producerSection, "");
    }
    return {
      artistNames,
      title
    };
  }
  splitByRemix(title, extractArtists) {
    let artists = [];
    if (this.includes(title, MetadataExtractor.remixIndicators)) {
      const separators = this.escapeRegexArray(MetadataExtractor.remixIndicators).join("|");
      const regex = new RegExp(`[\\[\\(](.+)(${separators})[\\]\\)]`, "i");
      const result = regex.exec(title);
      if (result && result.length > 0) {
        const [remixSection, artistsString, remixTypeString] = result;
        if (extractArtists) {
          const artistNames = this.getArtistNames(artistsString);
          const remixType = getRemixTypeFromString(remixTypeString);
          artists = artistNames.map((name) => ({
            name,
            type: 2,
            remixType
          }));
        }
        title = title.replace(remixSection, "");
      }
    }
    return {
      artists,
      title
    };
  }
  getArtistNames(input) {
    const separators = this.escapeRegexArray(MetadataExtractor.combiningFeatureSeparators).join("|");
    const regex = new RegExp(`(.+)\\s?(${separators})\\s?(.+)`, "i");
    const names = [];
    while (true) {
      const result = regex.exec(input);
      if (!result) {
        names.push(this.sanitizeArtistName(input));
        break;
      }
      names.push(this.sanitizeArtistName(result[3]));
      input = result[1];
    }
    return names.reverse();
  }
  preprocessTitle(input) {
    input = input.replace(/\+([+]+)/g, "+");
    const promotions = MetadataExtractor.promotions.join("|");
    const regex = new RegExp(`[\\[\\(]?\\s*(${promotions})\\s*[\\]\\)]?`, "i");
    return input.replace(regex, "");
  }
  sanitizeArtistName(input) {
    return this.removeNonAsciiCharacters(input).trim();
  }
  sanitizeTitle(input) {
    let sanitized = this.removeNonAsciiCharacters(input);
    sanitized = sanitized.replace("()", "").replace("[]", "");
    return sanitized.trim();
  }
  removeNonAsciiCharacters(input) {
    return XRegExp.replace(input, XRegExp("[^\\p{L}\\p{N}\\p{Zs}\0-\x7F]", "g"), "");
  }
  includes(input, separators) {
    const loweredInput = input.toLowerCase();
    return separators.some((separator) => loweredInput.includes(separator));
  }
  escapeRegexArray(input) {
    return input.map((i2) => escapeStringRegexp(i2));
  }
}
var Stream = /* @__PURE__ */ function() {
  function Stream2() {
    this.listeners = {};
  }
  var _proto = Stream2.prototype;
  _proto.on = function on(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  };
  _proto.off = function off(type, listener) {
    if (!this.listeners[type]) {
      return false;
    }
    var index = this.listeners[type].indexOf(listener);
    this.listeners[type] = this.listeners[type].slice(0);
    this.listeners[type].splice(index, 1);
    return index > -1;
  };
  _proto.trigger = function trigger(type) {
    var callbacks = this.listeners[type];
    if (!callbacks) {
      return;
    }
    if (arguments.length === 2) {
      var length = callbacks.length;
      for (var i2 = 0; i2 < length; ++i2) {
        callbacks[i2].call(this, arguments[1]);
      }
    } else {
      var args = Array.prototype.slice.call(arguments, 1);
      var _length = callbacks.length;
      for (var _i = 0; _i < _length; ++_i) {
        callbacks[_i].apply(this, args);
      }
    }
  };
  _proto.dispose = function dispose() {
    this.listeners = {};
  };
  _proto.pipe = function pipe(destination) {
    this.on("data", function(data) {
      destination.push(data);
    });
  };
  return Stream2;
}();
function _extends() {
  return _extends = Object.assign ? Object.assign.bind() : function(n2) {
    for (var e2 = 1; e2 < arguments.length; e2++) {
      var t2 = arguments[e2];
      for (var r2 in t2) ({}).hasOwnProperty.call(t2, r2) && (n2[r2] = t2[r2]);
    }
    return n2;
  }, _extends.apply(null, arguments);
}
var window_1;
var hasRequiredWindow;
function requireWindow() {
  if (hasRequiredWindow) return window_1;
  hasRequiredWindow = 1;
  var win;
  if (typeof window !== "undefined") {
    win = window;
  } else if (typeof commonjsGlobal !== "undefined") {
    win = commonjsGlobal;
  } else if (typeof self !== "undefined") {
    win = self;
  } else {
    win = {};
  }
  window_1 = win;
  return window_1;
}
var windowExports = requireWindow();
const window$1 = /* @__PURE__ */ getDefaultExportFromCjs(windowExports);
var atob = function atob2(s2) {
  return window$1.atob ? window$1.atob(s2) : Buffer.from(s2, "base64").toString("binary");
};
function decodeB64ToUint8Array(b64Text) {
  var decodedString = atob(b64Text);
  var array = new Uint8Array(decodedString.length);
  for (var i2 = 0; i2 < decodedString.length; i2++) {
    array[i2] = decodedString.charCodeAt(i2);
  }
  return array;
}
/*! @name m3u8-parser @version 7.2.0 @license Apache-2.0 */
class LineStream extends Stream {
  constructor() {
    super();
    this.buffer = "";
  }
  /**
   * Add new data to be parsed.
   *
   * @param {string} data the text to process
   */
  push(data) {
    let nextNewline;
    this.buffer += data;
    nextNewline = this.buffer.indexOf("\n");
    for (; nextNewline > -1; nextNewline = this.buffer.indexOf("\n")) {
      this.trigger("data", this.buffer.substring(0, nextNewline));
      this.buffer = this.buffer.substring(nextNewline + 1);
    }
  }
}
const TAB = String.fromCharCode(9);
const parseByterange = function(byterangeString) {
  const match = /([0-9.]*)?@?([0-9.]*)?/.exec(byterangeString || "");
  const result = {};
  if (match[1]) {
    result.length = parseInt(match[1], 10);
  }
  if (match[2]) {
    result.offset = parseInt(match[2], 10);
  }
  return result;
};
const attributeSeparator = function() {
  const key = "[^=]*";
  const value = '"[^"]*"|[^,]*';
  const keyvalue = "(?:" + key + ")=(?:" + value + ")";
  return new RegExp("(?:^|,)(" + keyvalue + ")");
};
const parseAttributes = function(attributes) {
  const result = {};
  if (!attributes) {
    return result;
  }
  const attrs = attributes.split(attributeSeparator());
  let i2 = attrs.length;
  let attr;
  while (i2--) {
    if (attrs[i2] === "") {
      continue;
    }
    attr = /([^=]*)=(.*)/.exec(attrs[i2]).slice(1);
    attr[0] = attr[0].replace(/^\s+|\s+$/g, "");
    attr[1] = attr[1].replace(/^\s+|\s+$/g, "");
    attr[1] = attr[1].replace(/^['"](.*)['"]$/g, "$1");
    result[attr[0]] = attr[1];
  }
  return result;
};
const parseResolution = (resolution) => {
  const split = resolution.split("x");
  const result = {};
  if (split[0]) {
    result.width = parseInt(split[0], 10);
  }
  if (split[1]) {
    result.height = parseInt(split[1], 10);
  }
  return result;
};
class ParseStream extends Stream {
  constructor() {
    super();
    this.customParsers = [];
    this.tagMappers = [];
  }
  /**
   * Parses an additional line of input.
   *
   * @param {string} line a single line of an M3U8 file to parse
   */
  push(line) {
    let match;
    let event;
    line = line.trim();
    if (line.length === 0) {
      return;
    }
    if (line[0] !== "#") {
      this.trigger("data", {
        type: "uri",
        uri: line
      });
      return;
    }
    const newLines = this.tagMappers.reduce((acc, mapper) => {
      const mappedLine = mapper(line);
      if (mappedLine === line) {
        return acc;
      }
      return acc.concat([mappedLine]);
    }, [line]);
    newLines.forEach((newLine) => {
      for (let i2 = 0; i2 < this.customParsers.length; i2++) {
        if (this.customParsers[i2].call(this, newLine)) {
          return;
        }
      }
      if (newLine.indexOf("#EXT") !== 0) {
        this.trigger("data", {
          type: "comment",
          text: newLine.slice(1)
        });
        return;
      }
      newLine = newLine.replace("\r", "");
      match = /^#EXTM3U/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "m3u"
        });
        return;
      }
      match = /^#EXTINF:([0-9\.]*)?,?(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "inf"
        };
        if (match[1]) {
          event.duration = parseFloat(match[1]);
        }
        if (match[2]) {
          event.title = match[2];
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-TARGETDURATION:([0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "targetduration"
        };
        if (match[1]) {
          event.duration = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-VERSION:([0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "version"
        };
        if (match[1]) {
          event.version = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MEDIA-SEQUENCE:(\-?[0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "media-sequence"
        };
        if (match[1]) {
          event.number = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DISCONTINUITY-SEQUENCE:(\-?[0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "discontinuity-sequence"
        };
        if (match[1]) {
          event.number = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PLAYLIST-TYPE:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "playlist-type"
        };
        if (match[1]) {
          event.playlistType = match[1];
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-BYTERANGE:(.*)?$/.exec(newLine);
      if (match) {
        event = _extends(parseByterange(match[1]), {
          type: "tag",
          tagType: "byterange"
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-ALLOW-CACHE:(YES|NO)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "allow-cache"
        };
        if (match[1]) {
          event.allowed = !/NO/.test(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MAP:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "map"
        };
        if (match[1]) {
          const attributes = parseAttributes(match[1]);
          if (attributes.URI) {
            event.uri = attributes.URI;
          }
          if (attributes.BYTERANGE) {
            event.byterange = parseByterange(attributes.BYTERANGE);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-STREAM-INF:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "stream-inf"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          if (event.attributes.RESOLUTION) {
            event.attributes.RESOLUTION = parseResolution(event.attributes.RESOLUTION);
          }
          if (event.attributes.BANDWIDTH) {
            event.attributes.BANDWIDTH = parseInt(event.attributes.BANDWIDTH, 10);
          }
          if (event.attributes["FRAME-RATE"]) {
            event.attributes["FRAME-RATE"] = parseFloat(event.attributes["FRAME-RATE"]);
          }
          if (event.attributes["PROGRAM-ID"]) {
            event.attributes["PROGRAM-ID"] = parseInt(event.attributes["PROGRAM-ID"], 10);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MEDIA:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "media"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-ENDLIST/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "endlist"
        });
        return;
      }
      match = /^#EXT-X-DISCONTINUITY/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "discontinuity"
        });
        return;
      }
      match = /^#EXT-X-PROGRAM-DATE-TIME:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "program-date-time"
        };
        if (match[1]) {
          event.dateTimeString = match[1];
          event.dateTimeObject = new Date(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-KEY:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "key"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          if (event.attributes.IV) {
            if (event.attributes.IV.substring(0, 2).toLowerCase() === "0x") {
              event.attributes.IV = event.attributes.IV.substring(2);
            }
            event.attributes.IV = event.attributes.IV.match(/.{8}/g);
            event.attributes.IV[0] = parseInt(event.attributes.IV[0], 16);
            event.attributes.IV[1] = parseInt(event.attributes.IV[1], 16);
            event.attributes.IV[2] = parseInt(event.attributes.IV[2], 16);
            event.attributes.IV[3] = parseInt(event.attributes.IV[3], 16);
            event.attributes.IV = new Uint32Array(event.attributes.IV);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-START:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "start"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          event.attributes["TIME-OFFSET"] = parseFloat(event.attributes["TIME-OFFSET"]);
          event.attributes.PRECISE = /YES/.test(event.attributes.PRECISE);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-OUT-CONT:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-out-cont"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-OUT:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-out"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-IN:?(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-in"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-SKIP:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "skip"
        };
        event.attributes = parseAttributes(match[1]);
        if (event.attributes.hasOwnProperty("SKIPPED-SEGMENTS")) {
          event.attributes["SKIPPED-SEGMENTS"] = parseInt(event.attributes["SKIPPED-SEGMENTS"], 10);
        }
        if (event.attributes.hasOwnProperty("RECENTLY-REMOVED-DATERANGES")) {
          event.attributes["RECENTLY-REMOVED-DATERANGES"] = event.attributes["RECENTLY-REMOVED-DATERANGES"].split(TAB);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PART:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "part"
        };
        event.attributes = parseAttributes(match[1]);
        ["DURATION"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["INDEPENDENT", "GAP"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/.test(event.attributes[key]);
          }
        });
        if (event.attributes.hasOwnProperty("BYTERANGE")) {
          event.attributes.byterange = parseByterange(event.attributes.BYTERANGE);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-SERVER-CONTROL:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "server-control"
        };
        event.attributes = parseAttributes(match[1]);
        ["CAN-SKIP-UNTIL", "PART-HOLD-BACK", "HOLD-BACK"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["CAN-SKIP-DATERANGES", "CAN-BLOCK-RELOAD"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/.test(event.attributes[key]);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PART-INF:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "part-inf"
        };
        event.attributes = parseAttributes(match[1]);
        ["PART-TARGET"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PRELOAD-HINT:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "preload-hint"
        };
        event.attributes = parseAttributes(match[1]);
        ["BYTERANGE-START", "BYTERANGE-LENGTH"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseInt(event.attributes[key], 10);
            const subkey = key === "BYTERANGE-LENGTH" ? "length" : "offset";
            event.attributes.byterange = event.attributes.byterange || {};
            event.attributes.byterange[subkey] = event.attributes[key];
            delete event.attributes[key];
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-RENDITION-REPORT:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "rendition-report"
        };
        event.attributes = parseAttributes(match[1]);
        ["LAST-MSN", "LAST-PART"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseInt(event.attributes[key], 10);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DATERANGE:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "daterange"
        };
        event.attributes = parseAttributes(match[1]);
        ["ID", "CLASS"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = String(event.attributes[key]);
          }
        });
        ["START-DATE", "END-DATE"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = new Date(event.attributes[key]);
          }
        });
        ["DURATION", "PLANNED-DURATION"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["END-ON-NEXT"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/i.test(event.attributes[key]);
          }
        });
        ["SCTE35-CMD", " SCTE35-OUT", "SCTE35-IN"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = event.attributes[key].toString(16);
          }
        });
        const clientAttributePattern = /^X-([A-Z]+-)+[A-Z]+$/;
        for (const key in event.attributes) {
          if (!clientAttributePattern.test(key)) {
            continue;
          }
          const isHexaDecimal = /[0-9A-Fa-f]{6}/g.test(event.attributes[key]);
          const isDecimalFloating = /^\d+(\.\d+)?$/.test(event.attributes[key]);
          event.attributes[key] = isHexaDecimal ? event.attributes[key].toString(16) : isDecimalFloating ? parseFloat(event.attributes[key]) : String(event.attributes[key]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-INDEPENDENT-SEGMENTS/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "independent-segments"
        });
        return;
      }
      match = /^#EXT-X-I-FRAMES-ONLY/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "i-frames-only"
        });
        return;
      }
      match = /^#EXT-X-CONTENT-STEERING:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "content-steering"
        };
        event.attributes = parseAttributes(match[1]);
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-I-FRAME-STREAM-INF:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "i-frame-playlist"
        };
        event.attributes = parseAttributes(match[1]);
        if (event.attributes.URI) {
          event.uri = event.attributes.URI;
        }
        if (event.attributes.BANDWIDTH) {
          event.attributes.BANDWIDTH = parseInt(event.attributes.BANDWIDTH, 10);
        }
        if (event.attributes.RESOLUTION) {
          event.attributes.RESOLUTION = parseResolution(event.attributes.RESOLUTION);
        }
        if (event.attributes["AVERAGE-BANDWIDTH"]) {
          event.attributes["AVERAGE-BANDWIDTH"] = parseInt(event.attributes["AVERAGE-BANDWIDTH"], 10);
        }
        if (event.attributes["FRAME-RATE"]) {
          event.attributes["FRAME-RATE"] = parseFloat(event.attributes["FRAME-RATE"]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DEFINE:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "define"
        };
        event.attributes = parseAttributes(match[1]);
        this.trigger("data", event);
        return;
      }
      this.trigger("data", {
        type: "tag",
        data: newLine.slice(4)
      });
    });
  }
  /**
   * Add a parser for custom headers
   *
   * @param {Object}   options              a map of options for the added parser
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {string}   options.customType   the custom type to register to the output
   * @param {Function} [options.dataParser] function to parse the line into an object
   * @param {boolean}  [options.segment]    should tag data be attached to the segment object
   */
  addParser({
    expression,
    customType,
    dataParser,
    segment
  }) {
    if (typeof dataParser !== "function") {
      dataParser = (line) => line;
    }
    this.customParsers.push((line) => {
      const match = expression.exec(line);
      if (match) {
        this.trigger("data", {
          type: "custom",
          data: dataParser(line),
          customType,
          segment
        });
        return true;
      }
    });
  }
  /**
   * Add a custom header mapper
   *
   * @param {Object}   options
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {Function} options.map          function to translate tag into a different tag
   */
  addTagMapper({
    expression,
    map
  }) {
    const mapFn = (line) => {
      if (expression.test(line)) {
        return map(line);
      }
      return line;
    };
    this.tagMappers.push(mapFn);
  }
}
const camelCase = (str) => str.toLowerCase().replace(/-(\w)/g, (a2) => a2[1].toUpperCase());
const camelCaseKeys = function(attributes) {
  const result = {};
  Object.keys(attributes).forEach(function(key) {
    result[camelCase(key)] = attributes[key];
  });
  return result;
};
const setHoldBack = function(manifest2) {
  const {
    serverControl,
    targetDuration,
    partTargetDuration
  } = manifest2;
  if (!serverControl) {
    return;
  }
  const tag = "#EXT-X-SERVER-CONTROL";
  const hb = "holdBack";
  const phb = "partHoldBack";
  const minTargetDuration = targetDuration && targetDuration * 3;
  const minPartDuration = partTargetDuration && partTargetDuration * 2;
  if (targetDuration && !serverControl.hasOwnProperty(hb)) {
    serverControl[hb] = minTargetDuration;
    this.trigger("info", {
      message: `${tag} defaulting HOLD-BACK to targetDuration * 3 (${minTargetDuration}).`
    });
  }
  if (minTargetDuration && serverControl[hb] < minTargetDuration) {
    this.trigger("warn", {
      message: `${tag} clamping HOLD-BACK (${serverControl[hb]}) to targetDuration * 3 (${minTargetDuration})`
    });
    serverControl[hb] = minTargetDuration;
  }
  if (partTargetDuration && !serverControl.hasOwnProperty(phb)) {
    serverControl[phb] = partTargetDuration * 3;
    this.trigger("info", {
      message: `${tag} defaulting PART-HOLD-BACK to partTargetDuration * 3 (${serverControl[phb]}).`
    });
  }
  if (partTargetDuration && serverControl[phb] < minPartDuration) {
    this.trigger("warn", {
      message: `${tag} clamping PART-HOLD-BACK (${serverControl[phb]}) to partTargetDuration * 2 (${minPartDuration}).`
    });
    serverControl[phb] = minPartDuration;
  }
};
class Parser extends Stream {
  constructor(opts = {}) {
    super();
    this.lineStream = new LineStream();
    this.parseStream = new ParseStream();
    this.lineStream.pipe(this.parseStream);
    this.mainDefinitions = opts.mainDefinitions || {};
    this.params = new URL(opts.uri, "https://a.com").searchParams;
    this.lastProgramDateTime = null;
    const self2 = this;
    const uris = [];
    let currentUri = {};
    let currentMap;
    let key;
    let hasParts = false;
    const noop = function() {
    };
    const defaultMediaGroups = {
      "AUDIO": {},
      "VIDEO": {},
      "CLOSED-CAPTIONS": {},
      "SUBTITLES": {}
    };
    const widevineUuid = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
    let currentTimeline = 0;
    this.manifest = {
      allowCache: true,
      discontinuityStarts: [],
      dateRanges: [],
      iFramePlaylists: [],
      segments: []
    };
    let lastByterangeEnd = 0;
    let lastPartByterangeEnd = 0;
    const dateRangeTags = {};
    this.on("end", () => {
      if (currentUri.uri || !currentUri.parts && !currentUri.preloadHints) {
        return;
      }
      if (!currentUri.map && currentMap) {
        currentUri.map = currentMap;
      }
      if (!currentUri.key && key) {
        currentUri.key = key;
      }
      if (!currentUri.timeline && typeof currentTimeline === "number") {
        currentUri.timeline = currentTimeline;
      }
      this.manifest.preloadSegment = currentUri;
    });
    this.parseStream.on("data", function(entry) {
      let mediaGroup;
      let rendition;
      if (self2.manifest.definitions) {
        for (const def in self2.manifest.definitions) {
          if (entry.uri) {
            entry.uri = entry.uri.replace(`{$${def}}`, self2.manifest.definitions[def]);
          }
          if (entry.attributes) {
            for (const attr in entry.attributes) {
              if (typeof entry.attributes[attr] === "string") {
                entry.attributes[attr] = entry.attributes[attr].replace(`{$${def}}`, self2.manifest.definitions[def]);
              }
            }
          }
        }
      }
      ({
        tag() {
          ({
            version() {
              if (entry.version) {
                this.manifest.version = entry.version;
              }
            },
            "allow-cache"() {
              this.manifest.allowCache = entry.allowed;
              if (!("allowed" in entry)) {
                this.trigger("info", {
                  message: "defaulting allowCache to YES"
                });
                this.manifest.allowCache = true;
              }
            },
            byterange() {
              const byterange = {};
              if ("length" in entry) {
                currentUri.byterange = byterange;
                byterange.length = entry.length;
                if (!("offset" in entry)) {
                  entry.offset = lastByterangeEnd;
                }
              }
              if ("offset" in entry) {
                currentUri.byterange = byterange;
                byterange.offset = entry.offset;
              }
              lastByterangeEnd = byterange.offset + byterange.length;
            },
            endlist() {
              this.manifest.endList = true;
            },
            inf() {
              if (!("mediaSequence" in this.manifest)) {
                this.manifest.mediaSequence = 0;
                this.trigger("info", {
                  message: "defaulting media sequence to zero"
                });
              }
              if (!("discontinuitySequence" in this.manifest)) {
                this.manifest.discontinuitySequence = 0;
                this.trigger("info", {
                  message: "defaulting discontinuity sequence to zero"
                });
              }
              if (entry.title) {
                currentUri.title = entry.title;
              }
              if (entry.duration > 0) {
                currentUri.duration = entry.duration;
              }
              if (entry.duration === 0) {
                currentUri.duration = 0.01;
                this.trigger("info", {
                  message: "updating zero segment duration to a small value"
                });
              }
              this.manifest.segments = uris;
            },
            key() {
              if (!entry.attributes) {
                this.trigger("warn", {
                  message: "ignoring key declaration without attribute list"
                });
                return;
              }
              if (entry.attributes.METHOD === "NONE") {
                key = null;
                return;
              }
              if (!entry.attributes.URI) {
                this.trigger("warn", {
                  message: "ignoring key declaration without URI"
                });
                return;
              }
              if (entry.attributes.KEYFORMAT === "com.apple.streamingkeydelivery") {
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.apple.fps.1_0"] = {
                  attributes: entry.attributes
                };
                return;
              }
              if (entry.attributes.KEYFORMAT === "com.microsoft.playready") {
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.microsoft.playready"] = {
                  uri: entry.attributes.URI
                };
                return;
              }
              if (entry.attributes.KEYFORMAT === widevineUuid) {
                const VALID_METHODS = ["SAMPLE-AES", "SAMPLE-AES-CTR", "SAMPLE-AES-CENC"];
                if (VALID_METHODS.indexOf(entry.attributes.METHOD) === -1) {
                  this.trigger("warn", {
                    message: "invalid key method provided for Widevine"
                  });
                  return;
                }
                if (entry.attributes.METHOD === "SAMPLE-AES-CENC") {
                  this.trigger("warn", {
                    message: "SAMPLE-AES-CENC is deprecated, please use SAMPLE-AES-CTR instead"
                  });
                }
                if (entry.attributes.URI.substring(0, 23) !== "data:text/plain;base64,") {
                  this.trigger("warn", {
                    message: "invalid key URI provided for Widevine"
                  });
                  return;
                }
                if (!(entry.attributes.KEYID && entry.attributes.KEYID.substring(0, 2) === "0x")) {
                  this.trigger("warn", {
                    message: "invalid key ID provided for Widevine"
                  });
                  return;
                }
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.widevine.alpha"] = {
                  attributes: {
                    schemeIdUri: entry.attributes.KEYFORMAT,
                    // remove '0x' from the key id string
                    keyId: entry.attributes.KEYID.substring(2)
                  },
                  // decode the base64-encoded PSSH box
                  pssh: decodeB64ToUint8Array(entry.attributes.URI.split(",")[1])
                };
                return;
              }
              if (!entry.attributes.METHOD) {
                this.trigger("warn", {
                  message: "defaulting key method to AES-128"
                });
              }
              key = {
                method: entry.attributes.METHOD || "AES-128",
                uri: entry.attributes.URI
              };
              if (typeof entry.attributes.IV !== "undefined") {
                key.iv = entry.attributes.IV;
              }
            },
            "media-sequence"() {
              if (!isFinite(entry.number)) {
                this.trigger("warn", {
                  message: "ignoring invalid media sequence: " + entry.number
                });
                return;
              }
              this.manifest.mediaSequence = entry.number;
            },
            "discontinuity-sequence"() {
              if (!isFinite(entry.number)) {
                this.trigger("warn", {
                  message: "ignoring invalid discontinuity sequence: " + entry.number
                });
                return;
              }
              this.manifest.discontinuitySequence = entry.number;
              currentTimeline = entry.number;
            },
            "playlist-type"() {
              if (!/VOD|EVENT/.test(entry.playlistType)) {
                this.trigger("warn", {
                  message: "ignoring unknown playlist type: " + entry.playlist
                });
                return;
              }
              this.manifest.playlistType = entry.playlistType;
            },
            map() {
              currentMap = {};
              if (entry.uri) {
                currentMap.uri = entry.uri;
              }
              if (entry.byterange) {
                currentMap.byterange = entry.byterange;
              }
              if (key) {
                currentMap.key = key;
              }
            },
            "stream-inf"() {
              this.manifest.playlists = uris;
              this.manifest.mediaGroups = this.manifest.mediaGroups || defaultMediaGroups;
              if (!entry.attributes) {
                this.trigger("warn", {
                  message: "ignoring empty stream-inf attributes"
                });
                return;
              }
              if (!currentUri.attributes) {
                currentUri.attributes = {};
              }
              _extends(currentUri.attributes, entry.attributes);
            },
            media() {
              this.manifest.mediaGroups = this.manifest.mediaGroups || defaultMediaGroups;
              if (!(entry.attributes && entry.attributes.TYPE && entry.attributes["GROUP-ID"] && entry.attributes.NAME)) {
                this.trigger("warn", {
                  message: "ignoring incomplete or missing media group"
                });
                return;
              }
              const mediaGroupType = this.manifest.mediaGroups[entry.attributes.TYPE];
              mediaGroupType[entry.attributes["GROUP-ID"]] = mediaGroupType[entry.attributes["GROUP-ID"]] || {};
              mediaGroup = mediaGroupType[entry.attributes["GROUP-ID"]];
              rendition = {
                default: /yes/i.test(entry.attributes.DEFAULT)
              };
              if (rendition.default) {
                rendition.autoselect = true;
              } else {
                rendition.autoselect = /yes/i.test(entry.attributes.AUTOSELECT);
              }
              if (entry.attributes.LANGUAGE) {
                rendition.language = entry.attributes.LANGUAGE;
              }
              if (entry.attributes.URI) {
                rendition.uri = entry.attributes.URI;
              }
              if (entry.attributes["INSTREAM-ID"]) {
                rendition.instreamId = entry.attributes["INSTREAM-ID"];
              }
              if (entry.attributes.CHARACTERISTICS) {
                rendition.characteristics = entry.attributes.CHARACTERISTICS;
              }
              if (entry.attributes.FORCED) {
                rendition.forced = /yes/i.test(entry.attributes.FORCED);
              }
              mediaGroup[entry.attributes.NAME] = rendition;
            },
            discontinuity() {
              currentTimeline += 1;
              currentUri.discontinuity = true;
              this.manifest.discontinuityStarts.push(uris.length);
            },
            "program-date-time"() {
              if (typeof this.manifest.dateTimeString === "undefined") {
                this.manifest.dateTimeString = entry.dateTimeString;
                this.manifest.dateTimeObject = entry.dateTimeObject;
              }
              currentUri.dateTimeString = entry.dateTimeString;
              currentUri.dateTimeObject = entry.dateTimeObject;
              const {
                lastProgramDateTime
              } = this;
              this.lastProgramDateTime = new Date(entry.dateTimeString).getTime();
              if (lastProgramDateTime === null) {
                this.manifest.segments.reduceRight((programDateTime, segment) => {
                  segment.programDateTime = programDateTime - segment.duration * 1e3;
                  return segment.programDateTime;
                }, this.lastProgramDateTime);
              }
            },
            targetduration() {
              if (!isFinite(entry.duration) || entry.duration < 0) {
                this.trigger("warn", {
                  message: "ignoring invalid target duration: " + entry.duration
                });
                return;
              }
              this.manifest.targetDuration = entry.duration;
              setHoldBack.call(this, this.manifest);
            },
            start() {
              if (!entry.attributes || isNaN(entry.attributes["TIME-OFFSET"])) {
                this.trigger("warn", {
                  message: "ignoring start declaration without appropriate attribute list"
                });
                return;
              }
              this.manifest.start = {
                timeOffset: entry.attributes["TIME-OFFSET"],
                precise: entry.attributes.PRECISE
              };
            },
            "cue-out"() {
              currentUri.cueOut = entry.data;
            },
            "cue-out-cont"() {
              currentUri.cueOutCont = entry.data;
            },
            "cue-in"() {
              currentUri.cueIn = entry.data;
            },
            "skip"() {
              this.manifest.skip = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-SKIP", entry.attributes, ["SKIPPED-SEGMENTS"]);
            },
            "part"() {
              hasParts = true;
              const segmentIndex = this.manifest.segments.length;
              const part = camelCaseKeys(entry.attributes);
              currentUri.parts = currentUri.parts || [];
              currentUri.parts.push(part);
              if (part.byterange) {
                if (!part.byterange.hasOwnProperty("offset")) {
                  part.byterange.offset = lastPartByterangeEnd;
                }
                lastPartByterangeEnd = part.byterange.offset + part.byterange.length;
              }
              const partIndex = currentUri.parts.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-PART #${partIndex} for segment #${segmentIndex}`, entry.attributes, ["URI", "DURATION"]);
              if (this.manifest.renditionReports) {
                this.manifest.renditionReports.forEach((r2, i2) => {
                  if (!r2.hasOwnProperty("lastPart")) {
                    this.trigger("warn", {
                      message: `#EXT-X-RENDITION-REPORT #${i2} lacks required attribute(s): LAST-PART`
                    });
                  }
                });
              }
            },
            "server-control"() {
              const attrs = this.manifest.serverControl = camelCaseKeys(entry.attributes);
              if (!attrs.hasOwnProperty("canBlockReload")) {
                attrs.canBlockReload = false;
                this.trigger("info", {
                  message: "#EXT-X-SERVER-CONTROL defaulting CAN-BLOCK-RELOAD to false"
                });
              }
              setHoldBack.call(this, this.manifest);
              if (attrs.canSkipDateranges && !attrs.hasOwnProperty("canSkipUntil")) {
                this.trigger("warn", {
                  message: "#EXT-X-SERVER-CONTROL lacks required attribute CAN-SKIP-UNTIL which is required when CAN-SKIP-DATERANGES is set"
                });
              }
            },
            "preload-hint"() {
              const segmentIndex = this.manifest.segments.length;
              const hint = camelCaseKeys(entry.attributes);
              const isPart = hint.type && hint.type === "PART";
              currentUri.preloadHints = currentUri.preloadHints || [];
              currentUri.preloadHints.push(hint);
              if (hint.byterange) {
                if (!hint.byterange.hasOwnProperty("offset")) {
                  hint.byterange.offset = isPart ? lastPartByterangeEnd : 0;
                  if (isPart) {
                    lastPartByterangeEnd = hint.byterange.offset + hint.byterange.length;
                  }
                }
              }
              const index = currentUri.preloadHints.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-PRELOAD-HINT #${index} for segment #${segmentIndex}`, entry.attributes, ["TYPE", "URI"]);
              if (!hint.type) {
                return;
              }
              for (let i2 = 0; i2 < currentUri.preloadHints.length - 1; i2++) {
                const otherHint = currentUri.preloadHints[i2];
                if (!otherHint.type) {
                  continue;
                }
                if (otherHint.type === hint.type) {
                  this.trigger("warn", {
                    message: `#EXT-X-PRELOAD-HINT #${index} for segment #${segmentIndex} has the same TYPE ${hint.type} as preload hint #${i2}`
                  });
                }
              }
            },
            "rendition-report"() {
              const report = camelCaseKeys(entry.attributes);
              this.manifest.renditionReports = this.manifest.renditionReports || [];
              this.manifest.renditionReports.push(report);
              const index = this.manifest.renditionReports.length - 1;
              const required = ["LAST-MSN", "URI"];
              if (hasParts) {
                required.push("LAST-PART");
              }
              this.warnOnMissingAttributes_(`#EXT-X-RENDITION-REPORT #${index}`, entry.attributes, required);
            },
            "part-inf"() {
              this.manifest.partInf = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-PART-INF", entry.attributes, ["PART-TARGET"]);
              if (this.manifest.partInf.partTarget) {
                this.manifest.partTargetDuration = this.manifest.partInf.partTarget;
              }
              setHoldBack.call(this, this.manifest);
            },
            "daterange"() {
              this.manifest.dateRanges.push(camelCaseKeys(entry.attributes));
              const index = this.manifest.dateRanges.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-DATERANGE #${index}`, entry.attributes, ["ID", "START-DATE"]);
              const dateRange = this.manifest.dateRanges[index];
              if (dateRange.endDate && dateRange.startDate && new Date(dateRange.endDate) < new Date(dateRange.startDate)) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE END-DATE must be equal to or later than the value of the START-DATE"
                });
              }
              if (dateRange.duration && dateRange.duration < 0) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE DURATION must not be negative"
                });
              }
              if (dateRange.plannedDuration && dateRange.plannedDuration < 0) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE PLANNED-DURATION must not be negative"
                });
              }
              const endOnNextYes = !!dateRange.endOnNext;
              if (endOnNextYes && !dateRange.class) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must have a CLASS attribute"
                });
              }
              if (endOnNextYes && (dateRange.duration || dateRange.endDate)) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must not contain DURATION or END-DATE attributes"
                });
              }
              if (dateRange.duration && dateRange.endDate) {
                const startDate = dateRange.startDate;
                const newDateInSeconds = startDate.getTime() + dateRange.duration * 1e3;
                this.manifest.dateRanges[index].endDate = new Date(newDateInSeconds);
              }
              if (!dateRangeTags[dateRange.id]) {
                dateRangeTags[dateRange.id] = dateRange;
              } else {
                for (const attribute in dateRangeTags[dateRange.id]) {
                  if (!!dateRange[attribute] && JSON.stringify(dateRangeTags[dateRange.id][attribute]) !== JSON.stringify(dateRange[attribute])) {
                    this.trigger("warn", {
                      message: "EXT-X-DATERANGE tags with the same ID in a playlist must have the same attributes values"
                    });
                    break;
                  }
                }
                const dateRangeWithSameId = this.manifest.dateRanges.findIndex((dateRangeToFind) => dateRangeToFind.id === dateRange.id);
                this.manifest.dateRanges[dateRangeWithSameId] = _extends(this.manifest.dateRanges[dateRangeWithSameId], dateRange);
                dateRangeTags[dateRange.id] = _extends(dateRangeTags[dateRange.id], dateRange);
                this.manifest.dateRanges.pop();
              }
            },
            "independent-segments"() {
              this.manifest.independentSegments = true;
            },
            "i-frames-only"() {
              this.manifest.iFramesOnly = true;
              this.requiredCompatibilityversion(this.manifest.version, 4);
            },
            "content-steering"() {
              this.manifest.contentSteering = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-CONTENT-STEERING", entry.attributes, ["SERVER-URI"]);
            },
            /** @this {Parser} */
            define() {
              this.manifest.definitions = this.manifest.definitions || {};
              const addDef = (n2, v) => {
                if (n2 in this.manifest.definitions) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: Duplicate name ${n2}`
                  });
                  return;
                }
                this.manifest.definitions[n2] = v;
              };
              if ("QUERYPARAM" in entry.attributes) {
                if ("NAME" in entry.attributes || "IMPORT" in entry.attributes) {
                  this.trigger("error", {
                    message: "EXT-X-DEFINE: Invalid attributes"
                  });
                  return;
                }
                const val = this.params.get(entry.attributes.QUERYPARAM);
                if (!val) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No query param ${entry.attributes.QUERYPARAM}`
                  });
                  return;
                }
                addDef(entry.attributes.QUERYPARAM, decodeURIComponent(val));
                return;
              }
              if ("NAME" in entry.attributes) {
                if ("IMPORT" in entry.attributes) {
                  this.trigger("error", {
                    message: "EXT-X-DEFINE: Invalid attributes"
                  });
                  return;
                }
                if (!("VALUE" in entry.attributes) || typeof entry.attributes.VALUE !== "string") {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No value for ${entry.attributes.NAME}`
                  });
                  return;
                }
                addDef(entry.attributes.NAME, entry.attributes.VALUE);
                return;
              }
              if ("IMPORT" in entry.attributes) {
                if (!this.mainDefinitions[entry.attributes.IMPORT]) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No value ${entry.attributes.IMPORT} to import, or IMPORT used on main playlist`
                  });
                  return;
                }
                addDef(entry.attributes.IMPORT, this.mainDefinitions[entry.attributes.IMPORT]);
                return;
              }
              this.trigger("error", {
                message: "EXT-X-DEFINE: No attribute"
              });
            },
            "i-frame-playlist"() {
              this.manifest.iFramePlaylists.push({
                attributes: entry.attributes,
                uri: entry.uri,
                timeline: currentTimeline
              });
              this.warnOnMissingAttributes_("#EXT-X-I-FRAME-STREAM-INF", entry.attributes, ["BANDWIDTH", "URI"]);
            }
          }[entry.tagType] || noop).call(self2);
        },
        uri() {
          currentUri.uri = entry.uri;
          uris.push(currentUri);
          if (this.manifest.targetDuration && !("duration" in currentUri)) {
            this.trigger("warn", {
              message: "defaulting segment duration to the target duration"
            });
            currentUri.duration = this.manifest.targetDuration;
          }
          if (key) {
            currentUri.key = key;
          }
          currentUri.timeline = currentTimeline;
          if (currentMap) {
            currentUri.map = currentMap;
          }
          lastPartByterangeEnd = 0;
          if (this.lastProgramDateTime !== null) {
            currentUri.programDateTime = this.lastProgramDateTime;
            this.lastProgramDateTime += currentUri.duration * 1e3;
          }
          currentUri = {};
        },
        comment() {
        },
        custom() {
          if (entry.segment) {
            currentUri.custom = currentUri.custom || {};
            currentUri.custom[entry.customType] = entry.data;
          } else {
            this.manifest.custom = this.manifest.custom || {};
            this.manifest.custom[entry.customType] = entry.data;
          }
        }
      })[entry.type].call(self2);
    });
  }
  requiredCompatibilityversion(currentVersion, targetVersion) {
    if (currentVersion < targetVersion || !currentVersion) {
      this.trigger("warn", {
        message: `manifest must be at least version ${targetVersion}`
      });
    }
  }
  warnOnMissingAttributes_(identifier, attributes, required) {
    const missing = [];
    required.forEach(function(key) {
      if (!attributes.hasOwnProperty(key)) {
        missing.push(key);
      }
    });
    if (missing.length) {
      this.trigger("warn", {
        message: `${identifier} lacks required attribute(s): ${missing.join(", ")}`
      });
    }
  }
  /**
   * Parse the input string and update the manifest object.
   *
   * @param {string} chunk a potentially incomplete portion of the manifest
   */
  push(chunk) {
    this.lineStream.push(chunk);
  }
  /**
   * Flush any remaining input. This can be handy if the last line of an M3U8
   * manifest did not contain a trailing newline but the file has been
   * completely received.
   */
  end() {
    this.lineStream.push("\n");
    if (this.manifest.dateRanges.length && this.lastProgramDateTime === null) {
      this.trigger("warn", {
        message: "A playlist with EXT-X-DATERANGE tag must contain atleast one EXT-X-PROGRAM-DATE-TIME tag"
      });
    }
    this.lastProgramDateTime = null;
    this.trigger("end");
  }
  /**
   * Add an additional parser for non-standard tags
   *
   * @param {Object}   options              a map of options for the added parser
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {string}   options.customType   the custom type to register to the output
   * @param {Function} [options.dataParser] function to parse the line into an object
   * @param {boolean}  [options.segment]    should tag data be attached to the segment object
   */
  addParser(options) {
    this.parseStream.addParser(options);
  }
  /**
   * Add a custom header mapper
   *
   * @param {Object}   options
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {Function} options.map          function to translate tag into a different tag
   */
  addTagMapper(options) {
    this.parseStream.addTagMapper(options);
  }
}
class TrackError extends Error {
  constructor(message, trackId) {
    super(`${message} (TrackId: ${trackId})`);
  }
}
const logger$2 = Logger.create("DownloadHandler", LogLevel.Debug);
const soundcloudApi$2 = new SoundCloudApi();
function isValidTrack(track) {
  return track && track.kind === "track" && track.state === "finished" && (track.streamable || track.downloadable);
}
function isTranscodingDetails(detail) {
  return typeof detail === "object" && detail !== null && "protocol" in detail;
}
function getTranscodingDetails(details) {
  if (details?.media?.transcodings?.length < 1) return null;
  const mpegStreams = details.media.transcodings.filter(
    (transcoding) => (transcoding.format?.protocol === "progressive" || transcoding.format?.protocol === "hls") && (transcoding.format?.mime_type?.startsWith("audio/mpeg") || transcoding.format?.mime_type?.startsWith("audio/mp4")) && !transcoding.snipped
  ).map((transcoding) => ({
    protocol: transcoding.format.protocol,
    url: transcoding.url,
    quality: transcoding.quality
  }));
  if (mpegStreams.length < 1) {
    logger$2.logWarn("[DownloadHandler] No transcodings streams could be determined for Track " + details.id);
    return null;
  }
  let streams = mpegStreams.sort((a2, b) => {
    if (a2.quality === "hq" && b.quality === "sq") return -1;
    if (a2.quality === "sq" && b.quality === "hq") return 1;
    if (a2.protocol === "progressive" && b.protocol === "hls") return -1;
    if (a2.protocol === "hls" && b.protocol === "progressive") return 1;
    return 0;
  });
  if (!getConfigValue("download-hq-version")) {
    streams = streams.filter((stream) => stream.quality !== "hq");
  }
  if (streams.some((stream) => stream.quality === "hq")) {
    logger$2.logInfo("[DownloadHandler] Including high quality streams for Track " + details.id);
  }
  return streams;
}
async function downloadTrack(track, trackNumber, albumName, playlistNameString, reportProgress) {
  if (!isValidTrack(track)) {
    logger$2.logError("[DownloadHandler] Track does not satisfy constraints needed to be downloadable", track);
    throw new TrackError("Track does not satisfy constraints needed to be downloadable", track.id);
  }
  const downloadDetails = [];
  if (getConfigValue("download-original-version") && track.downloadable && track.has_downloads_left) {
    const originalDownloadUrl = await soundcloudApi$2.getOriginalDownloadUrl(track.id);
    if (originalDownloadUrl) {
      const stream = {
        url: originalDownloadUrl,
        hls: false,
        extension: void 0
        // original_format issue handled, relying on handleDownload inference
      };
      downloadDetails.push(stream);
    }
  }
  const transcodingDetailsResult = getTranscodingDetails(track);
  if (transcodingDetailsResult) {
    downloadDetails.push(...transcodingDetailsResult);
  }
  if (downloadDetails.length < 1) {
    const errorMessage = `[DownloadHandler] No download details could be determined for track: "${track.title}"`;
    throw new TrackError(errorMessage, track.id);
  }
  for (const downloadDetail of downloadDetails) {
    let stream = null;
    let hlsUsed = false;
    let resolvedStreamUrl = null;
    let resolvedExtension = void 0;
    try {
      if (isTranscodingDetails(downloadDetail)) {
        logger$2.logDebug(`[DownloadHandler TrackId: ${track.id}] Getting stream details for transcoding`, downloadDetail);
        stream = await soundcloudApi$2.getStreamDetails(downloadDetail.url);
        if (stream) {
          hlsUsed = stream.hls;
          resolvedStreamUrl = stream.url;
          resolvedExtension = stream.extension;
        } else {
          logger$2.logWarn(`[DownloadHandler TrackId: ${track.id}] Failed to get stream details for transcoding option (url: ${downloadDetail.url}), trying next...`);
          continue;
        }
      } else {
        stream = downloadDetail;
        resolvedStreamUrl = stream.url;
        hlsUsed = stream.hls;
        resolvedExtension = stream.extension;
        logger$2.logDebug(`[DownloadHandler TrackId: ${track.id}] Using direct download detail (original file?)`, { url: resolvedStreamUrl, hls: hlsUsed, extension: resolvedExtension });
      }
      if (!resolvedStreamUrl) {
        logger$2.logWarn(`[DownloadHandler TrackId: ${track.id}] No stream URL resolved, trying next...`, { downloadDetail });
        continue;
      }
      let finalStreamUrl = resolvedStreamUrl;
      let finalHlsFlag = hlsUsed;
      const downloadData = {
        trackId: track.id,
        duration: track.duration,
        uploadDate: new Date(track.display_date),
        streamUrl: finalStreamUrl,
        fileExtension: resolvedExtension,
        title: track.title,
        username: track.user.username,
        userPermalink: track.user.permalink,
        artworkUrl: track.artwork_url,
        avatarUrl: track.user.avatar_url,
        trackNumber,
        albumName,
        playlistName: playlistNameString,
        hls: finalHlsFlag
      };
      logger$2.logDebug(`[DownloadHandler TrackId: ${track.id}] Calling handleDownload with data`, { downloadData });
      const downloadId = await handleDownload(downloadData, reportProgress);
      logger$2.logInfo(`[DownloadHandler TrackId: ${track.id}] handleDownload completed successfully for stream: ${finalStreamUrl} with downloadId: ${downloadId}`);
      reportProgress(101);
      return downloadId;
    } catch (error) {
      logger$2.logWarn(
        `[DownloadHandler TrackId: ${track.id}] Download attempt failed for option. Error: ${error?.message || error}`,
        { downloadDetail, streamUrl: resolvedStreamUrl }
      );
    }
  }
  logger$2.logError(`[DownloadHandler TrackId: ${track.id}] All download attempts failed after trying ${downloadDetails.length} options.`);
  reportProgress(102);
  throw new TrackError("No version of this track could be downloaded", track.id);
}
async function handleDownload(data, reportProgress) {
  logger$2.logDebug(`[handleDownload ENTRY] Processing TrackId: ${data.trackId}. History check comes later.`);
  let artistsString = data.username;
  let titleString = data.title;
  let rawFilenameBase;
  let artworkUrl = data.artworkUrl;
  let streamBuffer;
  let streamHeaders;
  let saveAs;
  let defaultDownloadLocation;
  let shouldSkipExisting;
  let determinedContentType;
  let finalDownloadFilename;
  let objectUrlToRevoke;
  let potentialDownloadFilename;
  try {
    try {
      logger$2.logInfo(`Initiating metadata processing for ${data.trackId} with payload`, { payload: data });
      if (getConfigValue("normalize-track")) {
        const extractor = new MetadataExtractor(data.title, data.username, data.userPermalink);
        let artists = extractor.getArtists();
        if (!getConfigValue("include-producers")) artists = artists.filter((i2) => i2.type !== ArtistType.Producer);
        artistsString = artists.map((i2) => i2.name).join(", ");
        titleString = extractor.getTitle();
        const remixers = artists.filter((i2) => i2.type === ArtistType.Remixer);
        if (remixers.length > 0) {
          const remixerNames = remixers.map((i2) => i2.name).join(" & ");
          const remixTypeString = RemixType[remixers[0].remixType || RemixType.Remix].toString();
          titleString += ` (${remixerNames} ${remixTypeString})`;
        }
      }
      if (!artistsString) artistsString = "Unknown";
      if (!titleString) titleString = "Unknown";
      rawFilenameBase = sanitizeFilenameForDownload(`${artistsString} - ${titleString}`);
    } catch (error) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during metadata processing:`, error);
      throw new TrackError(`Metadata processing failed for track ${data.trackId}: ${error.message}`, data.trackId);
    }
    saveAs = !getConfigValue("download-without-prompt");
    defaultDownloadLocation = getConfigValue("default-download-location");
    shouldSkipExisting = getConfigValue("skipExistingFiles");
    try {
      const checkExtension = data.fileExtension || "mp3";
      potentialDownloadFilename = rawFilenameBase + "." + checkExtension;
      if (!saveAs && defaultDownloadLocation) {
        if (data.playlistName) {
          const sanitizedPlaylistName = sanitizeFilenameForDownload(data.playlistName);
          potentialDownloadFilename = defaultDownloadLocation + "/" + sanitizedPlaylistName + "/" + potentialDownloadFilename;
        } else {
          potentialDownloadFilename = defaultDownloadLocation + "/" + potentialDownloadFilename;
        }
      }
      if (shouldSkipExisting) {
        let pathPrefix = "";
        if (defaultDownloadLocation) {
          if (data.playlistName) {
            const sanitizedPlaylistName = sanitizeFilenameForDownload(data.playlistName);
            pathPrefix = defaultDownloadLocation + "/" + sanitizedPlaylistName + "/";
          } else {
            pathPrefix = defaultDownloadLocation + "/";
          }
        }
        const trackIdKey = `track-${data.trackId}`;
        const trackDownloadHistory = await loadConfigValue("track-download-history") || {};
        logger$2.logDebug(`[History Check] shouldSkipExisting=${shouldSkipExisting}, trackIdKey=${trackIdKey}, history exists=${!!trackDownloadHistory}`);
        if (Object.keys(trackDownloadHistory).length > 0) {
          logger$2.logDebug(`[History Check] History has ${Object.keys(trackDownloadHistory).length} entries`);
        }
        if (trackDownloadHistory && trackDownloadHistory[trackIdKey]) {
          const previousDownload = trackDownloadHistory[trackIdKey];
          logger$2.logInfo(`Skipping download for TrackId: ${data.trackId}. Previously downloaded as: ${previousDownload.filename} at ${new Date(previousDownload.timestamp).toLocaleString()}`);
          reportProgress(101);
          const fakeDownloadId = Math.floor(Math.random() * 1e6) + 1e3;
          logger$2.logInfo(`Using fake download ID ${fakeDownloadId} for skipped track ${data.trackId}`);
          return fakeDownloadId;
        }
        const specificFilename = `${pathPrefix}${rawFilenameBase}.${data.fileExtension || "mp3"}`;
        const exactQuery = { filename: specificFilename };
        logger$2.logDebug(`[History Check] Searching downloads with exactQuery: ${JSON.stringify(exactQuery)}`);
        const exactMatches = await searchDownloads(exactQuery);
        logger$2.logDebug(`[History Check] exactMatches found: ${exactMatches.length}`);
        const escapedPathPrefix = pathPrefix.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&");
        const escapedRawFilenameBase = rawFilenameBase.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&");
        const regexQuery = { filenameRegex: `^${escapedPathPrefix}${escapedRawFilenameBase}\\..+$` };
        logger$2.logDebug(`[History Check] Searching downloads with regexQuery: ${JSON.stringify(regexQuery)}`);
        const regexMatches = exactMatches.length === 0 ? await searchDownloads(regexQuery) : [];
        logger$2.logDebug(`[History Check] regexMatches found: ${regexMatches.length}`);
        const filenameWithoutPathRegex = `${escapedRawFilenameBase}\\..+$`;
        const titleArtistQuery = { filenameRegex: filenameWithoutPathRegex };
        logger$2.logDebug(`[History Check] Searching downloads with titleArtistQuery: ${JSON.stringify(titleArtistQuery)}`);
        const titleArtistMatches = exactMatches.length === 0 && regexMatches.length === 0 ? await searchDownloads(titleArtistQuery) : [];
        logger$2.logDebug(`[History Check] titleArtistMatches found: ${titleArtistMatches.length}`);
        const allMatches = [...exactMatches, ...regexMatches, ...titleArtistMatches];
        const completedDownloads = allMatches.filter((d) => d.state === "complete");
        if (completedDownloads.length > 0) {
          logger$2.logInfo(`Skipping download for TrackId: ${data.trackId}. File already exists in download history: ${completedDownloads[0].filename}`);
          if (completedDownloads.length > 0) {
            completedDownloads.slice(0, 3).forEach((download, i2) => {
              logger$2.logDebug(`[History Check] Match ${i2}: filename=${download.filename}, state=${download.state}`);
            });
          }
          trackDownloadHistory[trackIdKey] = {
            filename: completedDownloads[0].filename,
            timestamp: Date.now()
          };
          await storeConfigValue("track-download-history", trackDownloadHistory);
          reportProgress(101);
          const fakeDownloadId = Math.floor(Math.random() * 1e6) + 1e3;
          logger$2.logInfo(`Using fake download ID ${fakeDownloadId} for already downloaded track ${data.trackId}`);
          return fakeDownloadId;
        } else {
          logger$2.logDebug(`No matching downloads found for TrackId: ${data.trackId} with filename base "${rawFilenameBase}"`);
        }
      } else {
        logger$2.logDebug("[History Check] Skip existing files check is disabled");
      }
    } catch (error) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during filename/skip logic:`, error);
      throw new TrackError(`Filename/skip logic failed for track ${data.trackId}: ${error.message}`, data.trackId);
    }
    try {
      if (!artworkUrl) {
        logger$2.logInfo(`No Artwork URL in data. Fallback to User Avatar (TrackId: ${data.trackId})`);
        artworkUrl = data.avatarUrl;
      }
    } catch (error) {
      logger$2.logWarn(`[DownloadHandler TrackId: ${data.trackId}] Error checking/falling back artwork URL: ${error.message}. Will attempt with current value.`);
    }
    logger$2.logInfo(`Starting download of '${rawFilenameBase}' (TrackId: ${data.trackId})...`);
    let originalStreamBuffer;
    try {
      if (data.hls) {
        logger$2.logInfo(`[TrackId: ${data.trackId}] Starting HLS segment fetching from: ${data.streamUrl}`);
        const [playlistBuffer, initialHeaders] = await soundcloudApi$2.downloadStream(data.streamUrl, (p) => {
          if (p !== void 0) reportProgress(p * 0.1);
        });
        streamHeaders = initialHeaders;
        if (!playlistBuffer) throw new Error("HLS playlist download failed or returned empty buffer.");
        const playlistText = new TextDecoder().decode(playlistBuffer);
        const parser = new Parser();
        parser.push(playlistText);
        parser.end();
        let initSegmentBuffer = null;
        if (parser.manifest?.segments?.length > 0) {
          const segmentWithMap = parser.manifest.segments.find((seg) => seg.map?.uri);
          if (segmentWithMap?.map?.uri) {
            let initSegmentFullUrl = segmentWithMap.map.uri;
            try {
              if (!(initSegmentFullUrl.startsWith("http://") || initSegmentFullUrl.startsWith("https://"))) {
                initSegmentFullUrl = new URL(initSegmentFullUrl, data.streamUrl).href;
              }
            } catch (_e) {
              if (!(initSegmentFullUrl.startsWith("http://") || initSegmentFullUrl.startsWith("https://"))) {
                throw new Error(`Failed to resolve relative HLS init segment URI: ${initSegmentFullUrl}`);
              }
            }
            const [initData] = await soundcloudApi$2.downloadStream(initSegmentFullUrl, (p) => {
              if (p !== void 0) reportProgress(5 + p * 0.05);
            });
            if (!initData) throw new Error(`Failed to download HLS init segment: ${initSegmentFullUrl}`);
            initSegmentBuffer = initData;
          }
        }
        let segmentUris = [];
        if (parser.manifest?.segments?.length > 0) {
          segmentUris = parser.manifest.segments.map((segment) => {
            try {
              return new URL(segment.uri, data.streamUrl).href;
            } catch (_e) {
              if (segment.uri.startsWith("http://") || segment.uri.startsWith("https://")) return segment.uri;
              throw new Error(`Failed to resolve relative HLS segment URI: ${segment.uri}`);
            }
          });
        }
        if (segmentUris.length === 0 && !initSegmentBuffer) throw new Error("HLS playlist contains no media segments or init segment.");
        const segments = [];
        const totalSegments = segmentUris.length;
        const segmentProgressStart = initSegmentBuffer ? 10 : 5;
        const segmentProgressRange = initSegmentBuffer ? 80 : 85;
        for (let i2 = 0; i2 < totalSegments; i2++) {
          const [segmentData] = await soundcloudApi$2.downloadStream(segmentUris[i2], (p_segment) => {
            if (p_segment !== void 0) reportProgress(segmentProgressStart + (i2 + p_segment / 100) / totalSegments * segmentProgressRange);
          });
          if (!segmentData) throw new Error(`Failed to download HLS segment: ${segmentUris[i2]}`);
          segments.push(segmentData);
          const rateLimitMs = getConfigValue("hls-rate-limit-delay-ms") ?? 0;
          if (rateLimitMs > 0 && i2 < totalSegments - 1) await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
        }
        const buffersToConcat = [];
        if (initSegmentBuffer) buffersToConcat.push(initSegmentBuffer);
        buffersToConcat.push(...segments);
        streamBuffer = concatArrayBuffers(buffersToConcat);
        data.hls = false;
      } else {
        [streamBuffer, streamHeaders] = await soundcloudApi$2.downloadStream(data.streamUrl, reportProgress);
      }
      if (!streamBuffer) {
        throw new TrackError("Stream buffer is undefined after download attempts", data.trackId);
      }
      originalStreamBuffer = streamBuffer.slice(0);
      if (!data.fileExtension && streamHeaders) {
        determinedContentType = streamHeaders.get("content-type");
        let extension = "mp3";
        if (determinedContentType === "audio/mp4") extension = "m4a";
        else if (determinedContentType === "audio/x-wav" || determinedContentType === "audio/wav") extension = "wav";
        data.fileExtension = extension;
      } else if (!data.fileExtension) {
        data.fileExtension = "mp3";
      }
      const ffmpegRemuxEnabled = getConfigValue("ffmpeg-remux-hls-mp4");
      if (ffmpegRemuxEnabled && (data.fileExtension === "m4a" || data.fileExtension === "mp4")) {
        reportProgress(85);
        const ffmpegReady = await loadFFmpeg();
        if (ffmpegReady) {
          const inputFilename = `input.${data.fileExtension || "mp4"}`;
          const outputFilename = `output_remuxed.${data.fileExtension || "mp4"}`;
          let progressHandlerFfmpeg;
          try {
            await ffmpeg.writeFile(inputFilename, new Uint8Array(originalStreamBuffer));
            const ffmpegArgs = ["-loglevel", "warning", "-i", inputFilename, "-c", "copy", outputFilename];
            let lastReportedFFmpegProgress = -1;
            progressHandlerFfmpeg = ({ progress }) => {
              const currentFFmpegProgress = Math.round(progress * 100);
              if (currentFFmpegProgress > lastReportedFFmpegProgress && currentFFmpegProgress <= 100) {
                reportProgress(85 + Math.floor(currentFFmpegProgress * 0.13));
                lastReportedFFmpegProgress = currentFFmpegProgress;
              }
            };
            ffmpeg.on("progress", progressHandlerFfmpeg);
            await ffmpeg.exec(ffmpegArgs);
            const outputData = await ffmpeg.readFile(outputFilename);
            if (typeof outputData === "string") throw new Error("FFmpeg remux output was a string");
            streamBuffer = outputData.buffer.slice(0);
            if (data.fileExtension === "m4a" || data.fileExtension === "mp4") determinedContentType = "audio/mp4";
            reportProgress(99);
            await ffmpeg.deleteFile(inputFilename);
            await ffmpeg.deleteFile(outputFilename);
          } catch (ffmpegError) {
            logger$2.logError("[FFMPEG_WASM] Error during remux. Proceeding with original.", ffmpegError);
            streamBuffer = originalStreamBuffer.slice(0);
          } finally {
            if (progressHandlerFfmpeg && typeof ffmpeg.off === "function") ffmpeg.off("progress", progressHandlerFfmpeg);
          }
        } else {
          logger$2.logWarn("[FFMPEG_WASM] Remux skipped as FFmpeg failed to load.");
        }
      }
    } catch (error) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during download/FFmpeg stage:`, error);
      throw new TrackError(`Download/FFmpeg failed for track ${data.trackId}: ${error.message}`, data.trackId);
    }
    let taggedBuffer;
    try {
      const setMetadata = getConfigValue("set-metadata");
      if (setMetadata && streamBuffer) {
        let writer;
        const bufferForTagging = streamBuffer.slice(0);
        if (data.fileExtension === "mp3") writer = new Mp3TagWriter(bufferForTagging);
        else if (data.fileExtension === "m4a" || data.fileExtension === "mp4") writer = new Mp4TagWriter(bufferForTagging);
        if (writer) {
          if (titleString) writer.setTitle(titleString);
          if (artistsString) writer.setArtists([artistsString]);
          if (data.albumName) writer.setAlbum(data.albumName);
          else if (data.playlistName) writer.setAlbum(data.playlistName);
          if (data.uploadDate) {
            const year = data.uploadDate.getFullYear();
            if (!isNaN(year)) writer.setYear(year);
          }
          if (data.trackNumber) writer.setTrackNumber(data.trackNumber);
          if (artworkUrl) {
            try {
              const actualArtworkUrl = artworkUrl.replace("-large.jpg", "-t500x500.jpg");
              const artworkResponse = await fetch(actualArtworkUrl);
              if (!artworkResponse.ok) throw new Error(`Artwork fetch failed: ${artworkResponse.statusText}`);
              const fetchedArtworkBuffer = await artworkResponse.arrayBuffer();
              writer.setArtwork(fetchedArtworkBuffer);
            } catch (artworkError) {
              logger$2.logWarn(`[Artwork] Failed to fetch/set artwork for tagging TrackId: ${data.trackId}`, artworkError);
            }
          }
          const tagWriterResult = await writer.getBuffer();
          if (tagWriterResult?.buffer?.byteLength > 0) {
            taggedBuffer = tagWriterResult.buffer;
          } else {
            logger$2.logWarn("[Metadata] TagWriter returned invalid buffer. Using untagged buffer.");
            taggedBuffer = streamBuffer.slice(0);
          }
        } else {
          logger$2.logWarn(`[TrackId: ${data.trackId}] No TagWriter for ext '${data.fileExtension}'. Using untagged buffer.`);
          taggedBuffer = streamBuffer.slice(0);
        }
      } else {
        logger$2.logInfo(`[TrackId: ${data.trackId}] Metadata disabled or no streamBuffer. Using untagged.`);
        taggedBuffer = streamBuffer?.slice(0);
      }
    } catch (error) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during metadata tagging:`, error);
      taggedBuffer = streamBuffer?.slice(0);
    }
    let bufferToSave;
    try {
      bufferToSave = taggedBuffer?.byteLength > 0 ? taggedBuffer : streamBuffer?.byteLength > 0 ? streamBuffer.slice(0) : originalStreamBuffer?.byteLength > 0 ? originalStreamBuffer.slice(0) : (() => {
        throw new TrackError(`All buffers invalid for ${data.trackId}`, data.trackId);
      })();
      if (bufferToSave.byteLength < 100) logger$2.logWarn(`Final buffer small: ${bufferToSave.byteLength} bytes.`);
      const blobOptions = {};
      if (determinedContentType) blobOptions.type = determinedContentType;
      else if (data.fileExtension === "mp3") blobOptions.type = "audio/mpeg";
      else if (data.fileExtension === "m4a" || data.fileExtension === "mp4") blobOptions.type = "audio/mp4";
      else if (data.fileExtension === "wav") blobOptions.type = "audio/wav";
      const downloadBlob = new Blob([bufferToSave], blobOptions);
      logger$2.logInfo(`Creating URL for download (TrackId: ${data.trackId}). Service worker context: ${isServiceWorkerContext()}`);
      objectUrlToRevoke = await createURLFromBlob(downloadBlob);
    } catch (error) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Error preparing final buffer or Blob/DataURL:`, error);
      throw new TrackError(`Failed to prepare buffer/DataURL for track ${data.trackId}: ${error.message}`, data.trackId);
    }
    finalDownloadFilename = rawFilenameBase + "." + (data.fileExtension || "mp3");
    if (!saveAs && defaultDownloadLocation) {
      const base = defaultDownloadLocation.endsWith("/") ? defaultDownloadLocation.slice(0, -1) : defaultDownloadLocation;
      const playlistFolder = data.playlistName ? `/${sanitizeFilenameForDownload(data.playlistName)}` : "";
      const justTheFilename = finalDownloadFilename.split("/").pop() || finalDownloadFilename;
      finalDownloadFilename = `${base}${playlistFolder}/${justTheFilename}`;
    }
    try {
      logger$2.logInfo(`Downloading track as '${finalDownloadFilename}' (TrackId: ${data.trackId}). SaveAs: ${saveAs}`);
      const urlToDownload = objectUrlToRevoke;
      if (!urlToDownload) {
        throw new Error("Data URL for download is undefined.");
      }
      const downloadId = await downloadToFile(urlToDownload, finalDownloadFilename, saveAs);
      logger$2.logInfo(`Successfully initiated download for '${rawFilenameBase}' (TrackId: ${data.trackId}) with downloadId: ${downloadId}`);
      if (shouldSkipExisting) {
        const histKey = `track-${data.trackId}`;
        const history = await loadConfigValue("track-download-history") || {};
        history[histKey] = { filename: finalDownloadFilename, timestamp: Date.now() };
        await storeConfigValue("track-download-history", history);
      }
      reportProgress(101);
      return downloadId;
    } catch (saveError) {
      logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Download save stage error:`, saveError);
      throw new TrackError(`Save failed for track ${data.trackId}: ${saveError.message}`, data.trackId);
    }
  } catch (error) {
    logger$2.logError(`[DownloadHandler TrackId: ${data.trackId}] Uncaught error in handleDownload`, error);
    if (error instanceof TrackError) {
      throw error;
    } else {
      throw new TrackError(`Unknown error during download: ${error?.message || error}`, data.trackId);
    }
  }
}
const DOWNLOAD_SET = "DOWNLOAD_SET";
const DOWNLOAD = "DOWNLOAD";
const DOWNLOAD_SET_RANGE = "DOWNLOAD_SET_RANGE";
const PAUSE_DOWNLOAD = "PAUSE_DOWNLOAD";
const RESUME_DOWNLOAD = "RESUME_DOWNLOAD";
class MessageHandlerError extends Error {
  constructor(message) {
    super(message);
  }
}
const pausedDownloads = {};
const soundcloudApi$1 = new SoundCloudApi();
const logger$1 = Logger.create("MessageHandler", LogLevel.Debug);
async function handleIncomingMessage(message, sender) {
  let receivedMessageForLog = {};
  try {
    receivedMessageForLog = JSON.parse(JSON.stringify(message));
  } catch (_e) {
    receivedMessageForLog = { errorParsingMessage: true, rawMessage: String(message) };
  }
  logger$1.logDebug("[MessageHandler DEBUG] Received message:", receivedMessageForLog);
  if (!message || message.downloadId === void 0 && message.type !== void 0) {
    logger$1.logError(
      "CRITICAL: MessageHandler received message with undefined or missing downloadId!",
      receivedMessageForLog
    );
  }
  const tabId = sender.tab?.id;
  const { downloadId, url, type } = message;
  if (!tabId) {
    logger$1.logWarn("Message received without a valid tab ID", { sender, message });
    return { error: "No valid tab ID found in message sender" };
  }
  try {
    if (type === DOWNLOAD_SET) {
      logger$1.logDebug("Received set download request", { url, downloadId });
      sendDownloadProgress(tabId, downloadId, 0);
      delete pausedDownloads[downloadId];
      const set = await soundcloudApi$1.resolveUrl(url);
      if (!set) {
        throw new MessageHandlerError(`Failed to resolve SoundCloud URL. Check if you are logged in or if the URL is correct. URL: ${url}`);
      }
      const trackIds = set.tracks.map((i2) => i2.id);
      const progresses = {};
      const browserDownloadIds = {};
      const reportPlaylistProgress = (trackId) => (progress, browserDlId) => {
        if (progress !== void 0) {
          progresses[trackId] = progress;
        }
        if (browserDlId !== void 0) {
          browserDownloadIds[trackId] = browserDlId;
        }
        const totalProgress = Object.values(progresses).reduce((acc, cur) => acc + cur, 0);
        const latestBrowserDlId = browserDownloadIds[trackId];
        sendDownloadProgress(tabId, downloadId, totalProgress / trackIds.length, void 0, void 0, latestBrowserDlId);
      };
      const setAlbumName = set.set_type === "album" || set.set_type === "ep" ? set.title : void 0;
      const setPlaylistName = set.set_type !== "album" && set.set_type !== "ep" ? set.title : void 0;
      const trackIdChunkSize = 10;
      const trackIdChunks = chunkArray(trackIds, trackIdChunkSize);
      let currentTrackIdChunk = 0;
      let encounteredError = false;
      let lastError = null;
      for (const trackIdChunk of trackIdChunks) {
        sendDownloadProgress(tabId, downloadId, void 0, void 0, pausedDownloads[downloadId] ? "Paused" : void 0);
        while (pausedDownloads[downloadId]) {
          logger$1.logDebug(`Download ${downloadId} is paused. Waiting...`);
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
        const keyedTracks = await soundcloudApi$1.getTracks(trackIdChunk);
        const tracks = Object.values(keyedTracks).reverse();
        logger$1.logInfo(`Downloading set chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}...`);
        const downloads = [];
        for (let i2 = 0; i2 < tracks.length; i2++) {
          const originalIndex = set.tracks.findIndex((t2) => t2.id === tracks[i2].id);
          const trackNumber = originalIndex !== -1 ? originalIndex + 1 : void 0;
          const download = downloadTrack(tracks[i2], trackNumber, setAlbumName, setPlaylistName, reportPlaylistProgress(tracks[i2].id));
          downloads.push(download);
        }
        await Promise.all(
          downloads.map(
            (p) => p.catch((error) => {
              logger$1.logWarn("Failed to download track of set", error);
              encounteredError = true;
              lastError = error;
              return 0;
            })
          )
        );
        currentTrackIdChunk++;
      }
      if (encounteredError) {
        logger$1.logWarn("Playlist download completed with errors. Last error:", lastError);
        sendDownloadProgress(tabId, downloadId, 102, lastError ?? new MessageHandlerError("One or more tracks failed to download."));
      } else {
        logger$1.logInfo("Downloaded set successfully!");
        sendDownloadProgress(tabId, downloadId, 101);
      }
      return { success: true, message: "Playlist download completed" };
    } else if (type === DOWNLOAD) {
      logger$1.logDebug("Received track download request", { url, downloadId });
      sendDownloadProgress(tabId, downloadId, 0);
      delete pausedDownloads[downloadId];
      const track = await soundcloudApi$1.resolveUrl(url);
      if (!track) {
        throw new MessageHandlerError(`Failed to resolve SoundCloud track URL: ${url}`);
      }
      let browserDlId;
      const reportTrackProgress = (progress) => {
        if (browserDlId !== void 0) {
          sendDownloadProgress(tabId, downloadId, progress, void 0, void 0, browserDlId);
        } else {
          sendDownloadProgress(tabId, downloadId, progress);
          if (progress === 101 && arguments.length > 1 && typeof arguments[1] === "number") {
            browserDlId = arguments[1];
            sendDownloadProgress(tabId, downloadId, progress, void 0, void 0, browserDlId);
          }
        }
      };
      const forceRedownload = message.forceRedownload === true;
      let originalHistoryValue = null;
      let originalSkipSetting = void 0;
      if (forceRedownload) {
        logger$1.logInfo(`Force redownload requested for track ID ${track.id}. Temporarily bypassing all history and skip checks.`);
        originalSkipSetting = getConfigValue("skipExistingFiles");
        if (originalSkipSetting) {
          logger$1.logInfo("Temporarily disabling skipExistingFiles for force redownload");
          await storeConfigValue("skipExistingFiles", false);
        }
        const trackIdKey = `track-${track.id}`;
        const trackDownloadHistory = await loadConfigValue("track-download-history") || {};
        if (trackDownloadHistory && trackDownloadHistory[trackIdKey]) {
          originalHistoryValue = { ...trackDownloadHistory[trackIdKey] };
          delete trackDownloadHistory[trackIdKey];
          await storeConfigValue("track-download-history", trackDownloadHistory);
          logger$1.logInfo(`Temporarily removed track ${track.id} from download history for force redownload.`);
        }
        try {
          if (typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.erase) {
            const extractor = new MetadataExtractor(track.title, track.user.username, track.user.permalink);
            const normalizedTitle = extractor.getTitle();
            const artistList = extractor.getArtists();
            const normalizedArtist = artistList.map((a2) => a2.name).join(", ");
            const filenamePattern = `${normalizedArtist} - ${normalizedTitle}`;
            const escapedPattern = filenamePattern.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&");
            const regexPattern = escapedPattern + "\\..+$";
            logger$1.logInfo(`Force redownload: Searching for downloads matching pattern: ${regexPattern}`);
            const query = {
              filenameRegex: regexPattern,
              state: "complete"
            };
            chrome.downloads.erase(query, (erasedIds) => {
              if (erasedIds && erasedIds.length > 0) {
                logger$1.logInfo(`Force redownload: Removed ${erasedIds.length} matching entries from browser download history.`);
              } else {
                logger$1.logInfo("Force redownload: No matching entries found in browser download history.");
              }
            });
          }
        } catch (eraseError) {
          logger$1.logWarn("Failed to clear browser download history entries:", eraseError);
        }
      }
      try {
        const actualDownloadId = await downloadTrack(track, void 0, void 0, void 0, reportTrackProgress);
        logger$1.logInfo(`Track download completed with browser download ID: ${actualDownloadId}`);
        browserDlId = actualDownloadId;
        sendDownloadProgress(tabId, downloadId, 101, void 0, void 0, actualDownloadId);
        if (forceRedownload && originalSkipSetting !== void 0) {
          logger$1.logInfo("Restoring skipExistingFiles setting after force redownload");
          await storeConfigValue("skipExistingFiles", originalSkipSetting);
        }
        return {
          success: true,
          message: forceRedownload ? "Track force-redownloaded" : "Track download completed",
          downloadId: actualDownloadId,
          browserDownloadId: actualDownloadId,
          originalDownloadId: downloadId
        };
      } catch (error) {
        if (forceRedownload) {
          if (originalSkipSetting !== void 0) {
            logger$1.logInfo("Restoring skipExistingFiles setting after failed force redownload");
            await storeConfigValue("skipExistingFiles", originalSkipSetting);
          }
          if (originalHistoryValue) {
            const trackIdKey = `track-${track.id}`;
            const trackDownloadHistory = await loadConfigValue("track-download-history") || {};
            trackDownloadHistory[trackIdKey] = originalHistoryValue;
            await storeConfigValue("track-download-history", trackDownloadHistory);
            logger$1.logInfo(`Restored original download history for track ${track.id} after failed force redownload.`);
          }
        }
        logger$1.logError(`Track download failed: ${error instanceof Error ? error.message : String(error)}`);
        sendDownloadProgress(tabId, downloadId, 102, error instanceof Error ? error : new MessageHandlerError(String(error)));
        return { error: `Track download failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    } else if (type === DOWNLOAD_SET_RANGE) {
      const rangeMessage = message;
      logger$1.logInfo("Received set range download request", {
        url,
        start: rangeMessage.start,
        end: rangeMessage.end,
        downloadId,
        tabId
      });
      sendDownloadProgress(tabId, downloadId, 0);
      delete pausedDownloads[downloadId];
      try {
        const start = rangeMessage.start;
        const end = rangeMessage.end;
        logger$1.logInfo(`Resolving playlist URL: ${url}`);
        const set = await soundcloudApi$1.resolveUrl(url);
        if (!set) {
          const error = new MessageHandlerError(`Failed to resolve SoundCloud set. URL: ${url} returned null/undefined.`);
          logger$1.logError("URL resolution failed", { url, error: error.message });
          sendDownloadProgress(tabId, downloadId, void 0, error);
          return { error: error.message };
        }
        if (!set.tracks) {
          const error = new MessageHandlerError(`SoundCloud set is missing tracks property. URL: ${url}`);
          logger$1.logError("Set missing tracks property", { url, set, error: error.message });
          sendDownloadProgress(tabId, downloadId, void 0, error);
          return { error: error.message };
        }
        if (set.tracks.length === 0) {
          const error = new MessageHandlerError(`SoundCloud set is empty (has 0 tracks). URL: ${url}`);
          logger$1.logError("Empty set", { url, set, error: error.message });
          sendDownloadProgress(tabId, downloadId, void 0, error);
          return { error: error.message };
        }
        logger$1.logInfo(`Successfully resolved playlist with ${set.tracks.length} tracks`, {
          title: set.title,
          set_type: set.set_type
        });
        const totalTracks = set.tracks.length;
        const validatedStart = Math.max(1, Math.min(start, totalTracks));
        const validatedEnd = end === null ? totalTracks : Math.max(validatedStart, Math.min(end, totalTracks));
        if (validatedStart > validatedEnd) {
          const error = new MessageHandlerError(
            `Invalid range: Start index (${validatedStart}) cannot be greater than End index (${validatedEnd}). Total tracks: ${totalTracks}`
          );
          logger$1.logError("Invalid range", { start, end, validatedStart, validatedEnd, totalTracks, error: error.message });
          sendDownloadProgress(tabId, downloadId, void 0, error);
          return { error: error.message };
        }
        logger$1.logInfo(`Processing range: ${validatedStart} to ${validatedEnd} (of ${totalTracks})`, {
          originalStart: start,
          originalEnd: end,
          validatedStart,
          validatedEnd,
          totalTracks
        });
        const tracksToDownload = set.tracks.slice(validatedStart - 1, validatedEnd);
        logger$1.logInfo(`Selected ${tracksToDownload.length} tracks for download in range`);
        if (tracksToDownload.length === 0) {
          logger$1.logWarn("Selected range resulted in zero tracks to download.");
          sendDownloadProgress(tabId, downloadId, 101);
          return { success: true, message: "No tracks in selected range" };
        }
        const isAlbum = set.set_type === "album" || set.set_type === "ep";
        const setAlbumName = isAlbum ? set.title : void 0;
        const setPlaylistName = !isAlbum ? set.title : void 0;
        logger$1.logInfo("Set metadata:", {
          isAlbum,
          title: set.title,
          setAlbumName,
          setPlaylistName
        });
        const progresses = {};
        const browserDownloadIds = {};
        const reportPlaylistProgress = (trackId) => (progress, browserDlId) => {
          if (progress !== void 0) {
            progresses[trackId] = progress;
          }
          if (browserDlId !== void 0) {
            browserDownloadIds[trackId] = browserDlId;
          }
          const totalProgress = Object.values(progresses).reduce((acc, cur) => acc + cur, 0);
          const averageProgress = totalProgress / tracksToDownload.length;
          const latestBrowserDlId = browserDownloadIds[trackId];
          sendDownloadProgress(tabId, downloadId, averageProgress, void 0, void 0, latestBrowserDlId);
        };
        let encounteredError = false;
        let lastError = null;
        const trackIdChunkSize = 5;
        const trackIdChunks = chunkArray(tracksToDownload.map((t2) => t2.id), trackIdChunkSize);
        let currentTrackIdChunk = 0;
        logger$1.logInfo(`Splitting download into ${trackIdChunks.length} chunks of size ${trackIdChunkSize}`);
        for (const trackIdChunk of trackIdChunks) {
          logger$1.logInfo(`Starting chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}`, {
            trackIds: trackIdChunk
          });
          sendDownloadProgress(tabId, downloadId, void 0, void 0, pausedDownloads[downloadId] ? "Paused" : void 0);
          while (pausedDownloads[downloadId]) {
            logger$1.logDebug(`Download ${downloadId} is paused. Waiting...`);
            await new Promise((resolve) => setTimeout(resolve, 1e3));
          }
          logger$1.logInfo(`Fetching track data for chunk ${currentTrackIdChunk + 1}`);
          const keyedTracks = await soundcloudApi$1.getTracks(trackIdChunk);
          const tracksInChunk = Object.values(keyedTracks).reverse();
          logger$1.logInfo(`Got ${tracksInChunk.length} tracks for chunk ${currentTrackIdChunk + 1}/${trackIdChunks.length}`);
          const downloads = [];
          for (let i2 = 0; i2 < tracksInChunk.length; i2++) {
            const trackInfo = tracksInChunk[i2];
            logger$1.logInfo(`Starting download for track ${i2 + 1}/${tracksInChunk.length} in chunk`, {
              id: trackInfo.id,
              title: trackInfo.title
            });
            sendDownloadProgress(tabId, downloadId, void 0, void 0, pausedDownloads[downloadId] ? "Paused" : void 0);
            while (pausedDownloads[downloadId]) {
              logger$1.logDebug(`Download ${downloadId} is paused. Waiting...`);
              await new Promise((resolve) => setTimeout(resolve, 1e3));
            }
            const originalIndex = set.tracks.findIndex((t2) => t2.id === trackInfo.id);
            const trackNumber = originalIndex !== -1 ? originalIndex + 1 : void 0;
            try {
              const download = downloadTrack(
                trackInfo,
                trackNumber,
                setAlbumName,
                setPlaylistName,
                reportPlaylistProgress(trackInfo.id)
              );
              downloads.push(download);
            } catch (trackError) {
              logger$1.logError(`Failed to start download for track ${trackInfo.title}`, trackError);
              encounteredError = true;
              lastError = trackError instanceof Error ? trackError : new Error(String(trackError));
            }
          }
          logger$1.logInfo(`Waiting for all downloads in chunk ${currentTrackIdChunk + 1} to complete...`);
          await Promise.all(
            downloads.map(
              (p) => p.catch((error) => {
                logger$1.logWarn("Failed to download track of set range", error);
                encounteredError = true;
                lastError = error;
                return 0;
              })
            )
          );
          logger$1.logInfo(`Completed all downloads in chunk ${currentTrackIdChunk + 1}`);
          currentTrackIdChunk++;
        }
        if (encounteredError) {
          logger$1.logWarn("Playlist range download completed with errors. Last error:", lastError);
          sendDownloadProgress(tabId, downloadId, 102, lastError ?? new MessageHandlerError("One or more tracks failed to download in the selected range."));
        } else {
          logger$1.logInfo("Downloaded playlist range successfully!");
          sendDownloadProgress(tabId, downloadId, 101);
        }
        return { success: true, message: "Playlist range download completed" };
      } catch (error) {
        sendDownloadProgress(tabId, downloadId, void 0, error instanceof Error ? error : new MessageHandlerError(String(error)));
        logger$1.logError("Download failed unexpectedly for set range", error);
        return { error: `Range download failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    } else if (type === PAUSE_DOWNLOAD) {
      const pauseMessage = message;
      logger$1.logInfo(`Received pause request for download: ${pauseMessage.downloadId}`);
      pausedDownloads[pauseMessage.downloadId] = true;
      sendDownloadProgress(tabId, pauseMessage.downloadId, void 0, void 0, "Paused");
      return { success: true, action: "paused", downloadId: pauseMessage.downloadId };
    } else if (type === RESUME_DOWNLOAD) {
      const resumeMessage = message;
      logger$1.logInfo(`Received resume request for download: ${resumeMessage.downloadId}`);
      pausedDownloads[resumeMessage.downloadId] = false;
      sendDownloadProgress(tabId, resumeMessage.downloadId, void 0, void 0, "Resuming");
      return { success: true, action: "resumed", downloadId: resumeMessage.downloadId };
    } else {
      throw new MessageHandlerError(`Unknown download type: ${type}`);
    }
  } catch (error) {
    const errorToSend = error instanceof Error ? error : new MessageHandlerError(String(error));
    sendDownloadProgress(tabId, downloadId, void 0, errorToSend);
    logger$1.logError("Download failed unexpectedly in message handler", error);
    return { error: errorToSend.message };
  }
}
const soundcloudApi = new SoundCloudApi();
const logger = Logger.create("Background", LogLevel.Debug);
const manifest = getExtensionManifest();
const RULE_ID_OAUTH = 1;
const RULE_ID_CLIENT_ID = 2;
async function updateAuthHeaderRule(oauthToken) {
  if (!(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
    logger.logDebug("Skipping DNR update for OAuth: Not a Chrome MV3+ env or DNR unavailable.");
    return;
  }
  const rulesToAdd = [];
  const rulesToRemove = [RULE_ID_OAUTH];
  if (oauthToken) {
    rulesToAdd.push({
      id: RULE_ID_OAUTH,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          { header: "authorization", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: `OAuth ${oauthToken}` }
        ]
      },
      condition: {
        urlFilter: "*://api-v2.soundcloud.com/*",
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
        ]
      }
    });
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rulesToRemove,
      addRules: rulesToAdd
    });
    logger.logInfo(`OAuth DNR rule updated. Token: ${oauthToken ? "SET" : "REMOVED"}`);
  } catch (error) {
    logger.logError("Failed to update DNR rules for OAuth token:", error);
  }
}
async function updateClientIdRule(clientId) {
  if (!(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
    logger.logDebug("Skipping DNR update for ClientID: Not a Chrome MV3+ env or DNR unavailable.");
    return;
  }
  const rulesToAdd = [];
  const rulesToRemove = [RULE_ID_CLIENT_ID];
  if (clientId) {
    rulesToAdd.push({
      id: RULE_ID_CLIENT_ID,
      priority: 2,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: "client_id", value: clientId }]
            }
          }
        }
      },
      condition: {
        urlFilter: "*://api-v2.soundcloud.com/*",
        excludedRequestDomains: [],
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
      }
    });
    rulesToAdd[0].condition = {
      urlFilter: "*://api-v2.soundcloud.com/*",
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
    };
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rulesToRemove,
      addRules: rulesToAdd
    });
    logger.logInfo(`Client_id DNR rule updated. ClientID: ${clientId ? "SET" : "REMOVED"}`);
  } catch (error) {
    logger.logError("Failed to update DNR rules for client_id:", error);
  }
}
logger.logInfo("Starting with version: " + manifest.version);
loadConfiguration(true).then(async () => {
  logger.logInfo("Initial configuration loaded. Registering message listener and setting initial DNR rules.");
  onMessage(handleIncomingMessage);
  const initialOauthToken = getConfigValue("oauth-token");
  await updateAuthHeaderRule(initialOauthToken);
  const initialClientId = getConfigValue("client-id");
  await updateClientIdRule(initialClientId);
  if (initialOauthToken) {
    await oauthTokenChanged(initialOauthToken);
  }
});
function sendDownloadProgress(tabId, downloadId, progress, error, status, browserDownloadId) {
  if (!downloadId || typeof downloadId !== "string" || downloadId.trim() === "") {
    logger.logError(`Attempted to send download progress with invalid downloadId: ${JSON.stringify(downloadId)}`);
    const callStack = new Error().stack;
    logger.logError(`Call stack for invalid downloadId: ${callStack}`);
    if (progress === 101 || progress === 102) {
      logger.logWarn(`Attempting to send COMPLETION message (${progress}) even with missing downloadId`);
      const fallbackMessage = {
        downloadId: "undefined_completion",
        progress,
        error: typeof error === "string" ? error : error instanceof Error ? error.message : "",
        status,
        completionWithoutId: true,
        timestamp: Date.now(),
        browserDownloadId
        // Include browserDownloadId if it exists
      };
      sendMessageToTab(tabId, fallbackMessage).catch((err) => {
        logger.logError(`Failed to send fallback completion message: ${err}`);
      });
    }
    return;
  }
  let errorMessage = "";
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === "string") {
    errorMessage = error;
  }
  if (progress === 101 || progress === 102) {
    logger.logInfo(`Sending COMPLETION message for download ${downloadId} to tab ${tabId}, progress=${progress}`);
  } else if (progress === 100) {
    logger.logInfo(`Sending FINISHING message for download ${downloadId} to tab ${tabId}`);
  } else if (progress !== void 0 && progress >= 0) {
    logger.logDebug(`Sending progress update for download ${downloadId} to tab ${tabId}, progress=${progress.toFixed(1)}%`);
  }
  const downloadProgressMessage = {
    downloadId,
    progress,
    error: errorMessage,
    status,
    timestamp: Date.now(),
    // Add timestamp to help with matching in content.ts
    browserDownloadId
    // Include browserDownloadId in all messages
  };
  if (progress === 101 || progress === 102) {
    sendMessageToTab(tabId, downloadProgressMessage).catch((err) => {
      logger.logWarn(`Failed to send completion message to tab ${tabId} on first attempt:`, err);
      setTimeout(() => {
        logger.logInfo(`Retrying completion message for download ${downloadId} to tab ${tabId}`);
        sendMessageToTab(tabId, downloadProgressMessage).catch((retryErr) => {
          logger.logError("Failed to send completion message on retry:", retryErr);
        });
      }, 500);
    });
    setTimeout(() => {
      logger.logInfo(`Sending backup completion message for download ${downloadId} to tab ${tabId}`);
      const backupMessage = {
        ...downloadProgressMessage,
        completed: true,
        backupMessage: true,
        timestamp: Date.now()
      };
      sendMessageToTab(tabId, backupMessage).catch((err) => {
        logger.logError("Failed to send backup completion message:", err);
      });
    }, 1e3);
    setTimeout(() => {
      logger.logInfo(`Sending final backup completion message for download ${downloadId} to tab ${tabId}`);
      const finalBackupMessage = {
        ...downloadProgressMessage,
        completed: true,
        backupMessage: true,
        finalBackup: true,
        timestamp: Date.now()
      };
      sendMessageToTab(tabId, finalBackupMessage).catch((err) => {
        logger.logError("Failed to send final backup completion message:", err);
      });
    }, 5e3);
  } else {
    sendMessageToTab(tabId, downloadProgressMessage).catch((err) => {
      logger.logWarn(`Failed to send progress message to tab ${tabId}:`, err);
    });
  }
}
function chunkArray(array, chunkSize) {
  if (chunkSize < 1) throw new Error("Invalid chunk size");
  const chunks = [];
  for (let i2 = 0; i2 < array.length; i2 += chunkSize) {
    const chunk = array.slice(i2, i2 + chunkSize);
    chunks.push(chunk);
  }
  return chunks;
}
const authRegex = new RegExp("OAuth (.+)");
const followerIdRegex = new RegExp("/me/followings/(\\d+)");
onBeforeSendHeaders(
  (details) => {
    if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
      const oauthTokenFromStorage = getConfigValue("oauth-token");
      if (details.requestHeaders) {
        for (let i2 = 0; i2 < details.requestHeaders.length; i2++) {
          if (details.requestHeaders[i2].name.toLowerCase() === "authorization") {
            const authHeader = details.requestHeaders[i2].value;
            const result = authRegex.exec(authHeader);
            if (result && result.length >= 2 && result[1] !== oauthTokenFromStorage) {
              logger.logInfo("Sniffed and storing OAuth token from request header (all envs).");
              storeConfigValue("oauth-token", result[1]);
            }
            break;
          }
        }
      }
      return {};
    }
    let requestHasAuth = false;
    const oauthToken = getConfigValue("oauth-token");
    if (details.requestHeaders) {
      for (let i2 = 0; i2 < details.requestHeaders.length; i2++) {
        if (details.requestHeaders[i2].name.toLowerCase() === "authorization") {
          requestHasAuth = true;
          const authHeader = details.requestHeaders[i2].value;
          const result = authRegex.exec(authHeader);
          if (result && result.length >= 2 && result[1] !== oauthToken) {
            logger.logInfo("Sniffed and storing OAuth token (Firefox/non-DNR).");
            storeConfigValue("oauth-token", result[1]);
          }
          break;
        }
      }
      if (!requestHasAuth && oauthToken) {
        details.requestHeaders.push({
          name: "Authorization",
          value: "OAuth " + oauthToken
        });
        return { requestHeaders: details.requestHeaders };
      }
    }
    return {};
  },
  ["*://api-v2.soundcloud.com/*"],
  ["blocking", "requestHeaders"]
);
onBeforeRequest(
  (details) => {
    const url = new URL(details.url);
    if (url.pathname === "/connect/session" && getConfigValue("oauth-token") === null) {
      logger.logInfo("User logged in - clearing potentially stale token.");
      storeConfigValue("oauth-token", void 0);
    } else if (url.pathname === "/sign-out") {
      logger.logInfo("User logged out");
      storeConfigValue("oauth-token", null);
      storeConfigValue("user-id", null);
      storeConfigValue("followed-artists", []);
    } else if (url.pathname.startsWith("/me/followings/")) {
      const followerIdMatch = followerIdRegex.exec(url.pathname);
      if (followerIdMatch && followerIdMatch.length === 2) {
        const followerId = +followerIdMatch[1];
        if (followerId) {
          let followedArtists = getConfigValue("followed-artists") || [];
          if (details.method === "POST") {
            if (!followedArtists.includes(followerId)) followedArtists.push(followerId);
          } else if (details.method === "DELETE") {
            followedArtists = followedArtists.filter((i2) => i2 !== followerId);
          }
          storeConfigValue("followed-artists", followedArtists);
        }
      }
    } else {
      const clientIdFromUrl = url.searchParams.get("client_id");
      if (clientIdFromUrl) {
        const storedClientId = getConfigValue("client-id");
        if (clientIdFromUrl !== storedClientId) {
          logger.logInfo(`Found new client_id: ${clientIdFromUrl}. Storing it.`);
          storeConfigValue("client-id", clientIdFromUrl);
        }
      } else {
        if (typeof browser !== "undefined" && !(typeof chrome !== "undefined" && chrome.declarativeNetRequest)) {
          const storedClientId = getConfigValue("client-id");
          if (storedClientId) {
            logger.logDebug(`Adding ClientId to ${details.url} via redirect (Firefox/non-DNR)`);
            url.searchParams.append("client_id", storedClientId);
            return { redirectUrl: url.toString() };
          }
        }
      }
    }
    return {};
  },
  ["*://api-v2.soundcloud.com/*", "*://api-auth.soundcloud.com/*"],
  ["blocking"]
);
onPageActionClicked(() => {
  openOptionsPage();
});
const oauthTokenChanged = async (token) => {
  if (!token) {
    storeConfigValue("user-id", null);
    logger.logInfo("OAuth token cleared, user ID cleared.");
    return;
  }
  const user = await soundcloudApi.getCurrentUser();
  if (!user) {
    logger.logError("Failed to fetch currently logged in user (after token change/init)");
    return;
  }
  storeConfigValue("user-id", user.id);
  logger.logInfo("Logged in as", user.username);
  const followedArtistIds = await soundcloudApi.getFollowedArtistIds(user.id);
  if (!followedArtistIds) {
    logger.logError("Failed to fetch ids of followed artists");
    return;
  }
  storeConfigValue("followed-artists", followedArtistIds);
};
registerConfigChangeHandler("oauth-token", async (newValue) => {
  await updateAuthHeaderRule(newValue);
  await oauthTokenChanged(newValue);
});
registerConfigChangeHandler("client-id", async (newClientId) => {
  logger.logInfo(`client-id config changed to: ${newClientId}. Updating DNR rule.`);
  await updateClientIdRule(newClientId);
});
