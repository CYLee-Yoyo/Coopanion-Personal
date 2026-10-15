import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { projectWindowSurfaces } = createRequire(import.meta.url)('../packages/cortico-world-desktop-pet/host/window-surfaces.cjs');

const area = { x: -1200, y: 100, width: 1200, height: 800 };
const window = (id, x, y, width, height, perch = true) => ({ id, rect: { x, y, width, height }, perch });

describe('visible window-top geometry', () => {
  it('projects negative display coordinates and clips edges to the pet display', () => {
    const surfaces = projectWindowSurfaces([window('floating', -1300, 350, 500, 300)], area);
    expect(surfaces).toEqual([{ id: 'floating', x: 8, y: 250, width: 384, originX: -100 }]);
  });

  it('removes covered top segments in front-to-back order while retaining uncovered edges', () => {
    const surfaces = projectWindowSurfaces([
      window('front', -800, 200, 300, 500), window('back', -1100, 400, 1000, 350),
    ], area);
    expect(surfaces.filter(s => s.id === 'back')).toEqual([
      { id: 'back', x: 108, y: 300, width: 290, originX: 100 },
      { id: 'back', x: 702, y: 300, width: 390, originX: 100 },
    ]);
  });

  it('lets a maximized or full-screen foreground occlude ledges without becoming a ledge', () => {
    expect(projectWindowSurfaces([
      window('covering', -1200, 100, 1200, 800, false), window('back', -1000, 400, 600, 300),
    ], area)).toEqual([]);
  });

  it('does not use a window on another display or a top edge outside the work area', () => {
    expect(projectWindowSurfaces([window('other', 100, 400, 600, 300)], area)).toEqual([]);
    expect(projectWindowSurfaces([window('above', -1200, 50, 900, 500)], area)).toEqual([]);
  });
});
