# Visual Builder Debugging Guide

## Issue: Visual Builder Shows Placeholder Instead of Components

### Problem
When clicking "Edit in Visual Builder" on generated stories (like "Basic Card with Image"), the Visual Builder shows placeholder text "Component ready for editing in Visual Builder" instead of the actual Card, Image, Badge, and Button components.

### Verified Working
✅ **MCP Server**: Returns correct source code
```bash
curl "http://localhost:4001/story-ui/visual-builder/load?fileName=basic-card-with-image"
# Returns full source with <Card>, <Card.Section>, <Image>, <Badge>, <Stack>, <Button>
```

✅ **Story File**: Exists with correct content
```
/test-storybooks/mantine-storybook/src/stories/generated/basic-card-with-image-ac857807.stories.tsx
```

### Debugging Steps

#### 1. Check Browser Console
When you click "Edit in Visual Builder", look for these logs:
- `📝 Stored source code for Visual Builder` - Should show the source was stored
- `🚀 Visual Builder initializing` - Visual Builder is starting
- `📂 SessionStorage check` - Shows if code was retrieved from sessionStorage
- `📎 Loading code into Visual Builder` - Shows what code is being loaded
- `🚀 Starting to parse story code` - Parser is processing the code
- `📝 Extracted JSX` - Shows what JSX was extracted

#### 2. Check SessionStorage
In browser DevTools → Application → Session Storage:
- `visualBuilderInitialCode` - Should contain the full story source
- `visualBuilderSourceFile` - Should be the story filename
- `visualBuilderStoryVariant` - Should be "Default" or variant name

#### 3. Enhanced Logging Added
We've added comprehensive logging to:
- `/visual-builder/utils/storyToBuilder.ts` - Shows what components are detected
- `/visual-builder/components/VisualBuilder.tsx` - Shows loading process
- `/test-storybooks/mantine-storybook/src/stories/decorators/VisualBuilderDecorator.tsx` - Shows fetching

### Potential Issues

#### Issue 1: Source Not Being Fetched
If the decorator can't fetch the source, it creates a placeholder template.

#### Issue 2: Parser Not Handling Complex JSX
The story has complex nested structures:
- `<Card.Section>` (dot notation component)
- Inline styles with objects
- Nested `<Stack>` with `<div>` elements
- Multiple component types (Card, Image, Badge, Text, Button)

#### Issue 3: SessionStorage Not Being Read
Visual Builder might not be reading the stored source correctly.

### Next Steps to Fix

1. **Open browser console** and click "Edit in Visual Builder" 
2. **Check the logs** to see where the flow breaks
3. **Report back** with the specific error or log message
4. We'll fix that specific issue

### Manual Workaround (Temporary)
If you need to edit the story immediately:
1. Copy the story JSX manually
2. Open Visual Builder directly
3. Use the Import feature to paste the JSX

This is not ideal but can unblock you while we fix the root cause.