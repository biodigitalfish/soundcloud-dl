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

  resolveUrl<T>(url: string) {
    const reqUrl = `${this.baseUrl}/resolve?url=${url}`;

    return this.fetchJson<T>(reqUrl);
  }

  getCurrentUser() {
    const url = `${this.baseUrl}/me`;

    return this.fetchJson<User>(url);
  }

  async getFollowedArtistIds(userId: number): Promise<number[]> {
    const url = `${this.baseUrl}/users/${userId}/followings/ids`;

    const data = await this.fetchJson<any>(url);

    if (!data || !data.collection) return null;

    return data.collection;
  }

  async getTracks(trackIds: number[]): Promise<KeyedTracks> {
    const url = `${this.baseUrl}/tracks?ids=${trackIds.join(",")}`;

    this.logger.infoInfo("Fetching tracks with Ids", { trackIds });

    const tracks = await this.fetchJson<Track>(url);

    return trackIds.reduce((acc, cur, index) => {
      acc[cur] = tracks[index];

      return acc;
    }, {});
  }

  async getStreamDetails(url: string): Promise<StreamDetails> {
    const stream = await this.fetchJson<Stream>(url);

    if (!stream || !stream.url) {
      this.logger.infoError("Invalid stream response", stream);

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
    this.logger.infoInfo("Getting original download URL for track with Id", id);

    try {
      const downloadObj = await this.fetchJson<OriginalDownload>(url);
      if (!downloadObj || !downloadObj.redirectUri) {
        this.logger.infoError("Invalid original file response", downloadObj);
        return null;
      }
      return downloadObj.redirectUri;
    } catch (_error) {
      this.logger.infoError(`Failed to get original download URL for track ${id}`, _error);
      return null;
    }
  }

  async downloadArtwork(artworkUrl: string) {
    const [buffer] = await this.fetchArrayBuffer(artworkUrl);
    return buffer;
  }

  downloadStream(streamUrl: string, reportProgress: ProgressReport) {
    return this.fetchArrayBuffer(streamUrl, reportProgress);
  }

  private async fetchArrayBuffer(url: string, reportProgress?: ProgressReport): Promise<[ArrayBuffer | null, Headers | null]> {
    try {
      const response = await fetch(url); // Always use fetch

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.infoDebug(`[fetchArrayBuffer] Resource not found (404) for ${url}`);
          return [null, response.headers]; // Return null buffer, but valid headers
        }
        if (response.status === 429) {
          this.logger.infoWarn(`[fetchArrayBuffer] Rate limited (429) while fetching ${url}.`);
          throw new RateLimitError(`Rate limited (status 429) on ${url}`);
        }
        // For other non-OK statuses (5xx, 403, etc.)
        const errorText = `[fetchArrayBuffer] HTTP error for ${url} - Status: ${response.status} ${response.statusText}`;
        throw new Error(errorText);
      }

      if (!response.body) {
        // This case should ideally not happen for a successful response, but good to guard.
        this.logger.infoError(`Response for ${url} has no body, despite response.ok being true.`);
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
        this.logger.infoWarn(`[fetchArrayBuffer] Fetched ${url} (Status: ${response.status}) but received an empty (0 bytes) buffer.`);
        // Decide if this should be an error or return [null, headers]
        // For now, returning the empty buffer as it is technically what was received.
      }

      return [completeBuffer, response.headers];

    } catch (error) {
      this.logger.infoError(`[fetchArrayBuffer] Generic error for ${url}:`, error);
      // To keep original behavior of throwing specific RateLimitError or generic Error:
      if (error instanceof RateLimitError) {
        throw error;
      }
      // Ensure a generic error is thrown if it's not already one of our specific types or a standard Error
      throw new Error(`Failed to fetch array buffer from ${url}: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  private async fetchJson<T>(url: string) {
    try {
      const resp = await fetch(url);

      if (!resp.ok) {
        if (resp.status === 429) {
          const errorMsg = `Rate limited while fetching from ${url}. Please wait and try again later.`;
          this.logger.infoWarn(errorMsg);
          throw new RateLimitError(errorMsg);
        } else {
          const errorMsg = `HTTP error ${resp.status} while fetching from ${url}`;
          this.logger.infoError(errorMsg);
          throw new Error(errorMsg);
        }
      }

      const json = (await resp.json()) as T;

      if (!json) return null;

      return json;
    } catch (error) {
      this.logger.infoError("Failed to fetch JSON from", url);

      return null;
    }
  }
}
