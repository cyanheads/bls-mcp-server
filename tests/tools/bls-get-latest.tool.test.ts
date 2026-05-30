/**
 * @fileoverview Tests for bls_get_latest tool.
 * @module tests/tools/bls-get-latest.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { blsGetLatestTool } from '@/mcp-server/tools/definitions/bls-get-latest.tool.js';
import type { SeriesData } from '@/services/bls-api/types.js';

const MOCK_SERIES: SeriesData = {
  seriesId: 'LNS14000000',
  title: 'Unemployment Rate',
  area: 'U.S.',
  item: 'Unemployment rate',
  seasonal: 'Seasonally Adjusted',
  observations: [{ year: '2024', period: 'M12', periodName: 'December', value: '4.1' }],
};

const fetchLatestMock = vi.fn();

vi.mock('@/services/bls-api/bls-api-service.js', () => ({
  getBlsApiService: () => ({ fetchLatest: fetchLatestMock }),
}));

describe('blsGetLatestTool', () => {
  it('returns latest observations for valid series with no notice', async () => {
    fetchLatestMock.mockResolvedValue(MOCK_SERIES);

    const ctx = createMockContext();
    const input = blsGetLatestTool.input.parse({ series_ids: ['LNS14000000'] });
    const result = await blsGetLatestTool.handler(input, ctx);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.results[0]!.seriesId).toBe('LNS14000000');
    expect(result.results[0]!.latestObservation?.value).toBe('4.1');

    const enriched = getEnrichment(ctx);
    expect(enriched.notice).toBeUndefined();
  });

  it('records failed series and enriches with notice', async () => {
    fetchLatestMock.mockRejectedValue(new Error('series_not_found'));

    const ctx = createMockContext();
    const input = blsGetLatestTool.input.parse({ series_ids: ['INVALID000'] });
    const result = await blsGetLatestTool.handler(input, ctx);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.seriesId).toBe('INVALID000');
    expect(result.failed[0]!.error).toContain('series_not_found');

    const enriched = getEnrichment(ctx);
    expect(enriched.notice).toBeDefined();
    expect(enriched.notice).toContain('bls_search_series');
  });

  it('handles sparse upstream payload — no observations goes to failed', async () => {
    const sparse: SeriesData = { seriesId: 'LNS14000000', observations: [] };
    fetchLatestMock.mockResolvedValue(sparse);

    const ctx = createMockContext();
    const input = blsGetLatestTool.input.parse({ series_ids: ['LNS14000000'] });
    const result = await blsGetLatestTool.handler(input, ctx);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.seriesId).toBe('LNS14000000');
    expect(result.failed[0]!.error).toContain('No observations returned');
  });

  it('formats output with period code and item fields', () => {
    const output = {
      results: [
        {
          seriesId: 'LNS14000000',
          title: 'Unemployment Rate',
          area: 'U.S.',
          item: 'Unemployment rate',
          seasonal: 'Seasonally Adjusted',
          latestObservation: {
            year: '2024',
            period: 'M12',
            periodName: 'December',
            value: '4.1',
          },
        },
      ],
      succeeded: 1,
      failed: [],
    };
    const blocks = blsGetLatestTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('LNS14000000');
    expect(text).toContain('4.1');
    expect(text).toContain('M12');
    expect(text).toContain('Item:');
  });
});
