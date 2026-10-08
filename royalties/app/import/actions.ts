"use server";

import { revalidatePath } from "next/cache";

import { PROS, type Pro } from "@/lib/db/schema";
import { importCatalog, relinkTitles, trackWriters } from "@/lib/import/catalog";
import { importStatement } from "@/lib/import/statement";
import { formatMoney, formatShare } from "@/lib/text";

export type ImportState = { error?: string; ok?: string; detail?: string[] };

/**
 * Uploads arrive as text, not as a path.
 *
 * Statements and catalogues live on whatever machine the person is using, and
 * asking them to get a file onto the server to run a script is how a tool
 * stops being used. The parsing is the same code the scripts call.
 */
async function readCsv(formData: FormData): Promise<{ name: string; text: string } | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, text: await file.text() };
}

export async function importCatalogAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = await readCsv(formData);
  if (!file) return { error: "Choose a CSV file." };

  const tracked = String(formData.get("tracked") ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const result = await importCatalog(file.text, { trackedWriters: tracked });
    if (tracked.length > 0) await trackWriters(tracked);
    const linked = await relinkTitles();

    const detail = [
      `Columns: ${Object.entries(result.mapping)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}→${v}`)
        .join(", ")}`,
      `${result.worksAdded} works added, ${result.worksUpdated} updated, ${result.writersAdded} writers.`,
    ];
    if (linked.performances > 0) {
      detail.push(
        `Matched ${linked.performances} performances already on file to these works.`,
      );
    }
    if (result.oddSplits.length > 0) {
      detail.push(
        `${result.oddSplits.length} works whose shares don't total 100% — e.g. ${result.oddSplits
          .slice(0, 3)
          .map((s) => `${s.title} (${formatShare(s.totalBp)})`)
          .join(", ")}`,
      );
    }

    revalidatePath("/");
    revalidatePath("/works");
    return { ok: `Loaded ${file.name}.`, detail };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function importStatementAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = await readCsv(formData);
  if (!file) return { error: "Choose a CSV file." };

  const pro = String(formData.get("pro") ?? "ASCAP") as Pro;
  if (!PROS.includes(pro)) return { error: "Pick a PRO." };

  const periodStart = String(formData.get("periodStart") ?? "").trim() || undefined;
  const periodEnd = String(formData.get("periodEnd") ?? "").trim() || undefined;

  try {
    const result = await importStatement(file.text, {
      pro,
      filename: file.name,
      periodStart,
      periodEnd,
    });

    const detail = [
      `Columns: ${Object.entries(result.mapping)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}→${v}`)
        .join(", ")}`,
      `${result.lines} lines, ${formatMoney(result.totalCents)} total, ${result.matchedToWorks} matched to works.`,
      `Period ${result.periodStart ?? "?"} to ${result.periodEnd ?? "?"}.`,
    ];

    if (result.itemised === 0) {
      detail.push(
        "No performance dates in this file — it can show a work earned something in the period, but not that any particular show was claimed.",
      );
    } else {
      detail.push(
        `${result.itemised} lines name a performance date, so they tie to specific shows.`,
      );
    }
    if (result.unmatchedTitles.length > 0) {
      detail.push(
        `Titles matching no work: ${result.unmatchedTitles.slice(0, 5).join(", ")}${
          result.unmatchedTitles.length > 5 ? "…" : ""
        }`,
      );
    }

    revalidatePath("/");
    revalidatePath("/claims");
    return { ok: `Loaded ${file.name}.`, detail };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
