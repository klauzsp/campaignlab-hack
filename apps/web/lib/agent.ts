import type { Evidence } from "@civic-lens/core";

export type Analysis = {
  headline: string;
  summary: string;
  approaches: Array<{ title: string; detail: string; evidenceIds: number[] }>;
  considerations: string[];
  nextSteps: string[];
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
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned) as Analysis;
  if (!parsed.headline || !parsed.summary || !Array.isArray(parsed.approaches)) {
    throw new Error("The model returned an unexpected response shape.");
  }
  return parsed;
}

async function withGemini(prompt: string): Promise<Analysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
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
