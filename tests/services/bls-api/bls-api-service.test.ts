/**
 * @fileoverview Tests for BlsApiService — quota handling and series-not-found parsing.
 * @module tests/services/bls-api/bls-api-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BlsApiService } from '@/services/bls-api/bls-api-service.js';

// Bypass withRetry to keep tests fast — we test the parsing logic, not retry behavior
vi.mock('@cyanheads/mcp-ts-core/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('@cyanheads/mcp-ts-core/utils')>();
  return {
    ...original,
    withRetry: (fn: () => Promise<unknown>) => fn(),
  };
});

const apiKey = 'test-key';
const baseUrl = 'https://api.bls.gov/publicAPI/v2';

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUCCESS_RESPONSE = {
  status: 'REQUEST_SUCCEEDED',
  responseTime: 50,
  message: [],
  Results: {
    series: [
      {
        seriesID: 'LNS14000000',
        catalog: {
          series_title: 'Unemployment Rate',
          seasonality: 'Seasonally Adjusted',
        },
        data: [
          { year: '2024', period: 'M12', periodName: 'December', value: '4.1', footnotes: [] },
        ],
      },
    ],
  },
};

describe('BlsApiService.fetchSeries', () => {
  it('returns normalized series data on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(SUCCESS_RESPONSE));

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();
    const result = await svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0]!.seriesId).toBe('LNS14000000');
    expect(result[0]!.title).toBe('Unemployment Rate');
    expect(result[0]!.observations[0]!.value).toBe('4.1');
  });

  it('throws serviceUnavailable on quota_exceeded (REQUEST_NOT_PROCESSED)', async () => {
    const quotaResponse = {
      status: 'REQUEST_NOT_PROCESSED',
      responseTime: 10,
      message: ['500 queries per day limit exceeded'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(quotaResponse));

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toMatchObject({
      data: { reason: 'quota_exceeded' },
    });
  });

  it('throws notFound on series_not_found message', async () => {
    const notFoundResponse = {
      status: 'REQUEST_FAILED_ERROR',
      responseTime: 10,
      message: ['Series LNS99999999 does not exist'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(notFoundResponse));

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS99999999'] }, ctx)).rejects.toMatchObject({
      data: { reason: 'series_not_found' },
    });
  });

  it('throws serviceUnavailable when API returns HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><body>Error</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toThrow();
  });
});

describe('BlsApiService.fetchLatest', () => {
  it('returns the most recent observation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(SUCCESS_RESPONSE));

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();
    const result = await svc.fetchLatest('LNS14000000', ctx);

    expect(result.seriesId).toBe('LNS14000000');
    expect(result.observations).toHaveLength(1);
  });

  it('throws when series is absent from response', async () => {
    const emptyResponse = {
      status: 'REQUEST_SUCCEEDED',
      responseTime: 10,
      message: [],
      Results: { series: [] },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(emptyResponse));

    const svc = new BlsApiService(apiKey, baseUrl);
    const ctx = createMockContext();

    await expect(svc.fetchLatest('MISSING000', ctx)).rejects.toThrow();
  });
});
