import { Request, Response } from 'express';
import { chatCompletion, isProviderConfigured, getProviderInfo } from '../../story-generator/llm-providers/story-llm-service.js';
import { logger } from '../../story-generator/logger.js';

export async function claudeProxy(req: Request, res: Response) {
  const { prompt, messages, model, maxTokens, systemPrompt, prefillAssistant } = req.body;

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
      messageCount: messages?.length || 1,
      hasPrefill: !!prefillAssistant
    });

    // Convert single prompt to messages format if needed
    // Handle both undefined messages and empty array
    let chatMessages = (messages && messages.length > 0)
      ? messages
      : [{ role: 'user' as const, content: prompt }];

    // Prepend system prompt as a system message if provided
    if (systemPrompt) {
      chatMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...chatMessages
      ];
    }

    // Assistant-turn prefill is rejected (HTTP 400) by Claude 4.6+ models, so we
    // emulate it: instruct the model to begin with the prefill text, then
    // normalize the response so callers still receive output starting with it.
    if (prefillAssistant) {
      chatMessages = [
        ...chatMessages,
        {
          role: 'user' as const,
          content: `Begin your response with exactly: ${prefillAssistant}\nDo not include any text before it.`
        }
      ];
    }

    let response = await chatCompletion(chatMessages, {
      model,
      maxTokens: maxTokens || 4096
    });

    if (prefillAssistant && !response.trimStart().startsWith(prefillAssistant)) {
      response = prefillAssistant + response;
    }

    const fullResponse = response;

    // Return response in a format compatible with the old Claude API
    res.json({
      content: [{ type: 'text', text: fullResponse }],
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
