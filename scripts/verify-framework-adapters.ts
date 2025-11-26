#!/usr/bin/env npx tsx
/**
 * Framework Adapter Verification Script
 *
 * Verifies that all framework adapters are properly configured and working.
 */

import {
  getAdapterRegistry,
  detectFramework,
  FrameworkType,
} from '../story-generator/framework-adapters/index.js';

async function verifyAdapters() {
  console.log('🔍 Framework Adapter Verification\n');
  console.log('='.repeat(50));

  const registry = getAdapterRegistry();

  // 1. List all available frameworks
  console.log('\n📦 Available Frameworks:');
  const frameworks = registry.getAvailableFrameworks();
  frameworks.forEach((framework) => {
    const adapter = registry.getAdapter(framework);
    console.log(`  - ${adapter.name} (${adapter.type})`);
    console.log(`    Story Frameworks: ${adapter.supportedStoryFrameworks.join(', ')}`);
    console.log(`    Extension: ${adapter.defaultExtension}`);
  });

  // 2. Test framework detection
  console.log('\n🔎 Testing Framework Detection:');
  try {
    const result = await detectFramework(process.cwd());
    console.log(`  Primary: ${result.primary.componentFramework} (confidence: ${result.primary.confidence})`);
    console.log(`  Story Framework: ${result.primary.storyFramework}`);
    if (result.frameworks.length > 1) {
      console.log(`  Alternatives: ${result.frameworks.slice(1).map(f => f.componentFramework).join(', ')}`);
    }
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
  }

  // 3. Test each adapter's validation
  console.log('\n✅ Adapter Validation Tests:');
  const testCases: { framework: FrameworkType; validCode: string; invalidCode: string }[] = [
    {
      framework: 'react',
      validCode: `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
export default { title: 'Test' };`,
      invalidCode: `import Vue from 'vue';
export default { title: 'Test' };`,
    },
    {
      framework: 'vue',
      validCode: `import type { Meta, StoryObj } from '@storybook/vue3';
export default { title: 'Test' };`,
      invalidCode: `import React from 'react';
export default { title: 'Test' };`,
    },
    {
      framework: 'angular',
      validCode: `import type { Meta, StoryObj } from '@storybook/angular';
export default { title: 'Test' };`,
      invalidCode: `import React from 'react';
export default { title: 'Test' };`,
    },
    {
      framework: 'svelte',
      validCode: `import type { Meta, StoryObj } from '@storybook/svelte';
export default { title: 'Test' };`,
      invalidCode: `import React from 'react';
export default { title: 'Test' };`,
    },
    {
      framework: 'web-components',
      validCode: `import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
export default { title: 'Test' };`,
      invalidCode: `import React from 'react';
export default { title: 'Test' };`,
    },
  ];

  for (const { framework, validCode, invalidCode } of testCases) {
    const adapter = registry.getAdapter(framework);

    // Test valid code
    const validResult = adapter.validate(validCode);
    const validStatus = validResult.valid ? '✅' : '❌';

    // Test invalid code
    const invalidResult = adapter.validate(invalidCode);
    const invalidStatus = !invalidResult.valid ? '✅' : '❌';

    console.log(`  ${adapter.name}:`);
    console.log(`    Valid code test: ${validStatus}`);
    console.log(`    Invalid code test: ${invalidStatus}`);
    if (!validResult.valid) {
      console.log(`    Errors in valid code: ${validResult.errors.join(', ')}`);
    }
  }

  // 4. Test post-processing
  console.log('\n🔧 Post-Processing Tests:');
  const jsxCode = `import React from 'react';
const Component = () => <div className="test" onClick={handleClick}>Content</div>;`;

  for (const framework of ['vue', 'angular', 'svelte', 'web-components'] as FrameworkType[]) {
    const adapter = registry.getAdapter(framework);
    const processed = adapter.postProcess(jsxCode);
    const hasClassName = processed.includes('className=');
    const hasClass = processed.includes('class=');

    console.log(`  ${adapter.name}:`);
    console.log(`    className -> class: ${!hasClassName && hasClass ? '✅' : '⚠️ (may vary)'}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Framework Adapter Verification Complete\n');
}

verifyAdapters().catch(console.error);
