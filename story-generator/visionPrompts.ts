/**
 * Vision Prompts Module
 *
 * Provides specialized prompt templates for image-to-story generation using vision-capable LLMs.
 * These prompts guide the AI to analyze UI screenshots, design mockups, and component layouts,
 * then generate accurate Storybook CSF 3.0 stories.
 *
 * Critical Success Factors:
 * - Precise visual-to-code mapping instructions
 * - Explicit output format requirements
 * - Edge case handling (unclear images, partial views)
 * - Framework and design system awareness
 */

/**
 * Vision prompt types for different image analysis scenarios
 */
export enum VisionPromptType {
  /** Convert a UI screenshot to a complete Storybook story */
  SCREENSHOT_TO_STORY = 'screenshot_to_story',

  /** Convert a design mockup (Figma, Sketch, etc.) to a story */
  DESIGN_TO_STORY = 'design_to_story',

  /** Analyze and identify components present in an image */
  COMPONENT_ANALYSIS = 'component_analysis',

  /** Analyze layout structure, spacing, and responsive behavior */
  LAYOUT_ANALYSIS = 'layout_analysis',
}

/**
 * Options for building vision-aware prompts
 */
export interface VisionPromptOptions {
  /** Type of vision analysis to perform */
  promptType: VisionPromptType;

  /** User's description of what they want to achieve */
  userDescription?: string;

  /** Available components from the design system */
  availableComponents?: string[];

  /** Target framework (react, vue, angular, svelte) */
  framework?: string;

  /** Design system being used (chakra-ui, mantine, material-ui, ant-design) */
  designSystem?: string;

  /** Additional context or constraints */
  additionalContext?: string;
}

/**
 * Generate system prompt for vision-based story generation
 *
 * This prompt establishes the AI's role, capabilities, and expected output format.
 * It's crucial for consistent, high-quality story generation from images.
 */
export function getVisionSystemPrompt(
  type: VisionPromptType,
  availableComponents?: string[]
): string {
  const baseInstructions = `You are an expert UI/UX engineer specializing in converting visual designs into production-ready Storybook stories. Your task is to analyze the provided image and generate accurate, well-structured Storybook Component Story Format (CSF) 3.0 code.

## Core Capabilities

1. **Visual Analysis**: Precisely identify UI components, layout patterns, spacing, colors, typography, and interactive states
2. **Component Mapping**: Match visual elements to appropriate component implementations
3. **Code Generation**: Produce valid, type-safe Storybook stories following CSF 3.0 standards
4. **Best Practices**: Apply accessibility, responsive design, and component composition patterns

## Critical Requirements

### Output Format
- Generate ONLY valid Storybook CSF 3.0 code
- Use TypeScript interfaces for prop types
- Include meta export with component metadata
- Create multiple story variants when appropriate (Default, variants, states)
- Add JSDoc comments for complex props or logic

### Code Quality Standards
- Type-safe: All props must have explicit types
- Semantic: Use meaningful variable and story names
- Accessible: Include ARIA labels and roles where needed
- Maintainable: Clear structure with proper imports
- DRY: Extract common patterns into reusable configurations

### Visual Fidelity
- Match spacing and layout precisely (use exact px/rem values when clear)
- Preserve color schemes (use hex/rgb values or design token references)
- Replicate typography hierarchy (font sizes, weights, line heights)
- Maintain responsive behavior patterns
- Capture interactive states (hover, focus, active, disabled)`;

  const componentGuidance = availableComponents && availableComponents.length > 0
    ? `\n\n## Available Components\n\nYou have access to these pre-built components:\n${availableComponents.map(c => `- ${c}`).join('\n')}\n\n**IMPORTANT**: Prefer using these existing components over creating custom implementations. If a visual element matches one of these components, use it directly. Only suggest custom components if no suitable match exists.`
    : '';

  const typeSpecificInstructions = getTypeSpecificSystemInstructions(type);

  return `${baseInstructions}${componentGuidance}\n\n${typeSpecificInstructions}`;
}

/**
 * Get type-specific system instructions for different analysis modes
 */
function getTypeSpecificSystemInstructions(type: VisionPromptType): string {
  switch (type) {
    case VisionPromptType.SCREENSHOT_TO_STORY:
      return `## Screenshot-to-Story Mode

You are analyzing a screenshot of an existing UI implementation. Your goal is to recreate it as a Storybook story.

### Analysis Checklist

1. **Component Identification**
   - What is the primary component being displayed?
   - Are there nested child components?
   - What are the component boundaries?

2. **Props and Configuration**
   - What props are being used? (text content, icons, images, etc.)
   - What variants or states are visible? (size, color, disabled, etc.)
   - Are there event handlers needed? (onClick, onChange, etc.)

3. **Layout and Styling**
   - Container dimensions and constraints
   - Spacing between elements (margin, padding, gap)
   - Alignment and positioning (flexbox, grid patterns)
   - Responsive breakpoint behaviors (if visible)

4. **Content and Data**
   - Static text content
   - Dynamic data patterns (lists, tables, forms)
   - Placeholder vs. real content

5. **Edge Cases to Handle**
   - If the screenshot is partial, note what's visible vs. inferred
   - If image quality is poor, indicate assumptions made
   - If multiple components overlap, suggest the component hierarchy

### Output Structure

Generate a complete .stories.tsx file with:
1. Imports (React, component, types)
2. Meta export with title, component, tags, and argTypes
3. Default story showing the exact screenshot state
4. Additional stories for variants/states if they're inferable
5. Inline comments explaining non-obvious decisions`;

    case VisionPromptType.DESIGN_TO_STORY:
      return `## Design-to-Story Mode

You are analyzing a design mockup (from Figma, Sketch, etc.) that needs to be implemented as a Storybook story.

### Design Analysis Approach

1. **Design Intent vs. Implementation**
   - Identify the designer's intent (not just pixel-perfect copying)
   - Recognize standard UI patterns and components
   - Distinguish decorative elements from functional ones

2. **Component Architecture**
   - How should this design be broken into components?
   - Which parts should be props vs. composition?
   - What component variants are needed?

3. **Design System Alignment**
   - Does this match existing design system patterns?
   - Are there custom elements that need new components?
   - Can we use composition of existing components?

4. **Responsive Considerations**
   - What breakpoints are implied by the design?
   - How should content reflow on smaller screens?
   - Are there mobile-specific design variations?

5. **State Management**
   - What interactive states exist? (hover, active, focus, disabled, loading, error)
   - Are there animations or transitions?
   - What user interactions are expected?

### Design Mockup Specifics

- **Annotations**: Look for design specs (spacing, colors, fonts) in the image
- **Redlines**: Note any measurement indicators or spacing guides
- **Style Guide**: Reference any visible design tokens or style definitions
- **Multiple Artboards**: If multiple screens/states are visible, create separate stories

### Output Approach

1. Start with component structure and hierarchy
2. Map visual styles to CSS/styled-components/CSS-in-JS
3. Define prop interfaces that enable design flexibility
4. Create stories for each design variant shown
5. Add notes about implementation assumptions or questions`;

    case VisionPromptType.COMPONENT_ANALYSIS:
      return `## Component Analysis Mode

You are performing a detailed component inventory analysis of the UI shown in the image.

### Analysis Objectives

1. **Component Catalog**
   - Identify every distinct UI component
   - Classify by type (button, input, card, modal, etc.)
   - Note component instances vs. unique components

2. **Component Characteristics**
   - Props and configurations for each component
   - Variants observed (sizes, colors, states)
   - Nested component relationships

3. **Hierarchy and Composition**
   - Parent-child relationships
   - Container components vs. presentational components
   - Composition patterns (slots, render props, etc.)

4. **Reusability Assessment**
   - Which components are reusable primitives?
   - Which are specialized/composite components?
   - What components could be shared across the app?

### Output Format

Provide a structured analysis:

\`\`\`typescript
// Component Inventory Analysis

interface ComponentAnalysis {
  components: {
    name: string;              // Suggested component name
    type: string;              // Component category
    instances: number;         // How many times it appears
    props: Record<string, any>; // Observed props/config
    variants: string[];        // Different variants seen
    location: string;          // Where in the UI hierarchy
    notes: string;             // Implementation notes
  }[];

  hierarchy: {
    component: string;
    children: string[];
  }[];

  recommendations: string[];   // Suggestions for component structure
}
\`\`\`

Then provide the analysis object with detailed observations.`;

    case VisionPromptType.LAYOUT_ANALYSIS:
      return `## Layout Analysis Mode

You are analyzing the structural layout, spacing system, and responsive patterns in the UI.

### Layout Analysis Dimensions

1. **Container Structure**
   - Root container type (full-width, max-width, centered)
   - Main layout pattern (single column, grid, sidebar, dashboard)
   - Section divisions and boundaries

2. **Spacing System**
   - Consistent spacing units (4px, 8px, 16px scale?)
   - Margin patterns between sections
   - Padding within containers
   - Gap between grid/flex items

3. **Grid and Alignment**
   - Grid structure (12-column, custom?)
   - Column widths and gutters
   - Alignment patterns (start, center, end, stretch)
   - Vertical rhythm and baseline grid

4. **Responsive Behavior**
   - Breakpoint thresholds (mobile, tablet, desktop)
   - Content reflow patterns
   - Component stacking order on mobile
   - Hidden/shown elements per breakpoint

5. **Z-Index and Layering**
   - Element stacking order
   - Overlays and modals
   - Sticky/fixed positioning
   - Dropdown and menu layers

### Output Structure

Provide CSS/styled-components code showing:

1. Container and wrapper styles
2. Layout primitives (Box, Stack, Grid, Flex)
3. Spacing constants and design tokens
4. Responsive breakpoint configurations
5. Example component using these layout patterns

Include comments explaining the layout decisions and how they create the observed visual structure.`;

    default:
      return '';
  }
}

/**
 * Generate user prompt to accompany the image
 *
 * This is the direct instruction sent with the image to the LLM.
 */
export function getVisionUserPrompt(
  type: VisionPromptType,
  additionalContext?: string
): string {
  const contextSection = additionalContext
    ? `\n\n## Additional Context\n${additionalContext}\n`
    : '';

  switch (type) {
    case VisionPromptType.SCREENSHOT_TO_STORY:
      return `Please analyze the attached screenshot and generate a complete Storybook story that recreates this UI exactly.

**Your Task:**
1. Identify the main component and all sub-components visible
2. Determine the props and configuration used
3. Generate a complete .stories.tsx file in CSF 3.0 format
4. Include the default story matching the screenshot
5. Add variant stories if you can infer other states

**Important:**
- Be precise about spacing, colors, and typography
- If you can't determine exact values, use reasonable defaults and add a comment
- If the screenshot is partial or unclear, note your assumptions
- Generate production-ready, type-safe code${contextSection}

**Output:** A complete, runnable .stories.tsx file with all necessary imports and exports.`;

    case VisionPromptType.DESIGN_TO_STORY:
      return `Please analyze the attached design mockup and generate a Storybook story implementation.

**Your Task:**
1. Understand the design intent and component structure
2. Map visual elements to appropriate component patterns
3. Extract design tokens (colors, spacing, typography)
4. Generate a complete .stories.tsx file in CSF 3.0 format
5. Create stories for all design variants shown

**Important:**
- Focus on design intent, not just pixel-perfect copying
- Use semantic component names that reflect purpose
- Leverage design system components when possible
- Consider responsive behavior and state variations
- Note any assumptions about interactions or behaviors${contextSection}

**Output:** A complete, runnable .stories.tsx file that faithfully implements the design.`;

    case VisionPromptType.COMPONENT_ANALYSIS:
      return `Please analyze the attached image and provide a detailed component inventory.

**Your Task:**
1. Identify every distinct UI component in the image
2. Classify components by type and purpose
3. Note all variants and states observed
4. Map out the component hierarchy
5. Provide recommendations for component structure

**Important:**
- Be thorough - catalog every button, input, icon, card, etc.
- Distinguish between component instances and unique components
- Identify composition patterns and reusable primitives
- Suggest how components should be organized${contextSection}

**Output:** A structured ComponentAnalysis object (see system prompt for format) with detailed observations.`;

    case VisionPromptType.LAYOUT_ANALYSIS:
      return `Please analyze the layout structure and spacing system in the attached image.

**Your Task:**
1. Identify the overall layout pattern and container structure
2. Measure and document the spacing system
3. Analyze grid/flex patterns and alignment
4. Infer responsive behavior and breakpoints
5. Generate layout code showing the structure

**Important:**
- Be precise about spacing values (try to identify consistent units)
- Document the grid system or layout primitives
- Note any responsive patterns or breakpoint behaviors
- Explain how the layout creates the visual hierarchy${contextSection}

**Output:** Layout code (CSS/styled-components) with detailed comments explaining the spatial relationships.`;

    default:
      return 'Please analyze the attached image.';
  }
}

/**
 * Build a complete vision-aware prompt combining system and user prompts
 *
 * This is the main entry point for generating vision prompts with full context.
 */
export function buildVisionAwarePrompt(options: VisionPromptOptions): {
  systemPrompt: string;
  userPrompt: string;
} {
  const {
    promptType,
    userDescription,
    availableComponents,
    framework = 'react',
    designSystem,
    additionalContext,
  } = options;

  // Build framework and design system context
  let enhancedContext = additionalContext || '';

  if (framework) {
    enhancedContext += `\n\n**Target Framework:** ${framework}`;
    enhancedContext += `\n- Generate ${framework}-specific code and patterns`;
    enhancedContext += `\n- Use ${framework} conventions for component structure`;
  }

  if (designSystem) {
    enhancedContext += `\n\n**Design System:** ${designSystem}`;
    enhancedContext += `\n- Use ${designSystem} components and patterns`;
    enhancedContext += `\n- Reference ${designSystem} design tokens when applicable`;
    enhancedContext += `\n- Follow ${designSystem} best practices and composition patterns`;
  }

  if (userDescription) {
    enhancedContext += `\n\n**User Request:**\n${userDescription}`;
  }

  // Generate system prompt with component context
  const systemPrompt = getVisionSystemPrompt(promptType, availableComponents);

  // Generate user prompt with enhanced context
  const userPrompt = getVisionUserPrompt(promptType, enhancedContext);

  return {
    systemPrompt,
    userPrompt,
  };
}

/**
 * Helper function to validate image input for vision analysis
 *
 * Checks that the image is in a supported format and provides guidance if not.
 */
export function validateImageInput(imagePath: string): {
  valid: boolean;
  error?: string;
  suggestions?: string[];
} {
  const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  const extension = imagePath.toLowerCase().substring(imagePath.lastIndexOf('.'));

  if (!supportedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `Unsupported image format: ${extension}`,
      suggestions: [
        'Convert the image to PNG, JPG, or WebP format',
        'Ensure the image file has a valid extension',
        `Supported formats: ${supportedExtensions.join(', ')}`,
      ],
    };
  }

  return { valid: true };
}

/**
 * Helper function to suggest optimal image quality for vision analysis
 */
export function getImageQualityGuidelines(): string[] {
  return [
    'Resolution: Minimum 800x600px, optimal 1920x1080px or higher',
    'Clarity: Ensure text is readable and UI elements are clearly visible',
    'Cropping: Include the full component/layout, avoid cutting off edges',
    'Format: PNG for UI screenshots (lossless), JPG for photos (compressed)',
    'Size: Under 20MB for best performance',
    'Color: Use sRGB color space for accurate color representation',
    'Zoom: Capture at 100% zoom level, not zoomed in or out',
    'Annotations: Include design specs/measurements if available',
  ];
}

/**
 * Extract framework-specific import patterns for generated stories
 */
export function getFrameworkImports(framework: string): string {
  const imports: Record<string, string> = {
    react: `import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';`,
    vue: `import type { Meta, StoryObj } from '@storybook/vue3';`,
    angular: `import type { Meta, StoryObj } from '@storybook/angular';`,
    svelte: `import type { Meta, StoryObj } from '@storybook/svelte';`,
    'web-components': `import type { Meta, StoryObj } from '@storybook/web-components';`,
  };

  return imports[framework.toLowerCase()] || imports.react;
}

/**
 * Get design system specific import hints
 */
export function getDesignSystemImports(designSystem: string): string[] {
  const imports: Record<string, string[]> = {
    'chakra-ui': [
      "import { ChakraProvider } from '@chakra-ui/react';",
      "// Wrap stories in ChakraProvider if needed",
    ],
    'mantine': [
      "import { MantineProvider } from '@mantine/core';",
      "// Wrap stories in MantineProvider if needed",
    ],
    'material-ui': [
      "import { ThemeProvider } from '@mui/material/styles';",
      "// Wrap stories in ThemeProvider if needed",
    ],
    'ant-design': [
      "import { ConfigProvider } from 'antd';",
      "// Wrap stories in ConfigProvider if needed",
    ],
    'tailwind': [
      "// Ensure Tailwind CSS is imported in your Storybook preview",
      "// import '../styles/globals.css';",
    ],
  };

  return imports[designSystem.toLowerCase()] || [];
}
