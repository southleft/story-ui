import fs from 'fs';
import path from 'path';

export interface AIConsiderations {
  libraryName?: string;
  importPath?: string;
  description?: string;
  corePrinciples?: string[];
  componentRules?: Record<string, any>;
  imports?: Record<string, any>;
  patterns?: Record<string, any>;
  dos?: string[];
  donts?: string[];
  specialConsiderations?: string[];
  commonMistakes?: Array<{
    issue: string;
    wrong: string;
    correct: string;
    explanation: string;
  }>;
  aiInstructions?: {
    general?: string[];
    codeGeneration?: string[];
    testing?: string[];
  };
}

/**
 * Loads AI considerations from a markdown or JSON file
 */
export function loadConsiderations(considerationsPath?: string): AIConsiderations | null {
  if (!considerationsPath) {
    // Try to find considerations file in common locations
    const possiblePaths = [
      path.join(process.cwd(), 'story-ui-considerations.json'),
      path.join(process.cwd(), 'story-ui-considerations.md'),
      path.join(process.cwd(), '.storybook', 'story-ui-considerations.json'),
      path.join(process.cwd(), '.storybook', 'story-ui-considerations.md'),
    ];

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        considerationsPath = possiblePath;
        console.log(`Found considerations file at: ${considerationsPath}`);
        break;
      }
    }
  }

  if (!considerationsPath || !fs.existsSync(considerationsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(considerationsPath, 'utf-8');
    const ext = path.extname(considerationsPath).toLowerCase();

    if (ext === '.json') {
      return JSON.parse(content) as AIConsiderations;
    } else if (ext === '.md') {
      return parseMarkdownConsiderations(content);
    }
  } catch (error) {
    console.warn(`Failed to load considerations from ${considerationsPath}:`, error);
  }

  return null;
}

/**
 * Parses markdown content to extract AI considerations
 */
function parseMarkdownConsiderations(content: string): AIConsiderations {
  const considerations: AIConsiderations = {};

  // Extract library name and import path from frontmatter or headers
  const libraryMatch = content.match(/\*\*Library Name\*\*:\s*(.+)/);
  if (libraryMatch) {
    considerations.libraryName = libraryMatch[1].trim();
  }

  const importMatch = content.match(/\*\*Import Path\*\*:\s*`(.+)`/);
  if (importMatch) {
    considerations.importPath = importMatch[1].trim();
  }

  // Extract sections
  const sections = content.split(/^##\s+/m);
  
  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.trim().toLowerCase();

    if (title.includes('core principles')) {
      considerations.corePrinciples = extractListItems(section);
    } else if (title.includes("do's and don'ts")) {
      const doSection = section.match(/###\s*✅\s*DO\s*([\s\S]*?)(?=###|$)/);
      const dontSection = section.match(/###\s*❌\s*DON'T\s*([\s\S]*?)(?=###|$)/);
      
      if (doSection) {
        considerations.dos = extractListItems(doSection[1]);
      }
      if (dontSection) {
        considerations.donts = extractListItems(dontSection[1]);
      }
    } else if (title.includes('special considerations')) {
      considerations.specialConsiderations = extractListItems(section);
    } else if (title.includes('error patterns')) {
      considerations.commonMistakes = extractErrorPatterns(section);
    }
  }

  // Extract AI instructions from the entire content
  considerations.aiInstructions = {
    general: extractAIInstructions(content)
  };

  return considerations;
}

/**
 * Extracts list items from a markdown section
 */
function extractListItems(section: string): string[] {
  const items: string[] = [];
  const lines = section.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.match(/^\d+\.\s+/)) {
      const item = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      if (item && !item.startsWith('<!--')) {
        items.push(item);
      }
    }
  }
  
  return items;
}

/**
 * Extracts error patterns from markdown
 */
function extractErrorPatterns(section: string): Array<{ issue: string; wrong: string; correct: string; explanation: string }> {
  const patterns: Array<{ issue: string; wrong: string; correct: string; explanation: string }> = [];
  const errorBlocks = section.match(/\d+\.\s*\*\*Wrong\*\*:[\s\S]*?(?=\d+\.\s*\*\*Wrong\*\*:|$)/g);

  if (errorBlocks) {
    for (const block of errorBlocks) {
      const wrongMatch = block.match(/\*\*Wrong\*\*:\s*`([^`]+)`/);
      const rightMatch = block.match(/\*\*Right\*\*:\s*`([^`]+)`/);
      const whyMatch = block.match(/\*\*Why\*\*:\s*(.+)/);
      const issueMatch = block.match(/^\d+\.\s*(.+?)\s*\n/);

      if (wrongMatch && rightMatch) {
        patterns.push({
          issue: issueMatch ? issueMatch[1].replace(/\*\*/g, '').trim() : 'Pattern',
          wrong: wrongMatch[1],
          correct: rightMatch[1],
          explanation: whyMatch ? whyMatch[1].trim() : ''
        });
      }
    }
  }

  return patterns;
}

/**
 * Extracts AI-specific instructions from the content
 */
function extractAIInstructions(content: string): string[] {
  const instructions: string[] = [];
  
  // Look for specific instruction patterns
  const instructionPatterns = [
    /(?:always|never|must|should|ensure|remember|important)(?:\s+\w+)*[:.]?\s*(.+)/gi,
    /(?:use|prefer|avoid|don't)(?:\s+\w+)*[:.]?\s*(.+)/gi
  ];

  for (const pattern of instructionPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const instruction = match[1].trim();
      if (instruction.length > 10 && instruction.length < 200 && !instruction.includes('<!--')) {
        instructions.push(instruction);
      }
    }
  }

  // Remove duplicates
  return [...new Set(instructions)];
}

/**
 * Converts considerations to prompt additions
 */
export function considerationsToPrompt(considerations: AIConsiderations): string {
  const promptParts: string[] = [];

  if (considerations.libraryName) {
    promptParts.push(`LIBRARY: ${considerations.libraryName}`);
  }

  if (considerations.description) {
    promptParts.push(`\n${considerations.description}`);
  }

  if (considerations.corePrinciples && considerations.corePrinciples.length > 0) {
    promptParts.push('\nCORE PRINCIPLES:');
    considerations.corePrinciples.forEach(principle => {
      promptParts.push(`- ${principle}`);
    });
  }

  if (considerations.dos && considerations.dos.length > 0) {
    promptParts.push('\nIMPORTANT - ALWAYS DO:');
    considerations.dos.forEach(rule => {
      promptParts.push(`- ${rule}`);
    });
  }

  if (considerations.donts && considerations.donts.length > 0) {
    promptParts.push('\nIMPORTANT - NEVER DO:');
    considerations.donts.forEach(rule => {
      promptParts.push(`- ${rule}`);
    });
  }

  if (considerations.commonMistakes && considerations.commonMistakes.length > 0) {
    promptParts.push('\nCOMMON MISTAKES TO AVOID:');
    considerations.commonMistakes.forEach(mistake => {
      promptParts.push(`- ${mistake.issue}`);
      promptParts.push(`  WRONG: ${mistake.wrong}`);
      promptParts.push(`  CORRECT: ${mistake.correct}`);
      if (mistake.explanation) {
        promptParts.push(`  WHY: ${mistake.explanation}`);
      }
    });
  }

  if (considerations.specialConsiderations && considerations.specialConsiderations.length > 0) {
    promptParts.push('\nSPECIAL CONSIDERATIONS:');
    considerations.specialConsiderations.forEach(consideration => {
      promptParts.push(`- ${consideration}`);
    });
  }

  if (considerations.aiInstructions) {
    if (considerations.aiInstructions.general && considerations.aiInstructions.general.length > 0) {
      promptParts.push('\nAI INSTRUCTIONS:');
      considerations.aiInstructions.general.forEach(instruction => {
        promptParts.push(`- ${instruction}`);
      });
    }
  }

  return promptParts.join('\n');
}