import { NextResponse } from "next/server";
import { PoterisClient, researchIssue } from "@civic-lens/core";
import { analyse, runGeminiMcpAgent } from "../../../lib/agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; councilId?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 500) {
      return NextResponse.json({ error: "Ask a question between 2 and 500 characters." }, { status: 400 });
    }
    const councilId = typeof body.councilId === "number" && body.councilId > 0 ? body.councilId : undefined;
    if (process.env.AI_PROVIDER?.toLowerCase() === "gemini") {
      const result = await runGeminiMcpAgent(query, councilId);
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
