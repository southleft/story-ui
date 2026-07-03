import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { logger } from './logger.js';
export interface DocumentationSource {
  type: string; // md, mdx, json, yaml, yml, xml, html, txt
  path: string;
  content: string;
  category?: string; // components, tokens, patterns, guidelines, etc.
}

export interface LoadedDocumentation {
  sources: DocumentationSource[];
  guidelines: string[];
  tokens: Record<string, any>;
  patterns: Record<string, string>;
  components: Record<string, any>;
}

export class DocumentationLoader {
  private docsDir: string;
  private cache: LoadedDocumentation | null = null;
  private lastModified: number = 0;

  constructor(projectRoot: string) {
    // Look for story-ui-docs directory in project root
    this.docsDir = path.join(projectRoot, 'story-ui-docs');
  }

  /**
   * Check if documentation directory exists
   */
  hasDocumentation(): boolean {
    return fs.existsSync(this.docsDir);
  }

  /**
   * Load all documentation from the directory
   */
  async loadDocumentation(): Promise<LoadedDocumentation> {
    if (!this.hasDocumentation()) {
      return {
        sources: [],
        guidelines: [],
        tokens: {},
        patterns: {},
        components: {}
      };
    }

    // Check if cache is still valid. The directory mtime only changes for
    // direct children, so invalidation is based on the newest mtime across
    // all nested documentation files.
    const currentModified = this.computeLatestMtime();
    if (this.cache && currentModified <= this.lastModified) {
      return this.cache;
    }

    logger.log(`📚 Loading documentation from ${this.docsDir}`);

    const documentation: LoadedDocumentation = {
      sources: [],
      guidelines: [],
      tokens: {},
      patterns: {},
      components: {}
    };

    // Find all documentation files. Models read YAML/XML natively, so those
    // formats are included verbatim rather than parsed.
    const patterns = [
      '**/*.md',
      '**/*.mdx',
      '**/*.json',
      '**/*.yaml',
      '**/*.yml',
      '**/*.xml',
      '**/*.html',
      '**/*.txt',
    ];

    // Use async glob for ESM compatibility
    const allFiles: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: this.docsDir,
        absolute: false,
        ignore: ['**/node_modules/**', '**/.git/**']
      });
      allFiles.push(...matches);
    }
    const files = [...new Set(allFiles)]; // Remove duplicates

    logger.log(`📄 Found ${files.length} documentation files`);

    // Process each file, with a per-file budget so one giant document can't
    // crowd everything else out of the prompt.
    const PER_FILE_CHAR_BUDGET = 8000;
    for (const file of files) {
      // Skip README files as they are instructional, not design system documentation
      if (path.basename(file).toLowerCase().startsWith('readme')) {
        continue;
      }

      const filePath = path.join(this.docsDir, file);
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.length > PER_FILE_CHAR_BUDGET) {
        logger.log(`⚠️ Documentation file ${file} truncated from ${content.length} to ${PER_FILE_CHAR_BUDGET} chars for the prompt`);
        content = content.slice(0, PER_FILE_CHAR_BUDGET) + '\n…[truncated]';
      }
      const ext = path.extname(file).toLowerCase();
      const category = this.categorizeFile(file);

      const source: DocumentationSource = {
        type: ext.slice(1) as any,
        path: file,
        content,
        category
      };

      documentation.sources.push(source);

      // Process based on category and type
      this.processSource(source, documentation);
    }

    // Cache the results
    this.cache = documentation;
    this.lastModified = currentModified;

    logger.log(`✅ Loaded documentation with ${documentation.guidelines.length} guidelines, ${Object.keys(documentation.tokens).length} token categories, ${Object.keys(documentation.patterns).length} patterns`);

    return documentation;
  }

  /**
   * Newest mtime across all files under the docs dir (recursive) — used for
   * cache invalidation, since the directory's own mtime misses nested edits.
   */
  private computeLatestMtime(): number {
    let latest = 0;
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            walk(full);
          } else {
            const mtime = fs.statSync(full).mtimeMs;
            if (mtime > latest) latest = mtime;
          }
        } catch { /* unreadable entry */ }
      }
    };
    walk(this.docsDir);
    return latest;
  }

  /**
   * Categorize file based on path and name
   */
  private categorizeFile(filePath: string): string {
    const lower = filePath.toLowerCase();
    
    if (lower.includes('token')) return 'tokens';
    if (lower.includes('pattern')) return 'patterns';
    if (lower.includes('component')) return 'components';
    if (lower.includes('guideline') || lower.includes('guide')) return 'guidelines';
    if (lower.includes('spacing')) return 'tokens';
    if (lower.includes('color') || lower.includes('colour')) return 'tokens';
    if (lower.includes('typography') || lower.includes('font')) return 'tokens';
    
    // Check directory structure
    const parts = filePath.split(path.sep);
    if (parts.includes('tokens')) return 'tokens';
    if (parts.includes('patterns')) return 'patterns';
    if (parts.includes('components')) return 'components';
    if (parts.includes('guidelines')) return 'guidelines';
    
    return 'guidelines'; // default
  }

  /**
   * Process a documentation source based on its type and category
   */
  private processSource(source: DocumentationSource, docs: LoadedDocumentation) {
    switch (source.category) {
      case 'tokens':
        if (source.type === 'json') {
          try {
            const tokens = JSON.parse(source.content);
            Object.assign(docs.tokens, tokens);
          } catch (e) {
            console.warn(`Failed to parse JSON tokens from ${source.path}`);
          }
        } else if (source.type === 'yaml' || source.type === 'yml' || source.type === 'xml') {
          // Include verbatim in a fenced block — the model reads these natively
          docs.guidelines.push('\n## Tokens from ' + source.path + '\n```' + source.type + '\n' + source.content + '\n```');
        } else {
          // Extract token information from markdown/text
          docs.guidelines.push(`\n## Tokens from ${source.path}\n${source.content}`);
        }
        break;

      case 'patterns':
        // Extract pattern name from filename
        const patternName = path.basename(source.path, path.extname(source.path));
        docs.patterns[patternName] = source.content;
        break;

      case 'components':
        if (source.type === 'json') {
          try {
            const components = JSON.parse(source.content);
            Object.assign(docs.components, components);
          } catch (e) {
            console.warn(`Failed to parse JSON components from ${source.path}`);
          }
        } else {
          // Add to guidelines for AI to understand
          docs.guidelines.push(`\n## Component Documentation from ${source.path}\n${source.content}`);
        }
        break;

      case 'guidelines':
      default:
        docs.guidelines.push(`\n## ${path.basename(source.path, path.extname(source.path))}\n${source.content}`);
        break;
    }
  }

  /**
   * Format documentation for AI prompt
   */
  formatForPrompt(docs: LoadedDocumentation): string {
    let prompt = '';

    // Add guidelines — capped so a large docs folder can't blow up the prompt
    const TOTAL_GUIDELINES_BUDGET = 24000;
    if (docs.guidelines.length > 0) {
      prompt += '\n\n📚 DESIGN SYSTEM DOCUMENTATION (what this design system IS — its components, tokens, and patterns):\n';
      let joined = docs.guidelines.join('\n\n');
      if (joined.length > TOTAL_GUIDELINES_BUDGET) {
        logger.log(`⚠️ Design system documentation truncated from ${joined.length} to ${TOTAL_GUIDELINES_BUDGET} chars for the prompt`);
        joined = joined.slice(0, TOTAL_GUIDELINES_BUDGET) + '\n…[documentation truncated — keep files focused]';
      }
      prompt += joined;
    }

    // Add tokens
    if (Object.keys(docs.tokens).length > 0) {
      prompt += '\n\n🎨 DESIGN TOKENS:\n```json\n';
      prompt += JSON.stringify(docs.tokens, null, 2);
      prompt += '\n```\n';
    }

    // Add patterns
    if (Object.keys(docs.patterns).length > 0) {
      prompt += '\n\n📋 DESIGN PATTERNS:\n';
      for (const [name, pattern] of Object.entries(docs.patterns)) {
        prompt += `\n### ${name}\n${pattern}\n`;
      }
    }

    return prompt;
  }
}

/**
 * Example directory structure:
 * 
 * story-ui-docs/
 * ├── README.md                    # Overview and getting started
 * ├── guidelines/
 * │   ├── accessibility.md         # Accessibility guidelines
 * │   ├── responsive-design.md     # Responsive design rules
 * │   └── brand-guidelines.md      # Brand usage
 * ├── tokens/
 * │   ├── colors.json             # Color tokens
 * │   ├── spacing.md              # Spacing system
 * │   ├── typography.json         # Typography tokens
 * │   └── shadows.json            # Shadow tokens
 * ├── components/
 * │   ├── button.md               # Button documentation
 * │   ├── form-fields.md          # Form component docs
 * │   └── navigation.md           # Navigation patterns
 * └── patterns/
 *     ├── forms.md                # Form patterns
 *     ├── cards.md                # Card layouts
 *     ├── data-tables.md          # Table patterns
 *     └── authentication.md       # Auth flow patterns
 */
