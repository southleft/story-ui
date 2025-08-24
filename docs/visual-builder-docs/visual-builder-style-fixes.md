# Visual Builder Style Discrepancy Fixes

## Issues Identified and Fixed

### 1. **Hardcoded Canvas Styling Conflicts**
**Problem**: Container components had hardcoded borders, padding, and background colors that don't match Mantine defaults.

**Fix**: 
- Separated canvas-specific interactions from component styling
- Moved visual indicators to overlay elements that don't affect component props
- Used `data-canvas-container` attributes instead of className manipulation

### 2. **Style Object Merging Issues**
**Problem**: Canvas-specific styles were merged with component styles, causing inconsistency.

**Fix**:
- Created separate `canvasInteraction` and `componentStyle` objects
- Applied `componentStyle` directly to components for better consistency with generated output
- Canvas visual aids now use absolute positioned overlays

### 3. **Container Component Padding/Margin Discrepancies**
**Problem**: Hardcoded `padding: '1rem'` on container components that don't have this in real Mantine components.

**Fix**:
- Removed hardcoded padding from Container, Group, Stack components
- Used Mantine's default spacing system
- Canvas indicators are now overlays that don't affect layout

### 4. **Card and Card.Section Border Logic**
**Problem**: Inconsistent border handling between Card components with and without `withBorder` prop.

**Fix**:
- Preserved Card's natural `withBorder` styling
- Selection indicators now appear as external overlays (-2px offset)
- Empty state indicators only show for Cards without borders

### 5. **Visual Indicator Positioning**
**Problem**: Visual indicators interfered with actual component rendering.

**Fix**:
- All visual indicators are now positioned absolutely with `pointerEvents: 'none'`
- Proper z-index layering (content: z-index 1, indicators: z-index 0)
- Consistent styling using `CANVAS_STYLES` constants

## Code Architecture Improvements

### Styling Constants
```typescript
const CANVAS_STYLES = {
  dropIndicator: {
    border: '2px dashed #3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.05)'
  },
  selectedIndicator: {
    border: '2px solid #3b82f6'
  },
  emptyIndicator: {
    border: '1px dashed #e9ecef'
  },
  overlay: {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    zIndex: 0
  }
};
```

### Separation of Concerns
- **Canvas Interaction**: Click handlers and drag/drop behavior
- **Component Styling**: Pure Mantine component props and styles
- **Visual Indicators**: Overlay elements for canvas-specific feedback

### Better Consistency with Generated Code
- Components now render with their actual Mantine props and styling
- No more hardcoded overrides that don't match the generated JSX
- Canvas-specific behavior isolated to overlays and data attributes

## Testing Recommendations

1. **Visual Comparison**: Compare components in canvas vs generated story output
2. **Default Props**: Verify all Mantine default props are properly applied
3. **Container Layouts**: Test nested component layouts match expectations
4. **Border States**: Test Card components with and without `withBorder`
5. **Selection States**: Ensure selection indicators don't affect component dimensions

## Future Improvements

1. **Theme Integration**: Use Mantine theme values for consistent colors and spacing
2. **Animation Consistency**: Align canvas transitions with Mantine's motion system
3. **Dark Mode Support**: Ensure visual indicators work in both light and dark themes
4. **Accessibility**: Add ARIA labels to canvas-specific overlays

These fixes ensure that the Visual Builder canvas provides accurate previews of the actual generated components while maintaining an intuitive editing experience.