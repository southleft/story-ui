export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation only changes
        'style',    // Changes that do not affect the meaning of the code
        'refactor', // Code change that neither fixes a bug nor adds a feature
        'perf',     // Code change that improves performance
        'test',     // Adding missing tests or correcting existing tests
        'chore',    // Changes to the build process or auxiliary tools
        'revert',   // Reverts a previous commit
        'ci',       // Changes to CI configuration files and scripts
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'cli',
        'mcp',
        'ui',
        'generator',
        'config',
        'ci',
        'deps',
        'docs',
        'release',  // For semantic-release commits
      ],
    ],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0, 'always', 100],  // Disable for semantic-release changelog
    'footer-max-line-length': [0, 'always', 100], // Disable for semantic-release changelog
  },
};
