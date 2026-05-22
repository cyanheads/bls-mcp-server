/**
 * @fileoverview Drop a canvas dataframe by name. Idempotent. Opt-in via
 * BLS_DATAFRAME_DROP_ENABLED=true — off by default since per-table TTL handles
 * cleanup. Requires CANVAS_PROVIDER_TYPE=duckdb.
 * @module mcp-server/tools/definitions/bls-dataframe-drop
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getCanvasBridge } from '@/services/canvas-bridge/canvas-bridge.js';

export const blsDataframeDropTool = tool('bls_dataframe_drop', {
  title: 'Drop BLS Dataframe',
  description:
    'Drop a canvas dataframe by name. Idempotent — returns dropped=false when nothing matched. Use to free canvas resources ahead of the per-table TTL when an analysis is complete. This tool must be explicitly enabled via BLS_DATAFRAME_DROP_ENABLED=true.',
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
    destructiveHint: true,
  },

  errors: [
    {
      reason: 'canvas_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The DataCanvas service is not configured for this deployment.',
      recovery:
        'Set CANVAS_PROVIDER_TYPE=duckdb in the server environment and restart to enable dataframe tools.',
    },
  ],

  input: z.object({
    name: z.string().min(1).describe('Canvas table name (df_XXXXX_XXXXX) to drop.'),
  }),

  output: z.object({
    name: z.string().describe('Name that was requested for drop.'),
    dropped: z
      .boolean()
      .describe('True when the dataframe existed and was removed; false when nothing matched.'),
  }),

  async handler(input, ctx) {
    const bridge = getCanvasBridge();
    if (!bridge) {
      throw ctx.fail('canvas_unavailable', 'DataCanvas is not configured on this server.', {
        ...ctx.recoveryFor('canvas_unavailable'),
      });
    }
    const dropped = await bridge.drop(ctx, input.name);
    ctx.log.info('Dataframe drop requested', { name: input.name, dropped });
    return { name: input.name, dropped };
  },

  format: (result) => [
    {
      type: 'text',
      text: result.dropped ? `Dropped ${result.name}.` : `${result.name} not found.`,
    },
  ],
});
