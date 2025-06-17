import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';

// Cache discovered components for performance
let cachedComponents: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

export async function getComponents(req: Request, res: Response) {
  try {
    const now = Date.now();

    // Return cached components if still valid
    if (cachedComponents && (now - cacheTimestamp) < CACHE_TTL) {
      return res.json(cachedComponents);
    }

    // Load fresh configuration
    const config = loadUserConfig();

    // Use enhanced discovery
    const discovery = new EnhancedComponentDiscovery(config);
    const components = await discovery.discoverAll();

    // Transform to API format
    const apiComponents = components.map(comp => ({
      name: comp.name,
      description: comp.description,
      category: comp.category,
      props: comp.props,
      slots: comp.slots
    }));

    // Cache the results
    cachedComponents = apiComponents;
    cacheTimestamp = now;

    res.json(apiComponents);
  } catch (error) {
    console.error('Error discovering components:', error);
    res.json([]);
  }
}

export async function getProps(req: Request, res: Response) {
  try {
    const { component } = req.query;

    if (!component || typeof component !== 'string') {
      return res.json([]);
    }

    const now = Date.now();

    // Ensure we have fresh component data
    if (!cachedComponents || (now - cacheTimestamp) >= CACHE_TTL) {
      const config = loadUserConfig();
      const discovery = new EnhancedComponentDiscovery(config);
      const components = await discovery.discoverAll();

      cachedComponents = components.map(comp => ({
        name: comp.name,
        description: comp.description,
        category: comp.category,
        props: comp.props,
        slots: comp.slots
      }));
      cacheTimestamp = now;
    }

    // Find the requested component
    const comp = cachedComponents.find(c => c.name === component);

    if (!comp) {
      return res.json([]);
    }

    // Return props in a format compatible with existing UI
    const props = comp.props.map((prop: string) => ({
      name: prop,
      type: 'string', // We'd need more sophisticated type detection
      description: `${prop} property`,
      required: false
    }));

    res.json(props);
  } catch (error) {
    console.error('Error getting component props:', error);
    res.json([]);
  }
}
