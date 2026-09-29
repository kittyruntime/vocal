import { defineConfig, devices } from "@playwright/test";

// Everything the suite needs besides a running PostgreSQL and a
// `livekit-server` binary (see README's "End-to-end tests"): LiveKit itself,
// a freshly reset database, the API server, and the Vite dev server that
// proxies /api and /ws to it.
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://vocal:vocal@localhost:5433/vocal_e2e";
const webUrl = "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone", "camera"],
        launchOptions: {
          // Lets a sandbox without Playwright's own browser download point at
          // an existing Chromium; CI installs the matching one instead.
          executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
  ],
  webServer: [
    {
      command: `${process.env.E2E_LIVEKIT_BIN ?? "livekit-server"} --config livekit.yaml`,
      url: "http://localhost:7880",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node scripts/reset-db.mjs && pnpm -C ../server exec tsx src/server.ts",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      env: {
        E2E_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        MESSAGE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        COOKIE_SECURE: "false",
        LIVEKIT_URL: "ws://localhost:7880",
        LIVEKIT_API_KEY: "devkey",
        LIVEKIT_API_SECRET: "e2e-only-livekit-secret-0123456789abcdef",
      },
    },
    {
      command: "pnpm -C ../web exec vite --port 5173 --strictPort",
      url: webUrl,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
