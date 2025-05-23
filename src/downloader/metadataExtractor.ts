import escapeStringRegexp from "escape-string-regexp";
import XRegExp from "xregexp";

export enum ArtistType {
  Main,
  Feature,
  Remixer,
  Producer,
}

export enum RemixType {
  Remix,
  Flip,
  Bootleg,
  Mashup,
  Edit,
}

export function getRemixTypeFromString(input: string) {
  const loweredInput = input.toLowerCase().trim();

  switch (loweredInput) {
    case "flip":
      return RemixType.Flip;
    case "bootleg":
      return RemixType.Bootleg;
    case "mashup":
      return RemixType.Mashup;
    case "edit":
      return RemixType.Edit;
    case "remix":
    default:
      return RemixType.Remix;
  }
}

export interface Artist {
  name: string;
  type: ArtistType;
  remixType?: RemixType;
}

interface TitleSplit {
  artistNames: string[];
  title: string;
}

interface RemixTitleSplit {
  artists: Artist[];
  title: string;
}

function stableSort<T>(input: T[], prop: keyof T) {
  const storedPositions = input.map((data, index) => ({
    data,
    index,
  }));

  return storedPositions
    .sort((a, b) => {
      if (a.data[prop] < b.data[prop]) return -1;
      if (a.data[prop] > b.data[prop]) return 1;
      return a.index - b.index;
    })
    .map((i) => i.data);
}

export class MetadataExtractor {
  static readonly titleSeparators = ["-", "–", "—", "~"];
  static readonly featureSeparators = ["featuring", "feat.", "feat", "ft.", " ft ", "w/", " w /", " w ", "+"];
  static readonly combiningFeatureSeparators = [...MetadataExtractor.featureSeparators, ", ", " & ", " x "];
  static readonly remixIndicators = ["remix", "flip", "bootleg", "mashup", "edit"];
  static readonly producerIndicators = [
    "prod. by ",
    "prod by ",
    "prod. ",
    "p. ",
    "prod ",
  ];
  static readonly promotions = ["free download", "video in description", "video in desc", "vid in desc", "Original Mix"];

  constructor(private title: string, private username: string, private userPermalink?: string) { }

  getArtists(): Artist[] {
    const title = this.preprocessTitle(this.title);

    let artists: Artist[] = [];

    const titleSplit = this.splitByTitleSeparators(title, true);

    // artists before the title separator, e.g. >artist< - title
    artists = artists.concat(
      titleSplit.artistNames.map<Artist>((name, index) => ({
        name,
        type: index === 0 ? ArtistType.Main : ArtistType.Feature,
      }))
    );

    // producers after the title separator, e.g. artist - title (prod. >artist<)
    // we expect the producer section to be last, if not everthing fails :(
    const producerSplit = this.splitByProducer(titleSplit.title, true);

    artists = artists.concat(
      producerSplit.artistNames.map<Artist>((name) => ({
        name,
        type: ArtistType.Producer,
      }))
    );

    // remixers after the title separator, e.g. artist - title (>artist< Remix)
    const remixSplit = this.splitByRemix(producerSplit.title, true);

    artists = artists.concat(remixSplit.artists);

    // get producers from braces, e.g. artist - title (producer)
    const unsafeProducerSplit = this.splitByUnsafeProducers(remixSplit.title, true);

    artists = artists.concat(
      unsafeProducerSplit.artistNames.map<Artist>((name) => ({
        name,
        type: ArtistType.Producer,
      }))
    );

    // features after the title separator, e.g. artist - title (ft. >artist<)
    const featureSplit = this.splitByFeatures(remixSplit.title, true);

    artists = artists.concat(
      featureSplit.artistNames.map<Artist>((name) => ({
        name,
        type: ArtistType.Feature,
      }))
    );

    const hasMainArtist = artists.some((i) => i.type === ArtistType.Main);

    if (!hasMainArtist) {
      const user = {
        name: this.sanitizeArtistName(this.username) || this.userPermalink,
        type: ArtistType.Main,
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

    const distinctArtists: Artist[] = [];

    // Only distinct artists
    for (const artist of artists) {
      if (distinctArtists.some((i) => i.name == artist.name)) continue;

      distinctArtists.push(artist);
    }

    // sort by importance
    return stableSort(distinctArtists, "type");
  }

  getTitle(): string {
    let title = this.preprocessTitle(this.title);

    title = this.splitByTitleSeparators(title, false).title;

    title = this.splitByProducer(title, false).title;

    title = this.splitByRemix(title, false).title;

    title = this.splitByFeatures(title, false).title;

    title = this.splitByUnsafeProducers(title, false).title;

    return this.sanitizeTitle(title);
  }

  private removeTwitterHandle(artist: Artist) {
    artist.name = artist.name.replace(/^[@]+/, "");

    const result = /^([^(]+)\s?\(\s?@.+\)?$/.exec(artist.name);

    if (result && result.length > 1) {
      artist.name = result[1].trimEnd();
    }

    return artist;
  }

  private splitByTitleSeparators(title: string, extractArtists: boolean): TitleSplit {
    let artistNames: string[] = [];

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
      title,
    };
  }

  private splitByFeatures(title: string, extractArtists: boolean): TitleSplit {
    let artistNames: string[] = [];

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
      title,
    };
  }

  private splitByProducer(title: string, extractArtists: boolean): TitleSplit {
    let artistNames: string[] = [];

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
      title,
    };
  }

  private splitByUnsafeProducers(title: string, extractArtists: boolean): TitleSplit {
    let artistNames: string[] = [];

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
      title,
    };
  }

  private splitByRemix(title: string, extractArtists: boolean): RemixTitleSplit {
    let artists: Artist[] = [];

    if (this.includes(title, MetadataExtractor.remixIndicators)) {
      const separators = this.escapeRegexArray(MetadataExtractor.remixIndicators).join("|");
      const regex = new RegExp(`[\\[\\(](.+)(${separators})[\\]\\)]`, "i");

      const result = regex.exec(title);

      if (result && result.length > 0) {
        const [remixSection, artistsString, remixTypeString] = result;

        if (extractArtists) {
          const artistNames = this.getArtistNames(artistsString);

          const remixType = getRemixTypeFromString(remixTypeString);

          artists = artistNames.map<Artist>((name) => ({
            name,
            type: ArtistType.Remixer,
            remixType,
          }));
        }

        title = title.replace(remixSection, "");
      }
    }

    return {
      artists,
      title,
    };
  }

  private getArtistNames(input: string): string[] {
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

  private preprocessTitle(input: string) {
    // remove duplicated +s
    input = input.replace(/\+([+]+)/g, "+");

    // remove promotions
    const promotions = MetadataExtractor.promotions.join("|");
    const regex = new RegExp(`[\\[\\(]?\\s*(${promotions})\\s*[\\]\\)]?`, "i");

    return input.replace(regex, "");
  }

  private sanitizeArtistName(input: string) {
    return this.removeNonAsciiCharacters(input).trim();
  }

  private sanitizeTitle(input: string) {
    let sanitized = this.removeNonAsciiCharacters(input);

    sanitized = sanitized.replace("()", "").replace("[]", "");

    return sanitized.trim();
  }

  private removeNonAsciiCharacters(input: string) {
    return XRegExp.replace(input, XRegExp("[^\\p{L}\\p{N}\\p{Zs}\x00-\x7F]", "g"), "");
  }

  private includes(input: string, separators: string[]) {
    const loweredInput = input.toLowerCase();

    return separators.some((separator) => loweredInput.includes(separator));
  }

  private escapeRegexArray(input: string[]) {
    return input.map((i) => escapeStringRegexp(i));
  }
}
