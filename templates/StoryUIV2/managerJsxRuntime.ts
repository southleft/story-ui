/**
 * `react/jsx-runtime` for Storybook's MANAGER bundle.
 *
 * Storybook builds manager entries with esbuild and maps `react`, `react-dom`
 * and `react-dom/client` to the manager's own React globals — but NOT
 * `react/jsx-runtime`. A module that imports the runtime therefore gets it
 * resolved from the project's node_modules, which can be a different major
 * than the manager's React (React 19's runtime stamps elements with
 * `Symbol.for('react.transitional.element')`; React 18 rejects those as
 * "Objects are not valid as a React child"). Storybook's own addons avoid
 * the problem by compiling to `React.createElement`; this shim does the same
 * for the workspace bundle, so every element is created by whichever React
 * the manager actually runs.
 *
 * Wired in by scripts/bundle-workspace-manager.mjs, which aliases
 * `react/jsx-runtime` and `react/jsx-dev-runtime` to this file.
 */
import React from 'react';

type Props = Record<string, unknown> & { children?: unknown };

function create(type: React.ElementType, props: Props | null, key?: React.Key) {
  const withKey = key === undefined ? props : { ...(props ?? {}), key };
  // createElement keeps `children` from props when no rest arguments are
  // given, which is exactly what the automatic runtime passes.
  return React.createElement(type as any, withKey as any);
}

export const Fragment = React.Fragment;
export const jsx = create;
export const jsxs = create;
export const jsxDEV = (type: React.ElementType, props: Props | null, key?: React.Key) => create(type, props, key);
