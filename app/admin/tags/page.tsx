import Link from "next/link";
import { notFound } from "next/navigation";

import { FACET_COLOR } from "@/components/Chip";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import {
  deleteTagAction,
  mergeTagsAction,
  renameTagAction,
} from "@/lib/moderation/actions";
import { allTags } from "@/lib/moderation/service";
import { ModForm } from "../ModForm";
import { TagRow } from "./TagRow";

export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.handle)) notFound();

  const tags = await allTags();
  const byFacet = {
    who: tags.filter((t) => t.facet === "who"),
    where: tags.filter((t) => t.facet === "where"),
    topic: tags.filter((t) => t.facet === "topic"),
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Tags</h1>
        <p className="mt-1 text-sm muted">
          <Link href="/admin" style={{ color: "#7c5cff" }}>
            ← Back to moderation
          </Link>
        </p>
        <p className="mt-3 max-w-2xl text-sm muted">
          A bad tag does more damage than a bad photo: it pollutes browse for
          everyone and survives deleting every upload that used it. Renaming
          fixes a typo, merging folds a duplicate into the real one, and
          deleting removes the label without touching any uploads.
        </p>
      </header>

      {(["who", "where", "topic"] as const).map((facet) => (
        <section key={facet}>
          <h2 className="mb-3 text-lg font-bold">
            <span
              className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
              style={{ background: FACET_COLOR[facet] }}
            />
            {facet}
            <span className="ml-2 text-sm font-normal muted">
              {byFacet[facet].length}
            </span>
          </h2>

          {byFacet[facet].length === 0 ? (
            <p className="text-sm muted">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {byFacet[facet].map((t) => (
                <TagRow
                  key={t.id}
                  tag={{
                    id: t.id,
                    facet: t.facet,
                    slug: t.slug,
                    label: t.label,
                    usageCount: t.usageCount,
                    isAlias: t.canonicalTagId !== null,
                  }}
                  siblings={byFacet[facet]
                    .filter((o) => o.id !== t.id && o.canonicalTagId === null)
                    .map((o) => ({ id: o.id, label: o.label }))}
                  renameAction={renameTagAction}
                  mergeAction={mergeTagsAction}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      <section>
        <h2 className="mb-3 text-lg font-bold">Delete a tag</h2>
        <p className="mb-3 max-w-2xl text-sm muted">
          Removes the label everywhere. Uploads that used it stay, they just lose
          that one tag — which may drop them out of a moment, so prefer merging
          where a correct tag exists.
        </p>
        <ul className="space-y-2">
          {tags.map((t) => (
            <li
              key={t.id}
              className="surface flex flex-wrap items-center gap-3 rounded-xl p-3"
            >
              <span className="flex-1 text-sm">
                <span className="muted">{t.facet}:</span> {t.label}{" "}
                <span className="text-xs muted">({t.usageCount})</span>
              </span>
              <ModForm
                action={deleteTagAction}
                label="Delete tag"
                tone="danger"
                fields={{ tagId: t.id }}
                confirm={`Delete the tag "${t.label}"? Uploads keep their files but lose this tag.`}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
