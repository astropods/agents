import { describe, expect, it } from 'vitest';
import { type LiveIssue, findDrift } from '../issue-state';

function live(entries: [number, string, string | null][]): Map<number, LiveIssue> {
  return new Map(
    entries.map(([number, state, closedAt]) => [
      number,
      { number, state, closedAt, updatedAt: '2026-09-12T00:00:00Z' },
    ]),
  );
}

describe('findDrift', () => {
  it('reports an issue the graph still calls open after it was closed', () => {
    const drift = findDrift(
      [{ number: 1378, state: 'OPEN' }],
      live([[1378, 'CLOSED', '2026-09-12T22:53:06Z']]),
    );

    expect(drift).toEqual([
      {
        number: 1378,
        storedState: 'OPEN',
        liveState: 'CLOSED',
        closedAt: '2026-09-12T22:53:06Z',
      },
    ]);
  });

  it('reports a reopened issue, not just closures', () => {
    const drift = findDrift([{ number: 7, state: 'CLOSED' }], live([[7, 'OPEN', null]]));

    expect(drift[0], 'drift is bidirectional').toMatchObject({
      storedState: 'CLOSED',
      liveState: 'OPEN',
      closedAt: null,
    });
  });

  it('is empty when every state agrees', () => {
    const drift = findDrift(
      [
        { number: 1, state: 'OPEN' },
        { number: 2, state: 'CLOSED' },
      ],
      live([
        [1, 'OPEN', null],
        [2, 'CLOSED', '2026-09-01T00:00:00Z'],
      ]),
    );

    expect(drift).toEqual([]);
  });

  it('ignores an issue GitHub did not resolve rather than guessing it closed', () => {
    const drift = findDrift(
      [
        { number: 1, state: 'OPEN' },
        { number: 999, state: 'OPEN' },
      ],
      live([[1, 'OPEN', null]]),
    );

    expect(drift, 'a missing lookup must never be read as a state change').toEqual([]);
  });

  it('picks out only the drifting rows from a mixed set', () => {
    const drift = findDrift(
      [
        { number: 1, state: 'OPEN' },
        { number: 2, state: 'OPEN' },
        { number: 3, state: 'OPEN' },
      ],
      live([
        [1, 'OPEN', null],
        [2, 'CLOSED', '2026-09-10T00:00:00Z'],
        [3, 'OPEN', null],
      ]),
    );

    expect(drift.map((d) => d.number)).toEqual([2]);
  });
});
