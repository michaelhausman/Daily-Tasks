"use client";

import { useRef, useState } from "react";

/**
 * Waveform scrubber. When ffmpeg wasn't available at upload time there are no
 * peaks to draw, so we fall back to the browser's native audio element rather
 * than showing a broken-looking empty canvas.
 */
export function AudioPlayer({
  src,
  peaks,
}: {
  src: string;
  peaks: number[] | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  if (!peaks || peaks.length === 0) {
    return (
      <div className="surface rounded-xl p-5">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={src} controls className="w-full" />
        <p className="mt-2 text-xs muted">
          Waveform unavailable — ffmpeg wasn&apos;t installed when this was
          uploaded.
        </p>
      </div>
    );
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  }

  return (
    <div className="surface rounded-xl p-5">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (audio.paused) void audio.play();
            else audio.pause();
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: "#7c5cff" }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div
          onClick={seek}
          className="flex h-16 flex-1 cursor-pointer items-center gap-px"
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          {peaks.map((peak, i) => {
            const played = i / peaks.length <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.max(3, peak * 100)}%`,
                  background: played ? "#7c5cff" : "var(--border)",
                  minWidth: "1px",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
