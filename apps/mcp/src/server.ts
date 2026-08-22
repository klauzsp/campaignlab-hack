import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { compareCouncilEvidence, exploreCouncilRegion, findCouncils, investigateCouncilTopic, PoterisClient, researchIssue } from "@civic-lens/core";
import { z } from "zod";

const client = new PoterisClient({
  baseUrl: process.env.POTERIS_API_URL,
  token: process.env.POTERIS_API_TOKEN,
});

const server = new McpServer({ name: "atlas", version: "0.1.0" });
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
  "Retrieve one Poteris document and its extracted text. Use after search when the excerpt is insufficient.",
  {
    documentId: z.number().int().positive(),
    includeText: z.boolean().default(true),
    maxCharacters: z.number().int().min(1000).max(30000).default(12000),
  },
  async ({ documentId, includeText, maxCharacters }) => {
    const document = await client.getDocument(documentId, includeText);
    return json({ ...document, text: document.text?.slice(0, maxCharacters), text_truncated: Boolean(document.text && document.text.length > maxCharacters) });
  },
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
  "find_council",
  "Resolve a council name to its Poteris numeric ID. Searches the complete council directory, not just one page. Use whenever a question names a council and its ID is unknown.",
  {
    name: z.string().min(2).describe("Council name, which may be partial, such as Wandsworth or Birmingham"),
    limit: z.number().int().min(1).max(10).default(5),
  },
  async ({ name, limit }) => json(await findCouncils(client, name, limit)),
);

server.tool(
  "compare_councils",
  "Build a side-by-side evidence pack for two or more named councils. Resolves every council across the full directory and runs several council-specific searches. Use this for any comparison question instead of relying on one exact search.",
  {
    councilNames: z.array(z.string().min(2)).min(2).max(5),
    issue: z.string().min(2).describe("The policy or service issue being compared, excluding council names"),
    searchTerms: z.array(z.string().min(2)).min(1).max(5).optional().describe("Two to five concise variants, from exact to broad, such as 'missed bin collections' and 'missed collections'"),
    perCouncil: z.number().int().min(3).max(15).default(8),
  },
  async ({ councilNames, issue, searchTerms, perCouncil }) =>
    json(await compareCouncilEvidence(client, { councilNames, issue, searchTerms, perCouncil })),
);

server.tool(
  "investigate_council_topic",
  "Build a robust evidence pack about any topic, intervention, or claimed outcome at one named council. Resolves the council against the complete directory and searches several terminology variants. Use for single-council factual, evaluative, effectiveness, and follow-up questions.",
  {
    councilName: z.string().min(2),
    topic: z.string().min(2).describe("The intervention or issue to investigate, without the council name"),
    searchTerms: z.array(z.string().min(2)).min(1).max(6).optional().describe("Concise variants covering the intervention, service issue, and outcome measure"),
    limit: z.number().int().min(3).max(20).default(10),
  },
  async ({ councilName, topic, searchTerms, limit }) =>
    json(await investigateCouncilTopic(client, { councilName, topic, searchTerms, limit })),
);

server.tool(
  "explore_region",
  "Retrieve recent decisions and minuted meetings from representative councils in a UK region. Use for broad regional discovery questions about current priorities, pressures, activity, or policy discussions. Treat the result as a representative scan, not comprehensive regional coverage.",
  {
    region: z.string().min(2),
    councilNames: z.array(z.string().min(2)).min(2).max(6).describe("Representative councils explicitly named in the officer's regional discovery prompt"),
    perCouncil: z.number().int().min(2).max(10).default(5),
  },
  async ({ region, councilNames, perCouncil }) => json(await exploreCouncilRegion(client, { region, councilNames, perCouncil })),
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

server.tool(
  "list_meetings",
  "List council meetings. Use for questions about meeting dates, committees, agendas, or availability of minutes.",
  {
    councilId: z.number().int().positive().optional(),
    committeeId: z.number().int().positive().optional(),
    dateFrom: z.string().optional().describe("ISO date, YYYY-MM-DD"),
    dateTo: z.string().optional().describe("ISO date, YYYY-MM-DD"),
    hasMinutes: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ councilId, committeeId, dateFrom, dateTo, hasMinutes, limit }) =>
    json(await client.listMeetings({ councilId, committeeId, dateFrom, dateTo, hasMinutes, perPage: limit })),
);

server.tool(
  "list_people",
  "List people associated with councils. Use for questions about councillors, political parties, or council membership.",
  {
    councilId: z.number().int().positive().optional(),
    councillorsOnly: z.boolean().optional(),
    party: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ councilId, councillorsOnly, party, limit }) =>
    json(await client.listPeople({ councilId, isCouncillor: councillorsOnly, party, perPage: limit })),
);

server.tool(
  "list_committees",
  "List the committees belonging to a council. Resolve the council ID with find_council first.",
  {
    councilId: z.number().int().positive(),
    limit: z.number().int().min(1).max(100).default(50),
  },
  async ({ councilId, limit }) => json(await client.listCommittees(councilId, { perPage: limit })),
);

await server.connect(new StdioServerTransport());
