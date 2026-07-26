import { describe, it, expect } from 'vitest';
import { hasReactDefaultImport, validateStoryCode } from '../story-generator/validateStory.js';

const reactConfig = { importPath: '@mantine/core', componentFramework: 'react' } as any;

/**
 * Regression cover for a deadlock that hard-failed generations.
 *
 * The old check was an exact string match for `import React from 'react';`, so
 * `import React, { useState } from 'react';` read as missing. The auto-fixer
 * used a looser test, saw the import, and changed nothing — so the model was
 * asked repeatedly to add an import it already had until the 3-attempt repair
 * budget was gone and the run fell back to an error story. It surfaced as soon
 * as generated stories started using hooks.
 */
describe('hasReactDefaultImport', () => {
  it('matches a plain default import', () => {
    expect(hasReactDefaultImport(`import React from 'react';`)).toBe(true);
  });

  it('matches double quotes', () => {
    expect(hasReactDefaultImport(`import React from "react";`)).toBe(true);
  });

  it('matches a default import alongside named bindings (the regression)', () => {
    expect(hasReactDefaultImport(`import React, { useState } from 'react';`)).toBe(true);
    expect(hasReactDefaultImport(`import React, { useState, useMemo } from 'react';`)).toBe(true);
  });

  it('matches a namespace import', () => {
    expect(hasReactDefaultImport(`import * as React from 'react';`)).toBe(true);
  });

  it('does not match named-only imports, which never bind React itself', () => {
    expect(hasReactDefaultImport(`import { useState } from 'react';`)).toBe(false);
  });

  it('does not match a default import from another module', () => {
    expect(hasReactDefaultImport(`import Something from 'not-react';`)).toBe(false);
    expect(hasReactDefaultImport(`import ReactDOM from 'react-dom';`)).toBe(false);
  });

  it('handles empty input', () => {
    expect(hasReactDefaultImport('')).toBe(false);
  });
});

describe('React import never blocks generation', () => {
  it('does not report an error for hooks-style imports', () => {
    const code = `
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { NavLink } from '@mantine/core';

const meta: Meta = { title: 'Generated/Nav' };
export default meta;

export const Default: StoryObj = {
  render: () => {
    const [active, setActive] = useState(0);
    return <NavLink label="Home" active={active === 0} onClick={() => setActive(0)} />;
  },
};
`;
    const result = validateStoryCode(code, 'nav.stories.tsx', reactConfig);
    expect(result.errors.join(' ')).not.toContain('Missing React import');
  });

  it('auto-fixes a genuinely missing import instead of failing', () => {
    const code = `
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@mantine/core';

const meta: Meta = { title: 'Generated/Btn' };
export default meta;
export const Default: StoryObj = { render: () => <Button>Go</Button> };
`;
    const result = validateStoryCode(code, 'btn.stories.tsx', reactConfig);
    // Fixed silently — a deterministic repair must never consume a retry.
    expect(result.errors.join(' ')).not.toContain('Missing React import');
    expect(result.fixedCode && hasReactDefaultImport(result.fixedCode)).toBe(true);
  });
});
