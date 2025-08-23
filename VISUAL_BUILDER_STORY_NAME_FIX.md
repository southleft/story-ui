# Visual Builder Story Name Fix

## ✅ **Problem Resolved**

The Visual Builder was incorrectly prompting users for story names when editing existing stories that were opened via "Edit in Visual Builder" from Story UI chat sessions.

## **Root Cause Analysis**

### **Data Flow Issues:**
1. **Story Name Extraction**: The `importFromStoryUI` function only looked for simple `export const` patterns, missing story titles and metadata
2. **Generic Name Detection**: The save logic treated "Imported Story" as invalid, triggering prompts even for existing stories
3. **Context Loss**: No distinction between editing existing stories vs creating new ones

### **Specific Problems:**
- Stories with `title: "Story Name"` properties were not extracted properly
- Meta exports (`export default { title: "..." }`) were ignored  
- Comment annotations (`// @title Story Name`) were not parsed
- Save logic didn't differentiate between imported existing stories and new AI-generated content

## **Comprehensive Solution**

### **1. Enhanced Story Name Extraction**

**File:** `/visual-builder/utils/storyToBuilder.ts`

**New `extractStoryName()` Function:**
```typescript
export function extractStoryName(storyCode: string): string {
  // Priority order for name extraction:
  
  // 1. Story title property (title: "My Story") - HIGHEST PRIORITY
  // 2. Meta title (export default { title: "My Story" })
  // 3. Comment annotation (// @title My Story)
  // 4. JSDoc comment (@title My Story)
  // 5. Export const statement (export const MyStory = {...})
  // 6. Component name in JSX (return <MyComponent />)
  // 7. Function name (export function MyStory())
  
  // Returns 'Imported Story' as fallback
}
```

**Key Improvements:**
- ✅ **7 different extraction methods** with intelligent prioritization
- ✅ **Title properties take precedence** over export names
- ✅ **PascalCase to readable conversion** (MyStoryName → "My Story Name")
- ✅ **Comprehensive logging** for debugging extraction process
- ✅ **Fallback handling** for edge cases

### **2. Improved Save Logic**

**File:** `/visual-builder/components/VisualBuilder.tsx`

**Enhanced Save Button Logic:**
```typescript
// Only prompt for name if:
// 1. It's a generic name (Untitled/Imported), AND
// 2. It's NOT an existing story that we're editing

const isGenericName = !currentStoryName || 
  currentStoryName === 'Untitled Story' || 
  currentStoryName === 'Imported Story';

const isExistingStory = isImportedFromStory && components.length > 0 && !isGenericName;

if (isGenericName && !isExistingStory) {
  // Prompt for name - this is truly a new story
} else {
  // Don't prompt - this is an existing story or has a valid name
}
```

### **3. Better Context Passing**

**File:** `/templates/StoryUI/StoryUIPanel.tsx`

**Story Metadata Enhancement:**
```typescript
const getStoryMetadata = () => ({
  chatId: activeChatId,
  title: activeTitle,
  isExisting: activeChatId && conversation.length > 0,
  fileName: recentChats.find(chat => chat.id === activeChatId)?.fileName
});

// Pass to Visual Builder
<EmbeddedVisualBuilder 
  storyMetadata={getStoryMetadata()}
  // ... other props
/>
```

**File:** `/visual-builder/components/EmbeddedVisualBuilder.tsx`

**Fallback Name Resolution:**
```typescript
// If story name extraction fails but we have chat metadata
if (storyMetadata?.title && storyMetadata.isExisting) {
  const { currentStoryName } = useVisualBuilderStore.getState();
  if (currentStoryName === 'Imported Story') {
    setCurrentStoryName(storyMetadata.title);
  }
}
```

### **4. Store State Management**

**File:** `/visual-builder/store/visualBuilderStore.ts`

**Improved Import Logic:**
```typescript
importFromStoryUI: async (storyCode) => {
  const storyName = extractStoryName(storyCode); // Use enhanced extraction
  const isEditingExistingStory = storyName !== 'Imported Story' && storyName !== 'Untitled Story';
  
  set({ 
    currentStoryName: storyName,
    isImportedFromStory: true,
    isDirty: isEditingExistingStory ? false : true // Clean for existing, dirty for new
  });
}
```

## **Testing & Validation**

### **Story Name Extraction Tests**
**File:** `/visual-builder/utils/storyNameExtraction.test.ts`

Comprehensive test suite covering:
- ✅ Export const statements with PascalCase conversion
- ✅ Title properties taking precedence  
- ✅ Meta export default titles
- ✅ Comment annotations
- ✅ JSDoc comments
- ✅ Component names in JSX
- ✅ Function exports
- ✅ Real-world story formats
- ✅ Fallback behavior for unrecognizable code

### **Behavior Logic Tests**
Validation of save prompting logic:
- ✅ **Existing stories with valid names**: No prompt
- ✅ **Existing stories with title properties**: No prompt  
- ✅ **New stories with generic names**: Prompt for name
- ✅ **Completely new stories**: Prompt for name

## **User Experience Impact**

### **Before Fix:**
- ❌ Always prompted for name when editing existing stories
- ❌ Lost story context during Visual Builder editing
- ❌ Confusing workflow for users editing existing stories
- ❌ Generic "Imported Story" names even for stories with clear titles

### **After Fix:**
- ✅ **Never prompts** when editing existing stories with valid names
- ✅ **Preserves story context** throughout editing process
- ✅ **Seamless workflow** from chat to Visual Builder and back
- ✅ **Intelligent name extraction** from multiple story format patterns
- ✅ **Clear distinction** between editing existing vs creating new stories

## **Backward Compatibility**

- ✅ **Fully backward compatible** with existing Visual Builder functionality
- ✅ **No breaking changes** to API or component interfaces
- ✅ **Enhanced behavior** without disrupting current workflows
- ✅ **Maintains all existing features** while adding improvements

## **Files Modified**

1. **`/visual-builder/store/visualBuilderStore.ts`**
   - Enhanced `importFromStoryUI` with better name extraction
   - Improved state management for existing vs new stories

2. **`/visual-builder/utils/storyToBuilder.ts`**  
   - Added comprehensive `extractStoryName()` function
   - 7 different extraction methods with intelligent prioritization

3. **`/visual-builder/components/VisualBuilder.tsx`**
   - Enhanced save button logic to prevent unnecessary prompts
   - Better detection of existing vs new stories

4. **`/templates/StoryUI/StoryUIPanel.tsx`**
   - Added story metadata context passing
   - Enhanced Visual Builder integration

5. **`/visual-builder/components/EmbeddedVisualBuilder.tsx`**
   - Added story metadata support
   - Fallback name resolution for edge cases

## **Usage Examples**

### **Story Formats That Now Work Correctly:**

```typescript
// 1. Title property (highest priority)
export const MyStory = {
  title: "User Dashboard",
  render: () => <Dashboard />
};
// Extracts: "User Dashboard" ✅

// 2. Meta export title  
export default {
  title: "Navigation Menu",
  component: Nav
};
// Extracts: "Navigation Menu" ✅

// 3. Comment annotation
// @title Shopping Cart
export const CartStory = { ... };
// Extracts: "Shopping Cart" ✅

// 4. Export const with PascalCase
export const UserProfileCard = { ... };
// Extracts: "User Profile Card" ✅
```

### **Expected Behavior:**
- **Editing existing stories**: No name prompt, preserves existing name
- **Creating new stories**: Prompts for name as expected
- **Story UI → Visual Builder → Back**: Seamless workflow without prompts

## **Summary**

This comprehensive fix resolves the story name prompting issue by:

1. **Intelligently extracting story names** from multiple format patterns
2. **Distinguishing between existing and new stories** in save logic  
3. **Preserving story context** throughout the editing workflow
4. **Providing fallback mechanisms** for edge cases
5. **Maintaining full backward compatibility** with existing functionality

The solution ensures that users editing existing stories via "Edit in Visual Builder" will never be unnecessarily prompted for story names, creating a smooth and intuitive editing experience.