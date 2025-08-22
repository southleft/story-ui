/**
 * @jest-environment node
 */

import { MANTINE_COMPONENTS, getComponentConfig, getComponentsByCategory } from '../config/componentRegistry.js';

describe('Component Registry', () => {
  describe('MANTINE_COMPONENTS', () => {
    test('should contain expected components', () => {
      const componentTypes = MANTINE_COMPONENTS.map(comp => comp.type);
      
      expect(componentTypes).toContain('Button');
      expect(componentTypes).toContain('TextInput');
      expect(componentTypes).toContain('Text');
      expect(componentTypes).toContain('Title');
      expect(componentTypes).toContain('Container');
      expect(componentTypes).toContain('Group');
      expect(componentTypes).toContain('Stack');
      expect(componentTypes).toContain('Card');
      expect(componentTypes).toContain('Card.Section');
    });

    test('should have valid structure for each component', () => {
      MANTINE_COMPONENTS.forEach(component => {
        expect(component).toHaveProperty('type');
        expect(component).toHaveProperty('displayName');
        expect(component).toHaveProperty('category');
        expect(component).toHaveProperty('defaultProps');
        expect(component).toHaveProperty('properties');
        
        expect(typeof component.type).toBe('string');
        expect(typeof component.displayName).toBe('string');
        expect(typeof component.category).toBe('string');
        expect(typeof component.defaultProps).toBe('object');
        expect(Array.isArray(component.properties)).toBe(true);
      });
    });

    test('should have valid properties for each component', () => {
      MANTINE_COMPONENTS.forEach(component => {
        component.properties.forEach(property => {
          expect(property).toHaveProperty('name');
          expect(property).toHaveProperty('type');
          
          expect(typeof property.name).toBe('string');
          expect(['string', 'number', 'boolean', 'color', 'select']).toContain(property.type);
          
          if (property.type === 'select') {
            expect(property).toHaveProperty('options');
            expect(Array.isArray(property.options)).toBe(true);
          }
        });
      });
    });

    test('should support compound components like Card.Section', () => {
      const cardSection = MANTINE_COMPONENTS.find(comp => comp.type === 'Card.Section');
      
      expect(cardSection).toBeDefined();
      expect(cardSection.type).toBe('Card.Section');
      expect(cardSection.displayName).toBe('Card Section');
      expect(cardSection.category).toBe('Layout');
      
      // Should have compound component specific properties
      expect(cardSection.properties.some(prop => prop.name === 'inheritPadding')).toBe(true);
      expect(cardSection.properties.some(prop => prop.name === 'withBorder')).toBe(true);
    });

    test('should have appropriate categories', () => {
      const categories = [...new Set(MANTINE_COMPONENTS.map(comp => comp.category))];
      
      expect(categories).toContain('Inputs');
      expect(categories).toContain('Typography');
      expect(categories).toContain('Layout');
    });
  });

  describe('getComponentConfig', () => {
    test('should return component config for valid type', () => {
      const buttonConfig = getComponentConfig('Button');
      
      expect(buttonConfig).toBeDefined();
      expect(buttonConfig.type).toBe('Button');
      expect(buttonConfig.displayName).toBe('Button');
    });

    test('should return undefined for invalid type', () => {
      const invalidConfig = getComponentConfig('NonExistentComponent');
      
      expect(invalidConfig).toBeUndefined();
    });

    test('should handle compound component names', () => {
      const cardSectionConfig = getComponentConfig('Card.Section');
      
      expect(cardSectionConfig).toBeDefined();
      expect(cardSectionConfig.type).toBe('Card.Section');
      expect(cardSectionConfig.displayName).toBe('Card Section');
    });
  });

  describe('getComponentsByCategory', () => {
    test('should group components by category', () => {
      const categorized = getComponentsByCategory();
      
      expect(categorized).toHaveProperty('Inputs');
      expect(categorized).toHaveProperty('Typography');
      expect(categorized).toHaveProperty('Layout');
      
      expect(Array.isArray(categorized.Inputs)).toBe(true);
      expect(Array.isArray(categorized.Typography)).toBe(true);
      expect(Array.isArray(categorized.Layout)).toBe(true);
    });

    test('should contain correct components in each category', () => {
      const categorized = getComponentsByCategory();
      
      const inputTypes = categorized.Inputs.map(comp => comp.type);
      expect(inputTypes).toContain('Button');
      expect(inputTypes).toContain('TextInput');
      
      const typographyTypes = categorized.Typography.map(comp => comp.type);
      expect(typographyTypes).toContain('Text');
      expect(typographyTypes).toContain('Title');
      
      const layoutTypes = categorized.Layout.map(comp => comp.type);
      expect(layoutTypes).toContain('Container');
      expect(layoutTypes).toContain('Card');
      expect(layoutTypes).toContain('Card.Section');
    });
  });
});