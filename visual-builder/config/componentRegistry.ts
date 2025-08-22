import { VisualBuilderComponentConfig } from '../types';

export const MANTINE_COMPONENTS: VisualBuilderComponentConfig[] = [
  {
    type: 'Button',
    displayName: 'Button',
    category: 'Inputs',
    defaultProps: {
      variant: 'filled',
      size: 'sm',
      children: 'Click me'
    },
    properties: [
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Click me',
        description: 'Button text content'
      },
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'filled',
        options: ['filled', 'outline', 'light', 'default', 'subtle'],
        description: 'Button visual style'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Button size'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Button color theme'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable button interaction'
      }
    ]
  },
  {
    type: 'TextInput',
    displayName: 'Text Input',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Enter text...',
      size: 'sm'
    },
    properties: [
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Enter text...',
        description: 'Placeholder text'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input'
      }
    ]
  },
  {
    type: 'Text',
    displayName: 'Text',
    category: 'Typography',
    defaultProps: {
      children: 'Sample text',
      size: 'sm'
    },
    properties: [
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Sample text',
        description: 'Text content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Text size'
      },
      {
        name: 'weight',
        type: 'select',
        defaultValue: 'normal',
        options: ['normal', 'bold', 'lighter'],
        description: 'Font weight'
      },
      {
        name: 'color',
        type: 'string',
        defaultValue: '',
        description: 'Text color'
      }
    ]
  },
  {
    type: 'Title',
    displayName: 'Title',
    category: 'Typography',
    defaultProps: {
      children: 'Page Title',
      order: 1
    },
    properties: [
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Page Title',
        description: 'Title text'
      },
      {
        name: 'order',
        type: 'select',
        defaultValue: 1,
        options: ['1', '2', '3', '4', '5', '6'],
        description: 'Heading level (h1-h6)'
      },
      {
        name: 'color',
        type: 'string',
        defaultValue: '',
        description: 'Title color'
      }
    ]
  },
  {
    type: 'Container',
    displayName: 'Container',
    category: 'Layout',
    defaultProps: {
      size: 'md',
      children: []
    },
    properties: [
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Container max width'
      },
      {
        name: 'fluid',
        type: 'boolean',
        defaultValue: false,
        description: 'Full width container'
      }
    ]
  },
  {
    type: 'Group',
    displayName: 'Group',
    category: 'Layout',
    defaultProps: {
      justify: 'flex-start',
      align: 'center',
      children: []
    },
    properties: [
      {
        name: 'justify',
        type: 'select',
        defaultValue: 'flex-start',
        options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
        description: 'Horizontal alignment'
      },
      {
        name: 'align',
        type: 'select',
        defaultValue: 'center',
        options: ['flex-start', 'center', 'flex-end', 'stretch'],
        description: 'Vertical alignment'
      },
      {
        name: 'gap',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Gap between items'
      }
    ]
  },
  {
    type: 'Stack',
    displayName: 'Stack',
    category: 'Layout',
    defaultProps: {
      gap: 'md',
      children: []
    },
    properties: [
      {
        name: 'gap',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Gap between items'
      },
      {
        name: 'align',
        type: 'select',
        defaultValue: 'stretch',
        options: ['flex-start', 'center', 'flex-end', 'stretch'],
        description: 'Horizontal alignment'
      }
    ]
  },
  {
    type: 'Card',
    displayName: 'Card',
    category: 'Layout',
    defaultProps: {
      shadow: 'sm',
      padding: 'lg',
      radius: 'md',
      withBorder: true,
      children: []
    },
    properties: [
      {
        name: 'shadow',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Card shadow'
      },
      {
        name: 'padding',
        type: 'select',
        defaultValue: 'lg',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Card padding'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Border radius'
      },
      {
        name: 'withBorder',
        type: 'boolean',
        defaultValue: true,
        description: 'Show border'
      }
    ]
  },
  {
    type: 'Card.Section',
    displayName: 'Card Section',
    category: 'Layout',
    defaultProps: {
      inheritPadding: false,
      withBorder: false,
      children: []
    },
    properties: [
      {
        name: 'inheritPadding',
        type: 'boolean',
        defaultValue: false,
        description: 'Inherit padding from parent Card'
      },
      {
        name: 'withBorder',
        type: 'boolean',
        defaultValue: false,
        description: 'Show top border'
      }
    ]
  }
];

export const getComponentConfig = (type: string): VisualBuilderComponentConfig | undefined => {
  return MANTINE_COMPONENTS.find(comp => comp.type === type);
};

export const getComponentsByCategory = () => {
  return MANTINE_COMPONENTS.reduce((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {} as Record<string, VisualBuilderComponentConfig[]>);
};