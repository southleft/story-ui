import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check if the current working directory is the Story UI package itself.
 * This prevents accidentally generating stories in the package source code.
 */
function isStoryUIPackageDirectory(): boolean {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      // Check if this is the story-ui package by name
      if (packageJson.name === '@tpitre/story-ui') {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function generateStory({
  fileContents,
  fileName,
  config
}: {
  fileContents: string;
  fileName: string;
  config: StoryUIConfig;
}) {
  // SAFEGUARD: Prevent generating stories in the Story UI package directory
  if (isStoryUIPackageDirectory()) {
    throw new Error(
      'Cannot generate stories in the Story UI package directory. ' +
      'Please run story-ui from a project that uses Story UI, not from the story-ui package itself.'
    );
  }

  const outPath = path.join(config.generatedStoriesPath, fileName);

  // Ensure the directory exists
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outPath, fileContents, 'utf-8');
  return outPath;
}

// Mock usage:
// generateStory({
//   title: 'Login Form',
//   jsx: '<al-input label="Email"></al-input>\n<al-input label="Password" type="password"></al-input>\n<al-button>Login</al-button>'
// });
