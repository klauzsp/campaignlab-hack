"use client";

import { useEffect, useState } from "react";
import type { Council, Evidence } from "@civic-lens/core";
import type { AgentTrace, Analysis } from "../lib/agent";
import { ArrowIcon, CheckIcon, ExternalIcon, FileIcon, LayersIcon, SearchIcon, SparkIcon } from "./icons";

type Result = {
  query: string;
  total: number;
  evidence: Evidence[];
  analysis: Analysis;
  provider: string;
  trace?: AgentTrace[];
  generatedAt: string;
};

const examples = ["Missed bin collections", "Adult social care recruitment", "High street vacancy rates"];

export function OfficerWorkspace() {
  const [query, setQuery] = useState("How have other councils reduced missed bin collections?");
  const [councils, setCouncils] = useState<Council[]>([]);
  const [councilId, setCouncilId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/councils")
      .then((response) => response.json())
      .then((data: { councils?: Council[] }) => setCouncils(data.councils ?? []))
      .catch(() => undefined);
  }, []);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), councilId: councilId ? Number(councilId) : undefined }),
      });
      const data = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Research failed.");
      setResult(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Research failed.");
    } finally {
      setLoading(false);
    }
  }

  const sourceName = (id: number) => result?.evidence[id - 1]?.councilName ?? `Source ${id}`;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark"><LayersIcon /></span><span>Civic <em>Lens</em></span></a>
        <nav aria-label="Primary navigation"><a className="active" href="#research">Research</a><a href="#briefs">Saved briefs</a><a href="#sources">Sources</a></nav>
        <div className="user"><span>SP</span><div><strong>Samuel Parke</strong><small>Policy & insights</small></div></div>
      </header>

      <section className="hero" id="research">
        <div className="eyebrow"><span /><p>Officer intelligence workspace</p></div>
        <h1>Start with a question.<br /><em>Leave with evidence.</em></h1>
        <p className="lede">Research how councils across the UK have approached a shared challenge—grounded in real minutes, reports and decisions.</p>

        <form className="search-panel" onSubmit={submit}>
          <div className="search-row"><SearchIcon /><textarea value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Research question" rows={2} /><button type="submit" disabled={loading}>{loading ? <span className="spinner" /> : <ArrowIcon />}</button></div>
          <div className="filters"><label>Search across <select value={councilId} onChange={(event) => setCouncilId(event.target.value)}><option value="">All UK councils</option>{councils.map((council) => <option value={council.id} key={council.id}>{council.name}</option>)}</select></label><span className="data-status"><i /> Live Poteris data</span></div>
        </form>
        <div className="examples"><span>Try asking</span>{examples.map((example) => <button key={example} onClick={() => setQuery(`How have councils addressed ${example.toLowerCase()}?`)}>{example}</button>)}</div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      {!result && !loading && <section className="how-it-works"><div><span>01</span><h3>Ask in plain English</h3><p>Describe the service challenge, policy question or local concern.</p></div><div><span>02</span><h3>Trace every claim</h3><p>Review passages from original council papers, with source links intact.</p></div><div><span>03</span><h3>Shape the briefing</h3><p>Turn comparable approaches into an officer-ready starting point.</p></div></section>}

      {loading && <section className="loading-state"><div className="radar"><SparkIcon /></div><div><span>Gemini agent working</span><h2>Selecting council research tools…</h2><p>The agent may search, inspect documents and refine its evidence before answering.</p></div></section>}

      {result && !loading && <section className="results">
        <div className="result-heading"><div><span className="kicker"><SparkIcon /> Research brief</span><h2>{result.analysis.headline}</h2><p>{result.analysis.summary}</p></div><aside><strong>{result.evidence.length}</strong><span>sources selected</span><small>{result.total.toLocaleString()} records matched</small></aside></div>

        <div className="result-grid">
          <article className="brief-card">
            <div className="card-header"><div><span className="section-number">01</span><h3>Approaches in practice</h3></div><span className="provider">{result.provider}</span></div>
            <div className="approaches">{result.analysis.approaches.map((approach, index) => <div className="approach" key={`${approach.title}-${index}`}><div className="approach-index">{String(index + 1).padStart(2, "0")}</div><div><h4>{approach.title}</h4><p>{approach.detail}</p><div className="citations">{approach.evidenceIds.map((id) => <a key={id} href={result.evidence[id - 1]?.url ?? "#sources"} target="_blank" rel="noreferrer"><FileIcon /> {sourceName(id)} <sup>{id}</sup></a>)}</div></div></div>)}</div>
          </article>

          <aside className="side-column">
            {result.trace && result.trace.length > 0 && <div className="trace-card"><div className="trace-heading"><SparkIcon /><div><small>Agent activity</small><h3>{result.trace.length} MCP tool call{result.trace.length === 1 ? "" : "s"}</h3></div></div><ol>{result.trace.map((step, index) => <li key={`${step.tool}-${index}`}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.tool}</small></div><CheckIcon /></li>)}</ol></div>}
            <div className="note-card"><span className="section-number">02</span><h3>Officer considerations</h3><ul>{result.analysis.considerations.map((item) => <li key={item}><span>!</span>{item}</li>)}</ul></div>
            <div className="next-card"><span className="section-number">03</span><h3>Suggested next steps</h3><ul>{result.analysis.nextSteps.map((item) => <li key={item}><CheckIcon />{item}</li>)}</ul><button onClick={() => window.print()}>Create briefing note <ArrowIcon /></button></div>
          </aside>
        </div>

        <div className="sources" id="sources"><div className="sources-title"><div><span className="section-number">04</span><h3>Evidence library</h3></div><p>Open the original record before using a finding.</p></div><div className="source-list">{result.evidence.map((item, index) => <a className="source-row" key={item.id} href={item.url ?? "#"} target="_blank" rel="noreferrer"><span className="source-id">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.councilName ?? "Council record"}</strong><span>{item.title}</span></div><time>{item.date ? new Date(item.date).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "Undated"}</time><ExternalIcon /></a>)}</div></div>
      </section>}

      <footer><div><LayersIcon /><span>Civic Lens</span></div><p>Evidence to inform—not replace—professional judgement.</p><a href="https://councilgateway.poteris.co.uk/council-api/docs" target="_blank" rel="noreferrer">Powered by Poteris data <ExternalIcon /></a></footer>
    </main>
  );
}
