/**
 * Framework Adapters - Type Definitions
 *
 * Defines the interface for framework-specific story generation.
 * Each framework adapter implements this interface to provide
 * framework-specific prompt generation and story templates.
 */

import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';

/**
 * Supported component frameworks
 */
export type FrameworkType =
  | 'react'
  | 'web-components'
  | 'vue'
  | 'angular'
  | 'svelte'
  | 'solid'
  | 'qwik';

/**
 * Supported story testing frameworks
 */
export type StoryFramework =
  | 'storybook-react'
  | 'storybook-vue3'
  | 'storybook-angular'
  | 'storybook-svelte'
  | 'storybook-web-components'
  | 'histoire'       // Vue alternative
  | 'ladle'          // React alternative
  | 'chromatic'      // Visual testing
  | 'custom';

/**
 * Detected framework information
 */
export interface DetectedFramework {
  /** The component framework used (React, Vue, etc.) */
  componentFramework: FrameworkType;
  /** The story framework to use (Storybook, Histoire, etc.) */
  storyFramework: StoryFramework;
  /** Version of the component framework if detectable */
  version?: string;
  /** Framework-specific configuration */
  config?: FrameworkConfig;
  /** Confidence level of detection (0-1) */
  confidence: number;
}

/**
 * Framework-specific configuration options
 */
export interface FrameworkConfig {
  /** Import style (named, default, namespace) */
  importStyle?: 'named' | 'default' | 'namespace';
  /** File extension for generated stories */
  storyExtension: string;
  /** TypeScript support */
  typescript: boolean;
  /** JSX/TSX support */
  jsx: boolean;
  /** Component file extension */
  componentExtension: string;
  /** Additional framework-specific options */
  options?: Record<string, unknown>;
}

/**
 * Generated prompt structure (framework-agnostic)
 */
export interface FrameworkPrompt {
  /** System prompt with framework-specific instructions */
  systemPrompt: string;
  /** Component reference documentation */
  componentReference: string;
  /** Layout instructions */
  layoutInstructions: string;
  /** Example stories */
  examples: string;
  /** Sample story template */
  sampleStory: string;
  /** Framework metadata */
  framework: DetectedFramework;
}

/**
 * Story generation options
 */
export interface StoryGenerationOptions {
  /** Target framework (auto-detect if not specified) */
  framework?: FrameworkType;
  /** Target story framework */
  storyFramework?: StoryFramework;
  /** Use TypeScript */
  typescript?: boolean;
  /** Include story documentation */
  includeDocumentation?: boolean;
  /** Include accessibility tests */
  includeA11yTests?: boolean;
  /** Include interaction tests */
  includeInteractionTests?: boolean;
}

/**
 * Framework Adapter Interface
 *
 * Each framework adapter must implement this interface to provide
 * framework-specific story generation capabilities.
 */
export interface FrameworkAdapter {
  /** Framework identifier */
  readonly type: FrameworkType;

  /** Display name */
  readonly name: string;

  /** Supported story frameworks */
  readonly supportedStoryFrameworks: StoryFramework[];

  /** Default file extension */
  readonly defaultExtension: string;

  /**
   * Generate the system prompt for this framework
   */
  generateSystemPrompt(
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string;

  /**
   * Generate component reference documentation
   */
  generateComponentReference(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string;

  /**
   * Generate example stories
   */
  generateExamples(config: StoryUIConfig): string;

  /**
   * Generate a sample story template
   */
  generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string;

  /**
   * Generate import statements for components
   */
  generateImports(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string;

  /**
   * Post-process generated story content
   */
  postProcess(storyContent: string): string;

  /**
   * Validate generated story syntax
   */
  validate(storyContent: string): { valid: boolean; errors: string[] };

  /**
   * Get the story file template
   */
  getStoryTemplate(options?: StoryGenerationOptions): string;
}

/**
 * Framework Detection Result
 */
export interface FrameworkDetectionResult {
  /** Detected frameworks sorted by confidence */
  frameworks: DetectedFramework[];
  /** Best match */
  primary: DetectedFramework;
  /** Package.json dependencies found */
  dependencies: Record<string, string>;
  /** Configuration files found */
  configFiles: string[];
}

/**
 * Component metadata for story generation
 */
export interface ComponentMetadata {
  /** Component name */
  name: string;
  /** Import path */
  importPath: string;
  /** Props definition */
  props: PropDefinition[];
  /** Component description */
  description?: string;
  /** Example usage */
  examples?: string[];
  /** Tags/categories */
  tags?: string[];
}

/**
 * Property definition
 */
export interface PropDefinition {
  /** Property name */
  name: string;
  /** Property type */
  type: string;
  /** Required flag */
  required: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Description */
  description?: string;
  /** Enum values if applicable */
  enumValues?: string[];
}
