import { Track } from "./api/soundcloudApi"; // Assuming Track is a base type needed by Playlist, DownloadData

// From messageHandler.ts
export interface DownloadRequest {
    type: string;
    url: string;
    downloadId: string;
}

export interface DownloadSetRangeRequest extends DownloadRequest {
    start: number;
    end: number | null;
}

export interface Playlist {
    tracks: Track[]; // Depends on Track type
    set_type: string;
    title: string;
}

export interface DownloadProgress {
    downloadId: string;
    progress?: number;
    error?: string;
    status?: "Paused" | "Resuming";
    timestamp?: number;
    completed?: boolean;
    backupMessage?: boolean;
    finalBackup?: boolean;
    completionWithoutId?: boolean;
    browserDownloadId?: number;
}

// From downloadHandler.ts
export interface DownloadData {
    trackId: number;
    title: string;
    duration: number;
    uploadDate: Date;
    username: string;
    userPermalink: string;
    avatarUrl: string;
    artworkUrl: string;
    streamUrl: string;
    fileExtension?: string;
    trackNumber: number | undefined;
    albumName: string | undefined;
    playlistName?: string;
    hls: boolean;
    producer?: string;
    wasOriginallyHls?: boolean;
}

export interface TranscodingDetails {
    url: string;
    protocol: "hls" | "progressive";
    quality: "hq" | "sq";
} 