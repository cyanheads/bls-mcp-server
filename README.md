<div align="center">
  <h1>@cyanheads/bls-mcp-server</h1>
  <p><b>Fetch US Bureau of Labor Statistics data — CPI, unemployment, wages, JOLTS, and more via MCP. STDIO or Streamable HTTP.</b>
  <div>7 Tools</div>
  </p>
</div>

<div align="center">

[![npm](https://img.shields.io/npm/v/@cyanheads/bls-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/bls-mcp-server) [![Version](https://img.shields.io/badge/Version-0.1.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-259?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/)

[![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

---

## Tools

Four tools covering the BLS data surface — survey discovery, SeriesID resolution, history, and current values:

| Tool | Description |
|:-----|:------------|
| `bls_list_surveys` | List BLS survey programs (CPI, CPS, CES, JOLTS, PPI, OEWS, …) with codes, descriptions, and coverage. |
| `bls_search_series` | Search the BLS series catalog by natural language, survey, area, or keywords to resolve cryptic SeriesIDs. |
| `bls_get_series` | Fetch time-series data for 1–50 BLS series by SeriesID, with optional year range and period-over-period calculations. |
| `bls_get_latest` | Return the single most recent observation for one or more BLS series. |

### `bls_list_surveys`

List available BLS survey programs and their metadata.

- Covers all major BLS programs: CPS, CES, CPI, PPI, JOLTS, LAUS, OEWS, ECEC, and others
- Optional `category` filter (`prices`, `employment`, `wages`, `productivity`, `injuries`, `time_use`)
- Returns survey codes, descriptions, geographic and subject coverage, and calculation support flags
- Backed by the live BLS surveys API with aggressive caching (monthly TTL); does not consume daily quota

---

### `bls_search_series`

The entry point for most BLS workflows. Resolves human concepts to BLS SeriesIDs.

- BLS identifiers like `LNS14000000` and `CES0000000001` encode survey + area + item + seasonal flag in opaque positional codes — this tool decodes them
- Free-text and keyword search against the full BLS series catalog
- Filter by survey code, geographic area (state name, MSA, or FIPS), and seasonal adjustment flag
- Returns decoded series components (survey, area, item, seasonal flag) alongside the plain-language name
- Operates entirely offline against LABSTAT flat files bundled at build time — no API quota consumed
- Use before `bls_get_series` or `bls_get_latest` when you have a concept but not a SeriesID

---

### `bls_get_series`

Fetch historical time-series data for one or more BLS series.

- Batch fetch up to 50 series per request (counts as one of the 500 daily queries)
- Optional `start_year` / `end_year` window (BLS caps history at 20 years per request)
- Optional `calculations: true` for BLS-server-side net change and percent change (all-or-nothing; check `bls_list_surveys` for per-survey support)
- Returns observations with series metadata (title, unit, seasonality)
- DataCanvas spillover for large result sets when `CANVAS_PROVIDER_TYPE=duckdb`

---

### `bls_get_latest`

Get the current value for one or more BLS series.

- Issues one GET per SeriesID (no batch-latest endpoint exists in BLS v2) — each counts as one of the 500 daily queries
- Recommended limit: ≤10 series per call; accepts up to 50
- For "current value" across many series, `bls_get_series` with a narrow year window is more quota-efficient (one query regardless of series count)

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Pluggable auth (`none`, `jwt`, `oauth`)
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

BLS-specific:

- BLS API v2 integration with retry/backoff and daily quota tracking
- Offline series catalog search against LABSTAT flat files — zero API quota for discovery
- Typed error contracts for BLS-specific failure modes: quota exhaustion, locked database, calculations not supported
- Period-over-period calculations via BLS server-side flag (consistent with BLS published numbers)

## Getting started

Add the following to your MCP client configuration file. A free BLS API key is required — register at [bls.gov/developers](https://www.bls.gov/developers/home.htm).

```json
{
  "mcpServers": {
    "bls": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/bls-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "BLS_API_KEY": "your-key-here"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "bls": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/bls-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "BLS_API_KEY": "your-key-here"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "bls": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "-e", "BLS_API_KEY=your-key-here", "ghcr.io/cyanheads/bls-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 BLS_API_KEY=... bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.3.2](https://bun.sh/) or higher (or Node.js v24+).
- A free BLS API v2 key — register at [bls.gov/developers](https://www.bls.gov/developers/home.htm). The v2 key grants 500 queries/day; v1 (keyless) is not supported.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/bls-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd bls-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set BLS_API_KEY
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `BLS_API_KEY` | **Required.** BLS v2 API key (500 queries/day). Register free at [bls.gov/developers](https://www.bls.gov/developers/home.htm). | — |
| `BLS_BASE_URL` | BLS API v2 base URL. | `https://api.bls.gov/publicAPI/v2` |
| `BLS_CATALOG_BASE_URL` | LABSTAT flat-file base URL (useful for local mirrors). | `https://download.bls.gov/pub/time.series` |
| `CANVAS_PROVIDER_TYPE` | Set to `duckdb` to enable DataCanvas tabular spillover for large result sets. | `none` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `OTEL_ENABLED` | Enable OpenTelemetry instrumentation. | `false` |

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools and inits services. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). |
| `src/services/bls-api` | BLS API v2 service — batch fetch, latest-value GET, surveys metadata. |
| `src/services/bls-catalog` | LABSTAT flat-file catalog — offline series index and search. |
| `docs/design.md` | Full tool surface specification, service architecture, and error contracts. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- `bls_search_series` is the anchor tool — design workflows to call it before the API tools
- Wrap BLS API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
