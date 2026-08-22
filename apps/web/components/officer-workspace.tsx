"use client";

import { useEffect, useState } from "react";
import type { Council, Evidence } from "@civic-lens/core";
import type { AgentTrace, Analysis, ResearchMode } from "../lib/agent";
import { ArrowIcon, CheckIcon, ExternalIcon, FileIcon, LayersIcon, SearchIcon, SparkIcon } from "./icons";

type Result = {
  query: string;
  total: number;
  evidence: Evidence[];
  analysis: Analysis;
  provider: string;
  trace?: AgentTrace[];
  mode?: ResearchMode;
  generatedAt: string;
};

type Turn = {
  question: string;
  result: Result;
};

const examples = ["Missed bin collections", "Adult social care recruitment", "High street vacancy rates"];

export function OfficerWorkspace() {
  const [query, setQuery] = useState("How have other councils reduced missed bin collections?");
  const [councils, setCouncils] = useState<Council[]>([]);
  const [councilId, setCouncilId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [liveTrace, setLiveTrace] = useState<AgentTrace[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/councils")
      .then((response) => response.json())
      .then((data: { councils?: Council[] }) => setCouncils(data.councils ?? []))
      .catch(() => undefined);
  }, []);

  async function runResearch(nextQuestion: string) {
    const cleanedQuestion = nextQuestion.trim();
    if (cleanedQuestion.length < 2) return;
    setLoading(true);
    setPendingQuestion(cleanedQuestion);
    setLiveTrace([]);
    setError("");
    try {
      const history = turns.flatMap((turn) => [
        { role: "officer" as const, content: turn.question },
        { role: "assistant" as const, content: `${turn.result.analysis.headline}\n${turn.result.analysis.summary}` },
      ]);
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanedQuestion, councilId: councilId ? Number(councilId) : undefined, history, mode: researchMode, stream: true }),
      });
      if (!response.ok) {
        const failure = await response.json() as { error?: string };
        throw new Error(failure.error ?? "Research failed.");
      }
      let data: (Result & { error?: string }) | null = null;
      if (response.headers.get("content-type")?.includes("application/x-ndjson") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: string; trace?: AgentTrace; data?: Result; error?: string };
            if (event.type === "activity" && event.trace) setLiveTrace((current) => [...current, event.trace!]);
            if (event.type === "complete" && event.data) data = event.data;
            if (event.type === "error") throw new Error(event.error ?? "Research failed.");
          }
          if (done) break;
        }
      } else {
        data = (await response.json()) as Result & { error?: string };
      }
      if (!data) throw new Error("The agent finished without returning a briefing.");
      setResult(data);
      setTurns((current) => [...current, { question: cleanedQuestion, result: data }]);
      setFollowUp("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Research failed.");
    } finally {
      setLoading(false);
      setPendingQuestion("");
      setLiveTrace([]);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void runResearch(query);
  }

  function submitFollowUp(event: React.FormEvent) {
    event.preventDefault();
    void runResearch(followUp);
  }

  function startNewThread() {
    setResult(null);
    setTurns([]);
    setFollowUp("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          <div className="filters"><label>Search across <select value={councilId} onChange={(event) => setCouncilId(event.target.value)}><option value="">All UK councils</option>{councils.map((council) => <option value={council.id} key={council.id}>{council.name}</option>)}</select></label><div className="mode-switch" aria-label="Research depth"><span>Depth</span><button type="button" className={researchMode === "quick" ? "active" : ""} onClick={() => setResearchMode("quick")}>Quick</button><button type="button" className={researchMode === "deep" ? "active" : ""} onClick={() => setResearchMode("deep")}>Deep</button></div><span className="data-status"><i /> Live Poteris data</span></div>
        </form>
        <div className="examples"><span>Try asking</span>{examples.map((example) => <button key={example} onClick={() => setQuery(`How have councils addressed ${example.toLowerCase()}?`)}>{example}</button>)}</div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      {!result && !loading && <section className="how-it-works"><div><span>01</span><h3>Ask in plain English</h3><p>Describe the service challenge, policy question or local concern.</p></div><div><span>02</span><h3>Trace every claim</h3><p>Review passages from original council papers, with source links intact.</p></div><div><span>03</span><h3>Shape the briefing</h3><p>Turn comparable approaches into an officer-ready starting point.</p></div></section>}

      {loading && !result && <section className="loading-state"><div className="radar"><SparkIcon /></div><div><span>Gemini agent working · {researchMode} mode</span><h2>{liveTrace.at(-1)?.label ?? "Selecting council research tools…"}</h2><p>{liveTrace.length ? `${liveTrace.length} MCP tool call${liveTrace.length === 1 ? "" : "s"} started` : "The agent is deciding which council evidence it needs."}</p></div></section>}

      {result && <section className="results">
        {loading && <div className="follow-up-progress" role="status"><div className="mini-radar"><SparkIcon /></div><div><span>{researchMode} research · {liveTrace.length} tool call{liveTrace.length === 1 ? "" : "s"}</span><strong>{liveTrace.at(-1)?.label ?? pendingQuestion}</strong><small>Your current brief will remain here while the agent works.</small></div><span className="progress-dots"><i /><i /><i /></span></div>}
        {turns.filter((turn) => turn.result !== result).length > 0 && <div className="thread-history"><div className="thread-title"><span>Research thread</span><small>{turns.length} completed questions</small></div>{turns.filter((turn) => turn.result !== result).map((turn, index) => <details key={`${turn.question}-${index}`}><summary><small>{index + 1}</small><span>{turn.question}</span><strong>Earlier brief</strong></summary><div><span>{turn.result.analysis.headline}</span><p>{turn.result.analysis.summary}</p><button type="button" onClick={() => setResult(turn.result)}>Open this brief</button></div></details>)}</div>}
        <div className="result-heading"><div><span className="kicker"><SparkIcon /> Research brief</span><h2>{result.analysis.headline}</h2><p>{result.analysis.summary}</p></div><aside><strong>{result.evidence.length}</strong><span>sources selected</span><small>{result.total.toLocaleString()} records matched</small></aside></div>

        <div className="result-grid">
          <article className="brief-card">
            <div className="card-header"><div><span className="section-number">01</span><h3>Approaches in practice</h3></div><span className="provider">{result.provider}{result.mode ? ` · ${result.mode}` : ""}</span></div>
            <div className="approaches">{result.analysis.approaches.map((approach, index) => <div className="approach" key={`${approach.title}-${index}`}><div className="approach-index">{String(index + 1).padStart(2, "0")}</div><div><h4>{approach.title}</h4><p>{approach.detail}</p><div className="citations">{approach.evidenceIds.map((id) => <a key={id} href={result.evidence[id - 1]?.url ?? "#sources"} target="_blank" rel="noreferrer"><FileIcon /> {sourceName(id)} <sup>{id}</sup></a>)}</div></div></div>)}</div>
          </article>

          <aside className="side-column">
            {result.trace && result.trace.length > 0 && <div className="trace-card"><div className="trace-heading"><SparkIcon /><div><small>Agent activity</small><h3>{result.trace.length} MCP tool call{result.trace.length === 1 ? "" : "s"}</h3></div></div><ol>{result.trace.map((step, index) => <li key={`${step.tool}-${index}`}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.tool}</small></div><CheckIcon /></li>)}</ol></div>}
            <div className="note-card"><span className="section-number">02</span><h3>Officer considerations</h3><ul>{result.analysis.considerations.map((item) => <li key={item}><span>!</span>{item}</li>)}</ul></div>
            <div className="next-card"><span className="section-number">03</span><h3>Suggested next steps</h3><ul>{result.analysis.nextSteps.map((item) => <li key={item}><CheckIcon />{item}</li>)}</ul><button onClick={() => window.print()}>Create briefing note <ArrowIcon /></button></div>
          </aside>
        </div>

        <div className="sources" id="sources"><div className="sources-title"><div><span className="section-number">04</span><h3>Evidence library</h3></div><p>Open the original record before using a finding.</p></div><div className="source-list">{result.evidence.map((item, index) => <a className="source-row" key={item.id} href={item.url ?? "#"} target="_blank" rel="noreferrer"><span className="source-id">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.councilName ?? "Council record"}</strong><span>{item.title}</span></div><time>{item.date ? new Date(item.date).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "Undated"}</time><ExternalIcon /></a>)}</div></div>

        <div className={`follow-up-card${loading ? " is-loading" : ""}`}><div><span className="kicker"><SparkIcon /> Continue this research</span><h3>{loading ? "Researching your follow-up…" : "Ask a follow-up question"}</h3><p>{loading ? "You can continue reading the current brief while the agent verifies its next answer." : "The agent will retain this thread and verify its next answer with MCP tools."}</p></div><form onSubmit={submitFollowUp}><textarea value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="For example: Which of these approaches has the strongest evidence?" rows={2} aria-label="Follow-up question" disabled={loading} /><button type="submit" disabled={loading || followUp.trim().length < 2}>{loading ? <span className="spinner" /> : <ArrowIcon />}</button></form><button className="new-thread" type="button" onClick={startNewThread} disabled={loading}>Start a new research thread</button></div>
      </section>}

      <footer><div><LayersIcon /><span>Civic Lens</span></div><p>Evidence to inform—not replace—professional judgement.</p><a href="https://councilgateway.poteris.co.uk/council-api/docs" target="_blank" rel="noreferrer">Powered by Poteris data <ExternalIcon /></a></footer>
    </main>
  );
}
