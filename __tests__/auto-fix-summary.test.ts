/**
 * "Auto-fixed: Minor syntax issues were automatically corrected" appeared on
 * every Vue generation. The fix was three import paths rewritten onto the
 * configured barrel, and there was no syntax issue. The banner has to say
 * what was done, and say nothing when nothing was.
 */

import { describe, it, expect } from 'vitest';
import { describeAutoFix } from '../story-generator/autoFixSummary.js';

const vueBefore = `import type { Meta, StoryObj } from '@storybook/vue3';
import { VChipGroup } from 'vuetify/components/VChipGroup';
import { VChip } from 'vuetify/components/VChip';
import { VLabel } from 'vuetify/components/VLabel';
export default {} as Meta;`;
const vueAfter = vueBefore
  .replace("'vuetify/components/VChipGroup'", "'vuetify/components'")
  .replace("'vuetify/components/VChip'", "'vuetify/components'")
  .replace("'vuetify/components/VLabel'", "'vuetify/components'");

describe('describeAutoFix', () => {
  it('names import paths rewritten onto the configured barrel', () => {
    expect(describeAutoFix(vueBefore, vueAfter, ['Import path error: Using "vuetify/components/VChip" …']))
      .toEqual(["rewrote 3 import paths to 'vuetify/components'"]);
  });

  it('names a single rewrite by its path', () => {
    const before = `import { Button } from '@mantine/core/Button';\nexport default {};`;
    const after = `import { Button } from '@mantine/core';\nexport default {};`;
    expect(describeAutoFix(before, after)).toEqual(["rewrote the import path '@mantine/core/Button' to '@mantine/core'"]);
  });

  it('names an added or removed React import', () => {
    const noReact = `import { Button } from '@mantine/core';\nexport const A = () => <Button />;`;
    const withReact = `import React from 'react';\n${noReact}`;
    expect(describeAutoFix(noReact, withReact)).toEqual(['added the missing React import']);
    expect(describeAutoFix(withReact, noReact)).toEqual(['removed a React import this framework does not use']);
  });

  it('says nothing when the fix changed nothing', () => {
    expect(describeAutoFix(vueAfter, vueAfter, ['whatever'])).toEqual([]);
  });

  it('falls back to a line count and the error it addressed', () => {
    const before = `export default {\n  title: 'X'\n  component: Y,\n};`;
    const after = `export default {\n  title: 'X',\n  component: Y,\n};`;
    expect(describeAutoFix(before, after, ["Line 2, Column 13: ',' expected."]))
      .toEqual(["corrected 1 line: Line 2, Column 13: ',' expected."]);
  });
});
