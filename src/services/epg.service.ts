import axios from "axios";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { gunzipSync, createGunzip } from "zlib";
import { SaxesParser } from "saxes";
import { Readable } from "stream";

interface EPGChannel {
  "@_id"?: string;
  "display-name"?: string[] | any;
  icon?: any;
  url?: string[];
  [key: string]: any; // Allow any other fields
}

interface ParsedChannel {
  tvgId: string;
  name: string;
  tvgLogo?: string;
}

/**
 * Custom error for EPG files that are too large for current limits
 */
export class EPGFileTooLargeError extends Error {
  constructor(
    public compressedSizeMB: number,
    public decompressedSizeMB?: number
  ) {
    super(
      `EPG file is too large (${compressedSizeMB}MB compressed${
        decompressedSizeMB ? `, ${decompressedSizeMB}MB decompressed` : ""
      }). ` +
        `Use smaller EPG files (ideally <2GB uncompressed) or a regional/filtered source.`
    );
    this.name = "EPGFileTooLargeError";
  }
}

export class EPGService {
  // Builders for export filtering
  static xmlParserForExport() {
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: false,
    });
  }

  static xmlBuilderForExport() {
    return new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      suppressBooleanAttributes: false,
      format: true,
    });
  }

  /**
   * Fetch EPG/XMLTV file from URL (supports .gz compressed files)
   * NOTE: For large files, prefer importEPGStream to avoid string size limits.
   */
  static async fetchEPG(url: string): Promise<string> {
    try {
      console.log(`📥 Fetching EPG from: ${url}`);
      const startTime = Date.now();

      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 300000, // 5 minutes timeout for very large EPG files (e.g., 280MB+)
        maxContentLength: 2 * 1024 * 1024 * 1024, // 2GB
        maxBodyLength: 2 * 1024 * 1024 * 1024, // 2GB
        headers: {
          "User-Agent": "IPTV-Playlist-Manager/1.0",
          "Accept-Encoding": "gzip, deflate",
        },
      });

      const downloadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const compressedSizeMB = response.data.byteLength / (1024 * 1024);
      const sizeInMB = compressedSizeMB.toFixed(2);
      console.log(`✅ Downloaded ${sizeInMB}MB in ${downloadTime}s`);

      let data = response.data;
      let decompressedSizeMB: number | undefined;

      // Check if the response is gzipped (by URL extension or content-type)
      const isGzipped =
        url.endsWith(".gz") ||
        url.endsWith(".xml.gz") ||
        response.headers["content-type"]?.includes("gzip") ||
        response.headers["content-encoding"]?.includes("gzip");

      if (isGzipped || this.isGzipData(data)) {
        try {
          const decompressStart = Date.now();
          // Decompress gzip data
          data = gunzipSync(Buffer.from(data));
          const decompressTime = (
            (Date.now() - decompressStart) /
            1000
          ).toFixed(2);
          decompressedSizeMB = data.byteLength / (1024 * 1024);
          console.log(
            `✅ Decompressed to ${decompressedSizeMB.toFixed(
              2
            )}MB in ${decompressTime}s`
          );
        } catch (e) {
          console.warn("Failed to gunzip data, trying as plain XML:", e);
        }
      }

      // Convert buffer to UTF-8 string (supports international characters)
      const parseStart = Date.now();
      // Guard against Node string size limit
      if (data.byteLength > 0x7fffffff) {
        throw new EPGFileTooLargeError(
          compressedSizeMB,
          data.byteLength / (1024 * 1024)
        );
      }

      const xmlString = Buffer.from(data).toString("utf-8");
      const parseTime = ((Date.now() - parseStart) / 1000).toFixed(2);
      console.log(`✅ Converted to UTF-8 string in ${parseTime}s`);

      // Validate UTF-8 encoding by checking for valid XML declaration
      if (!xmlString.includes("<?xml")) {
        console.warn("Warning: File may not be valid XML or UTF-8 encoded");
      }

      return xmlString;
    } catch (error: any) {
      throw new Error(`Failed to fetch EPG: ${error.message}`);
    }
  }

  /**
   * Stream and parse XMLTV/EPG content to avoid huge in-memory strings.
   * Returns parsed channels without loading full XML into memory.
   */
  static async importEPGStream(
    url: string,
    onProgress?: (bytesRead: number, totalBytes?: number) => void
  ): Promise<ParsedChannel[]> {
    // Fallback: download entire file (safe for small files like 7–20MB) and parse
    const downloadAndParseBuffer = async (): Promise<ParsedChannel[]> => {
      const bufResp = await axios.get<ArrayBufferLike>(url, {
        responseType: "arraybuffer",
        maxRedirects: 5,
        timeout: 120000,
        headers: {
          "User-Agent": "IPTV-Playlist-Manager/1.0",
          Accept: "application/xml, text/xml, application/octet-stream, */*",
          "Accept-Encoding": "gzip, deflate",
        },
      });
      const buf = Buffer.from(bufResp.data);
      let xmlBuf = buf;
      // Auto-gunzip if needed
      if (this.isGzipData(buf)) {
        xmlBuf = await new Promise<Buffer>((resolve, reject) => {
          const unzip = createGunzip();
          const chunks: Buffer[] = [];
          unzip.on("data", (c) => chunks.push(c as Buffer));
          unzip.on("end", () => resolve(Buffer.concat(chunks)));
          unzip.on("error", reject);
          unzip.write(buf);
          unzip.end();
        });
      }
      const xmlStr = xmlBuf.toString("utf-8");
      return this.parseEPG(xmlStr);
    };

    // Attempt HEAD to decide if we should buffer (small files)
    try {
      const headResp = await axios.head(url, {
        maxRedirects: 5,
        timeout: 15000,
        headers: {
          "User-Agent": "IPTV-Playlist-Manager/1.0",
          Accept: "*/*",
        },
      });
      const lenHeader = headResp.headers["content-length"];
      const len = lenHeader ? parseInt(lenHeader, 10) : undefined;
      if (len && len > 0 && len <= 50 * 1024 * 1024) {
        // Small file: download and parse in one go
        return await downloadAndParseBuffer();
      }
    } catch {
      // If HEAD fails, continue to streaming
    }

    const channels: ParsedChannel[] = [];

    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      maxRedirects: 5,
      headers: {
        "User-Agent": "IPTV-Playlist-Manager/1.0",
        // keep gzip/deflate only; br can stall on some CDNs when streaming
        "Accept-Encoding": "gzip, deflate",
        "Accept": "application/xml, text/xml, application/octet-stream, */*",
      },
    });

    const isGzipped =
      url.endsWith(".gz") ||
      url.endsWith(".xml.gz") ||
      response.headers["content-type"]?.includes("gzip") ||
      response.headers["content-encoding"]?.includes("gzip");

    const source: Readable = response.data as Readable;
    const stream = isGzipped ? source.pipe(createGunzip()) : source;

    let currentId: string | null = null;
    let currentName: string | null = null;
    let currentLogo: string | null = null;
    let inDisplayName = false;

    const parser = new SaxesParser({ xmlns: false });

    parser.on("opentag", (tag: any) => {
      if (tag.name === "channel") {
        currentId = (tag.attributes["id"] as string) || null;
        currentName = null;
        currentLogo = null;
        inDisplayName = false;
      } else if (tag.name === "display-name") {
        inDisplayName = true;
        currentName = "";
      } else if (tag.name === "icon" && currentId) {
        const src = (tag.attributes["src"] as string) || "";
        if (src) currentLogo = src;
      }
    });

    parser.on("text", (text: string) => {
      if (inDisplayName && currentName !== null) {
        currentName += text;
      }
    });

    parser.on("closetag", (tag: any) => {
      const name = typeof tag === "string" ? tag : tag?.name;
      if (name === "display-name") {
        inDisplayName = false;
      } else if (name === "channel") {
        if (currentId && currentName) {
          channels.push({
            tvgId: currentId.trim(),
            name: currentName.trim(),
            tvgLogo: currentLogo?.trim(),
          });
        }
        currentId = null;
        currentName = null;
        currentLogo = null;
        inDisplayName = false;
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
      const totalBytesHeader = response.headers["content-length"];
      const totalBytes = totalBytesHeader ? parseInt(totalBytesHeader, 10) : undefined;
      let bytesRead = 0;
      let firstChunkChecked = false;
      const contentType = response.headers["content-type"] || "";
      let gunzipActive = isGzipped;
      let gunzip: ReturnType<typeof createGunzip> | null = null;
      let resolved = false;
      let idleTimer: NodeJS.Timeout | null = null;
      const idleTimeoutMs = 15000; // 15s stall detection (small files should finish quickly)

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          fail(new Error(`Download stalled: no data received for ${idleTimeoutMs / 1000}s`));
        }, idleTimeoutMs);
      };

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        resolve();
      };

      const fail = (err: any) => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        reject(err);
      };

      const feedParser = (textChunk: string) => {
        bytesRead += Buffer.byteLength(textChunk);
        if (onProgress) onProgress(bytesRead, totalBytes);

        if (!firstChunkChecked) {
          firstChunkChecked = true;
          const trimmed = textChunk.replace(/^\uFEFF/, "").trimStart();

          if (!trimmed.startsWith("<")) {
            const preview = trimmed.slice(0, 200);
            return fail(
              new Error(
                `Invalid EPG XML: unexpected first character (not '<'). The URL may not point to an XMLTV file (received ${contentType || "non-XML"}). Preview: ${preview}`
              )
            );
          }
        }

        parser.write(textChunk);
      };

      stream.on("data", (chunk: Buffer) => {
        try {
          resetIdleTimer();
          // Auto-detect gzip when headers/URL didn't indicate it
          if (!gunzipActive && this.isGzipData(chunk)) {
            gunzipActive = true;
            gunzip = createGunzip();
            gunzip.on("data", (buf: Buffer) => feedParser(buf.toString("utf-8")));
            gunzip.on("end", () => {
              try {
                parser.close();
                finish();
              } catch (err) {
                fail(err);
              }
            });
            gunzip.on("error", fail);
            gunzip.write(chunk);
            return;
          }

          // Normal path (already gunzipped or plain XML)
          feedParser(chunk.toString("utf-8"));
        } catch (err) {
          fail(err);
        }
      });

      resetIdleTimer();

      stream.on("end", () => {
        try {
          if (gunzipActive) {
            // gunzip 'end' will resolve
            return;
          }
          parser.close();
          finish();
        } catch (err) {
          fail(err);
        }
      });

      stream.on("error", fail);
      parser.on("error", (err: any) => fail(err));
      });
    } catch (streamErr) {
      console.warn("Stream parsing failed, retrying with buffered download:", streamErr);
      return await downloadAndParseBuffer();
    }

    console.log(`✅ Parsed ${channels.length} channels via streaming`);
    return channels;
  }

  /**
   * Check if data is gzipped by checking magic number
   */
  private static isGzipData(data: Buffer | Uint8Array): boolean {
    if (data.length < 2) return false;
    // Gzip magic number: 1f 8b
    return data[0] === 0x1f && data[1] === 0x8b;
  }

  /**
   * Parse XMLTV/EPG content and extract channels
   * Supports UTF-8 encoding for international characters (Arabic, Chinese, Cyrillic, etc.)
   */
  static parseEPG(xmlContent: string): ParsedChannel[] {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
        // Preserve UTF-8 characters (international languages)
        processEntities: true,
        htmlEntities: true,
        // Don't stop on errors with special characters
        stopNodes: [],
        unpairedTags: [],
      });

      const result = parser.parse(xmlContent);

      if (!result.tv || !result.tv.channel) {
        throw new Error("Invalid XMLTV format: missing tv or channel elements");
      }

      // Normalize to array
      let channels: EPGChannel[] = Array.isArray(result.tv.channel)
        ? result.tv.channel
        : [result.tv.channel];

      const parsedChannels: ParsedChannel[] = [];

      for (const channel of channels) {
        try {
          // Extract channel ID (required)
          const tvgId = channel["@_id"];
          if (!tvgId) continue;

          // Extract display name (required)
          const displayNames = Array.isArray(channel["display-name"])
            ? channel["display-name"]
            : channel["display-name"]
            ? [channel["display-name"]]
            : [];

          if (displayNames.length === 0) continue;

          // Get the first display name as the channel name
          let name = "";
          if (typeof displayNames[0] === "string") {
            name = displayNames[0];
          } else if (displayNames[0]["#text"]) {
            name = displayNames[0]["#text"];
          }

          if (!name) continue;

          // Extract icon/logo (optional)
          let tvgLogo: string | undefined;
          if (channel.icon) {
            const icons = Array.isArray(channel.icon)
              ? channel.icon
              : [channel.icon];
            if (icons[0] && icons[0]["@_src"]) {
              tvgLogo = icons[0]["@_src"];
            }
          }

          // Normalize whitespace but preserve UTF-8 characters
          parsedChannels.push({
            tvgId: tvgId.trim(),
            name: name.trim(), // Preserves UTF-8: العربية, 中文, Русский, etc.
            tvgLogo: tvgLogo?.trim(),
          });
        } catch (channelError) {
          console.warn("Failed to parse channel:", channelError);
          // Continue with next channel
        }
      }

      console.log(`✅ Parsed ${parsedChannels.length} channels from EPG`);
      return parsedChannels;
    } catch (error: any) {
      throw new Error(`Failed to parse EPG XML: ${error.message}`);
    }
  }

  /**
   * Import EPG and return parsed channels
   */
  static async importEPG(url: string): Promise<ParsedChannel[]> {
    const xmlContent = await this.fetchEPG(url);
    const channels = this.parseEPG(xmlContent);

    if (channels.length === 0) {
      throw new Error("No channels found in EPG file");
    }

    return channels;
  }
}
