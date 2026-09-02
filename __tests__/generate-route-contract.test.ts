/**
 * The client posts a field; does the route hand it to the pipeline?
 *
 * `files` shipped with the composer AND the generator, and neither route
 * forwarded it — the chip said "Used 1 file", the model never saw it. The
 * two ends were each tested; the join was not. This is the join.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: any[] = [];
vi.mock('../mcp-server/routes/generationCore.js', () => ({
  GENERATION_TOTAL_STEPS: 12,
  GenerationError: class GenerationError extends Error {
    code = 'TEST'; httpStatus = 500; details = undefined; recoverable = false; suggestion = undefined;
  },
  runStoryGeneration: vi.fn(async (request: any) => {
    captured.push(request);
    throw new Error('stop here — the request has been captured');
  }),
}));

import { generateStoryFromPromptStream } from '../mcp-server/routes/generateStoryStream';
import { generateStoryFromPrompt } from '../mcp-server/routes/generateStory';

function fakeRes() {
  const res: any = {
    headersSent: false,
    setHeader: () => {}, flushHeaders: () => {}, write: () => true, end: () => {},
    on: () => {}, once: () => {}, removeListener: () => {},
    status: () => res, json: () => res, send: () => res,
  };
  return res;
}

const body = {
  prompt: 'A card',
  fileName: 'card.stories.tsx',
  isUpdate: true,
  originalTitle: 'Card',
  selection: 'a Button containing the text "Save"',
  images: [{ type: 'base64', data: 'aGk=', mediaType: 'image/png' }],
  files: [{ name: 'spec.md', mediaType: 'text/markdown', data: 'IyBTcGVj' }],
  provider: 'claude',
  model: 'claude-opus-5',
  storybookUrl: 'http://localhost:6101',
  conversation: [{ role: 'user', content: 'hi' }],
};

/** Every field the client can send that the pipeline must receive verbatim. */
const FORWARDED = ['prompt', 'fileName', 'isUpdate', 'originalTitle', 'selection', 'images', 'files', 'provider', 'model', 'storybookUrl', 'conversation'] as const;

describe('generate routes forward the client payload to the pipeline', () => {
  beforeEach(() => { captured.length = 0; });

  it('streaming route', async () => {
    await generateStoryFromPromptStream({ body, on: () => {} } as any, fakeRes());
    expect(captured).toHaveLength(1);
    for (const key of FORWARDED) expect(captured[0][key], key).toEqual((body as any)[key]);
  });

  it('JSON route', async () => {
    await generateStoryFromPrompt({ body } as any, fakeRes());
    expect(captured).toHaveLength(1);
    for (const key of FORWARDED) expect(captured[0][key], key).toEqual((body as any)[key]);
  });
});
