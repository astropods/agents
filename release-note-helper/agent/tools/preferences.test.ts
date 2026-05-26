import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/preferences-store', () => ({
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
}));

import { loadPreferences, savePreferences } from '../../src/preferences-store';
import { loadPreferencesTool, savePreferencesTool } from './preferences';

const mockLoad = vi.mocked(loadPreferences);
const mockSave = vi.mocked(savePreferences);

const loadCtx = {} as Parameters<NonNullable<typeof loadPreferencesTool.execute>>[1];
const saveCtx = {} as Parameters<NonNullable<typeof savePreferencesTool.execute>>[1];

type LoadResult = {
  found: boolean;
  defaultProject?: string;
  githubOwner?: string;
  githubRepo?: string;
  selectionCriteria?: string;
  releaseNoteExample?: string;
};

type SaveResult = {
  success: boolean;
  error?: string;
};

describe('loadPreferencesTool', () => {
  it('returns found=true when preferences exist', async () => {
    mockLoad.mockResolvedValueOnce({
      defaultProject: 'PROJ',
      githubOwner: 'org',
    });

    const result = (await loadPreferencesTool.execute!(
      { userId: 'user-1' },
      loadCtx,
    )) as LoadResult;

    expect(result.found).toBe(true);
    expect(result.defaultProject).toBe('PROJ');
    expect(mockLoad).toHaveBeenCalledWith('user-1');
  });

  it('returns found=false when preferences are empty', async () => {
    mockLoad.mockResolvedValueOnce({});

    const result = (await loadPreferencesTool.execute!(
      { userId: 'new-user' },
      loadCtx,
    )) as LoadResult;

    expect(result.found).toBe(false);
  });
});

describe('savePreferencesTool', () => {
  it('returns success on save', async () => {
    mockSave.mockResolvedValueOnce(undefined);

    const result = (await savePreferencesTool.execute!(
      { userId: 'user-1', preferences: { defaultProject: 'NEW' } },
      saveCtx,
    )) as SaveResult;

    expect(result).toEqual({ success: true });
    expect(mockSave).toHaveBeenCalledWith('user-1', { defaultProject: 'NEW' });
  });

  it('returns error envelope on failure', async () => {
    mockSave.mockRejectedValueOnce(new Error('Redis down'));

    const result = (await savePreferencesTool.execute!(
      { userId: 'user-1', preferences: { defaultProject: 'X' } },
      saveCtx,
    )) as SaveResult;

    expect(result).toEqual({ success: false, error: 'Redis down' });
  });
});
