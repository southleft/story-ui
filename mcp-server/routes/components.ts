import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadUserConfig } from '../../story-generator/configLoader.js';
import { EnhancedComponentDiscovery } from '../../story-generator/enhancedComponentDiscovery.js';
import { PropInfo } from '../../story-generator/componentDiscovery.js';
import { saysMoreThanName } from '../../story-generator/knowledge/descriptionQuality.js';
import { enrichWithSourceFacts } from '../../story-generator/knowledge/sourceFacts.js';

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

/**
 * The discovery objects behind `cachedComponents`, kept whole.
 *
 * The API shape above drops `filePath`, `__componentPath` and `source`, and
 * the inventory needs exactly those to say where a component comes from. Same
 * TTL, refreshed by the same load, so the two views never disagree.
 */
let cachedRaw: InventorySource[] | null = null;

/** The fields the inventory reads off a discovered component. */
export interface InventorySource {
  name: string;
  description?: string;
  category?: string;
  props?: string[];
  propTypes?: PropInfo[];
  filePath?: string;
  __componentPath?: string;
  source?: { type?: string; path?: string };
}

export interface InventoryRow {
  name: string;
  importPath: string;
  category: string;
  propCount: number;
  hasDescription: boolean;
  description: string;
  source: 'npm' | 'local';
}

export interface ComponentInventory {
  importPath: string;
  components: InventoryRow[];
}

/**
 * Where a component comes from, read off what discovery recorded.
 *
 * Discovery's own `source.type` is authoritative when it is one of the two
 * answers. Otherwise the file path decides: a path on disk outside
 * node_modules is local source; a relative specifier in `__componentPath` is
 * a local import; anything else is a package.
 */
export function inventorySourceOf(c: InventorySource): 'npm' | 'local' {
  const declared = c.source?.type;
  if (declared === 'npm') return 'npm';
  if (declared === 'local' || declared === 'typescript') return 'local';
  const file = c.filePath || '';
  if (file && !/(^|[\\/])node_modules([\\/]|$)/.test(file)) return 'local';
  const spec = c.__componentPath || '';
  if (spec.startsWith('.') || spec.startsWith('/')) return 'local';
  return 'npm';
}

/**
 * Shape discovery output into the inventory the workspace drawer lists.
 *
 * Pure, so it is unit-tested without Express or a project on disk. Sorted by
 * name: the drawer has a search box, and a stable order beats discovery's.
 */
export function shapeInventory(components: InventorySource[], defaultImportPath: string): ComponentInventory {
  const rows: InventoryRow[] = components
    .filter(c => c && typeof c.name === 'string' && c.name)
    .map(c => {
      const description = typeof c.description === 'string' ? c.description.trim() : '';
      const propCount = Array.isArray(c.propTypes) && c.propTypes.length > 0
        ? c.propTypes.length
        : Array.isArray(c.props) ? c.props.length : 0;
      return {
        name: c.name,
        importPath: c.__componentPath || defaultImportPath,
        category: typeof c.category === 'string' && c.category ? c.category : 'other',
        propCount,
        hasDescription: saysMoreThanName(c.name, description),
        description,
        source: inventorySourceOf(c),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { importPath: defaultImportPath, components: rows };
}

/**
 * Discover (or reuse the cached result) and refresh both caches together.
 */
async function loadDiscovered(): Promise<{ raw: InventorySource[]; api: CachedComponent[]; importPath: string }> {
  const config = loadUserConfig();
  const now = Date.now();
  if (cachedComponents && cachedRaw && (now - cacheTimestamp) < CACHE_TTL) {
    return { raw: cachedRaw, api: cachedComponents, importPath: config.importPath || '' };
  }
  const discovery = new EnhancedComponentDiscovery(config);
  const components = await discovery.discoverAll();
  // The same source facts the generation path applies right after discovery
  // (generationCore → enrichWithSourceFacts): a local component's own JSDoc,
  // interface and variant map. Without this the inventory reported every
  // local component as undescribed while the model was being told otherwise —
  // two views of one catalog that disagreed.
  try {
    enrichWithSourceFacts(components as any[]);
  } catch (error) {
    console.warn('Could not read local source facts for the inventory:', error);
  }
  cachedRaw = components as unknown as InventorySource[];
  cachedComponents = components.map(comp => ({
    name: comp.name,
    description: comp.description,
    category: comp.category,
    // Bare names: enrichment renders a local component's props as catalog
    // lines (`variant? [a|b] ='a'`) for the model; this route's contract to
    // the panel is the name, with the rich form in `propTypes`.
    props: (comp.props || []).map(p => String(p).replace(/[?:( ].*$/, '')),
    propTypes: comp.propTypes,
    slots: comp.slots
  }));
  cacheTimestamp = now;
  return { raw: cachedRaw, api: cachedComponents, importPath: config.importPath || '' };
}

/**
 * GET /mcp/components/inventory — what the server discovered, for people.
 *
 * The existing /mcp/components answer is for the model and the panel's
 * autocomplete; it carries every prop type and no provenance. This is the
 * list a first-time user opens to learn what "your design system" means
 * here: name, where it comes from, how much we know about it. No LLM, same
 * cache.
 */
export async function getComponentInventory(_req: Request, res: Response) {
  try {
    const { raw, importPath } = await loadDiscovered();
    res.json(shapeInventory(raw, importPath));
  } catch (error) {
    console.error('Error building component inventory:', error);
    res.status(500).json({ error: 'Component discovery failed', importPath: '', components: [] });
  }
}

export async function getComponents(req: Request, res: Response) {
  try {
    const { api } = await loadDiscovered();
    res.json(api);
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

    // Ensure we have fresh component data
    const { api } = await loadDiscovered();

    // Find the requested component
    const comp = api.find(c => c.name === component);

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
