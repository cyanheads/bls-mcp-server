#!/usr/bin/env node
/**
 * @fileoverview bls-labor-mcp-server MCP server entry point. Registers all BLS tools
 * and initializes services via the framework's setup() callback.
 * @module index
 */

import { createApp, disabledTool } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
import { blsDataframeDescribeTool } from './mcp-server/tools/definitions/bls-dataframe-describe.tool.js';
import { blsDataframeDropTool } from './mcp-server/tools/definitions/bls-dataframe-drop.tool.js';
import { blsDataframeQueryTool } from './mcp-server/tools/definitions/bls-dataframe-query.tool.js';
import { blsGetLatestTool } from './mcp-server/tools/definitions/bls-get-latest.tool.js';
import { blsGetSeriesTool } from './mcp-server/tools/definitions/bls-get-series.tool.js';
import { blsListSurveysTool } from './mcp-server/tools/definitions/bls-list-surveys.tool.js';
import { blsSearchSeriesTool } from './mcp-server/tools/definitions/bls-search-series.tool.js';
import { initBlsApiService } from './services/bls-api/bls-api-service.js';
import {
  getBlsCatalogService,
  initBlsCatalogService,
} from './services/bls-catalog/bls-catalog-service.js';
import { initCanvasBridge } from './services/canvas-bridge/canvas-bridge.js';

const cfg = getServerConfig();

const dropTool = cfg.dataframeDropEnabled
  ? blsDataframeDropTool
  : disabledTool(blsDataframeDropTool, {
      reason: 'bls_dataframe_drop is disabled by default — TTL handles lifecycle.',
      hint: 'BLS_DATAFRAME_DROP_ENABLED=true',
    });

await createApp({
  landing: { requireAuth: false },
  tools: [
    blsListSurveysTool,
    blsSearchSeriesTool,
    blsGetLatestTool,
    blsGetSeriesTool,
    blsDataframeDescribeTool,
    blsDataframeQueryTool,
    dropTool,
  ],
  resources: [],
  prompts: [],

  setup(core) {
    initBlsApiService(core.config, core.storage);
    initBlsCatalogService(core.config, core.storage);
    initCanvasBridge(core.canvas);

    // Load catalog in background — non-blocking. bls_search_series throws
    // catalog_unavailable if called before loading completes.
    getBlsCatalogService()
      .load()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bls-labor-mcp-server] Catalog load error: ${msg}\n`);
      });
  },
});
