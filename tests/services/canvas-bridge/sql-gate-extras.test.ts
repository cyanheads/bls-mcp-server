/**
 * @fileoverview Tests for SQL gate extras — system-catalog denial and string literal stripping.
 * @module tests/services/canvas-bridge/sql-gate-extras.test
 */

import { describe, expect, it } from 'vitest';
import { assertNoSystemCatalogAccess } from '@/services/canvas-bridge/sql-gate-extras.js';

describe('assertNoSystemCatalogAccess', () => {
  it('allows a plain SELECT against a df_ table', () => {
    expect(() =>
      assertNoSystemCatalogAccess(
        "SELECT series_id, value FROM df_AAAAA_BBBBB WHERE year >= '2020'",
      ),
    ).not.toThrow();
  });

  it('allows a SELECT with JOIN between two df_ tables', () => {
    expect(() =>
      assertNoSystemCatalogAccess(
        'SELECT a.series_id, b.value FROM df_AAAAA_BBBBB a JOIN df_CCCCC_DDDDD b ON a.series_id = b.series_id',
      ),
    ).not.toThrow();
  });

  it('allows a CTE query', () => {
    expect(() =>
      assertNoSystemCatalogAccess(
        'WITH ranked AS (SELECT *, ROW_NUMBER() OVER () AS rn FROM df_AAAAA_BBBBB) SELECT * FROM ranked',
      ),
    ).not.toThrow();
  });

  it('denies information_schema', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM information_schema.tables')).toThrow();
  });

  it('denies pg_catalog', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM pg_catalog.pg_tables')).toThrow();
  });

  it('denies sqlite_master', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM sqlite_master')).toThrow();
  });

  it('denies duckdb_ system table', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM duckdb_tables()')).toThrow();
  });

  it('denies duckdb_columns system table', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM duckdb_columns')).toThrow();
  });

  it('returns a ValidationError with system_catalog_access reason', () => {
    let err: unknown;
    try {
      assertNoSystemCatalogAccess('SELECT * FROM information_schema.tables');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      data: { reason: 'system_catalog_access' },
    });
  });

  it('does not block system catalog name inside a string literal', () => {
    // The string literal 'information_schema' should be stripped before matching
    expect(() =>
      assertNoSystemCatalogAccess("SELECT 'information_schema' AS label FROM df_AAAAA_BBBBB"),
    ).not.toThrow();
  });

  it('does not block duckdb_ inside a quoted identifier that is really a column alias', () => {
    // Double-quoted identifier: "duckdb_test" as alias → stripped → no match
    expect(() =>
      assertNoSystemCatalogAccess('SELECT value AS "duckdb_alias" FROM df_AAAAA_BBBBB'),
    ).not.toThrow();
  });

  it('is case-insensitive for information_schema', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM INFORMATION_SCHEMA.TABLES')).toThrow();
  });

  it('denies duckdb_ with mixed case', () => {
    expect(() => assertNoSystemCatalogAccess('SELECT * FROM DuckDB_Tables()')).toThrow();
  });

  // Security: injection attempt — verifies the gate catches catalog-enumeration attempts
  it('rejects a SQL injection attempt targeting information_schema', () => {
    expect(() =>
      assertNoSystemCatalogAccess(
        'SELECT * FROM df_AAAAA; SELECT table_name FROM information_schema.tables; --',
      ),
    ).toThrow();
  });
});
