# Civic Lens

An evidence-first research workspace for UK council officers. Civic Lens searches the live [Poteris Council Gateway API](https://councilgateway.poteris.co.uk/council-api/docs), keeps source links attached to every finding, and can ask Gemini or OpenAI to turn the evidence into a concise briefing.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. No AI key is required to search live council evidence. Add `AI_PROVIDER=gemini` and `GEMINI_API_KEY`, or `AI_PROVIDER=openai` and `OPENAI_API_KEY`, to enable generated analysis. Keep real API keys in `.env.local`; never put them in `.env.example`.

## MCP server

The stdio MCP server exposes `search_council_records`, `get_document`, `list_councils`, `list_decisions`, and `research_issue`.

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
- `apps/web`: Next.js officer workspace and Gemini/OpenAI adapters

The model never invents sources: search happens first, then only normalized evidence is passed to the selected provider. The UI clearly labels evidence-only fallback output.
