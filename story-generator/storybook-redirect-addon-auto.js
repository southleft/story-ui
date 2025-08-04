// Story UI Redirect Addon with Auto Port Detection
// This script automatically detects the Story UI server port

(function() {
  'use strict';
  
  const AUTO_DETECT_TIMEOUT = 5000; // 5 seconds to try auto-detection
  const CHECK_INTERVAL = 100; // ms
  const NOTIFICATION_DURATION = 1500; // ms
  
  // Possible ports to check (in order of preference)
  const POSSIBLE_PORTS = [
    window.STORY_UI_PORT,                    // Explicitly set
    window.VITE_STORY_UI_PORT,              // From Vite env
    '4001',                                 // Default Story UI port
    '4002', '4003', '4004', '4005',        // Common alternatives
    '5001', '5002', '5003', '5004', '5005' // Other common ports
  ].filter(Boolean); // Remove undefined values
  
  console.log('[Story UI Redirect] Initializing redirect handler...');
  
  // Try to detect which port Story UI is running on
  async function detectStoryUIPort() {
    console.log('[Story UI Redirect] Attempting to auto-detect Story UI server port...');
    
    for (const port of POSSIBLE_PORTS) {
      try {
        // Try to fetch a known endpoint
        const response = await fetch(`http://localhost:${port}/story-ui/redirects.js`, {
          method: 'HEAD',
          mode: 'no-cors' // Avoid CORS issues
        });
        
        // If we get here without error, the port is likely correct
        console.log(`[Story UI Redirect] ✅ Found Story UI server on port ${port}`);
        return port;
      } catch (error) {
        // This port didn't work, try the next one
        continue;
      }
    }
    
    // If we get here, we couldn't find Story UI
    console.warn('[Story UI Redirect] ⚠️ Could not auto-detect Story UI server port');
    console.warn('[Story UI Redirect] Tried ports:', POSSIBLE_PORTS.join(', '));
    return null;
  }
  
  // Load redirect mappings from Story UI server
  async function loadRedirects(port) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `http://localhost:${port}/story-ui/redirects.js`;
      
      script.onload = function() {
        console.log('[Story UI Redirect] ✅ Redirect mappings loaded successfully from port', port);
        resolve();
      };
      
      script.onerror = function() {
        console.warn('[Story UI Redirect] ⚠️ Could not load redirect mappings from port', port);
        reject(new Error(`Failed to load from port ${port}`));
      };
      
      document.head.appendChild(script);
    });
  }
  
  // Initialize the redirect system
  async function initialize() {
    try {
      // First try to detect the port
      const detectedPort = await detectStoryUIPort();
      
      if (!detectedPort) {
        console.warn('[Story UI Redirect] Could not detect Story UI server.');
        console.warn('[Story UI Redirect] Make sure Story UI is running: story-ui start');
        console.warn('[Story UI Redirect] You can set window.STORY_UI_PORT manually if needed.');
        return;
      }
      
      // Store the detected port for other scripts
      window.STORY_UI_PORT = detectedPort;
      
      // Now load the redirect mappings
      await loadRedirects(detectedPort);
      
      console.log('[Story UI Redirect] Ready! Monitoring for URL changes...');
    } catch (error) {
      console.error('[Story UI Redirect] Initialization failed:', error);
    }
  }
  
  // Wait for DOM to be ready before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    // Small delay to ensure Storybook is ready
    setTimeout(initialize, 500);
  }
})();