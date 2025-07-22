import fs from 'fs';
import path from 'path';
import { StoryUIConfig } from '../story-ui.config.js';

function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
