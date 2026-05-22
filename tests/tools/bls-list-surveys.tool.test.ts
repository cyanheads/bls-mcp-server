/**
 * @fileoverview Tests for bls_list_surveys tool.
 * @module tests/tools/bls-list-surveys.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { blsListSurveysTool } from '@/mcp-server/tools/definitions/bls-list-surveys.tool.js';

const MOCK_SURVEYS = [
  {
    surveyAbbreviation: 'CE',
    surveyName: 'Current Employment Statistics',
    allowsNetChange: true,
    allowsPercentChange: true,
    hasAnnualAverages: true,
  },
  {
    surveyAbbreviation: 'CU',
    surveyName: 'CPI - All Urban Consumers',
    allowsNetChange: false,
    allowsPercentChange: true,
    hasAnnualAverages: false,
  },
  {
    surveyAbbreviation: 'LN',
    surveyName: 'CPS - Labor Force Statistics',
    allowsNetChange: false,
    allowsPercentChange: false,
    hasAnnualAverages: false,
  },
];

vi.mock('@/services/bls-api/bls-api-service.js', () => ({
  getBlsApiService: () => ({
    listSurveys: vi.fn().mockResolvedValue(MOCK_SURVEYS),
  }),
}));

describe('blsListSurveysTool', () => {
  it('returns all surveys when no category filter is given', async () => {
    const ctx = createMockContext();
    const input = blsListSurveysTool.input.parse({});
    const result = await blsListSurveysTool.handler(input, ctx);

    expect(result.total).toBe(3);
    expect(result.surveys).toHaveLength(3);
    // Sorted alphabetically
    expect(result.surveys[0]!.abbreviation).toBe('CE');
  });

  it('filters by employment category', async () => {
    const ctx = createMockContext();
    const input = blsListSurveysTool.input.parse({ category: 'employment' });
    const result = await blsListSurveysTool.handler(input, ctx);

    // CE and LN are in the employment category map
    expect(result.surveys.every((s) => ['CE', 'LN'].includes(s.abbreviation))).toBe(true);
  });

  it('formats output with abbreviation and capability flags', () => {
    const output = {
      surveys: [
        {
          abbreviation: 'CE',
          name: 'Current Employment Statistics',
          allowsNetChange: true,
          allowsPercentChange: true,
          hasAnnualAverages: true,
        },
      ],
      total: 1,
    };
    const blocks = blsListSurveysTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('CE');
    expect(text).toContain('net change');
  });
});
