# Story UI MCP Example

This example shows how to use Story UI with Claude Desktop via MCP.

## Example Conversation

**You:** Use Story UI to generate a hero section with a gradient background, a main title "Welcome to Our Platform", a subtitle "Build amazing experiences", and two buttons - "Get Started" (primary) and "Learn More" (secondary).

**Claude (using Story UI MCP):** I'll help you create a hero section using Story UI. Let me generate that for you.

*[Claude would then use the generate-story tool]*

The story has been generated successfully! Here's what was created:

**Title:** Hero Section with Gradient Background
**ID:** hero-gradient-1234

The generated story includes:
- A hero section with a beautiful gradient background
- Main title: "Welcome to Our Platform"
- Subtitle: "Build amazing experiences"
- Two buttons with proper styling:
  - "Get Started" button with primary variant
  - "Learn More" button with secondary variant

You can now see this story in your Storybook instance under the "Generated" category.

**You:** Can you show me what components are available for building layouts?

**Claude:** Let me check what layout components are available in your design system.

*[Claude would use the list-components tool with category filter]*

I found the following layout components available:
- Grid: Flexible grid system for responsive layouts
- Container: Page container with max-width constraints
- Row: Horizontal layout component
- Column: Vertical layout component
- Stack: Stacks children vertically or horizontally with spacing
- Spacer: Adds space between components

**You:** Great! Now modify the hero section to use a Grid with two columns - put the text content on the left and add an illustration placeholder on the right.

**Claude:** I'll help you iterate on the existing hero section to add a two-column layout with the content on the left and space for an illustration on the right.

*[Claude would use generate-story again with the iteration prompt]*

The hero section has been updated! The story now features:
- A Grid component with two equal columns
- Left column: Contains the title, subtitle, and buttons
- Right column: Includes a placeholder for an illustration
- Responsive design that stacks on mobile devices

The iteration preserved your existing content while restructuring it into the requested layout.

## Common Workflows

### 1. Component Discovery
"What Button variants are available in my design system?"
"Show me all form-related components"
"What props does the Card component accept?"

### 2. Story Generation
"Create a login form with email, password, and remember me checkbox"
"Build a pricing card with a featured badge"
"Generate a navigation bar with logo and menu items"

### 3. Story Management
"List all stories I've created today"
"Show me the story with ID abc-123"
"Delete the old hero section story"

### 4. Iterative Design
"Add a dark mode variant to the current story"
"Make the buttons larger and add icons"
"Change the color scheme to use brand colors"
