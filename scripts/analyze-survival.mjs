import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repo = process.argv[2] || "/private/tmp/posthog-90d";
const output = resolve(process.argv[3] || "./src/data/survival.json");
const maxFiles = Number(process.argv[4] || 240);
const since = process.env.SINCE || "2026-06-05T00:00:00Z";
const until = process.env.UNTIL || "2026-09-03T23:59:59Z";
const untilMs = new Date(until).getTime();

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const normalize = (name) => name.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const botPattern = /\[bot\]|bot@|dependabot|renovate|github-actions|posthog-js-upgrader|scheduled-actions|mendral/i;
const eligibleFile = /\.(ts|tsx|js|jsx|py|go|rs|java|kt|cpp|c|h)$/i;
const excludedFile = /(^|\/)(test|tests|__tests__|spec|specs|snapshots?|fixtures?|vendor|generated|migrations?|node_modules)(\/|$)|\.(test|spec|snap)$/i;

const scopeAliases = [
  [/warehouse|data-import|data-model|batch-export|source|destination/, "data platform"],
  [/session-replay|replay/, "session replay"],
  [/feature-flag|flags|experiments?/, "flags & experiments"],
  [/error-tracking|sentry|exceptions?/, "error tracking"],
  [/llm|ai\b|mcp|tasks?|agents?/, "AI & tasks"],
  [/billing|invoice|subscription/, "billing"],
  [/auth|permission|access-control|oauth|sso/, "identity & access"],
  [/analytics|insights?|hogql|query/, "product analytics"],
  [/infra|kafka|clickhouse|temporal|deploy|ci\b|devex|tooling/, "platform"],
  [/frontend|lemon|navigation|design-system|ui\b/, "frontend platform"],
  [/mobile|android|ios|react-native/, "mobile"],
];

function scopeFor(subject, filename) {
  const explicit = subject.match(/^[a-z]+\(([^)]+)\)/i)?.[1]?.toLowerCase() || "";
  const haystack = `${explicit} ${subject} ${filename}`.toLowerCase();
  for (const [pattern, label] of scopeAliases) if (pattern.test(haystack)) return label;
  if (explicit) return explicit.replaceAll("_", " ");
  if (filename.startsWith("products/")) return filename.split("/")[1].replaceAll("_", " ");
  return filename.split("/")[0].replaceAll("_", " ");
}

const commitLog = git("log", `--since=${since}`, `--until=${until}`, "--format=%H%x1f%aN%x1f%aE%x1f%aI%x1f%s%x1e");
const commits = new Map(commitLog.split("\x1e").map((record) => {
  const clean = record.trim();
  if (!clean) return null;
  const [hash, name, email, date, subject] = clean.split("\x1f");
  return [hash, { hash, name, email, date, subject }];
}).filter(Boolean));

const boundary = git("rev-list", "--max-parents=0", "HEAD").trim().split("\n").at(-1);
const changed = git("diff", "--name-only", "--diff-filter=AMR", boundary, "HEAD")
  .split("\n").filter((file) => eligibleFile.test(file) && !excludedFile.test(file));

const sampled = changed.map((file) => ({ file, order: createHash("sha1").update(`weave-survival-v1:${file}`).digest("hex") }))
  .sort((a, b) => a.order.localeCompare(b.order)).slice(0, maxFiles).map(({ file }) => file);

const people = new Map();
let currentLinesScanned = 0;
let survivingWindowLines = 0;
let filesBlamed = 0;

for (const filename of sampled) {
  let blame;
  try {
    blame = git("blame", "--line-porcelain", "HEAD", "--", filename);
  } catch {
    continue;
  }
  filesBlamed += 1;
  let hash = "";
  let author = "";
  let email = "";
  for (const line of blame.split("\n")) {
    if (/^[0-9a-f^]{40}\s/.test(line)) hash = line.slice(0, 40).replace(/^\^/, "");
    else if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("author-mail ")) email = line.slice(12).replace(/[<>]/g, "");
    else if (line.startsWith("\t")) {
      if (!line.slice(1).trim()) continue;
      currentLinesScanned += 1;
      const commit = commits.get(hash);
      if (!commit || botPattern.test(`${author} ${email}`)) continue;
      survivingWindowLines += 1;
      const key = normalize(author);
      const person = people.get(key) || { name: author, survivingLines: 0, lineMonths: 0, ages: [], episodes: new Map() };
      const ageDays = Math.max(0, Math.min(90, (untilMs - new Date(commit.date).getTime()) / 86400000));
      const lineMonths = ageDays / 30;
      const scope = scopeFor(commit.subject, filename);
      const month = commit.date.slice(0, 7);
      const episodeKey = `${month}|${scope}`;
      const episode = person.episodes.get(episodeKey) || { month, scope, lines: 0, lineMonths: 0 };
      episode.lines += 1;
      episode.lineMonths += lineMonths;
      person.episodes.set(episodeKey, episode);
      person.survivingLines += 1;
      person.lineMonths += lineMonths;
      person.ages.push(ageDays);
      people.set(key, person);
    }
  }
}

const records = Object.fromEntries([...people.entries()].map(([key, person]) => {
  const episodes = [...person.episodes.values()].map((episode) => ({ ...episode, durabilityUnits: Math.sqrt(episode.lineMonths) })).sort((a, b) => b.durabilityUnits - a.durabilityUnits);
  const ages = person.ages.sort((a, b) => a - b);
  return [key, {
    name: person.name,
    survivingLines: person.survivingLines,
    lineMonths: Math.round(person.lineMonths),
    durableShare: Number(((person.survivingLines / Math.max(1, survivingWindowLines)) * 100).toFixed(2)),
    medianAgeDays: Math.round(ages[Math.floor(ages.length / 2)] || 0),
    durabilityRaw: Number(episodes.reduce((sum, episode) => sum + episode.durabilityUnits, 0).toFixed(2)),
    episodeCount: episodes.length,
    topEpisodes: episodes.slice(0, 3).map((episode) => ({ ...episode, lineMonths: Math.round(episode.lineMonths), durabilityUnits: Number(episode.durabilityUnits.toFixed(2)) })),
  }];
}));

const result = {
  generatedAt: new Date().toISOString(),
  window: { since: since.slice(0, 10), until: until.slice(0, 10) },
  coverage: { changedEligibleFiles: changed.length, sampledFiles: sampled.length, filesBlamed, currentLinesScanned, survivingWindowLines, sampling: "Deterministic SHA-1 sample of production-code files changed during the window; tests, generated code, migrations, fixtures, and vendor code excluded." },
  people: records,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.coverage, null, 2));
