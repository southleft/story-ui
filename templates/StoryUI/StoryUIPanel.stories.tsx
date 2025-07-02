import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import StoryUIPanel from './StoryUIPanel';

const meta = {
  title: 'Story UI/Story Generator',
  component: StoryUIPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Story UI Panel connects to MCP server based on your Storybook port:
- Port 6006 → MCP Port 4001 (Primer)
- Port 6007 → MCP Port 4002 (Ant Design)
- Port 6008 → MCP Port 4003 (Mantine)
- Port 6009 → MCP Port 4004 (Chakra UI)

To manually specify a port, add ?mcp-port=XXXX to your URL.
        `
      }
    }
  },
} satisfies Meta<typeof StoryUIPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    // Auto-detect which MCP port to use based on Storybook port
    if (typeof window !== 'undefined' && !window.location.search.includes('mcp-port')) {
      const storybookPort = window.location.port;
      let mcpPort = '4001'; // default

      switch(storybookPort) {
        case '6006': mcpPort = '4001'; break; // Primer
        case '6007': mcpPort = '4002'; break; // Ant Design
        case '6008': mcpPort = '4003'; break; // Mantine
        case '6009': mcpPort = '4004'; break; // Chakra UI
      }

      // Set the global variable that the panel will use
      (window as any).STORY_UI_MCP_PORT = mcpPort;
    }

    return <StoryUIPanel />;
  }
};
