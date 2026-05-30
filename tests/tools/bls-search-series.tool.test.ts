/**
 * @fileoverview Tests for bls_search_series tool.
 * @module tests/tools/bls-search-series.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { blsSearchSeriesTool } from '@/mcp-server/tools/definitions/bls-search-series.tool.js';

const MOCK_SERIES = [
  {
    seriesId: 'LNS14000000',
    title: 'Unemployment Rate',
    surveyAbbr: 'LN',
    seasonal: true,
    areaName: 'United States',
  },
];

const mockSearch = vi.fn().mockReturnValue({ series: MOCK_SERIES, total: 1 });
let mockIsLoaded = true;

vi.mock('@/services/bls-catalog/bls-catalog-service.js', () => ({
  getBlsCatalogService: () => ({
    get isLoaded() {
      return mockIsLoaded;
    },
    get totalSeries() {
      return mockIsLoaded ? 847000 : 0;
    },
    search: mockSearch,
  }),
}));

describe('blsSearchSeriesTool', () => {
  it('throws catalog_unavailable when catalog is not loaded', () => {
    mockIsLoaded = false;
    const ctx = createMockContext({ errors: blsSearchSeriesTool.errors });
    const input = blsSearchSeriesTool.input.parse({ query: 'unemployment' });

    expect(() => blsSearchSeriesTool.handler(input, ctx)).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'catalog_unavailable' }) }),
    );
    mockIsLoaded = true;
  });

  it('returns series from catalog on happy path and enriches with totals', () => {
    mockIsLoaded = true;
    const ctx = createMockContext();
    const input = blsSearchSeriesTool.input.parse({ query: 'unemployment', limit: 5 });
    const result = blsSearchSeriesTool.handler(input, ctx);

    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.seriesId).toBe('LNS14000000');

    const enriched = getEnrichment(ctx);
    expect(enriched.totalFound).toBe(1);
    expect(enriched.catalogSize).toBe(847000);
    expect(enriched.notice).toBeUndefined();
  });

  it('enriches with notice when no series match', () => {
    const emptySearch = vi.fn().mockReturnValue({ series: [], total: 0 });
    vi.mocked(mockSearch).mockImplementationOnce(emptySearch);
    mockIsLoaded = true;

    const ctx = createMockContext();
    const input = blsSearchSeriesTool.input.parse({ query: 'zzznotasurvey', limit: 5 });
    blsSearchSeriesTool.handler(input, ctx);

    const enriched = getEnrichment(ctx);
    expect(enriched.notice).toBeDefined();
    expect(enriched.totalFound).toBe(0);
  });

  it('formats output including seasonal field', () => {
    const output = {
      series: [
        {
          seriesId: 'LNS14000000',
          title: 'Unemployment Rate',
          survey: 'LN',
          seasonal: true,
        },
      ],
    };
    const blocks = blsSearchSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('LNS14000000');
    expect(text).toContain('seasonal');
  });

  it('renders no-results message when series is empty', () => {
    const output = { series: [] };
    const blocks = blsSearchSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No matching series');
  });
});
