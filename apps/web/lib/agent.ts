import "server-only";

import type { Evidence } from "@civic-lens/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

export type Analysis = {
  headline: string;
  summary: string;
  approaches: Array<{ title: string; detail: string; evidenceIds: number[] }>;
  considerations: string[];
  nextSteps: string[];
};

export type AgentTrace = {
  tool: string;
  label: string;
  round: number;
};

export type ResearchMode = "quick" | "deep";

export type RegionalResearchRequest = {
  region: string;
  councilNames: string[];
};

export type AgentResult = {
  analysis: Analysis;
  evidence: Evidence[];
  total: number;
  provider: "Gemini agent";
  trace: AgentTrace[];
  mode: ResearchMode;
};

export type ConversationMessage = {
  role: "officer" | "assistant";
  content: string;
};

const outputShape = `Return JSON only with this exact shape:
{"headline":"...","summary":"...","approaches":[{"title":"...","detail":"...","evidenceIds":[1]}],"considerations":["..."],"nextSteps":["..."]}`;

const regionalGuidance = "If this is a broad regional discovery question about current priorities, pressures, decisions, or activity, call explore_region with the representative councils named in the question. Describe its findings as a representative evidence scan, not complete regional coverage.";

function buildPrompt(query: string, evidence: Evidence[]) {
  const sources = evidence.map((item, index) => ({
    id: index + 1,
    council: item.councilName,
    title: item.title,
    date: item.date,
    excerpt: item.excerpt,
    url: item.url,
  }));
  return `You are supporting a UK local-government officer. Analyse only the supplied evidence. Do not imply causation, success, or policy outcomes that the excerpts do not establish. Make uncertainty explicit. Use evidenceIds to cite claims. The officer asked: ${query}\n\nEvidence:\n${JSON.stringify(sources)}\n\n${outputShape}`;
}

function parseJson(text: string): Analysis {
  let cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  }
  const parsed = JSON.parse(cleaned) as Analysis;
  if (!parsed.headline || !parsed.summary || !Array.isArray(parsed.approaches)) {
    throw new Error("The model returned an unexpected response shape.");
  }
  return parsed;
}

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [key: string]: unknown;
};

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type McpConnection = { client: Client; tools: McpTool[] };

const globalMcp = globalThis as typeof globalThis & { atlasMcp?: Promise<McpConnection> };

async function createMcpConnection(): Promise<McpConnection> {
  const workspaceRoot = process.env.CIVIC_LENS_ROOT ?? path.resolve(process.cwd(), "../..");
  const childEnv = getDefaultEnvironment();
  if (process.env.POTERIS_API_URL) childEnv.POTERIS_API_URL = process.env.POTERIS_API_URL;
  if (process.env.POTERIS_API_TOKEN) childEnv.POTERIS_API_TOKEN = process.env.POTERIS_API_TOKEN;
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["--dir", workspaceRoot, "mcp"],
    cwd: workspaceRoot,
    env: childEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "atlas-web-agent", version: "0.1.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  return { client, tools: listed.tools as McpTool[] };
}

async function getMcpConnection(requiredTool?: string) {
  globalMcp.atlasMcp ??= createMcpConnection().catch((error) => {
    globalMcp.atlasMcp = undefined;
    throw error;
  });
  let connection = await globalMcp.atlasMcp;
  if (requiredTool && !connection.tools.some((tool) => tool.name === requiredTool)) {
    globalMcp.atlasMcp = undefined;
    await connection.client.close().catch(() => undefined);
    globalMcp.atlasMcp = createMcpConnection().catch((error) => {
      globalMcp.atlasMcp = undefined;
      throw error;
    });
    connection = await globalMcp.atlasMcp;
    if (!connection.tools.some((tool) => tool.name === requiredTool)) {
      throw new Error(`The Atlas MCP server does not expose the required ${requiredTool} tool.`);
    }
  }
  return connection;
}

function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["$schema", "additionalProperties", "exclusiveMinimum", "exclusiveMaximum", "default"].includes(key))
      .map(([key, item]) => [key, cleanSchema(item)]),
  );
}

function toolLabel(name: string, args: Record<string, unknown>) {
  const detail = args.query ?? args.issue ?? args.documentId ?? args.councilId;
  const labels: Record<string, string> = {
    research_issue: "Searched council evidence",
    search_council_records: "Searched council records",
    get_document: "Opened a source document",
    list_councils: "Resolved council information",
    find_council: "Resolved a council name",
    compare_councils: "Compared council evidence",
    investigate_council_topic: "Investigated a council approach",
    explore_region: "Scanned recent regional activity",
    list_decisions: "Reviewed formal decisions",
    list_meetings: "Reviewed council meetings",
    list_people: "Reviewed council members",
    list_committees: "Reviewed council committees",
  };
  return `${labels[name] ?? name}${detail ? ` · ${String(detail).slice(0, 70)}` : ""}`;
}

function textFromMcpResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: string }> : [];
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n");
}

function focusedFollowUpDocument(question: string, priorEvidence: Evidence[]) {
  if (!/\b(effect(?:ive|iveness)?|worked|working|successful|success|impact|result|sensible|smart|worth)\b/i.test(question)) return undefined;
  const questionText = question.toLowerCase();
  const councilMatches = priorEvidence.filter((item) => {
    if (!item.documentId || !item.councilName) return false;
    const identifyingWords = item.councilName.toLowerCase().split(/[^a-z0-9]+/).filter((word) =>
      word.length > 3 && !["borough", "council", "county", "district", "metropolitan", "city"].includes(word),
    );
    return identifyingWords.some((word) => questionText.includes(word));
  });
  const namedCouncils = new Set(councilMatches.map((item) => item.councilName));
  if (namedCouncils.size !== 1) return undefined;
  const queryWords = new Set(questionText.split(/[^a-z0-9]+/).filter((word) =>
    word.length > 4 && !["about", "council", "effective", "effectiveness", "their", "through", "which", "would"].includes(word),
  ));
  return councilMatches
    .map((item) => ({
      item,
      score: [...queryWords].filter((word) => `${item.title} ${item.excerpt}`.toLowerCase().includes(word)).length,
    }))
    .sort((a, b) => b.score - a.score)[0]?.item;
}

export async function runGeminiMcpAgent(
  question: string,
  councilId?: number,
  history: ConversationMessage[] = [],
  priorEvidence: Evidence[] = [],
  options: { mode?: ResearchMode; regionalRequest?: RegionalResearchRequest; onTrace?: (trace: AgentTrace) => void } = {},
): Promise<AgentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured for the web app.");
  const mode = options.mode ?? "quick";
  const maxRounds = mode === "quick" ? 3 : 5;
  const maxToolCalls = mode === "quick" ? 6 : 14;
  const { client: mcp, tools: mcpTools } = await getMcpConnection(options.regionalRequest ? "explore_region" : undefined);
    const functionDeclarations = mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: cleanSchema(tool.inputSchema),
    }));
    const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const evidence: Evidence[] = [];
    const evidenceKeys = new Map<string, number>();
    const trace: AgentTrace[] = [];
    let toolCallCount = 0;
    let total = 0;

    const registerEvidence = (item: Partial<Evidence> & Record<string, unknown>) => {
      const documentId = typeof item.documentId === "number" ? item.documentId : typeof item.id === "number" ? item.id : null;
      const url = typeof item.url === "string" ? item.url : null;
      const key = String(documentId ?? url ?? item.id ?? `source-${evidence.length + 1}`);
      const existing = evidenceKeys.get(key);
      if (existing) return existing;
      const entry: Evidence = {
        id: typeof item.id === "string" ? item.id : `Document-${documentId ?? evidence.length + 1}`,
        documentId,
        councilId: typeof item.councilId === "number" ? item.councilId : typeof item.council_id === "number" ? item.council_id : null,
        councilName: typeof item.councilName === "string" ? item.councilName : null,
        meetingName: typeof item.meetingName === "string" ? item.meetingName : null,
        title: typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : typeof item.purpose === "string" ? item.purpose : `Council record ${documentId ?? evidence.length + 1}`,
        excerpt: typeof item.excerpt === "string" ? item.excerpt : typeof item.topline === "string" ? item.topline : typeof item.content === "string" ? item.content.slice(0, 900) : typeof item.text === "string" ? item.text.slice(0, 900) : "Council record returned by Poteris.",
        url,
        date: typeof item.date === "string" ? item.date : typeof item.created_at === "string" ? item.created_at : null,
        score: typeof item.score === "number" ? item.score : null,
      };
      evidence.push(entry);
      const index = evidence.length;
      evidenceKeys.set(key, index);
      return index;
    };

    const prepareResult = (value: unknown): unknown => {
      if (!value || typeof value !== "object") return value;
      const data = value as Record<string, unknown>;
      if (typeof data.total === "number") total = Math.max(total, data.total);
      if (typeof data.totalMatches === "number") total = Math.max(total, data.totalMatches);
      if (Array.isArray(data.evidence)) {
        total = Math.max(total, data.evidence.length);
        return { ...data, evidence: data.evidence.map((item) => ({ ...(item as object), citationIndex: registerEvidence(item as Record<string, unknown>) })) };
      }
      if (Array.isArray(data.councils)) {
        return {
          ...data,
          councils: data.councils.map((item) => {
            const council = item as Record<string, unknown>;
            if (typeof council.totalMatches === "number") total = Math.max(total, council.totalMatches);
            return {
              ...council,
              evidence: Array.isArray(council.evidence)
                ? council.evidence.map((source) => ({ ...(source as object), citationIndex: registerEvidence(source as Record<string, unknown>) }))
                : [],
            };
          }),
        };
      }
      if (Array.isArray(data.items) && data.items.length) {
        const recordType = data.items[0] as Record<string, unknown>;
        if ("url" in recordType && ("topline" in recordType || "purpose" in recordType)) {
          return { ...data, items: data.items.map((item) => ({ ...(item as object), citationIndex: registerEvidence(item as Record<string, unknown>) })) };
        }
      }
      if ("url" in data && ("text" in data || "purpose" in data)) {
        return { ...data, citationIndex: registerEvidence(data) };
      }
      return data;
    };

    let regionalEvidenceContext = "";
    if (options.regionalRequest) {
      const step = { tool: "explore_region", label: "Scanned recent regional activity", round: 1 };
      trace.push(step);
      options.onTrace?.(step);
      toolCallCount += 1;
      const result = await mcp.callTool({
        name: "explore_region",
        arguments: {
          region: options.regionalRequest.region,
          councilNames: options.regionalRequest.councilNames,
          perCouncil: mode === "quick" ? 4 : 6,
        },
      });
      if (result.isError) throw new Error(`MCP tool explore_region failed: ${textFromMcpResult(result)}`);
      const raw = textFromMcpResult(result);
      let parsed: unknown = raw;
      try { parsed = JSON.parse(raw); } catch { /* Preserve non-JSON tool output. */ }
      const prepared = prepareResult(parsed);
      regionalEvidenceContext = `\n\nA regional MCP scan has already been completed for this map request. Analyse this verified result and cite its citationIndex values. Do not replace it with a generic full-text search:\n${JSON.stringify(prepared)}`;
    }

    const priorEvidenceEntries = priorEvidence.slice(0, 20).map((item) => ({
      item,
      citationIndex: registerEvidence(item as Evidence & Record<string, unknown>),
    }));
    const priorEvidenceContext = priorEvidenceEntries.length
      ? `\n\nPreviously verified sources from the immediately preceding answer remain available and may be cited in this answer:\n${priorEvidenceEntries.map(({ item, citationIndex }) => `[${citationIndex}] ${item.councilName ?? "Council"} — ${item.title}: ${item.excerpt}`).join("\n")}`
      : "";
    total = Math.max(total, evidence.length);

    let focusedDocumentContext = "";
    const focusedSource = focusedFollowUpDocument(question, priorEvidence);
    if (focusedSource?.documentId) {
      const step = { tool: "get_document", label: "Opened a relevant source document", round: 1 };
      trace.push(step);
      options.onTrace?.(step);
      toolCallCount += 1;
      try {
        const result = await mcp.callTool({
          name: "get_document",
          arguments: {
            documentId: focusedSource.documentId,
            includeText: true,
            maxCharacters: mode === "quick" ? 4500 : 8000,
          },
        });
        if (!result.isError) {
          const raw = textFromMcpResult(result);
          let parsed: unknown = raw;
          try { parsed = JSON.parse(raw); } catch { /* Preserve non-JSON tool output. */ }
          const prepared = prepareResult(parsed);
          focusedDocumentContext = `\n\nTo accelerate this named-council follow-up, the most relevant previously cited document has already been opened. If it is sufficient, answer now without making a redundant tool call. Cite only citationIndex values supplied here or in the previous evidence:\n${JSON.stringify(prepared)}`;
        }
      } catch { /* Fall back to the normal agent research loop. */ }
    }

    const conversationContext = history.length
      ? `\n\nEarlier conversation for resolving references such as “those” or “the second option”:\n${history.slice(-8).map((message) => `${message.role === "officer" ? "Officer" : "Atlas"}: ${message.content.slice(0, 6000)}`).join("\n")}`
      : "";
    const contents: GeminiContent[] = [{
      role: "user",
      parts: [{ text: `Research the officer's latest question and answer it using council evidence: ${question}\n${regionalGuidance}${councilId ? `\nThe officer selected council ID ${councilId}.` : ""}${regionalEvidenceContext}${priorEvidenceContext}${focusedDocumentContext}${conversationContext}` }],
    }];

    if (focusedDocumentContext) {
      const analysis = await withGemini(`You are Atlas, a careful UK local-government research agent. Answer the officer's evaluative follow-up using only the verified evidence below. Give a direct but qualified judgement. Separate documented implementation, documented outcomes, and professional inference. Do not claim the approach was effective unless the evidence reports an appropriate outcome. Cite the supplied source numbers in evidenceIds.\n\nOfficer's question: ${question}${priorEvidenceContext}${focusedDocumentContext}\n\n${outputShape}`);
      return { analysis, evidence, total, provider: "Gemini agent", trace, mode };
    }

    const callGemini = async (forceTool: boolean, disableTools = false) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `You are Atlas, a careful UK local-government research agent. Use the supplied MCP tools and previously verified sources to retrieve facts; never answer a factual council question from memory. Choose tools based on intent. For cross-council issues, start with research_issue and refine only when results are weak. When two or more councils are named for comparison, use compare_councils with multiple concise search-term variants. For any question about one named council—especially whether an approach is sensible, effective, successful, or worth adopting—use investigate_council_topic with variants covering the intervention, the service problem, and measurable outcomes. Reuse and cite relevant previously verified sources; do not discard them merely because a fresh exact search is weak. Never infer that evidence is absent from one exact search: resolve the named council, try exact, broader, and outcome-oriented terms, then open the strongest document when effectiveness is at issue. After resolving a named council, scope any additional search_council_records call to that councilId unless the officer explicitly asks for wider comparators. An evaluative answer must give a direct, qualified judgement and separate (1) documented implementation, (2) documented outcomes, and (3) professional inference about likely benefits, risks, costs, and transferability. Use words such as “proven”, “caused”, “highly effective”, or “cost-saving” only when the evidence contains an appropriate causal evaluation or quantified financial result; otherwise say “the council reports”, “is associated with”, “appears promising”, or “likely”. Never invent implementation details, costs, savings, system integrations, or risks as documented facts; label general operational reasoning as professional inference. A lack of causal proof limits confidence but does not prevent a reasoned assessment. A comparison answer must identify similarities, differences, evidence strength, and limitations; uneven evidence should produce a qualified comparison rather than a blanket no-evidence response. Distinguish proposals from adopted decisions and do not claim an approach worked unless evidence says so. Every factual approach must cite citationIndex values returned by tools. You are in ${mode.toUpperCase()} mode: ${mode === "quick" ? "prioritise a useful answer within three research rounds, make no more than two parallel calls at once, and open full documents when assessing effectiveness" : "research thoroughly and open strong source documents where useful"}. ${outputShape}` }] },
          contents,
          ...(disableTools ? { generationConfig: { responseMimeType: "application/json" } } : {
            tools: [{ functionDeclarations }],
            toolConfig: { functionCallingConfig: { mode: forceTool ? "ANY" : "AUTO" } },
          }),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Gemini agent returned ${response.status}: ${detail.slice(0, 300)}`);
      }
      return response.json() as Promise<{ candidates?: Array<{ content?: GeminiContent }> }>;
    };

    const constrainArguments = (name: string, input: Record<string, unknown>) => {
      if (mode === "deep") return input;
      const args = { ...input };
      if (["research_issue", "search_council_records"].includes(name)) {
        args.limit = Math.min(typeof args.limit === "number" ? args.limit : 8, 8);
      } else if (name === "compare_councils") {
        args.perCouncil = Math.min(typeof args.perCouncil === "number" ? args.perCouncil : 8, 8);
      } else if (name === "investigate_council_topic") {
        args.limit = Math.min(typeof args.limit === "number" ? args.limit : 10, 10);
      } else if (name === "explore_region") {
        args.perCouncil = Math.min(typeof args.perCouncil === "number" ? args.perCouncil : 4, 4);
      } else if (name.startsWith("list_")) {
        args.limit = Math.min(typeof args.limit === "number" ? args.limit : 15, 15);
      } else if (name === "get_document") {
        args.maxCharacters = Math.min(typeof args.maxCharacters === "number" ? args.maxCharacters : 6000, 6000);
      }
      return args;
    };

    for (let round = 1; round <= maxRounds; round += 1) {
      const response = await callGemini(round === 1 && !options.regionalRequest);
      const modelContent = response.candidates?.[0]?.content;
      if (!modelContent?.parts?.length) throw new Error("Gemini agent returned no response.");
      contents.push(modelContent);
      const calls = modelContent.parts.flatMap((part) => part.functionCall ? [part.functionCall] : []);

      if (!calls.length) {
        const answer = modelContent.parts.map((part) => part.text ?? "").join("");
        return { analysis: parseJson(answer), evidence, total, provider: "Gemini agent", trace, mode };
      }

      const plannedCalls = calls.map((call) => ({ ...call, args: constrainArguments(call.name, call.args ?? {}) }));
      for (const call of plannedCalls) {
        const step = { tool: call.name, label: toolLabel(call.name, call.args), round };
        trace.push(step);
        options.onTrace?.(step);
      }
      toolCallCount += plannedCalls.length;
      const executed = await Promise.all(plannedCalls.map(async (call) => ({
        call,
        result: await mcp.callTool({ name: call.name, arguments: call.args }),
      })));

      const responseParts: GeminiPart[] = [];
      for (const { call, result } of executed) {
        if (result.isError) {
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: {
                error: textFromMcpResult(result),
                instruction: "This retrieval failed upstream. Try one alternative tool call or a shorter, broader query. Do not claim that no council evidence exists from this failure alone.",
              },
            },
          });
          continue;
        }
        const raw = textFromMcpResult(result);
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* Preserve non-JSON tool output. */ }
        const prepared = prepareResult(parsed);
        responseParts.push({ functionResponse: { name: call.name, response: { result: prepared } } });
      }
      contents.push({ role: "user", parts: responseParts });
      if (toolCallCount >= maxToolCalls) break;
    }

    contents.push({ role: "user", parts: [{ text: `Stop researching and provide the final JSON now. Use only citationIndex values present in the tool results. ${outputShape}` }] });
    const finalResponse = await callGemini(false, true);
    const answer = finalResponse.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return { analysis: parseJson(answer), evidence, total, provider: "Gemini agent", trace, mode };
}

async function withGemini(prompt: string): Promise<Analysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}.`);
  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text.");
  return parseJson(text);
}

async function withOpenAI(prompt: string): Promise<Analysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5-mini", input: prompt }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
  const data = (await response.json()) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const text = data.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no text.");
  return parseJson(text);
}

function evidenceOnly(query: string, evidence: Evidence[]): Analysis {
  const grouped = new Map<string, Evidence[]>();
  evidence.forEach((item) => {
    const key = item.councilName ?? "Council source";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  return {
    headline: `Evidence scan: ${query.replace(/[?.!]$/, "")}`,
    summary: `Poteris returned relevant material from ${grouped.size} council source${grouped.size === 1 ? "" : "s"}. This is an evidence scan, not AI-generated analysis; review the linked documents before drawing conclusions.`,
    approaches: [...grouped.entries()].slice(0, 4).map(([council, items]) => ({
      title: council,
      detail: items[0]?.excerpt ?? "Relevant council material was found.",
      evidenceIds: items.map((item) => evidence.indexOf(item) + 1),
    })),
    considerations: [
      "Search excerpts can omit important context from the full report.",
      "Similar wording does not establish that an intervention was effective.",
      "Check dates, service model and local demographics before comparison.",
    ],
    nextSteps: ["Open the strongest source documents", "Validate comparable performance measures", "Draft an options appraisal with named owners"],
  };
}

export async function analyse(query: string, evidence: Evidence[]) {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (provider === "gemini") return { analysis: await withGemini(buildPrompt(query, evidence)), provider: "Gemini" };
  if (provider === "openai") return { analysis: await withOpenAI(buildPrompt(query, evidence)), provider: "OpenAI" };
  return { analysis: evidenceOnly(query, evidence), provider: "Evidence only" };
}
