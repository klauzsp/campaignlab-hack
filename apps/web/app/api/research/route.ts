import { NextResponse } from "next/server";
import { PoterisClient, researchIssue } from "@civic-lens/core";
import { analyse, runGeminiMcpAgent, type ConversationMessage, type ResearchMode } from "../../../lib/agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; councilId?: unknown; history?: unknown; mode?: unknown; stream?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 500) {
      return NextResponse.json({ error: "Ask a question between 2 and 500 characters." }, { status: 400 });
    }
    const councilId = typeof body.councilId === "number" && body.councilId > 0 ? body.councilId : undefined;
    const mode: ResearchMode = body.mode === "deep" ? "deep" : "quick";
    const history: ConversationMessage[] = Array.isArray(body.history)
      ? body.history.slice(-8).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const candidate = item as { role?: unknown; content?: unknown };
          if ((candidate.role !== "officer" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
          return [{ role: candidate.role, content: candidate.content.slice(0, 6000) }];
        })
      : [];
    if (process.env.AI_PROVIDER?.toLowerCase() === "gemini") {
      if (body.stream === true) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            send({ type: "started", mode });
            void runGeminiMcpAgent(query, councilId, history, {
              mode,
              onTrace: (trace) => send({ type: "activity", trace }),
            }).then((result) => {
              send({ type: "complete", data: { query, ...result, generatedAt: new Date().toISOString() } });
              controller.close();
            }).catch((error) => {
              send({ type: "error", error: error instanceof Error ? error.message : "Research failed." });
              controller.close();
            });
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      }
      const result = await runGeminiMcpAgent(query, councilId, history, { mode });
      return NextResponse.json({ query, ...result, generatedAt: new Date().toISOString() });
    }
    const client = new PoterisClient({ baseUrl: process.env.POTERIS_API_URL, token: process.env.POTERIS_API_TOKEN });
    const research = await researchIssue(client, { query, councilId, limit: 10 });
    const result = await analyse(query, research.evidence);
    return NextResponse.json({ ...research, ...result, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
