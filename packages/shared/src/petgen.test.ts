import { describe, expect, it } from 'vitest';
import { parseStoredQcResult } from './petgen.js';

describe('persisted petgen QC contract', () => {
  it('accepts a partial sheet result and rejects malformed status or verdicts', () => {
    expect(parseStoredQcResult(JSON.stringify({ idle: { pass: true, issues: [] } })))
      .toEqual({ idle: { pass: true, issues: [] } });
    expect(() => parseStoredQcResult('{"idle":{"pass":"yes","issues":[]}}')).toThrow();
    expect(() => parseStoredQcResult('{"unexpected":{"pass":true,"issues":[]}}')).toThrow();
  });
});
