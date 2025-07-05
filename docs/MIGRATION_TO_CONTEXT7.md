# Migration to Context7 Integration

## Overview

Story UI has migrated from web scraping documentation with Playwright to using [Context7](https://context7.com/), a dedicated MCP server that provides real-time, curated documentation for popular component libraries.

## What Changed

### Before (Playwright Scraping)
- Users had to run `npx story-ui scrape-docs` to fetch documentation
- Documentation could include deprecated components
- Scrapers could break when documentation sites changed
- Required Playwright as a dependency
- Documentation quickly became outdated

### After (Context7 Integration)
- Documentation is fetched automatically - no user action required
- Only current, valid components are provided
- Always up-to-date with the latest library versions
- No web scraping dependencies needed
- Consistent, reliable documentation format

## Benefits

1. **Zero Configuration**: Documentation works out of the box
2. **Always Current**: Real-time access to latest component APIs
3. **No Deprecated Components**: Context7 filters out deprecated components
4. **Faster Setup**: No need to run scraping commands
5. **More Reliable**: No dependency on website structure

## How It Works

When you request a story, Story UI now:

1. Checks if Context7 has documentation for your library
2. Fetches real-time component information
3. Uses only documented, current components in generated stories
4. Falls back to bundled documentation if Context7 is unavailable

## Supported Libraries

Context7 currently provides documentation for:

- Shopify Polaris - https://context7.com/shopify/polaris
- Material-UI
- Ant Design
- Chakra UI
- Mantine
- And many more...

## Migration Steps

If you were using the Playwright scraping feature:

1. **Update Story UI**: `npm update @tpitre/story-ui`
2. **Remove Cached Docs** (optional): `rm -rf .story-ui-cache/`
3. **Remove Scraping Commands**: Remove any `scrape-docs` scripts from package.json
4. **Start Using**: Documentation now works automatically!

## Technical Details

### What Was Removed
- `cli/scrape-docs.ts` - Scraping command
- `story-generator/scrapers/` - Web scraping implementations
- `story-generator/documentationIntegration.ts` - Scraping infrastructure
- Playwright dependency

### What Was Added
- `story-generator/context7Integration.ts` - Context7 MCP client
- Automatic Context7 documentation fetching
- Fallback to bundled documentation

### API Changes
No API changes - Story UI works exactly the same from a user perspective, just better!

## FAQ

**Q: Do I need a Context7 API key?**
A: No, Context7 is freely available for documentation access.

**Q: What if my library isn't supported by Context7?**
A: Story UI will fall back to bundled documentation or use component discovery from your codebase.

**Q: Can I still use local documentation?**
A: Yes, you can provide custom documentation through the configuration if needed.

**Q: Will my existing stories still work?**
A: Yes, all existing generated stories remain compatible.

## Future Enhancements

- Support for private component libraries via Context7
- Custom documentation providers
- Enhanced pattern recognition
- More design system integrations
