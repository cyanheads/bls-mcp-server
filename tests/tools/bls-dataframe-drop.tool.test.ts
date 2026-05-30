/**
 * @fileoverview Tests for bls_dataframe_drop tool.
 * @module tests/tools/bls-dataframe-drop.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { blsDataframeDropTool } from '@/mcp-server/tools/definitions/bls-dataframe-drop.tool.js';
import { initCanvasBridge } from '@/services/canvas-bridge/canvas-bridge.js';

describe('blsDataframeDropTool', () => {
  beforeEach(() => {
    initCanvasBridge(undefined);
  });

  it('throws canvas_unavailable when canvas is not configured', async () => {
    const ctx = createMockContext({ errors: blsDataframeDropTool.errors });
    const input = blsDataframeDropTool.input.parse({ name: 'df_AAAAA_BBBBB' });

    await expect(blsDataframeDropTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'canvas_unavailable' },
    });
  });

  it('formats dropped=true result', () => {
    const blocks = blsDataframeDropTool.format!({ name: 'df_AAAAA_BBBBB', dropped: true });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('df_AAAAA_BBBBB');
    expect(text).toContain('Dropped');
  });

  it('formats dropped=false result', () => {
    const blocks = blsDataframeDropTool.format!({ name: 'df_XXXXX_YYYYY', dropped: false });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('not found');
  });

  it('rejects empty name', () => {
    expect(() => blsDataframeDropTool.input.parse({ name: '' })).toThrow();
  });

  it('output schema validates correctly', () => {
    expect(() =>
      blsDataframeDropTool.output.parse({ name: 'df_AAAAA_BBBBB', dropped: true }),
    ).not.toThrow();
    expect(() =>
      blsDataframeDropTool.output.parse({ name: 'df_AAAAA_BBBBB', dropped: false }),
    ).not.toThrow();
  });
});
