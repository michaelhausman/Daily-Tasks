"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { TagInput } from "@/components/TagInput";

type Stage = "idle" | "uploading" | "done" | "error";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [who, setWho] = useState<string[]>([]);
  const [where, setWhere] = useState<string[]>([]);
  const [topic, setTopic] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pickFile = useCallback((next: File) => {
    setFile(next);
    setError(null);
    setStage("idle");

    if (preview) URL.revokeObjectURL(preview);
    setPreview(next.type.startsWith("image/") ? URL.createObjectURL(next) : null);

    // Fall back to the file's own mtime for the date. EXIF is more reliable and
    // the server will override with it when present, but this gives an
    // immediate, usually-correct value in the field.
    if (!eventDate && next.lastModified) {
      const d = new Date(next.lastModified);
      setEventDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate(),
        ).padStart(2, "0")}`,
      );
    }
  }, [eventDate, preview]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a photo, video, or audio file first.");
      return;
    }
    if (who.length === 0 && where.length === 0 && topic.length === 0) {
      setError("Add at least one tag so your upload can find its people.");
      return;
    }

    const body = new FormData();
    body.append("file", file);
    who.forEach((v) => body.append("who", v));
    where.forEach((v) => body.append("where", v));
    topic.forEach((v) => body.append("topic", v));
    if (eventDate) body.append("eventDate", eventDate);
    if (caption) body.append("caption", caption);
    body.append("visibility", visibility);

    setStage("uploading");
    setProgress(0);
    setError(null);

    // XHR rather than fetch: upload progress matters a lot when someone is
    // pushing a 200MB concert video over hotel wifi, and fetch still can't
    // report it.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: { id?: string; url?: string; error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.url) {
        setStage("done");
        router.push(payload.url);
        router.refresh();
      } else {
        setStage("error");
        setError(payload.error ?? `Upload failed (${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      setStage("error");
      setError("Network error during upload.");
    };

    xhr.send(body);
  }

  const busy = stage === "uploading" || stage === "done";

  return (
    <form onSubmit={submit} className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) pickFile(dropped);
        }}
        onClick={() => inputRef.current?.click()}
        className="surface flex cursor-pointer flex-col items-center justify-center rounded-xl p-8 text-center transition-colors"
        style={dragging ? { borderColor: "#7c5cff" } : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) pickFile(chosen);
          }}
        />

        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Selected upload preview"
            className="mb-3 max-h-56 rounded-lg object-contain"
          />
        ) : (
          <div className="mb-2 text-3xl">＋</div>
        )}

        {file ? (
          <p className="text-sm">
            <span className="font-medium">{file.name}</span>
            <span className="muted">
              {" "}
              — {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drop a photo, video, or audio file
            </p>
            <p className="mt-1 text-xs muted">or tap to browse</p>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TagInput
          facet="who"
          label="Who — performer, artist, team, person"
          placeholder="Aimee Mann"
          value={who}
          onChange={setWho}
        />
        <TagInput
          facet="where"
          label="Where — venue, festival, city"
          placeholder="Eau Claire Festival"
          value={where}
          onChange={setWhere}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            <span
              className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: "#f05252" }}
            />
            When — the date it happened
          </label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="input"
          />
          <p className="mt-1 text-xs muted">
            Prefilled from the file, and corrected from EXIF after upload when
            the camera recorded it.
          </p>
        </div>

        <TagInput
          facet="topic"
          label="Topic — optional, anything else"
          placeholder="encore, crowd, soundcheck"
          value={topic}
          onChange={setTopic}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          placeholder="Optional — what was happening?"
          className="input resize-y"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Visibility</label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="input"
        >
          <option value="public">Public — appears in browse and moments</option>
          <option value="unlisted">Unlisted — only people with the link</option>
        </select>
      </div>

      {error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "#f0525220", color: "#f05252" }}
        >
          {error}
        </p>
      )}

      {stage === "uploading" && (
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--surface-2)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: "#7c5cff" }}
            />
          </div>
          <p className="mt-1.5 text-xs muted">
            {progress < 100
              ? `Uploading — ${progress}%`
              : "Processing (thumbnails, EXIF, duration)…"}
          </p>
        </div>
      )}

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Working…" : "Share it"}
      </button>
    </form>
  );
}
