import { Logger, LogLevel } from "./utils/logger";
import { getConfigValue, storeConfigValue, loadConfigValue } from "./utils/config";
import { sanitizeFilenameForDownload, concatArrayBuffers } from "./utils/download";
import { SoundCloudApi, Track, StreamDetails } from "./soundcloudApi";
import { ffmpeg, loadFFmpeg } from "./ffmpeg";
import { Mp3TagWriter } from "./tagWriters/mp3TagWriter";
import { Mp4TagWriter } from "./tagWriters/mp4TagWriter";
import { TagWriter } from "./tagWriters/tagWriter";
import { downloadToFile, searchDownloads } from "./compatibilityStubs";
import { MetadataExtractor, ArtistType, RemixType } from "./metadataExtractor";
import { DownloadData, TranscodingDetails } from "./types";
import { Parser } from "m3u8-parser";
import { createURLFromBlob, revokeURL, isServiceWorkerContext } from "./utils/browser";

// Re-define or import TrackError if it's thrown or caught here
export class TrackError extends Error {
    constructor(message: string, trackId: number) {
        super(`${message} (TrackId: ${trackId})`);
    }
}

const logger = Logger.create("DownloadHandler", LogLevel.Debug);
const soundcloudApi = new SoundCloudApi(); // This might need to be passed in or instantiated differently

// --- HELPER FUNCTIONS AND INTERFACE FOR downloadTrack (MOVED FROM BACKGROUND.TS) ---
function isValidTrack(track: Track): boolean {
    return track && track.kind === "track" && track.state === "finished" && (track.streamable || track.downloadable);
}

function isTranscodingDetails(detail: unknown): detail is TranscodingDetails {
    return typeof detail === "object" && detail !== null && "protocol" in detail;
}

function getTranscodingDetails(details: Track): TranscodingDetails[] | null {
    if (details?.media?.transcodings?.length < 1) return null;
    const mpegStreams = details.media.transcodings
        .filter(
            (transcoding) =>
                (transcoding.format?.protocol === "progressive" || transcoding.format?.protocol === "hls") &&
                (transcoding.format?.mime_type?.startsWith("audio/mpeg") ||
                    transcoding.format?.mime_type?.startsWith("audio/mp4")) &&
                !transcoding.snipped
        )
        .map<TranscodingDetails>((transcoding) => ({
            protocol: transcoding.format.protocol as "hls" | "progressive",
            url: transcoding.url,
            quality: transcoding.quality as "hq" | "sq",
        }));

    if (mpegStreams.length < 1) {
        logger.logWarn("[DownloadHandler] No transcodings streams could be determined for Track " + details.id);
        return null;
    }
    let streams = mpegStreams.sort((a, b) => {
        if (a.quality === "hq" && b.quality === "sq") return -1;
        if (a.quality === "sq" && b.quality === "hq") return 1;
        if (a.protocol === "progressive" && b.protocol === "hls") return -1;
        if (a.protocol === "hls" && b.protocol === "progressive") return 1;
        return 0;
    });
    if (!getConfigValue("download-hq-version")) {
        streams = streams.filter((stream) => stream.quality !== "hq");
    }
    if (streams.some((stream) => stream.quality === "hq")) {
        logger.logInfo("[DownloadHandler] Including high quality streams for Track " + details.id);
    }
    return streams;
}
// --- END HELPER FUNCTIONS ---

// MOVED FROM BACKGROUND.TS - Now part of DownloadHandler module
export async function downloadTrack(
    track: Track,
    trackNumber: number | undefined,
    albumName: string | undefined,
    playlistNameString: string | undefined,
    reportProgress: (progress?: number) => void
): Promise<number> {
    if (!isValidTrack(track)) { // Uses local helper
        logger.logError("[DownloadHandler] Track does not satisfy constraints needed to be downloadable", track);
        // Use the TrackError defined in this module
        throw new TrackError("Track does not satisfy constraints needed to be downloadable", track.id);
    }

    const downloadDetails: Array<StreamDetails | TranscodingDetails> = [];

    if (getConfigValue("download-original-version") && track.downloadable && track.has_downloads_left) {
        // Uses the soundcloudApi instance from this module
        const originalDownloadUrl = await soundcloudApi.getOriginalDownloadUrl(track.id);
        if (originalDownloadUrl) {
            const stream: StreamDetails = {
                url: originalDownloadUrl,
                hls: false,
                extension: undefined, // original_format issue handled, relying on handleDownload inference
            };
            downloadDetails.push(stream);
        }
    }

    const transcodingDetailsResult = getTranscodingDetails(track); // Uses local helper
    if (transcodingDetailsResult) {
        downloadDetails.push(...transcodingDetailsResult);
    }

    if (downloadDetails.length < 1) {
        const errorMessage = `[DownloadHandler] No download details could be determined for track: "${track.title}"`;
        throw new TrackError(errorMessage, track.id); // Use local TrackError
    }

    for (const downloadDetail of downloadDetails) {
        let stream: StreamDetails | null = null;
        let hlsUsed = false;
        let resolvedStreamUrl: string | null = null;
        let resolvedExtension: string | undefined = undefined;

        try {
            if (isTranscodingDetails(downloadDetail)) { // Uses local helper
                logger.logDebug(`[DownloadHandler TrackId: ${track.id}] Getting stream details for transcoding`, downloadDetail);
                // Uses the soundcloudApi instance from this module
                stream = await soundcloudApi.getStreamDetails(downloadDetail.url);
                if (stream) {
                    hlsUsed = stream.hls;
                    resolvedStreamUrl = stream.url;
                    resolvedExtension = stream.extension;
                } else {
                    logger.logWarn(`[DownloadHandler TrackId: ${track.id}] Failed to get stream details for transcoding option (url: ${downloadDetail.url}), trying next...`);
                    continue;
                }
            } else {
                stream = downloadDetail as StreamDetails;
                resolvedStreamUrl = stream.url;
                hlsUsed = stream.hls;
                resolvedExtension = stream.extension;
                logger.logDebug(`[DownloadHandler TrackId: ${track.id}] Using direct download detail (original file?)`, { url: resolvedStreamUrl, hls: hlsUsed, extension: resolvedExtension });
            }

            if (!resolvedStreamUrl) {
                logger.logWarn(`[DownloadHandler TrackId: ${track.id}] No stream URL resolved, trying next...`, { downloadDetail });
                continue;
            }

            let finalStreamUrl = resolvedStreamUrl;
            let finalHlsFlag = hlsUsed;

            const downloadData: DownloadData = {
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
                hls: finalHlsFlag,
            };

            logger.logDebug(`[DownloadHandler TrackId: ${track.id}] Calling handleDownload with data`, { downloadData });
            // Calls handleDownload from the same module and gets the downloadId
            const downloadId = await handleDownload(downloadData, reportProgress);
            logger.logInfo(`[DownloadHandler TrackId: ${track.id}] handleDownload completed successfully for stream: ${finalStreamUrl} with downloadId: ${downloadId}`);
            reportProgress(101);
            return downloadId; // Return the downloadId up the chain

        } catch (error) {
            logger.logWarn(
                `[DownloadHandler TrackId: ${track.id}] Download attempt failed for option. Error: ${error?.message || error}`,
                { downloadDetail, streamUrl: resolvedStreamUrl }
            );
            // Error from handleDownload will be TrackError instance from this file.
        }
    }

    logger.logError(`[DownloadHandler TrackId: ${track.id}] All download attempts failed after trying ${downloadDetails.length} options.`);
    reportProgress(102);
    // Use the TrackError defined in this module
    throw new TrackError("No version of this track could be downloaded", track.id);
}

export async function handleDownload(data: DownloadData, reportProgress: (progress?: number) => void): Promise<number> {
    // --- DEBUG START: Moved to very beginning ---
    logger.logDebug(`[handleDownload ENTRY] Processing TrackId: ${data.trackId}. History check comes later.`);
    // --- DEBUG END ---

    let artistsString = data.username;
    let titleString = data.title;
    let rawFilenameBase: string;
    let artworkUrl = data.artworkUrl;
    let streamBuffer: ArrayBuffer | undefined;
    let streamHeaders: Headers | undefined;

    // Hoisted variables for broader scope across new try-catch blocks
    let saveAs: boolean;
    let defaultDownloadLocation: string | undefined | null;
    let shouldSkipExisting: boolean;
    let determinedContentType: string | null | undefined;
    let finalDownloadFilename: string;
    let objectUrlToRevoke: string | undefined;
    let potentialDownloadFilename: string;

    try {
        // SECTION 1: Metadata processing & rawFilenameBase creation
        try {
            logger.logInfo(`Initiating metadata processing for ${data.trackId} with payload`, { payload: data });
            if (getConfigValue("normalize-track")) {
                const extractor = new MetadataExtractor(data.title, data.username, data.userPermalink);
                let artists = extractor.getArtists();
                if (!getConfigValue("include-producers")) artists = artists.filter((i) => i.type !== ArtistType.Producer);
                artistsString = artists.map((i) => i.name).join(", ");
                titleString = extractor.getTitle();
                const remixers = artists.filter((i) => i.type === ArtistType.Remixer);
                if (remixers.length > 0) {
                    const remixerNames = remixers.map((i) => i.name).join(" & ");
                    const remixTypeString = RemixType[remixers[0].remixType || RemixType.Remix].toString();
                    titleString += ` (${remixerNames} ${remixTypeString})`;
                }
            }

            if (!artistsString) artistsString = "Unknown";
            if (!titleString) titleString = "Unknown";

            rawFilenameBase = sanitizeFilenameForDownload(`${artistsString} - ${titleString}`);
        } catch (error) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during metadata processing:`, error);
            throw new TrackError(`Metadata processing failed for track ${data.trackId}: ${(error as Error).message}`, data.trackId);
        }

        // Initialize config-dependent hoisted variables here, AFTER rawFilenameBase is set
        saveAs = !getConfigValue("download-without-prompt");
        defaultDownloadLocation = getConfigValue("default-download-location");
        shouldSkipExisting = getConfigValue("skipExistingFiles");

        // SECTION 2: Filename and Skip Logic (uses rawFilenameBase)
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

                logger.logDebug(`[History Check] shouldSkipExisting=${shouldSkipExisting}, trackIdKey=${trackIdKey}, history exists=${!!trackDownloadHistory}`);
                if (Object.keys(trackDownloadHistory).length > 0) {
                    logger.logDebug(`[History Check] History has ${Object.keys(trackDownloadHistory).length} entries`);
                }

                if (trackDownloadHistory && trackDownloadHistory[trackIdKey]) {
                    const previousDownload = trackDownloadHistory[trackIdKey];
                    logger.logInfo(`Skipping download for TrackId: ${data.trackId}. Previously downloaded as: ${previousDownload.filename} at ${new Date(previousDownload.timestamp).toLocaleString()}`);
                    reportProgress(101);
                    // Generate a fake download ID for the UI to use when skipping downloads
                    const fakeDownloadId = Math.floor(Math.random() * 1000000) + 1000;
                    logger.logInfo(`Using fake download ID ${fakeDownloadId} for skipped track ${data.trackId}`);
                    return fakeDownloadId;
                }

                const specificFilename = `${pathPrefix}${rawFilenameBase}.${data.fileExtension || "mp3"}`;
                const exactQuery: chrome.downloads.DownloadQuery = { filename: specificFilename };
                logger.logDebug(`[History Check] Searching downloads with exactQuery: ${JSON.stringify(exactQuery)}`);
                const exactMatches = await searchDownloads(exactQuery);
                logger.logDebug(`[History Check] exactMatches found: ${exactMatches.length}`);

                const escapedPathPrefix = pathPrefix.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&");
                const escapedRawFilenameBase = rawFilenameBase.replace(/[-/^$*+?.()|[\]{}]/g, "\\$&");
                const regexQuery: chrome.downloads.DownloadQuery = { filenameRegex: `^${escapedPathPrefix}${escapedRawFilenameBase}\\..+$` };
                logger.logDebug(`[History Check] Searching downloads with regexQuery: ${JSON.stringify(regexQuery)}`);
                const regexMatches = exactMatches.length === 0 ? await searchDownloads(regexQuery) : [];
                logger.logDebug(`[History Check] regexMatches found: ${regexMatches.length}`);

                const filenameWithoutPathRegex = `${escapedRawFilenameBase}\\..+$`;
                const titleArtistQuery: chrome.downloads.DownloadQuery = { filenameRegex: filenameWithoutPathRegex };
                logger.logDebug(`[History Check] Searching downloads with titleArtistQuery: ${JSON.stringify(titleArtistQuery)}`);
                const titleArtistMatches = exactMatches.length === 0 && regexMatches.length === 0 ?
                    await searchDownloads(titleArtistQuery) : [];
                logger.logDebug(`[History Check] titleArtistMatches found: ${titleArtistMatches.length}`);

                const allMatches = [...exactMatches, ...regexMatches, ...titleArtistMatches];
                const completedDownloads = allMatches.filter(d => d.state === "complete");

                if (completedDownloads.length > 0) {
                    logger.logInfo(`Skipping download for TrackId: ${data.trackId}. File already exists in download history: ${completedDownloads[0].filename}`);
                    // Log the first few matches to help with debugging
                    if (completedDownloads.length > 0) {
                        completedDownloads.slice(0, 3).forEach((download, i) => {
                            logger.logDebug(`[History Check] Match ${i}: filename=${download.filename}, state=${download.state}`);
                        });
                    }

                    trackDownloadHistory[trackIdKey] = {
                        filename: completedDownloads[0].filename,
                        timestamp: Date.now()
                    };
                    await storeConfigValue("track-download-history", trackDownloadHistory);
                    reportProgress(101);
                    // Generate a fake download ID for the UI to use when skipping downloads
                    const fakeDownloadId = Math.floor(Math.random() * 1000000) + 1000;
                    logger.logInfo(`Using fake download ID ${fakeDownloadId} for already downloaded track ${data.trackId}`);
                    return fakeDownloadId;
                } else {
                    logger.logDebug(`No matching downloads found for TrackId: ${data.trackId} with filename base "${rawFilenameBase}"`);
                }
            } else {
                logger.logDebug("[History Check] Skip existing files check is disabled");
            }
        } catch (error) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during filename/skip logic:`, error);
            throw new TrackError(`Filename/skip logic failed for track ${data.trackId}: ${(error as Error).message}`, data.trackId);
        }

        // SECTION 3: Artwork URL handling (updates artworkUrl used for tagging)
        try {
            if (!artworkUrl) {
                logger.logInfo(`No Artwork URL in data. Fallback to User Avatar (TrackId: ${data.trackId})`);
                artworkUrl = data.avatarUrl;
            }
        } catch (error) {
            logger.logWarn(`[DownloadHandler TrackId: ${data.trackId}] Error checking/falling back artwork URL: ${(error as Error).message}. Will attempt with current value.`);
        }

        logger.logInfo(`Starting download of '${rawFilenameBase}' (TrackId: ${data.trackId})...`);

        let originalStreamBuffer: ArrayBuffer | undefined;

        // SECTION 4: Downloading (HLS/Progressive), Extension Inference, FFmpeg
        try {
            if (data.hls) {
                logger.logInfo(`[TrackId: ${data.trackId}] Starting HLS segment fetching from: ${data.streamUrl}`);
                const [playlistBuffer, initialHeaders] = await soundcloudApi.downloadStream(data.streamUrl, (p) => {
                    if (p !== undefined) reportProgress(p * 0.1);
                });
                streamHeaders = initialHeaders;
                if (!playlistBuffer) throw new Error("HLS playlist download failed or returned empty buffer.");
                const playlistText = new TextDecoder().decode(playlistBuffer);
                const parser = new Parser();
                parser.push(playlistText);
                parser.end();
                let initSegmentBuffer: ArrayBuffer | null = null;
                if (parser.manifest?.segments?.length > 0) {
                    const segmentWithMap = parser.manifest.segments.find(seg => seg.map?.uri);
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
                        const [initData] = await soundcloudApi.downloadStream(initSegmentFullUrl, (p) => { if (p !== undefined) reportProgress(5 + (p * 0.05)); });
                        if (!initData) throw new Error(`Failed to download HLS init segment: ${initSegmentFullUrl}`);
                        initSegmentBuffer = initData;
                    }
                }
                let segmentUris: string[] = [];
                if (parser.manifest?.segments?.length > 0) {
                    segmentUris = parser.manifest.segments.map(segment => {
                        try { return new URL(segment.uri, data.streamUrl).href; } catch (_e) {
                            if (segment.uri.startsWith("http://") || segment.uri.startsWith("https://")) return segment.uri;
                            throw new Error(`Failed to resolve relative HLS segment URI: ${segment.uri}`);
                        }
                    });
                }
                if (segmentUris.length === 0 && !initSegmentBuffer) throw new Error("HLS playlist contains no media segments or init segment.");
                const segments: ArrayBuffer[] = [];
                const totalSegments = segmentUris.length;
                const segmentProgressStart = initSegmentBuffer ? 10 : 5;
                const segmentProgressRange = initSegmentBuffer ? 80 : 85;
                for (let i = 0; i < totalSegments; i++) {
                    const [segmentData] = await soundcloudApi.downloadStream(segmentUris[i], (p_segment) => {
                        if (p_segment !== undefined) reportProgress(segmentProgressStart + ((i + (p_segment / 100)) / totalSegments) * segmentProgressRange);
                    });
                    if (!segmentData) throw new Error(`Failed to download HLS segment: ${segmentUris[i]}`);
                    segments.push(segmentData);
                    const rateLimitMs = (getConfigValue("hls-rate-limit-delay-ms") as number | undefined) ?? 0;
                    if (rateLimitMs > 0 && i < totalSegments - 1) await new Promise(resolve => setTimeout(resolve, rateLimitMs));
                }
                const buffersToConcat: ArrayBuffer[] = [];
                if (initSegmentBuffer) buffersToConcat.push(initSegmentBuffer);
                buffersToConcat.push(...segments);
                streamBuffer = concatArrayBuffers(buffersToConcat);
                data.hls = false;
            } else {
                [streamBuffer, streamHeaders] = await soundcloudApi.downloadStream(data.streamUrl, reportProgress);
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
                    let progressHandlerFfmpeg: (({ progress }: { progress: number; }) => void) | undefined;
                    try {
                        await ffmpeg.writeFile(inputFilename, new Uint8Array(originalStreamBuffer));
                        const ffmpegArgs = ["-loglevel", "warning", "-i", inputFilename, "-c", "copy", outputFilename];
                        let lastReportedFFmpegProgress = -1;
                        progressHandlerFfmpeg = ({ progress }: { progress: number }) => {
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
                        logger.logError("[FFMPEG_WASM] Error during remux. Proceeding with original.", ffmpegError);
                        streamBuffer = originalStreamBuffer.slice(0);
                    } finally {
                        if (progressHandlerFfmpeg && typeof ffmpeg.off === "function") ffmpeg.off("progress", progressHandlerFfmpeg);
                    }
                } else {
                    logger.logWarn("[FFMPEG_WASM] Remux skipped as FFmpeg failed to load.");
                }
            }
        } catch (error) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during download/FFmpeg stage:`, error);
            throw new TrackError(`Download/FFmpeg failed for track ${data.trackId}: ${(error as Error).message}`, data.trackId);
        }

        let taggedBuffer: ArrayBuffer | undefined;

        // SECTION 5: Metadata Tagging (uses artistsString, titleString from SECTION 1)
        try {
            const setMetadata = getConfigValue("set-metadata");
            if (setMetadata && streamBuffer) {
                let writer: TagWriter | undefined;
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
                            logger.logWarn(`[Artwork] Failed to fetch/set artwork for tagging TrackId: ${data.trackId}`, artworkError);
                        }
                    }

                    const tagWriterResult = await writer.getBuffer();
                    if (tagWriterResult?.buffer?.byteLength > 0) {
                        taggedBuffer = tagWriterResult.buffer;
                    } else {
                        logger.logWarn("[Metadata] TagWriter returned invalid buffer. Using untagged buffer.");
                        taggedBuffer = streamBuffer.slice(0);
                    }
                } else {
                    logger.logWarn(`[TrackId: ${data.trackId}] No TagWriter for ext '${data.fileExtension}'. Using untagged buffer.`);
                    taggedBuffer = streamBuffer.slice(0);
                }
            } else {
                logger.logInfo(`[TrackId: ${data.trackId}] Metadata disabled or no streamBuffer. Using untagged.`);
                taggedBuffer = streamBuffer?.slice(0);
            }
        } catch (error) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Error during metadata tagging:`, error);
            taggedBuffer = streamBuffer?.slice(0);
        }

        let bufferToSave: ArrayBuffer;

        // SECTION 6: Final Buffer Selection and Blob Creation
        try {
            bufferToSave = taggedBuffer?.byteLength > 0 ? taggedBuffer :
                streamBuffer?.byteLength > 0 ? streamBuffer.slice(0) :
                    originalStreamBuffer?.byteLength > 0 ? originalStreamBuffer.slice(0) :
                        (() => { throw new TrackError(`All buffers invalid for ${data.trackId}`, data.trackId); })();
            if (bufferToSave.byteLength < 100) logger.logWarn(`Final buffer small: ${bufferToSave.byteLength} bytes.`);

            const blobOptions: BlobPropertyBag = {};
            if (determinedContentType) blobOptions.type = determinedContentType;
            else if (data.fileExtension === "mp3") blobOptions.type = "audio/mpeg";
            else if (data.fileExtension === "m4a" || data.fileExtension === "mp4") blobOptions.type = "audio/mp4";
            else if (data.fileExtension === "wav") blobOptions.type = "audio/wav";

            const downloadBlob = new Blob([bufferToSave], blobOptions);

            // Use our browser-compatible utility to create the URL
            logger.logInfo(`Creating URL for download (TrackId: ${data.trackId}). Service worker context: ${isServiceWorkerContext()}`);
            objectUrlToRevoke = await createURLFromBlob(downloadBlob);

        } catch (error) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Error preparing final buffer or Blob/DataURL:`, error);
            throw new TrackError(`Failed to prepare buffer/DataURL for track ${data.trackId}: ${(error as Error).message}`, data.trackId);
        }

        finalDownloadFilename = rawFilenameBase + "." + (data.fileExtension || "mp3");
        if (!saveAs && defaultDownloadLocation) {
            // Corrected path construction to avoid potential double slashes if defaultDownloadLocation ends with /
            const base = defaultDownloadLocation.endsWith("/") ? defaultDownloadLocation.slice(0, -1) : defaultDownloadLocation;
            const playlistFolder = data.playlistName ? `/${sanitizeFilenameForDownload(data.playlistName)}` : "";
            const justTheFilename = finalDownloadFilename.split("/").pop() || finalDownloadFilename;
            finalDownloadFilename = `${base}${playlistFolder}/${justTheFilename}`;
        }

        // SECTION 7: File Saving and History Update
        try {
            logger.logInfo(`Downloading track as '${finalDownloadFilename}' (TrackId: ${data.trackId}). SaveAs: ${saveAs}`);
            const urlToDownload = objectUrlToRevoke; // This now holds the data URL

            if (!urlToDownload) {
                throw new Error("Data URL for download is undefined.");
            }

            // Get the downloadId from downloadToFile
            const downloadId = await downloadToFile(urlToDownload, finalDownloadFilename, saveAs);
            logger.logInfo(`Successfully initiated download for '${rawFilenameBase}' (TrackId: ${data.trackId}) with downloadId: ${downloadId}`);

            if (shouldSkipExisting) {
                const histKey = `track-${data.trackId}`;
                const history = await loadConfigValue("track-download-history") || {};
                history[histKey] = { filename: finalDownloadFilename, timestamp: Date.now() };
                await storeConfigValue("track-download-history", history);
            }
            reportProgress(101);
            return downloadId; // Return the downloadId to the caller
        } catch (saveError) {
            logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Download save stage error:`, saveError);
            throw new TrackError(`Save failed for track ${data.trackId}: ${(saveError as Error).message}`, data.trackId);
        }
        // No finally block with URL.revokeObjectURL is needed for data URLs.
        // The variable objectUrlToRevoke could be renamed throughout the function if desired for clarity.

    } catch (error) {
        logger.logError(`[DownloadHandler TrackId: ${data.trackId}] Uncaught error in handleDownload`, error);
        if (error instanceof TrackError) {
            throw error;
        } else {
            throw new TrackError(`Unknown error during download: ${error?.message || error}`, data.trackId);
        }
    }
} 