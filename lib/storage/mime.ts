/**
 * Extension-to-MIME mapping, shared by the file-serving route and the S3
 * driver so a stored object and the response that serves it can never disagree
 * about what it is.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
};

export function contentTypeForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_BY_EXT[key.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
