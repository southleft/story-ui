import { describe, it, expect } from 'vitest';
import { pickWorkspaceBounds } from '../templates/StoryUIV2/managerBounds';

const vp = { width: 1440, height: 900 };
describe('workspace bounds inside the manager', () => {
  it('uses the content cell when it has size', () => {
    expect(pickWorkspaceBounds({ left: 300, top: 0, width: 1140, height: 900 }, { left: 1440, top: 900, width: 0, height: 0 }, vp))
      .toEqual({ left: 300, top: 0, width: 1140, height: 900 });
  });
  it('falls back to the wrapper, then the viewport, when the sidebar-anchored wrapper is collapsed', () => {
    expect(pickWorkspaceBounds(null, { left: 300, top: 0, width: 1140, height: 900 }, vp).width).toBe(1140);
    expect(pickWorkspaceBounds(null, { left: 1440, top: 900, width: 0, height: 0 }, vp)).toEqual({ left: 0, top: 0, width: 1440, height: 900 });
  });
});
