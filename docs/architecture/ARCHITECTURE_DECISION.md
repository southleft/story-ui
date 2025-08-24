# Visual Builder Architecture Decision

## Date: 2024-08-22

## Status: Implemented

## Context
The Visual Builder component was initially duplicated in both the main Story UI package and the test Mantine Storybook environment, causing:
- Code bifurcation and maintenance burden
- Confusion about which version is authoritative
- Divergent features between the two copies
- Testing environment not matching real user experience

## Decision
We have consolidated all Visual Builder code into the main Story UI package (`/visual-builder/`) and removed the duplicate from the test storybook environment.

## Architecture Principles

### 1. Single Source of Truth
- All Visual Builder code lives in `/visual-builder/` within the main Story UI package
- No duplicate code in test environments
- Changes only need to be made in one place

### 2. Package-Based Distribution
- Visual Builder is exported from `@tpitre/story-ui/visual-builder`
- Test environments import it exactly like real users would
- No special file copying during `npx story-ui init`

### 3. User Experience Parity
The test Mantine Storybook now imports Visual Builder the same way a real user would:
```typescript
import { VisualBuilder } from '@tpitre/story-ui/visual-builder';
```

This ensures our testing environment accurately reflects the real user experience after running:
```bash
npm install @tpitre/story-ui
npx story-ui init
```

## Implementation Details

### What Was Changed
1. Removed `/test-storybooks/mantine-storybook/src/visual-builder/` directory
2. Updated all imports to use `@tpitre/story-ui/visual-builder`
3. Fixed React import issues in story files
4. Added CSS array sanitization to prevent DOM errors

### File Structure
```
story-ui-repo/
├── visual-builder/          # Single source of Visual Builder code
│   ├── components/         # All Visual Builder components
│   ├── config/            # Component registry (39 components)
│   ├── store/             # Zustand state management
│   ├── utils/             # Parsing and utilities
│   └── index.ts           # Public exports
├── dist/
│   └── visual-builder/    # Compiled version for distribution
└── test-storybooks/
    └── mantine-storybook/
        └── src/           # No visual-builder directory here!
```

### Export Strategy
The Visual Builder is exported as a subpackage:
- Main export: `@tpitre/story-ui` (CLI and core functionality)
- Visual Builder: `@tpitre/story-ui/visual-builder` (UI components)

## Benefits

1. **Maintainability**: Single codebase to maintain
2. **Consistency**: All users get the same Visual Builder
3. **Testing Accuracy**: Test environment matches production
4. **Simplicity**: No complex file copying during initialization
5. **Version Control**: Visual Builder versioned with main package

## Consequences

### Positive
- Reduced maintenance burden
- Clear ownership and source of truth
- Better testing that reflects real usage
- Simpler initialization process
- Easier debugging and development

### Negative
- None identified - this aligns with standard npm package practices

## Notes for Future Development

1. The Visual Builder is always distributed as part of the main Story UI package
2. No files need to be copied during `npx story-ui init` for Visual Builder
3. Test environments should always use `npm link` to test the package version
4. All Visual Builder improvements should be made in `/visual-builder/` only

## Related Issues Fixed
- CSS array property errors (arrays in styles now sanitized)
- React import errors (switched to named imports)
- Component registry with 39 Mantine components
- SpacingControl (Figma-like box model)
- GridCol container support
- Story Manager save/load functionality