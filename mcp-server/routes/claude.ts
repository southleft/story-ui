import { Request, Response } from 'express';
import { chatCompletion, isProviderConfigured, getProviderInfo } from '../../story-generator/llm-providers/story-llm-service.js';
import { logger } from '../../story-generator/logger.js';

export async function claudeProxy(req: Request, res: Response) {
  const { prompt, messages, model, maxTokens } = req.body;

  // Support both single prompt and messages array
  if (!prompt && (!messages || messages.length === 0)) {
    return res.status(400).json({ error: 'Missing prompt or messages' });
  }

  // Check if any provider is configured
  if (!isProviderConfigured()) {
    return res.status(500).json({
      error: 'No LLM provider configured',
      message: 'Please set CLAUDE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in your environment'
    });
  }

  try {
    const providerInfo = getProviderInfo();
    logger.debug('LLM proxy request', {
      provider: providerInfo.currentProvider,
      model: providerInfo.currentModel,
      hasPrompt: !!prompt,
      messageCount: messages?.length || 1
    });

    // Convert single prompt to messages format if needed
    const chatMessages = messages || [{ role: 'user' as const, content: prompt }];

    const response = await chatCompletion(chatMessages, {
      model,
      maxTokens: maxTokens || 4096
    });

    // Return response in a format compatible with the old Claude API
    res.json({
      content: [{ type: 'text', text: response }],
      provider: providerInfo.currentProvider,
      model: providerInfo.currentModel
    });
  } catch (err) {
    logger.error('LLM proxy error', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({
      error: 'LLM API error',
      message: err instanceof Error ? err.message : 'An unexpected error occurred'
    });
  }
}
