import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options: unknown) => ({
    options,
    chat: { completions: { create: mockCreate } },
  })),
}));

import OpenAI from 'openai';
import {
  gatewayBaseUrl,
  gatewayClient,
  gatewayModel,
  modelFor,
  structuredCompletion,
  textCompletion,
} from '../models';

beforeEach(() => {
  vi.clearAllMocks();
  // stubEnv with undefined unsets the variable; assigning it would store "undefined".
  vi.stubEnv('MODEL_FAST', undefined);
  vi.stubEnv('MODEL_REASONING', undefined);
  vi.stubEnv('ASTRO_GATEWAY_URL', 'https://aig.test');
  vi.stubEnv('ASTRO_GATEWAY_API_KEY', 'gw-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('modelFor', () => {
  it('runs the high-volume tasks on the cheap tier', () => {
    for (const task of ['analysis', 'summary', 'judge'] as const) {
      expect(modelFor(task), `${task} must not pay for a reasoning model`).toBe('claude-haiku-4-5');
    }
  });

  it('runs the corpus-wide and conversational tasks on the reasoning tier', () => {
    expect(modelFor('vocabulary')).toBe('claude-sonnet-4-6');
    expect(modelFor('agent')).toBe('claude-sonnet-4-6');
  });

  it('keeps classification on a different, cheaper model than the agent', () => {
    expect(modelFor('analysis')).not.toBe(modelFor('agent'));
  });

  it('takes the deploy-time override for each tier', () => {
    vi.stubEnv('MODEL_FAST', 'nova-micro');
    vi.stubEnv('MODEL_REASONING', 'claude-opus-4-8');

    expect(modelFor('analysis')).toBe('nova-micro');
    expect(modelFor('agent')).toBe('claude-opus-4-8');
  });
});

describe('gatewayBaseUrl', () => {
  it('appends the version path the gateway serves', () => {
    expect(gatewayBaseUrl(), 'the bare host returns 404').toBe('https://aig.test/v1');
  });

  it('does not double the slash on a host that has one', () => {
    vi.stubEnv('ASTRO_GATEWAY_URL', 'https://aig.test/');

    expect(gatewayBaseUrl()).toBe('https://aig.test/v1');
  });

  it('names the missing variable instead of calling a broken URL', () => {
    vi.stubEnv('ASTRO_GATEWAY_URL', undefined);

    expect(() => gatewayBaseUrl()).toThrow('ASTRO_GATEWAY_URL is not set');
  });
});

describe('gatewayClient', () => {
  it('points the OpenAI SDK at the gateway', () => {
    gatewayClient();

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'gw-key',
      baseURL: 'https://aig.test/v1',
    });
  });

  it('names the missing key instead of sending an unauthenticated call', () => {
    vi.stubEnv('ASTRO_GATEWAY_API_KEY', undefined);

    expect(() => gatewayClient()).toThrow('ASTRO_GATEWAY_API_KEY is not set');
  });
});

describe('gatewayModel', () => {
  it('describes the gateway as an OpenAI-compatible provider for Mastra', () => {
    expect(gatewayModel('agent')).toEqual({
      providerId: 'astro-gateway',
      modelId: 'claude-sonnet-4-6',
      url: 'https://aig.test/v1',
      apiKey: 'gw-key',
    });
  });
});

describe('textCompletion', () => {
  it('sends the system and user turns and returns the text', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'a summary' } }] });

    const text = await textCompletion({ task: 'summary', system: 'be terse', prompt: 'go' });

    expect(text).toBe('a summary');
    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe('claude-haiku-4-5');
    expect(args.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'go' },
    ]);
  });

  it('returns null when the model answers with no content', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: {} }] });

    expect(await textCompletion({ task: 'summary', system: 's', prompt: 'p' })).toBeNull();
  });
});

describe('structuredCompletion', () => {
  const SCHEMA = {
    type: 'object',
    properties: { category: { type: 'string', enum: ['docs'] } },
    required: ['category'],
    additionalProperties: false,
  };

  function respondWith(args: string) {
    mockCreate.mockResolvedValueOnce({
      choices: [
        { message: { tool_calls: [{ function: { name: 'issue_analysis', arguments: args } }] } },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    });
  }

  it('carries the schema as a tool the model must call', async () => {
    respondWith('{"category":"docs"}');

    const { data } = await structuredCompletion<{ category: string }>({
      task: 'analysis',
      system: 's',
      prompt: 'p',
      name: 'issue_analysis',
      schema: SCHEMA,
    });

    expect(data).toEqual({ category: 'docs' });
    const args = mockCreate.mock.calls[0][0];
    expect(args.tools[0].function, 'the enum is enforced by the tool schema').toEqual({
      name: 'issue_analysis',
      parameters: SCHEMA,
    });
    expect(args.tool_choice, 'prose instead of JSON is not an option').toEqual({
      type: 'function',
      function: { name: 'issue_analysis' },
    });
    expect(args.response_format, 'Claude has no json_schema response format').toBeUndefined();
  });

  it('reports token usage for the caller to log', async () => {
    respondWith('{"category":"docs"}');

    const { tokenUsage } = await structuredCompletion({
      task: 'analysis',
      system: 's',
      prompt: 'p',
      name: 'issue_analysis',
      schema: SCHEMA,
    });

    expect(tokenUsage).toEqual({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 });
  });

  it('names the call when the model answers without one', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'sure, here goes' } }] });

    await expect(
      structuredCompletion({
        task: 'analysis',
        system: 's',
        prompt: 'p',
        name: 'issue_analysis',
        schema: SCHEMA,
      }),
    ).rejects.toThrow('issue_analysis: the model returned no tool call');
  });
});
