/**
 * @fileoverview Tests for bls_search_series tool.
 * @module tests/tools/bls-search-series.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns series from catalog on happy path', () => {
    mockIsLoaded = true;
    const ctx = createMockContext();
    const input = blsSearchSeriesTool.input.parse({ query: 'unemployment', limit: 5 });
    const result = blsSearchSeriesTool.handler(input, ctx);

    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.seriesId).toBe('LNS14000000');
    expect(result.total).toBe(1);
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
      total: 1,
    };
    const blocks = blsSearchSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('LNS14000000');
    expect(text).toContain('seasonal');
  });

  it('renders no-results message when series is empty', () => {
    const output = { series: [], total: 0 };
    const blocks = blsSearchSeriesTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No matching series');
  });
});
