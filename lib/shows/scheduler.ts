import { SETLISTFM_API_KEY, SHOW_REFRESH_DAYS } from "@/lib/config";
import { refreshDuePerformer } from "./sync";

/**
 * Keeps loaded touring histories current, without anything outside the app.
 *
 * A timer in the web process is the unglamorous option, and here it's the
 * right one. The alternative — a cron service, or an endpoint poked from
 * outside — means a second Railway service or a second system to keep alive,
 * to hold the API key, and to explain in the deploy docs, in exchange for
 * nothing this doesn't already do. The service runs continuously and can't
 * scale past one replica while it has a volume attached, so there is exactly
 * one of these timers and no coordination problem to solve.
 *
 * What survives restarts is in the database, not here: every decision about
 * what is due comes from the import history, so a container that restarts
 * twice a day refreshes on the same schedule as one that runs for a month.
 * The timer is only a nudge to go and look.
 */

/** How often to check. Checking is a couple of queries; refreshing is rare. */
const TICK_MS = 60 * 60_000;

/**
 * Quiet period after boot. A deploy shouldn't spend its first minute making a
 * few hundred API calls while the app is still warming up, and a crash loop
 * shouldn't hammer setlist.fm once per restart.
 */
const FIRST_TICK_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startShowRefresh(): void {
  if (timer) return;
  if (SHOW_REFRESH_DAYS <= 0) {
    console.log("[tagpool] show auto-refresh off (SHOW_REFRESH_DAYS=0)");
    return;
  }
  if (!SETLISTFM_API_KEY) {
    console.log("[tagpool] show auto-refresh idle — no SETLISTFM_API_KEY");
    return;
  }

  console.log(
    `[tagpool] show auto-refresh on — every ${SHOW_REFRESH_DAYS} days per artist`,
  );

  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
    // Don't hold the process open; shutting down mid-wait is fine, because
    // the next boot works the same thing out from the database.
    timer.unref?.();
  }, FIRST_TICK_MS).unref?.();
}

async function tick(): Promise<void> {
  try {
    const result = await refreshDuePerformer();
    // Only speak up when something actually happened. "nothing due" is the
    // answer almost every hour, and a log line for it buries the real ones.
    if ("started" in result) {
      console.log(`[tagpool] auto-refreshing ${result.started} from setlist.fm`);
    } else if (!NORMAL_SKIPS.has(result.skipped)) {
      console.log(`[tagpool] auto-refresh skipped — ${result.skipped}`);
    }
  } catch (error) {
    // A refresh that throws must never take the web server with it.
    console.error("[tagpool] auto-refresh tick failed:", error);
  }
}

const NORMAL_SKIPS = new Set(["nothing due", "auto-refresh is off"]);
