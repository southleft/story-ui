/**
 * Bundle the workspace for Storybook's MANAGER.
 *
 * Storybook compiles `.storybook/manager.ts` with its own esbuild and maps
 * `react`, `react-dom`, `react-dom/client`, `storybook/*` to the manager's
 * globals — but not `react/jsx-runtime`. The tsc output in dist/ imports the
 * runtime (jsx: react-jsx), which esbuild would resolve from the PROJECT's
 * node_modules: a React 19 project hands React 18's manager elements it
 * cannot render. So the manager gets a bundle of its own: React externalised,
 * the JSX runtime shimmed onto `React.createElement`, everything else
 * (Radix Themes, the workspace's own modules) inlined, CSS emitted beside it.
 *
 * Outputs (both exported from package.json):
 *   dist/templates/StoryUIV2/managerTab.bundle.js   → @tpitre/story-ui/manager
 *   dist/templates/StoryUIV2/managerTab.bundle.css  → @tpitre/story-ui/manager.css
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'templates/StoryUIV2/managerTab.tsx');
const shim = path.join(root, 'templates/StoryUIV2/managerJsxRuntime.ts');
const outfile = path.join(root, 'dist/templates/StoryUIV2/managerTab.bundle.js');

const jsxRuntimeShim = {
  name: 'story-ui-jsx-runtime-shim',
  setup(b) {
    b.onResolve({ filter: /^react\/jsx(-dev)?-runtime$/ }, () => ({ path: shim }));
  },
};

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client', 'storybook', 'storybook/*', '@storybook/*'],
  plugins: [jsxRuntimeShim],
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});

// Type surface for the export: the bundle re-exports managerTab's public names.
fs.writeFileSync(outfile.replace(/\.js$/, '.d.ts'), "export * from './managerTab';\nexport { default } from './managerTab';\n");

const cssOut = outfile.replace(/\.js$/, '.css');
if (!fs.existsSync(cssOut)) {
  // A silent no-op here would look like success in the manager: the page would
  // mount with no styles and every finding would be about layout.
  throw new Error(`bundle-workspace-manager: expected ${cssOut} to be emitted`);
}
const inputs = Object.keys(result.metafile.inputs);
const secondReact = inputs.filter(p => /node_modules\/react(-dom)?\/(index|cjs)/.test(p));
if (secondReact.length) {
  throw new Error(`bundle-workspace-manager: React was bundled instead of externalised:\n${secondReact.join('\n')}`);
}
const kb = n => `${(fs.statSync(n).size / 1024).toFixed(0)} KB`;
console.log(`Manager bundle: ${path.relative(root, outfile)} (${kb(outfile)}), ${path.relative(root, cssOut)} (${kb(cssOut)}); ${inputs.length} inputs, jsx-runtime shimmed`);
