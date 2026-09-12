import { describe, expect, it } from 'vitest';
import { buildInstructions } from '../instructions';

describe('buildInstructions', () => {
  it('includes the owner and repo in the issue link template', () => {
    const instructions = buildInstructions('astropods', 'agents');

    expect(instructions, 'issue link template must carry the full owner/repo path').toContain(
      'https://github.com/astropods/agents/issues/<number>',
    );
  });

  it('names the configured repository so the agent knows what it is serving', () => {
    const instructions = buildInstructions('astropods', 'agents');

    expect(instructions).toContain('The configured repository is astropods/agents');
  });

  it('never emits a github.com URL missing the owner or repo segment', () => {
    const instructions = buildInstructions('astropods', 'agents');

    expect(
      instructions,
      'a bare github.com/issues path is the bug this guards against',
    ).not.toMatch(/github\.com\/issues/);
  });

  it('forbids building URLs when owner and repo are unset', () => {
    const instructions = buildInstructions(undefined, undefined);

    expect(instructions).toContain('Do NOT construct');
    expect(instructions).not.toMatch(/github\.com\/[^\s)]*issues/);
  });

  it('forbids building URLs when only one of owner or repo is set', () => {
    expect(buildInstructions('astropods', undefined)).toContain('Do NOT construct');
    expect(buildInstructions(undefined, 'agents')).toContain('Do NOT construct');
  });

  it('keeps the graph schema in the prompt regardless of repo configuration', () => {
    for (const instructions of [
      buildInstructions('astropods', 'agents'),
      buildInstructions(undefined, undefined),
    ]) {
      expect(instructions).toContain('(Issue)-[:HAS_COMMENT]->(Comment)');
      expect(instructions).toContain('# Database Schema');
    }
  });
});
