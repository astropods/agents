/**
 * Echoes every message and appends a random joke.
 * Uses @astropods/adapter-core directly — no LLM required.
 */

import '@astropods/adapter-core/instrument';
import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('hello-astro');

async function fetchJoke(): Promise<string> {
  const response = await fetch('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode');
  const data = (await response.json()) as { joke?: string; setup?: string; delivery?: string };
  return data.joke ?? `${data.setup} ... ${data.delivery}`;
}

const adapter: AgentAdapter = {
  name: 'Hello World',

  async stream(prompt: string, hooks: StreamHooks, options: StreamOptions): Promise<void> {
    await tracer.startActiveSpan('hello.turn', async (span) => {
      span.setAttribute('gen_ai.operation.name', 'invoke_agent');
      span.setAttribute('gen_ai.agent.name', adapter.name);
      span.setAttribute('gen_ai.conversation.id', options.conversationId);
      span.setAttribute('user.id', options.userId);
      span.setAttribute(
        'gen_ai.input.messages',
        JSON.stringify([{ role: 'user', content: prompt }]),
      );

      try {
        const echo = `Echo: ${prompt}\n\n`;
        hooks.onChunk(echo);

        const joke = `Here's a joke: ${await fetchJoke()}`;
        hooks.onChunk(joke);

        span.setAttribute(
          'gen_ai.output.messages',
          JSON.stringify([{ role: 'assistant', content: echo + joke }]),
        );
        hooks.onFinish();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        hooks.onError(err);
      } finally {
        span.end();
      }
    });
  },

  getConfig() {
    return {
      systemPrompt: 'Echoes messages and tells jokes.',
      tools: [],
    };
  },
};

serve(adapter);
