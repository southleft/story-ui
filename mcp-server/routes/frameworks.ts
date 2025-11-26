/**
 * Framework Management Routes
 *
 * API endpoints for framework detection and adapter management.
 * Supports multi-framework story generation.
 */

import { Request, Response } from 'express';
import {
  detectProjectFramework,
  getAvailableFrameworks,
  getFrameworkAdapter,
} from '../../story-generator/promptGenerator.js';
import { detectFramework } from '../../story-generator/framework-adapters/index.js';
import { logger } from '../../story-generator/logger.js';

/**
 * GET /mcp/frameworks
 *
 * List all available frameworks and their adapters.
 */
export async function listFrameworks(req: Request, res: Response) {
  try {
    const frameworks = getAvailableFrameworks();

    const frameworkDetails = frameworks.map(framework => {
      const adapter = getFrameworkAdapter(framework);
      return {
        type: framework,
        name: adapter.name,
        supportedStoryFrameworks: adapter.supportedStoryFrameworks,
        defaultExtension: adapter.defaultExtension,
      };
    });

    res.json({
      success: true,
      frameworks: frameworkDetails,
      count: frameworks.length,
    });
  } catch (error: any) {
    logger.error('Failed to list frameworks', { error: error.message });
    res.status(500).json({
      error: 'Failed to list frameworks',
      message: error.message,
    });
  }
}

/**
 * GET /mcp/frameworks/detect
 *
 * Auto-detect the framework used in the current project.
 */
export async function detectCurrentFramework(req: Request, res: Response) {
  try {
    const projectRoot = (req.query.path as string) || process.cwd();

    const result = await detectFramework(projectRoot);

    res.json({
      success: true,
      detected: {
        primary: result.primary,
        alternatives: result.frameworks.slice(1),
      },
      projectInfo: {
        dependencies: result.dependencies,
        configFiles: result.configFiles,
      },
    });
  } catch (error: any) {
    logger.error('Failed to detect framework', { error: error.message });
    res.status(500).json({
      error: 'Failed to detect framework',
      message: error.message,
    });
  }
}

/**
 * GET /mcp/frameworks/:type
 *
 * Get details about a specific framework adapter.
 */
export async function getFrameworkDetails(req: Request, res: Response) {
  try {
    const { type } = req.params;
    const availableFrameworks = getAvailableFrameworks();

    if (!availableFrameworks.includes(type as any)) {
      return res.status(404).json({
        error: 'Framework not found',
        message: `Framework "${type}" is not supported`,
        available: availableFrameworks,
      });
    }

    const adapter = getFrameworkAdapter(type as any);

    res.json({
      success: true,
      framework: {
        type: adapter.type,
        name: adapter.name,
        supportedStoryFrameworks: adapter.supportedStoryFrameworks,
        defaultExtension: adapter.defaultExtension,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get framework details', { error: error.message });
    res.status(500).json({
      error: 'Failed to get framework details',
      message: error.message,
    });
  }
}

/**
 * POST /mcp/frameworks/validate
 *
 * Validate generated story content against framework rules.
 */
export async function validateStoryForFramework(req: Request, res: Response) {
  try {
    const { framework, content } = req.body;

    if (!framework || !content) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Both "framework" and "content" are required',
      });
    }

    const availableFrameworks = getAvailableFrameworks();
    if (!availableFrameworks.includes(framework as any)) {
      return res.status(400).json({
        error: 'Invalid framework',
        message: `Framework "${framework}" is not supported`,
        available: availableFrameworks,
      });
    }

    const adapter = getFrameworkAdapter(framework as any);
    const validation = adapter.validate(content);

    res.json({
      success: true,
      validation: {
        isValid: validation.valid,
        errors: validation.errors,
        framework: adapter.type,
      },
    });
  } catch (error: any) {
    logger.error('Failed to validate story', { error: error.message });
    res.status(500).json({
      error: 'Failed to validate story',
      message: error.message,
    });
  }
}

/**
 * POST /mcp/frameworks/post-process
 *
 * Post-process generated story content for a specific framework.
 */
export async function postProcessStoryForFramework(req: Request, res: Response) {
  try {
    const { framework, content } = req.body;

    if (!framework || !content) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Both "framework" and "content" are required',
      });
    }

    const availableFrameworks = getAvailableFrameworks();
    if (!availableFrameworks.includes(framework as any)) {
      return res.status(400).json({
        error: 'Invalid framework',
        message: `Framework "${framework}" is not supported`,
        available: availableFrameworks,
      });
    }

    const adapter = getFrameworkAdapter(framework as any);
    const processed = adapter.postProcess(content);

    res.json({
      success: true,
      content: processed,
      framework: adapter.type,
    });
  } catch (error: any) {
    logger.error('Failed to post-process story', { error: error.message });
    res.status(500).json({
      error: 'Failed to post-process story',
      message: error.message,
    });
  }
}
