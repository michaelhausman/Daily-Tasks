import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { hasAdmins, isAdmin } from "@/lib/config";
import {
  allUsers,
  openReports,
  recentComments,
  recentUploads,
} from "@/lib/moderation/service";
import {
  deleteCommentAsAdminAction,
  deleteMediaAsAdminAction,
  hideMediaAction,
  reinstateUserAction,
  resolveReportAction,
  suspendUserAction,
  unhideMediaAction,
} from "@/lib/moderation/actions";
import { storage } from "@/lib/storage";
import { ModForm } from "./ModForm";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  copyright: "Copyright",
  abuse: "Abuse",
  sexual: "Sexual content",
  spam: "Spam",
  "wrong-tags": "Wrong tags",
  other: "Other",
};

export default async function AdminPage() {
  const user = await getCurrentUser();

  // 404 rather than 403: an admin page that announces its own existence to
  // everyone is an invitation to go looking.
  if (!user || !isAdmin(user.handle)) notFound();

  const [reports, uploads, comments, people] = await Promise.all([
    openReports(),
    recentUploads(24),
    recentComments(20),
    allUsers(),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Moderation</h1>
        <p className="mt-1 text-sm muted">
          Signed in as @{user.handle}.{" "}
          <Link href="/admin/tags" style={{ color: "#7c5cff" }}>
            Manage tags →
          </Link>
        </p>
        {!hasAdmins() && (
          <p
            className="mt-3 rounded-lg px-3 py-2 text-sm"
            style={{ background: "#f0525220", color: "#f05252" }}
          >
            ADMIN_HANDLES isn&rsquo;t set, so nobody can moderate in production.
          </p>
        )}
      </header>

      {/* ── reports ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-xl font-bold">
          Reports{reports.length > 0 && ` (${reports.length})`}
        </h2>
        <p className="mb-4 text-sm muted">
          Hide first if you&rsquo;re unsure — it&rsquo;s reversible. Delete only
          when you&rsquo;re certain.
        </p>

        {reports.length === 0 ? (
          <div className="surface rounded-xl p-8 text-center">
            <p className="muted">Nothing reported. </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="surface rounded-xl p-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: "#f0525220", color: "#f05252" }}
                  >
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </span>
                  <span className="text-xs muted">
                    reported by @{r.reporter} ·{" "}
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>

                {r.note && (
                  <p className="mb-3 whitespace-pre-wrap text-sm">{r.note}</p>
                )}

                <div className="mb-3 text-sm">
                  {r.target.kind === "media" && (
                    <span>
                      Upload{" "}
                      <Link
                        href={`/media/${r.target.mediaId}`}
                        style={{ color: "#7c5cff" }}
                      >
                        {r.target.caption || "(no caption)"}
                      </Link>{" "}
                      <span className="muted">by @{r.target.owner}</span>
                      {r.target.hidden && (
                        <span className="ml-2 text-xs" style={{ color: "#f05252" }}>
                          already hidden
                        </span>
                      )}
                    </span>
                  )}
                  {r.target.kind === "comment" && (
                    <span>
                      Comment by{" "}
                      <span className="muted">@{r.target.author}</span>:{" "}
                      <q>{r.target.body}</q>
                    </span>
                  )}
                  {r.target.kind === "moment" && (
                    <span>
                      Moment{" "}
                      <Link
                        href={`/m/${r.target.whereSlug}/${r.target.eventDate}`}
                        style={{ color: "#7c5cff" }}
                      >
                        {r.target.whereSlug} · {r.target.eventDate}
                      </Link>
                    </span>
                  )}
                  {r.target.kind === "gone" && (
                    <span className="muted">
                      The reported item has already been removed.
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.target.kind === "media" && !r.target.hidden && (
                    <ModForm
                      action={hideMediaAction}
                      label="Hide"
                      fields={{ mediaId: r.target.mediaId }}
                      reasonPrompt="Reason (shown to owner)"
                    />
                  )}
                  {r.target.kind === "media" && r.target.hidden && (
                    <ModForm
                      action={unhideMediaAction}
                      label="Unhide"
                      fields={{ mediaId: r.target.mediaId }}
                    />
                  )}
                  {r.target.kind === "media" && (
                    <ModForm
                      action={deleteMediaAsAdminAction}
                      label="Delete permanently"
                      tone="danger"
                      fields={{ mediaId: r.target.mediaId }}
                      confirm="Delete this upload permanently? The file is removed and can't be recovered."
                    />
                  )}
                  {r.target.kind === "comment" && (
                    <ModForm
                      action={deleteCommentAsAdminAction}
                      label="Delete comment"
                      tone="danger"
                      fields={{ commentId: r.target.commentId }}
                    />
                  )}

                  <span className="mx-1 text-xs muted">then</span>

                  <ModForm
                    action={resolveReportAction}
                    label="Mark actioned"
                    tone="primary"
                    fields={{ reportId: r.id, status: "actioned" }}
                  />
                  <ModForm
                    action={resolveReportAction}
                    label="Dismiss"
                    fields={{ reportId: r.id, status: "dismissed" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── recent uploads ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-xl font-bold">Recent uploads</h2>
        <p className="mb-4 text-sm muted">
          Everything posted lately, reported or not.
        </p>

        <ul className="space-y-2">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="surface flex flex-wrap items-center gap-3 rounded-xl p-3"
              style={u.hiddenAt ? { opacity: 0.6 } : undefined}
            >
              <div
                className="h-12 w-12 shrink-0 overflow-hidden rounded-md"
                style={{ background: "var(--surface-2)" }}
              >
                {u.thumbKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={storage.url(u.thumbKey)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs muted">
                    {u.kind === "audio" ? "♪" : "▣"}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/media/${u.id}`}
                  className="block truncate text-sm"
                  style={{ color: "#7c5cff" }}
                >
                  {u.caption || "(no caption)"}
                </Link>
                <p className="text-xs muted">
                  @{u.owner}
                  {u.suspended && " · suspended"}
                  {u.hiddenAt && ` · hidden: ${u.hiddenReason}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {u.hiddenAt ? (
                  <ModForm
                    action={unhideMediaAction}
                    label="Unhide"
                    fields={{ mediaId: u.id }}
                  />
                ) : (
                  <ModForm
                    action={hideMediaAction}
                    label="Hide"
                    fields={{ mediaId: u.id }}
                    reasonPrompt="Reason"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── comments ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-xl font-bold">Recent comments</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li
              key={c.id}
              className="surface flex flex-wrap items-start gap-3 rounded-xl p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{c.body}</p>
                <p className="text-xs muted">
                  @{c.author} ·{" "}
                  {c.mediaId ? (
                    <Link href={`/media/${c.mediaId}`} style={{ color: "#7c5cff" }}>
                      on an upload
                    </Link>
                  ) : (
                    <Link
                      href={`/m/${c.momentWhere}/${c.momentDate}`}
                      style={{ color: "#7c5cff" }}
                    >
                      on {c.momentWhere} · {c.momentDate}
                    </Link>
                  )}
                </p>
              </div>
              <ModForm
                action={deleteCommentAsAdminAction}
                label="Delete"
                tone="danger"
                fields={{ commentId: c.id }}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* ── people ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-xl font-bold">People</h2>
        <p className="mb-4 text-sm muted">
          Suspending blocks login and hides everything the account posted.
          Nothing is deleted, and reinstating puts it all back.
        </p>

        <ul className="space-y-2">
          {people.map((p) => (
            <li
              key={p.id}
              className="surface flex flex-wrap items-center gap-3 rounded-xl p-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/u/${p.handle}`}
                  className="text-sm font-semibold"
                  style={{ color: "#7c5cff" }}
                >
                  @{p.handle}
                </Link>
                <p className="text-xs muted">
                  {p.displayName} · {p.uploadCount} uploads
                  {p.suspendedAt &&
                    ` · suspended: ${p.suspendedReason ?? "no reason given"}`}
                </p>
              </div>

              {p.id !== user.id &&
                (p.suspendedAt ? (
                  <ModForm
                    action={reinstateUserAction}
                    label="Reinstate"
                    tone="primary"
                    fields={{ userId: p.id }}
                  />
                ) : (
                  <ModForm
                    action={suspendUserAction}
                    label="Suspend"
                    tone="danger"
                    fields={{ userId: p.id }}
                    reasonPrompt="Reason"
                    confirm="Suspend this account? They'll be logged out and all their uploads hidden."
                  />
                ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
