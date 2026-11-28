import { describe, expect, it } from 'vitest';

import { runWithBoundedReminderRetries } from './reminders.js';

describe('bounded reminder scheduler retries', () => {
  it('retries transient errors with bounded exponential waits', async () => {
    let attempts = 0;
    const waits: number[] = [];
    const result = await runWithBoundedReminderRetries(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'scheduled';
    }, async (milliseconds) => { waits.push(milliseconds); });

    expect(result).toBe('scheduled');
    expect(attempts).toBe(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it('stops after three failed attempts', async () => {
    let attempts = 0;
    await expect(runWithBoundedReminderRetries(async () => {
      attempts += 1;
      throw new Error('database unavailable');
    }, async () => {})).rejects.toThrow('database unavailable');
    expect(attempts).toBe(3);
  });
});
