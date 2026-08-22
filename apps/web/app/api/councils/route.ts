import { NextResponse } from "next/server";
import { PoterisClient } from "@civic-lens/core";

export async function GET() {
  try {
    const client = new PoterisClient({ baseUrl: process.env.POTERIS_API_URL, token: process.env.POTERIS_API_TOKEN });
    const first = await client.listCouncils({ perPage: 100 });
    const pages = Math.min(Math.ceil(first.total / 100), 4);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => client.listCouncils({ page: index + 2, perPage: 100 })));
    const councils = [first, ...rest].flatMap((page) => page.items).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return NextResponse.json({ councils });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load councils." }, { status: 502 });
  }
}
