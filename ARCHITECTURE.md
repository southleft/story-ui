# Story UI - Simplified Save Architecture

## 🎯 Design Philosophy

**One Story = One File**. No versions, no subdirectories, no confusion.

## Architecture Overview

### Before (Complex)
```
/generated/
  ├── story1.stories.tsx (original)
  ├── story2.stories.tsx (original)
  └── edited/                    ❌ Creates confusion
      ├── story1.stories.tsx     ❌ Duplicate management
      ├── generated-story2.stories.tsx  ❌ Naming mess
      └── generated/             ❌ Recursive directories!
          └── edited/
              └── ...            ❌ Infinite nesting
```

### After (Simple)
```
/generated/
  ├── story1.stories.tsx         ✅ Single source of truth
  ├── story2.stories.tsx         ✅ Direct overwrite
  ├── story3.backup.stories.tsx  ✅ Optional backup (rare)
  └── story4.stories.tsx         ✅ Clean, predictable
```

## User Workflow

### Story Creation
1. Generate story → `story-name.stories.tsx` created in `/generated/`
2. Story appears in Storybook immediately

### Story Editing
1. Open story in Visual Builder
2. Make changes
3. Click Save → **overwrites same file**
4. Changes appear in Storybook immediately

### Re-editing
1. Open same story again
2. Make more changes  
3. Save → **updates same file**
4. No new versions created

## Technical Implementation

### Key Files Changed

#### `/mcp-server/routes/updateStory.ts`
- **Removed**: `preserveOriginal` logic
- **Added**: Optional `createBackup` parameter (default: false)
- **Simplified**: Always save to main directory

```typescript
// Before
if (preserveOriginal) {
  const editedDir = path.join(config.generatedStoriesPath, 'edited');
  // Complex subdirectory logic...
}

// After  
const targetPath = path.join(config.generatedStoriesPath, cleanFileName);
if (createBackup && fs.existsSync(targetPath)) {
  fs.copyFileSync(targetPath, backupPath); // Simple backup
}
```

#### `/visual-builder/utils/storyFileUpdater.ts`
- **Removed**: `isEdited` parameter
- **Removed**: "(Edited)" title suffix  
- **Fixed**: Always use standard decorator import path

```typescript
// Before
const storyTitle = isEdited ? `${baseTitle} (Edited)` : baseTitle;
const decoratorPath = isEdited 
  ? '../../decorators/VisualBuilderDecorator'
  : '../decorators/VisualBuilderDecorator';

// After
const storyTitle = baseTitle;
const decoratorPath = '../decorators/VisualBuilderDecorator';
```

#### `/visual-builder/utils/storyFileManager.ts` (New)
- **Purpose**: Unified save system
- **Features**: Clean filename handling, no subdirectories
- **API**: Simple `saveStoryFile()` function

### Cleanup Script

We created `/scripts/cleanup-architecture.js` to migrate existing files:

1. **Move files**: `generated/edited/*` → `generated/*`
2. **Clean names**: Remove duplicate `generated-` prefixes  
3. **Fix imports**: Correct decorator import paths
4. **Remove dirs**: Delete empty `edited/` directories
5. **Create backups**: Only when files differ

## Benefits

### For Users
- ✅ **Predictable**: Save always updates the same file
- ✅ **Simple**: No version management to understand
- ✅ **Fast**: No decision paralysis about where to save
- ✅ **Clean**: Storybook sidebar stays organized

### For Developers  
- ✅ **Maintainable**: Single save code path
- ✅ **Testable**: Simple logic to test
- ✅ **Debuggable**: No complex path resolution
- ✅ **Scalable**: Works with any number of stories

### For System
- ✅ **Performance**: No recursive directory operations
- ✅ **Reliability**: Fewer failure points
- ✅ **Storage**: No duplicate story files
- ✅ **Security**: No path traversal risks

## Migration Guide

### For Existing Projects

1. **Backup your work**:
   ```bash
   cp -r src/stories/generated src/stories/generated-backup
   ```

2. **Run cleanup script**:
   ```bash
   node scripts/cleanup-architecture.js
   ```

3. **Test stories**:
   - Check all stories load in Storybook
   - Verify Visual Builder save works
   - Test import paths

4. **Remove backups** (once confident):
   ```bash
   rm src/stories/generated/*.backup.stories.tsx
   ```

### Breaking Changes

- ❌ **No more `/edited/` subdirectory**
- ❌ **No more "(Edited)" story titles**  
- ❌ **No more version management**
- ❌ **No more `preserveOriginal` parameter**

### Migration Path

- ✅ **Automatic**: Run cleanup script
- ✅ **Safe**: Creates backups only when needed
- ✅ **Reversible**: Keep backups until confident
- ✅ **Gradual**: Old files work until cleaned up

## Future Enhancements

### Optional Features (not implemented)
- **Git Integration**: Commit on save
- **Undo/Redo**: Session-based history
- **Templates**: Save as template
- **Sharing**: Export/import stories

### Explicitly Rejected
- ❌ **Versioning**: Use git instead
- ❌ **Subdirectories**: Keep flat structure  
- ❌ **Multiple save locations**: One truth source
- ❌ **Complex naming**: Keep simple

## FAQ

**Q: What if I want to keep the original?**  
A: Use git to track changes, or manually copy the file before editing.

**Q: Can I still create backups?**  
A: Yes, set `createBackup: true` in API calls, but UI doesn't use this.

**Q: What about existing edited files?**  
A: Run the cleanup script - it handles migration automatically.

**Q: Is this safe?**  
A: Yes, the cleanup script creates backups of any differing files.

**Q: Can I revert this change?**  
A: The old code is preserved in git history if needed.