## [4.5.1](https://github.com/southleft/story-ui/compare/v4.5.0...v4.5.1) (2025-12-16)


### Bug Fixes

* **generator:** prohibit icon imports to prevent Gemini validation failures ([b581bd5](https://github.com/southleft/story-ui/commit/b581bd50b498dd0444a090c632dd1c5a846ef0d8))

# [4.5.0](https://github.com/southleft/story-ui/compare/v4.4.1...v4.5.0) (2025-12-15)


### Features

* **generator:** add Gemini 3 Pro Preview model ([d5eaf5a](https://github.com/southleft/story-ui/commit/d5eaf5a3deda345191feaf5fefb1da6026217984))

# [4.4.0](https://github.com/southleft/story-ui/compare/v4.3.0...v4.4.0) (2025-12-15)


### Features

* **ui:** add polling to detect MCP-generated stories and auto-refresh ([de6b1a1](https://github.com/southleft/story-ui/commit/de6b1a1e1b2a6f72b00f99f46e169f33089f393a))

# [4.3.0](https://github.com/southleft/story-ui/compare/v4.2.0...v4.3.0) (2025-12-15)


### Features

* **mcp:** add story management endpoints and production readiness fixes ([215e97c](https://github.com/southleft/story-ui/commit/215e97cf69faec0715096ae49453258afd4a88f3))

# [4.2.0](https://github.com/southleft/story-ui/compare/v4.1.1...v4.2.0) (2025-12-15)


### Bug Fixes

* **deps:** resolve merge conflicts and update LLM providers ([52ee58e](https://github.com/southleft/story-ui/commit/52ee58e37d5243faa0b13a2e322834713a9abde5))


### Features

* **ui:** add delete orphan stories functionality ([7b1cb51](https://github.com/southleft/story-ui/commit/7b1cb5137790f2111d16c3e890f6eeee48bf966d))

## [4.1.1](https://github.com/southleft/story-ui/compare/v4.1.0...v4.1.1) (2025-12-14)


### Bug Fixes

* **generator:** remove hash from story titles in Storybook navigation ([0472569](https://github.com/southleft/story-ui/commit/0472569386cad0955aa925a9de1038a80971bedb))

# [4.1.0](https://github.com/southleft/story-ui/compare/v4.0.1...v4.1.0) (2025-12-14)


### Features

* **ui:** persist provider preferences and hide hash from titles ([e40b450](https://github.com/southleft/story-ui/commit/e40b45067d25c6e9d183b8c3cdda331433b3cc9e))

## [4.0.1](https://github.com/southleft/story-ui/compare/v4.0.0...v4.0.1) (2025-12-14)


### Bug Fixes

* **generator:** respect provider/model selection from UI ([89fbebd](https://github.com/southleft/story-ui/commit/89fbebd2d6da522f313749f8ce74585da9b5df89))

# [4.0.0](https://github.com/southleft/story-ui/compare/v3.10.7...v4.0.0) (2025-12-14)


### Bug Fixes

* **cli:** add CSS file copy and auto-configure bundler for StoryUIPanel ([488ccef](https://github.com/southleft/story-ui/commit/488ccefbac5432fa6b5f7364d3685cc83eccdfe1))
* **cli:** detect Vite-based Storybook variants for Vue, Svelte, Web Components ([8ef6029](https://github.com/southleft/story-ui/commit/8ef602983d4903a0132c553eeb6a0e983e91d06c))
* **config:** add build step to prepare script for GitHub installs ([78bf77b](https://github.com/southleft/story-ui/commit/78bf77b940be439799378905f688f0dfa57bcf36))
* **config:** check for git dir before running husky in prepare script ([4bccf64](https://github.com/southleft/story-ui/commit/4bccf643660a6ad21eb5515a5f486135dfb99075))
* **config:** make prepare script resilient to missing git context ([afc1de1](https://github.com/southleft/story-ui/commit/afc1de1b553d46e4f6238b17147ca962a39efbb8))
* **generator:** add asChild prop to Svelte stories to prevent double-wrapping ([96f28d6](https://github.com/southleft/story-ui/commit/96f28d6260998a12ebda097d0b34737df9f08aa8))
* **generator:** add explicit guidance against deep import paths for Svelte ([409a154](https://github.com/southleft/story-ui/commit/409a154d93ad30755c8cc6a1661022659f425007))
* **generator:** add Svelte defineMeta title replacement to prevent duplicate story IDs ([3306480](https://github.com/southleft/story-ui/commit/33064805339d6c18984e09d9c90d590dc4d8341b))
* **generator:** handle Svelte CSF format in usable code detection and fallback ([c17f068](https://github.com/southleft/story-ui/commit/c17f0688e48b176f4ee1029abd2cd819226e92bf))
* **generator:** improve Svelte adapter regex to handle nested meta objects ([da96c79](https://github.com/southleft/story-ui/commit/da96c79b3c702c9aab91ffbdb0c8f2f8a6c02643))
* **generator:** make self-healing loop and validation framework-aware for Svelte ([9b42b4d](https://github.com/southleft/story-ui/commit/9b42b4d534ac74882869ae6481f25aee577cc683))
* **generator:** prevent double-nesting and update to Svelte 5 event syntax ([7f70930](https://github.com/southleft/story-ui/commit/7f709300cd73881f6327f343caa2387e23aceda9))
* **generator:** resolve 4 critical production bugs across frameworks ([daa97e8](https://github.com/southleft/story-ui/commit/daa97e864e7ba0673e2671d44ac7e06e3c36b0ca))
* **generator:** resolve Svelte code extraction and validation issues ([288cfb6](https://github.com/southleft/story-ui/commit/288cfb6d72e88ede19e8c4fd45dff0fec8c11fff))
* **generator:** return success:false when fallback error story is created ([299b535](https://github.com/southleft/story-ui/commit/299b5351c8769ad2561d0f4371e539bb4bd8edeb))
* **generator:** route Svelte code to Svelte validator in extractAndValidateCodeBlock ([26bdfb0](https://github.com/southleft/story-ui/commit/26bdfb0ce872cfc1468012fda9a9354869fbcbdd))
* **generator:** support addon-svelte-csf v5+ defineMeta syntax ([a2ed93e](https://github.com/southleft/story-ui/commit/a2ed93e839eaacfac04da31496ec8b1d20cc13ca))
* **generator:** update Svelte adapter for addon-svelte-csf v5+ defineMeta() syntax ([42e7ca8](https://github.com/southleft/story-ui/commit/42e7ca8f71005aa8c17159b291e00bdc5b337ecd))
* **mcp:** support fileName query param in delete endpoint ([bdcb422](https://github.com/southleft/story-ui/commit/bdcb422a9bd3a6d4ee330504fac7be92cf543ebc))
* security and ux improvements from llm audit ([faeb155](https://github.com/southleft/story-ui/commit/faeb155b28714da1417dc5da9c9905b972512982))
* sync package.json version with npm registry (3.10.9) ([c73f895](https://github.com/southleft/story-ui/commit/c73f895cd25d01ba73eb2e078c9216861c23a3a1))
* **ui:** preserve fileName during story iterations to prevent duplicates ([35f0345](https://github.com/southleft/story-ui/commit/35f0345f3418f8b34521604f4f332a14b2e39b84))
* **ui:** show 'Failed:' instead of 'Created:' when story generation fails ([a954626](https://github.com/southleft/story-ui/commit/a954626c379406602054481eb3cef4201aefcc1d))


### BREAKING CHANGES

* **generator:** for Svelte 5 / addon-svelte-csf v5.0.10+:
- Replace 'export const meta' with defineMeta() function
- Use '<script module>' instead of '<script context="module">'
- Destructure { Story } from defineMeta() return value
- Remove Template component (no longer needed in v5+)
- Add post-processing to convert old syntax to new
- Update validation to catch old CSF syntax patterns

This fixes the SB_SVELTE_CSF_PARSER_EXTRACT_SVELTE_0009 parser error
that occurs when using the old CSF export syntax with v5+ of the addon.

## [3.10.7](https://github.com/southleft/story-ui/compare/v3.10.6...v3.10.7) (2025-12-07)


### Bug Fixes

* **generator:** handle Svelte named imports with deep paths for flowbite-svelte ([438a89e](https://github.com/southleft/story-ui/commit/438a89ea2a28c8d6a112d362df6e9fa3a86581be))

## [3.10.6](https://github.com/southleft/story-ui/compare/v3.10.5...v3.10.6) (2025-12-07)


### Bug Fixes

* **generator:** prevent Angular TS4111 errors from state management patterns ([9df6f80](https://github.com/southleft/story-ui/commit/9df6f80f473a36789871baea8ecd3ffb4db86e97))

## [3.10.5](https://github.com/southleft/story-ui/compare/v3.10.4...v3.10.5) (2025-12-07)


### Bug Fixes

* **ui:** auto-refresh Storybook for new stories to fix Vite HMR import error ([aa1b976](https://github.com/southleft/story-ui/commit/aa1b976bcbbc424e0ab8714bd5abd5e454c36625))

## [3.10.4](https://github.com/southleft/story-ui/compare/v3.10.3...v3.10.4) (2025-12-07)


### Bug Fixes

* eliminate hardcoded React fallbacks for multi-framework support ([aa790ac](https://github.com/southleft/story-ui/commit/aa790ac4636628fcfc25e4112d8ba3d622e4eb2b))

## [3.10.3](https://github.com/southleft/story-ui/compare/v3.10.2...v3.10.3) (2025-12-07)


### Bug Fixes

* **generator:** resolve Svelte slot and Angular addon-actions errors ([6c84035](https://github.com/southleft/story-ui/commit/6c84035f8be76db5ebe5d8fa3509c1f20845d7f6))

## [3.10.2](https://github.com/southleft/story-ui/compare/v3.10.1...v3.10.2) (2025-12-07)


### Bug Fixes

* prevent Storybook duplicate ID errors with unique story titles ([7576998](https://github.com/southleft/story-ui/commit/7576998a94a89d88f79acc8a3770f819f3d8bdbb))

## [3.10.1](https://github.com/southleft/story-ui/compare/v3.10.0...v3.10.1) (2025-12-07)


### Bug Fixes

* detect custom domains as cloud deployments for MCP connection ([c76d049](https://github.com/southleft/story-ui/commit/c76d04984adfe0cc8bbbd42a7cd70bb521bfc98a))

# [3.10.0](https://github.com/southleft/story-ui/compare/v3.9.0...v3.10.0) (2025-12-06)


### Features

* redesign StoryUI panel with ShadCN-inspired chat interface ([d8bd165](https://github.com/southleft/story-ui/commit/d8bd1655f8d2759c0772634634404495a1fa0997))

# [3.9.0](https://github.com/southleft/story-ui/compare/v3.8.0...v3.9.0) (2025-12-04)


### Features

* add story management UI with bulk delete and clear all ([2177fa7](https://github.com/southleft/story-ui/commit/2177fa7e36803140bdd55452b143d145e975a33a))
* add story-ui update command for production deployments ([b1fff60](https://github.com/southleft/story-ui/commit/b1fff6065fe45a13a393d6e23bc2e4f90e44032e))

# [3.8.0](https://github.com/southleft/story-ui/compare/v3.7.0...v3.8.0) (2025-12-04)


### Features

* add runtime validation to catch Storybook runtime errors ([c32276b](https://github.com/southleft/story-ui/commit/c32276b796ae5800e39058dffabf48737430fdf5))

# [3.7.0](https://github.com/southleft/story-ui/compare/v3.6.2...v3.7.0) (2025-12-04)


### Bug Fixes

* add explicit framework prohibitions to prevent cross-framework component confusion ([c196e47](https://github.com/southleft/story-ui/commit/c196e471fa74a714a6d56cf9d09c3098a23e9f32))
* add framework-aware error suggestions for invalid import validation ([0f6386c](https://github.com/southleft/story-ui/commit/0f6386c2f812d5f76c1b3c3fa63c6fcabbfe198e))
* improve Vue/Vuetify story generation syntax ([f4d93b3](https://github.com/southleft/story-ui/commit/f4d93b30115d79ba8e75899eaa75a2d486ad8af6))
* make error suggestions design-system agnostic ([ac093df](https://github.com/southleft/story-ui/commit/ac093df37372df87c39752c51e613eadeb5f4b53))
* override Storybook CSS with !important for consistent styling ([5059957](https://github.com/southleft/story-ui/commit/5059957391678ec950922f8544a4d597a3fd87f8))


### Features

* add AI self-healing loop for story generation ([c607022](https://github.com/southleft/story-ui/commit/c6070224cf89a562348fa3fe47687f4c845934b6))
* add MDX wrapper for cross-framework StoryUIPanel rendering ([1c5b183](https://github.com/southleft/story-ui/commit/1c5b1834bdad948998d1bde8bf3087827335a143))
* remove custom Source Code addon in favor of native Storybook Docs ([2354352](https://github.com/southleft/story-ui/commit/23543527622fc57cec134593161f06653aaf4669))
* replace Unicode icons with SVGs, add human-readable model names ([e5433c3](https://github.com/southleft/story-ui/commit/e5433c3e96536add726b70646e5ca2d48738fa79))

## [3.6.2](https://github.com/southleft/story-ui/compare/v3.6.1...v3.6.2) (2025-12-02)


### Bug Fixes

* make Delete Story button more descriptive ([99d26ea](https://github.com/southleft/story-ui/commit/99d26ea0b5215dd77385ed92483c7f179ed30c66))

## [3.6.1](https://github.com/southleft/story-ui/compare/v3.6.0...v3.6.1) (2025-12-02)


### Bug Fixes

* show Delete button in empty state for generated stories ([e51c0d1](https://github.com/southleft/story-ui/commit/e51c0d123ea432c4dfc727d43ef2effcce268c08))

# [3.6.0](https://github.com/southleft/story-ui/compare/v3.5.1...v3.6.0) (2025-12-01)


### Features

* add delete button for generated stories in Source Code panel ([e0e6b4a](https://github.com/southleft/story-ui/commit/e0e6b4a79cfc39c9b0bf76ef571117d268394ce8))

## [3.5.1](https://github.com/southleft/story-ui/compare/v3.5.0...v3.5.1) (2025-12-01)


### Bug Fixes

* convert object-style props to proper JSX attribute syntax in Source Code panel ([7734fad](https://github.com/southleft/story-ui/commit/7734fad1b50927bc4875137b636f4bef7585bc8c))

# [3.5.0](https://github.com/southleft/story-ui/compare/v3.4.3...v3.5.0) (2025-12-01)


### Features

* add variant-specific usage code in Source Code panel ([db7d380](https://github.com/southleft/story-ui/commit/db7d38005a7b49e8ffb8cda9bf6c44193ac28596))

## [3.4.3](https://github.com/southleft/story-ui/compare/v3.4.2...v3.4.3) (2025-12-01)


### Bug Fixes

* use base64 data URL for attached image thumbnails in chat history ([c3ccdc4](https://github.com/southleft/story-ui/commit/c3ccdc4d7e77578bf2c4c3fed99856cd29c96bb5))

## [3.4.2](https://github.com/southleft/story-ui/compare/v3.4.1...v3.4.2) (2025-12-01)


### Bug Fixes

* add /story-ui/stories endpoint and fix API_BASE for Railway ([9aa124f](https://github.com/southleft/story-ui/commit/9aa124fb6570e1f4c1bb7c76ad8e51509e5f35b5))

## [3.4.1](https://github.com/southleft/story-ui/compare/v3.4.0...v3.4.1) (2025-12-01)


### Bug Fixes

* add explicit startCommand to railway.json for combined deployment ([ef9ffbf](https://github.com/southleft/story-ui/commit/ef9ffbf8796c69fa9fc7614cb97b7c4818f535d7))

# [3.4.0](https://github.com/southleft/story-ui/compare/v3.3.0...v3.4.0) (2025-12-01)


### Features

* add combined Storybook + MCP production deployment ([b34edd0](https://github.com/southleft/story-ui/commit/b34edd07c8485d9eaf24cc7bdaa13a3aa19577f0))

# [3.3.0](https://github.com/southleft/story-ui/compare/v3.2.0...v3.3.0) (2025-12-01)


### Features

* implement Streamable HTTP transport for Claude Desktop MCP ([73ce890](https://github.com/southleft/story-ui/commit/73ce89076e5e0ed761250cc6fa8c8de499004aa4))

# [3.2.0](https://github.com/southleft/story-ui/compare/v3.1.0...v3.2.0) (2025-12-01)


### Features

* add PostgreSQL persistence and remove Cloudflare Edge deployment ([34de0a6](https://github.com/southleft/story-ui/commit/34de0a63c66b8755d2e2260edc75347178ec9f3f))

# [3.1.0](https://github.com/southleft/story-ui/compare/v3.0.0...v3.1.0) (2025-12-01)


### Features

* add usage code extraction to Source Code panel ([312f7d8](https://github.com/southleft/story-ui/commit/312f7d8d5ad2290773078c9d14b4f4fdbfcb0230))

## [2.8.1](https://github.com/southleft/story-ui/compare/v2.8.0...v2.8.1) (2025-12-01)


### Bug Fixes

* auto-navigate to new story after generation to prevent HMR error ([77c1076](https://github.com/southleft/story-ui/commit/77c1076f8f0ff17d00b47ee1f3165ce2c054ceb0))

# [2.8.0](https://github.com/southleft/story-ui/compare/v2.7.0...v2.8.0) (2025-12-01)


### Features

* v3 cleanup - remove deprecated code and update documentation ([e56e5fb](https://github.com/southleft/story-ui/commit/e56e5fb7338bf7a56bfd28386ee72d1376f570f9))

# [2.7.0](https://github.com/southleft/story-ui/compare/v2.6.1...v2.7.0) (2025-11-30)


### Features

* add CLI --llm-provider option and improve component discovery ([dccf848](https://github.com/southleft/story-ui/commit/dccf848130dec53bc103f426120aaca05bb363bb))

## [2.6.1](https://github.com/southleft/story-ui/compare/v2.6.0...v2.6.1) (2025-11-30)


### Bug Fixes

* update model names and simplify design system options ([bfe9c04](https://github.com/southleft/story-ui/commit/bfe9c047ffb00df9691f0bd16a4aeed19f95d9dc))

# [2.6.0](https://github.com/southleft/story-ui/compare/v2.5.0...v2.6.0) (2025-11-30)


### Features

* add framework-agnostic updates for Story UI v3 ([f7d0b85](https://github.com/southleft/story-ui/commit/f7d0b85e3345aef881a229f636ba9c78ddbd19bb))

# [2.5.0](https://github.com/southleft/story-ui/compare/v2.4.0...v2.5.0) (2025-11-30)


### Features

* add Prism.js syntax highlighting and design-agnostic pop-out preview ([db15f9a](https://github.com/southleft/story-ui/commit/db15f9a43d836a5fe9a2de5910e8dff42f307fca))

# [2.4.0](https://github.com/southleft/story-ui/compare/v2.3.2...v2.4.0) (2025-11-30)


### Features

* update model selection to latest versions with friendly names ([cac5a4c](https://github.com/southleft/story-ui/commit/cac5a4ca127225d40947e6b689f96d08c04adf7a))

## [2.3.2](https://github.com/southleft/story-ui/compare/v2.3.1...v2.3.2) (2025-11-30)


### Bug Fixes

* allow user requests to override design system defaults in iterations ([75b9efa](https://github.com/southleft/story-ui/commit/75b9efa1b6f3800e0839469a1e4999709c2174c8))

## [2.3.1](https://github.com/southleft/story-ui/compare/v2.3.0...v2.3.1) (2025-11-29)


### Bug Fixes

* resolve useLocalStorage stale closure bug preventing chat history display ([184c436](https://github.com/southleft/story-ui/commit/184c43620b8988f381225dcfa5b88bc8b4a625d6))

# [2.3.0](https://github.com/southleft/story-ui/compare/v2.2.0...v2.3.0) (2025-11-29)


### Bug Fixes

* add considerations endpoint for Railway deployment ([dd316af](https://github.com/southleft/story-ui/commit/dd316af384b7ebfb853fba6322ce1baed39d3049))
* add post-generation validation gate and fix children prop stripping ([afb1918](https://github.com/southleft/story-ui/commit/afb191890eaf0713b45a64547a36d0a389368b23)), closes [#4](https://github.com/southleft/story-ui/issues/4) [#5](https://github.com/southleft/story-ui/issues/5)
* await async loadDocumentation call in considerations endpoint ([6a9b46a](https://github.com/southleft/story-ui/commit/6a9b46a3c7505bb0e8ed255c0edb1bd0c4dcefd1))
* extract system messages and pass as systemPrompt option ([33feb95](https://github.com/southleft/story-ui/commit/33feb95ad390d2262af2a7ec503059f9f95b791e))
* prevent LLM hallucination of wrong component libraries ([03d8254](https://github.com/southleft/story-ui/commit/03d8254e2c0a5ebb51cdbd1cc00b20c5cf1b9f74))
* remove organization-specific values for general-purpose use ([ba47a76](https://github.com/southleft/story-ui/commit/ba47a769e6e3387f9ece8d925ff055fd10306b5e))
* replace YOUR_ORG placeholders with actual organization names ([99ff48c](https://github.com/southleft/story-ui/commit/99ff48cddb3929806c10fc03f1ba032b499e167f))
* use fallback component list when npm package not installed ([057e9a4](https://github.com/southleft/story-ui/commit/057e9a40349c5fa46f33939f19f9547de39c5d56))


### Features

* add assistant prefill support for JSX output format ([8ff1a2b](https://github.com/southleft/story-ui/commit/8ff1a2b2095a5831d474b0c99ff7b682bffe7f3b))
* add Cloudflare Pages chat UI and unified deploy script ([e405aab](https://github.com/southleft/story-ui/commit/e405aabe2082812b32ab5fa4c655ba3f5130a867))
* add Cloudflare Workers edge deployment for MCP remote server ([a319671](https://github.com/southleft/story-ui/commit/a319671b0361fefb13be0ee1c5f1b877df158aa6))
* add environment parity for design system considerations ([8242b50](https://github.com/southleft/story-ui/commit/8242b502f572587368e869cb3bb48f593a781d38))
* add MCP remote HTTP transport for Claude Desktop connections ([37258e2](https://github.com/southleft/story-ui/commit/37258e22f8a29b79d40e54d149a5a3c6bd4ae1b9))
* add multi-provider LLM support and smart chat titles to Cloudflare edge ([e8215fc](https://github.com/southleft/story-ui/commit/e8215fce98ff94929e79265f85afe40aa4cfd15d))
* add multi-provider LLM support, framework adapters, and SSE streaming ([ed2b422](https://github.com/southleft/story-ui/commit/ed2b4221f063c94f36c836db032d2b149863bbe7))
* add production app template with universal best practices ([80252b7](https://github.com/southleft/story-ui/commit/80252b7c3249677ad0dfe0a6aa081bdfd36f1076))
* enhance chat responses with contextual component insights ([4e3c3a1](https://github.com/southleft/story-ui/commit/4e3c3a1c3e13482930d0d309d7bee574b65f66a6))

# [2.2.0](https://github.com/southleft/story-ui/compare/v2.1.5...v2.2.0) (2025-08-05)


### Bug Fixes

* implement direct file system reading for update-story operation ([df01bed](https://github.com/southleft/story-ui/commit/df01bed8116e8a6527407e1f4fc8f5345a520956))
* implement session management and direct file system operations for MCP server ([931b9ba](https://github.com/southleft/story-ui/commit/931b9baf8b790254074801a2c6286ac99c09a7c7))
* preserve story identity during updates to prevent URL changes ([dd830f4](https://github.com/southleft/story-ui/commit/dd830f4c0c3df250a9907ab7143a793756498c6d))
* resolve duplicate chat entries and Ant Design icon errors ([65fee01](https://github.com/southleft/story-ui/commit/65fee019f945e412657f518bcdb70632979c477b))


### Features

* add MCP (Model Context Protocol) integration for Story UI ([fb35f1d](https://github.com/southleft/story-ui/commit/fb35f1d6ba8248ac8fb4f24879ac8c89ad5759c3))
* add working MCP server integration with Claude Desktop ([ed359ee](https://github.com/southleft/story-ui/commit/ed359eeabe9d256d77515ab5b81cc84db0755cc7))
* implement URL redirect system for story updates ([4c8e54e](https://github.com/southleft/story-ui/commit/4c8e54e1186c92b9378137d5fa59d24ba4674125))

## [2.1.5](https://github.com/southleft/story-ui/compare/v2.1.4...v2.1.5) (2025-07-23)


### Bug Fixes

* handle story deletion with .stories.tsx extension in chat IDs ([5ee3dd0](https://github.com/southleft/story-ui/commit/5ee3dd0bc92d84b5a751226b2ee6f6fc9f798f28))

## [2.1.4](https://github.com/southleft/story-ui/compare/v2.1.3...v2.1.4) (2025-07-22)


### Bug Fixes

* improve design system installation flow with clearer messaging ([c520d13](https://github.com/southleft/story-ui/commit/c520d13f32499d59a89e2574ceb97ab014df365e))

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
