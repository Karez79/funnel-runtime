import { describe, expect, it } from 'vitest';
import { codeForStatus, DomainError, ErrorBody } from './errors.ts';

describe('codeForStatus', () => {
  it('inverts the status of every domain code', () => {
    // Every code has its own status, so a client can recover the code from the status.
    for (const code of ErrorBody.shape.error.shape.code.options) {
      expect(codeForStatus(new DomainError(code, 'x').status)).toBe(code);
    }
  });

  it('reports other 5xx as unavailable and other statuses as invalid_request', () => {
    expect(codeForStatus(502)).toBe('unavailable');
    expect(codeForStatus(504)).toBe('unavailable');
    expect(codeForStatus(418)).toBe('invalid_request');
  });
});
