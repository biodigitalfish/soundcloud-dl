import { Logger } from "../utils/logger";

// --- Define custom error for rate limiting ---
class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
// ---------------------------------------------

interface MediaTranscodingFormat {
  protocol: "progressive" | "hls";
  mime_type: string;
}

interface MediaTranscoding {
  snipped: boolean;
  quality: "sq" | "hq";
  url: string;
  format: MediaTranscodingFormat;
}

interface Media {
  transcodings: MediaTranscoding[];
}

interface User {
  id: number;
  username: string;
  avatar_url: string;
  permalink: string;
}

export interface Track {
  id: number;
  duration: number; // in ms
  display_date: string;
  kind: string;
  state: string;
  title: string;
  artwork_url: string;
  streamable: boolean;
  downloadable: boolean;
  has_downloads_left: boolean;
  user: User;
  media: Media;
}

interface Stream {
  url: string;
}

export interface StreamDetails {
  url: string;
  extension?: string;
  hls: boolean;
}

interface OriginalDownload {
  redirectUri: string;
}

type KeyedTracks = { [key: number]: Track };
type ProgressReport = (progress: number) => void;

export interface Playlist {
  id: number;
  kind: string; // e.g., "playlist", "album"
  permalink_url: string;
  title: string;
  track_count: number;
  tracks: Track[];
  user: User;
  set_type?: string; // e.g., "album", "ep", "playlist"
}

export class SoundCloudApi {
  readonly baseUrl: string = "https://api-v2.soundcloud.com";
  private logger: Logger;
  private globalBackoffUntil: number | null = null;
  private globalBackoffDurationMs: number = 61 * 1000; // 60 seconds

  constructor() {
    this.logger = Logger.create("SoundCloudApi");
  }

  // --- Retry with backoff utility ---
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries: number = 3, // Default retries for most operations
    initialDelayMs: number = 2000, // 2 seconds
    contextString?: string
  ): Promise<T> {
    // Check and wait for global backoff before starting any attempts for this operation
    if (this.globalBackoffUntil && Date.now() < this.globalBackoffUntil) {
      const waitTime = this.globalBackoffUntil - Date.now();
      this.logger.logWarn(`[Global Backoff] Active. Waiting for ${Math.ceil(waitTime / 1000)}s before proceeding with ${contextString || "operation"}.`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // Optimistically clear global backoff after this specific operation's wait,
      // allowing it to proceed. If it fails again with 429, it will be re-set below.
      this.logger.logInfo(`[Global Backoff] Wait completed for ${contextString || "operation"}. Optimistically clearing global trigger.`);
      this.globalBackoffUntil = null;
    }

    let attempt = 0;
    let delay = initialDelayMs;
    while (attempt <= retries) {
      try {
        // It's possible globalBackoffUntil was set by a *concurrent* operation
        // between the initial check above and this attempt. Re-check.
        if (attempt > 0 && this.globalBackoffUntil && Date.now() < this.globalBackoffUntil) {
          const waitTime = this.globalBackoffUntil - Date.now();
          this.logger.logWarn(`[Global Backoff] Re-activated during retries. Waiting for ${Math.ceil(waitTime / 1000)}s for ${contextString || "operation"}.`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          this.logger.logInfo(`[Global Backoff] Secondary wait completed for ${contextString || "operation"}. Optimistically clearing global trigger.`);
          this.globalBackoffUntil = null; // Optimistic clear again
        }

        this.logger.logDebug(`[Retry] Attempt ${attempt + 1}/${retries + 1} for ${contextString || "operation"}`);
        const result = await fn();

        // If fn() was successful, and if global backoff was set by some other failing operation,
        // this success can be a signal to clear it.
        if (this.globalBackoffUntil !== null) {
          this.logger.logInfo(`[${contextString || "operation"}] Succeeded. Clearing active global backoff trigger.`);
          this.globalBackoffUntil = null;
        }
        return result;

      } catch (error: any) { // Catch 'any' to handle different error types robustly
        if (error instanceof RateLimitError) {
          if (attempt < retries) {
            attempt++;
            this.logger.logWarn(`[Retry] Rate limit hit for ${contextString || "operation"}. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${retries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 30000); // Exponential backoff, cap at 30s for local retries
          } else {
            // Local retries exhausted for a RateLimitError, THIS is when we activate global backoff
            this.logger.logError(`[Retry] Failed for ${contextString || "operation"} after ${attempt + 1} attempts due to persistent rate limit. Activating global backoff.`);
            this.globalBackoffUntil = Date.now() + this.globalBackoffDurationMs;
            this.logger.logWarn(`[Global Backoff] Activated for ${this.globalBackoffDurationMs / 1000}s due to persistent rate limiting on ${contextString || "operation"}.`);
            throw error; // Re-throw the RateLimitError
          }
        } else {
          // Non-RateLimitError, or some other unexpected error from fn()
          this.logger.logError(`[Retry] Failed for ${contextString || "operation"} with non-retryable or unexpected error after ${attempt + 1} attempts:`, error.message || error);
          throw error; // Re-throw non-RateLimitError or if retries exhausted
        }
      }
    }
    // Fallback for loop completion without return/throw (should ideally not be reached)
    const finalErrorMsg = `[Retry] Exhausted retries for ${contextString || "operation"} without explicit success or failure handling.`;
    this.logger.logError(finalErrorMsg);
    throw new Error(finalErrorMsg);
  }
  // --- End Retry with backoff utility ---

  resolveUrl<T>(url: string) {
    const reqUrl = `${this.baseUrl}/resolve?url=${url}`;
    return this.retryWithBackoff(() => this._fetchJsonInternal<T>(reqUrl), 3, 2000, `resolveUrl: ${url}`);
  }

  getCurrentUser() {
    const url = `${this.baseUrl}/me`;
    return this.retryWithBackoff(() => this._fetchJsonInternal<User>(url), 3, 2000, "getCurrentUser");
  }

  async getFollowedArtistIds(userId: number): Promise<number[]> {
    const url = `${this.baseUrl}/users/${userId}/followings/ids`;
    const data = await this.retryWithBackoff(() => this._fetchJsonInternal<any>(url), 3, 2000, `getFollowedArtistIds: ${userId}`);
    if (!data || !data.collection) return null;
    return data.collection;
  }

  async getTracks(trackIds: number[]): Promise<KeyedTracks> {
    const url = `${this.baseUrl}/tracks?ids=${trackIds.join(",")}`;
    this.logger.logInfo("Fetching tracks with Ids", { trackIds });
    const tracks = await this.retryWithBackoff(() => this._fetchJsonInternal<Track[]>(url), 3, 2000, `getTracks: ${trackIds.length} IDs`);
    return trackIds.reduce((acc, cur, index) => {
      acc[cur] = tracks[index];
      return acc;
    }, {});
  }

  async getStreamDetails(url: string): Promise<StreamDetails> {
    const stream = await this.retryWithBackoff(() => this._fetchJsonInternal<Stream>(url), 3, 2000, `getStreamDetails: ${url}`);
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
      hls,
    };
  }

  async getOriginalDownloadUrl(id: number): Promise<string | null> {
    const url = `${this.baseUrl}/tracks/${id}/download`;
    this.logger.logInfo("Getting original download URL for track with Id", id);
    try {
      const downloadObj = await this.retryWithBackoff(() => this._fetchJsonInternal<OriginalDownload>(url), 3, 2000, `getOriginalDownloadUrl: ${id}`);
      if (!downloadObj || !downloadObj.redirectUri) {
        this.logger.logError("Invalid original file response", downloadObj);
        return null;
      }
      return downloadObj.redirectUri;
    } catch (_error) {
      this.logger.logError(`Failed to get original download URL for track ${id} after retries`, _error);
      return null;
    }
  }

  async downloadArtwork(artworkUrl: string) {
    const [buffer] = await this.retryWithBackoff(() => this._fetchArrayBufferInternal(artworkUrl), 3, 2000, `downloadArtwork: ${artworkUrl}`);
    return buffer;
  }

  downloadStream(streamUrl: string, reportProgress: ProgressReport) {
    return this.retryWithBackoff(() => this._fetchArrayBufferInternal(streamUrl, reportProgress), 3, 1000, `downloadStream: ${streamUrl}`);
  }

  private async _fetchArrayBufferInternal(url: string, reportProgress?: ProgressReport): Promise<[ArrayBuffer | null, Headers | null]> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.logDebug(`[fetchArrayBuffer] Resource not found (404) for ${url}`);
          return [null, response.headers]; // Return null buffer, but valid headers
        }
        if (response.status === 429) {
          this.logger.logWarn(`[fetchArrayBuffer] Rate limited (429) while fetching ${url}.`);
          throw new RateLimitError(`Rate limited (status 429) on ${url}`);
        }
        // For other non-OK statuses (5xx, 403, etc.)
        const errorText = `[fetchArrayBuffer] HTTP error for ${url} - Status: ${response.status} ${response.statusText}`;
        throw new Error(errorText);
      }

      if (!response.body) {
        // This case should ideally not happen for a successful response, but good to guard.
        this.logger.logError(`Response for ${url} has no body, despite response.ok being true.`);
        throw new Error(`Response for ${url} has no body.`);
      }

      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();

      if (reportProgress && total > 0) {
        reportProgress(0); // Initial progress
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value); // value is Uint8Array
        loaded += value.byteLength;
        if (reportProgress && total > 0) {
          reportProgress(Math.round((loaded / total) * 100));
        }
      }

      if (reportProgress) {
        // Ensure 100% is reported if all chunks are read, even if total was 0 or Content-Length was missing
        reportProgress(100);
      }

      // Concatenate chunks into a single ArrayBuffer
      const completeBuffer = new ArrayBuffer(loaded);
      const view = new Uint8Array(completeBuffer);
      let offset = 0;
      for (const chunk of chunks) {
        view.set(chunk, offset);
        offset += chunk.byteLength;
      }

      // Check for genuinely empty buffer after successful download, which might be an issue.
      if (loaded === 0 && response.status === 200) {
        this.logger.logWarn(`[fetchArrayBuffer] Fetched ${url} (Status: ${response.status}) but received an empty (0 bytes) buffer.`);
        // Decide if this should be an error or return [null, headers]
        // For now, returning the empty buffer as it is technically what was received.
      }

      return [completeBuffer, response.headers];
    } catch (error) {
      this.logger.logError(`[fetchArrayBuffer] Generic error for ${url}:`, error);
      // To keep original behavior of throwing specific RateLimitError or generic Error:
      if (error instanceof RateLimitError) {
        throw error;
      }
      // Ensure a generic error is thrown if it's not already one of our specific types or a standard Error
      throw new Error(`Failed to fetch array buffer from ${url}: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  // Simplified _fetchJsonInternal: it focuses on fetching and throwing specific errors.
  // Global backoff is handled by the caller (retryWithBackoff).
  private async _fetchJsonInternal<T>(url: string, httpMethod: string = "GET", requestBody?: any): Promise<T> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };
    if (httpMethod !== "GET" && httpMethod !== "HEAD") { // HEAD might also not have a body
      headers["Content-Type"] = "application/json";
    }

    // TODO: Add client_id or OAuth token to URL or headers if necessary,
    // this logic might exist elsewhere or need to be integrated here.
    // For now, assuming `url` is the final URL.

    let response: Response;
    try {
      this.logger.logDebug(`[API Fetch] Attempting ${httpMethod} to ${url}`);
      response = await fetch(url, {
        method: httpMethod,
        headers,
        body: requestBody ? JSON.stringify(requestBody) : undefined,
      });
    } catch (networkError: any) {
      this.logger.logError(`[API Fetch] Network error for ${httpMethod} ${url}: ${networkError.message}`, networkError);
      // Throw a generic error for network issues; retryWithBackoff might retry these if configured to.
      throw new Error(`Network error: ${networkError.message}`);
    }

    if (response.ok) {
      const responseText = await response.text();
      if (!responseText && (response.status === 204 || response.status === 202)) { // 204 No Content, 202 Accepted
        this.logger.logDebug(`[API Fetch] Successful ${httpMethod} to ${url} with status ${response.status} (No Content).`);
        return null as T; // Or appropriate representation for "no content"
      }
      if (!responseText) {
        this.logger.logWarn(`[API Fetch] Successful ${httpMethod} to ${url} with status ${response.status} but received an empty response body.`);
        // Depending on T, might return null or throw. For now, returning null.
        return null as T;
      }
      try {
        return JSON.parse(responseText) as T;
      } catch (parseError: any) {
        this.logger.logError(`[API Fetch] Successful ${httpMethod} to ${url} (status ${response.status}) but failed to parse JSON response: ${parseError.message}. Response text: "${responseText.substring(0, 100)}"`);
        throw new Error(`JSON parsing error: ${parseError.message}`); // Propagate as a generic error
      }
    } else if (response.status === 429) {
      const errorMsg = `Rate limited (429) while fetching ${httpMethod} ${url}.`;
      this.logger.logWarn(errorMsg);
      // Throw a specific error type that retryWithBackoff understands
      throw new RateLimitError(errorMsg);
    } else {
      // Handle other HTTP errors (400, 401, 403, 404, 500, etc.)
      const errorText = await response.text().catch(() => `Failed to read error response body for status ${response.status}`);
      const errorMsg = `HTTP error ${response.status} ${response.statusText} for ${httpMethod} ${url}. Response: ${errorText.substring(0, 200)}`;
      this.logger.logError(errorMsg);
      // Throw a generic error; retryWithBackoff might retry some server errors (5xx) if configured,
      // but typically won't retry client errors (4xx) other than 429.
      // For simplicity here, we'll let retryWithBackoff decide based on the error type it receives.
      // If it's not RateLimitError, it will likely be treated as a non-retryable error by the current retryWithBackoff logic.
      throw new Error(errorMsg); // Generic error for other HTTP issues
    }
  }
}
