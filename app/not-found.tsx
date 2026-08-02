import Link from "next/link";

export default function NotFound() {
  return (
    <div className="surface mx-auto max-w-md rounded-2xl p-10 text-center">
      <h1 className="mb-2 text-2xl font-bold">Nothing here</h1>
      <p className="mb-6 text-sm muted">
        That page doesn&apos;t exist, or the moment has no uploads yet.
      </p>
      <Link href="/explore" className="btn btn-primary">
        Explore moments
      </Link>
    </div>
  );
}
