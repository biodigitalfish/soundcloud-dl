import { TagWriter } from "./tagWriter";
import { Logger, LogLevel } from "../../utils/logger";
import { concatArrayBuffers } from "../download";
import type { TagWriterOutput } from "./tagWriter";

interface Atom {
  length: number;
  name?: string;
  offset?: number;
  children?: Atom[];
  data?: ArrayBuffer;
}

interface AtomLevel {
  parent: Atom;
  offset: number;
  childIndex: number;
}

// length(4) + name(4)
const ATOM_HEAD_LENGTH = 8;
// data-length(4) + data-name(4) + data-flags(4)
const ATOM_DATA_HEAD_LENGTH = 16;

const ATOM_HEADER_LENGTH = ATOM_HEAD_LENGTH + ATOM_DATA_HEAD_LENGTH;

class Mp4 {
  private readonly _metadataPath = ["moov", "udta", "meta", "ilst"];
  private _buffer: ArrayBuffer | null;
  private _bufferView: DataView | null;
  private _atoms: Atom[] = [];
  private _loggedErrors: Set<string> = new Set();
  private _hasValidStructure = false;
  private _logger: Logger;

  public get hasValidMp4Structure(): boolean {
    return this._hasValidStructure;
  }

  private _logError(message: string): void {
    // Only log each unique error message once
    if (!this._loggedErrors.has(message)) {
      this._logger.logDebug(`MP4 metadata: ${message}`); // Using logDebug instead of logError
      this._loggedErrors.add(message);
    }
  }

  constructor(buffer: ArrayBuffer) {
    this._buffer = buffer;
    this._bufferView = new DataView(buffer);
    this._logger = Logger.create("MP4TagWriterInternals", LogLevel.Debug); // Changed source name and level
  }

  parse() {
    if (!this._buffer) throw new Error("Buffer can not be null");
    if (this._atoms.length > 0) throw new Error("Buffer already parsed");
    this._logger.logDebug("Starting MP4 parse..."); // Add start marker

    let offset = 0;
    let atom: Atom;
    let atomsFound: { name: string; length: number; offset: number }[] = []; // Store found atoms

    while (true) {
      atom = this._readAtom(offset);

      if (!atom || atom.length < 1 || offset >= this._buffer.byteLength) { // Add buffer boundary check
        if (offset < this._buffer.byteLength) {
          this._logger.logDebug(`Parsing stopped: _readAtom returned invalid atom or zero length at offset ${offset}.`);
        } else {
          this._logger.logDebug(`Parsing stopped: Reached end of buffer at offset ${offset}.`);
        }
        break;
      }

      // Log details of the found atom
      atomsFound.push({ name: atom.name || "undefined", length: atom.length, offset: atom.offset });
      // this._logger.logDebug(`Found top-level atom: Name=${atom.name || '?'}, Length=${atom.length}, Offset=${atom.offset}`);

      this._atoms.push(atom);
      offset = atom.offset + atom.length;

      // Safety break if offset seems wrong (e.g., negative length, goes backwards)
      if (offset <= atom.offset) {
        this._logger.logError(`Parsing stopped: Invalid offset progression. Current offset ${atom.offset}, next offset calculated as ${offset}.`);
        break;
      }
    }

    this._logger.logDebug(`Finished MP4 parse. Found ${this._atoms.length} top-level atoms.`);
    // Log the summary of atoms found
    this._logger.logDebug(`Top-level atoms summary: ${JSON.stringify(atomsFound)}`);


    if (this._atoms.length < 1) {
      this._logError("Buffer could not be parsed - no valid top-level atoms found."); // Changed error message slightly
      this._hasValidStructure = false;
      return; // Exit early if no atoms found
    }

    // Check if this is a valid MP4 file with a 'moov' atom (case-insensitive check just for this debug step)
    const moovAtom = this._atoms.find(a => a.name?.toLowerCase() === "moov");
    this._hasValidStructure = !!moovAtom; // Set based on finding 'moov' (case-insensitive for now)

    if (!this._hasValidStructure) {
      this._logError("File structure check failed: Did not find a top-level 'moov' atom (checked case-insensitively).");
    } else {
      this._logger.logDebug("File structure check passed: Found top-level 'moov' atom (case-insensitive check).");
    }
  }

  setDuration(duration: number) {
    try {
      // Skip if not a valid MP4 structure
      if (!this._hasValidStructure) {
        this._logError("Cannot set duration - file doesn't have a valid MP4 structure");
        return;
      }

      const mvhdAtom: Atom = this._findAtom(this._atoms, ["moov", "mvhd"]);

      if (!mvhdAtom) throw new Error("'mvhd' atom could not be found");

      // version(4) + created(4) + modified(4) + timescale(4)
      const precedingDataLength = 16;
      this._bufferView.setUint32(mvhdAtom.offset + ATOM_HEAD_LENGTH + precedingDataLength, duration);
    } catch (error) {
      this._logError(`Failed to set duration: ${error.message}`);
    }
  }

  addMetadataAtom(name: string, data: ArrayBuffer | string | number) {
    try {
      // Skip if not a valid MP4 structure
      if (!this._hasValidStructure) {
        this._logError(`Cannot add ${name} metadata - file doesn't have a valid MP4 structure`);
        return;
      }

      if (name.length > 4 || name.length < 1) throw new Error(`Unsupported atom name: '${name}'`);

      let dataBuffer: ArrayBuffer;

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

      const atom: Atom = {
        name,
        length: ATOM_HEADER_LENGTH + dataBuffer.byteLength,
        data: dataBuffer,
      };

      this._insertAtom(atom, this._metadataPath);
    } catch (error) {
      // Log error but don't throw - this makes the tag writer more resilient
      this._logError(`Failed to add metadata atom '${name}': ${error.message}`);
    }
  }

  getBuffer() {
    const buffers: ArrayBuffer[] = [];
    let bufferIndex = 0;

    // we don't change the offsets, since it would add needless complexity without benefit
    for (const atom of this._atoms) {
      if (!atom.children) {
        // nothing has been added or removed
        const slice = this._buffer.slice(atom.offset, atom.offset + atom.length);
        buffers.push(slice);
        bufferIndex++;

        continue;
      }

      atom.length = ATOM_HEAD_LENGTH;

      const levels: AtomLevel[] = [{ parent: atom, offset: bufferIndex, childIndex: 0 }];
      let levelIndex = 0;

      while (true) {
        const { parent, offset, childIndex } = levels[levelIndex];

        if (childIndex >= parent.children.length) {
          // move one level up
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

          // set length of parent in buffer
          this._bufferView.setUint32(parent.offset, parent.length);

          const parentHeader = this._buffer.slice(parent.offset, parent.offset + parentHeadLength);
          buffers.splice(offset, 0, parentHeader);

          // we completed the last parent - exit
          if (levelIndex < 0) break;

          // add our current parents length to new parent and move childIndex of new parent one ahead
          const newParent = levels[levelIndex].parent;
          newParent.length += parent.length;
          levels[levelIndex].childIndex++;

          continue;
        }

        const child = parent.children[childIndex];

        if (child.children) {
          // move one level down
          child.length = ATOM_HEAD_LENGTH;
          levels.push({ parent: child, offset: bufferIndex, childIndex: 0 });
          levelIndex++;
          continue;
        } else if (child.data) {
          // add new data to buffer
          const headerBuffer = this._getHeaderBufferFromAtom(child);
          buffers.push(headerBuffer);
          buffers.push(child.data);
        } else {
          // add entire child to buffer
          const slice = this._buffer.slice(child.offset, child.offset + child.length);
          buffers.push(slice);
        }

        bufferIndex++;

        parent.length += child.length;

        // move one child ahead
        levels[levelIndex].childIndex++;
      }
    }

    this._bufferView = null;
    this._buffer = null;
    this._atoms = [];

    return concatArrayBuffers(buffers);
  }

  private _insertAtom(atom: Atom, path: string[]) {
    try {
      this._logger.logDebug(`Attempting to insert atom '${atom.name}' at path '${path.join(" > ")}'.`);
      // For tag atoms, the path should always end in 'ilst'
      if (!path || path[path.length - 1] !== "ilst") {
        this._logError(`Cannot insert tag atom '${atom.name}': Path does not end in 'ilst'.`);
        return;
      }

      // Ensure the metadata path exists, potentially creating it. Get the 'ilst' atom.
      const parentAtom = this._createMetadataPath(); // This now returns the 'ilst' atom or null

      if (!parentAtom) {
        // _createMetadataPath already logged the error
        this._logError(`Cannot insert atom '${atom.name}': Failed to find or create parent 'ilst' atom.`);
        return;
      }

      // Ensure parent's children are loaded (should be handled by _createMetadataPath returning it)
      if (parentAtom.children === undefined) {
        parentAtom.children = this._readChildAtoms(parentAtom);
        this._logger.logDebug(`Loaded children for '${parentAtom.name}' in _insertAtom.`);
      }

      // Check if an atom with the same name already exists (e.g., existing 'covr')
      // Simple replacement: remove existing, add new. More complex merging could be added later.
      const existingIndex = parentAtom.children.findIndex(child => child.name === atom.name);
      if (existingIndex !== -1) {
        this._logger.logDebug(`Replacing existing atom '${atom.name}' in '${parentAtom.name}'.`);
        parentAtom.children.splice(existingIndex, 1);
      }


      // Calculate offset placeholder (actual position determined during getBuffer reconstruction)
      let offset = parentAtom.offset + this._getAtomHeaderLength(parentAtom);
      if (parentAtom.children.length > 0) {
        const lastChild = parentAtom.children[parentAtom.children.length - 1];
        offset = lastChild.offset + lastChild.length; // Append after last child
      }
      atom.offset = offset; // Assign placeholder offset

      // Add the new atom
      parentAtom.children.push(atom);
      this._logger.logDebug(`Successfully prepared atom '${atom.name}' for insertion into '${parentAtom.name}'.`);

      // Note: Parent atom lengths will be recalculated in getBuffer()
    } catch (error) {
      this._logError(`Error during _insertAtom for '${atom.name}': ${error.message}`);
    }
  }

  private _findAtom(atoms: Atom[], path: string[]): Atom | null {
    if (!path || path.length < 1) throw new Error("Path can not be empty");

    const curPath = [...path];
    const curName = curPath.shift();
    const curElem = atoms.find((i) => i.name === curName);

    if (curPath.length < 1) return curElem;

    if (!curElem) return null;

    if (curElem.children === undefined) {
      curElem.children = this._readChildAtoms(curElem);
    }

    if (curElem.children.length < 1) return null;

    return this._findAtom(curElem.children, curPath);
  }

  private _readChildAtoms(atom: Atom): Atom[] {
    const children: Atom[] = [];

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

  private _readAtom(offset: number): Atom {
    const begin = offset;
    const end = offset + ATOM_HEAD_LENGTH;

    const buffer = this._buffer.slice(begin, end);

    if (buffer.byteLength < ATOM_HEAD_LENGTH) {
      return {
        length: buffer.byteLength,
        offset,
      };
    }

    const dataView = new DataView(buffer);

    let length = dataView.getUint32(0, false);

    let name = "";
    for (let i = 0; i < 4; i++) {
      name += String.fromCharCode(dataView.getUint8(4 + i));
    }

    return {
      name,
      length,
      offset,
    };
  }

  private _getHeaderBufferFromAtom(atom: Atom) {
    if (!atom || atom.length < 1 || !atom.name || !atom.data)
      throw new Error("Can not compute header buffer for this atom");

    const headerBuffer = new ArrayBuffer(ATOM_HEADER_LENGTH);
    const headerBufferView = new DataView(headerBuffer);

    // length at 0, length = 4
    headerBufferView.setUint32(0, atom.length);

    // name at 4, length = 4
    const nameChars = this._getCharCodes(atom.name);
    for (let i = 0; i < nameChars.length; i++) {
      headerBufferView.setUint8(4 + i, nameChars[i]);
    }

    // data length at 8, length = 4
    headerBufferView.setUint32(8, ATOM_DATA_HEAD_LENGTH + atom.data.byteLength);

    // data name at 12, length = 4
    const dataNameChars = this._getCharCodes("data");
    for (let i = 0; i < dataNameChars.length; i++) {
      headerBufferView.setUint8(12 + i, dataNameChars[i]);
    }

    // data flags at 16, length = 4
    headerBufferView.setUint32(16, this._getFlags(atom.name));

    return headerBuffer;
  }

  private _getBufferFromString(input: string): ArrayBuffer {
    // return new TextEncoder().encode(input).buffer;

    const buffer = new ArrayBuffer(input.length);
    const bufferView = new DataView(buffer);
    const chars = this._getCharCodes(input);

    for (let i = 0; i < chars.length; i++) {
      bufferView.setUint8(i, chars[i]);
    }

    return buffer;
  }

  private _getCharCodes(input: string) {
    const chars: number[] = [];

    for (let i = 0; i < input.length; i++) {
      chars.push(input.charCodeAt(i));
    }

    return chars;
  }

  private _getFlags(name: string) {
    switch (name) {
      case "covr":
        // 13 for jpeg, 14 for png
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
  private _createMetadataPath(): Atom | null { // Return the final 'ilst' atom if successful
    try {
      this._logger.logDebug("Attempting to ensure metadata path moov > udta > meta > ilst exists.");

      // 1. Find 'moov' - it must exist for us to proceed.
      const moovAtom = this._findAtom(this._atoms, ["moov"]);
      if (!moovAtom) {
        this._logError("Cannot create metadata path: Required 'moov' atom not found.");
        return null;
      }
      // Ensure moov children are loaded for modification
      if (moovAtom.children === undefined) {
        moovAtom.children = this._readChildAtoms(moovAtom);
      }

      let currentParent = moovAtom;
      const pathSegments = ["udta", "meta", "ilst"];

      for (const segmentName of pathSegments) {
        let segmentAtom = this._findAtom(currentParent.children, [segmentName]);

        if (!segmentAtom) {
          this._logger.logDebug(`Creating missing '${segmentName}' atom.`);
          // Calculate offset: immediately after the parent's header (or after last existing child)
          let newAtomOffset = currentParent.offset + this._getAtomHeaderLength(currentParent);
          if (currentParent.children.length > 0) {
            const lastChild = currentParent.children[currentParent.children.length - 1];
            newAtomOffset = lastChild.offset + lastChild.length;
          }

          // Create the new atom with minimal default size
          const newAtomLength = this._getAtomHeaderLength({ name: segmentName } as Atom);
          segmentAtom = {
            name: segmentName,
            length: newAtomLength,
            offset: newAtomOffset, // Placeholder offset, might not be perfectly sequential if gaps exist
            children: [] // Initialize children array
          };

          // Add to parent's children and update parent's length
          currentParent.children.push(segmentAtom);
          // Don't update length here, let getBuffer recalculate based on final children

          this._logger.logDebug(`Created '${segmentName}' atom.`);
        } else {
          this._logger.logDebug(`Found existing '${segmentName}' atom.`);
          // Ensure children are loaded if we plan to descend further
          if (segmentAtom.children === undefined) {
            segmentAtom.children = this._readChildAtoms(segmentAtom);
          }
        }
        currentParent = segmentAtom; // Move down the hierarchy
      }

      // Return the final atom in the path ('ilst')
      this._logger.logDebug("Metadata path creation/verification successful. Returning 'ilst' atom.");
      return currentParent;

    } catch (error) {
      this._logError(`Failed during _createMetadataPath: ${error.message}`);
      return null;
    }
  }

  // Helper to get header length (including meta/stsd variations)
  private _getAtomHeaderLength(atom: Atom): number {
    let headLength = ATOM_HEAD_LENGTH;
    if (atom.name === "meta") {
      headLength += 4; // version/flags
    } else if (atom.name === "stsd") {
      headLength += 8; // Specific stsd header bytes
    }
    return headLength;
  }
}

export class Mp4TagWriter implements TagWriter {
  private _originalBuffer: ArrayBuffer;
  private _mp4: Mp4;
  private _hasValidMp4: boolean = false;

  // Track errors that have already been logged to avoid spamming console
  private static _loggedErrors: Set<string> = new Set();
  private static _logger: Logger = Logger.create("MP4TagWriter", LogLevel.Debug);

  private static _logError(message: string): void {
    // Only log each unique error message once
    if (!Mp4TagWriter._loggedErrors.has(message)) {
      Mp4TagWriter._logger.logDebug(`MP4 metadata: ${message}`); // Use logDebug to keep it quieter
      Mp4TagWriter._loggedErrors.add(message);
    }
  }

  constructor(buffer: ArrayBuffer) {
    try {
      // Create a clone of the original buffer to avoid detached ArrayBuffer issues
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
        // Even if parsing fails, we'll still have the original buffer for fallback
      }
    } catch (constructorError) {
      Mp4TagWriter._logError(`Mp4TagWriter constructor error: ${constructorError.message}`);
      // Initialize _originalBuffer to an empty buffer as a last resort
      this._originalBuffer = new ArrayBuffer(0);
      this._hasValidMp4 = false;
    }
  }

  setTitle(title: string): void {
    try {
      if (!title) throw new Error("Invalid value for title");

      this._mp4.addMetadataAtom("©nam", title);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set title: ${error.message}`);
    }
  }

  setArtists(artists: string[]): void {
    try {
      if (!artists || artists.length < 1) throw new Error("Invalid value for artists");

      this._mp4.addMetadataAtom("©ART", artists.join(", "));
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set artists: ${error.message}`);
    }
  }

  setAlbum(album: string): void {
    try {
      if (!album) throw new Error("Invalid value for album");

      this._mp4.addMetadataAtom("©alb", album);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set album: ${error.message}`);
    }
  }

  setComment(comment: string): void {
    try {
      if (!comment) throw new Error("Invalid value for comment");

      this._mp4.addMetadataAtom("©cmt", comment);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set comment: ${error.message}`);
    }
  }

  setTrackNumber(trackNumber: number): void {
    try {
      // max trackNumber is max of Uint8
      if (trackNumber < 1 || trackNumber > 32767) throw new Error("Invalid value for trackNumber");

      this._mp4.addMetadataAtom("trkn", trackNumber);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set track number: ${error.message}`);
    }
  }

  setYear(year: number): void {
    try {
      if (year < 1) throw new Error("Invalid value for year");

      this._mp4.addMetadataAtom("©day", year.toString());
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set year: ${error.message}`);
    }
  }

  setGrouping(grouping: string): void {
    try {
      if (!grouping) throw new Error("Invalid value for grouping");

      this._mp4.addMetadataAtom("©grp", grouping);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set grouping: ${error.message}`);
    }
  }

  setArtwork(artworkBuffer: ArrayBuffer): void {
    try {
      if (!artworkBuffer || artworkBuffer.byteLength < 1) throw new Error("Invalid value for artworkBuffer");

      this._mp4.addMetadataAtom("covr", artworkBuffer);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set artwork: ${error.message}`);
    }
  }

  setDuration(duration: number): void {
    try {
      if (duration < 1) throw new Error("Invalid value for duration");

      this._mp4.setDuration(duration);
    } catch (error) {
      Mp4TagWriter._logError(`Failed to set duration: ${error.message}`);
    }
  }

  getBuffer(): Promise<TagWriterOutput> {
    try {
      // Make sure we still have a valid buffer
      if (!this._originalBuffer || this._originalBuffer.byteLength === 0) {
        throw new Error("Original buffer is missing or empty");
      }

      // If MP4 instance is invalid, return original buffer without tagging
      if (!this._mp4 || !this._hasValidMp4) {
        Mp4TagWriter._logError(
          "MP4 structure check failed. Returning original buffer without applying tags."
        );
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0), // Create a fresh copy to avoid detached buffer issues
          tagsApplied: false,
          message: "Invalid MP4 structure for tagging."
        });
      }

      let processedBuffer: ArrayBuffer;
      try {
        processedBuffer = this._mp4.getBuffer();

        // Additional safety check in case getBuffer returns empty or null
        if (!processedBuffer || processedBuffer.byteLength === 0) {
          throw new Error("Processed buffer is empty or null");
        }

        // Create a copy of the processed buffer to avoid any detached buffer issues
        processedBuffer = processedBuffer.slice(0);
      } catch (bufferError) {
        Mp4TagWriter._logError(`Failed to get processed buffer: ${bufferError.message}`);
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0), // Create a fresh copy
          tagsApplied: false,
          message: `Failed to process MP4 buffer: ${bufferError.message}`
        });
      }

      let tagsSuccessfullyApplied = true;
      let message: string | undefined = undefined;

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
        // Return a copy of the original buffer to prevent detached ArrayBuffer issues
        return Promise.resolve({
          buffer: this._originalBuffer.slice(0),
          tagsApplied: false,
          message: errorMessage
        });
      } catch (finalError) {
        // If even creating a copy of the original buffer fails, we're in real trouble
        Mp4TagWriter._logError(`CRITICAL: Failed to create copy of original buffer: ${finalError.message}`);

        // Return empty buffer as absolute last resort (caller should handle this)
        return Promise.resolve({
          buffer: new ArrayBuffer(0),
          tagsApplied: false,
          message: `CRITICAL ERROR: ${errorMessage} + ${finalError.message}`
        });
      }
    }
  }
}
