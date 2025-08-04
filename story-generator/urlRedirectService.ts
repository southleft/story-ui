import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface UrlRedirect {
  oldUrl: string;
  newUrl: string;
  oldTitle: string;
  newTitle: string;
  timestamp: string;
  storyId: string;
}

export class UrlRedirectService {
  private redirectsPath: string;
  private redirects: Map<string, UrlRedirect> = new Map();

  constructor(storageDir: string) {
    this.redirectsPath = path.join(storageDir, '.story-ui', 'redirects.json');
    this.loadRedirects();
  }

  private ensureDirectoryExists() {
    const dir = path.dirname(this.redirectsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadRedirects() {
    try {
      if (fs.existsSync(this.redirectsPath)) {
        const data = fs.readFileSync(this.redirectsPath, 'utf-8');
        const redirectArray: UrlRedirect[] = JSON.parse(data);
        this.redirects = new Map(redirectArray.map(r => [r.oldUrl, r]));
        logger.log(`📍 Loaded ${this.redirects.size} URL redirects`);
      }
    } catch (error) {
      logger.log('⚠️  Failed to load redirects, starting fresh:', error);
      this.redirects = new Map();
    }
  }

  private saveRedirects() {
    try {
      this.ensureDirectoryExists();
      const redirectArray = Array.from(this.redirects.values());
      fs.writeFileSync(this.redirectsPath, JSON.stringify(redirectArray, null, 2));
      logger.log(`💾 Saved ${redirectArray.length} URL redirects`);
    } catch (error) {
      logger.log('❌ Failed to save redirects:', error);
    }
  }

  addRedirect(oldUrl: string, newUrl: string, oldTitle: string, newTitle: string, storyId: string) {
    // Don't create a redirect if URLs are the same
    if (oldUrl === newUrl) {
      return;
    }

    const redirect: UrlRedirect = {
      oldUrl,
      newUrl,
      oldTitle,
      newTitle,
      timestamp: new Date().toISOString(),
      storyId
    };

    this.redirects.set(oldUrl, redirect);
    
    // Also handle redirect chains (if A->B exists and we add B->C, update A->C)
    for (const [url, existingRedirect] of this.redirects.entries()) {
      if (existingRedirect.newUrl === oldUrl) {
        existingRedirect.newUrl = newUrl;
        existingRedirect.newTitle = newTitle;
        logger.log(`🔄 Updated redirect chain: ${url} → ${newUrl}`);
      }
    }

    this.saveRedirects();
    logger.log(`➡️  Added redirect: ${oldUrl} → ${newUrl}`);
  }

  getRedirect(oldUrl: string): UrlRedirect | null {
    return this.redirects.get(oldUrl) || null;
  }

  getAllRedirects(): UrlRedirect[] {
    return Array.from(this.redirects.values());
  }

  // Get a JavaScript snippet that can be injected into Storybook
  getRedirectScript(): string {
    const redirectMap = Object.fromEntries(
      Array.from(this.redirects.entries()).map(([oldUrl, redirect]) => [
        oldUrl,
        { newUrl: redirect.newUrl, message: `Story updated: "${redirect.oldTitle}" → "${redirect.newTitle}"` }
      ])
    );

    return `
// Story UI URL Redirect Handler
(function() {
  const redirects = ${JSON.stringify(redirectMap, null, 2)};
  
  function checkForRedirect() {
    const currentPath = window.location.pathname + window.location.search;
    
    for (const [oldUrl, redirect] of Object.entries(redirects)) {
      if (currentPath.includes(oldUrl)) {
        console.log('[Story UI] Redirecting from', oldUrl, 'to', redirect.newUrl);
        
        // Show a brief notification
        const notification = document.createElement('div');
        notification.style.cssText = \`
          position: fixed;
          top: 20px;
          right: 20px;
          background: #1890ff;
          color: white;
          padding: 12px 20px;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          z-index: 9999;
          font-family: sans-serif;
          font-size: 14px;
        \`;
        notification.textContent = redirect.message;
        document.body.appendChild(notification);
        
        // Redirect after a brief delay
        setTimeout(() => {
          window.location.href = redirect.newUrl;
        }, 1500);
        
        // Remove notification after redirect
        setTimeout(() => notification.remove(), 1400);
        
        return true;
      }
    }
    return false;
  }
  
  // Check on page load
  if (window.location.pathname.includes('/story/')) {
    checkForRedirect();
  }
  
  // Also check when navigation occurs in single-page app
  let lastPath = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      if (window.location.pathname.includes('/story/')) {
        checkForRedirect();
      }
    }
  }, 100);
})();
`;
  }
}