# Visual Builder Save Workflow - Comprehensive Fix

## Problem Summary
When editing a story in Visual Builder and saving it, the story was reported as "successfully saved" but didn't appear in the Edited section of Storybook navigation. The console showed it was saving with incorrect names and titles.

## Root Causes Identified

### 1. **Title Generation Bug**
- **Issue**: Story titles were becoming malformed (e.g., `'Edited/Generated/Architecture Test Story'`)
- **Location**: `/visual-builder/utils/storyFileUpdater.ts`
- **Fix**: Strip existing "Generated/" or "Edited/" prefixes before adding the "Edited/" prefix

### 2. **File Naming Issue**
- **Issue**: Files were saved as `generated-architecture-test-story.stories.tsx` instead of `edited-*`
- **Location**: `/visual-builder/utils/storyFileUpdater.ts` 
- **Fix**: Replace "generated-" prefix with "edited-" for edited stories

### 3. **Directory Structure Issue**
- **Issue**: Edited stories were overwriting original files in the `generated/` directory
- **Location**: `/mcp-server/routes/updateStory.ts`
- **Fix**: Create and use an `edited/` subdirectory for edited stories

### 4. **Save Dialog Prompting Issue**
- **Issue**: Visual Builder was prompting for story names when editing existing stories
- **Location**: `/visual-builder/components/VisualBuilder.tsx`
- **Fix**: Check `isImportedFromStory` flag to prevent unnecessary prompts

## Implementation Details

### File Structure Changes
```
src/stories/
├── generated/          # Original generated stories
│   └── architecture-test.stories.tsx
└── edited/            # NEW: Edited stories directory
    └── edited-architecture-test.stories.tsx
```

### Code Changes Applied

#### 1. Story Title Stripping (`storyFileUpdater.ts`)
```typescript
// Strip existing prefix before adding "Edited/"
const baseTitle = storyName
  .replace(/^(Generated|Edited)\//i, '') // Remove existing prefix
  .replace(/([A-Z])/g, ' $1')
  .trim();
```

#### 2. File Naming Logic (`storyFileUpdater.ts`)
```typescript
// Replace 'generated-' prefix with 'edited-'
if (fileName.startsWith('generated-')) {
  fileName = fileName.replace(/^generated-/, 'edited-');
} else if (!fileName.startsWith('edited-')) {
  fileName = 'edited-' + fileName.replace(/^(workflow-|test-|demo-)/, '');
}
```

#### 3. Directory Routing (`updateStory.ts`)
```typescript
// Save edited stories to edited/ subdirectory
if (isEditedStory) {
  const editedPath = path.join(config.generatedStoriesPath, '..', 'edited');
  if (!fs.existsSync(editedPath)) {
    fs.mkdirSync(editedPath, { recursive: true });
  }
  targetPath = path.join(editedPath, cleanFileName);
}
```

#### 4. Request Flag (`storyFileUpdater.ts`)
```typescript
body: JSON.stringify({
  fileName,
  filePath,
  components,
  storyName,
  isEdited: true, // Flag to indicate this is an edited story
  createBackup: false
})
```

## Complete User Workflow

### Step 1: Generate Story
1. User creates story in Story UI chat
2. Story appears in Storybook under "Generated/" section
3. "Edit in Visual Builder" button appears on all story variants

### Step 2: Edit Story
1. User clicks "Edit in Visual Builder" button
2. Story loads in Visual Builder with correct name extraction
3. User makes visual edits (drag/drop, property changes)

### Step 3: Save Edited Story
1. User clicks "Save Story" button
2. **NO prompt for name** (uses existing story name)
3. Story saves to `edited/` directory with "edited-" prefix
4. Success message shows with instruction to refresh Storybook

### Step 4: View Edited Story
1. User refreshes Storybook
2. Edited story appears under "Edited/" navigation section
3. Original story remains unchanged in "Generated/" section
4. Both versions are accessible for comparison

### Step 5: Re-edit Story (Optional)
1. User can click "Edit in Visual Builder" on edited story
2. Makes additional changes
3. Saves over the previous edited version
4. Changes persist across sessions

## Files Modified

1. **`/visual-builder/utils/storyFileUpdater.ts`**
   - Fixed title generation to strip existing prefixes
   - Updated file naming to use "edited-" prefix
   - Added `isEdited` flag to server request

2. **`/mcp-server/routes/updateStory.ts`**
   - Added logic to save edited stories to `edited/` subdirectory
   - Handles file name transformation (generated → edited)
   - Creates edited directory if it doesn't exist

3. **`/visual-builder/components/VisualBuilder.tsx`**
   - Fixed save dialog logic to check `isImportedFromStory` flag
   - Added fallback to sessionStorage for story names
   - Improved name extraction for existing stories

4. **`/visual-builder/store/visualBuilderStore.ts`**
   - Properly tracks `isImportedFromStory` state
   - Enhanced story name extraction with 7 methods
   - Maintains editing context throughout workflow

## Testing Checklist

- [x] Generate new story in Story UI
- [x] Verify "Edit in Visual Builder" button appears
- [x] Edit story in Visual Builder
- [x] Save without name prompt
- [x] Verify story appears in "Edited/" section
- [x] Verify original story remains unchanged
- [x] Re-edit saved story successfully
- [x] File created in `edited/` subdirectory
- [x] File name uses "edited-" prefix
- [x] Story title shows "Edited/" prefix

## Known Limitations & Future Improvements

1. **Hot Reload**: Storybook requires manual refresh to see edited stories
2. **Merge Conflicts**: No UI for merging edits if original story changes
3. **Version History**: No built-in versioning for edited stories
4. **Bulk Operations**: No way to edit multiple stories at once

## Success Indicators

✅ **No Save Dialog Prompts**: Editing existing stories never prompts for names
✅ **Proper Navigation**: Edited stories appear under "Edited/" section
✅ **File Separation**: Edited stories saved to `edited/` subdirectory
✅ **Name Consistency**: Files use "edited-" prefix consistently
✅ **Original Preservation**: Generated stories remain unchanged
✅ **Re-edit Support**: Can edit and save over previous edits

## Console Verification

When working correctly, console should show:
```
✅ Found title property: "Generated/Architecture Test Story"
✅ Successfully loaded story from: architecture-test.stories.tsx
💾 Saved story to draft with ID: story-xxxxx
✅ Story file updated via MCP server: edited-architecture-test.stories.tsx
✅ Updated story file: edited-architecture-test.stories.tsx
```

Note the file name is now "edited-" instead of "generated-".