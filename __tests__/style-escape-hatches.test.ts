import { describe, it, expect } from 'vitest';
import { validateStory } from '../story-generator/storyValidator';

describe('style escape hatches are rejected', () => {
  it('flags an injected <style> element and !important', () => {
    const code = `export const A = () => (<><style>{\`.x { color: red !important; }\`}</style><div className="x" /></>);`;
    const msgs = validateStory(code).map(e => e.message);
    expect(msgs.some(m => m.includes('<style>'))).toBe(true);
    expect(msgs.some(m => m.includes('!important'))).toBe(true);
  });
  it('leaves a style PROP alone', () => {
    const code = `export const A = () => <div style={{ background: 'var(--mantine-color-orange-1)' }} />;`;
    const msgs = validateStory(code).map(e => e.message);
    expect(msgs.some(m => m.includes('<style>') || m.includes('!important'))).toBe(false);
  });
});
