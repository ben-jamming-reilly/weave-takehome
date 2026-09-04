"use client";

import { useEffect, useState } from "react";

type Signal = "risk" | "leverage" | "product";
type Leader = {
  name: string;
  score: number;
  dimensions: { customer: number; risk: number; leverage: number; ownership: number; durability: number };
  durabilityEvidence: { survivingLines: number; lineMonths: number; durableShare: number; medianAgeDays: number; episodeCount: number; topEpisodes: { month: string; scope: string; lines: number; lineMonths: number; durabilityUnits: number }[] };
  prs: number;
  impactArcs: number;
  activeWeeks: number;
  longestOwnership: number;
  breadth: number;
  topScopes: { scope: string; weeks: number; prs: number }[];
  evidence: { pr: number; title: string; scope: string; date: string; url: string; signal: Signal }[];
};

export type Data = {
  window: { since: string; until: string; days: number };
  coverage: { commitsScanned: number; humanMergedPrs: number; engineersScored: number };
  weights: { customer: number; risk: number; leverage: number; ownership: number; durability: number };
  survivalCoverage: { changedEligibleFiles: number; sampledFiles: number; filesBlamed: number; currentLinesScanned: number; survivingWindowLines: number; sampling: string };
  leaders: Leader[];
};

const dimensionMeta = [
  { key: "customer" as const, label: "Product outcomes", short: "Outcome", color: "var(--orange)" },
  { key: "risk" as const, label: "Risk retired", short: "Risk", color: "var(--pink)" },
  { key: "leverage" as const, label: "Team leverage", short: "Leverage", color: "var(--lime)" },
  { key: "ownership" as const, label: "Sustained ownership", short: "Ownership", color: "var(--blue)" },
  { key: "durability" as const, label: "Code durability", short: "Durability", color: "var(--violet)" },
];

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("");
}

function plainTitle(title: string) {
  return title.replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, "");
}

function narrative(leader: Leader) {
  const strongest = [...dimensionMeta].sort((a, b) => leader.dimensions[b.key] - leader.dimensions[a.key])[0];
  const scope = leader.topScopes[0];
  return `${strongest.label} is the clearest signal: ${leader.dimensions[strongest.key]}th percentile. ${leader.name.split(" ")[0]} sustained work in ${scope.scope} across ${scope.weeks} of 14 weeks; ${leader.durabilityEvidence.survivingLines.toLocaleString()} sampled lines remain at HEAD.`;
}

export default function Dashboard({ data }: { data: Data }) {
  const [selected, setSelected] = useState(0);
  const [methodOpen, setMethodOpen] = useState(false);
  const leader = data.leaders[selected];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key >= "1" && event.key <= "5") setSelected(Number(event.key) - 1);
      if (event.key === "Escape") setMethodOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">W</span><span>Engineering impact</span></div>
        <div className="window-pill"><span className="live-dot" />90 days · {data.window.since} → {data.window.until}</div>
        <button className="method-button" onClick={() => setMethodOpen(true)}>How impact works <span>↗</span></button>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">POSTHOG · GITHUB</p>
          <h1 id="page-title">Who moved the work<br /><em>that mattered?</em></h1>
        </div>
        <p className="thesis">Impact is shipped work that keeps creating value. PR outcomes are grouped into product arcs; surviving code earns more credit for every month it remains at HEAD.</p>
      </section>

      <section className="workspace">
        <div className="leaderboard" aria-label="Top five engineers">
          <div className="section-label"><span>Top five</span><span>Impact percentile</span></div>
          {data.leaders.map((person, index) => (
            <button key={person.name} className={`leader-row ${selected === index ? "selected" : ""}`} onClick={() => setSelected(index)} aria-pressed={selected === index}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <span className={`avatar avatar-${index}`}>{initials(person.name)}</span>
              <span className="leader-name"><strong>{person.name}</strong><small>{person.topScopes[0].scope}</small></span>
              <span className="mini-track" aria-hidden="true"><i style={{ width: `${person.score}%` }} /></span>
              <span className="score">{person.score}</span>
              <span className="row-arrow">→</span>
            </button>
          ))}
          <div className="coverage-note">
            <strong>{data.coverage.commitsScanned.toLocaleString()}</strong> commits scanned
            <span>•</span><strong>{data.coverage.engineersScored}</strong> engineers compared
            <span>•</span><strong>100%</strong> date coverage
          </div>
        </div>

        <article className="detail" aria-live="polite">
          <div className="detail-head">
            <div>
              <p className="eyebrow">WHY #{selected + 1}</p>
              <h2>{leader.name}</h2>
            </div>
            <div className="score-seal"><strong>{leader.score}</strong><span>impact<br />percentile</span></div>
          </div>

          <p className="verdict">{narrative(leader)}</p>

          <div className="dimensions">
            {dimensionMeta.map((dimension) => (
              <div className="dimension" key={dimension.key}>
                <div><span>{dimension.label}</span><strong>{leader.dimensions[dimension.key]}</strong></div>
                <div className="dimension-track"><i style={{ width: `${leader.dimensions[dimension.key]}%`, background: dimension.color }} /></div>
                <small>{data.weights[dimension.key]}% weight</small>
              </div>
            ))}
          </div>

          <div className="durability-strip">
            <div><strong>{leader.durabilityEvidence.survivingLines.toLocaleString()}</strong><span>sampled lines still live</span></div>
            <div><strong>{leader.durabilityEvidence.durableShare}%</strong><span>of surviving 90-day code</span></div>
            <div><strong>{leader.durabilityEvidence.medianAgeDays}d</strong><span>median line age</span></div>
            <div><strong>{leader.durabilityEvidence.episodeCount}</strong><span>monthly code episodes</span></div>
          </div>
          <div className="evidence-head"><h3>Proof, not proxy</h3><span>{leader.impactArcs} impact arcs · {leader.activeWeeks}/14 active weeks</span></div>
          <div className="evidence-list">
            {leader.evidence.slice(0, 3).map((item) => (
              <a className="evidence" href={item.url} target="_blank" rel="noreferrer" key={item.pr}>
                <span className={`signal signal-${item.signal}`}>{item.signal === "risk" ? "RISK" : item.signal === "leverage" ? "LEVERAGE" : "PRODUCT"}</span>
                <span className="evidence-copy"><strong>{plainTitle(item.title)}</strong><small>{item.scope} · PR #{item.pr} · {item.date}</small></span>
                <span className="external">↗</span>
              </a>
            ))}
          </div>
        </article>
      </section>

      <footer>
        <span><b>Read this as a starting point.</b> Git history reveals shipped outcomes, not mentorship, incident leadership, or invisible coordination.</span>
        <span>Press 1–5 to compare</span>
      </footer>

      {methodOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setMethodOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="method-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setMethodOpen(false)} aria-label="Close methodology">×</button>
            <p className="eyebrow">TRANSPARENT BY DESIGN</p>
            <h2 id="method-title">Impact, with receipts.</h2>
            <p>Every merged PR is classified and collapsed into a weekly product arc. A deterministic Git-blame sample then finds nonblank production lines introduced or last touched in the window that still exist at HEAD. Each line earns up to three line-months; monthly product episodes use a square root so code volume has diminishing returns.</p>
            <div className="method-grid">
              {dimensionMeta.map((dimension) => (
                <div key={dimension.key}><strong style={{ color: dimension.color }}>{data.weights[dimension.key]}%</strong><h3>{dimension.label}</h3><p>{dimension.key === "customer" ? "New or improved product capability." : dimension.key === "risk" ? "Security, reliability, data integrity, and recovery." : dimension.key === "leverage" ? "Performance, tooling, tests, docs, and delivery systems." : dimension.key === "ownership" ? "Repeat ownership of the same product area over time." : "Age-weighted lines still present at HEAD, grouped into monthly product episodes."}</p></div>
              ))}
            </div>
            <div className="formula">Score = 25% outcome + 20% risk + 15% leverage + 15% ownership + 25% durability percentile</div>
            <p className="caveat"><strong>Durability coverage:</strong> {data.survivalCoverage.sampledFiles} of {data.survivalCoverage.changedEligibleFiles.toLocaleString()} eligible changed production files; {data.survivalCoverage.currentLinesScanned.toLocaleString()} current nonblank lines inspected. This is a deterministic sample, not a claim that more code is inherently better. Deleted code can be excellent engineering; mentorship, reviews, and incident leadership remain unobserved.</p>
          </section>
        </div>
      )}
    </main>
  );
}
