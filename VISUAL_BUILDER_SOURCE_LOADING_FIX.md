# Visual Builder Source Loading Fix

## Issue
When clicking "Edit in Visual Builder" on newly generated stories, the Visual Builder was showing an empty canvas with placeholder text ("Component ready for editing in Visual Builder") instead of the actual story components.

## Root Cause
1. **Non-existent endpoint**: The Visual Builder decorator was trying to fetch from `/story-ui/story-source/` which didn't exist
2. **Wrong endpoint used**: Should have been using `/story-ui/visual-builder/load`
3. **File name resolution**: Stories with hash suffixes (e.g., `basic-card-781ccd01.stories.tsx`) weren't being found

## Solution

### 1. Fixed API Endpoint in Decorator
**File**: `/test-storybooks/mantine-storybook/src/stories/decorators/VisualBuilderDecorator.tsx`

Changed from:
```typescript
fetch(`http://localhost:${apiPort}/story-ui/story-source/${name}`)
```

To:
```typescript
fetch(`http://localhost:${apiPort}/story-ui/visual-builder/load?fileName=${encodeURIComponent(name)}`)
```

### 2. Enhanced File Resolution in Server
**File**: `/mcp-server/routes/updateStory.ts`

Added intelligent file lookup that:
- Checks generated directory first
- Falls back to edited directory
- **Handles hash-suffixed files** (e.g., finds `basic-card-781ccd01.stories.tsx` when looking for `basic-card.stories.tsx`)

```typescript
// Check if there's a file that starts with the base name
const matchingFile = files.find(file => 
  file.startsWith(baseFileName) && file.endsWith('.stories.tsx')
);
```

## Complete Fix Flow

1. User clicks "Edit in Visual Builder" on a generated story
2. Decorator extracts file name from story ID (e.g., "generated-basic-card" → "basic-card")
3. Fetches from correct endpoint: `/story-ui/visual-builder/load?fileName=basic-card`
4. Server finds the actual file `basic-card-781ccd01.stories.tsx` using pattern matching
5. Returns the full source code
6. Visual Builder successfully parses and displays the components

## Testing
To verify the fix:
1. Generate a new story in Story UI
2. Click "Edit in Visual Builder" 
3. ✅ Should see the actual card components (not placeholder text)
4. Edit and save
5. ✅ Edited story should appear in Edited/ section
6. Click "Edit in Visual Builder" on edited story
7. ✅ Should load the edited version

## Files Modified
- `/test-storybooks/mantine-storybook/src/stories/decorators/VisualBuilderDecorator.tsx` - Fixed endpoint URL
- `/mcp-server/routes/updateStory.ts` - Enhanced file resolution with hash support

The Visual Builder now correctly loads all story types!