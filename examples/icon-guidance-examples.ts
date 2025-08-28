/**
 * Examples demonstrating the Smart Icon Guidance System
 * 
 * Run this with: npx ts-node examples/icon-guidance-examples.ts
 */

import { IconGuidanceSystem } from '../story-generator/iconGuidanceSystem.js';

console.log('🎯 Smart Icon Guidance System Examples\n');

const system = new IconGuidanceSystem();

// Example 1: Professional Dashboard
console.log('=== Example 1: Professional Dashboard ===');
const dashboardPrompt = system.generateGuidancePrompt(
  'dashboard',
  'user analytics dashboard', 
  'create a business dashboard with user metrics and charts',
  ['@tabler/icons-react']
);
console.log(dashboardPrompt);

console.log('\n' + '='.repeat(60) + '\n');

// Example 2: Recipe Card  
console.log('=== Example 2: Food Recipe Card ===');
const recipePrompt = system.generateGuidancePrompt(
  'recipe card',
  'food recipe display',
  'create a pizza recipe card with cooking time and ingredients',
  ['@tabler/icons-react']
);
console.log(recipePrompt);

console.log('\n' + '='.repeat(60) + '\n');

// Example 3: Navigation Component
console.log('=== Example 3: Navigation Menu ==='); 
const navPrompt = system.generateGuidancePrompt(
  'navigation menu',
  'main site navigation',
  'create a responsive navigation menu with user profile',
  ['@tabler/icons-react']
);
console.log(navPrompt);

console.log('\n' + '='.repeat(60) + '\n');

// Example 4: Ambiguous Context
console.log('=== Example 4: Ambiguous Context ===');
const ambiguousPrompt = system.generateGuidancePrompt(
  'card',
  'generic card component',
  'create a card component',
  ['@tabler/icons-react']
);
console.log(ambiguousPrompt);

console.log('\n' + '='.repeat(60) + '\n');

// Example 5: Social Media Component
console.log('=== Example 5: Social Media Post ===');
const socialPrompt = system.generateGuidancePrompt(
  'social post',
  'social media interaction',
  'create a social media post with likes and comments',
  ['@tabler/icons-react']
);
console.log(socialPrompt);

console.log('\n✨ Icon Guidance System Demo Complete!');

// Quick analysis summary
console.log('\n📊 Analysis Summary:');
const examples = [
  { name: 'Dashboard', prompt: 'create a business dashboard', expected: 'icons' },
  { name: 'Recipe Card', prompt: 'create a pizza recipe', expected: 'emojis' },
  { name: 'Navigation', prompt: 'create a navigation menu', expected: 'icons' },
  { name: 'Social Post', prompt: 'create a social media post', expected: 'emojis' },
  { name: 'Admin Panel', prompt: 'create an admin control panel', expected: 'icons' }
];

examples.forEach(example => {
  const classification = system.analyzeComponent(example.name.toLowerCase().replace(' ', ''), '', example.prompt);
  const guidance = system.getIconGuidance(classification, ['@tabler/icons-react'], example.prompt);
  
  const actualResult = guidance.shouldUseIcons ? 'icons' : 'emojis';
  const isCorrect = actualResult === example.expected ? '✅' : '❌';
  
  console.log(`${isCorrect} ${example.name}: ${actualResult} (expected: ${example.expected}) - confidence: ${(classification.confidence * 100).toFixed(0)}%`);
});