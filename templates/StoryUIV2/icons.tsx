/**
 * The workspace's icons: 16px, stroke-based, currentColor, aria-hidden.
 *
 * Inline rather than an icon package: the manager bundle inlines every
 * dependency, and fourteen paths do not justify one. Named for what they
 * mean in this UI, not for what they draw.
 */
import React from 'react';

type IconProps = { size?: number; strokeWidth?: number };

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ size = 16, strokeWidth = 1.75, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ flex: '0 0 auto' }}
  >
    {children}
  </svg>
);

/** Storybook's sidebar. */
export const PanelLeftIcon: React.FC<IconProps> = p => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Svg>
);

export const ChevronDownIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);

/** Components. */
export const GridIcon: React.FC<IconProps> = p => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </Svg>
);

export const PlusIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

/** Select an element. */
export const CursorIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M5 3l14 8-6.5 1.5L10 19z" /></Svg>
);

/** Version history. */
export const ClockIcon: React.FC<IconProps> = p => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);

export const MaximizeIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></Svg>
);

export const MinimizeIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" /></Svg>
);

export const MicIcon: React.FC<IconProps> = p => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </Svg>
);

export const GearIcon: React.FC<IconProps> = p => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

/** Send. */
export const ArrowUpIcon: React.FC<IconProps> = p => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2.25}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>
);

/** Stop. Filled, so it reads as a stop square rather than an outline. */
export const StopIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: '0 0 auto' }}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const ExternalLinkIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Svg>
);

export const SearchIcon: React.FC<IconProps> = p => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
);

export const XIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);

/** A document chip. */
export const FileIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>
);

/** The conversation, for the folded rail. */
export const ChevronRightIcon: React.FC<IconProps> = p => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);
