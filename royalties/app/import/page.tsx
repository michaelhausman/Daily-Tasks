import { listStatements } from "@/lib/import/statement";
import { PROS } from "@/lib/db/schema";
import { formatMoney } from "@/lib/text";
import { importCatalogAction, importStatementAction } from "./actions";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const statements = await listStatements();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="mt-2 max-w-3xl text-sm muted">
          Order matters once: load the catalogue first, so the app knows which
          songs are yours. Setlists and statements imported before it still
          work — they get matched to works retroactively — but nothing reads
          as yours until a catalogue says so.
        </p>
      </header>

      <section className="surface rounded-xl p-5">
        <h2 className="text-lg font-bold">1 · Song catalogue</h2>
        <p className="mt-1 max-w-2xl text-sm muted">
          From Google Sheets: File → Download → Comma-separated values. One row
          per writer per song is the usual shape — three rows for one song with
          three writers — and they get folded together. Columns are guessed
          from their headers and the guess is reported back, so a wrong one is
          visible rather than silent.
        </p>
        <UploadForm action={importCatalogAction} label="Load catalogue">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Whose money are we tracking?
            </span>
            <input
              name="tracked"
              placeholder="Aimee Mann"
              className="input text-sm"
            />
            <span className="mt-1 block text-xs muted">
              Writer names, comma separated, exactly as the catalogue spells
              them. Every report filters on this — leave it empty and nothing
              counts as yours.
            </span>
          </label>
        </UploadForm>
      </section>

      <section className="surface rounded-xl p-5">
        <h2 className="text-lg font-bold">2 · Setlists</h2>
        <p className="mt-1 max-w-2xl text-sm muted">
          From setlist.fm, on the machine holding the API key:
        </p>
        <pre
          className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
          style={{ background: "var(--surface-2)" }}
        >
          npm run fetch:setlistfm -- &quot;Aimee Mann&quot;
        </pre>
        <p className="mt-2 max-w-2xl text-sm muted">
          For dates setlist.fm doesn&rsquo;t have, write them as JSON and load
          them with <code>npm run import:shows -- shows.json</code>. Those are
          marked as entered by hand, so when a source disagrees you can tell
          which is which.
        </p>
      </section>

      <section className="surface rounded-xl p-5">
        <h2 className="text-lg font-bold">3 · Royalty statements</h2>
        <p className="mt-1 max-w-2xl text-sm muted">
          The decisive thing is whether the file names a performance date. One
          that does — an OnStage or BMI Live statement — ties to specific
          nights, and a missing line is real evidence. One that only covers a
          quarter can show a work earned something, not that a given show was
          claimed. Both load; the difference is carried into the report.
        </p>
        <UploadForm action={importStatementAction} label="Load statement">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">PRO</span>
              <select name="pro" className="input text-sm" defaultValue="ASCAP">
                {PROS.map((pro) => (
                  <option key={pro} value={pro}>
                    {pro}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Period from</span>
              <input type="date" name="periodStart" className="input text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">to</span>
              <input type="date" name="periodEnd" className="input text-sm" />
            </label>
          </div>
          <p className="text-xs muted">
            Period is optional when the file itemises dates — those bound it
            better than anything typed here. It matters when the file
            doesn&rsquo;t.
          </p>
        </UploadForm>
      </section>

      {statements.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Statements loaded</h2>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {statements.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-medium">{s.filename}</span>
                <span className="text-xs muted">{s.pro}</span>
                <span className="text-xs muted">
                  {s.periodStart ?? "?"} – {s.periodEnd ?? "?"}
                </span>
                <span className="flex-1" />
                <span className="text-xs muted">
                  {s.lineCount} lines · {Number(s.itemised)} dated ·{" "}
                  {formatMoney(Number(s.totalCents))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
