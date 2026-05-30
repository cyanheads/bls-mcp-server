/**
 * @fileoverview Tests for BlsCatalogService — search logic, not-loaded guard, and UA header.
 * @module tests/services/bls-catalog/bls-catalog-service.test
 */

import { describe, expect, it, vi } from 'vitest';
import { BlsCatalogService } from '@/services/bls-catalog/bls-catalog-service.js';
import type { CatalogSeries } from '@/services/bls-catalog/types.js';

function makeService(entries: CatalogSeries[]): BlsCatalogService {
  const svc = new BlsCatalogService('http://unused', 'test-ua/1.0');
  // @ts-expect-error - directly populating internal state for tests
  svc.index = entries;
  // @ts-expect-error
  svc.loaded = true;
  return svc;
}

// Use non-COMMON_SERIES IDs so scoring is predictable
const FIXTURES: CatalogSeries[] = [
  {
    seriesId: 'TEST_UNEMP_001',
    title: 'Unemployment Rate - National',
    surveyAbbr: 'LN',
    seasonal: true,
    areaName: 'United States',
  },
  {
    seriesId: 'TEST_NONFARM_002',
    title: 'Total Nonfarm Payrolls',
    surveyAbbr: 'CE',
    seasonal: true,
  },
  {
    seriesId: 'TEST_CPI_003',
    title: 'CPI-U All Items Urban Average',
    surveyAbbr: 'CU',
    seasonal: false,
    itemName: 'All items',
  },
];

describe('BlsCatalogService.load', () => {
  it('sends the configured User-Agent on catalog fetches', async () => {
    const ua = 'test-bls-mcp/1.0 (casey@caseyjhand.com)';
    const capturedHeaders: HeadersInit[] = [];

    // Minimal series file: header + one data row
    const seriesText = 'series_id\ttitle\tseasonal\nLNS14000000\tUnemployment Rate\tS\n';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.headers) capturedHeaders.push(init.headers as HeadersInit);
      return Promise.resolve(new Response(seriesText, { status: 200 }));
    });

    const svc = new BlsCatalogService('https://download.bls.gov/pub/time.series', ua);
    await svc.load(1);

    expect(capturedHeaders.length).toBeGreaterThan(0);
    for (const h of capturedHeaders) {
      expect((h as Record<string, string>)['User-Agent']).toBe(ua);
    }
    vi.restoreAllMocks();
  });
});

describe('BlsCatalogService.search', () => {
  it('throws internalError when catalog is not loaded', () => {
    const svc = new BlsCatalogService('http://unused', 'test-ua/1.0');
    expect(() =>
      svc.search({
        query: 'unemployment',
        survey: undefined,
        area: undefined,
        seasonal_adjustment: undefined,
        limit: 10,
      }),
    ).toThrow();
  });

  it('returns exact match on seriesId query', () => {
    const svc = makeService(FIXTURES);
    const result = svc.search({
      query: 'TEST_UNEMP_001',
      survey: undefined,
      area: undefined,
      seasonal_adjustment: undefined,
      limit: 10,
    });
    expect(result.series[0]!.seriesId).toBe('TEST_UNEMP_001');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by survey abbreviation', () => {
    const svc = makeService(FIXTURES);
    const result = svc.search({
      query: 'all',
      survey: 'CU',
      area: undefined,
      seasonal_adjustment: undefined,
      limit: 10,
    });
    expect(result.series.every((s) => s.surveyAbbr === 'CU')).toBe(true);
  });

  it('filters by seasonal adjustment flag', () => {
    const svc = makeService(FIXTURES);
    const nsa = svc.search({
      query: 'CPI',
      survey: undefined,
      area: undefined,
      seasonal_adjustment: false,
      limit: 10,
    });
    expect(nsa.series.every((s) => !s.seasonal)).toBe(true);
  });

  it('respects the limit', () => {
    const many: CatalogSeries[] = Array.from({ length: 20 }, (_, i) => ({
      seriesId: `MANYTEST${String(i).padStart(3, '0')}`,
      title: `Series ${i} unemployment data`,
      surveyAbbr: 'LN',
      seasonal: true,
    }));
    const svc = makeService(many);
    const result = svc.search({
      query: 'unemployment',
      survey: undefined,
      area: undefined,
      seasonal_adjustment: undefined,
      limit: 5,
    });
    expect(result.series.length).toBeLessThanOrEqual(5);
    expect(result.total).toBeGreaterThan(5);
  });

  it('returns empty series when nothing matches', () => {
    const svc = makeService(FIXTURES);
    const result = svc.search({
      query: 'zzznomatchzzz',
      survey: undefined,
      area: undefined,
      seasonal_adjustment: undefined,
      limit: 10,
    });
    expect(result.series).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('filters by area name', () => {
    const svc = makeService(FIXTURES);
    const result = svc.search({
      query: 'unemployment',
      survey: undefined,
      area: 'United States',
      seasonal_adjustment: undefined,
      limit: 10,
    });
    // Only TEST_UNEMP_001 has areaName 'United States'
    expect(result.series.every((s) => s.areaName?.toLowerCase().includes('united states'))).toBe(
      true,
    );
  });

  it('area filter produces zero results when no entries match', () => {
    const svc = makeService(FIXTURES);
    const result = svc.search({
      query: 'unemployment',
      survey: undefined,
      area: 'zzznomatchregion',
      seasonal_adjustment: undefined,
      limit: 10,
    });
    expect(result.series).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('combines survey + seasonal filters correctly', () => {
    const svc = makeService(FIXTURES);
    // CU survey + not seasonally adjusted
    const result = svc.search({
      query: 'cpi',
      survey: 'CU',
      area: undefined,
      seasonal_adjustment: false,
      limit: 10,
    });
    expect(result.series.every((s) => s.surveyAbbr === 'CU' && !s.seasonal)).toBe(true);
  });

  it('scores common series higher than generic matches for known IDs', () => {
    // Add a common series and a non-common series with the same title keyword
    const withCommon: typeof FIXTURES = [
      {
        seriesId: 'LNS14000000',
        title: 'Unemployment Rate Seasonally Adjusted',
        surveyAbbr: 'LN',
        seasonal: true,
        areaName: 'United States',
      },
      {
        seriesId: 'TEST_OTHER_001',
        title: 'Unemployment Rate Other Area',
        surveyAbbr: 'LN',
        seasonal: false,
      },
    ];
    const svc = makeService(withCommon);
    const result = svc.search({
      query: 'unemployment rate',
      survey: undefined,
      area: undefined,
      seasonal_adjustment: undefined,
      limit: 10,
    });
    // LNS14000000 should appear first due to COMMON_SERIES boost
    expect(result.series[0]!.seriesId).toBe('LNS14000000');
  });

  it('isLoaded reflects the internal state', () => {
    const unloaded = new BlsCatalogService('http://unused', 'test-ua/1.0');
    expect(unloaded.isLoaded).toBe(false);

    const loaded = makeService(FIXTURES);
    expect(loaded.isLoaded).toBe(true);
  });

  it('totalSeries reflects index length', () => {
    const svc = makeService(FIXTURES);
    expect(svc.totalSeries).toBe(FIXTURES.length);
  });

  it('catalogLoadError is undefined when loaded successfully', () => {
    const svc = makeService(FIXTURES);
    expect(svc.catalogLoadError).toBeUndefined();
  });
});
