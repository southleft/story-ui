// Story UI Redirect Addon for Storybook
// Add this script to your .storybook/preview-head.html file:
// <script src="path/to/storybook-redirect-addon.js"></script>

(function() {
  // Configuration
  const STORY_UI_PORT = window.STORY_UI_PORT || '4001';
  const STORY_UI_URL = `http://localhost:${STORY_UI_PORT}`;
  const CHECK_INTERVAL = 100; // ms
  const NOTIFICATION_DURATION = 1500; // ms
  
  console.log('[Story UI Redirect] Initializing redirect handler...');
  
  // Load redirect mappings from Story UI server
  function loadRedirects() {
    const script = document.createElement('script');
    script.src = `${STORY_UI_URL}/story-ui/redirects.js`;
    
    script.onload = function() {
      console.log('[Story UI Redirect] Redirect mappings loaded successfully');
    };
    
    script.onerror = function() {
      console.warn('[Story UI Redirect] Could not load redirect mappings. Story UI server may not be running on port', STORY_UI_PORT);
      console.warn('[Story UI Redirect] To use a different port, set window.STORY_UI_PORT before loading this script');
    };
    
    document.head.appendChild(script);
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRedirects);
  } else {
    loadRedirects();
  }
})();