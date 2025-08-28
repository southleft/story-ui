/**
 * Smart Icon Usage Guidance System
 * 
 * Determines when to use proper icons vs emojis based on component context
 * and professional requirements.
 */

export interface ComponentTypeClassification {
  name: string;
  category: 'ui-navigation' | 'content-fun' | 'admin-professional' | 'mixed';
  iconStrategy: 'always-icons' | 'emojis-allowed' | 'context-dependent';
  confidence: number;
}

export interface IconGuidance {
  shouldUseIcons: boolean;
  reason: string;
  iconLibrary?: string;
  fallbackToEmojis: boolean;
  examples: {
    correct: string[];
    incorrect: string[];
  };
}

export class IconGuidanceSystem {
  // Component types that should ALWAYS use proper icons
  private readonly alwaysIconComponents: Array<{
    patterns: string[];
    category: string;
    reason: string;
  }> = [
    {
      patterns: ['navigation', 'navbar', 'sidebar', 'menu', 'header', 'footer'],
      category: 'Navigation',
      reason: 'Navigation components require professional, consistent iconography'
    },
    {
      patterns: ['dashboard', 'admin', 'control', 'panel', 'toolbar'],
      category: 'Admin/Control',
      reason: 'Administrative interfaces demand professional appearance'
    },
    {
      patterns: ['table', 'datagrid', 'list', 'tree', 'grid'],
      category: 'Data Display',
      reason: 'Data components need clear, scannable icons for functionality'
    },
    {
      patterns: ['modal', 'dialog', 'alert', 'notification', 'toast'],
      category: 'Feedback',
      reason: 'User feedback requires standardized, accessible iconography'
    },
    {
      patterns: ['form', 'input', 'field', 'validation', 'error'],
      category: 'Forms',
      reason: 'Form controls need clear, functional icons for usability'
    },
    {
      patterns: ['button', 'action', 'cta', 'primary', 'secondary'],
      category: 'Actions',
      reason: 'Action elements require professional, recognizable icons'
    }
  ];

  // Component types where emojis can be appropriate
  private readonly emojiAllowedComponents: Array<{
    patterns: string[];
    category: string;
    reason: string;
    context: string[];
  }> = [
    {
      patterns: ['card', 'post', 'article', 'content', 'blog'],
      category: 'Content Cards',
      reason: 'Content cards can use emojis for personality and engagement',
      context: ['food', 'social', 'entertainment', 'lifestyle', 'personal']
    },
    {
      patterns: ['recipe', 'food', 'meal', 'restaurant'],
      category: 'Food/Recipe',
      reason: 'Food content often benefits from emoji expressiveness',
      context: ['cooking', 'dining', 'ingredients', 'cuisine']
    },
    {
      patterns: ['social', 'feed', 'timeline', 'story', 'share'],
      category: 'Social Media',
      reason: 'Social components embrace emoji for emotional expression',
      context: ['reactions', 'emotions', 'casual', 'personal']
    },
    {
      patterns: ['game', 'quiz', 'fun', 'entertainment'],
      category: 'Entertainment',
      reason: 'Entertainment components can use emojis for playfulness',
      context: ['games', 'quizzes', 'casual', 'playful']
    },
    {
      patterns: ['weather', 'status', 'mood', 'emoji'],
      category: 'Expressive Content',
      reason: 'When the content itself is about emotions or expressions',
      context: ['weather', 'emotions', 'reactions', 'status']
    }
  ];

  // Context keywords that influence icon vs emoji decision
  private readonly contextAnalysis = {
    professional: ['dashboard', 'admin', 'business', 'corporate', 'enterprise', 'management', 'analytics'],
    casual: ['fun', 'social', 'personal', 'entertainment', 'game', 'casual', 'friendly'],
    functional: ['navigation', 'controls', 'actions', 'forms', 'data', 'settings', 'tools'],
    expressive: ['food', 'emoji', 'reactions', 'mood', 'weather', 'social', 'creative']
  };

  /**
   * Analyzes component type and context to determine icon strategy
   */
  public analyzeComponent(componentName: string, description?: string, userPrompt?: string): ComponentTypeClassification {
    const combinedText = `${componentName} ${description || ''} ${userPrompt || ''}`.toLowerCase();
    
    // Check for always-icon patterns
    for (const iconType of this.alwaysIconComponents) {
      for (const pattern of iconType.patterns) {
        if (combinedText.includes(pattern)) {
          return {
            name: componentName,
            category: 'ui-navigation',
            iconStrategy: 'always-icons',
            confidence: 0.9
          };
        }
      }
    }

    // Check for emoji-allowed patterns
    for (const emojiType of this.emojiAllowedComponents) {
      for (const pattern of emojiType.patterns) {
        if (combinedText.includes(pattern)) {
          // Check if context supports emojis
          const hasEmojiContext = emojiType.context.some(ctx => combinedText.includes(ctx));
          
          if (hasEmojiContext) {
            return {
              name: componentName,
              category: 'content-fun',
              iconStrategy: 'emojis-allowed',
              confidence: 0.8
            };
          } else {
            return {
              name: componentName,
              category: 'mixed',
              iconStrategy: 'context-dependent',
              confidence: 0.6
            };
          }
        }
      }
    }

    // Default analysis based on context keywords
    const professionalScore = this.contextAnalysis.professional.filter(kw => combinedText.includes(kw)).length;
    const casualScore = this.contextAnalysis.casual.filter(kw => combinedText.includes(kw)).length;
    const functionalScore = this.contextAnalysis.functional.filter(kw => combinedText.includes(kw)).length;
    const expressiveScore = this.contextAnalysis.expressive.filter(kw => combinedText.includes(kw)).length;

    if (professionalScore > 0 || functionalScore > casualScore + expressiveScore) {
      return {
        name: componentName,
        category: 'admin-professional',
        iconStrategy: 'always-icons',
        confidence: 0.7
      };
    }

    if (casualScore > 0 || expressiveScore > professionalScore + functionalScore) {
      return {
        name: componentName,
        category: 'content-fun',
        iconStrategy: 'emojis-allowed',
        confidence: 0.7
      };
    }

    // Default to context-dependent for unclear cases
    return {
      name: componentName,
      category: 'mixed',
      iconStrategy: 'context-dependent',
      confidence: 0.5
    };
  }

  /**
   * Provides specific guidance for icon usage based on classification
   */
  public getIconGuidance(
    classification: ComponentTypeClassification,
    availableIconLibraries: string[] = ['@tabler/icons-react'],
    userPrompt?: string
  ): IconGuidance {
    const primaryIconLibrary = this.selectBestIconLibrary(availableIconLibraries);
    
    switch (classification.iconStrategy) {
      case 'always-icons':
        return {
          shouldUseIcons: true,
          reason: `${classification.category} components require professional, consistent iconography for usability and brand consistency.`,
          iconLibrary: primaryIconLibrary,
          fallbackToEmojis: false,
          examples: {
            correct: this.getIconExamples(primaryIconLibrary, classification.category),
            incorrect: this.getEmojiExamples(classification.category)
          }
        };

      case 'emojis-allowed':
        return {
          shouldUseIcons: false,
          reason: `${classification.category} components can benefit from emoji expressiveness to create personality and emotional connection.`,
          iconLibrary: primaryIconLibrary,
          fallbackToEmojis: true,
          examples: {
            correct: this.getEmojiExamples(classification.category),
            incorrect: this.getIconExamples(primaryIconLibrary, classification.category)
          }
        };

      case 'context-dependent':
        const contextAnalysis = this.analyzeUserContext(userPrompt || '');
        const shouldUseIcons = contextAnalysis.professional > contextAnalysis.casual;
        
        return {
          shouldUseIcons,
          reason: `Context suggests ${shouldUseIcons ? 'professional icons' : 'emojis'} based on: ${contextAnalysis.reasoning}`,
          iconLibrary: primaryIconLibrary,
          fallbackToEmojis: !shouldUseIcons,
          examples: {
            correct: shouldUseIcons 
              ? this.getIconExamples(primaryIconLibrary, classification.category)
              : this.getEmojiExamples(classification.category),
            incorrect: shouldUseIcons 
              ? this.getEmojiExamples(classification.category)
              : this.getIconExamples(primaryIconLibrary, classification.category)
          }
        };

      default:
        return {
          shouldUseIcons: true,
          reason: 'Default to professional icons when context is unclear.',
          iconLibrary: primaryIconLibrary,
          fallbackToEmojis: false,
          examples: {
            correct: this.getIconExamples(primaryIconLibrary, 'default'),
            incorrect: ['❌ Avoid emoji usage in unclear contexts']
          }
        };
    }
  }

  /**
   * Selects the best icon library from available options
   */
  private selectBestIconLibrary(libraries: string[]): string {
    const priorityOrder = [
      '@tabler/icons-react',
      'lucide-react',
      '@heroicons/react',
      'react-icons',
      '@mui/icons-material',
      '@ant-design/icons'
    ];

    for (const preferred of priorityOrder) {
      if (libraries.includes(preferred)) {
        return preferred;
      }
    }

    return libraries[0] || '@tabler/icons-react';
  }

  /**
   * Analyzes user prompt for professional vs casual context
   */
  private analyzeUserContext(prompt: string): { professional: number; casual: number; reasoning: string } {
    const lowerPrompt = prompt.toLowerCase();
    
    const professionalIndicators = [
      'dashboard', 'admin', 'management', 'business', 'corporate', 'enterprise',
      'analytics', 'data', 'report', 'control', 'settings', 'configuration',
      'professional', 'formal', 'clean', 'minimal', 'system'
    ];
    
    const casualIndicators = [
      'fun', 'playful', 'social', 'personal', 'entertainment', 'game',
      'creative', 'expressive', 'colorful', 'friendly', 'casual', 'emoji',
      'food', 'recipe', 'social media', 'blog', 'story'
    ];

    const professionalScore = professionalIndicators.filter(indicator => 
      lowerPrompt.includes(indicator)
    ).length;

    const casualScore = casualIndicators.filter(indicator => 
      lowerPrompt.includes(indicator)
    ).length;

    let reasoning = '';
    if (professionalScore > casualScore) {
      reasoning = 'professional/business context detected';
    } else if (casualScore > professionalScore) {
      reasoning = 'casual/expressive context detected';
    } else {
      reasoning = 'neutral context, defaulting to professional standards';
    }

    return {
      professional: professionalScore,
      casual: casualScore,
      reasoning
    };
  }

  /**
   * Gets appropriate icon examples based on library and context
   */
  private getIconExamples(library: string, category: string): string[] {
    const baseExamples = {
      '@tabler/icons-react': [
        'import { IconHome, IconMenu, IconUser, IconSettings } from \'@tabler/icons-react\';',
        '<IconHome size={24} stroke={1.5} />',
        '<IconMenu size={20} />',
        '<IconSettings size={16} color="currentColor" />'
      ],
      'lucide-react': [
        'import { Home, Menu, User, Settings } from \'lucide-react\';',
        '<Home size={24} />',
        '<Menu size={20} strokeWidth={1.5} />',
        '<Settings size={16} color="currentColor" />'
      ],
      '@heroicons/react': [
        'import { HomeIcon, Bars3Icon, UserIcon, CogIcon } from \'@heroicons/react/24/outline\';',
        '<HomeIcon className="h-6 w-6" />',
        '<Bars3Icon className="h-5 w-5" />',
        '<CogIcon className="h-4 w-4" />'
      ]
    };

    return baseExamples[library as keyof typeof baseExamples] || baseExamples['@tabler/icons-react'];
  }

  /**
   * Gets emoji examples that should be avoided in professional contexts
   */
  private getEmojiExamples(category: string): string[] {
    const emojiExamples = {
      'Navigation': ['🏠 Home', '📋 Menu', '👤 Profile', '⚙️ Settings'],
      'Admin/Control': ['📊 Dashboard', '👥 Users', '📈 Analytics', '🔧 Tools'],
      'Data Display': ['📝 25 items', '⭐ 4.8/5', '📅 Today', '✅ Complete'],
      'Content Cards': ['🍕 Pizza Recipe', '❤️ 24 likes', '🕒 25 mins', '⭐ Featured'],
      'Food/Recipe': ['🥗 Salad', '🍰 Dessert', '🔥 425°F', '⏰ 30 minutes'],
      'Social Media': ['❤️ Like', '💬 Comment', '📤 Share', '😊 React'],
      'default': ['✅ Success', '❌ Error', '⚠️ Warning', 'ℹ️ Info']
    };

    return emojiExamples[category as keyof typeof emojiExamples] || emojiExamples.default;
  }

  /**
   * Generates guidance prompt text for AI
   */
  public generateGuidancePrompt(
    componentName: string, 
    description?: string, 
    userPrompt?: string,
    availableIconLibraries: string[] = ['@tabler/icons-react']
  ): string {
    const classification = this.analyzeComponent(componentName, description, userPrompt);
    const guidance = this.getIconGuidance(classification, availableIconLibraries, userPrompt);

    let prompt = `\n🎯 ICON USAGE GUIDANCE FOR THIS COMPONENT:\n\n`;
    
    prompt += `**Component Type**: ${classification.category} (${classification.iconStrategy})\n`;
    prompt += `**Decision**: ${guidance.shouldUseIcons ? 'USE PROPER ICONS' : 'EMOJIS ALLOWED'}\n`;
    prompt += `**Reason**: ${guidance.reason}\n\n`;

    if (guidance.shouldUseIcons) {
      prompt += `**✅ CORRECT APPROACH**:\n`;
      guidance.examples.correct.forEach(example => {
        prompt += `- ${example}\n`;
      });
      
      prompt += `\n**❌ AVOID**:\n`;
      guidance.examples.incorrect.forEach(example => {
        prompt += `- ${example}\n`;
      });
      
      if (guidance.iconLibrary) {
        prompt += `\n**Primary Icon Library**: ${guidance.iconLibrary}\n`;
        prompt += `Import proper icon components and use them with appropriate sizing and styling.\n`;
      }
    } else {
      prompt += `**✅ EMOJIS ARE APPROPRIATE** for this component type:\n`;
      guidance.examples.correct.forEach(example => {
        prompt += `- ${example}\n`;
      });
      
      prompt += `\n**Alternative**: If you prefer consistency, you can still use:\n`;
      guidance.examples.incorrect.forEach(example => {
        prompt += `- ${example}\n`;
      });
    }

    prompt += `\n**Confidence Level**: ${(classification.confidence * 100).toFixed(0)}%\n`;
    
    if (classification.confidence < 0.7) {
      prompt += `\n⚠️ **Note**: Context is ambiguous. Consider the overall application style and user expectations.\n`;
    }

    return prompt;
  }
}

/**
 * Convenience function to get icon guidance for a component
 */
export function getIconGuidance(
  componentName: string,
  description?: string,
  userPrompt?: string,
  availableIconLibraries?: string[]
): IconGuidance {
  const system = new IconGuidanceSystem();
  const classification = system.analyzeComponent(componentName, description, userPrompt);
  return system.getIconGuidance(classification, availableIconLibraries, userPrompt);
}

/**
 * Convenience function to generate guidance prompt
 */
export function generateIconGuidancePrompt(
  componentName: string,
  description?: string,
  userPrompt?: string,
  availableIconLibraries?: string[]
): string {
  const system = new IconGuidanceSystem();
  return system.generateGuidancePrompt(componentName, description, userPrompt, availableIconLibraries);
}