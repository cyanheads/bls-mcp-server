/**
 * @fileoverview Tests for bls_dataframe_query tool.
 * @module tests/tools/bls-dataframe-query.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { blsDataframeQueryTool } from '@/mcp-server/tools/definitions/bls-dataframe-query.tool.js';
import { initCanvasBridge } from '@/services/canvas-bridge/canvas-bridge.js';

describe('blsDataframeQueryTool', () => {
  beforeEach(() => {
    initCanvasBridge(undefined);
  });

  it('throws canvas_unavailable when canvas is not configured', async () => {
    const ctx = createMockContext({ errors: blsDataframeQueryTool.errors });
    const input = blsDataframeQueryTool.input.parse({ sql: 'SELECT 1' });

    await expect(blsDataframeQueryTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'canvas_unavailable' },
    });
  });

  it('formats query results as markdown table', () => {
    const output = {
      columns: ['series_id', 'value'],
      row_count: 2,
      rows: [
        { series_id: 'LNS14000000', value: '4.1' },
        { series_id: 'CES0000000001', value: '159000' },
      ],
    };
    const blocks = blsDataframeQueryTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('series_id');
    expect(text).toContain('4.1');
    expect(text).toContain('LNS14000000');
  });

  it('formats empty result set', () => {
    const output = {
      columns: ['series_id'],
      row_count: 0,
      rows: [],
    };
    const blocks = blsDataframeQueryTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No rows');
  });

  it('includes registered_as and expires_at when present', () => {
    const output = {
      columns: ['series_id'],
      row_count: 1,
      rows: [{ series_id: 'X' }],
      registered_as: 'df_CCCCC_DDDDD',
      expires_at: '2026-05-22T00:00:00.000Z',
    };
    const blocks = blsDataframeQueryTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('df_CCCCC_DDDDD');
  });
});
