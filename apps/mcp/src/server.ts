import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PoterisClient, researchIssue } from "@civic-lens/core";
import { z } from "zod";

const client = new PoterisClient({
  baseUrl: process.env.POTERIS_API_URL,
  token: process.env.POTERIS_API_TOKEN,
});

const server = new McpServer({ name: "civic-lens", version: "0.1.0" });
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.tool(
  "search_council_records",
  "Full-text search across council meeting documents. Returns highlighted passages and original source URLs.",
  {
    query: z.string().min(2).describe("Plain-language issue or exact terms to search for"),
    councilId: z.number().int().positive().optional().describe("Restrict results to one council"),
    limit: z.number().int().min(1).max(25).default(10),
  },
  async ({ query, councilId, limit }) => json(await researchIssue(client, { query, councilId, limit })),
);

server.tool(
  "research_issue",
  "Gather a compact, citation-ready evidence pack about how UK councils have discussed an issue.",
  {
    issue: z.string().min(2),
    councilId: z.number().int().positive().optional(),
    limit: z.number().int().min(3).max(20).default(10),
  },
  async ({ issue, councilId, limit }) => json(await researchIssue(client, { query: issue, councilId, limit })),
);

server.tool(
  "get_document",
  "Retrieve one Poteris document, optionally including its extracted full text.",
  {
    documentId: z.number().int().positive(),
    includeText: z.boolean().default(true),
  },
  async ({ documentId, includeText }) => json(await client.getDocument(documentId, includeText)),
);

server.tool(
  "list_councils",
  "List councils available in Poteris. Use this to resolve a council name to its numeric ID.",
  {
    page: z.number().int().min(1).default(1),
    perPage: z.number().int().min(1).max(100).default(25),
  },
  async ({ page, perPage }) => json(await client.listCouncils({ page, perPage })),
);

server.tool(
  "list_decisions",
  "List formal council decisions with optional council and date filters.",
  {
    councilId: z.number().int().positive().optional(),
    dateFrom: z.string().optional().describe("ISO date, YYYY-MM-DD"),
    dateTo: z.string().optional().describe("ISO date, YYYY-MM-DD"),
    keyOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ councilId, dateFrom, dateTo, keyOnly, limit }) =>
    json(await client.listDecisions({ councilId, dateFrom, dateTo, isKey: keyOnly, perPage: limit })),
);

await server.connect(new StdioServerTransport());
