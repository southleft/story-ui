import pg from 'pg';
import type { IStoryService, GeneratedStory, StoryMetadata, StorageStats } from './storyServiceInterface.js';

const { Pool } = pg;

/**
 * PostgreSQL Story Service
 * Persistent story storage using PostgreSQL database
 * Designed for Railway PostgreSQL deployments
 */
export class PostgresStoryService implements IStoryService {
  private pool: pg.Pool;
  private initialized: boolean = false;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS stories (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          content TEXT NOT NULL,
          prompt TEXT,
          components TEXT[],
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_stories_last_accessed ON stories(last_accessed DESC);
      `);

      this.initialized = true;
      console.log('✅ PostgreSQL story service initialized');
    } finally {
      client.release();
    }
  }

  /**
   * Store a generated story
   */
  async storeStory(story: GeneratedStory): Promise<void> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO stories (id, title, description, content, prompt, components, created_at, last_accessed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           content = EXCLUDED.content,
           prompt = EXCLUDED.prompt,
           components = EXCLUDED.components,
           last_accessed = EXCLUDED.last_accessed`,
        [
          story.id,
          story.title,
          story.description,
          story.content,
          story.prompt || null,
          story.components || [],
          story.createdAt || new Date(),
          new Date()
        ]
      );
      console.log(`✅ Stored story in PostgreSQL: ${story.id}`);
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve a story by ID
   */
  async getStory(id: string): Promise<GeneratedStory | null> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      // Update last_accessed and return the story
      const result = await client.query(
        `UPDATE stories SET last_accessed = NOW()
         WHERE id = $1
         RETURNING id, title, description, content, prompt, components, created_at, last_accessed`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        content: row.content,
        prompt: row.prompt,
        components: row.components || [],
        createdAt: new Date(row.created_at),
        lastAccessed: new Date(row.last_accessed)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all stored stories
   */
  async getAllStories(): Promise<GeneratedStory[]> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, title, description, content, prompt, components, created_at, last_accessed
         FROM stories
         ORDER BY created_at DESC`
      );

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        content: row.content,
        prompt: row.prompt,
        components: row.components || [],
        createdAt: new Date(row.created_at),
        lastAccessed: new Date(row.last_accessed)
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Delete a story by ID
   */
  async deleteStory(id: string): Promise<boolean> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM stories WHERE id = $1 RETURNING id`,
        [id]
      );
      const deleted = result.rowCount !== null && result.rowCount > 0;
      if (deleted) {
        console.log(`✅ Deleted story from PostgreSQL: ${id}`);
      }
      return deleted;
    } finally {
      client.release();
    }
  }

  /**
   * Clear all stories
   */
  async clearAllStories(): Promise<void> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      await client.query('TRUNCATE TABLE stories');
      console.log('✅ Cleared all stories from PostgreSQL');
    } finally {
      client.release();
    }
  }

  /**
   * Get story content for Storybook integration
   */
  async getStoryContent(id: string): Promise<string | null> {
    const story = await this.getStory(id);
    return story ? story.content : null;
  }

  /**
   * Get story metadata for listing
   */
  async getStoryMetadata(): Promise<StoryMetadata[]> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, title, description, content, created_at, last_accessed
         FROM stories
         ORDER BY created_at DESC`
      );

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        createdAt: new Date(row.created_at),
        lastAccessed: new Date(row.last_accessed),
        componentCount: this.countComponents(row.content)
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get storage usage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT
          COUNT(*)::int as story_count,
          COALESCE(SUM(LENGTH(content)), 0)::bigint as total_size,
          COALESCE(AVG(LENGTH(content)), 0)::int as avg_size,
          MIN(created_at) as oldest,
          MAX(created_at) as newest
        FROM stories
      `);

      const row = result.rows[0];
      return {
        storyCount: row.story_count,
        totalSizeBytes: parseInt(row.total_size) || 0,
        averageSizeBytes: row.avg_size || 0,
        oldestStory: row.oldest ? new Date(row.oldest) : null,
        newestStory: row.newest ? new Date(row.newest) : null
      };
    } finally {
      client.release();
    }
  }

  /**
   * Count unique components in story content
   */
  private countComponents(content: string): number {
    const componentMatches = content.match(/<[A-Z][A-Za-z0-9]*\s/g);
    return componentMatches ? new Set(componentMatches).size : 0;
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('PostgreSQL connection pool closed');
  }
}
