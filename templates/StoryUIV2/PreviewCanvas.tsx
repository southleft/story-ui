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
import { Badge, Button, Callout, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import { attachElementPicker, type ElementTarget } from './elementTargeting';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { w: number; h: number; label: string }> = {
  desktop: { w: 1280, h: 900, label: 'Desktop' },
  tablet: { w: 834, h: 1000, label: 'Tablet' },
  mobile: { w: 390, h: 844, label: 'Mobile' },
};

interface PreviewCanvasProps {
  storyId?: string;
  title?: string;
  /** Bumped by the caller to force a reload after a regeneration. */
  reloadToken?: number;
  busy?: boolean;
  onOpenInStorybook?: () => void;
  onHandoff?: () => void;
  /**
   * False when there is no generated file to commit — e.g. a story opened from
   * Recent work. Disabled with a reason beats a button that does nothing.
   */
  canHandoff?: boolean;
  /** Set when the story was written but Storybook never indexed it. */
  notIndexed?: { fileName?: string; title?: string } | null;
  onRecheck?: () => void;
  /** Called when the user points at an element, or null when they cancel. */
  onSelectElement?: (target: ElementTarget | null) => void;
  /** True while an element is already selected, so the toggle reads correctly. */
  hasSelection?: boolean;
  /** Version history control, owned by the workspace which knows the file. */
  historySlot?: React.ReactNode;
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  storyId,
  title,
  reloadToken = 0,
  busy = false,
  onOpenInStorybook,
  onHandoff,
  canHandoff = true,
  notIndexed,
  onRecheck,
  onSelectElement,
  hasSelection = false,
  historySlot,
}) => {
  const [picking, setPicking] = useState(false);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastSrc = useRef<string | null>(null);

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
    const pad = 48;
    return Math.min(1, (stageSize.w - pad) / spec.w, (stageSize.h - pad) / spec.h);
  }, [stageSize, spec]);

  const scale = fitScale * zoom;
  const src = storyId ? `/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story` : undefined;

  // Navigate the SAME iframe rather than remounting it. Keying the frame on a
  // reload counter forced a cold Storybook boot per generation and made a
  // cross-fade impossible, because the old document dies before the new paints.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;
    if (lastSrc.current === src && reloadToken === 0) return;
    try {
      // location.replace keeps the workspace out of the iframe's history, so
      // Back never walks the user through old previews.
      if (frame.contentWindow) frame.contentWindow.location.replace(src);
      else frame.src = src;
    } catch {
      frame.src = src;
    }
    lastSrc.current = src;
  }, [src, reloadToken]);

  /**
   * Click-to-select, attached directly to the preview document.
   *
   * Possible because Storybook's iframe is same-origin with the workspace —
   * v0 and Lovable have to bridge a sandbox to do the same thing. Re-attached
   * on every navigation, since replacing the location swaps the document out
   * from under the listeners.
   */
  useEffect(() => {
    if (!picking) return;
    const frame = frameRef.current;
    if (!frame) return;

    let detach: (() => void) | null = null;
    const attach = () => {
      detach?.();
      detach = null;
      try {
        const doc = frame.contentDocument;
        if (!doc?.body) return;
        detach = attachElementPicker(doc, target => {
          onSelectElement?.(target);
          // One pick per activation: staying armed would swallow the next click
          // on a story the user is trying to actually use.
          setPicking(false);
        });
      } catch {
        // Cross-origin only happens if the preview is proxied from elsewhere;
        // selection is an enhancement, so fail quiet rather than break the pane.
        setPicking(false);
      }
    };

    attach();
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      detach?.();
    };
  }, [picking, onSelectElement]);

  // A rebuild replaces the document; leaving the picker armed across it would
  // attach to a document that no longer exists.
  useEffect(() => { if (busy) setPicking(false); }, [busy]);

  const cycleZoom = useCallback(() => {
    setZoom(z => (z >= 1 ? 0.5 : z >= 0.75 ? 1 : z + 0.25));
  }, []);

  return (
    <div className="suiw-canvas">
      <Flex align="center" gap="3" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a5)' }}>
        <SegmentedControl.Root size="1" value={viewport} onValueChange={v => setViewport(v as Viewport)}>
          {(Object.keys(VIEWPORTS) as Viewport[]).map(v => (
            <SegmentedControl.Item key={v} value={v}>
              {VIEWPORTS[v].label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>

        <Button size="1" variant="ghost" color="gray" onClick={cycleZoom} title="Zoom">
          {Math.round(scale * 100)}%
        </Button>

        <Flex flexGrow="1" minWidth="0" justify="center">
          {title && <Text size="1" color="gray" className="suiw-ellipsis">{title}</Text>}
        </Flex>

        {onSelectElement && (
          <Button
            size="1"
            variant={picking ? 'solid' : hasSelection ? 'soft' : 'ghost'}
            color={picking || hasSelection ? undefined : 'gray'}
            highContrast={picking}
            disabled={!storyId || busy}
            onClick={() => {
              if (picking) { setPicking(false); return; }
              // Starting a new pick clears the old one, so the chip in the
              // composer never disagrees with what is highlighted.
              onSelectElement(null);
              setPicking(true);
            }}
            title="Point at an element to describe a change to just that element"
          >
            {picking ? 'Click an element…' : hasSelection ? 'Selected' : 'Select'}
          </Button>
        )}

        {historySlot}

        <Button size="1" variant="ghost" color="gray" disabled={!storyId} onClick={onOpenInStorybook}>
          Open in Storybook
        </Button>
        {/* highContrast: solid-on-accent-9 measures 3.15:1 for this accent,
            under AA. See the Build button in Workspace.tsx. */}
        <Button
          size="1"
          highContrast
          disabled={!storyId || !canHandoff}
          onClick={onHandoff}
          title={
            !canHandoff
              ? 'Generate or update a story in this session to hand it off'
              : 'Commit this story to a new branch'
          }
        >
          Hand off
        </Button>
      </Flex>

      <div className="suiw-stage" ref={stageRef}>
        {src ? (
          <div
            className={`suiw-frame${busy ? ' suiw-frame--stale' : ''}`}
            style={{ width: spec.w * scale, height: spec.h * scale }}
          >
            {/* Rendered at true viewport size and scaled down, so the story sees
                the media queries it would see at that width. Scaling the
                container instead would lie about breakpoints. */}
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
        ) : busy ? (
          <Flex direction="column" align="center" gap="2">
            <Badge color="orange" variant="soft">
              <span className="suiw-pulse">Building</span>
            </Badge>
            <Text size="2" color="gray">
              It appears here as soon as the story is written and indexed.
            </Text>
          </Flex>
        ) : notIndexed ? (
          // The generation SUCCEEDED. Saying "nothing to preview" here read as
          // failure and sent the user hunting for a bug in the wrong place.
          <Callout.Root color="amber" size="1" style={{ maxWidth: 520 }}>
            <Callout.Text>
              <Text weight="medium">Your story was created, but Storybook has not picked it up.</Text>
              <br />
              {notIndexed.fileName ? `${notIndexed.fileName} is on disk. ` : 'The file is on disk. '}
              Storybook&rsquo;s file watcher stops delivering events after a while, and when that
              happens new stories never enter its index. Restarting Storybook picks it up.
            </Callout.Text>
            {onRecheck && (
              <Flex mt="2">
                <Button size="1" variant="soft" color="amber" onClick={onRecheck}>
                  Check again
                </Button>
              </Flex>
            )}
          </Callout.Root>
        ) : (
          <Flex direction="column" align="center" gap="1" style={{ maxWidth: '44ch' }}>
            <Text size="2" color="gray">Nothing to preview yet</Text>
            <Text size="1" color="gray" align="center">
              Describe what you want on the left, and it renders here using your own components.
            </Text>
          </Flex>
        )}
      </div>
    </div>
  );
};

export default PreviewCanvas;
