import Link from "next/link";

export const metadata = {
  title: "Takedown requests — Tagpool",
  description:
    "How to ask for material to be removed from Tagpool, including rights holder requests.",
};

const CONTACT = process.env.TAKEDOWN_CONTACT_EMAIL ?? "set TAKEDOWN_CONTACT_EMAIL";

export default function TakedownPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Takedown requests</h1>
        <p className="mt-2 text-sm muted">
          For rights holders, and for anyone who wants something removed.
        </p>
      </header>

      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          background: "var(--surface-2)",
          borderLeft: "2px solid #f05252",
        }}
      >
        <strong>Draft.</strong> This describes a process, not a legally reviewed
        notice-and-takedown policy. If you operate this site publicly in the US,
        have a lawyer confirm what you need — including whether to register a
        DMCA agent, which is what limits your liability for what other people
        upload.
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">The quickest route</h2>
        <p className="text-sm">
          If you have an account, the <strong>Report</strong> link on any upload,
          comment, or moment goes straight to the moderation queue. Choose{" "}
          <em>Copyright</em> and say who you are and what you hold rights to.
        </p>
        <p className="text-sm">
          Without an account, email{" "}
          <a href={`mailto:${CONTACT}`} style={{ color: "#7c5cff" }}>
            {CONTACT}
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">What to include</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Links to the specific uploads — not just the artist name</li>
          <li>What you hold the rights to, and in what capacity</li>
          <li>Whether you&rsquo;re the rights holder or acting for one</li>
          <li>How to reach you</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">What happens next</h2>
        <p className="text-sm">
          Material subject to a credible rights claim is hidden while it&rsquo;s
          reviewed, which takes it off the site immediately without destroying
          it. If the claim holds up it&rsquo;s deleted; if it doesn&rsquo;t,
          it&rsquo;s restored. The person who uploaded it is told what happened
          and why.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">On live recordings specifically</h2>
        <p className="text-sm">
          A recording of a performance carries rights belonging to the performer,
          the songwriter, and sometimes the venue. Some artists permit taping and
          their material is welcome here. If you represent an artist who
          doesn&rsquo;t, say so and their recordings will be removed — you
          don&rsquo;t need to enumerate every upload if the request covers an
          artist&rsquo;s catalogue.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">If you&rsquo;re in a photo</h2>
        <p className="text-sm">
          You don&rsquo;t need to hold any rights. Ask, point at the photo, and
          it will be taken down.
        </p>
      </section>

      <footer className="pt-2 text-sm muted">
        <Link href="/rules" style={{ color: "#7c5cff" }}>
          ← House rules
        </Link>
      </footer>
    </article>
  );
}
