import type { VisualBuilderComponentConfig, PropertyDefinition } from '../types/index';

// Mantine spacing tokens
const SPACING_OPTIONS = ['0', 'xs', 'sm', 'md', 'lg', 'xl', 'auto'];

// Common spacing properties for all components
export const SPACING_PROPERTIES: PropertyDefinition[] = [
  // Margin properties
  {
    name: 'm',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin on all sides',
    category: 'spacing'
  },
  {
    name: 'mt',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin top',
    category: 'spacing'
  },
  {
    name: 'mr',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin right',
    category: 'spacing'
  },
  {
    name: 'mb',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin bottom',
    category: 'spacing'
  },
  {
    name: 'ml',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin left',
    category: 'spacing'
  },
  {
    name: 'mx',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin horizontal (left and right)',
    category: 'spacing'
  },
  {
    name: 'my',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Margin vertical (top and bottom)',
    category: 'spacing'
  },
  // Padding properties  
  {
    name: 'p',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding on all sides',
    category: 'spacing'
  },
  {
    name: 'pt',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding top',
    category: 'spacing'
  },
  {
    name: 'pr',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding right',
    category: 'spacing'
  },
  {
    name: 'pb',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding bottom',
    category: 'spacing'
  },
  {
    name: 'pl',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding left',
    category: 'spacing'
  },
  {
    name: 'px',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding horizontal (left and right)',
    category: 'spacing'
  },
  {
    name: 'py',
    type: 'select',
    defaultValue: undefined,
    options: SPACING_OPTIONS,
    description: 'Padding vertical (top and bottom)',
    category: 'spacing'
  }
];

// Helper function to add spacing properties to a component
const addSpacingProperties = (properties: PropertyDefinition[]): PropertyDefinition[] => {
  return [...properties, ...SPACING_PROPERTIES];
};

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
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Click me',
        description: 'Button text content',
        category: 'content'
      },
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'filled',
        options: ['filled', 'outline', 'light', 'default', 'subtle'],
        description: 'Button visual style',
        category: 'appearance'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Button size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Button color theme',
        category: 'appearance'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable button interaction',
        category: 'behavior'
      },
      {
        name: 'fullWidth',
        type: 'boolean',
        defaultValue: false,
        description: 'Make button full width',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'TextInput',
    displayName: 'Text Input',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Enter text...',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Enter text...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Text',
    displayName: 'Text',
    category: 'Typography',
    defaultProps: {
      children: 'Sample text',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Sample text',
        description: 'Text content',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Text size',
        category: 'appearance'
      },
      {
        name: 'weight',
        type: 'select',
        defaultValue: 'normal',
        options: ['normal', 'bold', 'lighter'],
        description: 'Font weight',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'string',
        defaultValue: '',
        description: 'Text color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Title',
    displayName: 'Title',
    category: 'Typography',
    defaultProps: {
      children: 'Page Title',
      order: 1
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Page Title',
        description: 'Title text',
        category: 'content'
      },
      {
        name: 'order',
        type: 'select',
        defaultValue: 1,
        options: ['1', '2', '3', '4', '5', '6'],
        description: 'Heading level (h1-h6)',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'string',
        defaultValue: '',
        description: 'Title color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Container',
    displayName: 'Container',
    category: 'Layout',
    defaultProps: {
      size: 'md',
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Container max width',
        category: 'appearance'
      },
      {
        name: 'fluid',
        type: 'boolean',
        defaultValue: false,
        description: 'Full width container',
        category: 'behavior'
      }
    ])
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
    properties: addSpacingProperties([
      {
        name: 'justify',
        type: 'select',
        defaultValue: 'flex-start',
        options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
        description: 'Horizontal alignment',
        category: 'appearance'
      },
      {
        name: 'align',
        type: 'select',
        defaultValue: 'center',
        options: ['flex-start', 'center', 'flex-end', 'stretch'],
        description: 'Vertical alignment',
        category: 'appearance'
      },
      {
        name: 'gap',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Gap between items',
        category: 'spacing'
      }
    ])
  },
  {
    type: 'Stack',
    displayName: 'Stack',
    category: 'Layout',
    defaultProps: {
      gap: 'md',
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'gap',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Gap between items',
        category: 'spacing'
      },
      {
        name: 'align',
        type: 'select',
        defaultValue: 'stretch',
        options: ['flex-start', 'center', 'flex-end', 'stretch'],
        description: 'Horizontal alignment',
        category: 'appearance'
      }
    ])
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
    properties: addSpacingProperties([
      {
        name: 'shadow',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Card shadow',
        category: 'appearance'
      },
      {
        name: 'padding',
        type: 'select',
        defaultValue: 'lg',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Card padding',
        category: 'spacing'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Border radius',
        category: 'appearance'
      },
      {
        name: 'withBorder',
        type: 'boolean',
        defaultValue: true,
        description: 'Show border',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'CardSection',
    displayName: 'Card Section',
    category: 'Layout',
    defaultProps: {
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'withBorder',
        type: 'boolean',
        defaultValue: false,
        description: 'Show border around section',
        category: 'appearance'
      },
      {
        name: 'inheritPadding',
        type: 'boolean',
        defaultValue: false,
        description: 'Inherit card padding',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Badge',
    displayName: 'Badge',
    category: 'Display',
    defaultProps: {
      children: 'New',
      variant: 'filled',
      color: 'blue',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'New',
        description: 'Badge text content',
        category: 'content'
      },
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'filled',
        options: ['filled', 'light', 'outline', 'dot'],
        description: 'Badge variant',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Badge color',
        category: 'appearance'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Badge size',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Anchor',
    displayName: 'Link',
    category: 'Navigation',
    defaultProps: {
      children: 'Link text',
      href: '#',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Link text',
        description: 'Link text content',
        category: 'content'
      },
      {
        name: 'href',
        type: 'string',
        defaultValue: '#',
        description: 'Link URL',
        category: 'behavior'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Link size',
        category: 'appearance'
      },
      {
        name: 'underline',
        type: 'select',
        defaultValue: 'hover',
        options: ['always', 'hover', 'never'],
        description: 'Underline style',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Image',
    displayName: 'Image',
    category: 'Media',
    defaultProps: {
      src: 'https://images.unsplash.com/photo-1511216335778-7cb8f49fa7a3?w=400&h=300&fit=crop',
      alt: 'Sample image',
      radius: 'sm',
      aspectRatio: '16:9',
      fit: 'cover'
    },
    properties: addSpacingProperties([
      {
        name: 'src',
        type: 'string',
        defaultValue: 'https://images.unsplash.com/photo-1511216335778-7cb8f49fa7a3?w=400&h=300&fit=crop',
        description: 'Image source URL',
        category: 'content'
      },
      {
        name: 'alt',
        type: 'string',
        defaultValue: 'Sample image',
        description: 'Image alt text',
        category: 'content'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Image border radius',
        category: 'appearance'
      },
      {
        name: 'aspectRatio',
        type: 'select',
        defaultValue: '16:9',
        options: ['16:9', '4:3', '1:1', '3:2', '21:9'],
        description: 'Image aspect ratio',
        category: 'appearance'
      },
      {
        name: 'fit',
        type: 'select',
        defaultValue: 'cover',
        options: ['contain', 'cover', 'fill', 'none', 'scale-down'],
        description: 'How the image fits within its container',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Divider',
    displayName: 'Divider',
    category: 'Layout',
    defaultProps: {
      size: 'xs',
      orientation: 'horizontal'
    },
    properties: addSpacingProperties([
      {
        name: 'size',
        type: 'select',
        defaultValue: 'xs',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Divider thickness',
        category: 'appearance'
      },
      {
        name: 'orientation',
        type: 'select',
        defaultValue: 'horizontal',
        options: ['horizontal', 'vertical'],
        description: 'Divider orientation',
        category: 'appearance'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Divider label (optional)',
        category: 'content'
      },
      {
        name: 'labelPosition',
        type: 'select',
        defaultValue: 'center',
        options: ['left', 'center', 'right'],
        description: 'Label position',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Paper',
    displayName: 'Paper',
    category: 'Layout',
    defaultProps: {
      shadow: 'xs',
      radius: 'md',
      p: 'md',
      withBorder: false,
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'shadow',
        type: 'select',
        defaultValue: 'xs',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Paper shadow',
        category: 'appearance'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Border radius',
        category: 'appearance'
      },
      {
        name: 'p',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Padding',
        category: 'spacing'
      },
      {
        name: 'withBorder',
        type: 'boolean',
        defaultValue: false,
        description: 'Show border',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Alert',
    displayName: 'Alert',
    category: 'Feedback',
    defaultProps: {
      title: 'Alert title',
      children: 'This is an alert message',
      color: 'blue',
      variant: 'light'
    },
    properties: addSpacingProperties([
      {
        name: 'title',
        type: 'string',
        defaultValue: 'Alert title',
        description: 'Alert title',
        category: 'content'
      },
      {
        name: 'children',
        type: 'string',
        defaultValue: 'This is an alert message',
        description: 'Alert message content',
        category: 'content'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Alert color',
        category: 'appearance'
      },
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'light',
        options: ['filled', 'light', 'outline'],
        description: 'Alert variant',
        category: 'appearance'
      }
    ])
  },
  // Additional Input Components
  {
    type: 'PasswordInput',
    displayName: 'Password Input',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Enter password...',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Enter password...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'visible',
        type: 'boolean',
        defaultValue: false,
        description: 'Show password',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Textarea',
    displayName: 'Textarea',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Enter text...',
      size: 'sm',
      rows: 4
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Enter text...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'rows',
        type: 'number',
        defaultValue: 4,
        description: 'Number of rows',
        category: 'appearance'
      },
      {
        name: 'autosize',
        type: 'boolean',
        defaultValue: false,
        description: 'Auto resize height',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Select',
    displayName: 'Select',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Select option...',
      size: 'sm',
      data: ['Option 1', 'Option 2', 'Option 3']
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Select option...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'searchable',
        type: 'boolean',
        defaultValue: false,
        description: 'Enable search',
        category: 'behavior'
      },
      {
        name: 'clearable',
        type: 'boolean',
        defaultValue: false,
        description: 'Show clear button',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'MultiSelect',
    displayName: 'Multi Select',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Select options...',
      size: 'sm',
      data: ['Option 1', 'Option 2', 'Option 3']
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Select options...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'searchable',
        type: 'boolean',
        defaultValue: true,
        description: 'Enable search',
        category: 'behavior'
      },
      {
        name: 'clearable',
        type: 'boolean',
        defaultValue: true,
        description: 'Show clear button',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'NumberInput',
    displayName: 'Number Input',
    category: 'Inputs',
    defaultProps: {
      placeholder: 'Enter number...',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'placeholder',
        type: 'string',
        defaultValue: 'Enter number...',
        description: 'Placeholder text',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Input label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Input size',
        category: 'appearance'
      },
      {
        name: 'min',
        type: 'number',
        defaultValue: undefined,
        description: 'Minimum value',
        category: 'behavior'
      },
      {
        name: 'max',
        type: 'number',
        defaultValue: undefined,
        description: 'Maximum value',
        category: 'behavior'
      },
      {
        name: 'step',
        type: 'number',
        defaultValue: 1,
        description: 'Step value',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable input',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Checkbox',
    displayName: 'Checkbox',
    category: 'Inputs',
    defaultProps: {
      label: 'Checkbox label',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'label',
        type: 'string',
        defaultValue: 'Checkbox label',
        description: 'Checkbox label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Checkbox size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Checkbox color',
        category: 'appearance'
      },
      {
        name: 'indeterminate',
        type: 'boolean',
        defaultValue: false,
        description: 'Indeterminate state',
        category: 'behavior'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable checkbox',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Radio',
    displayName: 'Radio',
    category: 'Inputs',
    defaultProps: {
      label: 'Radio label',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'label',
        type: 'string',
        defaultValue: 'Radio label',
        description: 'Radio label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Radio size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Radio color',
        category: 'appearance'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable radio',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'Switch',
    displayName: 'Switch',
    category: 'Inputs',
    defaultProps: {
      label: 'Switch label',
      size: 'sm'
    },
    properties: addSpacingProperties([
      {
        name: 'label',
        type: 'string',
        defaultValue: 'Switch label',
        description: 'Switch label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Switch size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Switch color',
        category: 'appearance'
      },
      {
        name: 'disabled',
        type: 'boolean',
        defaultValue: false,
        description: 'Disable switch',
        category: 'behavior'
      }
    ])
  },
  // Layout Components
  {
    type: 'Box',
    displayName: 'Box',
    category: 'Layout',
    defaultProps: {
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'bg',
        type: 'string',
        defaultValue: '',
        description: 'Background color',
        category: 'appearance'
      },
      {
        name: 'c',
        type: 'string',
        defaultValue: '',
        description: 'Text color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Flex',
    displayName: 'Flex',
    category: 'Layout',
    defaultProps: {
      direction: 'row',
      justify: 'flex-start',
      align: 'stretch',
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'direction',
        type: 'select',
        defaultValue: 'row',
        options: ['row', 'column', 'row-reverse', 'column-reverse'],
        description: 'Flex direction',
        category: 'appearance'
      },
      {
        name: 'justify',
        type: 'select',
        defaultValue: 'flex-start',
        options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
        description: 'Justify content',
        category: 'appearance'
      },
      {
        name: 'align',
        type: 'select',
        defaultValue: 'stretch',
        options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
        description: 'Align items',
        category: 'appearance'
      },
      {
        name: 'wrap',
        type: 'select',
        defaultValue: 'nowrap',
        options: ['nowrap', 'wrap', 'wrap-reverse'],
        description: 'Flex wrap',
        category: 'appearance'
      },
      {
        name: 'gap',
        type: 'select',
        defaultValue: undefined,
        options: SPACING_OPTIONS,
        description: 'Gap between items',
        category: 'spacing'
      }
    ])
  },
  {
    type: 'Grid',
    displayName: 'Grid',
    category: 'Layout',
    defaultProps: {
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'columns',
        type: 'number',
        defaultValue: 12,
        description: 'Number of columns',
        category: 'appearance'
      },
      {
        name: 'gutter',
        type: 'select',
        defaultValue: 'md',
        options: SPACING_OPTIONS,
        description: 'Gutter size',
        category: 'spacing'
      },
      {
        name: 'grow',
        type: 'boolean',
        defaultValue: false,
        description: 'Allow columns to grow',
        category: 'behavior'
      }
    ])
  },
  {
    type: 'GridCol',
    displayName: 'Grid Column',
    category: 'Layout',
    defaultProps: {
      span: 12,
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'span',
        type: 'number',
        defaultValue: 12,
        description: 'Column span',
        category: 'appearance'
      },
      {
        name: 'offset',
        type: 'number',
        defaultValue: 0,
        description: 'Column offset',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'SimpleGrid',
    displayName: 'Simple Grid',
    category: 'Layout',
    defaultProps: {
      cols: 2,
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'cols',
        type: 'number',
        defaultValue: 2,
        description: 'Number of columns',
        category: 'appearance'
      },
      {
        name: 'spacing',
        type: 'select',
        defaultValue: 'md',
        options: SPACING_OPTIONS,
        description: 'Spacing between items',
        category: 'spacing'
      },
      {
        name: 'verticalSpacing',
        type: 'select',
        defaultValue: undefined,
        options: SPACING_OPTIONS,
        description: 'Vertical spacing',
        category: 'spacing'
      }
    ])
  },
  // Typography Components  
  {
    type: 'Code',
    displayName: 'Code',
    category: 'Typography',
    defaultProps: {
      children: 'console.log("Hello world")'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'console.log("Hello world")',
        description: 'Code content',
        category: 'content'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Code color',
        category: 'appearance'
      },
      {
        name: 'block',
        type: 'boolean',
        defaultValue: false,
        description: 'Display as block',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Mark',
    displayName: 'Highlight',
    category: 'Typography',
    defaultProps: {
      children: 'Highlighted text'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Highlighted text',
        description: 'Text to highlight',
        category: 'content'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'yellow',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Highlight color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Blockquote',
    displayName: 'Blockquote',
    category: 'Typography',
    defaultProps: {
      children: 'This is a blockquote',
      cite: '- Author'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'This is a blockquote',
        description: 'Quote content',
        category: 'content'
      },
      {
        name: 'cite',
        type: 'string',
        defaultValue: '- Author',
        description: 'Citation',
        category: 'content'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Quote color',
        category: 'appearance'
      }
    ])
  },
  // Display Components
  {
    type: 'Avatar',
    displayName: 'Avatar',
    category: 'Display',
    defaultProps: {
      size: 'md',
      radius: 'xl'
    },
    properties: addSpacingProperties([
      {
        name: 'src',
        type: 'string',
        defaultValue: '',
        description: 'Avatar image URL',
        category: 'content'
      },
      {
        name: 'alt',
        type: 'string',
        defaultValue: '',
        description: 'Alt text',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Avatar size',
        category: 'appearance'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'xl',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Border radius',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Avatar color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Indicator',
    displayName: 'Indicator',
    category: 'Display',
    defaultProps: {
      children: 'Content with indicator',
      label: '5'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Content with indicator',
        description: 'Content to wrap',
        category: 'content'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '5',
        description: 'Indicator label',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Indicator size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'red',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Indicator color',
        category: 'appearance'
      },
      {
        name: 'position',
        type: 'select',
        defaultValue: 'top-end',
        options: ['top-start', 'top-end', 'bottom-start', 'bottom-end'],
        description: 'Indicator position',
        category: 'appearance'
      }
    ])
  },
  // Navigation Components
  {
    type: 'Breadcrumbs',
    displayName: 'Breadcrumbs',
    category: 'Navigation',
    defaultProps: {
      children: ['Home', 'Products', 'Current Page']
    },
    properties: addSpacingProperties([
      {
        name: 'separator',
        type: 'string',
        defaultValue: '/',
        description: 'Separator character',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Tabs',
    displayName: 'Tabs',
    category: 'Navigation',
    defaultProps: {
      defaultValue: 'tab1',
      children: []
    },
    properties: addSpacingProperties([
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'default',
        options: ['default', 'outline', 'pills'],
        description: 'Tabs variant',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Tabs color',
        category: 'appearance'
      },
      {
        name: 'orientation',
        type: 'select',
        defaultValue: 'horizontal',
        options: ['horizontal', 'vertical'],
        description: 'Tabs orientation',
        category: 'appearance'
      }
    ])
  },
  // Feedback Components
  {
    type: 'Loader',
    displayName: 'Loader',
    category: 'Feedback',
    defaultProps: {
      size: 'md'
    },
    properties: addSpacingProperties([
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Loader size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Loader color',
        category: 'appearance'
      },
      {
        name: 'variant',
        type: 'select',
        defaultValue: 'oval',
        options: ['oval', 'bars', 'dots'],
        description: 'Loader variant',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Progress',
    displayName: 'Progress',
    category: 'Feedback',
    defaultProps: {
      value: 50,
      size: 'md'
    },
    properties: addSpacingProperties([
      {
        name: 'value',
        type: 'number',
        defaultValue: 50,
        description: 'Progress value (0-100)',
        category: 'content'
      },
      {
        name: 'size',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Progress size',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'blue',
        options: ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Progress color',
        category: 'appearance'
      },
      {
        name: 'radius',
        type: 'select',
        defaultValue: 'sm',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Border radius',
        category: 'appearance'
      },
      {
        name: 'striped',
        type: 'boolean',
        defaultValue: false,
        description: 'Striped appearance',
        category: 'appearance'
      },
      {
        name: 'animated',
        type: 'boolean',
        defaultValue: false,
        description: 'Animated stripes',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'RingProgress',
    displayName: 'Ring Progress',
    category: 'Feedback',
    defaultProps: {
      size: 120,
      thickness: 12,
      sections: [{ value: 40, color: 'blue' }]
    },
    properties: addSpacingProperties([
      {
        name: 'size',
        type: 'number',
        defaultValue: 120,
        description: 'Ring size in pixels',
        category: 'appearance'
      },
      {
        name: 'thickness',
        type: 'number',
        defaultValue: 12,
        description: 'Ring thickness',
        category: 'appearance'
      },
      {
        name: 'label',
        type: 'string',
        defaultValue: '',
        description: 'Center label',
        category: 'content'
      }
    ])
  },
  // Overlay Components  
  {
    type: 'Tooltip',
    displayName: 'Tooltip',
    category: 'Overlays',
    defaultProps: {
      label: 'Tooltip content',
      children: 'Hover me'
    },
    properties: addSpacingProperties([
      {
        name: 'label',
        type: 'string',
        defaultValue: 'Tooltip content',
        description: 'Tooltip text',
        category: 'content'
      },
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Hover me',
        description: 'Element to wrap',
        category: 'content'
      },
      {
        name: 'position',
        type: 'select',
        defaultValue: 'top',
        options: ['top', 'bottom', 'left', 'right'],
        description: 'Tooltip position',
        category: 'appearance'
      },
      {
        name: 'color',
        type: 'select',
        defaultValue: 'dark',
        options: ['dark', 'blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray'],
        description: 'Tooltip color',
        category: 'appearance'
      }
    ])
  },
  {
    type: 'Popover',
    displayName: 'Popover',
    category: 'Overlays',
    defaultProps: {
      children: 'Click me'
    },
    properties: addSpacingProperties([
      {
        name: 'children',
        type: 'string',
        defaultValue: 'Click me',
        description: 'Trigger element',
        category: 'content'
      },
      {
        name: 'position',
        type: 'select',
        defaultValue: 'bottom',
        options: ['top', 'bottom', 'left', 'right'],
        description: 'Popover position',
        category: 'appearance'
      },
      {
        name: 'width',
        type: 'number',
        defaultValue: 260,
        description: 'Popover width',
        category: 'appearance'
      },
      {
        name: 'shadow',
        type: 'select',
        defaultValue: 'md',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Popover shadow',
        category: 'appearance'
      }
    ])
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

// List of container components that can accept children
export const CONTAINER_COMPONENTS = ['Container', 'Group', 'Stack', 'Card', 'CardSection', 'Paper', 'Box', 'Flex', 'Grid', 'GridCol', 'SimpleGrid', 'Tabs', 'Indicator', 'Tooltip', 'Popover'];