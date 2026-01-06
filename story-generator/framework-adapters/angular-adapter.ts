/**
 * Angular Framework Adapter
 *
 * Generates Storybook stories for Angular components.
 * Supports standalone components and module-based components.
 */

import * as path from 'path';
import {
  FrameworkType,
  StoryFramework,
  StoryGenerationOptions,
} from './types.js';
import { BaseFrameworkAdapter } from './base-adapter.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';

export class AngularAdapter extends BaseFrameworkAdapter {
  readonly type: FrameworkType = 'angular';
  readonly name = 'Angular';
  readonly supportedStoryFrameworks: StoryFramework[] = [
    'storybook-angular',
    'chromatic',
  ];
  readonly defaultExtension = '.stories.ts';

  /**
   * Get glob patterns for Angular component files
   */
  getComponentFilePatterns(): string[] {
    return ['**/*.component.ts', '**/*.ts'];
  }

  /**
   * Extract component names from an Angular source file.
   * Handles @Component decorators and NgModule exports.
   */
  extractComponentNamesFromFile(filePath: string, content: string): string[] {
    const names: Set<string> = new Set();

    // Pattern 1: @Component decorator with class
    // @Component({ selector: 'app-name' }) export class NameComponent
    const componentRegex = /@Component\s*\(\s*\{[\s\S]*?\}\s*\)\s*export\s+class\s+(\w+)/g;
    let match;
    while ((match = componentRegex.exec(content)) !== null) {
      names.add(match[1]);
    }

    // Pattern 2: NgModule exports array - for barrel files
    const exportsArrayRegex = /exports\s*:\s*\[([\s\S]*?)\]/g;
    while ((match = exportsArrayRegex.exec(content)) !== null) {
      const exportsContent = match[1];
      const componentNames = exportsContent
        .split(',')
        .map(item => item.trim())
        .filter(item => item && !item.startsWith('//') && /^[A-Z]/.test(item));
      componentNames.forEach(name => names.add(name));
    }

    // Pattern 3: Named exports from barrel files
    // export { NameComponent } from './name.component'
    const namedExportRegex = /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const exports = match[1].split(',');
      for (const exp of exports) {
        const namePart = exp.trim().split(/\s+as\s+/).pop()?.trim() || '';
        if (/^[A-Z][A-Za-z0-9]*(?:Component)?$/.test(namePart)) {
          names.add(namePart);
        }
      }
    }

    // Pattern 4: export * from './path' - track for further resolution
    // (handled at discovery level, not here)

    // Filter out non-components (services, modules, etc.)
    const filteredNames = Array.from(names).filter(name => {
      // Keep if ends with Component or doesn't end with Service/Module/Directive/Pipe
      return name.endsWith('Component') || 
        (!name.endsWith('Service') && 
         !name.endsWith('Module') && 
         !name.endsWith('Directive') && 
         !name.endsWith('Pipe'));
    });

    return filteredNames;
  }

  generateSystemPrompt(
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string {
    if (config.systemPrompt) {
      return config.systemPrompt;
    }

    const componentSystemName = config.componentPrefix
      ? `${config.componentPrefix.replace(/^[A-Z]+/, '')} design system`
      : 'component library';

    return `You are an expert Angular developer creating Storybook stories using CSF 3.0 format.
Use ONLY the Angular components from the ${componentSystemName} listed below.

MANDATORY IMPORTS - First lines of every story file:
1. import type { Meta, StoryObj } from '@storybook/angular';
2. import { ComponentName } from '${config.importPath || 'your-library'}';

ANGULAR STORY FORMAT:
- Use moduleMetadata for imports and providers
- Components can be standalone or module-based
- Use applicationConfig for standalone components

STORY STRUCTURE (CSF 3.0):
- Meta object with component, title, and decorators
- Use render function for template customization
- Export named stories as StoryObj

CRITICAL RULES:
- Import modules/components in moduleMetadata or applicationConfig
- Use Angular template syntax in render functions
- Event bindings use (event) syntax

TYPESCRIPT STRICT MODE COMPATIBILITY (CRITICAL):
- NEVER use "this.property" syntax in render functions or templates
- NEVER try to manage state with "this.isEnabled", "this.clickCount++", etc.
- Angular Storybook stories should be STATELESS - show component states via args
- For interactive demos, use argTypes with action: 'actionName' for event logging
- The args object has an index signature - direct property access causes TS4111 errors

CORRECT PATTERNS FOR INTERACTIVITY:
1. For events - use argTypes actions, NOT state management:
   argTypes: { onChange: { action: 'changed' } }

2. For showing states - create separate stories:
   export const Enabled: Story = { args: { checked: true } };
   export const Disabled: Story = { args: { checked: false } };

3. NEVER generate code like:
   - this.isEnabled = event.checked; // TS4111 ERROR
   - this.clickCount++; // TS4111 ERROR
   - props.someValue = newValue; // Will not work

Example structure (Standalone Components):
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, argsToTemplate } from '@storybook/angular';
import { ButtonComponent } from 'your-library';

const meta: Meta<ButtonComponent> = {
  title: 'Generated/Button',
  component: ButtonComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [],
    }),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
  },
};

export default meta;
type Story = StoryObj<ButtonComponent>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    label: 'Click me',
  },
};

export const WithContent: Story = {
  render: (args) => ({
    props: args,
    template: \`
      <app-button [variant]="variant">
        <span class="icon">★</span>
        Click me
      </app-button>
    \`,
  }),
};
\`\`\`

Example structure (Module-based Components):
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { ButtonModule } from 'your-library';

const meta: Meta = {
  title: 'Generated/Button',
  tags: ['autodocs'],
  decorators: [
    moduleMetadata({
      imports: [ButtonModule],
    }),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
  },
};

export default meta;
type Story = StoryObj;

export const Primary: Story = {
  render: (args) => ({
    props: args,
    template: \`<app-button [variant]="variant">Click me</app-button>\`,
  }),
};
\`\`\`

ANGULAR TEMPLATE SYNTAX:
- Property binding: [property]="value"
- Event binding: (event)="handler($event)"
- Two-way binding: [(ngModel)]="value"
- Structural directives: *ngIf, *ngFor, *ngSwitch

CONTENT PROJECTION (ng-content):
- Default slot: Content between tags
- Named slots: Use ngProjectAs or select attribute

MATERIAL ICONS (CRITICAL - If using @angular/material):
- ALWAYS use full icon names, NEVER abbreviate: "favorite" (not "fav"), "home" (not "ho"), "delete" (not "de"), "settings" (not "se")
- Always import MatIconModule in moduleMetadata when using <mat-icon>
- Correct syntax: <mat-icon>favorite</mat-icon>, <mat-icon>home</mat-icon>
- Common icons: home, favorite, delete, settings, search, menu, close, add, remove, edit, save, cancel, check, arrow_back, arrow_forward
- For filled variants: favorite, star, check_circle
- For outlined variants: favorite_border, star_border, check_circle_outline

${this.getCommonRules()}`;
  }

  generateExamples(config: StoryUIConfig): string {
    const lib = config.importPath || 'your-library';

    return `
## Example Stories for Angular

### Standalone Component
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { ButtonComponent } from 'your-library';

const meta: Meta<ButtonComponent> = {
  title: 'Generated/Button',
  component: ButtonComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [],
    }),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
  },
};

export default meta;
type Story = StoryObj<ButtonComponent>;

export const Default: Story = {
  args: {
    variant: 'primary',
    size: 'medium',
    label: 'Button',
  },
};

export const AllVariants: Story = {
  render: () => ({
    template: \`
      <div style="display: flex; gap: 8px;">
        <app-button variant="primary">Primary</app-button>
        <app-button variant="secondary">Secondary</app-button>
        <app-button variant="ghost">Ghost</app-button>
      </div>
    \`,
  }),
};
\`\`\`

### Module-based Component
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { CardModule, ButtonModule } from '${lib}';

const meta: Meta = {
  title: 'Generated/Card',
  tags: ['autodocs'],
  decorators: [
    moduleMetadata({
      imports: [CardModule, ButtonModule],
    }),
  ],
};

export default meta;
type Story = StoryObj;

export const ProductCard: Story = {
  render: () => ({
    template: \`
      <app-card style="width: 300px">
        <img appCardImage src="https://picsum.photos/300/200" alt="Product">
        <h3 appCardTitle>Product Name</h3>
        <p appCardContent>$99.00</p>
        <app-button appCardAction variant="primary">Add to Cart</app-button>
      </app-card>
    \`,
  }),
};
\`\`\`

### With Event Handling (STATELESS - CORRECT PATTERN)
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { ButtonComponent } from 'your-library';

const meta: Meta<ButtonComponent> = {
  title: 'Generated/Button',
  component: ButtonComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [],
    }),
  ],
  argTypes: {
    // Use argTypes with action for event logging - DO NOT manage state
    onClick: { action: 'clicked' },
    onToggle: { action: 'toggled' },
  },
};

export default meta;
type Story = StoryObj<ButtonComponent>;

// CORRECT: Events logged via argTypes actions
export const WithClick: Story = {
  render: (args) => ({
    props: args,
    template: \`
      <app-button (click)="onClick($event)" variant="primary">
        Click me
      </app-button>
    \`,
  }),
};

// CORRECT: Show different states via separate stories
export const EnabledState: Story = {
  args: { disabled: false },
};

export const DisabledState: Story = {
  args: { disabled: true },
};

// WRONG - DO NOT DO THIS (causes TS4111 error):
// export const Interactive: Story = {
//   render: (args) => ({
//     props: { ...args, isEnabled: false },
//     template: \`<mat-slide-toggle (change)="this.isEnabled = $event.checked">\`,
//   }),
// };
\`\`\`

### With Forms
\`\`\`typescript
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { InputModule } from '${lib}';

const meta: Meta = {
  title: 'Generated/Input',
  tags: ['autodocs'],
  decorators: [
    moduleMetadata({
      imports: [FormsModule, ReactiveFormsModule, InputModule],
    }),
  ],
};

export default meta;
type Story = StoryObj;

export const WithNgModel: Story = {
  render: () => ({
    props: {
      value: '',
    },
    template: \`
      <div>
        <app-input [(ngModel)]="value" placeholder="Type here..."></app-input>
        <p>Value: {{ value }}</p>
      </div>
    \`,
  }),
};
\`\`\`
`;
  }

  generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string {
    const lib = config.importPath || 'your-library';
    const firstComponent = components[0];

    if (!firstComponent) {
      return `
import type { Meta, StoryObj } from '@storybook/angular';

const meta: Meta = {
  title: 'Examples/Sample',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: '<div>Sample story content</div>',
  }),
};
`;
    }

    // Convert PascalCase to kebab-case for selector
    const selector = this.toKebabCase(firstComponent.name);

    return `
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { ${firstComponent.name}Component } from '${lib}';

const meta: Meta<${firstComponent.name}Component> = {
  title: 'Generated/${firstComponent.name}',
  component: ${firstComponent.name}Component,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [],
    }),
  ],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<${firstComponent.name}Component>;

export const Default: Story = {
  args: {},
};
`;
  }

  getStoryTemplate(options?: StoryGenerationOptions): string {
    return `
// {{componentName}}.stories.ts
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { {{componentName}}Component } from '{{importPath}}';

const meta: Meta<{{componentName}}Component> = {
  title: '{{category}}/{{componentName}}',
  component: {{componentName}}Component,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [],
    }),
  ],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<{{componentName}}Component>;

export const Default: Story = {
  args: {},
};
`;
  }

  /**
   * Convert PascalCase to kebab-case for selectors
   */
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
  }

  /**
   * Post-process Angular stories
   */
  postProcess(storyContent: string): string {
    let processed = super.postProcess(storyContent);

    // Remove React imports if present
    processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');

    // Fix JSX to Angular template syntax
    processed = processed
      // Fix className to class
      .replace(/className=/g, 'class=')
      // Fix onClick to (click)
      .replace(/onClick=/g, '(click)=')
      .replace(/onChange=/g, '(change)=')
      .replace(/onInput=/g, '(input)=');

    return processed;
  }

  /**
   * Validate Angular story
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate(storyContent);
    const errors = [...baseValidation.errors];

    // Angular-specific validations
    if (!storyContent.includes('@storybook/angular')) {
      errors.push("Missing '@storybook/angular' import");
    }

    if (storyContent.includes("import React from 'react'")) {
      errors.push('React import found in Angular story');
    }

    // Check for neither moduleMetadata nor applicationConfig
    if (
      !storyContent.includes('moduleMetadata') &&
      !storyContent.includes('applicationConfig') &&
      !storyContent.includes('component:')
    ) {
      errors.push('Missing moduleMetadata or applicationConfig decorator');
    }

    // Check for TS4111-causing patterns (noPropertyAccessFromIndexSignature)
    // These patterns cause errors when strict TypeScript is enabled
    const ts4111Patterns = [
      /this\.\w+\s*=\s*\w+/g,  // this.property = value
      /this\.\w+\+\+/g,        // this.property++
      /this\.\w+--/g,          // this.property--
      /\+\+this\.\w+/g,        // ++this.property
      /--this\.\w+/g,          // --this.property
    ];

    for (const pattern of ts4111Patterns) {
      if (pattern.test(storyContent)) {
        errors.push(
          'Angular stories should not use "this.property" state management. ' +
          'Use args-based patterns instead. This causes TS4111 errors with strict TypeScript.'
        );
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Factory function
 */
export function createAngularAdapter(): AngularAdapter {
  return new AngularAdapter();
}
