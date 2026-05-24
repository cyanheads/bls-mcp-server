# bls-labor-mcp-server — Idea

Pre-design seed. Feeds into `design-mcp-server` to produce `docs/design.md`.

## Domain

Bureau of Labor Statistics — official US source for labor, prices, productivity, and workplace data. CPI, PPI, unemployment, employment by industry/occupation/region, wages, JOLTS, productivity, time use, occupational injuries. Many FRED series republish BLS data; BLS is the primary source and often more current.

## Data source

- **API:** https://www.bls.gov/developers/api_signature_v2.htm
- **Auth:** free API key (v2; v1 is keyless but heavily throttled)
- **Rate limit (v2):** 500 queries/day, 50 series/query, up to 20 years history per request
- **Format:** JSON; time series by encoded SeriesID (e.g., `LNS14000000` for civilian unemployment rate)
- **Note:** SeriesIDs are cryptic — survey code + area code + item code + seasonal flag — name resolution is the killer feature

## User goals

- Resolve a question to the right SeriesID — cryptic IDs are the central UX problem
- Pull values for one or more series with year range
- Get the latest value (most recent month/quarter) — common single-shot ask
- YoY / MoM / period-over-period change computation
- Browse the survey taxonomy (CES, CPS, LAUS, CPI, PPI, JOLTS, ECEC, OEWS, …)

## Tool sketch

| Tool | Purpose |
|:-----|:--------|
| `bls_search_series` | Structured + free-text search to resolve cryptic SeriesIDs (survey, area code, item code, seasonal adjustment flag) |
| `bls_get_series` | Pull values for 1–50 series with start/end year, optional calculations (net change, percent change) |
| `bls_get_latest` | Shortcut: latest value(s) for a series — distinct enough from `get_series` to earn its own tool |
| `bls_browse_surveys` | List BLS surveys and their components (CES, CPS, CPI, PPI, JOLTS, …) |

## Pairs with

- **fred-mcp-server** — overlap on republished series; BLS is primary, FRED is friendlier for general macro
- **secedgar-mcp-server** — labor/wage context for filings
- **census-mcp-server** *(future)* — demographic crosswalk

## Open questions

- SeriesID resolution: embed a curated lookup table for common asks ("unemployment rate" → `LNS14000000`), or rely on search alone?
- Calculations: rely on BLS's built-in `calculations` flag (net/percent change) or compute locally for consistency?
- Daily quota of 500 is tight — per-tenant accounting needed if multi-tenant hosted
- Area-code resolution (state/MSA) is its own sub-problem — separate tool or fold into `search_series`?
