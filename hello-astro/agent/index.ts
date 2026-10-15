/**
 * Echoes every message and appends a random joke.
 * Uses @astropods/adapter-core directly — no LLM required.
 */

import '@astropods/adapter-core/instrument';
import { serve } from '@astropods/adapter-core';
import { adapter } from './adapter';

serve(adapter);
