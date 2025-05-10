import XRegExp from "xregexp";

export function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((acc, cur) => acc + cur.byteLength, 0);

  const mergedBuffer = new Uint8Array(totalLength);

  let bufferOffset = 0;
  for (const buffer of buffers) {
    mergedBuffer.set(new Uint8Array(buffer), bufferOffset);

    bufferOffset += buffer.byteLength;
  }

  return mergedBuffer.buffer;
}

export function sanitizeFilenameForDownload(input: string) {
  let sanitized = input.replace(/[<>:"/\\|?*]/g, "");
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u001f\u0080-\u009f]/g, "");
  sanitized = sanitized.replace(/^\.*/, "");
  sanitized = sanitized.replace(/\.*$/, "");

  // \p{L}: any kind of letter from any language.
  // \p{N}: any kind of numeric character in any script.
  // \p{Zs}: a whitespace character that is invisible, but does take up space.
  // \p{So}: Other symbols, including most emojis.
  // MODIFIED: Added \p{So} to the exclusion list to strip more symbols/emojis
  sanitized = XRegExp.replace(sanitized, XRegExp("[^\\p{L}\\p{N}\\p{Zs}\\p{P}\\p{Sm}]", "gu"), "");
  // Keeping \p{P} (Punctuation) and \p{Sm} (Symbol, math) for things like hyphens, underscores, plus, equals, etc.
  // Re-evaluate if \p{P} and \p{Sm} are too broad or too narrow.
  // Let's try to be more specific: keep letters, numbers, spaces, and a few specific punctuation marks essential for readability.
  // This will strip emojis and most other symbols.
  // CORRECTED LINTER ERRORS: Removed unnecessary escapes for - [ ] inside character class
  // Final attempt at this regex for allowed punctuation.
  // Removing [ and ] from the keep list to test if they cause the 'raw bracket' error with XRegExp 'u' flag.
  sanitized = XRegExp.replace(sanitized, XRegExp("[^\\p{L}\\p{N}\\p{Zs}_+.,()-]", "gu"), "");

  return sanitized.replace(/\s{2,}/g, " ").trim(); // Ensure multiple spaces are collapsed to one
}

export const DEFAULT_FILENAME_TEMPLATE = "{artist} - {title}";

/**
 * Regex for characters that are not allowed in filenames on Windows and other OS.
 */
// eslint-disable-next-line no-control-regex
export const INVALID_FILENAME_CHARS_REGEX = /[\x00-\x1f\x7f<>:"/\\|?*]/g;
