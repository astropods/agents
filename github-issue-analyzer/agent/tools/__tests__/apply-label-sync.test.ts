import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelPlan, SyncResult } from '../../../src/services/github-labels';

const { syncLabels } = vi.hoisted(() => ({ syncLabels: vi.fn() }));

vi.mock('../../../src/services/github-labels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/github-labels')>()),
  syncLabels,
}));

import { applyLabelSyncTool } from '../apply-label-sync';

type ApplyResult = {
  applied: number;
  issuesChanged: number;
  labelsCreated: string[];
  labelsDeleted: string[];
  confirmed: boolean;
  errors: string[];
  message: string;
};

const suspend = vi.fn();

function ctxWith(resumeData?: { confirm: boolean }) {
  return { agent: { suspend, resumeData } } as unknown as Parameters<
    NonNullable<typeof applyLabelSyncTool.execute>
  >[1];
}

const PLAN: LabelPlan[] = [{ issueNumber: 1, add: ['area/backend'], remove: [] }];

function result(over: Partial<SyncResult> = {}): SyncResult {
  return {
    planned: [],
    labelsCreated: [],
    labelsDeleted: [],
    applied: 0,
    remaining: 0,
    dryRun: true,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_OWNER = 'acme';
  process.env.GITHUB_REPO = 'widgets';
  syncLabels.mockResolvedValue(result({ planned: PLAN }));
});

describe('applyLabelSyncTool', () => {
  it('suspends for confirmation and writes nothing on the first call', async () => {
    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(suspend, 'the user must be asked before any write').toHaveBeenCalledTimes(1);
    expect(syncLabels.mock.calls[0][0].dryRun, 'the pre-confirmation plan must be a dry run').toBe(
      true,
    );
    expect(apply.confirmed).toBe(false);
    expect(apply.applied).toBe(0);
  });

  it('puts the diff in front of the user in the suspend payload', async () => {
    await applyLabelSyncTool.execute!({}, ctxWith());

    const payload = suspend.mock.calls[0][0];
    expect(payload.message, 'the adapter surfaces payload.message as the prompt').toContain(
      'acme/widgets',
    );
    expect(payload.message).toContain('#1');
    expect(payload.message).toContain('+area/backend');
    expect(payload.issuesChanged).toBe(1);
  });

  it('lists only the labels that do not exist on the repo yet', async () => {
    syncLabels.mockResolvedValue(result({ planned: PLAN, labelsCreated: [], labelsDeleted: [] }));

    await applyLabelSyncTool.execute!({}, ctxWith());

    const payload = suspend.mock.calls[0][0];
    expect(
      payload.message,
      'area/backend is in the plan but already exists, so nothing is created',
    ).not.toContain('New labels to create');
    expect(payload.labelsToCreate).toEqual([]);
  });

  it('names the labels the write would create', async () => {
    syncLabels.mockResolvedValue(result({ planned: PLAN, labelsCreated: ['area/backend'] }));

    await applyLabelSyncTool.execute!({}, ctxWith());

    const payload = suspend.mock.calls[0][0];
    expect(payload.message).toContain('New labels to create: area/backend');
    expect(payload.labelsToCreate).toEqual(['area/backend']);
  });

  it('names the unused labels the write would delete', async () => {
    syncLabels.mockResolvedValue(result({ planned: PLAN, labelsDeleted: ['area/legacy'] }));

    await applyLabelSyncTool.execute!({}, ctxWith());

    const payload = suspend.mock.calls[0][0];
    expect(payload.message).toContain('Unused labels to delete: area/legacy');
    expect(payload.labelsToDelete).toEqual(['area/legacy']);
  });

  it('still confirms when a cleanup is the only pending change', async () => {
    syncLabels.mockResolvedValue(result({ planned: [], labelsDeleted: ['area/legacy'] }));

    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(suspend, 'an orphan left by an earlier run must still be offered').toHaveBeenCalledTimes(
      1,
    );
    expect(suspend.mock.calls[0][0].message).toContain('delete 1 unused labels');
    expect(apply.confirmed).toBe(false);
  });

  it('writes nothing when the user declines', async () => {
    const apply = (await applyLabelSyncTool.execute!(
      {},
      ctxWith({ confirm: false }),
    )) as ApplyResult;

    expect(syncLabels).not.toHaveBeenCalled();
    expect(suspend, 'a decline must not re-prompt').not.toHaveBeenCalled();
    expect(apply.confirmed).toBe(false);
    expect(apply.message).toContain('Cancelled');
  });

  it('writes only after an explicit confirm', async () => {
    syncLabels.mockResolvedValue(
      result({
        planned: PLAN,
        labelsCreated: ['area/backend'],
        labelsDeleted: ['area/legacy'],
        applied: 1,
        dryRun: false,
      }),
    );

    const apply = (await applyLabelSyncTool.execute!(
      {},
      ctxWith({ confirm: true }),
    )) as ApplyResult;

    expect(syncLabels).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', dryRun: false });
    expect(apply.confirmed).toBe(true);
    expect(apply.applied).toBe(1);
    expect(apply.labelsCreated).toEqual(['area/backend']);
    expect(apply.labelsDeleted, 'the user sees what cleanup removed').toEqual(['area/legacy']);
  });

  it('re-plans on confirm rather than trusting the pre-suspension diff', async () => {
    syncLabels.mockResolvedValue(result({ dryRun: false }));

    await applyLabelSyncTool.execute!({}, ctxWith({ confirm: true }));

    expect(
      syncLabels.mock.calls[0][0].dryRun,
      'the write path recomputes instead of replaying a stale plan',
    ).toBe(false);
  });

  it('does not suspend when the labels already match', async () => {
    syncLabels.mockResolvedValue(result());

    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(suspend, 'no diff means nothing to confirm').not.toHaveBeenCalled();
    expect(apply.message).toContain('already match');
  });

  it('confirms only the requested chunk and says how many remain', async () => {
    const two = [
      { issueNumber: 1, add: ['area/backend'], remove: [] },
      { issueNumber: 2, add: ['area/docs'], remove: [] },
    ];
    syncLabels.mockResolvedValue(result({ planned: two, remaining: 1 }));

    const apply = (await applyLabelSyncTool.execute!({ limit: 2 }, ctxWith())) as ApplyResult;

    expect(apply.issuesChanged, 'only the chunk is offered').toBe(2);
    const payload = suspend.mock.calls[0][0];
    expect(payload.message).toContain('2 issues');
    expect(payload.message, 'the user must know a chunk is not the whole job').toContain(
      '1 more issues still differ',
    );
    expect(payload.message).not.toContain('#3');
  });

  it('does not mention remaining work when the chunk is the whole plan', async () => {
    await applyLabelSyncTool.execute!({}, ctxWith());

    expect(suspend.mock.calls[0][0].message).not.toContain('still differ');
  });

  it('passes the scope through to the write so it matches what was confirmed', async () => {
    syncLabels.mockResolvedValue(result({ applied: 2, dryRun: false }));

    await applyLabelSyncTool.execute!(
      { limit: 2, category: 'security' },
      ctxWith({ confirm: true }),
    );

    expect(syncLabels).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      dryRun: false,
      limit: 2,
      category: 'security',
    });
  });

  it('scopes the preview exactly as it scopes the write', async () => {
    await applyLabelSyncTool.execute!({ limit: 2, category: 'security' }, ctxWith());

    expect(syncLabels).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      dryRun: true,
      limit: 2,
      category: 'security',
    });
  });

  it('reports an empty graph instead of suspending', async () => {
    syncLabels.mockResolvedValue(result({ errors: ['no classified issues in the graph yet'] }));

    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(suspend).not.toHaveBeenCalled();
    expect(apply.message).toContain('no classified issues in the graph yet');
  });

  it('reports a planning failure instead of suspending on a partial diff', async () => {
    syncLabels.mockRejectedValue(new Error('list issues failed: HTTP 500'));

    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(suspend, 'an unreliable diff is not worth confirming').not.toHaveBeenCalled();
    expect(apply.errors).toEqual(['list issues failed: HTTP 500']);
    expect(apply.applied).toBe(0);
  });

  it('reports a missing repo instead of guessing one', async () => {
    process.env.GITHUB_OWNER = '';
    process.env.GITHUB_REPO = '';

    const apply = (await applyLabelSyncTool.execute!({}, ctxWith())) as ApplyResult;

    expect(syncLabels).not.toHaveBeenCalled();
    expect(apply.errors[0]).toContain('GITHUB_OWNER');
  });
});
