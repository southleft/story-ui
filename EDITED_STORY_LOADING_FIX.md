# Edited Story Loading Fix

## Issue
When clicking "Edit in Visual Builder" on an edited story, it was loading the original generated story instead of the edited version.

## Root Cause
The Visual Builder decorator was not checking if a story was edited and was always fetching the source from the generated/ directory with the original filename.

## Solution Implemented

### 1. Detect Edited Stories
```typescript
// Check if this is an edited story
const isEditedStory = title?.startsWith('Edited/');
```

### 2. Adjust File Paths for Edited Stories
```typescript
if (isEditedStory) {
  // For edited stories, check in edited/ directory with edited- prefix
  const editedFileName = fileName.startsWith('edited-') ? fileName : 
                        fileName.replace(/^generated-/, 'edited-')
                        .replace(/^(?!edited-)/, 'edited-');
  possibleNames = [
    `edited/${editedFileName}`,
    `edited/edited-${cleanFileName}.stories.tsx`,
    editedFileName
  ];
}
```

### 3. Store Correct Metadata
```typescript
// For edited stories, ensure we store the correct filename
const fileToStore = isEditedStory && !fileName.startsWith('edited-') 
  ? fileName.replace(/^generated-/, 'edited-').replace(/^(?!edited-)/, 'edited-')
  : fileName;
sessionStorage.setItem('visualBuilderSourceFile', fileToStore);
sessionStorage.setItem('visualBuilderIsEdited', isEditedStory ? 'true' : 'false');
```

## Complete Workflow Now

1. **Generate Story** → Appears in Generated/ section
2. **Edit in Visual Builder** → Loads original correctly
3. **Save Changes** → Creates edited version in edited/ directory
4. **View Edited Story** → Appears in Edited/ section
5. **Edit Again** → **Now loads the edited version, not the original!**

## Files Modified
- `/test-storybooks/mantine-storybook/src/stories/decorators/VisualBuilderDecorator.tsx`

## Testing
To verify the fix:
1. Open an edited story in Storybook (from Edited/ section)
2. Click "Edit in Visual Builder"
3. Verify it shows your edited components (e.g., blue buttons)
4. Not the original components

The Visual Builder should now correctly load edited stories for re-editing!