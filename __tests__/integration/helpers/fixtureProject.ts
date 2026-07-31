import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Creates a throwaway consumer project on disk that the real pipeline can run
 * against: a story-ui.config.js, a package.json, and a fake installed
 * component library ("test-lib") whose exports EnhancedComponentDiscovery
 * picks up via its runtime-require strategy.
 */
export interface FixtureProject {
  root: string;
  generatedDir: string;
  cleanup(): void;
}

export const FIXTURE_LIB = 'test-lib';
export const FIXTURE_COMPONENTS = ['Button', 'Card', 'Stack', 'Text', 'Badge'];

export function createFixtureProject(): FixtureProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-int-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'story-ui-integration-fixture',
    private: true,
    dependencies: { [FIXTURE_LIB]: '1.0.0', react: '^19.0.0' },
    devDependencies: { '@storybook/react-vite': '^10.0.0' },
  }, null, 2));

  fs.writeFileSync(path.join(root, 'story-ui.config.js'), `module.exports = {
  importPath: '${FIXTURE_LIB}',
  componentFramework: 'react',
  generatedStoriesPath: './stories/generated/',
  storyPrefix: 'Generated/',
  defaultAuthor: 'Story UI AI',
  llmProvider: 'claude',
};
`);

  const libDir = path.join(root, 'node_modules', FIXTURE_LIB);
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, 'package.json'), JSON.stringify({
    name: FIXTURE_LIB,
    version: '1.0.0',
    main: 'index.js',
    types: 'index.d.ts',
  }, null, 2));
  // Plain function exports with capitalized names — enough for the runtime
  // export inspection to classify them as components. No react import needed.
  fs.writeFileSync(
    path.join(libDir, 'index.js'),
    FIXTURE_COMPONENTS.map(name => `exports.${name} = function ${name}() { return null; };`).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(libDir, 'index.d.ts'),
    [
      // Mantine-shaped declarations for Button: a props interface, plus a
      // `<Name>Variant` alias beside the component rather than a `variant`
      // member inside it — the shape the editable-props route must serve.
      `export type ButtonVariant = 'primary' | 'secondary' | 'ghost';`,
      `export interface ButtonProps {`,
      `  /** Visual size of the control. */`,
      `  size?: 'sm' | 'md' | 'lg';`,
      `  disabled?: boolean;`,
      `}`,
      ...FIXTURE_COMPONENTS.map(name => `export declare function ${name}(props: Record<string, unknown>): unknown;`),
    ].join('\n') + '\n'
  );

  const generatedDir = path.join(root, 'stories', 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });

  return {
    root,
    generatedDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A valid story (as the model would emit it) using only fixture components. */
export function validStoryResponse(extraImports = ''): string {
  return [
    'Here is your story:',
    '```tsx',
    "import React from 'react';",
    "import type { Meta, StoryObj } from '@storybook/react';",
    `import { Button, Card, Stack, Text } from '${FIXTURE_LIB}';`,
    extraImports,
    'const meta: Meta = {',
    "  title: 'Placeholder',",
    '};',
    'export default meta;',
    'type Story = StoryObj;',
    '',
    'export const Primary: Story = {',
    '  render: () => (',
    '    <Card>',
    '      <Stack>',
    '        <Text>Hello from the fixture</Text>',
    '        <Button>Click me</Button>',
    '      </Stack>',
    '    </Card>',
    '  ),',
    '};',
    '```',
  ].filter(Boolean).join('\n');
}
