import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { PropInfo } from '../../story-generator/componentDiscovery.js';

// Cache discovered components for performance (includes propTypes for rich type info)
interface CachedComponent {
  name: string;
  description: string;
  category: string;
  props: string[];
  propTypes?: PropInfo[];
  slots?: string[];
}

let cachedComponents: CachedComponent[] | null = null;
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

    // Transform to API format - include propTypes for rich type info
    const apiComponents: CachedComponent[] = components.map(comp => ({
      name: comp.name,
      description: comp.description,
      category: comp.category,
      props: comp.props,
      propTypes: comp.propTypes,
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
        propTypes: comp.propTypes,
        slots: comp.slots
      }));
      cacheTimestamp = now;
    }

    // Find the requested component
    const comp = cachedComponents.find(c => c.name === component);

    if (!comp) {
      return res.json({});
    }

    // Return props as an object keyed by prop name (for MCP handler compatibility)
    // Use rich propTypes if available, otherwise fall back to simple props
    const propsObject: Record<string, { type: string; description: string; required: boolean; options?: string[] }> = {};
    
    if (comp.propTypes && comp.propTypes.length > 0) {
      // Use rich prop type information
      for (const propType of comp.propTypes) {
        propsObject[propType.name] = {
          type: propType.type || 'string',
          description: propType.description || `${propType.name} property`,
          required: propType.required || false,
          ...(propType.options && propType.options.length > 0 ? { options: propType.options } : {})
        };
      }
    } else {
      // Fall back to simple props with generic metadata
      for (const prop of comp.props) {
        propsObject[prop] = {
          type: 'string',
          description: `${prop} property`,
          required: false
        };
      }
    }

    res.json(propsObject);
  } catch (error) {
    console.error('Error getting component props:', error);
    res.json({});
  }
}
