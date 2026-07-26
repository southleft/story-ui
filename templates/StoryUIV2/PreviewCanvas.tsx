/**
 * Preview canvas — the right pane.
 *
 * The whole reason Story UI can compete with v0 or Claude Design is that it does
 * not need to build a sandbox: Storybook is already running the user's real
 * design system, and the docs page is same-origin with it. So the canvas is
 * literally Storybook's own `/iframe.html`, showing the story that was just
 * written to disk, rendered by the project's own providers and theme.
 *
 * Nothing here simulates a preview. It IS the preview.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { w: number; h: number; label: string }> = {
  desktop: { w: 1280, h: 900, label: 'Desktop' },
  tablet: { w: 834, h: 1000, label: 'Tablet' },
  mobile: { w: 390, h: 844, label: 'Mobile' },
};

interface PreviewCanvasProps {
  /** Storybook story id to render, e.g. "generated-pricing-card--default". */
  storyId?: string;
  /** Human title for the bar. */
  title?: string;
  /** Bumped by the caller to force a reload after a regeneration. */
  reloadToken?: number;
  /** Shown while a generation is in flight and no story exists yet. */
  busy?: boolean;
  onOpenInStorybook?: () => void;
  onHandoff?: () => void;
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  storyId,
  title,
  reloadToken = 0,
  busy = false,
  onOpenInStorybook,
  onHandoff,
}) => {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  // Measure the stage so the frame can fit-to-width rather than overflow.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setStageSize({ w: box.width, h: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spec = VIEWPORTS[viewport];

  // Fit the chosen viewport inside the stage. Never scale UP — a 390px mobile
  // frame blown up to fill 1200px would misrepresent the design.
  const fitScale = useMemo(() => {
    if (!stageSize.w || !stageSize.h) return 1;
    const pad = 40;
    return Math.min(1, (stageSize.w - pad) / spec.w, (stageSize.h - pad) / spec.h);
  }, [stageSize, spec]);

  const scale = fitScale * zoom;

  const src = storyId
    ? `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`
    : undefined;

  // Navigate the SAME iframe rather than remounting it.
  //
  // Keying the frame on a reload counter forced a fresh mount per generation,
  // which means a cold Storybook boot every time (hundreds of ms of white) and
  // makes a cross-fade impossible because the old document is destroyed before
  // the new one paints. Instead the frame is mounted once and its location is
  // driven imperatively, so the previous composition stays on screen —
  // dimmed — until the new one is ready.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastSrc = useRef<string | null>(null);

  // Drive the frame's location imperatively so the element is never torn down.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;
    if (lastSrc.current === src && reloadToken === 0) return;
    // location.replace keeps the workspace out of the iframe's history, so the
    // browser Back button never walks the user through old previews.
    try {
      if (frame.contentWindow) frame.contentWindow.location.replace(src);
      else frame.src = src;
    } catch {
      frame.src = src;
    }
    lastSrc.current = src;
  }, [src, reloadToken]);

  const cycleZoom = useCallback(() => {
    setZoom(z => (z >= 1 ? 0.5 : z >= 0.75 ? 1 : z + 0.25));
  }, []);

  return (
    <div className="suiw-canvas">
      <div className="suiw-canvas-bar">
        <div className="suiw-top-group" role="group" aria-label="Viewport">
          {(Object.keys(VIEWPORTS) as Viewport[]).map(v => (
            <button
              key={v}
              type="button"
              className="suiw-btn"
              aria-pressed={viewport === v}
              onClick={() => setViewport(v)}
              title={`${VIEWPORTS[v].label} (${VIEWPORTS[v].w}px)`}
            >
              {VIEWPORTS[v].label}
            </button>
          ))}
        </div>

        <button type="button" className="suiw-btn" onClick={cycleZoom} title="Zoom">
          {Math.round(scale * 100)}%
        </button>

        <span className="suiw-top-spacer" />

        {title && <span className="suiw-top-title">{title}</span>}

        <button
          type="button"
          className="suiw-btn"
          onClick={onOpenInStorybook}
          disabled={!storyId}
          title="Open this story in Storybook"
        >
          Open in Storybook
        </button>
        <button
          type="button"
          className="suiw-btn suiw-btn--primary"
          onClick={onHandoff}
          disabled={!storyId}
          title="Commit to a branch for a product engineer"
        >
          Hand off
        </button>
      </div>

      <div className="suiw-canvas-stage" ref={stageRef}>
        {src ? (
          <div
            className={`suiw-frame${busy ? ' suiw-frame--stale' : ''}`}
            style={{
              width: spec.w * scale,
              height: spec.h * scale,
            }}
          >
            {/* The iframe renders at true viewport size and is scaled down, so
                the story sees the media queries it would see at that width —
                scaling the container instead would lie about breakpoints. */}
            <iframe
              ref={frameRef}
              title={title || 'Generated story preview'}
              style={{
                width: spec.w,
                height: spec.h,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }}
            />
          </div>
        ) : (
          <div className="suiw-canvas-empty">
            {busy ? (
              <>
                <span>Building your composition</span>
                <span style={{ fontSize: 12 }}>
                  It will appear here as soon as the story is written and indexed.
                </span>
              </>
            ) : (
              <>
                <span>Nothing to preview yet</span>
                <span style={{ fontSize: 12 }}>
                  Describe what you want on the left, and it renders here using your own components.
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewCanvas;
