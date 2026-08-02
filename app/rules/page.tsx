import Link from "next/link";

export const metadata = {
  title: "What belongs here — Tagpool",
  description:
    "House rules for uploading photos, video, and audio to Tagpool.",
};

export default function RulesPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">What belongs here</h1>
        <p className="mt-2 text-sm muted">
          Short version: post what you actually shot, tag it honestly, and
          don&rsquo;t post things other people would be hurt or embarrassed by.
        </p>
      </header>

      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          background: "var(--surface-2)",
          borderLeft: "2px solid #f05252",
        }}
      >
        <strong>Draft.</strong> These are house rules written in plain English,
        not reviewed legal terms. Before opening this site to the public, have a
        lawyer look at this page, the takedown process, and a privacy policy
        covering what the site stores.
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Post your own work</h2>
        <p className="text-sm">
          Upload things you made — photos you took, video you shot, audio you
          recorded. Don&rsquo;t re-post someone else&rsquo;s material as if it
          were yours.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Recordings need permission</h2>
        <p className="text-sm">
          This one matters more here than on most sites. A recording of a
          performance involves rights belonging to the performer, the songwriter,
          and often the venue — not just to whoever held the microphone.
        </p>
        <p className="text-sm">
          Some artists explicitly allow taping, and their shows are welcome.
          Most don&rsquo;t. If you don&rsquo;t know whether an artist permits
          recordings, assume they don&rsquo;t. Venues frequently have their own
          policy on photography too.
        </p>
        <p className="text-sm">
          If you hold rights to something posted here, use the{" "}
          <Link href="/takedown" style={{ color: "#7c5cff" }}>
            takedown page
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Tag honestly</h2>
        <p className="text-sm">
          Tags aren&rsquo;t decoration here — they&rsquo;re how uploads find each
          other. A photo tagged with the wrong venue or date lands in a pool it
          doesn&rsquo;t belong in, and everyone else&rsquo;s view of that day gets
          worse. Tag what you actually attended.
        </p>
        <p className="text-sm">
          Don&rsquo;t create tags as jokes, insults, or advertising. A bad tag
          affects everybody browsing, not just your own upload.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">People in your photos</h2>
        <p className="text-sm">
          Crowds at public events are fair game. Individuals are a judgement
          call: don&rsquo;t post identifiable close-ups of people who would
          object, and take something down if someone asks. Nothing sexual
          involving anyone, and nothing whatsoever involving minors in a sexual
          context — that gets reported to the authorities, not just removed.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Not allowed</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Harassment, hate speech, or threats</li>
          <li>Sexual content</li>
          <li>Content involving minors in any sexual context</li>
          <li>Spam, advertising, or bulk uploads unrelated to real events</li>
          <li>Material you don&rsquo;t have the right to share</li>
          <li>Deliberately false tagging</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">What happens if something breaks these</h2>
        <p className="text-sm">
          Anyone logged in can report an upload, a comment, or a whole moment
          using the <strong>Report</strong> link. Reports go to a moderation
          queue.
        </p>
        <p className="text-sm">
          Content may be <em>hidden</em> while it&rsquo;s being looked at —
          reversible, and the file isn&rsquo;t destroyed — or deleted outright if
          it clearly breaks these rules. Accounts that keep breaking them get
          suspended, which hides their uploads without deleting them.
        </p>
        <p className="text-sm">
          There&rsquo;s no formal appeals process yet. If you think something was
          removed wrongly, get in touch and it&rsquo;ll be looked at again.
        </p>
      </section>

      <footer className="pt-2 text-sm muted">
        <Link href="/takedown" style={{ color: "#7c5cff" }}>
          Report a rights issue →
        </Link>
      </footer>
    </article>
  );
}
