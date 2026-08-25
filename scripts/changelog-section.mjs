#!/usr/bin/env node
// Prints the CHANGELOG.md body for one version heading ("## [X.Y.Z] - date"),
// for use as GitHub Release notes. Used by .github/workflows/release.yml.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("usage: changelog-section.mjs <version>");
  process.exit(1);
}

const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const changelog = readFileSync(changelogPath, "utf8");
const heading = `## [${version}]`;
const headingIndex = changelog.indexOf(heading);
if (headingIndex === -1) {
  console.error(`changelog-section: no "${heading}" heading in CHANGELOG.md`);
  process.exit(1);
}
const bodyStart = changelog.indexOf("\n", headingIndex) + 1;
const nextHeadingIndex = changelog.indexOf("\n## [", bodyStart);
const body = changelog.slice(bodyStart, nextHeadingIndex === -1 ? undefined : nextHeadingIndex).trim();
if (!body) {
  console.error(`changelog-section: "${heading}" section is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
