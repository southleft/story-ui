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
