import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repo = process.argv[2] || "/private/tmp/posthog-90d";
const output = resolve(process.argv[3] || "./src/data/impact.json");
const since = process.env.SINCE || "2026-06-05T00:00:00Z";
const until = process.env.UNTIL || "2026-09-03T23:59:59Z";

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const log = git("log", `--since=${since}`, `--until=${until}`, "--format=%H%x1f%aN%x1f%aE%x1f%aI%x1f%s%x1f%b%x1e");
const filesByHash = new Map();

const commits = log.split("\x1e").map((record) => {
  const clean = record.trim();
  if (!clean) return null;
  const [hash, name, email, date, subject, body = ""] = clean.split("\x1f");
  return { hash, name, email, date, subject, body, files: filesByHash.get(hash) || [] };
}).filter(Boolean);

const botPattern = /\[bot\]|bot@|dependabot|renovate|github-actions|posthog-js-upgrader|scheduled-actions|mendral/i;
const trivialPattern = /^(chore\(deps\)|chore\(i18n\)|chore\(translations?\)|chore: bump|trunk-merge|merge branch|revert "?trunk-merge)/i;
const severePattern = /vulnerab|data loss|corrupt|leak|migration|incident|outage|deadlock|race condition|idempot|rollback|quota|rate.?limit|crash|\boom\b|memory leak|retry|recovery|graceful|integrity/i;
const securityPattern = /security|\bauth\b|authorization|authentication|permission|access control|privacy|credential|token/i;
const leveragePattern = /perf|latency|faster|speed|cache|cost|scale|throughput|benchmark|ci\b|developer|tooling|observab|telemetry|tracing|test|docs|lint|typecheck|build|deploy/i;
const customerPattern = /feat|fix|support|allow|enable|add|new|improve|redesign|onboarding|dashboard|experiment|analytics|warehouse|session replay|feature flag|insight|survey|error tracking|logs|traces|product/i;

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
  [/docs?/, "docs"],
];

function weekKey(dateString) {
  const d = new Date(dateString);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function deriveScope(subject, files) {
  const explicit = subject.match(/^[a-z]+\(([^)]+)\)/i)?.[1]?.toLowerCase() || "";
  const haystack = `${explicit} ${subject} ${files.slice(0, 15).join(" ")}`.toLowerCase();
  for (const [pattern, label] of scopeAliases) if (pattern.test(haystack)) return label;
  if (explicit) return explicit.replaceAll("_", " ");
  const productPath = files.find((file) => file.startsWith("products/"));
  if (productPath) return productPath.split("/")[1].replaceAll("_", " ");
  return files[0]?.split("/")[0]?.replaceAll("_", " ") || "core";
}

function classify(subject) {
  const lower = subject.toLowerCase();
  const type = lower.match(/^([a-z]+)(?:\(|:)/)?.[1] || "other";
  const risk = securityPattern.test(lower) || (["fix", "perf"].includes(type) && severePattern.test(lower));
  const leverage = leveragePattern.test(lower) || ["perf", "test", "docs", "build", "ci"].includes(type);
  const customer = customerPattern.test(lower) || ["feat", "fix"].includes(type);
  const base = type === "feat" ? 3.2 : type === "fix" ? 2.5 : type === "perf" ? 3 : type === "docs" ? 1.3 : type === "test" ? 1.4 : type === "refactor" ? 1.5 : 0.8;
  return { type, risk, leverage, customer, base: base + (risk ? 1.4 : 0) + (leverage ? 0.7 : 0) };
}

const people = new Map();
for (const commit of commits) {
  const pr = commit.subject.match(/\(#(\d+)\)\s*$/)?.[1];
  if (!pr || botPattern.test(`${commit.name} ${commit.email}`) || trivialPattern.test(commit.subject)) continue;
  const key = commit.name.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const person = people.get(key) || { name: commit.name.trim(), emails: new Set(), commits: [], arcs: new Map(), scopes: new Map(), activeWeeks: new Set() };
  const scope = deriveScope(commit.subject, commit.files);
  const week = weekKey(commit.date);
  const classification = classify(commit.subject);
  const item = { ...commit, pr: Number(pr), scope, week, ...classification };
  person.emails.add(commit.email);
  person.commits.push(item);
  person.activeWeeks.add(week);
  if (!person.scopes.has(scope)) person.scopes.set(scope, new Set());
  person.scopes.get(scope).add(week);
  const arcKey = `${week}|${scope}`;
  const arc = person.arcs.get(arcKey) || { week, scope, prs: [], customer: 0, risk: 0, leverage: 0, peak: 0 };
  arc.prs.push(item);
  arc.customer += item.customer ? item.base : 0;
  arc.risk += item.risk ? item.base : 0;
  arc.leverage += item.leverage ? item.base : 0;
  arc.peak = Math.max(arc.peak, item.base);
  person.arcs.set(arcKey, arc);
  people.set(key, person);
}

const rawPeople = [...people.values()].filter((p) => p.commits.length >= 4).map((person) => {
  const arcs = [...person.arcs.values()];
  const diminishing = (value) => Math.min(7.5, Math.sqrt(value) * 2.25);
  const customerRaw = arcs.reduce((sum, arc) => sum + diminishing(arc.customer), 0);
  const riskRaw = arcs.reduce((sum, arc) => sum + diminishing(arc.risk), 0);
  const leverageRaw = arcs.reduce((sum, arc) => sum + diminishing(arc.leverage), 0);
  const longestOwnership = Math.max(0, ...[...person.scopes.values()].map((weeks) => weeks.size));
  const breadthRaw = Math.min(8, person.scopes.size);
  const activeWeeks = person.activeWeeks.size;
  const candidates = [...person.commits].sort((a, b) => (b.base + (b.risk ? 2 : 0) + (b.leverage ? 1 : 0)) - (a.base + (a.risk ? 2 : 0) + (a.leverage ? 1 : 0)));
  const evidenceItems = [];
  const evidenceTests = [
    ["product", (item) => item.customer && !item.risk && !item.leverage],
    ["risk", (item) => item.risk],
    ["leverage", (item) => item.leverage && !item.risk],
  ];
  for (const [signal, test] of evidenceTests) {
    const match = candidates.find((item) => test(item) && !evidenceItems.some((picked) => picked.item.pr === item.pr));
    if (match) evidenceItems.push({ item: match, signal });
  }
  for (const item of candidates) {
    if (evidenceItems.length >= 4) break;
    if (!evidenceItems.some((picked) => picked.item.pr === item.pr || picked.item.scope === item.scope)) evidenceItems.push({ item, signal: item.risk ? "risk" : item.leverage ? "leverage" : "product" });
  }
  const evidence = evidenceItems.map(({ item, signal }) => ({ pr: item.pr, title: item.subject.replace(/\s*\(#\d+\)\s*$/, ""), scope: item.scope, date: item.date.slice(0, 10), url: `https://github.com/PostHog/posthog/pull/${item.pr}`, signal }));
  return { person, customerRaw, riskRaw, leverageRaw, ownershipRaw: longestOwnership + activeWeeks * 0.3 + breadthRaw * 0.35, activeWeeks, longestOwnership, breadth: person.scopes.size, evidence };
});

function percentile(value, values) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = sorted.findLastIndex((v) => v <= value);
  return Math.round((index / Math.max(1, sorted.length - 1)) * 100);
}

const dimensions = ["customerRaw", "riskRaw", "leverageRaw", "ownershipRaw"];
const distributions = Object.fromEntries(dimensions.map((key) => [key, rawPeople.map((p) => p[key])]));
const ranked = rawPeople.map((entry) => {
  const customer = percentile(entry.customerRaw, distributions.customerRaw);
  const risk = percentile(entry.riskRaw, distributions.riskRaw);
  const leverage = percentile(entry.leverageRaw, distributions.leverageRaw);
  const ownership = percentile(entry.ownershipRaw, distributions.ownershipRaw);
  const score = Math.round(customer * 0.35 + risk * 0.3 + leverage * 0.2 + ownership * 0.15);
  const topScopes = [...entry.person.scopes.entries()].map(([scope, weeks]) => ({ scope, weeks: weeks.size, prs: entry.person.commits.filter((c) => c.scope === scope).length })).sort((a, b) => b.weeks - a.weeks || b.prs - a.prs).slice(0, 3);
  return { name: entry.person.name, score, dimensions: { customer, risk, leverage, ownership }, prs: entry.person.commits.length, impactArcs: entry.person.arcs.size, activeWeeks: entry.activeWeeks, longestOwnership: entry.longestOwnership, breadth: entry.breadth, topScopes, evidence: entry.evidence };
}).sort((a, b) => b.score - a.score || b.impactArcs - a.impactArcs);

const result = {
  generatedAt: new Date().toISOString(),
  repository: "PostHog/posthog",
  window: { since: since.slice(0, 10), until: until.slice(0, 10), days: 91 },
  coverage: { commitsScanned: commits.length, humanMergedPrs: rawPeople.reduce((sum, p) => sum + p.person.commits.length, 0), engineersScored: rawPeople.length, method: "Complete blobless git history for the date window; merged PRs identified by squash-commit PR references." },
  weights: { customer: 35, risk: 30, leverage: 20, ownership: 15 },
  leaders: ranked.slice(0, 5),
  benchmark: {
    medianImpactArcs: Math.round(ranked.map((p) => p.impactArcs).sort((a, b) => a - b)[Math.floor(ranked.length / 2)] || 0),
    medianActiveWeeks: Math.round(ranked.map((p) => p.activeWeeks).sort((a, b) => a - b)[Math.floor(ranked.length / 2)] || 0),
  }
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
