# Storybook Branding Setup

This document explains how to set up custom branding for your test storybook instances so you can easily distinguish between different design systems.

## Overview

The branding setup automatically creates `manager.ts` files in each test storybook instance's `.storybook` directory. This replaces the default "Storybook" logo/text with the design system name, making it much easier to identify which environment you're working in.

All themes are configured to use **dark mode** by default, providing a professional and modern appearance.

## Quick Start

### Setup Branding for All Instances

```bash
npm run setup:branding
```

This will:
- Scan all directories in `test-storybooks/`
- Auto-detect the design system based on directory name and package.json
- Create appropriately branded `manager.ts` files
- Use names from `multi-instance.config.json` if available

### Setup Branding for a Specific Instance

```bash
npm run setup:branding test-storybooks/adobe-spectrum
```

### Setup Branding with Custom Name

```bash
npm run setup:branding test-storybooks/my-design-system "My Custom Design System"
```

## What It Does

For each test storybook instance, the script:

1. **Detects the design system** from:
   - Directory name (e.g., `adobe-spectrum`, `material-ui`)
   - Package dependencies in `package.json`
   - Multi-instance configuration names

2. **Creates a branded `manager.ts` file** with:
   - Custom title (replaces "Storybook" logo)
   - Design system appropriate colors
   - Proper typography
   - Link to design system documentation

3. **Applies consistent styling** that matches each design system's brand

## Supported Design Systems

The script includes pre-configured branding for:

- **Adobe Spectrum** - Dark theme with Adobe blue branding
- **Material-UI** - Dark theme with Material Design colors
- **Ant Design** - Dark theme with Ant Design colors
- **Mantine** - Dark theme with Mantine colors
- **Chakra UI** - Dark theme with Chakra UI colors
- **GitHub Primer** - Dark theme with GitHub blue
- **Fluent UI** - Dark theme with Microsoft blue
- **IBM Carbon** - Dark theme with IBM blue
- **Shopify Polaris** - Dark theme with Shopify green
- **Default** - Generic dark theme branding

## Example Result

After running the setup, when you start a storybook instance:

**Before:**
```
Top-left corner shows: "Storybook"
```

**After:**
```
Top-left corner shows: "Adobe Spectrum" (or your design system name)
```

## Integration with Multi-Instance Config

If you have a `multi-instance.config.json` file, the script will:
- Use the `name` field from your instance configuration
- Apply that name as the brand title
- Fall back to auto-detection if no name is specified

Example config:
```json
{
  "instances": [
    {
      "name": "Adobe Spectrum Testing",
      "directory": "test-storybooks/adobe-spectrum",
      "mcpPort": 4001,
      "storybookPort": 6006,
      "enabled": true
    }
  ]
}
```

## Manual Customization

After running the setup, you can manually customize the branding by editing the generated `manager.ts` file:

```typescript
// test-storybooks/your-design-system/.storybook/manager.ts
import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

const theme = create({
  base: 'light',
  brandTitle: 'Your Custom Name',
  brandUrl: 'https://your-docs-url.com',
  colorPrimary: '#your-primary-color',
  colorSecondary: '#your-secondary-color',
  // ... other customizations
});

addons.setConfig({
  theme,
});
```

## Troubleshooting

### Branding Not Appearing

1. **Restart Storybook** - The branding only applies when Storybook starts
2. **Clear browser cache** - Old styles might be cached
3. **Check file exists** - Ensure `manager.ts` was created in `.storybook/` directory

### Design System Not Detected

The script tries to detect design systems by:
1. Directory name patterns (e.g., `adobe-spectrum`, `material-ui`)
2. Package.json dependencies
3. Multi-instance config names

If detection fails, you can manually specify the name:
```bash
npm run setup:branding test-storybooks/my-custom-system "My Custom System"
```

### Colors Don't Match

You can customize the colors by editing the generated `manager.ts` file or by adding a new configuration to the script in `DESIGN_SYSTEM_CONFIGS`.

## Advanced Usage

### Adding New Design System Configs

Edit `scripts/setup-storybook-branding.js` and add your config to `DESIGN_SYSTEM_CONFIGS`:

```javascript
const DESIGN_SYSTEM_CONFIGS = {
  'my-design-system': {
    name: 'My Design System',
    url: 'https://my-design-system.com',
    primaryColor: '#007acc',
    secondaryColor: '#666666',
    fontBase: '"My Font", sans-serif',
    appBg: '#ffffff',
    barBg: '#ffffff',
  },
  // ... other configs
};
```

### Batch Processing

The script automatically processes all directories in `test-storybooks/`. You can also run it as part of your setup workflow:

```bash
npm run setup:branding  # Setup branding for all instances
npm run multi-instance  # Start all instances with branding
```

## Next Steps

After setting up branding:

1. **Restart your Storybook instances** to see the new branding
2. **Test each instance** to ensure the branding appears correctly
3. **Customize as needed** by editing the generated `manager.ts` files
4. **Add to your workflow** by running the script whenever you add new test instances

The branding will make it much easier to distinguish between different design system environments when working with multiple instances simultaneously!
