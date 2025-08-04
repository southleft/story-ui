/**
 * Blacklist of component names that AI commonly mistakes for real components
 * These are often story export names or made-up components that don't exist
 */

import { isDeprecatedComponent, getComponentReplacement } from './documentation-sources.js';

export const BLACKLISTED_COMPONENTS = [
  // Story UI interface components (not design system components)
  'StoryUIPanel',

  // Common mistaken imports
  'GitHubStyleRepoCard',
  'GitHubHeader',
  'CustomCard',
  'StyledCard',
  'LayoutWrapper',
  'ContentWrapper',
  'StoryCard',
  'UICard',
  'ComponentCard',

  // Patterns that indicate story exports
  /^.*Story$/,
  /^.*Example$/,
  /^.*Demo$/,
  /^Custom.*/,
  /^Styled.*/,
  /^.*Layout$/,
  /^.*Wrapper$/,
  /^.*Container$/,
  /^GitHub.*/,
  /^.*Header$/, // Except for 'Header' itself
  /^.*Card$/, // Except for specific known card components
];

// Generic deprecated components (can be extended per design system)
const DEPRECATED_COMPONENTS: Record<string, string[]> = {
  // Add deprecated components for supported design systems as needed
};

export function isBlacklistedComponent(componentName: string, validComponents: Set<string>, importPath?: string): boolean {
  // Check if it's a known deprecated component from documentation
  if (importPath && isDeprecatedComponent(importPath, componentName)) {
    return true;
  }

  // Check for deprecated components for specific design systems
  if (importPath) {
    for (const [systemPath, deprecatedList] of Object.entries(DEPRECATED_COMPONENTS)) {
      if (importPath.includes(systemPath) && deprecatedList.includes(componentName)) {
        return true;
      }
    }
  }

  // First check if it's in the allowed list - if so, it's not blacklisted
  if (validComponents.has(componentName)) {
    return false;
  }

  // Check exact matches
  if (BLACKLISTED_COMPONENTS.includes(componentName)) {
    return true;
  }

  // Check regex patterns
  for (const pattern of BLACKLISTED_COMPONENTS) {
    if (pattern instanceof RegExp && pattern.test(componentName)) {
      // Special cases - these are allowed even if they match patterns
      if (componentName === 'Header' || componentName === 'Card') {
        return false;
      }
      return true;
    }
  }

  return false;
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

export function validateImports(imports: string[], allowedComponents: Set<string>): {
  valid: string[];
  invalid: string[];
  suggestions: Map<string, string[]>;
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const suggestions = new Map<string, string[]>();

  for (const importName of imports) {
    if (isBlacklistedComponent(importName, allowedComponents)) {
      invalid.push(importName);

      // Suggest alternatives
      const suggested = suggestAlternatives(importName, allowedComponents);
      if (suggested.length > 0) {
        suggestions.set(importName, suggested);
      }
    } else if (!allowedComponents.has(importName)) {
      invalid.push(importName);
    } else {
      valid.push(importName);
    }
  }

  return { valid, invalid, suggestions };
}

function suggestAlternatives(invalidComponent: string, allowedComponents: Set<string>): string[] {
  const suggestions: string[] = [];

  // Specific mappings for common mistakes
  const mappings: Record<string, string[]> = {
    'StoryUIPanel': ['Box', 'Card', 'Stack'],
    'GitHubStyleRepoCard': ['Box', 'Card'],
    'GitHubHeader': ['Header'],
    'CustomCard': ['Box', 'Card'],
    'StyledCard': ['Box', 'Card'],
    'LayoutWrapper': ['Box', 'Stack', 'PageLayout'],
    'ContentWrapper': ['Box', 'Stack'],
  };

  if (mappings[invalidComponent]) {
    return mappings[invalidComponent].filter(comp => allowedComponents.has(comp));
  }

  // Generic suggestions based on patterns
  if (invalidComponent.includes('Card')) {
    suggestions.push('Box', 'Card');
  }
  if (invalidComponent.includes('Header')) {
    suggestions.push('Header', 'Pagehead');
  }
  if (invalidComponent.includes('Layout') || invalidComponent.includes('Wrapper')) {
    suggestions.push('Box', 'Stack', 'PageLayout');
  }

  return suggestions.filter(comp => allowedComponents.has(comp));
}

/**
 * Get helpful error message for blacklisted component
 */
export function getBlacklistErrorMessage(componentName: string, importPath?: string): string {
  if (importPath) {
    const replacement = getComponentReplacement(importPath, componentName);
    if (replacement) {
      return `"${componentName}" is deprecated. Use ${replacement} instead.`;
    }
  }

  // Existing error messages
  if (componentName.endsWith('Icon') && !componentName.includes('Icon')) {
    return `"${componentName}" looks like an icon but may not exist. Check the available icons list.`;
  }

  if (BLACKLISTED_COMPONENTS.some(pattern => pattern instanceof RegExp && pattern.test(componentName))) {
    return `"${componentName}" appears to be invalid. Use standard component names.`;
  }

  return `"${componentName}" is not a valid component.`;
}
