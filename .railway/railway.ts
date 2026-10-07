import { defineRailway, preserve, project, service, volume } from "railway/iac";

/**
 * Deploy settings for the app service, replacing railway.json (Railway retires
 * Config as Code on 2026-12-01).
 *
 * This repository owns only the app; Postgres is managed in the dashboard.
 *
 * Everything the app service has must be declared, because Railway removes
 * what this file leaves out. Without the source, volume and variables below,
 * an apply disconnects GitHub, unplugs the photo volume, and deletes
 * DATABASE_URL along with the rest.
 */
export const partial = "Daily-Tasks";

export default defineRailway(() => {
  // Uploaded media. STORAGE_ROOT points inside it; the container's own disk
  // is wiped on every deploy.
  const media = volume("daily-tasks-volume", { sizeMB: 5000, region: "sfo" });

  // Named for the service as it exists in Railway, not for the repository —
  // a name that matches nothing would create a second, empty service.
  const app = service("Moments", {
    // Pushing to this branch is what deploys.
    source: {
      type: "github",
      repo: "michaelhausman/Daily-Tasks",
      branch: "claude/media-sharing-tagging-platform-inmmg3",
    },
    build: {
      // Nixpacks, not Railway's newer default, because nixpacks.toml is what
      // puts ffmpeg in the image. Without it video posters and audio waveforms
      // quietly stop being generated.
      builder: "NIXPACKS",
      buildCommand: "npm run build",
    },
    deploy: {
      startCommand: "npm run start",
      healthcheckPath: "/",
      healthcheckTimeout: 120,
      // Restart on failure is Railway's default, which it stores as unset, so
      // naming it here would show as a pending change on every plan.
      restartPolicyMaxRetries: 3,
    },
    volumeMounts: {
      "/data": media,
    },
    // Values live in Railway, not in git — preserve() keeps whatever is set
    // there. See DEPLOY.md for what each one does.
    variables: {
      ADMIN_HANDLES: preserve(),
      DATABASE_URL: preserve(),
      SETLISTFM_API_KEY: preserve(),
      SIGNUP_INVITE_CODE: preserve(),
      STORAGE_ROOT: preserve(),
      TAKEDOWN_CONTACT_EMAIL: preserve(),
    },
  });

  return project("Tagpool", {
    resources: [app, media],
  });
});
