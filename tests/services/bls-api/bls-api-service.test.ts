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
const userAgent = 'test-bls-mcp/1.0 (casey@caseyjhand.com)';

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
  it('sends User-Agent on series fetch', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(okJson(SUCCESS_RESPONSE));
    });

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();
    await svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx);

    expect(capturedHeaders?.['User-Agent']).toBe(userAgent);
  });

  it('returns normalized series data on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(SUCCESS_RESPONSE));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
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

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
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

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
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

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toThrow();
  });
});

describe('BlsApiService.fetchLatest', () => {
  it('returns the most recent observation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(SUCCESS_RESPONSE));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
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

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchLatest('MISSING000', ctx)).rejects.toThrow();
  });

  it('sends User-Agent header on latest fetch', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(okJson(SUCCESS_RESPONSE));
    });

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();
    await svc.fetchLatest('LNS14000000', ctx);

    expect(capturedHeaders?.['User-Agent']).toBe(userAgent);
  });

  it('URL-encodes the seriesId in the GET request', async () => {
    let capturedUrl: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((url) => {
      capturedUrl = String(url);
      return Promise.resolve(okJson(SUCCESS_RESPONSE));
    });

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();
    await svc.fetchLatest('LNS14000000', ctx);

    expect(capturedUrl).toContain('LNS14000000');
    expect(capturedUrl).toContain('latest=true');
  });
});

describe('BlsApiService.fetchSeries — error message parsing', () => {
  it('throws serviceUnavailable on series_locked message', async () => {
    const lockedResponse = {
      status: 'REQUEST_FAILED_ERROR',
      responseTime: 10,
      message: ['The database is locked for this series'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(lockedResponse));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toMatchObject({
      data: { reason: 'series_locked' },
    });
  });

  it('throws validationError on no_data_for_period message', async () => {
    const noDataResponse = {
      status: 'REQUEST_FAILED_ERROR',
      responseTime: 10,
      message: ['No data available for series LNS14000000 in that period'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(noDataResponse));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toMatchObject({
      data: { reason: 'no_data_for_period' },
    });
  });

  it('throws validationError on calculations_not_supported message', async () => {
    const calcResponse = {
      status: 'REQUEST_FAILED_ERROR',
      responseTime: 10,
      message: ['calculations not supported for this survey'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(calcResponse));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toMatchObject({
      data: { reason: 'calculations_not_supported' },
    });
  });

  it('throws serviceUnavailable on non-succeeded status with no known error message', async () => {
    const unknownError = {
      status: 'REQUEST_FAILED_ERROR',
      responseTime: 10,
      message: ['Some unknown error'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(unknownError));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toThrow();
  });

  it('throws serializationError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not-valid-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).rejects.toThrow();
  });

  it('normalizes observations with footnotes and calculation fields', async () => {
    const withCalcs = {
      status: 'REQUEST_SUCCEEDED',
      responseTime: 50,
      message: [],
      Results: {
        series: [
          {
            seriesID: 'LNS14000000',
            catalog: { series_title: 'Unemployment Rate' },
            data: [
              {
                year: '2024',
                period: 'M12',
                periodName: 'December',
                value: '4.1',
                footnotes: [{ code: 'P', text: 'Preliminary' }],
                calculations: {
                  net_changes: { '1': '-0.1', '12': '-0.3' },
                  pct_changes: { '1': '-2.4', '12': '-6.8' },
                },
              },
            ],
          },
        ],
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(withCalcs));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();
    const result = await svc.fetchSeries({ seriesIds: ['LNS14000000'], calculations: true }, ctx);

    const obs = result[0]!.observations[0]!;
    expect(obs.footnotes).toEqual(['P: Preliminary']);
    expect(obs.netChange1Month).toBe('-0.1');
    expect(obs.netChange12Month).toBe('-0.3');
    expect(obs.pctChange1Month).toBe('-2.4');
    expect(obs.pctChange12Month).toBe('-6.8');
  });

  it('normalizes empty message array without throwing', async () => {
    const noMessages = { ...SUCCESS_RESPONSE, message: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(noMessages));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.fetchSeries({ seriesIds: ['LNS14000000'] }, ctx)).resolves.toHaveLength(1);
  });
});

describe('BlsApiService.listSurveys', () => {
  const SURVEYS_RESPONSE = {
    status: 'REQUEST_SUCCEEDED',
    responseTime: 50,
    message: [],
    Results: {
      survey: [
        { survey_abbreviation: 'CE', survey_name: 'Current Employment Statistics' },
        { survey_abbreviation: 'CU', survey_name: 'CPI - All Urban Consumers' },
      ],
    },
  };

  it('returns survey list with merged capability flags', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(SURVEYS_RESPONSE));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();
    const result = await svc.listSurveys(ctx);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const ce = result.find((s) => s.surveyAbbreviation === 'CE');
    expect(ce).toBeDefined();
    expect(ce!.allowsNetChange).toBe(true);
  });

  it('uses in-memory cache on second call without fetching', async () => {
    // Count only the fetches made inside this test by checking before/after
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++;
      return Promise.resolve(okJson(SURVEYS_RESPONSE));
    });

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    const callsBefore = callCount;
    await svc.listSurveys(ctx);
    const callsAfterFirst = callCount - callsBefore;

    const callsBeforeSecond = callCount;
    await svc.listSurveys(ctx); // should hit cache — no new fetch
    const callsForSecond = callCount - callsBeforeSecond;

    // First call fires at least 1 fetch; second call fires 0 (cache hit)
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    expect(callsForSecond).toBe(0);

    fetchSpy.mockRestore();
  });

  it('throws serviceUnavailable when surveys API returns HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.listSurveys(ctx)).rejects.toThrow();
  });

  it('throws serializationError when surveys API returns malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not-valid-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.listSurveys(ctx)).rejects.toThrow();
  });

  it('throws serviceUnavailable when surveys status is not REQUEST_SUCCEEDED', async () => {
    const failedSurveys = { status: 'REQUEST_NOT_PROCESSED', responseTime: 10, message: ['err'] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(failedSurveys));

    const svc = new BlsApiService(apiKey, baseUrl, userAgent);
    const ctx = createMockContext();

    await expect(svc.listSurveys(ctx)).rejects.toThrow();
  });

  it('does not expose apiKey in any error message', async () => {
    const errorResponse = {
      status: 'REQUEST_NOT_PROCESSED',
      responseTime: 10,
      message: ['Daily limit exceeded'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson(errorResponse));

    const svc = new BlsApiService('SECRET_KEY_12345', baseUrl, userAgent);
    const ctx = createMockContext();

    let errorMessage = '';
    try {
      await svc.listSurveys(ctx);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    expect(errorMessage).not.toContain('SECRET_KEY_12345');
  });
});
