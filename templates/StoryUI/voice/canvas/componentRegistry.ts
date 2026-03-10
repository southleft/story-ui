/**
 * Component registry for Voice Canvas.
 *
 * This placeholder is replaced during `npx story-ui init` with a
 * project-specific version that lazily imports your design system.
 *
 * The generated version exports a loadRegistry() async function that
 * uses a literal dynamic import (e.g., import('@mantine/core')) so
 * Vite can resolve it at build time without module-level side effects.
 *
 * Regenerate with: npx story-ui registry
 */

import type React from 'react';

export const registry: Record<string, any> = {};

export async function loadRegistry(): Promise<Record<string, any>> {
  // Placeholder — returns empty registry
  // Generated version will import from your design system
  return registry;
}

/** Provider wrapper for design system context (e.g., MantineProvider) */
export function getCanvasProvider(): React.ComponentType<{ children: React.ReactNode }> | null {
  // Placeholder — no provider needed until registry is generated
  return null;
}

export default registry;
