/**
 * Component Registry Generator
 *
 * Generates a `componentRegistry.ts` file that maps component names to
 * actual React/Vue/etc imports for use by the Voice Canvas ComponentRenderer.
 *
 * Design-system agnostic — uses existing component discovery to find
 * components from npm packages, local directories, and custom elements.
 *
 * Called during `npx story-ui init` and can be re-run with `npx story-ui registry`.
 */

import path from 'path';
import fs from 'fs';
import { loadUserConfig } from '../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../story-generator/enhancedComponentDiscovery.js';

export interface RegistryGeneratorOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Output path relative to cwd (defaults to src/stories/StoryUI/voice/canvas/) */
  outputDir?: string;
}

/**
 * Generate the component registry file using project's discovered components.
 * Returns the path to the generated file.
 */
export async function generateComponentRegistry(options: RegistryGeneratorOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  // loadUserConfig reads from cwd — ensure we're in the right directory
  const originalCwd = process.cwd();
  if (cwd !== originalCwd) process.chdir(cwd);
  const config = loadUserConfig();
  if (cwd !== originalCwd) process.chdir(originalCwd);

  // Discover components using the existing discovery system
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  const componentNames = components.map(c => c.name).sort();

  if (componentNames.length === 0) {
    console.warn('⚠️  No components discovered — registry will be empty');
  }

  const importPath = config.importPath || '@mantine/core';
  const framework = config.componentFramework || 'react';
  const importStyle = (config as any).importStyle || 'barrel';

  // Determine output directory
  const outputDir = options.outputDir
    ? path.resolve(cwd, options.outputDir)
    : path.resolve(cwd, 'src/stories/StoryUI/voice/canvas');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'componentRegistry.ts');

  // Generate the file content
  let code: string;

  if (framework === 'react') {
    code = generateReactRegistry(componentNames, importPath, importStyle);
  } else if (framework === 'vue') {
    code = generateVueRegistry(componentNames, importPath, importStyle);
  } else {
    // Fallback: generic registry with dynamic imports note
    code = generateGenericRegistry(componentNames, importPath, framework);
  }

  fs.writeFileSync(outputPath, code, 'utf-8');
  console.log(`✅ Component registry generated: ${path.relative(cwd, outputPath)} (${componentNames.length} components)`);

  return outputPath;
}

// ── React registry generator ────────────────────────────────

function generateReactRegistry(
  names: string[],
  importPath: string,
  importStyle: string,
): string {
  // Separate parent components from sub-components (e.g., "Card.Section")
  const topLevel = names.filter(n => !n.includes('.'));
  const subComponents = names.filter(n => n.includes('.'));

  // For barrel imports, import all top-level from one path
  // For individual imports, import each from its own path
  let imports: string;
  if (importStyle === 'individual') {
    imports = topLevel.map(name =>
      `import { ${name} } from '${importPath}/${name}';`
    ).join('\n');
  } else {
    // Barrel import — single line
    imports = `import {\n${topLevel.map(n => `  ${n},`).join('\n')}\n} from '${importPath}';`;
  }

  // Build registry entries
  const entries = topLevel.map(name => `  '${name}': ${name},`);

  // Sub-components map automatically via dot-notation in ComponentRenderer
  // e.g., "Card.Section" resolves to Card.Section at runtime
  // But we still add them for explicit lookup
  for (const sub of subComponents) {
    const [parent, child] = sub.split('.');
    entries.push(`  '${sub}': (${parent} as any).${child},`);
  }

  return `/**
 * Auto-generated component registry for Voice Canvas
 * Source: ${importPath}
 * Components: ${names.length}
 *
 * DO NOT EDIT — regenerate with: npx story-ui registry
 */

${imports}
import type { ComponentRegistry } from './ComponentRenderer';

export const registry: ComponentRegistry = {
${entries.join('\n')}
};

export default registry;
`;
}

// ── Vue registry generator ──────────────────────────────────

function generateVueRegistry(
  names: string[],
  importPath: string,
  importStyle: string,
): string {
  const topLevel = names.filter(n => !n.includes('.'));

  let imports: string;
  if (importStyle === 'individual') {
    imports = topLevel.map(name =>
      `import { ${name} } from '${importPath}/${name}';`
    ).join('\n');
  } else {
    imports = `import {\n${topLevel.map(n => `  ${n},`).join('\n')}\n} from '${importPath}';`;
  }

  const entries = topLevel.map(name => `  '${name}': ${name},`);

  return `/**
 * Auto-generated component registry for Voice Canvas (Vue)
 * Source: ${importPath}
 * Components: ${names.length}
 *
 * DO NOT EDIT — regenerate with: npx story-ui registry
 */

${imports}

export const registry: Record<string, any> = {
${entries.join('\n')}
};

export default registry;
`;
}

// ── Generic fallback ────────────────────────────────────────

function generateGenericRegistry(
  names: string[],
  importPath: string,
  framework: string,
): string {
  return `/**
 * Auto-generated component registry for Voice Canvas (${framework})
 * Source: ${importPath}
 * Components: ${names.length}
 *
 * NOTE: This is a placeholder registry for ${framework}.
 * You may need to customize imports for your framework.
 *
 * DO NOT EDIT — regenerate with: npx story-ui registry
 */

// TODO: Add imports for ${framework} components from '${importPath}'
// ${names.map(n => `// import { ${n} } from '${importPath}';`).join('\n')}

export const registry: Record<string, any> = {
${names.map(n => `  // '${n}': ${n},`).join('\n')}
};

export default registry;
`;
}
