import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { type Span, SpanStatusCode, context, trace } from '@opentelemetry/api';

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Records the echo as a model call named `echo`, with word counts as its
 * token usage. No model runs; the step shows where a real model call would
 * appear in Traces, with its tokens.
 */
function recordEchoStep(turn: Span, prompt: string, reply: string): void {
  const span = trace
    .getTracer('hello-astro')
    .startSpan('chat echo', {}, trace.setSpan(context.active(), turn));
  span.setAttribute('langfuse.observation.type', 'generation');
  span.setAttribute('gen_ai.operation.name', 'chat');
  span.setAttribute('gen_ai.request.model', 'echo');
  span.setAttribute('gen_ai.response.model', 'echo');
  span.setAttribute('gen_ai.usage.input_tokens', words(prompt));
  span.setAttribute('gen_ai.usage.output_tokens', words(reply));
  span.end();
}

async function fetchJoke(): Promise<string> {
  const response = await fetch('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode');
  const data = (await response.json()) as { joke?: string; setup?: string; delivery?: string };
  return data.joke ?? `${data.setup} ... ${data.delivery}`;
}

export const adapter: AgentAdapter = {
  name: 'Hello World',

  async stream(prompt: string, hooks: StreamHooks, options: StreamOptions): Promise<void> {
    const tracer = trace.getTracer('hello-astro');

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
        recordEchoStep(span, prompt, echo);
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
