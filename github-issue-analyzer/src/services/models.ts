/**
 * Model access through the Astropods AI gateway.
 *
 * The gateway is OpenAI-API-compatible, so the OpenAI SDK reaches Claude with
 * nothing but a different base URL and key. ASTRO_GATEWAY_URL and
 * ASTRO_GATEWAY_API_KEY are injected by `ast dev` and by the platform at
 * deploy time. Model IDs on this path are bare names, such as
 * claude-haiku-4-5, and the bare gateway host without /v1 returns 404.
 *
 * Every model choice in the project resolves here, so the cost profile of the
 * whole agent is readable in one place.
 */

import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';

type Tier = 'fast' | 'reasoning';

const DEFAULTS: Record<Tier, string> = {
  fast: 'claude-haiku-4-5',
  reasoning: 'claude-sonnet-4-6',
};

const TASKS = {
  /** Per-issue extraction and classification, once per ingested issue. */
  analysis: 'fast',
  /** Comment summarization, on demand from the agent. */
  summary: 'fast',
  /** Subcategory vocabulary derived across the whole corpus. */
  vocabulary: 'reasoning',
  /** The conversational agent, which plans over five tools. */
  agent: 'reasoning',
  /** LLM-as-judge scorers in the eval suite. */
  judge: 'fast',
} as const satisfies Record<string, Tier>;

export type Task = keyof typeof TASKS;

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface ModelCall {
  task: Task;
  system: string;
  prompt: string;
  temperature?: number;
}

export interface StructuredCall extends ModelCall {
  /** Tool name carrying the schema. Shows up in gateway and trace logs. */
  name: string;
  schema: Record<string, unknown>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, so the AI gateway is unreachable`);
  return value;
}

/**
 * The model for a task. MODEL_FAST and MODEL_REASONING come from the
 * astropods.yml `models` entries, so a deploy can move a task to a different
 * model without a code change.
 */
export function modelFor(task: Task): string {
  const tier: Tier = TASKS[task];
  return process.env[`MODEL_${tier.toUpperCase()}`] || DEFAULTS[tier];
}

export function gatewayBaseUrl(): string {
  return `${requireEnv('ASTRO_GATEWAY_URL').replace(/\/+$/, '')}/v1`;
}

export function gatewayClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv('ASTRO_GATEWAY_API_KEY'),
    baseURL: gatewayBaseUrl(),
  });
}

/** Mastra reads this shape as an OpenAI-compatible provider. */
export function gatewayModel(task: Task) {
  return {
    providerId: 'astro-gateway',
    modelId: modelFor(task),
    url: gatewayBaseUrl(),
    apiKey: requireEnv('ASTRO_GATEWAY_API_KEY'),
  };
}

function messagesFor(call: ModelCall) {
  return [
    { role: 'system' as const, content: call.system },
    { role: 'user' as const, content: call.prompt },
  ];
}

function usageOf(completion: ChatCompletion): TokenUsage {
  return {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };
}

export async function textCompletion(call: ModelCall): Promise<string | null> {
  const completion = await gatewayClient().chat.completions.create({
    model: modelFor(call.task),
    messages: messagesFor(call),
    temperature: call.temperature ?? 0.2,
  });
  return completion.choices[0]?.message.content ?? null;
}

/**
 * Runs a call whose answer must match a JSON schema. Claude has no
 * response_format: json_schema, so the schema travels as a single tool the
 * model is required to call, which enforces the enums the same way.
 */
export async function structuredCompletion<T>(
  call: StructuredCall,
): Promise<{ data: T; tokenUsage: TokenUsage }> {
  const completion = await gatewayClient().chat.completions.create({
    model: modelFor(call.task),
    messages: messagesFor(call),
    tools: [{ type: 'function', function: { name: call.name, parameters: call.schema } }],
    tool_choice: { type: 'function', function: { name: call.name } },
    temperature: call.temperature ?? 0.1,
  });

  const toolCall = completion.choices[0]?.message.tool_calls?.[0];
  if (!toolCall) throw new Error(`${call.name}: the model returned no tool call`);

  return { data: JSON.parse(toolCall.function.arguments) as T, tokenUsage: usageOf(completion) };
}
