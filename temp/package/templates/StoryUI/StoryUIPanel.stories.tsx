import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { StoryUIPanel } from './StoryUIPanel';

const meta = {
  title: 'Story UI/Story Generator',
  component: StoryUIPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Story UI Panel connects to the MCP server running on your configured port.
The port is determined by:
1. VITE_STORY_UI_PORT environment variable (recommended)
2. URL parameter: ?mcp-port=XXXX
3. Default port: 4001

This design system agnostic approach works with any component library.
        `
      }
    }
  },
} satisfies Meta<typeof StoryUIPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    // Check for URL parameter override first
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const mcpPortParam = urlParams.get('mcp-port');
      
      if (mcpPortParam) {
        // Set the global variable that the panel will use
        (window as any).STORY_UI_MCP_PORT = mcpPortParam;
      }
    }

    return <StoryUIPanel />;
  }
};
