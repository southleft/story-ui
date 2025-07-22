module.exports = {
  "generatedStoriesPath": "./src/stories/generated",
  "importPath": "@tpitre/story-ui",
  "componentPrefix": "",
  "layoutRules": {
    "multiColumnWrapper": "div",
    "columnComponent": "div",
    "containerComponent": "div",
    "layoutExamples": {
      "twoColumn": "<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>\n  <div>Column 1 content</div>\n  <div>Column 2 content</div>\n</div>"
    },
    "prohibitedElements": []
  },
  "storybookFramework": "@storybook/react-vite",
  "componentsPath": "./templates/StoryUI",
  "storyPrefix": "Generated/",
  "defaultAuthor": "Story UI AI"
};
