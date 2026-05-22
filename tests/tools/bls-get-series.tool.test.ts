/**
 * @fileoverview Tests for bls_get_series tool.
 * @module tests/tools/bls-get-series.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { blsGetSeriesTool } from '@/mcp-server/tools/definitions/bls-get-series.tool.js';
import type { SeriesData } from '@/services/bls-api/types.js';

const MOCK_SERIES: SeriesData = {
  seriesId: 'LNS14000000',
  title: 'Unemployment Rate',
  area: 'U.S.',
  item: 'Unemployment rate',
  seasonal: 'Seasonally Adjusted',
  observations: [
    { year: '2024', period: 'M12', periodName: 'December', value: '4.1' },
    { year: '2024', period: 'M11', periodName: 'November', value: '4.2' },
  ],
};

const fetchSeriesMock = vi.fn();

vi.mock('@/services/bls-api/bls-api-service.js', () => ({
  getBlsApiService: () => ({ fetchSeries: fetchSeriesMock }),
}));

vi.mock('@/services/canvas-bridge/canvas-bridge.js', () => ({
  getCanvasBridge: () => undefined,
  toDatasetField: vi.fn(),
}));

describe('blsGetSeriesTool', () => {
  it('returns inline series data within budget', async () => {
    fetchSeriesMock.mockResolvedValue([MOCK_SERIES]);

    const ctx = createMockContext();
    const input = blsGetSeriesTool.input.parse({ series_ids: ['LNS14000000'] });
    const result = await blsGetSeriesTool.handler(input, ctx);

    expect(result.spilled).toBe(false);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.seriesId).toBe('LNS14000000');
    expect(result.series[0]!.observations).toHaveLength(2);
    expect(result.series[0]!.observations[0]!.value).toBe('4.1');
  });

  it('throws on service error (quota_exceeded)', async () => {
    const { serviceUnavailable } = await import('@cyanheads/mcp-ts-core/errors');
    fetchSeriesMock.mockRejectedValue(serviceUnavailable('quota', { reason: 'quota_exceeded' }));

    const ctx = createMockContext({ errors: blsGetSeriesTool.errors });
    const input = blsGetSeriesTool.input.parse({ series_ids: ['LNS14000000'] });

    await expect(blsGetSeriesTool.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'quota_exceeded' },
    });
  });

  it('passes calculations flag only when set', async () => {
    fetchSeriesMock.mockResolvedValue([MOCK_SERIES]);

    const ctx = createMockContext();
    const input = blsGetSeriesTool.input.parse({
      series_ids: ['LNS14000000'],
      calculations: true,
    });
    await blsGetSeriesTool.handler(input, ctx);

    expect(fetchSeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ calculations: true }),
      ctx,
    );
  });

  it('handles sparse upstream payload — series with no observations', async () => {
    const sparse: SeriesData = { seriesId: 'SPARSE000', observations: [] };
    fetchSeriesMock.mockResolvedValue([sparse]);

    const ctx = createMockContext();
    const input = blsGetSeriesTool.input.parse({ series_ids: ['SPARSE000'] });
    const result = await blsGetSeriesTool.handler(input, ctx);

    expect(result.series[0]!.observationCount).toBe(0);
    expect(result.series[0]!.observations).toHaveLength(0);
  });

  it('formats output with period code column', () => {
    const output = {
      series: [
        {
          seriesId: 'LNS14000000',
          title: 'Unemployment Rate',
          observationCount: 1,
          observations: [{ year: '2024', period: 'M12', periodName: 'December', value: '4.1' }],
        },
      ],
      spilled: false as const,
    };
    const blocks = blsGetSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('LNS14000000');
    expect(text).toContain('M12');
    expect(text).toContain('4.1');
  });

  it('formats spilled output with truncated flag', () => {
    const output = {
      series: [
        {
          seriesId: 'LNS14000000',
          observationCount: 100,
          observations: [{ year: '2024', period: 'M12', value: '4.1' }],
        },
      ],
      dataset: {
        name: 'df_AAAAA_BBBBB',
        row_count: 100,
        expires_at: '2026-05-22T00:00:00.000Z',
        truncated: true,
      },
      spilled: true as const,
    };
    const blocks = blsGetSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('df_AAAAA_BBBBB');
    expect(text).toContain('truncated');
  });
});
