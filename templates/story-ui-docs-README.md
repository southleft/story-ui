# Design System Documentation

This directory is automatically discovered by Story UI to enhance AI-generated stories with your design system's specific guidelines, tokens, and patterns.

## Directory Structure

Organize your documentation into these categories:

### `guidelines/`
Design principles, accessibility rules, brand guidelines
- `accessibility.md` - WCAG compliance, screen reader support
- `brand-guidelines.md` - Logo usage, voice, tone
- `responsive-design.md` - Breakpoints, mobile-first rules

### `tokens/`
Design tokens in JSON or Markdown format
- `colors.json` - Color palette, semantic colors
- `spacing.md` - Spacing scale, grid system
- `typography.json` - Font families, sizes, line heights
- `shadows.json` - Elevation, shadow tokens

### `components/`
Component-specific documentation
- `button.md` - Button variants, usage, examples
- `forms.md` - Form components, validation patterns
- `navigation.md` - Menu, breadcrumb patterns

### `patterns/`
Layout and interaction patterns
- `forms.md` - Form layout best practices
- `cards.md` - Card designs and usage
- `data-tables.md` - Table patterns, sorting, filtering

## Supported Formats

- **Markdown** (`.md`) - Rich documentation with examples
- **JSON** (`.json`) - Structured data like design tokens
- **HTML** (`.html`) - Complex documentation
- **Text** (`.txt`) - Simple notes and guidelines

## Usage

1. Add documentation files to the appropriate subdirectories
2. Story UI automatically discovers and loads all files
3. Documentation content enhances AI story generation
4. Files are categorized based on their directory location

## Tips

- Use clear, descriptive filenames
- Include examples and code snippets in Markdown files
- Structure JSON files with consistent naming conventions
- Keep documentation up-to-date with your design system

When you prompt Story UI to generate stories, this documentation will be automatically included in the AI context to create more accurate, design-system-compliant components.