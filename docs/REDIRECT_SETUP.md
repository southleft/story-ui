# Story UI Redirect Setup Guide

When Story UI updates a story and the title changes, it automatically tracks URL redirects to prevent 404 errors in Storybook.

## How It Works

1. **Automatic Tracking**: When you update a story using Story UI, if the title changes, the old URL and new URL are automatically tracked.

2. **Redirect Service**: Story UI maintains a redirect mapping file at `.story-ui/redirects.json` that stores all URL changes.

3. **Browser Integration**: A JavaScript redirect handler can be added to your Storybook to automatically redirect old URLs to new ones.

## Setup Instructions

### Option 1: Automatic Port Detection (Recommended)

1. Create or edit `.storybook/preview-head.html` in your Storybook directory:

```html
<!-- Story UI Redirect Handler with Auto Port Detection -->
<script src="https://unpkg.com/@tpitre/story-ui/story-generator/storybook-redirect-addon-auto.js"></script>
```

This script will automatically:
- Detect which port Story UI is running on
- Load the redirect mappings
- Handle URL redirects

### Option 2: Manual Port Configuration

If auto-detection doesn't work or you prefer explicit configuration:

```html
<!-- Story UI Redirect Handler -->
<script>
  // Set your Story UI server port explicitly
  window.STORY_UI_PORT = '4001'; // Change this to your port
  
  // Load redirect handler
  (function() {
    const script = document.createElement('script');
    script.src = `http://localhost:${window.STORY_UI_PORT}/story-ui/redirects.js`;
    script.onerror = function() {
      console.warn('[Story UI] Redirect service not available');
    };
    document.head.appendChild(script);
  })();
</script>
```

2. Restart your Storybook server.

### Option 2: Add to Storybook Manager Head

If you want the redirects to work in the Storybook manager UI as well:

1. Create or edit `.storybook/manager-head.html`:

```html
<script>
  window.STORY_UI_PORT = '4001';
</script>
<script src="http://localhost:4001/story-ui/redirects.js"></script>
```

### Option 3: Manual Script Include

Copy the redirect addon script to your project and include it:

```bash
cp node_modules/@tpitre/story-ui/story-generator/storybook-redirect-addon.js .storybook/
```

Then add to `.storybook/preview-head.html`:

```html
<script src="./storybook-redirect-addon.js"></script>
```

## Configuration

### Port Configuration

Story UI determines its port in the following order:
1. Command line: `story-ui start --port 4002`
2. Environment variable: `PORT=4002` or `VITE_STORY_UI_PORT=4002` in `.env`
3. Default: `4001`

The redirect system will:
- Auto-detect the port if using the automatic script
- Use `window.STORY_UI_PORT` if manually set
- Fall back to the default port 4001

### Setting a Custom Port

**In your `.env` file:**
```env
VITE_STORY_UI_PORT=4002
```

**Or via command line:**
```bash
story-ui start --port 4002
```

**For manual configuration in Storybook:**
```html
<script>
  window.STORY_UI_PORT = '4002'; // Your custom port
</script>
```

### Testing Redirects

1. Generate a story using Story UI
2. Note the story URL in Storybook (e.g., `/story/simple-card--primary`)
3. Update the story with a change that modifies the title
4. Try accessing the old URL - you should see a notification and be redirected

## How Redirects Work

When you visit an old story URL:

1. A notification appears: "Story updated: 'Old Title' → 'New Title'"
2. After 1.5 seconds, you're automatically redirected to the new URL
3. The redirect is seamless and preserves any query parameters

## Troubleshooting

### Redirects Not Working

1. **Check Story UI Server**: Ensure Story UI is running (`story-ui start`)
2. **Check Port**: Verify the port matches your Story UI server
3. **Check Console**: Look for `[Story UI Redirect]` messages in browser console
4. **Check Network**: Ensure `http://localhost:4001/story-ui/redirects.js` is accessible

### Manual Redirect Management

Redirect mappings are stored in `.story-ui/redirects.json`. You can manually edit this file if needed:

```json
[
  {
    "oldUrl": "/story/old-title--primary",
    "newUrl": "/story/new-title--primary",
    "oldTitle": "Old Title",
    "newTitle": "New Title",
    "timestamp": "2024-01-20T10:00:00.000Z",
    "storyId": "story-12345678"
  }
]
```

## Benefits

- **No More 404s**: Old story links continue to work after updates
- **Seamless Updates**: Users are automatically redirected to the latest version
- **Clear Communication**: Users see what changed via the notification
- **URL Stability**: Share story URLs without worrying about future updates