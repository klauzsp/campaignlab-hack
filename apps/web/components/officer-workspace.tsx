"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Council, Evidence } from "@civic-lens/core";
import type { AgentTrace, Analysis, ResearchMode } from "../lib/agent";
import {
  ArrowIcon,
  CheckIcon,
  ExternalIcon,
  FileIcon,
  SearchIcon,
  SparkIcon,
} from "./icons";
import { UkDiscoveryMap, type RegionalResearchRequest } from "./uk-discovery-map";

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

type Turn = { question: string; result: Result };
type BriefTab = "summary" | "sources";

const examples = [
  "Missed bin collections",
  "Adult social care recruitment",
  "High street vacancy rates",
];

function researchStatus(trace: AgentTrace[]) {
  const latest = trace.at(-1)?.tool ?? "";
  if (!latest) return "Planning your research";
  if (latest === "get_document") return "Reading source documents";
  if (latest === "compare_councils" || latest === "explore_region") return "Comparing council records";
  if (trace.length >= 4) return "Reviewing the evidence";
  return "Scanning council records";
}

function ResearchBrief({ result }: { result: Result }) {
  const [activeTab, setActiveTab] = useState<BriefTab>("summary");
  const sourceName = (id: number) =>
    result.evidence[id - 1]?.councilName ?? `Source ${id}`;

  return (
    <article className="agent-response">
      <div className="brief-header">
        <div>
          <h1>{result.analysis.headline}</h1>
          <p>{result.analysis.summary}</p>
          <div className="metadata">
            <span className="lozenge">{result.mode ?? "quick"}</span>
            <span>{result.evidence.length} sources</span>
            <span>{result.total.toLocaleString()} records matched</span>
          </div>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => window.print()}
        >
          Export brief
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Research brief sections">
        <button
          role="tab"
          aria-selected={activeTab === "summary"}
          className={activeTab === "summary" ? "active" : ""}
          onClick={() => setActiveTab("summary")}
        >
          Summary
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "sources"}
          className={activeTab === "sources" ? "active" : ""}
          onClick={() => setActiveTab("sources")}
        >
          Sources <span>{result.evidence.length}</span>
        </button>
      </div>
      {activeTab === "summary" && (
        <div className="summary-layout">
          <section className="content-panel">
            <div className="panel-heading">
              <h2>Approaches found</h2>
              <p>Patterns identified across the selected council evidence.</p>
            </div>
            <div className="approach-list">
              {result.analysis.approaches.map((approach, index) => (
                <section
                  className="approach-item"
                  key={`${approach.title}-${index}`}
                >
                  <span className="approach-number">{index + 1}</span>
                  <div>
                    <h3>{approach.title}</h3>
                    <p>{approach.detail}</p>
                    {approach.evidenceIds.length > 0 && (
                      <div className="citation-links">
                        {approach.evidenceIds.map((id) => (
                          <a
                            key={id}
                            href={result.evidence[id - 1]?.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileIcon /> {sourceName(id)} <sup>{id}</sup>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </section>
          <aside className="summary-sidebar">
            <section className="side-panel">
              <h2>Officer considerations</h2>
              <ul className="plain-list">
                {result.analysis.considerations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className="side-panel">
              <h2>Suggested next steps</h2>
              <ul className="check-list">
                {result.analysis.nextSteps.map((item) => (
                  <li key={item}>
                    <CheckIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
      {activeTab === "sources" && (
        <section className="content-panel tab-panel">
          <div className="panel-heading">
            <h2>Sources</h2>
            <p>
              Review the original record before using a finding in formal
              advice.
            </p>
          </div>
          <div className="source-list">
            {result.evidence.map((item, index) => (
              <a
                className="source-item"
                key={item.id}
                href={item.url ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                <span className="source-number">{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.councilName ?? "Council record"}
                    {item.date
                      ? ` · ${new Date(item.date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`
                      : ""}
                  </span>
                </div>
                <ExternalIcon />
              </a>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

export function OfficerWorkspace() {
  const [query, setQuery] = useState(
    "How have other councils reduced missed bin collections?",
  );
  const [councils, setCouncils] = useState<Council[]>([]);
  const [councilId, setCouncilId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [liveTrace, setLiveTrace] = useState<AgentTrace[]>([]);
  const [error, setError] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);
  const hasThread = turns.length > 0;

  useEffect(() => {
    fetch("/api/councils")
      .then((response) => response.json())
      .then((data: { councils?: Council[] }) =>
        setCouncils(data.councils ?? []),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (hasThread || loading)
      threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [hasThread, loading, turns.length, liveTrace.length]);

  async function runResearch(nextQuestion: string, regionalRequest?: RegionalResearchRequest) {
    const cleanedQuestion = nextQuestion.trim();
    if (cleanedQuestion.length < 2) return;
    setLoading(true);
    setPendingQuestion(cleanedQuestion);
    setLiveTrace([]);
    setError("");
    try {
      const history = turns.flatMap((turn) => [
        { role: "officer" as const, content: turn.question },
        {
          role: "assistant" as const,
          content: [
            turn.result.analysis.headline,
            turn.result.analysis.summary,
            "Approaches:",
            ...turn.result.analysis.approaches.map(
              (approach) => `- ${approach.title}: ${approach.detail}`,
            ),
            "Evidence used:",
            ...turn.result.evidence
              .slice(0, 12)
              .map(
                (source) =>
                  `- ${source.councilName ?? "Council"} (council ID ${source.councilId ?? "unknown"}, document ${source.documentId ?? "unknown"}): ${source.title}. ${source.excerpt.slice(0, 300)}`,
              ),
          ].join("\n"),
        },
      ]);
      const priorEvidence = turns.at(-1)?.result.evidence.slice(0, 20) ?? [];
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanedQuestion,
          councilId: councilId ? Number(councilId) : undefined,
          history,
          priorEvidence,
          mode: researchMode,
          stream: true,
          regionalRequest: regionalRequest
            ? { region: regionalRequest.region, councilNames: regionalRequest.councils }
            : undefined,
        }),
      });
      if (!response.ok) {
        const failure = (await response.json()) as { error?: string };
        throw new Error(failure.error ?? "Research failed.");
      }
      let data: (Result & { error?: string }) | null = null;
      if (
        response.headers
          .get("content-type")
          ?.includes("application/x-ndjson") &&
        response.body
      ) {
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
            const event = JSON.parse(line) as {
              type: string;
              trace?: AgentTrace;
              data?: Result;
              error?: string;
            };
            if (event.type === "activity" && event.trace)
              setLiveTrace((current) => [...current, event.trace!]);
            if (event.type === "complete" && event.data) data = event.data;
            if (event.type === "error")
              throw new Error(event.error ?? "Research failed.");
          }
          if (done) break;
        }
      } else data = (await response.json()) as Result & { error?: string };
      if (!data)
        throw new Error("The agent finished without returning a briefing.");
      setTurns((current) => [
        ...current,
        { question: cleanedQuestion, result: data! },
      ]);
      setFollowUp("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Research failed.");
    } finally {
      setLoading(false);
      setPendingQuestion("");
      setLiveTrace([]);
    }
  }

  function startNewThread() {
    setTurns([]);
    setFollowUp("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const options = (
    <div className="query-options">
      <label>
        <span>Council</span>
        <select
          value={councilId}
          onChange={(event) => setCouncilId(event.target.value)}
        >
          <option value="">All UK councils</option>
          {councils.map((council) => (
            <option value={council.id} key={council.id}>
              {council.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mode-switch" aria-label="Research depth">
        <span>Depth</span>
        <button
          type="button"
          className={researchMode === "quick" ? "active" : ""}
          onClick={() => setResearchMode("quick")}
        >
          Quick
        </button>
        <button
          type="button"
          className={researchMode === "deep" ? "active" : ""}
          onClick={() => setResearchMode("deep")}
        >
          Deep
        </button>
      </div>
    </div>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-identity">
          <span className="product-icon">
            <Image
              src="/atlaslogo.png"
              alt=""
              width={100}
              height={100}
              priority
            />
          </span>
          <strong>Atlas</strong>
        </div>
        <div className="header-actions">
          {hasThread && (
            <button
              type="button"
              className="header-button"
              onClick={startNewThread}
            >
              New research
            </button>
          )}
          <span className="avatar" aria-label="Samuel Parke">
            SP
          </span>
        </div>
      </header>
      <div className="page-container">
        {!hasThread && !loading && (
          <section className="research-intro" id="research">
            <div className="home-research-copy">
              <div className="intro-copy">
                <h1>What would you like to investigate?</h1>
                <p>
                  Ask about a service challenge, decision or policy. Atlas
                  searches council records and returns a sourced briefing.
                </p>
              </div>
              <form
                className="query-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runResearch(query);
                }}
              >
                <div className="query-input">
                  <SearchIcon />
                  <textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Research question"
                    rows={2}
                    placeholder="Ask a question about UK councils"
                  />
                  <button className="primary-button" type="submit">
                    Research <ArrowIcon />
                  </button>
                </div>
                {options}
              </form>
              <div className="suggestions">
                <span>Suggested</span>
                {examples.map((example) => (
                  <button
                    key={example}
                    onClick={() =>
                      setQuery(
                        `How have councils addressed ${example.toLowerCase()}?`,
                      )
                    }
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <UkDiscoveryMap
              onExplore={(regionalRequest) => {
                setQuery(regionalRequest.question);
                void runResearch(regionalRequest.question, regionalRequest);
              }}
              disabled={loading}
            />
          </section>
        )}
        {error && (
          <div className="error-message" role="alert">
            <strong>Research couldn’t be completed</strong>
            <span>{error}</span>
          </div>
        )}
        {loading && !hasThread && (
          <section className="chat-thread initial-pending">
            <div className="chat-question">
              <span className="avatar">SP</span>
              <p>{pendingQuestion}</p>
            </div>
            <div className="loading-panel">
              <span className="spinner dark" />
              <div>
                <span>Research in progress</span>
                <h2>{researchStatus(liveTrace)}</h2>
                <p>Checking reports, minutes and decisions</p>
              </div>
            </div>
          </section>
        )}
        {hasThread && (
          <section className="chat-thread" aria-label="Research conversation">
            {turns.map((turn, index) => (
              <div
                className="conversation-turn"
                key={`${turn.question}-${turn.result.generatedAt}-${index}`}
              >
                <div className="chat-question">
                  <span className="avatar">SP</span>
                  <p>{turn.question}</p>
                </div>
                <ResearchBrief result={turn.result} />
              </div>
            ))}
            {loading && (
              <div className="conversation-turn pending-turn">
                <div className="chat-question">
                  <span className="avatar">SP</span>
                  <p>{pendingQuestion}</p>
                </div>
                <div className="inline-progress" role="status">
                  <span className="spinner dark" />
                  <div>
                    <strong>{researchStatus(liveTrace)}</strong>
                    <span>Checking council evidence for your follow-up</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={threadEnd} />
            <section className={`follow-up${loading ? " loading" : ""}`}>
              <div>
                <h2>
                  {loading ? "Researching your follow-up…" : "Ask a follow-up"}
                </h2>
                <p>Wanna go deeper or ask something new?</p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runResearch(followUp);
                }}
              >
                <textarea
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  placeholder="Ask about the evidence, compare approaches, or narrow the scope…"
                  rows={2}
                  disabled={loading}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={loading || followUp.trim().length < 2}
                >
                  {loading ? <span className="spinner" /> : <ArrowIcon />}
                </button>
              </form>
              {options}
            </section>
          </section>
        )}
      </div>
      <footer className="app-footer">
        <span>Evidence to inform professional judgement</span>
        <a
          href="https://councilgateway.poteris.co.uk/council-api/docs"
          target="_blank"
          rel="noreferrer"
        >
          Poteris API <ExternalIcon />
        </a>
      </footer>
    </main>
  );
}
