/**
 * Post-process generated stories to fix common issues
 */

export function postProcessStory(code: string, libraryPath: string): string {
  console.log(`🔧 Post-processing story for library: ${libraryPath}`);
  
  // Adobe Spectrum specific fixes
  if (libraryPath === '@adobe/react-spectrum') {
    console.log('🎨 Applying Adobe Spectrum fixes...');
    return fixAdobeSpectrumStory(code);
  }
  
  return code;
}

function fixAdobeSpectrumStory(code: string): string {
  let fixed = code;
  
  // Fix grid layouts using inline styles
  // Pattern: <Flex style={{ display: 'grid', gridTemplateColumns: ..., gap: ... }}>
  const gridPattern = /<Flex\s+style=\{\{[^}]*display:\s*['"]?grid['"]?[^}]*\}\}>/g;
  const matches = fixed.match(gridPattern);
  
  if (matches) {
    console.log(`🔍 Found ${matches.length} grid patterns to fix`);
    
    fixed = fixed.replace(gridPattern, (match) => {
      console.log(`  Fixing: ${match}`);
      
      // Extract gap value if present
      const gapMatch = match.match(/gap:\s*['"]?([^'",}]+)['"]?/);
      const gap = gapMatch ? gapMatch[1].trim() : 'size-300';
      
      // Convert rem/px values to size tokens
      const sizeToken = convertToSizeToken(gap);
      const replacement = `<Flex wrap gap="${sizeToken}">`;
      
      console.log(`  Replaced with: ${replacement}`);
      return replacement;
    });
  }
  
  // Fix UNSAFE_style usage for text - replace with proper variant
  fixed = fixed.replace(
    /UNSAFE_style=\{\{fontSize:\s*['"](?:14px|0\.875rem)['"][^}]*\}\}/g,
    'variant="detail"'
  );
  
  // Fix width values that should use flex
  fixed = fixed.replace(
    /<View\s+width="size-4600">/g,
    '<View flex="1" minWidth="size-4600">'
  );
  
  return fixed;
}

function convertToSizeToken(value: string): string {
  const conversions: Record<string, string> = {
    '1rem': 'size-200',
    '1.5rem': 'size-300',
    '2rem': 'size-400',
    '16px': 'size-200',
    '24px': 'size-300',
    '32px': 'size-400',
  };
  
  return conversions[value] || 'size-300';
}