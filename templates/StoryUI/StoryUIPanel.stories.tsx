import React from 'react';
import { StoryFn, Meta } from '@storybook/react';
import StoryUIPanel from './StoryUIPanel';

export default {
  title: 'Story UI/Story Generator',
  component: StoryUIPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AI-powered story generator for creating complex UI layouts using your component library.'
      }
    }
  }
} as Meta<typeof StoryUIPanel>;

const Template: StoryFn<typeof StoryUIPanel> = (args) => <StoryUIPanel {...args} />;

export const Default = Template.bind({});
Default.args = {};
Default.parameters = {
  docs: {
    description: {
      story: 'Use natural language prompts to generate Storybook stories with your components.'
    }
  }
};
