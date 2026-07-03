// Main exports for Story UI package
export * from './story-ui.config.js';
export * from './story-generator/componentDiscovery.js';

export type {
  StoryUIConfig,
  ComponentConfig,
  LayoutRules
} from './story-ui.config.js';

export {
  createStoryUIConfig,
  DEFAULT_CONFIG,
  GENERIC_CONFIG_TEMPLATE
} from './story-ui.config.js';

export {
  discoverComponents,
  discoverComponentsFromDirectory,
  discoverComponentsFromCustomElements,
  discoverComponentsFromPackage
} from './story-generator/componentDiscovery.js';

export {
  buildFrameworkAwarePrompt
} from './story-generator/promptGenerator.js';
