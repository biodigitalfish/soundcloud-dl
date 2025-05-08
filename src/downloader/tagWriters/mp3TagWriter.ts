import { ID3Writer } from "browser-id3-writer";
import { TagWriter } from "./tagWriter";
import type { TagWriterOutput } from "./tagWriter";
import { Logger } from "../../utils/logger";

const logger = Logger.create("Mp3TagWriter");

export class Mp3TagWriter implements TagWriter {
  private writer: ID3Writer;

  constructor(buffer: ArrayBuffer) {
    this.writer = new ID3Writer(buffer);
  }

  setTitle(title: string): void {
    if (!title) throw new Error("Invalid value for title");

    this.writer.setFrame("TIT2", title);
  }

  setArtists(artists: string[]): void {
    if (!artists || artists.length < 1) throw new Error("Invalid value for artists");

    this.writer.setFrame("TPE1", artists);
  }

  setAlbum(album: string): void {
    if (!album) throw new Error("Invalid value for album");

    this.writer.setFrame("TALB", album);
  }

  setComment(comment: string): void {
    if (!comment) throw new Error("Invalid value for comment");

    this.writer.setFrame("COMM", {
      text: comment,
      description: "",
    });
  }

  setTrackNumber(trackNumber: number): void {
    // not sure what the highest track number is for ID3, but let's assume it's the max value of short
    if (trackNumber < 1 || trackNumber > 32767) throw new Error("Invalid value for trackNumber");

    this.writer.setFrame("TRCK", trackNumber.toString());
  }

  setYear(year: number): void {
    if (year < 1) throw new Error("Invalud value for year");

    this.writer.setFrame("TYER", year);
  }

  setGrouping(grouping: string): void {
    if (!grouping) throw new Error("Invalid value for grouping");

    this.writer.setFrame("TIT1", grouping);
  }

  setArtwork(artworkBuffer: ArrayBuffer): void {
    if (!artworkBuffer || artworkBuffer.byteLength < 1) throw new Error("Invalid value for artworkBuffer");

    this.writer.setFrame("APIC", {
      type: 3,
      data: artworkBuffer,
      description: "",
    });
  }

  setSoundCloudTrackId(trackId: string): void {
    if (!trackId) throw new Error("Invalid value for SoundCloud Track ID");
    logger.logDebug(`Attempting to set SoundCloudTrackID: ${trackId}`);
    // Using TXXX frame for user-defined text information
    // Description: A unique identifier for the source of this custom ID
    // Text: The actual track ID
    this.writer.setFrame("TXXX" as any, {
      description: "SoundCloudTrackID",
      value: trackId,
    });
  }

  getBuffer(): Promise<TagWriterOutput> {
    this.writer.addTag();

    const blob = this.writer.getBlob();

    return blob.arrayBuffer().then(buffer => {
      return { buffer, tagsApplied: true };
    });
  }
}
