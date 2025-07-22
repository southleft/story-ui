# Custom Documentation Integration for Story UI

## Overview

Allow teams to provide their own documentation (PDFs, Markdown, URLs) that Story UI can use to generate better, more accurate stories that follow their specific design guidelines.

## Implementation Options

### Option 1: Documentation Directory (Recommended)

```
my-project/
├── .storybook/
├── src/
└── story-ui-docs/              # Custom documentation directory
    ├── guidelines.md           # Design guidelines
    ├── tokens.md              # Design tokens documentation
    ├── patterns/              # Pattern examples
    │   ├── forms.md
    │   ├── cards.md
    │   └── layouts.md
    └── manifest.json          # Documentation index

```

### Option 2: Enhanced Considerations File

Extend the current `story-ui-considerations.md` to support:
- External documentation links
- Embedded documentation sections
- Reference to local files

```markdown
# Story UI AI Considerations

## External Documentation
- Design System Guide: https://our-design-system.com/guide
- Component Library: ./docs/components.pdf
- Token Reference: ./docs/design-tokens.md

## Embedded Guidelines
...
```

### Option 3: Story UI Config Extension

```javascript
// story-ui.config.js
module.exports = {
  importPath: '@our/design-system',
  
  // New documentation section
  documentation: {
    sources: [
      {
        type: 'markdown',
        path: './docs/design-guidelines.md'
      },
      {
        type: 'url',
        url: 'https://our-design-system.com/api',
        sections: ['components', 'tokens', 'patterns']
      },
      {
        type: 'pdf',
        path: './docs/component-library.pdf',
        // PDF would be converted to text for AI consumption
      }
    ],
    
    // Specific guidelines that override general rules
    guidelines: {
      spacing: 'Use 8px grid system with tokens: space-1 through space-12',
      colors: 'Only use semantic color tokens, never hex values',
      typography: 'Use Text component with predefined variants only'
    }
  }
};
```

## Implementation Details

### 1. Documentation Loader

```typescript
export class DocumentationLoader {
  async loadDocumentation(config: StoryUIConfig): Promise<Documentation> {
    const docs: Documentation = {
      guidelines: [],
      components: {},
      patterns: {},
      tokens: {}
    };

    for (const source of config.documentation.sources) {
      switch (source.type) {
        case 'markdown':
          docs.guidelines.push(await this.loadMarkdown(source.path));
          break;
        case 'url':
          docs.guidelines.push(await this.fetchUrl(source.url));
          break;
        case 'pdf':
          docs.guidelines.push(await this.parsePdf(source.path));
          break;
      }
    }

    return docs;
  }
}
```

### 2. Enhanced Prompt Generation

```typescript
async function buildPromptWithCustomDocs(userPrompt: string, config: any) {
  const customDocs = await documentationLoader.loadDocumentation(config);
  
  let enhancedPrompt = basePrompt;
  
  if (customDocs.guidelines.length > 0) {
    enhancedPrompt += '\n\n📚 DESIGN SYSTEM DOCUMENTATION:\n';
    enhancedPrompt += customDocs.guidelines.join('\n\n');
  }
  
  if (customDocs.patterns) {
    enhancedPrompt += '\n\n🎨 DESIGN PATTERNS:\n';
    enhancedPrompt += formatPatterns(customDocs.patterns);
  }
  
  return enhancedPrompt;
}
```

### 3. Benefits

1. **Team-Specific Guidelines** - Each team can provide their exact requirements
2. **Always Up-to-Date** - Documentation lives with the codebase
3. **Non-Developer Friendly** - Just drop files in a folder
4. **Flexible Formats** - Support multiple documentation formats
5. **Hosted Friendly** - Works well with Vercel/Netlify deployments

## Migration Path

1. Start with enhanced considerations file (minimal change)
2. Add documentation directory support
3. Eventually support full config-based documentation

## Example Use Case

A team using Material-UI with custom design tokens:

```
story-ui-docs/
├── design-tokens.md         # Our spacing, color, typography tokens
├── component-overrides.md   # How we customize MUI components  
├── patterns/
│   ├── forms.md            # Our form patterns
│   └── data-tables.md      # Our table patterns
└── guidelines.pdf          # Company design guidelines
```

Story UI would read all these files and use them to generate stories that perfectly match the team's design system implementation.
