import { generateStoryFileContent, generatePropsString } from '../storyFileUpdater';
import type { ComponentDefinition } from '../../types/index';

describe('storyFileUpdater', () => {
  describe('generatePropsString', () => {
    it('should generate correct style props with double curly braces', () => {
      const props = {
        style: { maxWidth: 400, padding: '1rem' }
      };
      
      const result = generatePropsString(props, 'Card');
      
      // Should have double curly braces for style object
      expect(result).toBe(' style={{ maxWidth: 400, padding: \'1rem\' }}');
      expect(result).not.toContain('style="');
      expect(result).toContain('style={{');
    });

    it('should handle numeric values in style objects correctly', () => {
      const props = {
        style: { width: 300, height: 200, zIndex: 10 }
      };
      
      const result = generatePropsString(props, 'div');
      
      expect(result).toBe(' style={{ width: 300, height: 200, zIndex: 10 }}');
    });

    it('should handle string values in style objects with quotes', () => {
      const props = {
        style: { color: 'red', backgroundColor: '#fff', display: 'flex' }
      };
      
      const result = generatePropsString(props, 'div');
      
      expect(result).toBe(' style={{ color: \'red\', backgroundColor: \'#fff\', display: \'flex\' }}');
    });

    it('should handle mixed style values correctly', () => {
      const props = {
        style: { 
          maxWidth: 400,
          padding: '1rem',
          margin: 0,
          display: 'block'
        }
      };
      
      const result = generatePropsString(props, 'Card');
      
      expect(result).toBe(' style={{ maxWidth: 400, padding: \'1rem\', margin: 0, display: \'block\' }}');
    });

    it('should handle other prop types correctly alongside style', () => {
      const props = {
        shadow: 'md',
        padding: 'xl',
        radius: 'md',
        withBorder: true,
        style: { maxWidth: 400 }
      };
      
      const result = generatePropsString(props, 'Card');
      
      expect(result).toContain('shadow="md"');
      expect(result).toContain('padding="xl"');
      expect(result).toContain('radius="md"');
      expect(result).toContain('withBorder');
      expect(result).toContain('style={{ maxWidth: 400 }}');
      expect(result).not.toContain('style="');
    });

    it('should filter out children prop for Text components', () => {
      const props = {
        children: 'Some text',
        size: 'lg'
      };
      
      const result = generatePropsString(props, 'Text');
      
      expect(result).toBe(' size="lg"');
      expect(result).not.toContain('children');
    });

    it('should keep children prop for Button components', () => {
      const props = {
        children: 'Click me',
        variant: 'outline'
      };
      
      const result = generatePropsString(props, 'Button');
      
      expect(result).toContain('children="Click me"');
      expect(result).toContain('variant="outline"');
    });
  });

  describe('generateStoryFileContent', () => {
    it('should map CardSection to Card.Section in JSX', () => {
      const components: ComponentDefinition[] = [{
        id: 'card1',
        type: 'Card',
        displayName: 'Card',
        category: 'mantine',
        props: { shadow: 'md', padding: 'lg' },
        children: [{
          id: 'cardSection1',
          type: 'CardSection',
          displayName: 'Card Section',
          category: 'mantine',
          props: {},
          children: []
        }]
      }];
      
      const result = generateStoryFileContent(components, 'CardWithSection', 'card-section.stories.tsx');
      
      // Should contain Card.Section, not CardSection
      expect(result).toContain('<Card.Section>');
      expect(result).toContain('</Card.Section>');
      expect(result).not.toContain('<CardSection>');
      expect(result).not.toContain('</CardSection>');
      // Should only import Card, not CardSection
      expect(result).toContain('import { Card }');
      expect(result).not.toContain('import { CardSection }');
    });

    it('should generate story with correct style syntax', () => {
      const components: ComponentDefinition[] = [{
        id: 'card1',
        type: 'Card',
        displayName: 'Card',
        category: 'mantine',
        props: {
          shadow: 'md',
          padding: 'xl',
          radius: 'md',
          withBorder: true,
          style: { maxWidth: 400 }
        },
        children: []
      }];
      
      const result = generateStoryFileContent(components, 'TestStory', 'test.stories.tsx');
      
      // Should contain double curly braces, not single quotes around object
      expect(result).toContain('style={{ maxWidth: 400 }}');
      expect(result).not.toContain('style="{ maxWidth: 400 }"');
      expect(result).not.toContain('style="');
    });

    it('should generate story with complex style objects correctly', () => {
      const components: ComponentDefinition[] = [{
        id: 'div1',
        type: 'div',
        displayName: 'div',
        category: 'html',
        props: {
          style: { 
            maxWidth: 400,
            padding: '1rem',
            margin: 0,
            backgroundColor: '#f8f9fa',
            borderRadius: '8px'
          }
        },
        children: []
      }];
      
      const result = generateStoryFileContent(components, 'ComplexStyle', 'complex.stories.tsx');
      
      expect(result).toContain('style={{ maxWidth: 400, padding: \'1rem\', margin: 0, backgroundColor: \'#f8f9fa\', borderRadius: \'8px\' }}');
      expect(result).not.toContain('style="');
    });

    it('should handle nested components with styles correctly', () => {
      const components: ComponentDefinition[] = [{
        id: 'card1',
        type: 'Card',
        displayName: 'Card',
        category: 'mantine',
        props: {
          style: { maxWidth: 400 }
        },
        children: [{
          id: 'stack1',
          type: 'Stack',
          displayName: 'Stack',
          category: 'mantine',
          props: {
            gap: 'md',
            style: { padding: '1rem' }
          },
          children: []
        }]
      }];
      
      const result = generateStoryFileContent(components, 'NestedStyles', 'nested.stories.tsx');
      
      expect(result).toContain('style={{ maxWidth: 400 }}');
      expect(result).toContain('style={{ padding: \'1rem\' }}');
      expect(result).not.toContain('style="');
    });
  });
});