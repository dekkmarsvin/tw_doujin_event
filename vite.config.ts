import vinext from "vinext";
import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const stagePath = resolve(import.meta.dirname, ".event-data-stage.json");
const staged = existsSync(stagePath) ? JSON.parse(readFileSync(stagePath, "utf8")) as { eventId: string } : { eventId: "sample" };
const stagedEventPath = resolve(import.meta.dirname, "public", "data", "events", staged.eventId, "event.json");
const fixtureEventPath = resolve(import.meta.dirname, "fixtures", "events", staged.eventId, "event.json");
const fallbackEventPath = resolve(import.meta.dirname, "fixtures", "events", "sample", "event.json");
const activeEventPath = existsSync(stagedEventPath) ? stagedEventPath : existsSync(fixtureEventPath) ? fixtureEventPath : fallbackEventPath;
const activeEvent = JSON.parse(readFileSync(activeEventPath, "utf8"));

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_date: "2026-05-22",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: { __ACTIVE_EVENT_DEFINITION__: JSON.stringify(activeEvent) },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
