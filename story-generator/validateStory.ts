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

  // Determine framework from config
  const framework = config?.componentFramework || config?.framework || 'react';
  const isJsxFramework = framework === 'react' || framework === 'vue';

  // CRITICAL: Skip TypeScript AST validation for Svelte template files (.stories.svelte)
  // These files use Svelte syntax (<script context="module">, <Story>, <Template>) which
  // is not valid TypeScript and will fail TS parsing. Instead, do basic Svelte validation.
  if (fileName.endsWith('.stories.svelte') || fileName.endsWith('.svelte')) {
    return validateSvelteStory(code, config);
  }

    try {
    // Create a TypeScript source file
    // Use appropriate script kind based on framework
    const scriptKind = isJsxFramework ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    // Check for syntax errors using the program API
    const compilerOptions: ts.CompilerOptions = {
      jsx: isJsxFramework ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
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

    // Additional semantic checks - only for JSX frameworks (React, Vue with JSX)
    // For non-JSX frameworks (Angular, Svelte, Web Components), skip JSX-specific validation
    if (isJsxFramework) {
      const semanticErrors = performSemanticChecks(sourceFile, config);
      result.errors.push(...semanticErrors);
    }

    // Check for React import - but only for React-based frameworks
    const isReactFramework = framework === 'react' || framework.includes('react');
    const hasJSX = code.includes('<') || code.includes('/>');
    const hasReactImport = code.includes('import React from \'react\';');
    const hasLitHtml = code.includes('import { html }') || code.includes('from \'lit\'');

    // Only require React import for React frameworks, and skip for web-components/angular/vue/svelte
    if (hasJSX && !hasReactImport && isReactFramework && !hasLitHtml) {
      result.errors.push('Missing React import - add "import React from \'react\';" at the top of the file');
      result.isValid = false;
    }

    // CRITICAL: For non-React frameworks, REMOVE any React imports that the LLM incorrectly generated
    if (!isReactFramework && hasReactImport) {
      result.warnings.push(`Removed incorrect React import for ${framework} framework`);
      code = removeReactImport(code);
      result.fixedCode = code;
    }

    if (result.errors.length > 0) {
      result.isValid = false;

      // Attempt to fix common issues
      const fixedCode = attemptAutoFix(code, result.errors, config);
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
  const usedJsxComponents = new Set<string>();

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

        // CRITICAL: Check for incorrect import paths that contain the configured importPath but with extra segments
        // This catches LLM errors like: vuetify/components/lib/components/VAlert instead of vuetify/components
        // NOTE: Web Components often require deep imports to register custom elements, so we skip this check for them
        if (config && config.importPath && config.componentFramework !== 'web-components') {
          const configuredPath = config.importPath;

          // Check if LLM used a deep/incorrect path instead of the configured one
          if (importPath !== configuredPath &&
              (importPath.startsWith(configuredPath + '/') ||
               importPath.includes('/' + configuredPath.split('/').pop() + '/'))) {
            errors.push(
              `Import path error: Using "${importPath}" but the configured import path is "${configuredPath}". ` +
              `Change the import to: import { ComponentName } from '${configuredPath}';`
            );
          }
        }

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

        // Track all named imports from any module (React, icons, etc.)
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          node.importClause.namedBindings.elements.forEach(element => {
            importedComponents.add(element.name.text);
          });
        }
      }
    }

    // Track default imports (e.g., import React from 'react')
    if (ts.isImportDeclaration(node) && node.importClause && node.importClause.name) {
      importedComponents.add(node.importClause.name.text);
    }

    // Track JSX element names - CRITICAL: Catch undefined components
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName;

      // Handle different tag name types
      if (ts.isIdentifier(tagName)) {
        // Simple identifier like <Card> or <CardSection>
        const name = tagName.text;
        // Only track PascalCase names (components, not HTML elements like div, span)
        if (/^[A-Z]/.test(name)) {
          usedJsxComponents.add(name);
        }
      } else if (ts.isPropertyAccessExpression(tagName)) {
        // Compound component like <Card.Section>
        // The parent (Card) needs to be imported, not Card.Section
        if (ts.isIdentifier(tagName.expression)) {
          const parentName = tagName.expression.text;
          if (/^[A-Z]/.test(parentName)) {
            usedJsxComponents.add(parentName);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // CRITICAL CHECK: Verify all used JSX components are imported
  // This catches bugs where a component is used but never imported
  // This is framework-agnostic - works for any JSX-based framework
  for (const componentName of usedJsxComponents) {
    if (!importedComponents.has(componentName)) {
      errors.push(
        `JSX error: "${componentName}" is used but was never imported. ` +
        `Either add it to your imports, or if you intended to use a sub-component, ` +
        `use the correct syntax (e.g., Parent.Child instead of ParentChild).`
      );
    }
  }

  return errors;
}

/**
 * Attempts to automatically fix common syntax errors
 */
function attemptAutoFix(code: string, errors: string[], config?: any): string {
  let fixedCode = code;

  // CRITICAL: Fix missing React import first (most important for JSX)
  if (errors.some(e => e.includes('Missing React import'))) {
    fixedCode = fixMissingReactImport(fixedCode);
  }

  // CRITICAL: Fix incorrect import paths
  if (config?.importPath && errors.some(e => e.includes('Import path error'))) {
    fixedCode = fixIncorrectImportPaths(fixedCode, config.importPath);
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

  // CRITICAL: Fix unescaped apostrophes in title strings
  // LLMs often generate titles like: title: 'Women's Athletic' instead of 'Women\'s Athletic'
  fixedCode = fixUnescapedApostrophesInTitles(fixedCode);

  return fixedCode;
}

/**
 * Fixes unescaped apostrophes in title strings
 * LLMs often generate: title: 'Women's Athletic Dashboard'
 * Which should be: title: 'Women\'s Athletic Dashboard'
 *
 * Also handles cases where some apostrophes are escaped and others aren't:
 * title: 'Women\'s Athletic Dashboard's Athletic Dashboard'
 */
function fixUnescapedApostrophesInTitles(code: string): string {
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip if no title property
    if (!line.includes('title:')) continue;

    // Find title: followed by a quote character
    const titleStartMatch = line.match(/title:\s*(['"])/);
    if (!titleStartMatch) continue;

    const quoteChar = titleStartMatch[1];
    const titleKeywordIndex = line.indexOf('title:');
    const openQuoteIndex = line.indexOf(quoteChar, titleKeywordIndex);

    // Find the closing quote by looking for quote followed by comma or brace at end of line
    // The pattern is: quote + optional whitespace + (comma or brace) + optional whitespace + end
    const endPattern = new RegExp(`${quoteChar === "'" ? "'" : '"'}\\s*[,}]\\s*$`);
    const endMatch = line.match(endPattern);
    if (!endMatch) continue;

    const closeQuoteIndex = line.lastIndexOf(quoteChar);
    if (closeQuoteIndex <= openQuoteIndex) continue;

    // Extract content between opening and closing quotes
    const content = line.substring(openQuoteIndex + 1, closeQuoteIndex);

    // Process the content character by character to escape unescaped quotes
    let fixedContent = '';
    for (let j = 0; j < content.length; j++) {
      const char = content[j];
      const prevChar = j > 0 ? content[j - 1] : '';

      if (char === quoteChar && prevChar !== '\\') {
        // This is an unescaped quote inside the string - escape it
        fixedContent += '\\' + char;
      } else {
        fixedContent += char;
      }
    }

    // Only modify if we actually made changes
    if (fixedContent !== content) {
      const beforeQuote = line.substring(0, openQuoteIndex + 1);
      const afterQuote = line.substring(closeQuoteIndex);
      lines[i] = beforeQuote + fixedContent + afterQuote;
    }
  }

  let fixedCode = lines.join('\n');

  // Fix duplicated title segments (LLM sometimes repeats parts of the title)
  // e.g., "Women's Athletic Dashboard's Athletic Dashboard" -> "Women's Athletic Dashboard"
  fixedCode = fixDuplicatedTitleSegments(fixedCode);

  return fixedCode;
}

/**
 * Fixes duplicated segments in titles
 * LLMs sometimes generate: "Women's Athletic Dashboard's Athletic Dashboard"
 * Which should be: "Women's Athletic Dashboard"
 */
function fixDuplicatedTitleSegments(code: string): string {
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('title:')) continue;

    // Find title: followed by a quote
    const titleMatch = line.match(/title:\s*(['"])/);
    if (!titleMatch) continue;

    const quoteChar = titleMatch[1];
    const openQuoteIndex = line.indexOf(quoteChar, line.indexOf('title:'));
    const closeQuoteIndex = line.lastIndexOf(quoteChar);

    if (closeQuoteIndex <= openQuoteIndex) continue;

    // Extract title content (handling escaped quotes)
    const content = line.substring(openQuoteIndex + 1, closeQuoteIndex);

    // Normalize escaped quotes for word processing
    const normalizedContent = content.replace(/\\'/g, "'");

    // Split into words
    const words = normalizedContent.split(/\s+/);

    // Look for repeated word sequences
    let modified = false;
    let newWords = [...words];

    for (let windowSize = 2; windowSize <= Math.floor(words.length / 2); windowSize++) {
      for (let j = 0; j <= newWords.length - windowSize * 2; j++) {
        const segment1 = newWords.slice(j, j + windowSize).join(' ');
        const segment2 = newWords.slice(j + windowSize, j + windowSize * 2).join(' ');

        if (segment1 === segment2 && segment1.length > 3) {
          newWords = [...newWords.slice(0, j + windowSize), ...newWords.slice(j + windowSize * 2)];
          modified = true;
          break;
        }
      }
      if (modified) break;
    }

    // Also look for possessive duplications: "Dashboard's Athletic" ... "Dashboard"
    // Pattern: something ending with 's + words + that same word
    if (!modified) {
      const possessivePattern = /^(.+?)(['\\]?s\s+)(.+?)\s+\1$/i;
      const match = newWords.join(' ').match(possessivePattern);
      if (match) {
        newWords = (match[1] + match[2] + match[3]).split(/\s+/);
        modified = true;
      }
    }

    if (modified) {
      // Re-escape apostrophes for the output
      let newContent = newWords.join(' ');
      if (quoteChar === "'") {
        // Re-escape internal single quotes
        newContent = newContent.replace(/(?<!\\)'/g, "\\'");
      }

      const beforeQuote = line.substring(0, openQuoteIndex + 1);
      const afterQuote = line.substring(closeQuoteIndex);
      lines[i] = beforeQuote + newContent + afterQuote;
    }
  }

  return lines.join('\n');
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
 * Fixes incorrect import paths by replacing deep/wrong paths with the configured path
 * Catches LLM errors like: vuetify/components/lib/components/VAlert -> vuetify/components
 */
function fixIncorrectImportPaths(code: string, correctImportPath: string): string {
  let fixedCode = code;

  // Match import statements and extract the path
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const components = match[1];
    const importPath = match[2];

    // Check if this is a wrong variant of the configured import path
    // e.g., vuetify/components/lib/components/VAlert should be vuetify/components
    if (importPath !== correctImportPath &&
        (importPath.startsWith(correctImportPath + '/') ||
         importPath.includes('/' + correctImportPath.split('/').pop() + '/'))) {
      // Replace the incorrect import with the correct one
      const incorrectImport = match[0];
      const correctedImport = `import {${components}} from '${correctImportPath}'`;
      fixedCode = fixedCode.replace(incorrectImport, correctedImport);
    }
  }

  // Also fix multiple import statements from wrong paths and consolidate them
  // e.g., multiple lines like:
  //   import { VAlert } from 'vuetify/components/lib/components/VAlert';
  //   import { VBtn } from 'vuetify/components/lib/components/VBtn';
  // should become:
  //   import { VAlert, VBtn } from 'vuetify/components';

  // Find all component imports from wrong paths
  const wrongPathImports: string[] = [];
  const wrongPathPattern = new RegExp(
    `import\\s*\\{\\s*([A-Z][A-Za-z0-9]*)\\s*\\}\\s*from\\s*['"]${correctImportPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^'"]+['"]\\s*;?`,
    'g'
  );

  let wrongMatch;
  while ((wrongMatch = wrongPathPattern.exec(fixedCode)) !== null) {
    wrongPathImports.push(wrongMatch[1]);
    fixedCode = fixedCode.replace(wrongMatch[0], '');
  }

  // If we found wrong imports, add a consolidated correct import
  if (wrongPathImports.length > 0) {
    // Find where to insert (after the last import statement)
    const lastImportMatch = fixedCode.match(/import[^;]+;/g);
    if (lastImportMatch && lastImportMatch.length > 0) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1];
      const insertPos = fixedCode.lastIndexOf(lastImport) + lastImport.length;
      const consolidatedImport = `\nimport { ${wrongPathImports.join(', ')} } from '${correctImportPath}';`;
      fixedCode = fixedCode.slice(0, insertPos) + consolidatedImport + fixedCode.slice(insertPos);
    }
  }

  // Clean up any resulting double newlines
  fixedCode = fixedCode.replace(/\n\n\n+/g, '\n\n');

  return fixedCode;
}

/**
 * Removes React import for non-React frameworks (Vue, Angular, Svelte, Web Components)
 * The LLM sometimes incorrectly generates React imports for these frameworks
 */
function removeReactImport(code: string): string {
  // Remove various forms of React import
  const reactImportPatterns = [
    /import\s+React\s+from\s+['"]react['"]\s*;?\n?/g,
    /import\s+\*\s+as\s+React\s+from\s+['"]react['"]\s*;?\n?/g,
    /import\s+React,?\s*\{[^}]*\}\s+from\s+['"]react['"]\s*;?\n?/g,
    /import\s+\{[^}]*\}\s+from\s+['"]react['"]\s*;?\n?/g,
  ];

  let cleanedCode = code;
  for (const pattern of reactImportPatterns) {
    cleanedCode = cleanedCode.replace(pattern, '');
  }

  // Clean up any resulting double newlines
  cleanedCode = cleanedCode.replace(/\n\n\n+/g, '\n\n');

  return cleanedCode;
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
 * Automatically uses framework-appropriate filenames for validation routing
 */
export function extractAndValidateCodeBlock(aiResponse: string, config?: any, fileName?: string): ValidationResult {
  const framework = config?.componentFramework || 'react';

  // CRITICAL: Use framework-appropriate filename for proper validation routing
  // The validateStoryCode function uses fileName to determine which validator to use
  if (!fileName) {
    switch (framework) {
      case 'svelte':
        fileName = 'story.stories.svelte';
        break;
      case 'vue':
        fileName = 'story.stories.vue';
        break;
      case 'angular':
        fileName = 'story.stories.ts';
        break;
      case 'web-components':
        fileName = 'story.stories.ts';
        break;
      default:
        fileName = 'story.stories.tsx';
    }
  }

  // Build extraction methods based on framework
  const extractionMethods: Array<(text: string) => string | null> = [
    // Universal: Standard code blocks with common language identifiers
    (text: string) => {
      const match = text.match(/```(?:tsx|jsx|typescript|ts|js|javascript|svelte|html|vue)?\s*([\s\S]*?)\s*```/i);
      return match ? match[1].trim() : null;
    }
  ];

  // Framework-specific extraction methods
  if (framework === 'svelte') {
    // Svelte: Code starting with <script module> (addon-svelte-csf v5+ format)
    extractionMethods.push((text: string) => {
      const scriptModuleIndex = text.indexOf('<script module>');
      return scriptModuleIndex !== -1 ? text.slice(scriptModuleIndex).trim() : null;
    });
    // Svelte: Code starting with <script context="module"> (legacy format)
    extractionMethods.push((text: string) => {
      const scriptContextIndex = text.indexOf('<script context="module">');
      return scriptContextIndex !== -1 ? text.slice(scriptContextIndex).trim() : null;
    });
  } else if (framework === 'vue') {
    // Vue: Code starting with <script setup> or <template>
    extractionMethods.push((text: string) => {
      const scriptSetupIndex = text.indexOf('<script setup');
      return scriptSetupIndex !== -1 ? text.slice(scriptSetupIndex).trim() : null;
    });
  }

  // Universal fallbacks (all frameworks)
  extractionMethods.push(
    // Code starting with import (React, Angular, Web Components, etc.)
    (text: string) => {
      const importIndex = text.indexOf('import');
      return importIndex !== -1 ? text.slice(importIndex).trim() : null;
    },
    // Code starting with export (CSF format)
    (text: string) => {
      const exportIndex = text.indexOf('export');
      return exportIndex !== -1 ? text.slice(exportIndex).trim() : null;
    }
  );

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
  return validateStoryCode(extractedCode, fileName, config);
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

/**
 * Validates Svelte story files (.stories.svelte)
 * These use addon-svelte-csf format with <Story> components, not TypeScript CSF
 */
function validateSvelteStory(code: string, config?: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // ============================================================================
  // STRICT addon-svelte-csf v5+ VALIDATION
  // Only the NEW format is accepted. Old CSF v4 format will trigger errors
  // to ensure the self-healing loop can fix them.
  // ============================================================================

  // Detect format patterns
  const hasOldScriptModule = /<script\s+context=["']module["']>/i.test(code);
  const hasNewScriptModule = /<script\s+module\s*>/i.test(code);
  const hasOldMetaExport = /export\s+const\s+meta\s*=/.test(code);
  const hasExportDefaultMeta = /export\s+default\s+meta/.test(code);
  // More flexible regex for defineMeta - handles multi-line and various spacing
  const hasNewDefineMeta = /const\s*\{[^}]*Story[^}]*\}\s*=\s*defineMeta\s*\(/s.test(code);
  const hasDefineMetaImport = /import\s*\{[^}]*defineMeta[^}]*\}\s*from\s*['"]@storybook\/addon-svelte-csf['"]/s.test(code);
  const hasStoryComponent = /<Story\s+name=["'][^"']+["']/.test(code);

  // ============================================================================
  // REJECT OLD FORMAT (CSF v4) - These MUST trigger errors for self-healing
  // ============================================================================

  if (hasOldScriptModule) {
    result.errors.push('Using old syntax "<script context=\\"module\\">". Use "<script module>" instead for addon-svelte-csf v5+.');
    result.isValid = false;
  }

  if (hasOldMetaExport) {
    result.errors.push('Using old CSF syntax "export const meta = { ... }". Use "const { Story } = defineMeta({ ... })" instead for addon-svelte-csf v5+.');
    result.isValid = false;
  }

  if (hasExportDefaultMeta) {
    result.errors.push('Using old CSF syntax "export default meta". Use "const { Story } = defineMeta({ ... })" instead for addon-svelte-csf v5+.');
    result.isValid = false;
  }

  // Check for TypeScript CSF 3.0 format (completely wrong for Svelte)
  if (code.includes('type Story = StoryObj') || code.includes('const meta: Meta<')) {
    result.errors.push('Using TypeScript CSF 3.0 format instead of Svelte .stories.svelte format. Use <Story> components with defineMeta().');
    result.isValid = false;
  }

  // ============================================================================
  // REQUIRE NEW FORMAT (CSF v5+) - These are mandatory
  // ============================================================================

  if (!hasNewScriptModule) {
    result.errors.push('Missing required "<script module>" block. Svelte stories must start with <script module> (not <script context="module">).');
    result.isValid = false;
  }

  if (!hasDefineMetaImport) {
    result.errors.push('Missing required import: import { defineMeta } from "@storybook/addon-svelte-csf"');
    result.isValid = false;
  }

  if (!hasNewDefineMeta) {
    result.errors.push('Missing required defineMeta() call. Use: const { Story } = defineMeta({ title: "...", component: ... });');
    result.isValid = false;
  }

  if (!hasStoryComponent) {
    result.errors.push('Missing required <Story name="..."> component. Each story variant must be wrapped in <Story name="VariantName">.');
    result.isValid = false;
  }

  // ============================================================================
  // CHECK FOR REACT/JSX CONTAMINATION
  // ============================================================================

  if (/import\s+React\s+from\s+['"]react['"]/.test(code)) {
    result.errors.push('React import found in Svelte file. Remove: import React from "react"');
    result.isValid = false;
  }

  // Check for JSX-style attributes that should be Svelte syntax
  if (/\sclassName\s*=/.test(code)) {
    result.errors.push('Using JSX "className" attribute. Use "class" instead for Svelte.');
    result.isValid = false;
  }

  // Check for JSX-style camelCase event handlers (onClick, onChange)
  // Svelte 5 uses lowercase: onclick, onchange (NOT on:click which was Svelte 4)
  if (/\sonClick\s*=/.test(code)) {
    result.errors.push('Using JSX "onClick" attribute. Use "onclick" (lowercase) for Svelte 5.');
    result.isValid = false;
  }

  if (/\sonChange\s*=/.test(code)) {
    result.errors.push('Using JSX "onChange" attribute. Use "onchange" (lowercase) for Svelte 5.');
    result.isValid = false;
  }

  // ============================================================================
  // IMPORT PATH VALIDATION (if config provided)
  // ============================================================================

  if (config?.importPath) {
    const importMatches = code.matchAll(/import\s*\{[^}]+\}\s*from\s*['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      const importPath = match[1];
      // Skip Storybook imports
      if (importPath.includes('@storybook')) continue;
      // Check for deep path imports (should use main import path)
      if (importPath.startsWith(config.importPath + '/')) {
        result.errors.push(`Using deep import path "${importPath}". Import directly from "${config.importPath}" instead.`);
        result.isValid = false;
      }
    }
  }

  // ============================================================================
  // STRUCTURAL VALIDATION
  // ============================================================================

  // Validate title format
  if (config?.storyPrefix) {
    const titleMatch = code.match(/title:\s*['"]([^'"]+)['"]/);
    if (titleMatch && !titleMatch[1].startsWith(config.storyPrefix)) {
      result.warnings.push(`Title should start with "${config.storyPrefix}" prefix`);
    }
  }

  // Check for balanced script tags
  const scriptOpenCount = (code.match(/<script/g) || []).length;
  const scriptCloseCount = (code.match(/<\/script>/g) || []).length;
  if (scriptOpenCount !== scriptCloseCount) {
    result.errors.push('Unbalanced <script> tags - missing closing </script>');
    result.isValid = false;
  }

  // Check for balanced Story tags
  const storyOpenCount = (code.match(/<Story/g) || []).length;
  const storyCloseCount = (code.match(/<\/Story>/g) || []).length;
  if (storyOpenCount !== storyCloseCount) {
    result.errors.push('Unbalanced <Story> tags - missing closing </Story>');
    result.isValid = false;
  }

  return result;
}
