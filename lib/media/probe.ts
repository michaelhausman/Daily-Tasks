import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AvInfo = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

let ffmpegAvailable: boolean | null = null;

/**
 * ffmpeg is optional on purpose. It is a heavy system dependency, and the app
 * stays fully usable without it — video and audio still upload, store, and play
 * in the browser; they just lack a poster frame and a waveform. Every caller
 * here degrades to null rather than failing the upload.
 */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync("ffprobe", ["-version"]);
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

export async function probeAv(filePath: string): Promise<AvInfo> {
  const empty: AvInfo = { durationMs: null, width: null, height: null };
  if (!(await hasFfmpeg())) return empty;

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
      }>;
    };

    const seconds = Number(parsed.format?.duration);
    const video = parsed.streams?.find((s) => s.codec_type === "video");

    return {
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
    };
  } catch {
    return empty;
  }
}

/** Single frame from ~1s in, as JPEG. Null when ffmpeg is unavailable. */
export async function extractPosterFrame(
  filePath: string,
  outPath: string,
  durationMs: number | null,
): Promise<boolean> {
  if (!(await hasFfmpeg())) return false;

  // Seek a second in to skip fade-from-black intros, but never past the end.
  const seek = durationMs && durationMs < 2000 ? 0 : 1;

  try {
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-ss", String(seek),
      "-i", filePath,
      "-frames:v", "1",
      "-vf", "scale='min(1280,iw)':-2",
      "-y", outPath,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Peak amplitudes for the audio scrubber. Decodes to raw mono 16-bit PCM at a
 * low sample rate and buckets it — cheap, and enough for a visual.
 */
export async function extractWaveform(
  filePath: string,
  buckets = 240,
): Promise<number[] | null> {
  if (!(await hasFfmpeg())) return null;

  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", filePath,
        "-ac", "1",
        "-ar", "8000",
        "-f", "s16le",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 128 },
    );

    const pcm = stdout as unknown as Buffer;
    const samples = Math.floor(pcm.length / 2);
    if (samples === 0) return null;

    const perBucket = Math.max(1, Math.floor(samples / buckets));
    const peaks: number[] = [];

    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      const start = b * perBucket;
      if (start >= samples) break;
      const end = Math.min(start + perBucket, samples);
      for (let i = start; i < end; i++) {
        const v = Math.abs(pcm.readInt16LE(i * 2));
        if (v > peak) peak = v;
      }
      peaks.push(Math.round((peak / 32768) * 100) / 100);
    }

    return peaks.length > 0 ? peaks : null;
  } catch {
    return null;
  }
}
