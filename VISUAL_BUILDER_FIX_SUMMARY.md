# Visual Builder Fix Summary

## Issues Fixed

### 1. ✅ Visual Builder Shows Placeholder Instead of Components
**Problem**: When clicking "Edit in Visual Builder", the Visual Builder showed placeholder text instead of actual components.

**Root Cause**: The VisualBuilderDecorator was sending the full file path (`./src/stories/generated/basic-card-with-image-ac857807.stories.tsx`) to the MCP server, causing 404 errors.

**Fix**: Updated `VisualBuilderDecorator.tsx` to clean the fileName parameter, stripping directory paths and extensions before sending to MCP server.

```typescript
// Strip directory path and extension
fileName = fileName
  .replace(/^\.\//, '') // Remove leading ./
  .replace(/^.*\//, '') // Remove all directory paths
  .replace(/\.stories\.(tsx?|jsx?)$/, '') // Remove .stories.tsx extension
```

### 2. ✅ Save Fails with 500 Error (Style Syntax Issue)
**Problem**: Saving edited stories failed with "Invalid style syntax detected" error.

**Root Cause**: The storyToBuilder parser was converting numeric style values to strings, causing the generator to produce incorrect JSX.

**Fix**: Updated `storyToBuilder.ts` to preserve numeric values in style props:

```typescript
// Preserve numeric values as numbers
if (/^\d+$/.test(styleValue)) {
  styleValue = parseInt(styleValue, 10);
} else if (/^\d*\.\d+$/.test(styleValue)) {
  styleValue = parseFloat(styleValue);
}
```

### 3. ✅ Visual Builder Doesn't Load Imported Components
**Problem**: VisualBuilder.stories.tsx imported story data but VisualBuilder component showed "No code to load, starting with empty canvas".

**Root Cause**: VisualBuilder.stories.tsx was clearing sessionStorage before the VisualBuilder component could read it.

**Fix**: 
- Removed early sessionStorage clearing from VisualBuilder.stories.tsx
- Made VisualBuilder component clear sessionStorage after reading to prevent re-loading issues

## System Architecture

### Data Flow
1. **User clicks "Edit in Visual Builder"** in Storybook
   - VisualBuilderDecorator fetches story source from MCP server
   - Stores source in sessionStorage
   - Opens Visual Builder in new tab

2. **Visual Builder loads**
   - VisualBuilder.stories.tsx reads from sessionStorage
   - Imports story data into store using `importFromStoryUI()`
   - VisualBuilder component also reads sessionStorage (for initialization)
   - Components are parsed and displayed for editing

3. **User edits and saves**
   - Components are converted to JSX with proper formatting
   - Sent to MCP server's `/visual-builder/update` endpoint
   - Server generates story file and saves to edited/ directory
   - User sees success message

## Key Files

### Frontend
- `/test-storybooks/mantine-storybook/src/stories/decorators/VisualBuilderDecorator.tsx`
  - Adds "Edit in Visual Builder" button to stories
  - Fetches story source and stores in sessionStorage
  
- `/visual-builder/components/VisualBuilder.tsx`
  - Main Visual Builder component
  - Reads from sessionStorage and initializes with story data
  
- `/visual-builder/utils/storyToBuilder.ts`
  - Parses story JSX to Visual Builder components
  - Preserves numeric values in style props
  
- `/visual-builder/utils/storyFileUpdater.ts`
  - Generates story file content from components
  - Validates JSX syntax before saving

### Backend
- `/mcp-server/routes/updateStory.ts`
  - Handles story save requests
  - Saves to edited/ directory with proper naming

## Critical Patterns

### 1. File Name Handling
The system expects clean file names without paths or extensions:
- ✅ `basic-card-with-image-ac857807`
- ❌ `./src/stories/generated/basic-card-with-image-ac857807.stories.tsx`

### 2. Style Prop Format
Style props must use double curly braces in JSX:
- ✅ `style={{ maxWidth: 340 }}`
- ❌ `style="{ maxWidth: 340 }"`

Numeric values should remain numbers:
- ✅ `maxWidth: 340` (number)
- ⚠️ `maxWidth: '340'` (string - works but not ideal)

### 3. SessionStorage Usage
Used for passing data between Storybook and Visual Builder:
- `visualBuilderInitialCode` - Story source code
- `visualBuilderSourceFile` - Original file name
- `visualBuilderStoryVariant` - Story variant (Default, etc.)

Cleared after reading to prevent re-loading issues on page refresh.

## Design System Agnostic Approach

The Visual Builder is designed to work with any React component library:
- Parser handles generic JSX structures
- Component mappings are configurable
- No hard-coded Mantine dependencies in core logic

## Testing

### Manual Test Steps
1. Generate a story with Story UI
2. Navigate to the story in Storybook
3. Click "Edit in Visual Builder"
4. Verify components load correctly
5. Make an edit (change text, add component, etc.)
6. Click "Save Story"
7. Verify save succeeds
8. Refresh Storybook and check edited story appears

### Console Verification
When working correctly, you should see:
```
✅ MCP server successfully fetched story
📂 SessionStorage check: { hasCode: true, ... }
🎉 Story UI import result: { success: true, ... }
✅ Successfully loaded story from: [filename]
💾 Saved story to draft with ID: story-xxxxx
✅ Updated story file: edited-[filename].stories.tsx
```

## Known Limitations

1. **Vite HMR**: Changes to edited stories require manual Storybook refresh
2. **Complex Styles**: Some complex style objects may need manual adjustment
3. **Component Children**: Text content between tags needs proper handling

## Future Improvements

1. **Better Error Messages**: More specific error descriptions for common issues
2. **Hot Reload**: Automatic Storybook refresh after save
3. **Undo/Redo**: Add history management to Visual Builder
4. **Validation**: Pre-save validation to catch issues before server call
5. **Batch Operations**: Allow editing multiple stories at once

## Troubleshooting

### Issue: "Failed to save story"
1. Check browser console for specific error
2. Verify MCP server is running on port 4001
3. Check file permissions in edited/ directory

### Issue: Components don't load
1. Check browser console for parsing errors
2. Verify sessionStorage contains story data
3. Check for Vite-transformed code (should be raw source)

### Issue: Style props incorrect
1. Verify numeric values aren't quoted in original story
2. Check parser is preserving numeric types
3. Validate generated JSX syntax

## Summary

The Visual Builder integration is now working end-to-end with proper:
- File name handling
- Style prop preservation  
- Component loading
- Save functionality

The system is more robust with better error handling and clearer data flow between components.