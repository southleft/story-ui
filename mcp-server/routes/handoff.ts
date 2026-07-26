/**
 * Handoff — take a prototyped story to a branch, and optionally a pull request.
 *
 * This is the end of the intended workflow: a designer iterates in the panel
 * until the composition is right, then hands a link to a product engineer who
 * integrates it. Because the story was generated from the design system that is
 * actually installed, the engineer receives real components and real styling
 * rather than a redline.
 *
 * SAFETY. This is the only part of Story UI that writes to version control and
 * can publish outside the user's machine, so it is deliberately conservative:
 *  - never commits on the user's current branch; always cuts a new one
 *  - stages ONLY the named story file, never `git add -A`
 *  - refuses to run when unrelated changes are already staged
 *  - never force-pushes, never amends, never rewrites history
 *  - pushing and opening a PR are opt-in flags, not the default
 * Every mutating step is driven by an explicit user action in the panel.
 */

import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../../story-generator/logger.js';

const run = promisify(execFile);

interface GitResult { stdout: string; stderr: string; }

async function git(args: string[], cwd: string): Promise<GitResult> {
  return run('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

async function isRepo(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await git(['branch', '--show-current'], cwd);
  return stdout.trim();
}

async function hasRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(['remote'], cwd);
    const first = stdout.split('\n').map(s => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

/** Anything already staged that we did not stage ourselves. */
async function stagedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await git(['diff', '--cached', '--name-only'], cwd);
  return stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'story';
}

/** Resolve a story file inside the generated directory, refusing traversal. */
function resolveStoryPath(cwd: string, generatedDir: string, fileName: string): string | null {
  if (!fileName || path.basename(fileName) !== fileName) return null;
  const dir = path.resolve(cwd, generatedDir);
  const full = path.join(dir, fileName);
  if (!full.startsWith(dir + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

export interface HandoffDeps {
  /** Configured generated-stories directory, relative to the project root. */
  generatedStoriesPath: string;
}

/**
 * GET /story-ui/handoff/status
 * What the panel needs to decide whether to offer handoff at all.
 */
export function makeHandoffStatus(deps: HandoffDeps) {
  return async function handoffStatus(_req: Request, res: Response): Promise<void> {
    const cwd = process.cwd();
    try {
      const repo = await isRepo(cwd);
      if (!repo) {
        res.json({ available: false, reason: 'This project is not a git repository' });
        return;
      }
      const remote = await hasRemote(cwd);
      let ghReady = false;
      try {
        await run('gh', ['auth', 'status'], { cwd });
        ghReady = true;
      } catch {
        ghReady = false;
      }
      res.json({
        available: true,
        branch: await currentBranch(cwd),
        remote,
        canPush: !!remote,
        canOpenPr: !!remote && ghReady,
        // Surfaced so the panel can explain WHY the PR button is unavailable
        // instead of silently hiding it.
        prUnavailableReason: !remote
          ? 'No git remote configured'
          : !ghReady
            ? 'GitHub CLI is not authenticated (run: gh auth login)'
            : undefined,
      });
    } catch (error) {
      logger.error('handoff status failed', { error });
      res.status(500).json({ available: false, reason: 'Could not inspect the repository' });
    }
  };
}

/**
 * POST /story-ui/handoff
 * body: { fileName, title?, branch?, push?, openPr?, prBody? }
 *
 * Always commits to a NEW branch. push and openPr are opt-in.
 */
export function makeHandoff(deps: HandoffDeps) {
  return async function handoff(req: Request, res: Response): Promise<void> {
    const cwd = process.cwd();
    const { fileName, title, branch: requestedBranch, push = false, openPr = false, prBody } = req.body || {};

    try {
      if (!(await isRepo(cwd))) {
        res.status(400).json({ error: 'This project is not a git repository' });
        return;
      }

      const storyPath = resolveStoryPath(cwd, deps.generatedStoriesPath, fileName);
      if (!storyPath) {
        res.status(400).json({ error: `Story file not found: ${fileName}` });
        return;
      }

      // Refuse to sweep up work the user was in the middle of.
      const alreadyStaged = await stagedFiles(cwd);
      if (alreadyStaged.length > 0) {
        res.status(409).json({
          error: 'There are already staged changes in this repository',
          detail: `Commit or unstage them first: ${alreadyStaged.slice(0, 5).join(', ')}${alreadyStaged.length > 5 ? '…' : ''}`,
        });
        return;
      }

      const storyTitle = (title || path.basename(fileName).replace(/\.stories\.\w+$/, '')).trim();
      const branchName = (requestedBranch || `story-ui/${slugify(storyTitle)}`).trim();
      const startedOn = await currentBranch(cwd);

      // A new branch every time — never commit onto whatever the user had open.
      try {
        await git(['checkout', '-b', branchName], cwd);
      } catch {
        res.status(409).json({
          error: `Branch "${branchName}" already exists`,
          detail: 'Choose a different name, or delete the existing branch first.',
        });
        return;
      }

      const relPath = path.relative(cwd, storyPath);
      let prUrl: string | undefined;
      let pushed = false;

      try {
        // ONLY this file. Never `git add -A`.
        await git(['add', '--', relPath], cwd);

        const subject = `feat(story): ${storyTitle}`;
        const body = [
          'Prototyped in Story UI against this project\'s installed design system,',
          'so the composition uses the real components and styling methods.',
          '',
          `Story: ${relPath}`,
        ].join('\n');
        await git(['commit', '-m', subject, '-m', body], cwd);

        if (push) {
          const remote = await hasRemote(cwd);
          if (!remote) {
            res.status(400).json({ error: 'No git remote configured to push to' });
            return;
          }
          await git(['push', '--set-upstream', remote, branchName], cwd);
          pushed = true;

          if (openPr) {
            const prArgs = [
              'pr', 'create',
              '--title', storyTitle,
              '--body', prBody || [
                `Prototyped in Story UI using this project's design system.`,
                '',
                `The story lives at \`${relPath}\` and renders with the components already`,
                'installed here, so it can be integrated directly rather than rebuilt from a spec.',
              ].join('\n'),
              '--head', branchName,
            ];
            const { stdout } = await run('gh', prArgs, { cwd });
            prUrl = stdout.trim().split('\n').filter(Boolean).pop();
          }
        }

        const { stdout: sha } = await git(['rev-parse', '--short', 'HEAD'], cwd);
        logger.log(`🚀 Handoff: ${relPath} on ${branchName}${pushed ? ' (pushed)' : ''}${prUrl ? ` → ${prUrl}` : ''}`);

        res.json({
          success: true,
          branch: branchName,
          startedOn,
          commit: sha.trim(),
          file: relPath,
          pushed,
          prUrl,
        });
      } catch (inner) {
        // Leave the user where they started rather than stranded on a branch
        // that may hold a half-finished commit.
        try { await git(['checkout', startedOn], cwd); } catch { /* best effort */ }
        throw inner;
      }
    } catch (error: any) {
      const detail = (error?.stderr || error?.message || String(error)).slice(0, 600);
      logger.error(`handoff failed: ${detail}`);
      res.status(500).json({ error: 'Handoff failed', detail });
    }
  };
}
