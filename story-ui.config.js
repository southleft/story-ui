module.exports = {
  "importPath": "@mantine/core",
  "componentPrefix": "",
  "layoutRules": {
    "multiColumnWrapper": "SimpleGrid",
    "columnComponent": "div",
    "containerComponent": "Container",
    "layoutExamples": {
      "twoColumn": "<SimpleGrid cols={2} spacing=\"md\">\n  <div>\n    <Card shadow=\"sm\" padding=\"lg\" radius=\"md\" withBorder>\n      <Text fw={500} size=\"lg\" mb=\"xs\">Left Card</Text>\n      <Text size=\"sm\" c=\"dimmed\">\n        Left content goes here\n      </Text>\n    </Card>\n  </div>\n  <div>\n    <Card shadow=\"sm\" padding=\"lg\" radius=\"md\" withBorder>\n      <Text fw={500} size=\"lg\" mb=\"xs\">Right Card</Text>\n      <Text size=\"sm\" c=\"dimmed\">\n        Right content goes here\n      </Text>\n    </Card>\n  </div>\n</SimpleGrid>"
    }
  },
  "designSystemGuidelines": {
    "name": "Mantine",
    "additionalNotes": "Mantine is a React component library with native dark mode support.\n- Import components from \"@mantine/core\" (e.g., import { Button } from \"@mantine/core\")\n- Use props like c=\"dimmed\" for colors, fw={500} for font weight\n- Use SimpleGrid for layouts, Card for containers\n- Text component for text with size and color props\n- Icons from @tabler/icons-react"
  },
  "generatedStoriesPath": "./src/stories/generated",
  "storyPrefix": "Generated/",
  "defaultAuthor": "Story UI AI",
  "componentFramework": "react",
  "storybookFramework": "@storybook/react"
};