import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { isBlacklistedComponent, validateImports } from './componentBlacklist.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fixedCode?: string;
}

/**
 * Validates TypeScript code syntax and attempts to fix common issues
 */
export function validateStoryCode(code: string, fileName: string = 'story.tsx', config?: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

    try {
    // Create a TypeScript source file
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    // Check for syntax errors using the program API
    const compilerOptions: ts.CompilerOptions = {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      skipLibCheck: true
    };

    // Create a program to get diagnostics
    const program = ts.createProgram([fileName], compilerOptions, {
      getSourceFile: (name) => name === fileName ? sourceFile : undefined,
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      fileExists: (name) => name === fileName,
      readFile: () => '',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: () => 'lib.d.ts'
    });

    const syntaxErrors = program.getSyntacticDiagnostics(sourceFile);

    if (syntaxErrors.length > 0) {
      result.isValid = false;

      for (const diagnostic of syntaxErrors) {
        if (diagnostic.file && diagnostic.start !== undefined) {
          const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          result.errors.push(`Line ${position.line + 1}, Column ${position.character + 1}: ${message}`);
        } else {
          result.errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
      }
    }

    // Additional semantic checks
    const semanticErrors = performSemanticChecks(sourceFile, config);
    result.errors.push(...semanticErrors);

    // Check for React import
    const hasJSX = code.includes('<') || code.includes('/>');
    const hasReactImport = code.includes('import React from \'react\';');
    if (hasJSX && !hasReactImport) {
      result.errors.push('Missing React import - add "import React from \'react\';" at the top of the file');
      result.isValid = false;
    }

    if (result.errors.length > 0) {
      result.isValid = false;

      // Attempt to fix common issues
      const fixedCode = attemptAutoFix(code, result.errors);
      if (fixedCode && fixedCode !== code) {
        result.fixedCode = fixedCode;

        // Re-validate the fixed code
        const fixedValidation = validateStoryCode(fixedCode, fileName, config);
        if (fixedValidation.isValid) {
          result.isValid = true;
          result.warnings.push('Code was automatically fixed for syntax errors');
        }
      }
    }

  } catch (error) {
    result.isValid = false;
    result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

/**
 * Performs additional semantic checks on the AST
 */
function performSemanticChecks(sourceFile: ts.SourceFile, config?: any): string[] {
  const errors: string[] = [];
  const availableComponents = new Set<string>();
  const importedComponents = new Set<string>();

  // If config is provided, collect available components
  if (config && config.componentsToImport) {
    config.componentsToImport.forEach((comp: string) => availableComponents.add(comp));
  }

  function visit(node: ts.Node) {
    // Check import statements for invalid components
    if (ts.isImportDeclaration(node) && node.importClause && node.importClause.namedBindings) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text;

        // Check if this is the main component library import
        if (config && config.importPath && importPath === config.importPath) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach(element => {
              const componentName = element.name.text;
              importedComponents.add(componentName);

              // Check if component exists in available components
              if (availableComponents.size > 0) {
                if (isBlacklistedComponent(componentName, availableComponents)) {
                  // This is a blacklisted component
                  const validation = validateImports([componentName], availableComponents);
                  const suggestions = validation.suggestions.get(componentName);

                  let errorMsg = `Import error: "${componentName}" is not a valid component from ${importPath}. This appears to be a story export name or made-up component.`;

                  if (suggestions && suggestions.length > 0) {
                    errorMsg += ` Use these components instead: ${suggestions.join(', ')}.`;
                  } else {
                    errorMsg += ` Use basic components like Box, Stack, Text, Button instead.`;
                  }

                  errors.push(errorMsg);
                } else if (!availableComponents.has(componentName)) {
                  errors.push(`Import error: "${componentName}" is not available from ${importPath}. Available components include: ${Array.from(availableComponents).slice(0, 10).join(', ')}...`);
                }
              }
            });
          }
        }
      }
    }

    // Check for unclosed JSX elements
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      // Additional JSX-specific checks could go here
    }

    // Check for missing imports
    if (ts.isIdentifier(node) && node.text && /^[A-Z]/.test(node.text)) {
      // This is a potential component reference - would need more context to validate
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return errors;
}

/**
 * Attempts to automatically fix common syntax errors
 */
function attemptAutoFix(code: string, errors: string[]): string {
  let fixedCode = code;

  // CRITICAL: Fix missing React import first (most important for JSX)
  if (errors.some(e => e.includes('Missing React import'))) {
    fixedCode = fixMissingReactImport(fixedCode);
  }

  // First, check if the code appears to be truncated
  if (isCodeTruncated(fixedCode)) {
    fixedCode = fixTruncatedCode(fixedCode);
  }

  // Fix common issues based on error patterns
  for (const error of errors) {
    if (error.includes('expected ","')) {
      // Try to fix missing commas in object literals
      fixedCode = fixMissingCommas(fixedCode);
    }

    if (error.includes('Unexpected token')) {
      // Try to fix unexpected tokens
      fixedCode = fixUnexpectedTokens(fixedCode);
    }

    if (error.includes('Unterminated string literal')) {
      // Try to fix unterminated strings
      fixedCode = fixUnterminatedStrings(fixedCode);
    }

    if (error.includes('JSX element') && error.includes('has no corresponding closing tag')) {
      // Try to fix unclosed JSX elements
      fixedCode = fixUnclosedJSX(fixedCode);
    }

    if (error.includes('}') && error.includes('expected')) {
      // Try to fix missing closing braces
      fixedCode = fixMissingBraces(fixedCode);
    }
  }

  return fixedCode;
}

/**
 * Detects if code appears to be truncated
 */
function isCodeTruncated(code: string): boolean {
  const lines = code.split('\n');
  const lastLine = lines[lines.length - 1].trim();

  // Check for common signs of truncation
  const truncationSigns = [
    // Incomplete JSX
    !lastLine.endsWith('>') && lastLine.includes('<'),
    // Incomplete string
    (lastLine.match(/["']/g) || []).length % 2 !== 0,
    // Ends mid-word or mid-expression
    /[a-zA-Z0-9]$/.test(lastLine) && !lastLine.endsWith(';') && !lastLine.endsWith('}'),
    // Incomplete function call
    lastLine.includes('(') && !lastLine.includes(')'),
  ];

  return truncationSigns.some(sign => sign);
}

/**
 * Attempts to fix truncated code
 */
function fixTruncatedCode(code: string): string {
  let fixedCode = code;

  // Remove incomplete last line if it's clearly truncated
  const lines = fixedCode.split('\n');
  const lastLine = lines[lines.length - 1];

  if (isCodeTruncated(code)) {
    // Remove the truncated line
    lines.pop();
    fixedCode = lines.join('\n');
  }

  return fixedCode;
}

/**
 * Fixes missing closing braces
 */
function fixMissingBraces(code: string): string {
  const openBraces = (code.match(/{/g) || []).length;
  const closeBraces = (code.match(/}/g) || []).length;
  const braceDiff = openBraces - closeBraces;

  if (braceDiff > 0) {
    // Add closing braces
    return code + '\n' + '}'.repeat(braceDiff);
  }

  return code;
}

/**
 * Fixes missing commas in object literals and function parameters
 */
function fixMissingCommas(code: string): string {
  // Common patterns where commas might be missing
  const fixes = [
    // Fix object property definitions
    { pattern: /(\w+):\s*([^,}\n]+)\s*\n\s*(\w+):/g, replacement: '$1: $2,\n  $3:' },
    // Fix array elements
    { pattern: /(\w+)\s*\n\s*(\w+)/g, replacement: '$1,\n  $2' },
    // Fix function parameters
    { pattern: /(\w+:\s*\w+)\s*\n\s*(\w+:)/g, replacement: '$1,\n  $2' }
  ];

  let fixedCode = code;
  for (const fix of fixes) {
    fixedCode = fixedCode.replace(fix.pattern, fix.replacement);
  }

  return fixedCode;
}

/**
 * Fixes unexpected token issues
 */
function fixUnexpectedTokens(code: string): string {
  let fixedCode = code;

  // Fix common unexpected token issues
  const fixes = [
    // Fix missing semicolons
    { pattern: /^(\s*)(export\s+\w+.*[^;])\s*$/gm, replacement: '$1$2;' },
    // Fix missing quotes around strings
    { pattern: /:\s*([^"'\s,}]+)\s*(,|\})/g, replacement: ': "$1"$2' },
    // Fix trailing commas in objects
    { pattern: /,(\s*\})/g, replacement: '$1' }
  ];

  for (const fix of fixes) {
    fixedCode = fixedCode.replace(fix.pattern, fix.replacement);
  }

  return fixedCode;
}

/**
 * Fixes unterminated string literals
 */
function fixUnterminatedStrings(code: string): string {
  let fixedCode = code;

  // Find lines with unterminated strings and try to fix them
  const lines = fixedCode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for unterminated quotes
    const singleQuoteCount = (line.match(/'/g) || []).length;
    const doubleQuoteCount = (line.match(/"/g) || []).length;

    if (singleQuoteCount % 2 !== 0) {
      lines[i] = line + "'";
    } else if (doubleQuoteCount % 2 !== 0) {
      lines[i] = line + '"';
    }
  }

  return lines.join('\n');
}

/**
 * Fixes missing React import for JSX
 */
function fixMissingReactImport(code: string): string {
  // Check if code has JSX but no React import
  const hasJSX = code.includes('<') || code.includes('/>');
  const hasReactImport = code.includes('import React') || code.includes('* as React');

  if (hasJSX && !hasReactImport) {
    // Find the first import statement or the beginning of the file
    const firstImportIndex = code.indexOf('import');

    if (firstImportIndex !== -1) {
      // Insert React import before the first import
      return code.slice(0, firstImportIndex) + "import React from 'react';\n" + code.slice(firstImportIndex);
    } else {
      // No imports, add at the beginning
      return "import React from 'react';\n" + code;
    }
  }

  return code;
}

/**
 * Fixes unclosed JSX elements
 */
function fixUnclosedJSX(code: string): string {
  let fixedCode = code;

  // Track open JSX elements with a stack
  const jsxStack: string[] = [];

  // Enhanced regex to match opening and closing tags
  const jsxRegex = /<\/?([A-Z][A-Za-z0-9]*)[^>]*>/g;
  let match;
  let lastValidPosition = 0;

  while ((match = jsxRegex.exec(fixedCode)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];

    if (fullMatch.startsWith('</')) {
      // Closing tag
      if (jsxStack.length > 0 && jsxStack[jsxStack.length - 1] === tagName) {
        jsxStack.pop();
        lastValidPosition = match.index + fullMatch.length;
      }
    } else if (fullMatch.endsWith('/>')) {
      // Self-closing tag - no action needed
      lastValidPosition = match.index + fullMatch.length;
    } else {
      // Opening tag
      jsxStack.push(tagName);
    }
  }

  // If we have unclosed tags, close them
  if (jsxStack.length > 0) {
    // Get the code up to the last valid position
    let closingTags = '';

    // Close all open tags in reverse order
    for (let i = jsxStack.length - 1; i >= 0; i--) {
      closingTags += `</${jsxStack[i]}>`;
    }

    // Check if the code appears to be truncated
    const lines = fixedCode.split('\n');
    const lastLine = lines[lines.length - 1];

    // If the last line doesn't end with a semicolon or closing brace, it might be truncated
    if (!lastLine.trim().endsWith(';') && !lastLine.trim().endsWith('}')) {
      // Try to intelligently close the structure
      fixedCode = fixedCode.trim();

      // Add the closing tags
      fixedCode += '\n' + closingTags;

      // Check if we need to close any JavaScript structures
      const openBraces = (fixedCode.match(/{/g) || []).length;
      const closeBraces = (fixedCode.match(/}/g) || []).length;
      const braceDiff = openBraces - closeBraces;

      if (braceDiff > 0) {
        // Add closing braces with proper indentation
        fixedCode += '\n' + '}'.repeat(braceDiff);
      }

      // Add final semicolon if needed
      if (!fixedCode.trim().endsWith(';')) {
        fixedCode += ';';
      }
    } else {
      // Insert closing tags before the last closing structure
      const insertPosition = findInsertPosition(fixedCode);
      fixedCode = fixedCode.slice(0, insertPosition) + closingTags + fixedCode.slice(insertPosition);
    }
  }

  return fixedCode;
}

/**
 * Finds the best position to insert closing tags
 */
function findInsertPosition(code: string): number {
  // Look for the last JSX content before export statements or closing braces
  const exportMatch = code.lastIndexOf('export const');
  const exportDefaultMatch = code.lastIndexOf('export default');
  const lastBraceMatch = code.lastIndexOf('};');

  let position = code.length;

  if (exportMatch > -1) {
    position = Math.min(position, exportMatch);
  }
  if (exportDefaultMatch > -1) {
    position = Math.min(position, exportDefaultMatch);
  }
  if (lastBraceMatch > -1) {
    position = Math.min(position, lastBraceMatch);
  }

  // Find the end of the last JSX element before the position
  const beforePosition = code.substring(0, position);
  const lastClosingTag = beforePosition.lastIndexOf('</');
  const lastSelfClosingTag = beforePosition.lastIndexOf('/>');

  const lastTag = Math.max(lastClosingTag, lastSelfClosingTag);
  if (lastTag > -1) {
    // Find the end of this tag
    const fromTag = code.substring(lastTag);
    const tagEnd = fromTag.indexOf('>');
    if (tagEnd > -1) {
      return lastTag + tagEnd + 1;
    }
  }

  return position;
}

/**
 * Extracts and validates code blocks from AI responses
 */
export function extractAndValidateCodeBlock(aiResponse: string, config?: any): ValidationResult {
  // Try multiple extraction methods
  const extractionMethods = [
    // Standard code blocks
    (text: string) => {
      const match = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript)?\s*([\s\S]*?)\s*```/i);
      return match ? match[1].trim() : null;
    },
    // Code starting with import
    (text: string) => {
      const importIndex = text.indexOf('import');
      return importIndex !== -1 ? text.slice(importIndex).trim() : null;
    },
    // Code starting with export
    (text: string) => {
      const exportIndex = text.indexOf('export');
      return exportIndex !== -1 ? text.slice(exportIndex).trim() : null;
    }
  ];

  let extractedCode: string | null = null;

  for (const method of extractionMethods) {
    extractedCode = method(aiResponse);
    if (extractedCode) break;
  }

  if (!extractedCode) {
    return {
      isValid: false,
      errors: ['No valid TypeScript code found in AI response'],
      warnings: []
    };
  }

  // Validate the extracted code
  return validateStoryCode(extractedCode, 'story.tsx', config);
}

/**
 * Creates a fallback story template when generation fails
 */
export function createFallbackStory(prompt: string, config: any): string {
  const title = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
  const escapedTitle = title.replace(/"/g, '\\"');
  const storybookFramework = config.storybookFramework || '@storybook/react';

  return `import React from 'react';
import type { StoryObj } from '${storybookFramework}';

// Fallback story generated due to AI generation error
export default {
  title: '${config.storyPrefix || 'Generated/'}${escapedTitle}',
  component: () => (
    <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px' }}>
      <h2>Story Generation Error</h2>
      <p>The AI-generated story contained syntax errors and could not be created.</p>
      <p><strong>Original prompt:</strong> ${escapedTitle}</p>
      <p>Please try rephrasing your request or contact support.</p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'This is a fallback story created when the AI generation failed due to syntax errors.'
      }
    }
  }
};

export const Default: StoryObj = {
  args: {}
};`;
}
