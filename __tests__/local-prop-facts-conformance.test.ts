/**
 * A local component's declared props are judged, not only shown.
 *
 * The interface was read into the catalog line the model saw and never
 * consulted again: `<Pillbox status={row.status as any}>` passed every static
 * gate and crashed the house component at render. The facts the model was
 * given are the facts it is judged against.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { enrichWithSourceFacts, withLocalPropFacts } from '../story-generator/knowledge/sourceFacts.js';
import { checkConformance } from '../story-generator/knowledge/conformance.js';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-local-facts-'));
  fs.writeFileSync(path.join(root, 'Pillbox.tsx'), `import React from 'react';
export interface PillboxProps {
  /** Semantic status. */
  status?: 'neutral' | 'live' | 'degraded' | 'down' | 'pending';
  dot?: boolean;
  children?: React.ReactNode;
}
export const Pillbox: React.FC<PillboxProps> = ({ status = 'neutral', children }) => <span data-status={status}>{children}</span>;
`);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('withLocalPropFacts', () => {
  it('joins a local component\'s declared props to the record the conformance check reads', () => {
    const components: any[] = [{ name: 'Pillbox', filePath: path.join(root, 'Pillbox.tsx'), props: [] }];
    enrichWithSourceFacts(components);
    expect(components[0].__propFacts?.find((p: any) => p.name === 'status')?.options).toEqual(['neutral', 'live', 'degraded', 'down', 'pending']);

    const known = withLocalPropFacts(null, components, '../../housekit');
    expect(known?.components.Pillbox?.props.some(p => p.name === 'status')).toBe(true);

    const v = checkConformance(`const a = <Pillbox status={row.status as any} dot />;`, known);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('pending');
    expect(checkConformance(`const a = <Pillbox status="live" />;`, known)).toEqual([]);
  });

  it('never overwrites a package record with a local one of the same name', () => {
    const components: any[] = [{ name: 'Pillbox', __propFacts: [{ name: 'status', required: false, options: ['x'] }] }];
    const pkg: any = { importPath: '@x/y', components: { Pillbox: { name: 'Pillbox', props: [{ name: 'status', required: false, options: ['a'] }] } }, inheritedOnly: [], extractedAt: '' };
    expect(withLocalPropFacts(pkg, components, '@x/y')!.components.Pillbox.props[0].options).toEqual(['a']);
  });

  it('returns the input untouched when no local facts exist', () => {
    expect(withLocalPropFacts(null, [{ name: 'Button' }], '@x/y')).toBeNull();
  });
});
