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

const globalMcp = globalThis as typeof globalThis & { civicLensMcp?: Promise<McpConnection> };

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
  const client = new Client({ name: "civic-lens-web-agent", version: "0.1.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  return { client, tools: listed.tools as McpTool[] };
}

async function getMcpConnection() {
  globalMcp.civicLensMcp ??= createMcpConnection().catch((error) => {
    globalMcp.civicLensMcp = undefined;
    throw error;
  });
  return globalMcp.civicLensMcp;
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

export async function runGeminiMcpAgent(
  question: string,
  councilId?: number,
  history: ConversationMessage[] = [],
  options: { mode?: ResearchMode; onTrace?: (trace: AgentTrace) => void } = {},
): Promise<AgentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured for the web app.");
  const mode = options.mode ?? "quick";
  const maxRounds = mode === "quick" ? 3 : 5;
  const maxToolCalls = mode === "quick" ? 6 : 14;
  const { client: mcp, tools: mcpTools } = await getMcpConnection();
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
      if (Array.isArray(data.evidence)) {
        return { ...data, evidence: data.evidence.map((item) => ({ ...(item as object), citationIndex: registerEvidence(item as Record<string, unknown>) })) };
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

    const conversationContext = history.length
      ? `\n\nEarlier conversation for resolving references such as “those” or “the second option”:\n${history.slice(-8).map((message) => `${message.role === "officer" ? "Officer" : "Civic Lens"}: ${message.content.slice(0, 1800)}`).join("\n")}`
      : "";
    const contents: GeminiContent[] = [{
      role: "user",
      parts: [{ text: `Research the officer's latest question and answer it using council evidence: ${question}${councilId ? `\nThe officer selected council ID ${councilId}.` : ""}${conversationContext}` }],
    }];

    const callGemini = async (forceTool: boolean, disableTools = false) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `You are Civic Lens, a careful UK local-government research agent. Use the supplied MCP tools to retrieve facts; never answer a factual council question from memory. Choose tools based on intent. For cross-council issues, start with research_issue and refine only when results are weak. Distinguish proposals from adopted decisions and do not claim an approach worked unless evidence says so. Every factual approach must cite citationIndex values returned by tools. You are in ${mode.toUpperCase()} mode: ${mode === "quick" ? "prioritise a useful answer within three research rounds, make no more than two parallel calls at once, and open full documents only when excerpts cannot answer the question" : "research thoroughly and open strong source documents where useful"}. ${outputShape}` }] },
          contents,
          ...(disableTools ? {} : {
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
      } else if (name.startsWith("list_")) {
        args.limit = Math.min(typeof args.limit === "number" ? args.limit : 15, 15);
      } else if (name === "get_document") {
        args.maxCharacters = Math.min(typeof args.maxCharacters === "number" ? args.maxCharacters : 6000, 6000);
      }
      return args;
    };

    for (let round = 1; round <= maxRounds; round += 1) {
      const response = await callGemini(round === 1);
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
        if (result.isError) throw new Error(`MCP tool ${call.name} failed: ${textFromMcpResult(result)}`);
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
