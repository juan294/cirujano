import { describe, expect, it } from 'vitest';

import { VERSION, summarizeBillableMinutes } from '@cirujano/core';

describe('@cirujano/core public surface', () => {
  it('exposes the package version and the billing entry point', () => {
    expect(VERSION).toBe('0.0.1');
    expect(summarizeBillableMinutes([])).toEqual({ billableMinutes: 0, measuredJobs: 0, skippedJobs: 0 });
  });
});
