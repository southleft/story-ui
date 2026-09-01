/**
 * Components the model may not import: anything the catalog did not discover.
 *
 * This file used to hold a list of names and a set of regexes — anything
 * ending in Card, Header, Container, Layout or Wrapper, anything starting with
 * Styled or Custom — that labelled an UNDISCOVERED name "blacklisted" as if it
 * were a known offender,
 * and then suggested Polaris and Primer components (`Box`, `Pagehead`,
 * `PageLayout`) to every design system. The regexes were also wrong on their
 * own terms: a real `ProductCard`, `PageHeader` or `StyledLink` in a project's
 * catalog was only spared by the catalog check that ran first.
 *
 * There is exactly one fact available: is the name in the catalog? A name that
 * is not is an unknown component, and the only honest help is the nearest
 * names the catalog actually contains.
 */

import { isDeprecatedComponent, getComponentReplacement } from './documentation-sources.js';
import { nearestNames } from './nameSimilarity.js';

/**
 * True when the model must not import `componentName`: it is deprecated per
 * the design system's own documentation, or it is not in the catalog at all.
 * With an empty catalog nothing can be judged, so nothing is rejected.
 */
export function isBlacklistedComponent(componentName: string, validComponents: Set<string>, importPath?: string): boolean {
  if (importPath && isDeprecatedComponent(importPath, componentName)) {
    return true;
  }
  if (validComponents.size === 0) return false;
  return !validComponents.has(componentName);
}

/**
 * Common icon name mistakes - maps incorrect names to correct ones
 */
export const ICON_CORRECTIONS: Record<string, string> = {
  'CommitIcon': 'GitCommitIcon',
  'BranchIcon': 'GitBranchIcon',
  'MergeIcon': 'GitMergeIcon',
  'PullRequestIcon': 'GitPullRequestIcon',
  'RepoForkedIcon': 'RepoForkedIcon',
  'IssueIcon': 'IssueOpenedIcon',
  'PullIcon': 'GitPullRequestIcon',
  'ForkIcon': 'RepoForkedIcon',
  'CloseIcon': 'XIcon',
  'CheckmarkIcon': 'CheckIcon',
  // Ant Design icon corrections
  'ExclamationTriangleOutlined': 'ExclamationCircleOutlined',
  'WarningTriangleOutlined': 'WarningOutlined',
  'ErrorCircleOutlined': 'CloseCircleOutlined',
  'CrossIcon': 'XIcon',
  'EditIcon': 'PencilIcon',
  'DeleteIcon': 'TrashIcon',
  'SettingsIcon': 'GearIcon',
  'UserIcon': 'PersonIcon',
  'EmailIcon': 'MailIcon',
  'TimeIcon': 'ClockIcon',
  'CodeReviewIcon': 'CodeIcon',
  'CommentDiscussionIcon': 'CommentIcon',
};

export function isBlacklistedIcon(iconName: string, allowedIcons: Set<string>): boolean {
  // First check if it's in the allowed list - if so, it's not blacklisted
  if (allowedIcons.has(iconName)) {
    return false;
  }

  // Check if it's a known incorrect name
  if (ICON_CORRECTIONS[iconName]) {
    return true;
  }

  // Check if it follows incorrect patterns
  const incorrectPatterns = [
    // Icons that are missing the 'Git' prefix
    /^(Commit|Branch|Merge|PullRequest)Icon$/,
    // Icons with wrong suffixes
    /Icon[0-9]+$/,
    // Made up icon names
    /^Custom.*Icon$/,
    /^.*IconStyle$/,
  ];

  return incorrectPatterns.some(pattern => pattern.test(iconName));
}

/**
 * Partition imports into catalog members and unknowns, with the nearest
 * catalog names for each unknown. Suggestions come from `allowedComponents`
 * and nowhere else.
 */
export function validateImports(imports: string[], allowedComponents: Set<string>): {
  valid: string[];
  invalid: string[];
  suggestions: Map<string, string[]>;
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const suggestions = new Map<string, string[]>();

  for (const importName of imports) {
    if (allowedComponents.has(importName)) {
      valid.push(importName);
      continue;
    }
    invalid.push(importName);
    const near = nearestNames(importName, allowedComponents, 3);
    if (near.length > 0) suggestions.set(importName, near);
  }

  return { valid, invalid, suggestions };
}

/**
 * Why an import was rejected, in words the model can act on.
 *
 * Pass the catalog to get the nearest real names; without it the message
 * states only the fact, that the name is not in the catalog.
 */
export function getBlacklistErrorMessage(componentName: string, importPath?: string, validComponents?: Iterable<string>): string {
  if (importPath) {
    const replacement = getComponentReplacement(importPath, componentName);
    if (replacement) {
      return `"${componentName}" is deprecated. Use ${replacement} instead.`;
    }
  }

  const near = validComponents ? nearestNames(componentName, validComponents, 3) : [];
  const hint = near.length > 0
    ? ` Nearest catalog names: ${near.join(', ')}.`
    : ' Use only components listed in the catalog.';
  return `"${componentName}" is an unknown component (not in the catalog).${hint}`;
}
