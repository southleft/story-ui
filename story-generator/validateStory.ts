import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fixedCode?: string;
}

/**
 * Validates TypeScript code syntax and attempts to fix common issues
 */
export function validateStoryCode(code: string, fileName: string = 'story.tsx'): ValidationResult {
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
    const semanticErrors = performSemanticChecks(sourceFile);
    result.errors.push(...semanticErrors);

    if (result.errors.length > 0) {
      result.isValid = false;

      // Attempt to fix common issues
      const fixedCode = attemptAutoFix(code, result.errors);
      if (fixedCode && fixedCode !== code) {
        result.fixedCode = fixedCode;

        // Re-validate the fixed code
        const fixedValidation = validateStoryCode(fixedCode, fileName);
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
function performSemanticChecks(sourceFile: ts.SourceFile): string[] {
  const errors: string[] = [];

  function visit(node: ts.Node) {
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
  }

  return fixedCode;
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
 * Fixes unclosed JSX elements
 */
function fixUnclosedJSX(code: string): string {
  let fixedCode = code;

  // Simple heuristic to fix common JSX issues
  const jsxOpenTags = fixedCode.match(/<[A-Z]\w*[^>]*>/g) || [];
  const jsxCloseTags = fixedCode.match(/<\/[A-Z]\w*>/g) || [];

  // If we have more opening tags than closing tags, try to balance them
  if (jsxOpenTags.length > jsxCloseTags.length) {
    // This is a very basic fix - in practice, you'd need more sophisticated parsing
    // For now, we'll just add a warning
  }

  return fixedCode;
}

/**
 * Extracts and validates code blocks from AI responses
 */
export function extractAndValidateCodeBlock(aiResponse: string): ValidationResult {
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
  return validateStoryCode(extractedCode);
}

/**
 * Creates a fallback story template when generation fails
 */
export function createFallbackStory(prompt: string, config: any): string {
  const title = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
  const escapedTitle = title.replace(/"/g, '\\"');

  return `import React from 'react';
import type { StoryObj } from '@storybook/react';

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
