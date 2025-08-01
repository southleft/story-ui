import { GeneratedStory } from '../story-generator/inMemoryStoryService.js';

interface SessionStory {
  id: string;
  fileName: string;
  title: string;
  prompt: string;
  timestamp: Date;
  keywords: string[];
}

export class SessionManager {
  private static instance: SessionManager;
  private sessions: Map<string, SessionStory[]> = new Map();
  private currentStoryId: string | null = null;
  
  private constructor() {}
  
  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }
  
  /**
   * Track a newly generated story in the current session
   */
  trackStory(sessionId: string, story: {
    id: string;
    fileName: string;
    title: string;
    prompt: string;
  }) {
    const sessionStories = this.sessions.get(sessionId) || [];
    
    // Extract keywords from prompt and title for smart matching
    const keywords = this.extractKeywords(story.prompt + ' ' + story.title);
    
    const sessionStory: SessionStory = {
      ...story,
      timestamp: new Date(),
      keywords
    };
    
    sessionStories.push(sessionStory);
    this.sessions.set(sessionId, sessionStories);
    this.currentStoryId = story.id;
    
    console.error(`[SessionManager] Tracked story: ${story.title} (${story.id}) for session ${sessionId}`);
  }
  
  /**
   * Get the current story being discussed
   */
  getCurrentStory(sessionId: string): SessionStory | null {
    const stories = this.sessions.get(sessionId) || [];
    if (this.currentStoryId) {
      return stories.find(s => s.id === this.currentStoryId) || null;
    }
    // Return the most recent story if no current story is set
    return stories[stories.length - 1] || null;
  }
  
  /**
   * Find a story by context (keywords in the user's message)
   */
  findStoryByContext(sessionId: string, userMessage: string): SessionStory | null {
    const stories = this.sessions.get(sessionId) || [];
    if (stories.length === 0) return null;
    
    const messageKeywords = this.extractKeywords(userMessage.toLowerCase());
    
    // Score each story based on keyword matches
    const scoredStories = stories.map(story => {
      const score = story.keywords.filter(keyword => 
        messageKeywords.some(msgKeyword => 
          msgKeyword.includes(keyword) || keyword.includes(msgKeyword)
        )
      ).length;
      
      return { story, score };
    });
    
    // Sort by score and recency
    scoredStories.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.story.timestamp.getTime() - a.story.timestamp.getTime();
    });
    
    // Return the best match if it has any keyword matches
    if (scoredStories[0].score > 0) {
      this.currentStoryId = scoredStories[0].story.id;
      console.error(`[SessionManager] Found story by context: ${scoredStories[0].story.title} (score: ${scoredStories[0].score})`);
      return scoredStories[0].story;
    }
    
    return null;
  }
  
  /**
   * Get all stories in the current session
   */
  getSessionStories(sessionId: string): SessionStory[] {
    return this.sessions.get(sessionId) || [];
  }
  
  /**
   * Set the current story being discussed
   */
  setCurrentStory(sessionId: string, storyId: string) {
    const stories = this.sessions.get(sessionId) || [];
    if (stories.some(s => s.id === storyId)) {
      this.currentStoryId = storyId;
      console.error(`[SessionManager] Set current story to: ${storyId}`);
    }
  }
  
  /**
   * Clear session data (for cleanup)
   */
  clearSession(sessionId: string) {
    this.sessions.delete(sessionId);
    if (this.currentStoryId) {
      this.currentStoryId = null;
    }
  }
  
  /**
   * Extract meaningful keywords from text
   */
  private extractKeywords(text: string): string[] {
    // Remove common words and extract meaningful terms
    const commonWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
      'then', 'once', 'create', 'make', 'generate', 'build', 'add', 'update',
      'component', 'story', 'please', 'should', 'would', 'could'
    ]);
    
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word));
    
    // Also extract compound terms (like "toast notification")
    const phrases: string[] = [];
    const importantPhrases = [
      'toast notification', 'banner notification', 'success message',
      'error message', 'warning message', 'info message',
      'dark mode', 'light mode', 'switch', 'toggle', 'button',
      'card', 'alert', 'modal', 'dialog', 'form', 'input',
      'table', 'list', 'grid', 'layout', 'navigation', 'menu'
    ];
    
    const lowerText = text.toLowerCase();
    for (const phrase of importantPhrases) {
      if (lowerText.includes(phrase)) {
        phrases.push(phrase);
      }
    }
    
    return [...new Set([...words, ...phrases])];
  }
}