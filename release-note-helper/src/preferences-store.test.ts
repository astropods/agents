import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockOn = vi.fn();

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    on: mockOn,
  })),
}));

import { loadPreferences, savePreferences } from './preferences-store';

describe('preferences-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
  });

  afterEach(() => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
  });

  describe('loadPreferences', () => {
    it('returns empty defaults when no data stored', async () => {
      mockGet.mockResolvedValueOnce(null);

      const prefs = await loadPreferences('user-1');

      expect(prefs).toEqual({});
      expect(mockGet).toHaveBeenCalledWith('prefs:user-1');
    });

    it('parses stored JSON preferences', async () => {
      const stored = {
        defaultProject: 'PROJ',
        githubOwner: 'org',
        githubRepo: 'repo',
        selectionCriteria: 'Include bugs and features',
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(stored));

      const prefs = await loadPreferences('user-2');

      expect(prefs).toEqual(stored);
    });

    it('returns defaults on Redis error', async () => {
      mockGet.mockRejectedValueOnce(new Error('Connection refused'));

      const prefs = await loadPreferences('user-3');

      expect(prefs).toEqual({});
    });
  });

  describe('savePreferences', () => {
    it('merges with existing preferences', async () => {
      const existing = { defaultProject: 'OLD', githubOwner: 'org' };
      mockGet.mockResolvedValueOnce(JSON.stringify(existing));
      mockSet.mockResolvedValueOnce('OK');

      await savePreferences('user-1', { defaultProject: 'NEW' });

      expect(mockSet).toHaveBeenCalledWith(
        'prefs:user-1',
        JSON.stringify({ defaultProject: 'NEW', githubOwner: 'org' }),
      );
    });

    it('creates new preferences when none exist', async () => {
      mockGet.mockResolvedValueOnce(null);
      mockSet.mockResolvedValueOnce('OK');

      await savePreferences('user-new', {
        defaultProject: 'PROJ',
        selectionCriteria: 'Include all',
      });

      expect(mockSet).toHaveBeenCalledWith(
        'prefs:user-new',
        JSON.stringify({ defaultProject: 'PROJ', selectionCriteria: 'Include all' }),
      );
    });

    it('throws on Redis write failure', async () => {
      mockGet.mockResolvedValueOnce(null);
      mockSet.mockRejectedValueOnce(new Error('Write failed'));

      await expect(
        savePreferences('user-1', { defaultProject: 'X' }),
      ).rejects.toThrow('Write failed');
    });
  });
});
