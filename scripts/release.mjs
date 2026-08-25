#!/usr/bin/env node
// Cuts a release: bumps VERSION, moves CHANGELOG's [Unreleased] entries under
// a dated heading, syncs the desktop client's package.json version, and
// commits + tags the result. Pushing the tag (git push origin main --tags)
// is left to the caller -- that's what triggers the release workflow, so it
// shouldn't happen as a side effect of running this script.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const versionPath = `${repoRoot}VERSION`;
const changelogPath = `${repoRoot}CHANGELOG.md`;
const desktopPackagePath = `${repoRoot}desktop/package.json`;

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

const nextVersion = process.argv[2];
if (!nextVersion) fail("usage: pnpm release <version>  (e.g. pnpm release 0.2.0)");
if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) fail(`"${nextVersion}" is not a plain MAJOR.MINOR.PATCH version`);

const currentVersion = readFileSync(versionPath, "utf8").trim();
if (currentVersion === nextVersion) fail(`${nextVersion} is already the current version`);
const parse = (v) => v.split(".").map(Number);
const [curMajor, curMinor, curPatch] = parse(currentVersion);
const [nextMajor, nextMinor, nextPatch] = parse(nextVersion);
const isNewer =
  nextMajor > curMajor ||
  (nextMajor === curMajor && nextMinor > curMinor) ||
  (nextMajor === curMajor && nextMinor === curMinor && nextPatch > curPatch);
if (!isNewer) fail(`${nextVersion} is not newer than the current version ${currentVersion}`);

const changelog = readFileSync(changelogPath, "utf8");
const unreleasedHeading = "## [Unreleased]";
const headingIndex = changelog.indexOf(unreleasedHeading);
if (headingIndex === -1) fail("CHANGELOG.md has no [Unreleased] heading");
const afterHeading = headingIndex + unreleasedHeading.length;
const nextHeadingIndex = changelog.indexOf("\n## [", afterHeading);
const unreleasedBody = changelog.slice(afterHeading, nextHeadingIndex === -1 ? undefined : nextHeadingIndex).trim();
if (!unreleasedBody) fail("the [Unreleased] section is empty -- add changelog entries before releasing");

const today = new Date().toISOString().slice(0, 10);
const rest = nextHeadingIndex === -1 ? "" : changelog.slice(nextHeadingIndex);
const updatedChangelog =
  changelog.slice(0, headingIndex) +
  `${unreleasedHeading}\n\n## [${nextVersion}] - ${today}\n\n${unreleasedBody}\n` +
  rest;

writeFileSync(versionPath, `${nextVersion}\n`);
writeFileSync(changelogPath, updatedChangelog);

const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
desktopPackage.version = nextVersion;
writeFileSync(desktopPackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`);

run("git", ["add", "VERSION", "CHANGELOG.md", "desktop/package.json"]);
run("git", ["commit", "-m", `chore(release): v${nextVersion}`]);
run("git", ["tag", `v${nextVersion}`]);

console.log(`\nTagged v${nextVersion}. Push it to publish: git push origin main --tags`);
