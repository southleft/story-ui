import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { STORY_UI_CONFIG } from '../../story-ui.config.js';

const metadataPath = STORY_UI_CONFIG.componentsMetadataPath ?
  path.resolve(process.cwd(), STORY_UI_CONFIG.componentsMetadataPath) :
  null;

export function getComponents(req: Request, res: Response) {
  if (!metadataPath || !fs.existsSync(metadataPath)) {
    return res.json([]);
  }

  const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const components = data?.tags?.map((tag: any) => ({
    name: tag.name,
    description: tag.description,
  })) || [];
  res.json(components);
}

export function getProps(req: Request, res: Response) {
  if (!metadataPath || !fs.existsSync(metadataPath)) {
    return res.json([]);
  }

  const { component } = req.query;
  const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const tag = data?.tags?.find((t: any) => t.name === component);
  res.json(tag?.attributes || []);
}
