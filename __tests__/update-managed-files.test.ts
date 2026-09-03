/**
 * `story-ui update` must deliver the V2 workspace, in the directory init used.
 *
 * Two failures this pins down:
 * - MANAGED_FILES listed only V1 panel files, so a user upgrading the package
 *   and running `update` never received the StoryUIV2.mdx entry init installs.
 * - Install detection probed only src/stories/StoryUI and stories/StoryUI; an
 *   init with a custom generatedStoriesPath put the panel elsewhere and update
 *   wrote a duplicate to the conventional path instead of updating in place.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { updateCommand } from '../cli/update.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalCwd = process.cwd();
let root: string;

function scaffoldProject(storiesRel: string): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ui-update-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'host-project',
    // '@storybook/react' declared so the react-host dependency check does not
    // try a real npm install inside the test; its logic is unit-tested in
    // init-workspace.test.ts (missingReactStorybookDep).
    devDependencies: { 'react-live': '^4.1.8', storybook: '^9.0.0', '@storybook/react': '^9.0.0' }
  }, null, 2));

  fs.writeFileSync(path.join(root, 'story-ui.config.js'), `module.exports = {
  importPath: '@mantine/core',
  generatedStoriesPath: './${storiesRel}/generated/',
  componentFramework: 'react',
  _storyUIVersion: '0.0.1',
  _lastUpdated: '2026-01-01T00:00:00.000Z',
};`);

  // A stale panel install at the CONFIGURED location.
  const panelDir = path.join(root, storiesRel, 'StoryUI');
  fs.mkdirSync(panelDir, { recursive: true });
  fs.writeFileSync(path.join(panelDir, 'StoryUIPanel.tsx'), '// stale v1 panel\n');

  // A stories glob that matches no .mdx — the shape that hid the workspace.
  fs.mkdirSync(path.join(root, '.storybook'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.storybook', 'main.ts'),
    `export default { stories: ['../${storiesRel}/**/*.stories.tsx'], addons: [] };`
  );

  process.chdir(root);
}

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('updateCommand', () => {
  it('installs the V2 workspace beside a custom panel dir and widens the glob', async () => {
    scaffoldProject('custom/stories');

    const result = await updateCommand({ force: true, backup: false });

    expect(result.errors).toEqual([]);

    // V2 entry delivered, beside the detected panel dir — not under src/stories.
    const v2Target = path.join(root, 'custom', 'stories', 'StoryUIV2', 'StoryUIV2.mdx');
    expect(fs.existsSync(v2Target)).toBe(true);
    expect(fs.readFileSync(v2Target, 'utf-8')).toBe(
      fs.readFileSync(path.join(repoRoot, 'templates', 'StoryUIV2', 'StoryUIV2.mdx'), 'utf-8')
    );
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);

    // The stale panel was updated in place at the configured location.
    expect(fs.readFileSync(path.join(root, 'custom', 'stories', 'StoryUI', 'StoryUIPanel.tsx'), 'utf-8')).toBe(
      fs.readFileSync(path.join(repoRoot, 'templates', 'StoryUI', 'StoryUIPanel.tsx'), 'utf-8')
    );

    // The stories glob now reaches the MDX workspace, rooted at the real dir.
    const mainContent = fs.readFileSync(path.join(root, '.storybook', 'main.ts'), 'utf-8');
    expect(mainContent).toContain(`'../custom/stories/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'`);
  });

  it('still updates a conventional src/stories install', async () => {
    scaffoldProject('src/stories');

    const result = await updateCommand({ force: true, backup: false });

    expect(result.errors).toEqual([]);
    expect(fs.existsSync(path.join(root, 'src', 'stories', 'StoryUIV2', 'StoryUIV2.mdx'))).toBe(true);
  });
  /**
   * The regression this pins: `StoryUIPanel.tsx` grew three sibling imports
   * (DesignContextPanel, VerificationBadge, HandoffDialog). `init` copied
   * them; MANAGED_FILES did not list them. So `story-ui update` delivered a
   * panel with three unresolvable imports — a broken V1 panel for every
   * existing user who updated.
   *
   * Derived from the panel's own imports rather than hardcoded, so adding a
   * fourth sibling and forgetting `update` fails here instead of in a user's
   * project.
   */
  it('delivers every sibling the panel imports by relative path', async () => {
    scaffoldProject('src/stories');

    const panelSource = fs.readFileSync(
      path.join(repoRoot, 'templates', 'StoryUI', 'StoryUIPanel.tsx'), 'utf-8'
    );
    const siblings = [...panelSource.matchAll(/^import\s[^;]*?from\s+'\.\/([^']+)';/gm)]
      .map(m => m[1])
      .filter(spec => !spec.startsWith('voice/'));

    // Guard the guard: if the regex stops matching, an empty list would make
    // this test pass while checking nothing.
    expect(siblings.length).toBeGreaterThanOrEqual(3);

    await updateCommand({ force: true, backup: false });

    for (const spec of siblings) {
      // A sibling is a .tsx component or a .ts module (fileAttachments).
      const delivered = ['.tsx', '.ts'].some(ext => fs.existsSync(path.join(root, 'src', 'stories', 'StoryUI', `${spec}${ext}`)));
      expect(delivered, `update did not deliver ${spec}.ts(x), which StoryUIPanel.tsx imports`).toBe(true);
    }
  });
});
