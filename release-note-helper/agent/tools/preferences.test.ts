import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/preferences-store', () => ({
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
}));

import { loadPreferencesTool, savePreferencesTool } from './preferences';
import {
  loadPreferences,
  savePreferences,
} from '../../src/preferences-store';

const mockLoad = vi.mocked(loadPreferences);
const mockSave = vi.mocked(savePreferences);

describe('loadPreferencesTool', () => {
  it('returns found=true when preferences exist', async () => {
    mockLoad.mockResolvedValueOnce({
      defaultProject: 'PROJ',
      githubOwner: 'org',
    });

    const result = await loadPreferencesTool.execute!(
      { userId: 'user-1' } as any,
      {} as any,
      {} as any,
    );

    expect(result.found).toBe(true);
    expect(result.defaultProject).toBe('PROJ');
    expect(mockLoad).toHaveBeenCalledWith('user-1');
  });

  it('returns found=false when preferences are empty', async () => {
    mockLoad.mockResolvedValueOnce({});

    const result = await loadPreferencesTool.execute!(
      { userId: 'new-user' } as any,
      {} as any,
      {} as any,
    );

    expect(result.found).toBe(false);
  });
});

describe('savePreferencesTool', () => {
  it('returns success on save', async () => {
    mockSave.mockResolvedValueOnce(undefined);

    const result = await savePreferencesTool.execute!(
      {
        userId: 'user-1',
        preferences: { defaultProject: 'NEW' },
      } as any,
      {} as any,
      {} as any,
    );

    expect(result).toEqual({ success: true });
    expect(mockSave).toHaveBeenCalledWith('user-1', { defaultProject: 'NEW' });
  });

  it('returns error envelope on failure', async () => {
    mockSave.mockRejectedValueOnce(new Error('Redis down'));

    const result = await savePreferencesTool.execute!(
      {
        userId: 'user-1',
        preferences: { defaultProject: 'X' },
      } as any,
      {} as any,
      {} as any,
    );

    expect(result).toEqual({ success: false, error: 'Redis down' });
  });
});
