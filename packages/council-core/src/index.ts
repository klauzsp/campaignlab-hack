export type Page<T> = {
  items: T[];
  page: number;
  per_page: number;
  total: number;
};

export type Council = {
  id: number;
  name: string | null;
  external_id: string | null;
  majority_party: string | null;
  council_type: number | null;
  council_type_label: string | null;
  base_scrape_url: string | null;
};

export type DocumentDetail = {
  id: number;
  source_type: string;
  source_id: number;
  name: string | null;
  url: string | null;
  kind: string;
  extract_status: string;
  processing_status: string;
  contains_agenda: boolean;
  contains_attendees: boolean;
  contains_decisions: boolean;
  is_minutes: boolean;
  is_media: boolean;
  created_at: string;
  text?: string | null;
};

export type Decision = {
  id: number;
  council_id: number;
  url: string;
  decision_maker: string | null;
  outcome: string | null;
  is_key: boolean;
  is_callable_in: boolean;
  purpose: string | null;
  content: string | null;
  date: string | null;
  topline: string | null;
};

export type Meeting = {
  id: number;
  council_id: number;
  committee_id: number | null;
  name: string | null;
  url: string | null;
  date: string | null;
  topline: string | null;
};

export type Person = {
  id: number;
  council_id: number;
  name?: string | null;
  full_name?: string | null;
  party?: string | null;
  is_councillor?: boolean;
  [key: string]: unknown;
};

export type Committee = {
  id: number;
  council_id?: number;
  name?: string | null;
  [key: string]: unknown;
};

export type SearchHit = {
  id: string;
  score: number | null;
  source: Record<string, unknown>;
  highlight: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type SearchResults = {
  total: number;
  mode: string;
  hits: SearchHit[];
};

export type Evidence = {
  id: string;
  documentId: number | null;
  councilId: number | null;
  councilName: string | null;
  meetingName: string | null;
  title: string;
  excerpt: string;
  url: string | null;
  date: string | null;
  score: number | null;
};

export class PoterisError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PoterisError";
  }
}

const DEFAULT_BASE_URL = "https://councilgateway.poteris.co.uk/council-api";

export class PoterisClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(options: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.token = options.token;
  }

  private async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new PoterisError(`Poteris request failed (${response.status}): ${detail.slice(0, 240)}`, response.status);
    }
    return response.json() as Promise<T>;
  }

  listCouncils(input: { councilType?: string; page?: number; perPage?: number } = {}) {
    return this.get<Page<Council>>("/councils", {
      council_type: input.councilType,
      page: input.page ?? 1,
      per_page: input.perPage ?? 25,
    });
  }

  getCouncil(id: number) {
    return this.get<Council>(`/councils/${id}`);
  }

  search(input: { query: string; councilId?: number; mode?: "document" | "classification"; size?: number; offset?: number }) {
    return this.get<SearchResults>("/search", {
      q: input.query,
      council_id: input.councilId,
      mode: input.mode ?? "document",
      size: Math.min(input.size ?? 12, 100),
      offset: input.offset ?? 0,
    });
  }

  getDocument(id: number, includeText = true) {
    return this.get<DocumentDetail>(`/documents/${id}`, { include_text: includeText });
  }

  listMeetings(input: { councilId?: number; committeeId?: number; dateFrom?: string; dateTo?: string; hasMinutes?: boolean; page?: number; perPage?: number } = {}) {
    return this.get<Page<Meeting>>("/meetings", {
      council_id: input.councilId,
      committee_id: input.committeeId,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      has_minutes: input.hasMinutes,
      page: input.page ?? 1,
      per_page: input.perPage ?? 25,
    });
  }

  listPeople(input: { councilId?: number; isCouncillor?: boolean; party?: string; page?: number; perPage?: number } = {}) {
    return this.get<Page<Person>>("/people", {
      council_id: input.councilId,
      is_councillor: input.isCouncillor,
      party: input.party,
      page: input.page ?? 1,
      per_page: input.perPage ?? 25,
    });
  }

  listCommittees(councilId: number, input: { page?: number; perPage?: number } = {}) {
    return this.get<Page<Committee>>(`/councils/${councilId}/committees`, {
      page: input.page ?? 1,
      per_page: input.perPage ?? 25,
    });
  }

  listDecisions(input: { councilId?: number; dateFrom?: string; dateTo?: string; isKey?: boolean; page?: number; perPage?: number } = {}) {
    return this.get<Page<Decision>>("/decisions", {
      council_id: input.councilId,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      is_key: input.isKey,
      page: input.page ?? 1,
      per_page: input.perPage ?? 25,
    });
  }
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stripHighlightHtml(value: string): string {
  return value
    .replace(/<\/?strong>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_FILLER = new Set([
  "a", "about", "address", "addressed", "an", "and", "are", "can", "council", "councils", "dealt", "did", "do", "does",
  "for", "have", "has", "help", "how", "i", "in", "improve", "improved", "other", "please", "reduce", "reduced", "the", "their",
  "to", "use", "used", "what", "which", "with",
]);

export function toSearchPhrase(question: string): string {
  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !SEARCH_FILLER.has(word));
  return keywords.join(" ").trim() || question.trim();
}

export function toEvidence(hit: SearchHit, councilNames: Map<number, string> = new Map()): Evidence {
  const source = hit.source ?? {};
  const record = hit.record ?? {};
  const rawHighlights = hit.highlight?.text;
  const excerpt = Array.isArray(rawHighlights)
    ? rawHighlights.filter((item): item is string => typeof item === "string").map(stripHighlightHtml).join(" … ")
    : "Relevant council record returned by Poteris.";
  const organisationIds = Array.isArray(source.organisation_ids) ? source.organisation_ids : [];
  const councilId = numberValue(organisationIds[0]) ?? numberValue(record.council_id);
  const documentId = numberValue(record.id) ?? numberValue(source.id);
  const meetingName = textValue(source.meeting_name);

  return {
    id: hit.id,
    documentId,
    councilId,
    councilName: councilId ? councilNames.get(councilId) ?? null : null,
    meetingName,
    title: textValue(record.name) ?? meetingName ?? `Council document ${documentId ?? hit.id}`,
    excerpt,
    url: textValue(record.url),
    date: textValue(record.created_at),
    score: hit.score,
  };
}

export async function researchIssue(
  client: PoterisClient,
  input: { query: string; councilId?: number; limit?: number },
): Promise<{ query: string; total: number; evidence: Evidence[] }> {
  const limit = Math.min(input.limit ?? 10, 25);
  const searchPhrase = toSearchPhrase(input.query);
  const [results, firstCouncilPage] = await Promise.all([
    client.search({ query: searchPhrase, councilId: input.councilId, size: limit }),
    client.listCouncils({ perPage: 100 }),
  ]);
  const remainingPageCount = Math.ceil(firstCouncilPage.total / firstCouncilPage.per_page) - 1;
  const remainingPages = await Promise.all(
    Array.from({ length: remainingPageCount }, (_, index) => client.listCouncils({ page: index + 2, perPage: 100 })),
  );
  const councils = [firstCouncilPage, ...remainingPages].flatMap((page) => page.items);
  const councilNames = new Map(councils.map((council) => [council.id, council.name ?? `Council ${council.id}`]));
  return {
    query: input.query,
    total: results.total,
    evidence: results.hits.map((hit) => toEvidence(hit, councilNames)),
  };
}
