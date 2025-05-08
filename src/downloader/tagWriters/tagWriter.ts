export interface TagWriterOutput {
  buffer: ArrayBuffer;
  tagsApplied: boolean;
  message?: string; // Optional message, e.g., why tags weren't applied
}

export interface TagWriter {
  setTitle(title: string): void;
  setArtists(artists: string[]): void;
  setAlbum(album: string): void;
  setComment(comment: string): void;
  setTrackNumber(trackNumber: number): void;
  setYear(year: number): void;
  setGrouping(grouping: string): void;
  setArtwork(artworkBuffer: ArrayBuffer): void;
  setSoundCloudTrackId(trackId: string): void;
  getBuffer(): Promise<TagWriterOutput>;
}
