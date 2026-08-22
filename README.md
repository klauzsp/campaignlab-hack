# Civic Lens

An evidence-first research workspace for UK council officers. Civic Lens connects a Gemini research agent to the live [Poteris Council Gateway API](https://councilgateway.poteris.co.uk/council-api/docs) through MCP tools, keeps source links attached to every finding, and turns the evidence into a concise briefing.

## Quick start

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

Open `http://localhost:3000`. Next.js loads provider configuration from `apps/web/.env.local`. No AI key is required to search live council evidence. Add `AI_PROVIDER=gemini` and `GEMINI_API_KEY`, or `AI_PROVIDER=openai` and `OPENAI_API_KEY`, to enable generated analysis. Keep real API keys in `.env.local`; never put them in `.env.example`.

## MCP server

The stdio MCP server exposes `research_issue`, `search_council_records`, `get_document`, `list_councils`, `list_decisions`, `list_meetings`, `list_people`, and `list_committees`.

```bash
pnpm mcp
```

Example client configuration after `pnpm install`:

```json
{
  "mcpServers": {
    "civic-lens": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/council", "mcp"],
      "env": {
        "POTERIS_API_URL": "https://councilgateway.poteris.co.uk/council-api"
      }
    }
  }
}
```

## Architecture

- `packages/council-core`: typed Poteris client and evidence normalization
- `apps/mcp`: model-neutral MCP tools over that client
- `apps/web`: Next.js officer workspace, MCP client, and Gemini/OpenAI adapters

For Gemini, the Next.js backend starts an MCP client, gives Gemini the server's live tool schemas, executes Gemini's selected tools, and returns results for further tool-selection rounds. The UI shows the completed MCP call trace so an agent response is visibly distinct from evidence-only fallback output.

The local web agent uses MCP over stdio. For serverless deployment, host the MCP server with Streamable HTTP and point the web-side MCP client at that endpoint instead of spawning a local process.
