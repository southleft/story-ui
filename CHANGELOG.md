## [2.1.3](https://github.com/southleft/story-ui/compare/v2.1.2...v2.1.3) (2025-07-22)


### Bug Fixes

* clean up broken preview.tsx files when dependencies are missing ([dd9e3d2](https://github.com/southleft/story-ui/commit/dd9e3d27951eeb47bad61a71b7217e844f244128))

## [2.1.2](https://github.com/southleft/story-ui/compare/v2.1.1...v2.1.2) (2025-07-22)


### Bug Fixes

* ensure design system packages are installed before creating preview files ([#7](https://github.com/southleft/story-ui/issues/7)) ([f701749](https://github.com/southleft/story-ui/commit/f7017497b70fef1d7ffb0cd89f37d98e9ad0e63e))

## [2.1.1](https://github.com/southleft/story-ui/compare/v2.1.0...v2.1.1) (2025-07-22)


### Bug Fixes

* remove duplicate setupStorybookPreview function definition ([167e699](https://github.com/southleft/story-ui/commit/167e699a308e861230ae67879d7900d7b6020dc0))

# [2.1.0](https://github.com/southleft/story-ui/compare/v2.0.1...v2.1.0) (2025-07-22)


### Features

* add guided design system installation and auto-configuration ([#5](https://github.com/southleft/story-ui/issues/5)) ([7fe706a](https://github.com/southleft/story-ui/commit/7fe706aeaca487cf4905be7598264bfc4bc2f902))

## [2.0.1](https://github.com/southleft/story-ui/compare/v2.0.0...v2.0.1) (2025-07-22)


### Bug Fixes

* remove default Storybook components during init to prevent conflicts ([a1b1f27](https://github.com/southleft/story-ui/commit/a1b1f274d17ed91d2ff32b056cae2b50b861b81c))

# [2.0.0](https://github.com/southleft/story-ui/compare/v1.7.0...v2.0.0) (2025-07-22)


*  Guided Design System Installation with Auto-Configuration ([#2](https://github.com/southleft/story-ui/issues/2)) ([bc35023](https://github.com/southleft/story-ui/commit/bc3502355d9508313271fbaf210e60772b3ef671)), closes [#0052](https://github.com/southleft/story-ui/issues/0052)


### Bug Fixes

* **ci:** disable footer line length limit for semantic-release ([#3](https://github.com/southleft/story-ui/issues/3)) ([e7625d6](https://github.com/southleft/story-ui/commit/e7625d6cdc33506a3be5b2e1ede3344277c4a338))
* remove all baseui references and fix protected branch workflow ([0cb2fe1](https://github.com/southleft/story-ui/commit/0cb2fe15fe86beb1cbdda4cc622b6893005c33a2))
* remove hardcoded user paths from story-ui.config.js ([9494bd5](https://github.com/southleft/story-ui/commit/9494bd53d149fe2a37ee7744643d1f74d3b74bfb))


### BREAKING CHANGES

* Removed Playwright web scraping in favor of Context7 MCP integration

- Replace Playwright documentation scraping with Context7 MCP server
- Context7 provides real-time, curated documentation for popular libraries
- No setup required - documentation is fetched automatically
- Only current, valid components are provided (no deprecated components)
- Remove 'scrape-docs' and 'clear-docs-cache' CLI commands
- Add bundled documentation as fallback when Context7 is unavailable
- Enhanced component validation to prevent deprecated component usage
- Remove Playwright dependency from package.json

Benefits:
- Zero configuration required for documentation
- Always up-to-date with latest library versions
- No maintenance of web scrapers
- Consistent, reliable documentation format
- Better AI story generation with accurate component info

Migration guide available in docs/MIGRATION_TO_CONTEXT7.md

* feat: implement Context7 integration for real-time documentation

- Add Context7 integration for up-to-date component documentation
- Enhance story generation with multiple story variants
- Fix toLowerCase() undefined errors in component discovery
- Improve error handling and validation in story generation
- Update prompt generation to leverage Context7 documentation

* refactor: implement environment-specific Context7 integration

- Move Context7 configuration from main app to environment-specific setup
- Create context7-config.json files for each test environment
- Update CLI setup to generate Context7 config during initialization
- Remove hardcoded design system mappings from main application
- Make Context7 integration truly environment-agnostic
- Support custom design systems with local Context7 configuration
- Maintain architectural separation between main app and test environments

This ensures the main Story UI application remains agnostic while
allowing each Storybook environment to have its own Context7 setup.

* chore: remove .cursor and .claude from repository and add to .gitignore

* refactor: remove multi-instance infrastructure and introduce auto port detection

* feat: remove context7 integration and add documentation loader

- Removed Context7 MCP tool integration and related files
- Added new DocumentationLoader for directory-based documentation
- Enhanced prompt generation to support both legacy considerations files and new documentation directories
- Fixed async/await issues in buildClaudePrompt functions
- Added glob dependency for file discovery
- Created documentation structure for Material-UI test storybook
- Updated configuration to remove Context7 references

This sets the foundation for better design system documentation support and prepares for iteration improvements.

* feat: implement story iteration support with version history

- Added StoryHistoryManager to track all versions of generated stories
- Enhanced buildClaudePromptWithContext to include previous code for iterations
- AI now receives the actual generated code when modifying stories
- Added explicit instructions to preserve existing code and only modify requested aspects
- History files stored in .story-ui-history directory (git-ignored)
- Each story version linked to parent for iteration tracking

This ensures non-developers can safely iterate on layouts without fear of losing their original design.

* docs: update README and remove Spectrum/Context7 references

- Updated README with new documentation system and iteration features
- Removed all Context7 integration references
- Removed Adobe Spectrum from supported design systems
- Added documentation for directory-based docs structure
- Added production mode and CLI commands documentation
- Cleaned up post-processing to remove Spectrum-specific code
- Updated package.json keywords to reflect current features

* chore: remove accidentally added StoryUI files from main project root

These files should only exist in templates/ and test-storybooks/ directories

* feat: clean up test storybook instances and fix story generation issues

- Fix material-ui story using children in args anti-pattern
- Overhaul shadcn-storybook-registry to be component-first instead of Tailwind-first
- Update shadcn documentation to promote Alert components over custom divs
- Replace Banner component references with proper Alert component usage
- Align all test instances with Story UI's design-system-first philosophy
- Add proper component composition examples and guidelines
- Remove utility-first approaches that contradict Story UI principles

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: add missing package.json files and Story UI dependencies

- Create package.json for mantine-storybook (was missing entirely)
- Add @tpitre/story-ui dependency to ant-design-storybook
- Ensure all test storybooks are properly linked to core Story UI package
- Fix npm run story-ui command execution in all test environments

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: increase token limit and add truncation detection for story generation

- Increase max_tokens from 4096 to 8192 to prevent story truncation
- Add validation check for truncated stories with multiple closing tags
- Add validation for missing export default meta statement
- Fix manually truncated kanban dashboard story in Atlassian storybook

This prevents incomplete story generation that causes Storybook syntax errors.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* feat: add Atlassian branding to Storybook and update branding script
* Auto-discovery no longer includes @base_ui, @shopify/polaris, and other
unstable systems. Use guided installation for supported systems or manual configuration.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* refactor: remove unsupported design systems and cleanup codebase

- Remove @base_ui references from CLI and config files
- Remove Shopify Polaris documentation and references
- Clean up package.json dependencies (remove baseui, styletron, storybook)
- Remove unnecessary scripts directory entirely
- Simplify componentBlacklist.ts to remove Polaris-specific logic
- Clean documentation-sources.ts of all bundled documentation
- Update comments to reference only supported design systems

This ensures the codebase only contains references to the 3 officially supported
design systems: Chakra UI, Ant Design, and Mantine.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* refactor: remove all remaining references to unsupported design systems

- Remove baseui references from setup.ts interface and choices
- Update promptGenerator.ts example to use antd instead of baseui
- Clean universalDesignSystemAdapter.ts to only support Chakra UI, Ant Design, and Mantine
- Remove context7 configuration from story-ui.config.js
- Update react-import-rule.json examples to use antd instead of Shopify Polaris

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: resolve contradictory rules in prompt generator

- Remove Base UI specific UNSAFE_style prohibition
- Update provider component rule to be design system agnostic
- Clarify that theme providers should be at app level, not in stories
- Resolves contradiction with ChakraProvider setup instructions

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

# [1.7.0](https://github.com/southleft/story-ui/compare/v1.6.0...v1.7.0) (2025-06-19)


### Bug Fixes

* add environment protection to cleanup scripts - only remove .env files created by Story UI ([a698817](https://github.com/southleft/story-ui/commit/a698817ee5292e1f58a7193717c35b24b0adc585))
* add missing story-ui.config.ts file to resolve build errors ([5bb8f7a](https://github.com/southleft/story-ui/commit/5bb8f7a7478eb956367f9b34aadca7cc72371cc8))


### Features

* add comprehensive cleanup scripts for testing and demos ([5c3da22](https://github.com/southleft/story-ui/commit/5c3da221b9bf8458c8efc2bd1338ead76f29566e))
* add smart push script to handle automatic rebasing ([baed025](https://github.com/southleft/story-ui/commit/baed02597e5f357e8f5f4603ae3b8f0801604d48))
* add test project management system for clean testing cycles ([22b95a6](https://github.com/southleft/story-ui/commit/22b95a6aac8570b4a3b8335068ce243b2bee9cb6))

# [1.6.0](https://github.com/southleft/story-ui/compare/v1.5.2...v1.6.0) (2025-06-18)


### Features

* add GitHub templates, roadmap and project cleanup ([d4866db](https://github.com/southleft/story-ui/commit/d4866db1925ce305ba70a22c28d02e4e66aab9dd))

## [1.5.2](https://github.com/southleft/story-ui/compare/v1.5.1...v1.5.2) (2025-06-18)


### Bug Fixes

* support external design systems without local components directory ([2b6de67](https://github.com/southleft/story-ui/commit/2b6de6729b09697f571909b6abc62ba7e56a055f))

## [1.5.1](https://github.com/southleft/story-ui/compare/v1.5.0...v1.5.1) (2025-06-17)


### Bug Fixes

* **generator:** improve handling of truncated AI responses ([5924329](https://github.com/southleft/story-ui/commit/5924329ada8be82beedaad48e09edfd24a030612))

# Unreleased

### Bug Fixes
- **generator:** Fixed AI response truncation by increasing max_tokens from 1024 to 4096
- **validation:** Enhanced JSX closing tag detection and automatic fixing for truncated responses
- **validation:** Added intelligent truncation detection and recovery mechanisms
- **validation:** Improved handling of missing braces and incomplete code structures

# [1.5.0](https://github.com/southleft/story-ui/compare/v1.4.0...v1.5.0) (2025-06-17)


### Features

* enhanced component discovery system for design systems ([ee4e8c4](https://github.com/southleft/story-ui/commit/ee4e8c4dc45800d12965bf443506551f988b925d))

# [1.4.0](https://github.com/southleft/story-ui/compare/v1.3.0...v1.4.0) (2025-06-17)


### Features

* **generator:** implement story update mode to prevent duplicates ([9a67841](https://github.com/southleft/story-ui/commit/9a67841fb1a80145d739ed682bdbb4054032b4e4))

# [1.3.0](https://github.com/southleft/story-ui/compare/v1.2.0...v1.3.0) (2025-06-17)


### Features

* **generator:** add TypeScript validation system for generated stories ([845ec1b](https://github.com/southleft/story-ui/commit/845ec1b3b1ed0e67457cef054e4c3dae74f8c1c7))

## [1.1.1](https://github.com/southleft/story-ui/compare/v1.1.0...v1.1.1) (2025-06-17)


### Bug Fixes

* resolve Story UI port configuration and path resolution issues ([2059b51](https://github.com/southleft/story-ui/commit/2059b519e469610529caffffdbe564ed1f19cd7b))

# [1.1.0](https://github.com/southleft/story-ui/compare/v1.0.1...v1.1.0) (2025-06-16)


### Bug Fixes

* **config:** fixing commit lint ([1f2684e](https://github.com/southleft/story-ui/commit/1f2684e0b1db4c6d17585580b5a4214b4b419d0e))
* **deps:** correct commitizen version to 4.3.1 ([ba6c8f1](https://github.com/southleft/story-ui/commit/ba6c8f1478bdb27d4d2f9f642dc61b429d014ecd))


### Features

* **config:** add commit message validation with husky and commitlint ([a842214](https://github.com/southleft/story-ui/commit/a84221426462264bb53e1d1f8300a5426e247dfc))

## [1.0.1](https://github.com/southleft/story-ui/compare/v1.0.0...v1.0.1) (2025-06-16)


### Bug Fixes

* add publishConfig for scoped package npm publishing ([af860c2](https://github.com/southleft/story-ui/commit/af860c20adf0bf1f00dfd54f6927cd1a2f1907ec))
* **ci:** add package-lock.json for npm ci in GitHub Actions ([0a552d9](https://github.com/southleft/story-ui/commit/0a552d91254a4b73a5cf0a4e2e95fbb81d430fec))
* **ci:** sync package-lock.json and upgrade to Node.js 20 for semantic-release ([db7591f](https://github.com/southleft/story-ui/commit/db7591fbfa84a174e0c8a3e4905028e9b7d7caba))
* **ci:** update GitHub Actions checkout for semantic-release compatibility ([5f7a3ea](https://github.com/southleft/story-ui/commit/5f7a3ea0829ce82b7f1184c731c6a682fde3596b))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-06-16

### Added
- Initial release of Story UI
- AI-powered story generation using Claude API
- Interactive setup command (`npx story-ui init`)
- Built-in Storybook UI panel component
- Support for multiple design systems (Material-UI, Chakra UI, Ant Design, etc.)
- Automatic component discovery
- Smart layout generation
- In-memory story storage for production environments
- File-based story storage for development
- Git integration with automatic .gitignore management
- MCP server for Claude Desktop integration
- Comprehensive documentation and examples

### Features
- Natural language prompt to UI generation
- Multi-column layout support
- Component library agnostic architecture
- TypeScript support
- Conversation history and chat sessions
- Real-time story synchronization
- Memory-efficient production deployment
