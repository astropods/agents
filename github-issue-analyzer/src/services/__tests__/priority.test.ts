import { describe, expect, it } from 'vitest';
import {
  EFFORTS,
  IMPACTS,
  SEVERITIES,
  TAXONOMY,
  computePriorityScore,
  isCategory,
} from '../priority';

describe('computePriorityScore', () => {
  it('scores the worst-case issue at 100 and the mildest at the floor', () => {
    expect(computePriorityScore({ severity: 'critical', impact: 'broad', effort: 'small' })).toBe(
      100,
    );
    const floor = computePriorityScore({ severity: 'low', impact: 'narrow', effort: 'large' });
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(20);
  });

  it('ranks higher severity above lower severity when impact and effort match', () => {
    const scores = SEVERITIES.map((severity) =>
      computePriorityScore({ severity, impact: 'moderate', effort: 'medium' }),
    );
    expect(scores, 'SEVERITIES is ordered worst-first, so scores must descend').toEqual(
      [...scores].sort((a, b) => b - a),
    );
    expect(new Set(scores).size, 'each severity must be distinguishable').toBe(SEVERITIES.length);
  });

  it('ranks broader impact above narrower impact when severity and effort match', () => {
    const scores = IMPACTS.map((impact) =>
      computePriorityScore({ severity: 'high', impact, effort: 'medium' }),
    );
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(IMPACTS.length);
  });

  it('ranks smaller effort above larger effort, so quick wins surface', () => {
    const small = computePriorityScore({ severity: 'medium', impact: 'moderate', effort: 'small' });
    const large = computePriorityScore({ severity: 'medium', impact: 'moderate', effort: 'large' });
    expect(small, 'effort is inverted in the score').toBeGreaterThan(large);
  });

  it('never lets effort outweigh severity', () => {
    const criticalButLarge = computePriorityScore({
      severity: 'critical',
      impact: 'broad',
      effort: 'large',
    });
    const lowButSmall = computePriorityScore({
      severity: 'low',
      impact: 'narrow',
      effort: 'small',
    });
    expect(criticalButLarge).toBeGreaterThan(lowButSmall);
  });

  it('returns an integer in 0-100 for every combination', () => {
    for (const severity of SEVERITIES) {
      for (const impact of IMPACTS) {
        for (const effort of EFFORTS) {
          const score = computePriorityScore({ severity, impact, effort });
          expect(
            Number.isInteger(score),
            `${severity}/${impact}/${effort} must be an integer`,
          ).toBe(true);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('falls back to the lowest weights when the model returns an unknown value', () => {
    const unknown = computePriorityScore({
      severity: 'catastrophic' as never,
      impact: 'everyone' as never,
      effort: 'epic' as never,
    });
    expect(unknown).toBe(
      computePriorityScore({ severity: 'low', impact: 'narrow', effort: 'large' }),
    );
  });
});

describe('isCategory', () => {
  it('accepts every taxonomy value', () => {
    for (const c of TAXONOMY) expect(isCategory(c)).toBe(true);
  });

  it('rejects the legacy free-text categories that motivated the taxonomy', () => {
    for (const c of ['front end', 'UI', 'back end', 'enhancement', 'good first issue']) {
      expect(isCategory(c), `${c} must not pass as a taxonomy value`).toBe(false);
    }
  });
});
