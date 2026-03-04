import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  loadPreferences as load,
  savePreferences as save,
  type UserPreferences,
} from '../../src/preferences-store';

const preferencesSchema = z.object({
  defaultProject: z.string().optional().describe('Default Jira project key'),
  githubOwner: z.string().optional().describe('Default GitHub org/owner'),
  githubRepo: z.string().optional().describe('Default GitHub repo name'),
  selectionCriteria: z.string().optional().describe(
    'Criteria for selecting release-note-worthy issues, e.g. "Include bug fixes and new features, skip internal refactors and chores"',
  ),
  releaseNoteExample: z.string().optional().describe(
    'An example release note the user provided to use as a formatting reference',
  ),
});

export const loadPreferencesTool = createTool({
  id: 'loadPreferences',
  description:
    'Load the stored preferences for a user. Call this at the start of every conversation ' +
    'to restore their defaults (project, GitHub repo, selection criteria, release note format).',
  inputSchema: z.object({
    userId: z.string().describe('Unique user identifier'),
  }),
  outputSchema: preferencesSchema.extend({
    found: z.boolean().describe('Whether preferences existed for this user'),
  }),
  execute: async (input) => {
    const prefs = await load(input.userId);
    const found = Object.keys(prefs).length > 0;
    return { ...prefs, found };
  },
});

export const savePreferencesTool = createTool({
  id: 'savePreferences',
  description:
    'Save or update preferences for a user. Only include the fields you want to update — ' +
    'existing fields are preserved. Use this after onboarding, when the user provides a release ' +
    'note example, or when they adjust selection criteria.',
  inputSchema: z.object({
    userId: z.string().describe('Unique user identifier'),
    preferences: preferencesSchema.describe('Preference fields to set or update'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await save(input.userId, input.preferences as UserPreferences);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },
});
