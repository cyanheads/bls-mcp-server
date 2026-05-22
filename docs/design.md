# bls-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `bls_search_series` | Searches BLS series catalog by natural language query, survey, geographic area, or subject keywords to resolve cryptic SeriesIDs. Returns matching series with decoded components (survey, area, item, seasonal flag) and plain-language names. Use this before `bls_get_series` when you have a concept but not a SeriesID. | `query` (natural language or keyword), `survey` (enum: CPS, CES, CPI, PPI, JOLTS, LAUS, OEWS, ECEC, …), `area` (state name / MSA / FIPS), `seasonal_adjustment` (bool), `limit` | `readOnlyHint: true`, `openWorldHint: true` |
| `bls_get_series` | Fetches time-series data for 1–50 BLS series by SeriesID, with optional year range and BLS-computed period-over-period calculations. Returns observations with metadata (series name, unit, seasonality). Use when you already have SeriesIDs; use `bls_search_series` first if you don't. Calculations are a boolean flag (all or none); not all surveys support them — check `bls_list_surveys` if unsure. | `series_ids` (array, 1–50), `start_year` (int), `end_year` (int), `calculations` (bool) | `readOnlyHint: true`, `openWorldHint: true` |
| `bls_get_latest` | Returns the single most recent observation for one or more BLS series. For "what is X right now" questions — use when you need the current value, not history. Internally issues one GET request per series (no batch-latest endpoint exists in the BLS API); prefer `bls_get_series` with a 1-year window when fetching latest values for many series. | `series_ids` (array, 1–10 recommended; up to 50) | `readOnlyHint: true`, `openWorldHint: true`, `idempotentHint: true` |
| `bls_list_surveys` | Lists BLS survey programs with their codes, descriptions, and geographic/subject coverage. Use to discover which survey covers a topic before calling `bls_search_series`. | `category` (enum: prices, employment, wages, productivity, injuries, time_use — optional filter) | `readOnlyHint: true`, `openWorldHint: false`, `idempotentHint: true` |

### Resources

None — all data is dynamic (time series by definition). Tool surface is self-sufficient.

### Prompts

None. Read-only research server; no recurring interaction patterns warrant a structured prompt template.

---

## Overview

`bls-mcp-server` wraps the Bureau of Labor Statistics public API (v2), exposing US labor, price, productivity, and employment data. The BLS is the primary source for CPI, unemployment, wages, JOLTS, PPI, occupational employment, and related statistics — predating and often more current than republished FRED series.

The core UX problem is SeriesID resolution: BLS identifiers (`LNS14000000`, `CES0000000001`) encode survey + area + item + seasonal flag in opaque positional codes. `bls_search_series` is the anchor tool — it translates human concepts into SeriesIDs so the other tools can operate.

---

## Requirements

- BLS API v2 endpoint (`https://api.bls.gov/publicAPI/v2/`); `BLS_API_KEY` env var required for v2 access
- 500 queries/day per API key; 50 series per request; up to 20 years history per request
- Read-only access — BLS API has no write endpoints
- SeriesID catalog sourced from LABSTAT flat files at `download.bls.gov/pub/time.series/{survey}/` — one `{survey}.series` file + code-mapping files per survey (e.g., `cu.series` = 1.3MB, `ce.series` = 3.9MB, `ln.series` = 15MB). Only the `{survey}.series` and `{survey}.map` files are needed, not the `{survey}.data.*` observation files (those are hundreds of MB). Download and bundle at build time; total series-index footprint is estimated 50–100MB across all ~60 surveys; `bls_search_series` operates entirely offline against this index
- Period-over-period calculations via BLS v2 `calculations: true` boolean; the flag enables net change and percent change together (cannot request one independently). Not supported by all surveys — each survey's `allowsNetChange` / `allowsPercentChange` fields (from `GET /surveys/{abbr}`) indicate availability
- `api-canvas` / DataCanvas available for tabular spillover when series count × observation count exceeds context budget

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `BlsApiService` | BLS API v2 (`POST /timeseries/data`, `GET /timeseries/data/{id}?latest=true`, `GET /surveys`, `GET /surveys/{abbr}`) | `bls_get_series`, `bls_get_latest`, `bls_list_surveys` |
| `BlsCatalogService` | LABSTAT flat files (`{survey}.series` + map files from `download.bls.gov/pub/time.series/`) | `bls_search_series` |

**`BlsApiService` resilience:**

| Concern | Decision |
|:--------|:---------|
| Retry boundary | Full fetch + parse pipeline; use `withRetry` |
| Backoff | 1–2s base (rate-limited upstream, 500/day quota makes aggressive retries counterproductive) |
| 429 handling | Count against daily quota; surface remaining quota estimate in response metadata |
| Parse failure | HTML error page detection → `ServiceUnavailable`, not `SerializationError` |

**`BlsCatalogService`:** BLS LABSTAT publishes per-survey flat files at `download.bls.gov/pub/time.series/{survey}/`. The relevant files are `{survey}.series` (series-level index: seriesID, title, area, item, seasonal flag) and the survey's code-mapping files (e.g., `cu.area`, `cu.item`). The `{survey}.data.*` observation files are NOT needed and can be hundreds of MB — skip them. Download series + map files at build time; load into memory at startup. Enables full-text + structured search with zero API quota cost. Rebuild on a monthly schedule or on demand. The BLS FAQ explicitly notes there is no API catalog endpoint ("We do not currently have a catalogue of series IDs"), confirming the offline approach is the only path.

**`bls_list_surveys` backed by API:** `GET /surveys` returns all survey abbreviations and names; `GET /surveys/{abbr}` returns `allowsNetChange`, `allowsPercentChange`, `hasAnnualAverages`. This is a low-frequency call and can be cached aggressively (monthly TTL); it does not count toward the 500/day quota concern.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `BLS_API_KEY` | Yes | BLS v2 API key (free, register at bls.gov/developers) |
| `BLS_BASE_URL` | No | Override API base URL (default: `https://api.bls.gov/publicAPI/v2`) |
| `BLS_CATALOG_BASE_URL` | No | Override LABSTAT flat-file base URL (default: `https://download.bls.gov/pub/time.series`) — useful for pointing at a local mirror |
| `CANVAS_PROVIDER_TYPE` | No | Set to `duckdb` to enable DataCanvas tabular spillover for large result sets (Node only) |

---

## Implementation Order

1. **Config** — `src/config/server-config.ts` with Zod schema; validate `BLS_API_KEY` at startup
2. **`BlsCatalogService`** — bundle/download BLS flat catalog files; build in-memory series index; implement text + structured search
3. **`BlsApiService`** — v2 `POST /timeseries/data` (batch) and `GET /timeseries/data/{id}?latest=true` (single) wrappers with retry/backoff; `GET /surveys` for survey metadata
4. **`bls_list_surveys`** — static catalog; no API calls; independently testable
5. **`bls_search_series`** — backed by `BlsCatalogService`; no API calls; test against real catalog
6. **`bls_get_latest`** — single API call path; simple response shape; test first
7. **`bls_get_series`** — batch series with year range, calculations, and DataCanvas spillover

Each step is independently testable.

---

## Domain Mapping

| Noun | BLS Operations | Tool |
|:-----|:--------------|:-----|
| Survey catalog | List surveys/programs | `bls_list_surveys` |
| Series catalog | Search by text/filters | `bls_search_series` |
| Time series | Fetch by ID + year range | `bls_get_series` |
| Latest value | Fetch most recent period | `bls_get_latest` |

BLS v2 endpoints used:
- `POST /timeseries/data` — batch fetch 1–50 series with year range and optional `calculations: true`
- `GET /timeseries/data/{seriesID}?latest=true` — latest single-observation per series (one request per seriesID; no batch equivalent)
- `GET /surveys` — list all survey abbreviations and names
- `GET /surveys/{abbr}` — survey metadata including `allowsNetChange`, `allowsPercentChange`, `hasAnnualAverages`

Series catalog resolution is handled entirely offline from LABSTAT flat files — no API quota consumed.

### Error Contracts

| Tool | reason | code | when | retryable? |
|:-----|:-------|:-----|:-----|:-----------|
| `bls_get_series`, `bls_get_latest` | `quota_exceeded` | `ServiceUnavailable` | 429 from API or daily 500-query limit hit | No (until next UTC day) |
| `bls_get_series`, `bls_get_latest` | `series_not_found` | `InvalidParams` | API returns "Series does not exist" message | No — fix the SeriesID |
| `bls_get_series`, `bls_get_latest` | `series_locked` | `ServiceUnavailable` | API returns "Database is locked for Series" | Yes — transient, retry with backoff |
| `bls_get_series` | `no_data_for_period` | `InvalidParams` | API returns "No Data Available for Series" for the requested year range | No — adjust `start_year`/`end_year` |
| `bls_get_series` | `calculations_not_supported` | `InvalidParams` | `calculations: true` requested for a survey that doesn't support it | No — remove calculations flag |
| `bls_search_series` | `catalog_unavailable` | `InternalError` | Catalog index not loaded (startup failure or build-time skip) | No — server restart needed |

---

## Workflow Analysis

**Common agent chain — natural language → current value:**

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `bls_list_surveys` | Orient to which survey covers the topic (optional; skip if domain is clear) |
| 2 | `bls_search_series` | Resolve concept → SeriesID(s) |
| 3 | `bls_get_latest` | Get current value for resolved SeriesID(s) |

**Common agent chain — trend analysis:**

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `bls_search_series` | Resolve concept → SeriesID(s) |
| 2 | `bls_get_series` | Fetch history with `calculations: true` for YoY/MoM |

`bls_get_series` is the quota-heavy tool (one API call per batch, counts as one query). `bls_get_latest` issues N individual GET requests (one per seriesID) — each counts as one query. For "current value" across many series, `bls_get_series` with a 1-year window is more quota-efficient (one query regardless of series count); `bls_get_latest` is preferable only for a single series where the absolute most recent period matters.

### Output and format() Completeness

Both `bls_get_series` and `bls_get_latest` return structured data that must appear in full in both `structuredContent` (Claude Code) and the `format()` markdown twin (Claude Desktop). The `format()` implementation must render all observation values, not just a count or summary. `bls_search_series` similarly must render decoded series components (survey, area, item, seasonal flag, plain-language name) in `format()` — not just a count of matches.

---

## Known Limitations

- **500 queries/day per API key.** `bls_get_series` (POST, up to 50 series) consumes one query regardless of series count. `bls_get_latest` issues one GET per seriesID — fetching 10 series' latest values costs 10 queries. At scale this is the binding constraint; prefer `bls_get_series` with a narrow year window for multi-series latest-value needs. Response metadata surfaces an estimated remaining quota when the API returns it. Multi-tenant hosted deployments need per-tenant key support or a quota-sharing strategy outside this server's scope.
- **20-year history window.** BLS v2 caps history at 20 years per request. Longer time series require multiple calls.
- **SeriesID catalog freshness.** The bundled catalog reflects BLS flat files at build time. New series or geographic area changes won't appear until a rebuild. `bls_search_series` may miss very recently added series.
- **No geographic geocoding.** Area code resolution maps string names to BLS FIPS/area codes from the catalog — it's a lookup, not a geocoder. Unusual MSA names or abbreviations may not match.
- **Calculations are BLS-server-side and all-or-nothing.** The `calculations: true` flag enables both net change and percent change together; individual calculation types cannot be selected. Not all surveys support calculations — the `allowsNetChange`/`allowsPercentChange` fields from the surveys API indicate support. If calculations are requested for an unsupported survey, the API returns an error rather than silently ignoring the flag.

---

## Decisions Log

### Answered questions

- **Curated lookup table vs. search-only for SeriesID resolution** → offline catalog search from BLS flat files, with a curated "common series" shortlist embedded in the index for high-frequency queries (unemployment rate, CPI-U, nonfarm payrolls). The flat files cover everything; the shortlist just improves ranking for known-common asks. No separate lookup table tool needed.
- **Calculations: BLS flag vs. local computation** → BLS v2 `calculations` flag. One fewer moving part, always consistent with BLS's published numbers. Local computation adds complexity with no fidelity gain for the use cases here.
- **Area-code resolution: separate tool vs. fold into `bls_search_series`** → fold into `bls_search_series` as an `area` parameter. It's a filter, not a workflow step — a dedicated area-lookup tool would just be a pre-step agents forget to use. The search tool accepts state name, MSA, or FIPS and resolves internally.
- **`bls_get_latest` vs. collapsing into `bls_get_series`** → kept as a separate tool. The "current value" ask is extremely common, the call is cheaper in user-cognitive overhead, and the description signals clearly when to use it vs. history. A `mode` consolidation would obscure the choice.
- **DataCanvas opt-in** → `CANVAS_PROVIDER_TYPE=duckdb` env var following framework convention. Activated in `bls_get_series` when series × observation count would overflow context. `bls_get_latest` never spills — result set is always bounded.
- **v1 vs. v2 API** → v2 only. v1 requires no key but has severe throttling (10 series/request, no calculations flag). The server should require a key and get full v2 capability.
- **Prompts** → none. BLS queries are factual lookups; there's no recurring LLM-interaction pattern that benefits from a template.

### Options declined

- **`bls_decode_series_id` tool** → declined. Decoding is better done as enriched output in `bls_search_series` results (return the decoded components alongside the ID). A standalone decode tool adds a round-trip for no workflow benefit.
- **`bls_compare_series` tool** → declined. Cross-series comparison is arithmetic the agent can do from `bls_get_series` output. A dedicated comparison tool would be pure wrapper around data the agent already has.
- **App tool for tabular results** → declined. No MCP Apps-capable client justification; DataCanvas via `api-canvas` handles the spillover case without the iframe/CSP/format-twin maintenance cost.
- **Resources** → declined. BLS data is time-dynamic by nature (series values change monthly). There's no stable-URI, cacheable, injectable-context use case that tools don't already serve.
- **Per-tenant quota accounting built into the server** → deferred. The 500/day limit is real but the server can't track cross-session usage without external state. Surfacing remaining quota from API responses (when available) is the right scope; full accounting is a deployment concern.

---

### Post-design corrections (verified against BLS API docs and LABSTAT)

- **`calculations` is a boolean, not an enum.** The initial design listed `calculations` as `enum: none, net_change, percent_change, all`. The actual BLS v2 API accepts `"calculations": true|false` only — both net change and percent change are enabled together, or neither. The tool parameter is a `bool`, and not all surveys support it (`allowsNetChange`/`allowsPercentChange` per survey).
- **No batch-latest endpoint exists.** The design's `timeseries/latest` POST endpoint does not exist in BLS v2. The actual endpoint is `GET /timeseries/data/{seriesID}?latest=true`, which accepts a single seriesID per request. `bls_get_latest` must issue N sequential (or parallel) GETs, each consuming one of the 500/day queries. Corrected tool description, quota note, and workflow analysis accordingly.
- **LABSTAT flat files are real and downloadable.** Confirmed at `download.bls.gov/pub/time.series/`. Each survey directory contains `{survey}.series` (the series index, sizes range from ~100KB to 15MB) and code-mapping files. The `{survey}.data.*` observation files (hundreds of MB each) are NOT needed for catalog search and must be excluded from the build-time download. Total series-index footprint estimated at 50–100MB across all surveys.
- **BLS has no API catalog search.** FAQ explicitly confirms: "We do not currently have a catalogue of series IDs." The offline flat-file approach is the correct workaround (and the only one).
- **`bls_list_surveys` can use live API endpoints.** `GET /surveys` and `GET /surveys/{abbr}` return live survey metadata including calculation support flags. Moved `bls_list_surveys` to `BlsApiService` with aggressive caching (monthly TTL). Does not consume meaningful quota.
- **Error contracts added.** Typed `errors` contract declared for: quota exhaustion, invalid SeriesID, locked database, no data for period, calculations not supported, catalog unavailable.
- **`format()` completeness callout added.** All three data-returning tools must render their full observation data in `format()`, not just summaries — Claude Desktop sees only `content[]`.
