import { Logger } from "./utils/logger";

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

export class SoundCloudApi {
  readonly baseUrl: string = "https://api-v2.soundcloud.com";
  private logger: Logger;

  constructor() {
    this.logger = Logger.create("SoundCloudApi");
  }

  // --- Retry with backoff utility ---
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries: number = 3,
    initialDelayMs: number = 2000, // 2 seconds
    contextString?: string
  ): Promise<T> {
    let attempt = 0;
    let delay = initialDelayMs;
    while (attempt <= retries) {
      try {
        this.logger.logDebug(`[Retry] Attempt ${attempt + 1}/${retries + 1} for ${contextString || 'operation'}`);
        return await fn();
      } catch (error) {
        if (error instanceof RateLimitError && attempt < retries) {
          attempt++;
          this.logger.logWarn(`[Retry] Rate limit hit for ${contextString || 'operation'}. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${retries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        } else {
          this.logger.logError(`[Retry] Failed for ${contextString || 'operation'} after ${attempt + 1} attempts or non-retryable error:`, error);
          throw error; // Re-throw non-RateLimitError or if retries exhausted
        }
      }
    }
    // Should not be reached if logic is correct, but as a fallback:
    throw new Error(`[Retry] Exhausted retries for ${contextString || 'operation'} without success.`);
  }
  // --- End Retry with backoff utility ---

  resolveUrl<T>(url: string) {
    const reqUrl = `${this.baseUrl}/resolve?url=${url}`;
    return this.retryWithBackoff(() => this._fetchJsonInternal<T>(reqUrl), 3, 2000, `resolveUrl: ${url}`);
  }

  getCurrentUser() {
    const url = `${this.baseUrl}/me`;
    return this.retryWithBackoff(() => this._fetchJsonInternal<User>(url), 3, 2000, `getCurrentUser`);
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

  private async _fetchJsonInternal<T>(url: string) {
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

      const json = (await resp.json()) as T;

      if (!json) return null;

      return json;
    } catch (error) {
      this.logger.logError("Failed to fetch JSON from", url);

      return null;
    }
  }
}
