/**
 * Issue taxonomy and priority scoring.
 *
 * The model returns categorical judgments only; the numeric score is derived
 * here so ranking stays reproducible and comparable across issues.
 */

export const TAXONOMY = [
  'frontend',
  'backend',
  'cli',
  'infra',
  'docs',
  'security',
  'observability',
  'tooling',
  'other',
] as const;

export type Category = (typeof TAXONOMY)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const IMPACTS = ['broad', 'moderate', 'narrow'] as const;
export const EFFORTS = ['small', 'medium', 'large'] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Impact = (typeof IMPACTS)[number];
export type Effort = (typeof EFFORTS)[number];

export interface PriorityJudgment {
  severity: Severity;
  impact: Impact;
  effort: Effort;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1.0,
  high: 0.7,
  medium: 0.4,
  low: 0.15,
};

const IMPACT_WEIGHT: Record<Impact, number> = {
  broad: 1.0,
  moderate: 0.55,
  narrow: 0.2,
};

// Inverted: less effort scores higher, so quick wins rise.
const EFFORT_WEIGHT: Record<Effort, number> = {
  small: 1.0,
  medium: 0.5,
  large: 0.15,
};

const SEVERITY_POINTS = 50;
const IMPACT_POINTS = 30;
const EFFORT_POINTS = 20;

/** Returns a 0-100 priority score. Higher ranks first. */
export function computePriorityScore(judgment: PriorityJudgment): number {
  const severity = SEVERITY_WEIGHT[judgment.severity] ?? SEVERITY_WEIGHT.low;
  const impact = IMPACT_WEIGHT[judgment.impact] ?? IMPACT_WEIGHT.narrow;
  const effort = EFFORT_WEIGHT[judgment.effort] ?? EFFORT_WEIGHT.large;

  return Math.round(severity * SEVERITY_POINTS + impact * IMPACT_POINTS + effort * EFFORT_POINTS);
}

export function isCategory(value: string): value is Category {
  return (TAXONOMY as readonly string[]).includes(value);
}
