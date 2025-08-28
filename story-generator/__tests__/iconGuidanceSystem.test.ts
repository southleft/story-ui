/**
 * Tests for the Icon Guidance System
 */

import { IconGuidanceSystem, getIconGuidance } from '../iconGuidanceSystem.js';

describe('IconGuidanceSystem', () => {
  let system: IconGuidanceSystem;

  beforeEach(() => {
    system = new IconGuidanceSystem();
  });

  describe('Component Classification', () => {
    test('should classify navigation components as always-icons', () => {
      const classification = system.analyzeComponent('navbar', 'main navigation bar');
      
      expect(classification.iconStrategy).toBe('always-icons');
      expect(classification.category).toBe('ui-navigation');
      expect(classification.confidence).toBeGreaterThan(0.8);
    });

    test('should classify admin/dashboard components as always-icons', () => {
      const classification = system.analyzeComponent('dashboard', 'admin control panel');
      
      expect(classification.iconStrategy).toBe('always-icons');
      expect(classification.category).toBe('ui-navigation');
      expect(classification.confidence).toBeGreaterThan(0.8);
    });

    test('should classify recipe components as emoji-allowed', () => {
      const classification = system.analyzeComponent('recipe card', 'food recipe display', 'create a pizza recipe card');
      
      expect(classification.iconStrategy).toBe('emojis-allowed');
      expect(classification.category).toBe('content-fun');
      expect(classification.confidence).toBeGreaterThan(0.7);
    });

    test('should classify social media components as emoji-allowed', () => {
      const classification = system.analyzeComponent('social post', 'social media post card', 'create a social media feed item');
      
      expect(classification.iconStrategy).toBe('emojis-allowed');
      expect(classification.category).toBe('content-fun');
      expect(classification.confidence).toBeGreaterThan(0.7);
    });

    test('should handle ambiguous components as context-dependent', () => {
      const classification = system.analyzeComponent('card', 'generic card component');
      
      expect(classification.iconStrategy).toBe('context-dependent');
      expect(classification.category).toBe('mixed');
    });
  });

  describe('Icon Guidance Generation', () => {
    test('should recommend icons for professional components', () => {
      const classification = system.analyzeComponent('navigation menu', 'main site navigation');
      const guidance = system.getIconGuidance(classification, ['@tabler/icons-react']);
      
      expect(guidance.shouldUseIcons).toBe(true);
      expect(guidance.fallbackToEmojis).toBe(false);
      expect(guidance.iconLibrary).toBe('@tabler/icons-react');
      expect(guidance.examples.correct.length).toBeGreaterThan(0);
    });

    test('should allow emojis for content components', () => {
      const classification = system.analyzeComponent('recipe card', 'food recipe', 'create a recipe for pizza');
      const guidance = system.getIconGuidance(classification, ['@tabler/icons-react']);
      
      expect(guidance.shouldUseIcons).toBe(false);
      expect(guidance.fallbackToEmojis).toBe(true);
      expect(guidance.examples.correct.length).toBeGreaterThan(0);
    });

    test('should handle context-dependent components based on prompt', () => {
      const classification = system.analyzeComponent('button', 'action button', 'create a dashboard action button');
      const guidance = system.getIconGuidance(classification, ['@tabler/icons-react'], 'create a dashboard action button');
      
      expect(guidance.shouldUseIcons).toBe(true);
      expect(guidance.reason).toContain('professional');
    });
  });

  describe('Context Analysis', () => {
    test('should detect professional context', () => {
      const prompts = [
        'create a dashboard for business analytics',
        'build an admin panel for user management', 
        'make a professional settings interface'
      ];

      prompts.forEach(prompt => {
        const classification = system.analyzeComponent('component', '', prompt);
        expect(['always-icons', 'context-dependent']).toContain(classification.iconStrategy);
      });
    });

    test('should detect casual/fun context', () => {
      const prompts = [
        'create a fun social media card',
        'build a playful game interface',
        'make a colorful food recipe display'
      ];

      prompts.forEach(prompt => {
        const classification = system.analyzeComponent('component', '', prompt);
        if (classification.iconStrategy === 'context-dependent') {
          const guidance = system.getIconGuidance(classification, ['@tabler/icons-react'], prompt);
          expect(guidance.shouldUseIcons).toBe(false);
        } else {
          expect(classification.iconStrategy).toBe('emojis-allowed');
        }
      });
    });
  });

  describe('Prompt Generation', () => {
    test('should generate comprehensive guidance prompt', () => {
      const prompt = system.generateGuidancePrompt(
        'dashboard',
        'user analytics dashboard',
        'create a business dashboard with user metrics',
        ['@tabler/icons-react']
      );

      expect(prompt).toContain('ICON USAGE GUIDANCE');
      expect(prompt).toContain('USE PROPER ICONS');
      expect(prompt).toContain('@tabler/icons-react');
      expect(prompt).toContain('✅ CORRECT APPROACH');
      expect(prompt).toContain('❌ AVOID');
    });

    test('should generate emoji-friendly guidance for content components', () => {
      const prompt = system.generateGuidancePrompt(
        'recipe card',
        'food recipe display',
        'create a pizza recipe card with cooking time',
        ['@tabler/icons-react']
      );

      expect(prompt).toContain('EMOJIS ARE APPROPRIATE');
      expect(prompt).toContain('content-fun');
    });
  });

  describe('Icon Library Detection', () => {
    test('should prefer Tabler Icons when available', () => {
      const libraries = ['react-icons', '@tabler/icons-react', 'lucide-react'];
      const classification = system.analyzeComponent('navbar', 'navigation');
      const guidance = system.getIconGuidance(classification, libraries);

      expect(guidance.iconLibrary).toBe('@tabler/icons-react');
    });

    test('should fall back to available libraries', () => {
      const libraries = ['react-icons'];
      const classification = system.analyzeComponent('navbar', 'navigation');
      const guidance = system.getIconGuidance(classification, libraries);

      expect(guidance.iconLibrary).toBe('react-icons');
    });

    test('should default to Tabler Icons when no libraries specified', () => {
      const classification = system.analyzeComponent('navbar', 'navigation');
      const guidance = system.getIconGuidance(classification, []);

      expect(guidance.iconLibrary).toBe('@tabler/icons-react');
    });
  });
});

describe('Convenience Functions', () => {
  test('getIconGuidance should work as expected', () => {
    const guidance = getIconGuidance('dashboard', 'admin panel', 'create a business dashboard');
    
    expect(guidance.shouldUseIcons).toBe(true);
    expect(guidance.reason).toContain('professional');
  });
});