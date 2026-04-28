/**
 * hello-world — echoes every message and appends a random joke.
 * Uses @astropods/adapter-core directly — no LLM required.
 *
 * Environment variables (automatically injected by 'ast dev'):
 *   GRPC_SERVER_ADDR - injected by Astro messaging service
 */

import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';

async function fetchJoke(): Promise<string> {
  const response = await fetch('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode');
  const data = await response.json() as { joke?: string; setup?: string; delivery?: string };
  return data.joke ?? `${data.setup} ... ${data.delivery}`;
}

const adapter: AgentAdapter = {
  name: 'Hello World',

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    try {
      hooks.onChunk(`Echo: ${prompt}\n\n`);

      const joke = await fetchJoke();
      hooks.onChunk(`Here's a joke: ${joke}`);

      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },

  getConfig() {
    return {
      systemPrompt: 'Echoes messages and tells jokes.',
      tools: [],
    };
  },
};

serve(adapter);
