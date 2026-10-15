/**
 * Echoes every message and appends a random joke.
 * Uses @astropods/adapter-core directly — no LLM required.
 */

import { instrumentHttp, serve } from '@astropods/adapter-core';
import { adapter } from './adapter';

instrumentHttp();
serve(adapter);
