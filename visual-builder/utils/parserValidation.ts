// Validation utility to test the parser fix
import { parseStoryUIToBuilder } from './storyToBuilder';

/**
 * Test the JSX parser with the recipe card story
 */
export function validateParserFix(): void {
  console.log('🧪 Validating JSX Parser Fix');
  console.log('='.repeat(40));

  // Sample JSX from the recipe card story (simplified for testing)
  const testJSX = `
export const Default: Story = {
  render: () => (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Card.Section>
        <Image
          src="https://picsum.photos/400/200?random=1"
          height={200}
          alt="Test image"
        />
      </Card.Section>
      <Stack gap="md" mt="md">
        <Group justify="space-between" align="flex-start">
          <Text fw={500} size="lg">
            Test Title
          </Text>
          <Badge color="green" variant="light">
            30 min
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Test description text
        </Text>
      </Stack>
    </Card>
  ),
};`;

  try {
    const result = parseStoryUIToBuilder(testJSX);
    
    console.log('📊 Parse Results:');
    console.log(`  Components: ${result.components.length}`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log(`  Warnings: ${result.warnings.length}`);

    if (result.errors.length > 0) {
      console.log('❌ Errors:');
      result.errors.forEach(error => console.log(`    ${error}`));
      return;
    }

    // Test the component structure
    if (result.components.length > 0) {
      const rootComponent = result.components[0];
      console.log(`\n🏗️ Root Component: ${rootComponent.type}`);
      
      if (rootComponent.type === 'Card' && rootComponent.children) {
        console.log(`✅ Card has ${rootComponent.children.length} children`);
        
        // Check for Card.Section -> CardSection mapping
        const cardSection = rootComponent.children.find(c => c.type === 'CardSection');
        if (cardSection) {
          console.log('✅ Found CardSection component');
          console.log(`   CardSection children: ${cardSection.children?.length || 0}`);
          
          if (cardSection.children && cardSection.children.length > 0) {
            const image = cardSection.children.find(c => c.type === 'Image');
            if (image) {
              console.log('✅ Found Image inside CardSection');
            } else {
              console.log('❌ Image not found inside CardSection');
            }
          }
        } else {
          console.log('❌ CardSection not found');
        }
        
        // Check for Stack component
        const stack = rootComponent.children.find(c => c.type === 'Stack');
        if (stack) {
          console.log('✅ Found Stack component');
          console.log(`   Stack children: ${stack.children?.length || 0}`);
          
          if (stack.children && stack.children.length >= 2) {
            const group = stack.children.find(c => c.type === 'Group');
            if (group) {
              console.log('✅ Found Group inside Stack');
              console.log(`   Group children: ${group.children?.length || 0}`);
            }
          }
        } else {
          console.log('❌ Stack not found');
        }
        
        // Display full tree structure
        console.log('\n🌳 Full Component Tree:');
        printComponentTree(result.components, 0);
        
        // Success criteria
        const hasCorrectNesting = 
          rootComponent.type === 'Card' &&
          rootComponent.children?.some(c => c.type === 'CardSection') &&
          rootComponent.children?.some(c => c.type === 'Stack');
          
        if (hasCorrectNesting) {
          console.log('\n🎉 SUCCESS: Parser correctly maintains nested structure!');
        } else {
          console.log('\n❌ FAILED: Parser still losing nested structure');
        }
      } else {
        console.log('❌ Root component is not Card or has no children');
      }
    } else {
      console.log('❌ No components parsed');
    }
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  }
}

function printComponentTree(components: any[], depth: number): void {
  const indent = '  '.repeat(depth);
  components.forEach(comp => {
    console.log(`${indent}📦 ${comp.type} (${comp.id})`);
    if (comp.children && comp.children.length > 0) {
      printComponentTree(comp.children, depth + 1);
    }
  });
}