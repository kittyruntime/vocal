import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const VERSION_PATH = new URL("../../VERSION", import.meta.url);

export function getVersion(): string {
  try { return readFileSync(VERSION_PATH, "utf8").trim() || "0.0.0"; } catch { return "0.0.0"; }
}

export function getBuild(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try { return execSync("git rev-parse --short HEAD", { stdio: "ignore" }).toString().trim() || "unknown"; } catch { return "unknown"; }
}
