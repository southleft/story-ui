/**
 * The fidelity bench's scoring is pure, so its verdicts are tested here
 * without a server. If these break, every number in bench/results is suspect.
 */

import { describe, it, expect } from 'vitest';
// @ts-ignore — plain ESM module, no declarations
import {
  parseImports, jsxTags, componentAdherence, componentRequirements,
  forbiddenPatterns, divergenceCheck, textSurvived, openingTags, readAttr,
  pinSurvived, timing, verificationCheck, completionCheck, scoreStep,
} from '../bench/fidelity/score.mjs';
import { editDivergence } from '../story-generator/postProcessStory.js';

const IMPORT_PATH = '@mantine/core';

const story = `
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Card, Button, SimpleGrid, Text,
  Badge as Tag } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { Hero } from './Hero';

function PlanCard({ name }: { name: string }) {
  return (
    <Card>
      <Text fw={700}>{name}</Text>
      <Tag color="blue">Most popular</Tag>
      <IconCheck size={16} />
      <Button variant="filled" onClick={() => alert('>')}>Choose plan</Button>
      <Button variant="light">Contact sales</Button>
    </Card>
  );
}

const meta: Meta = { title: 'Generated/Pricing' };
export default meta;
export const Default: StoryObj = {
  render: () => (
    <SimpleGrid cols={3}>
      <Hero />
      <PlanCard name="Starter" />
      <Tabs.Panel value="x">oops</Tabs.Panel>
    </SimpleGrid>
  ),
};
`;

describe('parseImports', () => {
  it('reads default, named, aliased, namespace and multi-line imports', () => {
    const imports = parseImports(story);
    const bySource = Object.fromEntries(imports.map(i => [i.source, i.names]));
    expect(bySource['react']).toEqual(['useState', 'React']);
    expect(bySource['@mantine/core']).toEqual(['Card', 'Button', 'SimpleGrid', 'Text', 'Tag']);
    expect(bySource['@tabler/icons-react']).toEqual(['IconCheck']);
    expect(bySource['./Hero']).toEqual(['Hero']);
    expect(bySource['@storybook/react']).toBeUndefined(); // type-only
    const ns = parseImports(`import * as Icons from 'x';`);
    expect(ns[0].names).toEqual(['Icons']);
  });
});

describe('jsxTags', () => {
  it('reports compound tags with their root', () => {
    const tags = jsxTags(story);
    expect(tags.find(t => t.full === 'Tabs.Panel')?.root).toBe('Tabs');
    expect(tags.some(t => t.full === 'Card')).toBe(true);
    // lower-case host elements are not components
    expect(jsxTags('<div><span/></div>')).toEqual([]);
  });
});

describe('componentAdherence', () => {
  it('classifies each tag and flags the one nobody imported or declared', () => {
    const a = componentAdherence(story, { importPath: IMPORT_PATH });
    expect(a.pass).toBe(false);
    expect(a.unknownTags).toEqual(['Tabs']);
    expect(a.designSystemTags).toEqual(expect.arrayContaining(['Card', 'Text', 'Tag', 'Button', 'SimpleGrid']));
    expect(a.localTags).toEqual(['Hero']);
    expect(a.declaredTags).toEqual(['PlanCard']);
    expect(a.foreignTags).toEqual(['IconCheck (@tabler/icons-react)']);
  });

  it('passes when every tag is accounted for', () => {
    const clean = story.replace(/<Tabs\.Panel[^]*?<\/Tabs\.Panel>/, '');
    expect(componentAdherence(clean, { importPath: IMPORT_PATH }).pass).toBe(true);
  });

  it('treats sibling packages of a scoped design system as the design system', () => {
    const code = `import { DatePicker } from '@mantine/dates';\nexport const X = () => <DatePicker />;`;
    const a = componentAdherence(code, { importPath: IMPORT_PATH });
    expect(a.designSystemTags).toEqual(['DatePicker']);
  });
});

describe('componentRequirements', () => {
  it('requires mustUse names to come from the design system, not a local declaration', () => {
    const code = `import { Button } from '@mantine/core';\nfunction Card() { return null }\nexport const X = () => <Card><Button/></Card>;`;
    const r = componentRequirements(code, { importPath: IMPORT_PATH, mustUse: ['Card', 'Button'] });
    expect(r.pass).toBe(false);
    expect(r.missingMustUse).toEqual(['Card']);
    expect(r.usedButNotFromDesignSystem).toEqual(['Card']);
  });

  it('accepts a compound usage for a required root and evaluates anyOf groups', () => {
    const code = `import { Tabs, Grid } from '@mantine/core';\nexport const X = () => <Grid><Tabs.Panel value="a" /></Grid>;`;
    const r = componentRequirements(code, {
      importPath: IMPORT_PATH,
      mustUse: ['Tabs'],
      mustUseAnyOf: [['SimpleGrid', 'Grid'], ['Timeline', 'List']],
      mustNot: ['Table'],
    });
    expect(r.pass).toBe(false);
    expect(r.missingMustUse).toEqual([]);
    expect(r.unsatisfiedGroups).toEqual([['Timeline', 'List']]);
  });

  it('fails on a forbidden component and accepts a flat anyOf list', () => {
    const code = `import { Table } from '@mantine/core';\nexport const X = () => <Table />;`;
    const r = componentRequirements(code, { importPath: IMPORT_PATH, mustUseAnyOf: ['Table', 'List'], mustNot: ['Table'] });
    expect(r.unsatisfiedGroups).toEqual([]);
    expect(r.presentMustNot).toEqual(['Table']);
    expect(r.pass).toBe(false);
  });
});

describe('forbiddenPatterns', () => {
  it('reports each matching pattern with samples and survives a bad regex', () => {
    const code = `<Box style={{ padding: 12px, color: '#ff00aa' }} />`;
    const r = forbiddenPatterns(code, ['#[0-9a-fA-F]{6}\\b', "style=\\{\\{[^}]*padding:\\s*\\d+px", 'zzz', '(']);
    expect(r.pass).toBe(false);
    expect(r.hits.map(h => h.pattern)).toEqual(['#[0-9a-fA-F]{6}\\b', "style=\\{\\{[^}]*padding:\\s*\\d+px", '(']);
    expect(r.hits[0].matches).toEqual(['#ff00aa']);
    expect(r.hits[2].error).toBeTruthy();
  });

  it('passes with no patterns or no matches', () => {
    expect(forbiddenPatterns('<Box />', []).pass).toBe(true);
    expect(forbiddenPatterns('<Box />', ['#[0-9a-f]{6}']).pass).toBe(true);
  });
});

describe('divergenceCheck', () => {
  it('is n/a without a threshold or without a number', () => {
    expect(divergenceCheck(0.4, undefined).pass).toBeNull();
    expect(divergenceCheck(undefined, 0.1).pass).toBeNull();
  });

  it('passes at or under the threshold and fails above it', () => {
    expect(divergenceCheck(0.1, 0.1).pass).toBe(true);
    expect(divergenceCheck(0.11, 0.1).pass).toBe(false);
  });

  it('agrees with editDivergence on a one-attribute change versus a rewrite', () => {
    const edited = story.replace('Choose plan', 'Start free trial');
    const small = editDivergence(story, edited).divergence;
    expect(divergenceCheck(small, 0.1).pass).toBe(true);
    const rewrite = `import { Table } from '@mantine/core';\nexport const X = () => <Table><Table.Tr><Table.Td>1</Table.Td></Table.Tr></Table>;`;
    const large = editDivergence(story, rewrite).divergence;
    expect(divergenceCheck(large, 0.15).pass).toBe(false);
  });
});

describe('textSurvived', () => {
  it('lists missing literals and is n/a with nothing to check', () => {
    expect(textSurvived(story, ['Most popular', 'Gone']).missing).toEqual(['Gone']);
    expect(textSurvived(story, []).pass).toBeNull();
  });
});

describe('pins', () => {
  it('finds the attribute region past braces and quotes containing >', () => {
    const tags = openingTags(story, 'Button');
    expect(tags).toHaveLength(2);
    expect(readAttr(tags[0].attrs, 'variant')).toBe('filled');
    expect(readAttr(tags[0].attrs, 'onClick')).toContain('alert');
    expect(readAttr(tags[1].attrs, 'variant')).toBe('light');
    expect(readAttr(tags[1].attrs, 'size')).toBeNull();
  });

  it('reads brace, bare-boolean and expression values', () => {
    expect(readAttr(` variant={"outline"} disabled cols={3}`, 'variant')).toBe('outline');
    expect(readAttr(` variant={"outline"} disabled cols={3}`, 'disabled')).toBe('true');
    expect(readAttr(` variant={"outline"} disabled cols={3}`, 'cols')).toBe('3');
  });

  it('reports survival, change and loss differently', () => {
    const pin = { component: 'Button', occurrence: 0, prop: 'variant', value: 'outline' };
    const kept = story.replace('variant="filled"', 'variant="outline"');
    expect(pinSurvived(kept, pin)).toMatchObject({ pass: true, found: 'outline', occurrences: 2 });
    expect(pinSurvived(story, pin)).toMatchObject({ pass: false, found: 'filled' });
    expect(pinSurvived(story.replace(/<Button[^]*?<\/Button>\s*/g, ''), pin)).toMatchObject({ pass: false, occurrences: 0 });
    expect(pinSurvived(story, { ...pin, occurrence: 5 }).reason).toMatch(/only 2/);
  });

  it('does not confuse <Button with <ButtonGroup', () => {
    const code = `<ButtonGroup variant="x"><Button variant="y">a</Button></ButtonGroup>`;
    expect(openingTags(code, 'Button')).toHaveLength(1);
    expect(pinSurvived(code, { component: 'Button', occurrence: 0, prop: 'variant', value: 'y' }).pass).toBe(true);
  });
});

describe('timing', () => {
  const events = [
    { type: 'started', at: 10 },
    { type: 'retry', at: 5000 },
    { type: 'preview_ready', at: 12000 },
    { type: 'completion', at: 40000, data: { metrics: { llmCallsCount: 3 } } },
  ];
  it('measures preview and completion from the events and applies a budget', () => {
    const t = timing(events, { maxTimeToPreviewMs: 15000 });
    expect(t).toMatchObject({ pass: true, tPreviewMs: 12000, tTotalMs: 40000, llmCalls: 3, retries: 1 });
    expect(timing(events, { maxTimeToPreviewMs: 10000 }).pass).toBe(false);
    expect(timing(events).pass).toBeNull();
  });
  it('is n/a-shaped when nothing arrived', () => {
    expect(timing([])).toMatchObject({ pass: null, tPreviewMs: null, tTotalMs: null, llmCalls: null });
  });
});

describe('verification and completion', () => {
  it('distinguishes verified, issues-with-warnings, blockers, and not measured', () => {
    expect(verificationCheck({ verification: { outcome: 'verified', findings: [], metrics: { checksRun: 5, checksTotal: 6 } } })).toMatchObject({ pass: true, checksRun: 5, checksTotal: 6 });
    expect(verificationCheck({ verification: { outcome: 'issues', findings: [{ severity: 'warning', class: 'a11y', message: 'w' }] } }).pass).toBe(true);
    expect(verificationCheck({ verification: { outcome: 'issues', findings: [{ severity: 'blocker', class: 'code', message: 'b' }] } })).toMatchObject({ pass: false, blockers: ['code: b'] });
    expect(verificationCheck({ verification: { outcome: 'not_verified', reason: 'no browser', findings: [] } }).pass).toBeNull();
    expect(verificationCheck({}).pass).toBeNull();
  });

  it('fails a completion that is a placeholder, missing, or preceded by an error', () => {
    expect(completionCheck({ success: true, summary: { action: 'created' } }).pass).toBe(true);
    expect(completionCheck({ success: true, summary: { action: 'failed', description: 'x' } }).pass).toBe(false);
    expect(completionCheck(null, undefined).pass).toBe(false);
    expect(completionCheck({ success: true }, { data: { code: 'E', message: 'boom' } }).reason).toBe('error event: E boom');
  });
});

describe('scoreStep', () => {
  it('assembles checks and separates failed from not-measured', () => {
    const clean = story.replace(/<Tabs\.Panel[^]*?<\/Tabs\.Panel>/, '');
    const s = scoreStep({
      code: clean,
      expect: { mustUseComponents: ['Card'], mustContainText: ['Most popular'], forbiddenPatterns: ['#[0-9a-f]{6}'] },
      events: [{ type: 'completion', at: 100, data: {} }],
      completion: { success: true, summary: { action: 'created' } },
      importPath: IMPORT_PATH,
    });
    expect(s.pass).toBe(true);
    expect(s.failed).toEqual([]);
    expect(s.notMeasured).toEqual(expect.arrayContaining(['verification', 'divergence', 'pins', 'timing']));
  });

  it('fails a follow-up that rewrote the page and lost its pin', () => {
    const rewrite = `import { Table } from '@mantine/core';\nexport const X = () => <Table />;`;
    const s = scoreStep({
      code: rewrite,
      expect: { maxDivergence: 0.15 },
      events: [],
      completion: { success: true, summary: { action: 'updated' }, pins: { applied: [], kept: [], lost: [{ component: 'Button', occurrence: 0, prop: 'variant' }] } },
      importPath: IMPORT_PATH,
      previousCode: story,
      divergence: editDivergence(story, rewrite).divergence,
      pins: [{ component: 'Button', occurrence: 0, prop: 'variant', value: 'outline' }],
    });
    expect(s.pass).toBe(false);
    expect(s.failed).toEqual(expect.arrayContaining(['divergence', 'pins']));
    expect(s.checks.pins.serverLost).toHaveLength(1);
  });
});
