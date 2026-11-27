import { defineConfig } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const systemChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const db = join(mkdtempSync(join(tmpdir(), "hawk-e2e-")), "test.sqlite3");
export default defineConfig({
  testDir: "./tests",
  metadata: { db },
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3127",
    launchOptions: {
      executablePath:
        process.env.HAWK_CHROME ||
        (existsSync(systemChrome) ? systemChrome : undefined),
    },
  },
  webServer: {
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    command: "cd .. && .hawk-venv/bin/python -m scripts.serve",
    url: "http://127.0.0.1:3127/session",
    reuseExistingServer: false,
    env: {
      HAWK_DB: db,
      HAWK_WEB_PORT: "3127",
      HAWK_API_PORT: "8127",
      HAWK_WEB_MODE: "start",
      HAWK_CLOCK: "demo",
    },
    timeout: 45000,
  },
});
