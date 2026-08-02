import { permanentRedirect } from "next/navigation";

/**
 * Redirect for the old three-segment moment URL.
 *
 * Moments used to be identified by (performer, place, date) and lived at
 * `/m/aimee-mann/eau-claire-festival/2026-07-24`. They're now (place, date),
 * so that link needs to land on `/m/eau-claire-festival/2026-07-24` with the
 * performer applied as an in-page filter.
 *
 * The parameter names are inherited from the two-segment route above — Next
 * requires the same slug name at each position — so `where` is really the old
 * performer, `date` the old place, and `legacy` the old date. Ugly, but the
 * alternative is breaking every link already shared.
 */
export default async function LegacyMomentRedirect({
  params,
}: {
  params: Promise<{ where: string; date: string; legacy: string }>;
}) {
  const { where: oldWho, date: oldWhere, legacy: oldDate } = await params;
  permanentRedirect(`/m/${oldWhere}/${oldDate}?who=${oldWho}`);
}
