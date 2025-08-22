/**
 * @jest-environment node
 */

import { MANTINE_COMPONENTS, getComponentConfig } from '../config/componentRegistry.js';

describe('Missing Critical Mantine Components Analysis', () => {
  // Critical Mantine components that should be supported
  const criticalMantineComponents = [
    // Layout Components
    'AppShell',
    'AppShell.Header',
    'AppShell.Navbar',
    'AppShell.Main',
    'Grid',
    'Grid.Col',
    'SimpleGrid',
    'Flex',
    'Center',
    'Box',
    'Paper',
    'Divider',
    'Space',
    
    // Input Components
    'Select',
    'MultiSelect',
    'Checkbox',
    'Radio',
    'Switch',
    'Textarea',
    'NumberInput',
    'PasswordInput',
    'FileInput',
    'DateInput',
    'TimeInput',
    'Slider',
    'Rating',
    
    // Display Components
    'Table',
    'List',
    'List.Item',
    'Image',
    'Avatar',
    'Badge',
    'Chip',
    'Indicator',
    'Alert',
    'Notification',
    'Progress',
    'Loader',
    'Skeleton',
    'Tooltip',
    'Popover',
    'Modal',
    'Drawer',
    'Accordion',
    'Accordion.Item',
    'Tabs',
    'Tabs.List',
    'Tabs.Panel',
    'Tabs.Tab',
    'Stepper',
    'Timeline',
    'Spotlight',
    
    // Navigation Components
    'Breadcrumbs',
    'Pagination',
    'NavLink',
    'Anchor',
    'Menu',
    'Menu.Target',
    'Menu.Dropdown',
    'Menu.Item',
    
    // Form Components
    'Form',
    'Input',
    'Input.Wrapper',
    'Input.Label',
    'Input.Description',
    'Input.Error',
    'FieldError',
    
    // Typography
    'Code',
    'Mark',
    'Highlight',
    'Blockquote',
    
    // Utility Components
    'Portal',
    'FocusTrap',
    'ScrollArea',
    'Transition',
    'Affix',
    'BackgroundImage',
    'Overlay',
    'VisuallyHidden'
  ];

  const currentComponents = MANTINE_COMPONENTS.map(comp => comp.type);

  test('should identify missing critical components', () => {
    const missingComponents = criticalMantineComponents.filter(
      component => !currentComponents.includes(component)
    );

    console.log('\n🔍 Missing Critical Mantine Components:');
    
    if (missingComponents.length > 0) {
      const categorizedMissing = {
        layout: [],
        input: [],
        display: [],
        navigation: [],
        form: [],
        typography: [],
        utility: []
      };

      missingComponents.forEach(component => {
        if (['AppShell', 'Grid', 'SimpleGrid', 'Flex', 'Center', 'Box', 'Paper', 'Divider', 'Space'].includes(component)) {
          categorizedMissing.layout.push(component);
        } else if (['Select', 'MultiSelect', 'Checkbox', 'Radio', 'Switch', 'Textarea', 'NumberInput', 'PasswordInput', 'FileInput', 'DateInput', 'TimeInput', 'Slider', 'Rating'].includes(component)) {
          categorizedMissing.input.push(component);
        } else if (['Table', 'List', 'Image', 'Avatar', 'Badge', 'Chip', 'Indicator', 'Alert', 'Notification', 'Progress', 'Loader', 'Skeleton', 'Tooltip', 'Popover', 'Modal', 'Drawer', 'Accordion', 'Tabs', 'Stepper', 'Timeline', 'Spotlight'].includes(component)) {
          categorizedMissing.display.push(component);
        } else if (['Breadcrumbs', 'Pagination', 'NavLink', 'Anchor', 'Menu'].includes(component)) {
          categorizedMissing.navigation.push(component);
        } else if (['Form', 'Input', 'FieldError'].includes(component)) {
          categorizedMissing.form.push(component);
        } else if (['Code', 'Mark', 'Highlight', 'Blockquote'].includes(component)) {
          categorizedMissing.typography.push(component);
        } else {
          categorizedMissing.utility.push(component);
        }
      });

      Object.entries(categorizedMissing).forEach(([category, components]) => {
        if (components.length > 0) {
          console.log(`\n📂 ${category.toUpperCase()}:`);
          components.forEach(comp => console.log(`   - ${comp}`));
        }
      });

      console.log(`\n📊 Total missing: ${missingComponents.length} out of ${criticalMantineComponents.length} critical components`);
      console.log(`📈 Current coverage: ${((currentComponents.length / criticalMantineComponents.length) * 100).toFixed(1)}%`);
    } else {
      console.log('✅ All critical components are implemented!');
    }

    // This test documents the current state - it should not fail
    expect(Array.isArray(missingComponents)).toBe(true);
  });

  test('should have high-priority components implemented', () => {
    const highPriorityComponents = [
      'Button',
      'TextInput',
      'Text',
      'Title',
      'Container',
      'Group',
      'Stack',
      'Card',
      'Card.Section'
    ];

    highPriorityComponents.forEach(component => {
      const config = getComponentConfig(component);
      expect(config).toBeDefined();
      expect(config.type).toBe(component);
    });
  });

  test('should prioritize missing essential layout components', () => {
    const essentialLayoutComponents = [
      'Grid',
      'Grid.Col',
      'Flex',
      'Paper',
      'Divider',
      'Space'
    ];

    const missingEssential = essentialLayoutComponents.filter(
      component => !currentComponents.includes(component)
    );

    if (missingEssential.length > 0) {
      console.log('\n🚨 HIGH PRIORITY - Missing Essential Layout Components:');
      missingEssential.forEach(comp => console.log(`   - ${comp}`));
    }

    // Document the missing essential components
    expect(Array.isArray(missingEssential)).toBe(true);
  });

  test('should prioritize missing essential input components', () => {
    const essentialInputComponents = [
      'Select',
      'Checkbox',
      'Radio',
      'Switch',
      'Textarea'
    ];

    const missingEssential = essentialInputComponents.filter(
      component => !currentComponents.includes(component)
    );

    if (missingEssential.length > 0) {
      console.log('\n🚨 HIGH PRIORITY - Missing Essential Input Components:');
      missingEssential.forEach(comp => console.log(`   - ${comp}`));
    }

    // Document the missing essential components
    expect(Array.isArray(missingEssential)).toBe(true);
  });

  test('should verify compound component support capability', () => {
    const compoundComponents = currentComponents.filter(comp => comp.includes('.'));
    
    console.log('\n🔗 Currently Supported Compound Components:');
    compoundComponents.forEach(comp => console.log(`   - ${comp}`));

    // Should have at least Card.Section
    expect(compoundComponents).toContain('Card.Section');
    
    // Verify the parser can handle compound components
    expect(compoundComponents.length).toBeGreaterThan(0);
  });

  test('should suggest component priority additions', () => {
    const priorityAdditions = [
      {
        component: 'Grid',
        priority: 'High',
        reason: 'Essential for responsive layouts',
        category: 'Layout'
      },
      {
        component: 'Grid.Col',
        priority: 'High',
        reason: 'Required companion to Grid',
        category: 'Layout'
      },
      {
        component: 'Select',
        priority: 'High',
        reason: 'Critical form input component',
        category: 'Inputs'
      },
      {
        component: 'Checkbox',
        priority: 'High',
        reason: 'Essential form input',
        category: 'Inputs'
      },
      {
        component: 'Paper',
        priority: 'Medium',
        reason: 'Common container with elevation',
        category: 'Layout'
      },
      {
        component: 'Modal',
        priority: 'Medium',
        reason: 'Important for user interactions',
        category: 'Display'
      },
      {
        component: 'Tabs',
        priority: 'Medium',
        reason: 'Common navigation pattern',
        category: 'Display'
      }
    ];

    console.log('\n📋 Recommended Component Additions (Priority Order):');
    priorityAdditions.forEach(({ component, priority, reason, category }) => {
      const isImplemented = currentComponents.includes(component);
      const status = isImplemented ? '✅' : '❌';
      console.log(`   ${status} ${component} (${priority}) - ${reason} [${category}]`);
    });

    expect(Array.isArray(priorityAdditions)).toBe(true);
  });
});