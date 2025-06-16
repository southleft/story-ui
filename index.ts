// Main exports for Story UI package
export * from './story-ui.config.js';
export * from './story-ui.config.loader.js';
export * from './story-generator/componentDiscovery.js';
export * from './story-generator/promptGenerator.js';

// Re-export key types and functions
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
  configLoader,
  loadStoryUIConfig
} from './story-ui.config.loader.js';

export {
  discoverComponents,
  discoverComponentsFromDirectory,
  discoverComponentsFromCustomElements,
  discoverComponentsFromPackage
} from './story-generator/componentDiscovery.js';

export {
  generatePrompt,
  buildClaudePrompt
} from './story-generator/promptGenerator.js';

export {
  ProductionGitignoreManager,
  setupProductionGitignore
} from './story-generator/productionGitignoreManager.js';

export {
  InMemoryStoryService,
  getInMemoryStoryService,
  GeneratedStory,
  StoryMetadata,
  MemoryStats
} from './story-generator/inMemoryStoryService.js';

export {
  StorySyncService,
  getStorySyncService,
  SyncedStory,
  ChatSyncResult
} from './story-generator/storySync.js';
