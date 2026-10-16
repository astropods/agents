import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { adapter } from './adapter';

const exporter = new InMemorySpanExporter();
const originalFetch = globalThis.fetch;

const options = { conversationId: 'conv-1', userId: 'user-1' } as StreamOptions;

function recordHooks() {
  const calls = { chunks: [] as string[], finished: 0, errors: [] as Error[] };
  const hooks = {
    onChunk: (text: string) => calls.chunks.push(text),
    onFinish: () => calls.finished++,
    onError: (error: Error) => calls.errors.push(error),
  } as unknown as StreamHooks;
  return { calls, hooks };
}

function stubFetch(handler: () => Promise<Response>) {
  globalThis.fetch = handler as unknown as typeof fetch;
}

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('stream', () => {
  test('echoes the prompt, then the joke, then finishes', async () => {
    stubFetch(async () => Response.json({ joke: 'a joke' }));
    const { calls, hooks } = recordHooks();

    await adapter.stream('hi', hooks, options);

    expect(calls.chunks).toEqual(['Echo: hi\n\n', "Here's a joke: a joke"]);
    expect(calls.finished).toBe(1);
    expect(calls.errors).toEqual([]);
  });

  test('joins a two-part joke from its setup and delivery', async () => {
    stubFetch(async () => Response.json({ setup: 'knock knock', delivery: 'who is there' }));
    const { calls, hooks } = recordHooks();

    await adapter.stream('hi', hooks, options);

    expect(calls.chunks[1]).toBe("Here's a joke: knock knock ... who is there");
  });

  test('reports the error and does not finish when the joke request fails', async () => {
    stubFetch(async () => {
      throw new Error('joke api down');
    });
    const { calls, hooks } = recordHooks();

    await adapter.stream('hi', hooks, options);

    expect(calls.errors.map((error) => error.message)).toEqual(['joke api down']);
    expect(calls.finished).toBe(0);
    expect(calls.chunks).toEqual(['Echo: hi\n\n']);
  });
});

describe('trace', () => {
  test('records one hello.turn span with the prompt as input and the reply as output', async () => {
    stubFetch(async () => Response.json({ joke: 'a joke' }));

    await adapter.stream('hi', recordHooks().hooks, options);

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(['hello.turn']);
    const { attributes } = spans[0];
    expect(attributes['gen_ai.input.messages']).toBe(
      JSON.stringify([{ role: 'user', content: 'hi' }]),
    );
    expect(attributes['gen_ai.output.messages']).toBe(
      JSON.stringify([{ role: 'assistant', content: "Echo: hi\n\nHere's a joke: a joke" }]),
    );
  });

  test('tags the span with the conversation and user', async () => {
    stubFetch(async () => Response.json({ joke: 'a joke' }));

    await adapter.stream('hi', recordHooks().hooks, options);

    const { attributes } = exporter.getFinishedSpans()[0];
    expect(attributes['gen_ai.conversation.id']).toBe('conv-1');
    expect(attributes['user.id']).toBe('user-1');
  });

  test('marks the span failed and keeps the input when the joke request fails', async () => {
    stubFetch(async () => {
      throw new Error('joke api down');
    });

    await adapter.stream('hi', recordHooks().hooks, options);

    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('joke api down');
    expect(span.attributes['gen_ai.input.messages']).toBe(
      JSON.stringify([{ role: 'user', content: 'hi' }]),
    );
    expect(span.attributes['gen_ai.output.messages']).toBeUndefined();
  });
});
