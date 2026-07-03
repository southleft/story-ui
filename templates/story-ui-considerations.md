# Story UI AI Considerations

This file contains **rules for how the AI should treat your design system** when
generating stories — its behavior, constraints, and permissions. It is not the
place for design system documentation itself:

- **`story-ui-docs/`** → what your design system IS (component docs, design
  tokens, patterns, guidelines — Markdown, JSON, YAML, or XML files).
- **`story-ui-considerations.md`** (this file) → how the AI must USE it
  (do's and don'ts, approximation rules, and any explicit permissions).

By default the AI is restricted to components importable from your configured
library. If you want to permit an additional package (for example an icon or
charting library), name its import path explicitly in this file — e.g.
"Allowed additional imports: `@tabler/icons-react`". Packages not named here
and not part of your configured library are rejected during validation.

## Component Library Details

**Library Name**: [Your Component Library]
**Import Path**: `[your-import-path]`

## Core Principles

<!-- Add the fundamental principles of your design system -->
-
-
-

## Component Usage Rules

### Layout Components
<!-- Describe how layouts should be structured -->
-
-
-

### Spacing and Sizing
<!-- Explain your spacing/sizing system -->
-
-
-

### Color System
<!-- Describe how colors should be used -->
-
-
-

## Import Guidelines

### Primary Imports
<!-- List components that should be imported from the main package -->
```javascript
import { Component1, Component2 } from 'main-package';
```

### Secondary Imports
<!-- List any additional packages and when to use them -->
```javascript
// Only for specific use cases:
import { SpecialUtil } from 'secondary-package';
```

## Common Patterns

### Card Layouts
```jsx
// Example of proper card structure
```

### Form Layouts
```jsx
// Example of proper form structure
```

### Grid Layouts
```jsx
// Example of proper grid structure
```

## Do's and Don'ts

### ✅ DO
-
-
-

### ❌ DON'T
-
-
-

## Special Considerations

<!-- Add any library-specific quirks or important notes -->
-
-
-

## Examples of Correct Usage

### Example 1: [Component Name]
```jsx
// Show a complete, correct example
```

### Example 2: [Component Name]
```jsx
// Show another complete, correct example
```

## Error Patterns to Avoid

<!-- List common mistakes and how to avoid them -->
1. **Wrong**: `<div>...</div>`
   **Right**: `<View>...</View>`
   **Why**: [Explanation]

2. **Wrong**: `style={{margin: '10px'}}`
   **Right**: `margin="size-100"`
   **Why**: [Explanation]
