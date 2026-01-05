/**
 * Framework Adapters Module
 *
 * Exports framework detection, adapters, and the adapter registry.
 */

// Types
export * from './types.js';

// Framework Detection
export {
  FrameworkDetector,
  detectFramework,
  getFrameworkDetector,
} from './framework-detector.js';

// Base Adapter
export { BaseFrameworkAdapter } from './base-adapter.js';

// Framework Adapters
export { ReactAdapter, createReactAdapter } from './react-adapter.js';
export { WebComponentsAdapter, createWebComponentsAdapter } from './web-components-adapter.js';
export { VueAdapter, createVueAdapter } from './vue-adapter.js';
export { AngularAdapter, createAngularAdapter } from './angular-adapter.js';
export { SvelteAdapter, createSvelteAdapter } from './svelte-adapter.js';

// Imports for registry
import {
  FrameworkType,
  FrameworkAdapter,
  DetectedFramework,
  FrameworkPrompt,
  StoryGenerationOptions,
} from './types.js';
import { ReactAdapter } from './react-adapter.js';
import { WebComponentsAdapter } from './web-components-adapter.js';
import { VueAdapter } from './vue-adapter.js';
import { AngularAdapter } from './angular-adapter.js';
import { SvelteAdapter } from './svelte-adapter.js';
import { detectFramework } from './framework-detector.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';
import { logger } from '../logger.js';
import { generateLayoutInstructions } from '../promptGenerator.js';

/**
 * Framework Adapter Registry
 *
 * Manages available framework adapters and provides
 * automatic framework detection and adapter selection.
 */
class AdapterRegistry {
  private adapters: Map<FrameworkType, FrameworkAdapter> = new Map();
  private defaultAdapter: FrameworkAdapter;
  private detectedFramework: DetectedFramework | null = null;

  constructor() {
    // Register built-in adapters
    this.registerBuiltInAdapters();

    // Default to React
    this.defaultAdapter = this.adapters.get('react')!;
  }

  /**
   * Register built-in framework adapters
   */
  private registerBuiltInAdapters(): void {
    this.register(new ReactAdapter());
    this.register(new WebComponentsAdapter());
    this.register(new VueAdapter());
    this.register(new AngularAdapter());
    this.register(new SvelteAdapter());

    logger.debug('Registered framework adapters', {
      adapters: Array.from(this.adapters.keys()),
    });
  }

  /**
   * Register a framework adapter
   */
  register(adapter: FrameworkAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * Get adapter by framework type
   */
  get(type: FrameworkType): FrameworkAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Get all registered adapters
   */
  getAll(): FrameworkAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get available framework types
   */
  getAvailableTypes(): FrameworkType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get available framework types (alias for getAvailableTypes)
   */
  getAvailableFrameworks(): FrameworkType[] {
    return this.getAvailableTypes();
  }

  /**
   * Get adapter by framework type (alias for get with default fallback)
   */
  getAdapter(type: FrameworkType): FrameworkAdapter {
    return this.adapters.get(type) || this.defaultAdapter;
  }

  /**
   * Get the default adapter
   */
  getDefault(): FrameworkAdapter {
    return this.defaultAdapter;
  }

  /**
   * Set the default adapter
   */
  setDefault(type: FrameworkType): void {
    const adapter = this.adapters.get(type);
    if (adapter) {
      this.defaultAdapter = adapter;
      logger.debug('Set default framework adapter', { type });
    }
  }

  /**
   * Auto-detect framework and return appropriate adapter
   */
  async autoDetect(projectRoot?: string): Promise<FrameworkAdapter> {
    const result = await detectFramework(projectRoot);
    this.detectedFramework = result.primary;

    const adapter = this.adapters.get(result.primary.componentFramework);
    if (adapter) {
      logger.info('Auto-detected framework', {
        framework: result.primary.componentFramework,
        confidence: result.primary.confidence,
      });
      return adapter;
    }

    logger.warn('No adapter for detected framework, using default', {
      detected: result.primary.componentFramework,
      using: this.defaultAdapter.type,
    });
    return this.defaultAdapter;
  }

  /**
   * Get the last detected framework info
   */
  getDetectedFramework(): DetectedFramework | null {
    return this.detectedFramework;
  }

  /**
   * Generate prompt using the appropriate adapter
   */
  async generatePrompt(
    config: StoryUIConfig,
    components: DiscoveredComponent[],
    options?: StoryGenerationOptions
  ): Promise<FrameworkPrompt> {
    // Determine which adapter to use
    let adapter: FrameworkAdapter;

    if (options?.framework) {
      // Explicit framework specified
      adapter = this.adapters.get(options.framework) || this.defaultAdapter;
    } else if (this.detectedFramework) {
      // Use previously detected framework
      adapter = this.adapters.get(this.detectedFramework.componentFramework) || this.defaultAdapter;
    } else {
      // Auto-detect
      adapter = await this.autoDetect();
    }

    logger.debug('Generating prompt with adapter', { adapter: adapter.type });

    // Generate layout instructions including mandatory spacing rules
    const layoutInstructionsArray = generateLayoutInstructions(config);
    const layoutInstructionsString = layoutInstructionsArray.join('\n');

    return {
      systemPrompt: adapter.generateSystemPrompt(config, options),
      componentReference: adapter.generateComponentReference(components, config),
      layoutInstructions: layoutInstructionsString,
      examples: adapter.generateExamples(config),
      sampleStory: adapter.generateSampleStory(config, components),
      framework: this.detectedFramework || {
        componentFramework: adapter.type,
        storyFramework: adapter.supportedStoryFrameworks[0],
        confidence: 1,
      },
    };
  }
}

// Singleton registry instance
let registryInstance: AdapterRegistry | null = null;

/**
 * Get the global adapter registry instance
 */
export function getAdapterRegistry(): AdapterRegistry {
  if (!registryInstance) {
    registryInstance = new AdapterRegistry();
  }
  return registryInstance;
}

/**
 * Get adapter for a specific framework
 */
export function getAdapter(type: FrameworkType): FrameworkAdapter | undefined {
  return getAdapterRegistry().get(type);
}

/**
 * Get the default adapter
 */
export function getDefaultAdapter(): FrameworkAdapter {
  return getAdapterRegistry().getDefault();
}

/**
 * Auto-detect framework and get appropriate adapter
 */
export async function autoDetectAdapter(projectRoot?: string): Promise<FrameworkAdapter> {
  return getAdapterRegistry().autoDetect(projectRoot);
}

/**
 * Generate framework-specific prompt
 */
export async function generateFrameworkPrompt(
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<FrameworkPrompt> {
  return getAdapterRegistry().generatePrompt(config, components, options);
}
