/**
 * @fileoverview Tests for bls_dataframe_describe tool.
 * @module tests/tools/bls-dataframe-describe.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { blsDataframeDescribeTool } from '@/mcp-server/tools/definitions/bls-dataframe-describe.tool.js';
import { initCanvasBridge } from '@/services/canvas-bridge/canvas-bridge.js';

describe('blsDataframeDescribeTool', () => {
  beforeEach(() => {
    // No canvas — tests the unavailable path
    initCanvasBridge(undefined);
  });

  it('throws canvas_unavailable when canvas is not configured', async () => {
    const ctx = createMockContext({ errors: blsDataframeDescribeTool.errors });
    const input = blsDataframeDescribeTool.input.parse({});

    await expect(blsDataframeDescribeTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'canvas_unavailable' },
    });
  });

  it('formats empty dataframe list', () => {
    const output = { dataframes: [] };
    const blocks = blsDataframeDescribeTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No active dataframes');
  });

  it('formats dataframe entries with nullable column schema', () => {
    const output = {
      dataframes: [
        {
          name: 'df_AAAAA_BBBBB',
          source_tool: 'bls_get_series',
          query_params: { series_ids: ['LNS14000000'] },
          created_at: '2026-05-21T10:00:00.000Z',
          expires_at: '2026-05-22T10:00:00.000Z',
          row_count: 24,
          truncated: false,
          column_schema: [
            { name: 'series_id', type: 'VARCHAR', nullable: true },
            { name: 'value', type: 'DOUBLE', nullable: true },
          ],
        },
      ],
    };
    const blocks = blsDataframeDescribeTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('df_AAAAA_BBBBB');
    expect(text).toContain('24');
    expect(text).toContain('nullable');
    expect(text).toContain('series_id');
  });
});
