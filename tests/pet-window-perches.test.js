import { describe, expect, it, vi } from 'vitest';
import { createPet } from '../packages/cortico-world-desktop-pet/web/kit/body.js';
import { cooFigure, defaultSkin } from '../packages/cortico-world-desktop-pet/web/coo/coo.js';

function scene(options = {}) {
  const element = () => ({ setAttribute() {}, innerHTML: '' });
  const bounds = { W: 1200, H: 900, floorY: 880, S: .42, surfaces: [
    { id: 'floating', x: 200, y: 420, width: 600, originX: 200 },
  ] };
  const pet = createPet({ petG: element(), shadowEl: element(), fxG: element() }, {
    sfx: { play() {} }, figure: cooFigure(), skin: defaultSkin(), roam: 'off', bounds: () => bounds, ...options,
  });
  const run = seconds => { for (let i = 0; i < seconds * 120; i++) { pet.step(1 / 120); pet.render(); } };
  const fall = (x = 500, y = 300) => { Object.assign(pet.pet, { x, fy: y, mode: 'air', vy: 1, vx: 0, airKind: 'drop' }); run(1); };
  pet.render();
  return { pet, bounds, run, fall };
}

describe('window-top body physics', () => {
  it('catches a descending body on a visible top and keeps walking on that ledge', () => {
    const s = scene(); s.fall();
    expect(s.pet.pet.fy).toBe(420);
    s.pet.walkTo(1150, true, 1); s.run(4);
    expect(s.pet.pet.fy).toBe(420);
    expect(s.pet.pet.x).toBeLessThan(800);
    expect(s.pet.pet.x).toBeGreaterThan(750);
  });

  it('passes upward through a top edge and catches the returning jump', () => {
    const s = scene();
    Object.assign(s.pet.pet, { x: 500, fy: 500, mode: 'air', vy: -1000, vx: 0, airKind: 'jump' });
    s.run(.15);
    expect(s.pet.pet.fy).toBeLessThan(420);
    expect(s.pet.pet.mode).toBe('air');
    s.run(1);
    expect(s.pet.pet.fy).toBe(420);
  });

  it('lands on a window after a real pointer drag and release', () => {
    const s = scene(); s.pet.pet.x = 500; s.pet.render();
    const side = s.pet.layout().side;
    expect(s.pet.pointerDown({ x: side.x, y: side.y, t: 0 })).toBe(true);
    s.pet.pointerMove({ x: side.x + 30, y: side.y - 20, t: 250 });
    s.pet.pointerMove({ x: 500, y: 300, t: 700 }); s.run(.6);
    s.pet.pointerMove({ x: 500, y: 300, t: 1500 }); s.run(.3);
    s.pet.pointerMove({ x: 500, y: 300, t: 1900 });
    s.pet.pointerUp({ x: 500, y: 300, t: 1901 }); s.run(1);
    expect(s.pet.pet.fy).toBe(420);
  });

  it('does not pull a body upward when it is dropped below the top edge', () => {
    const s = scene(); s.fall(500, 500);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('follows a moved ledge in page coordinates and falls when it disappears', () => {
    const s = scene(); s.fall();
    s.bounds.surfaces = [{ id: 'floating', x: 300, y: 500, width: 600, originX: 300 }];
    s.pet.resize();
    expect(s.pet.pet.x).toBe(600);
    expect(s.pet.pet.fy).toBe(500);
    s.bounds.surfaces = []; s.pet.resize();
    expect(s.pet.pet.mode).toBe('air');
    expect(s.pet.pet.fy).toBe(500);
    s.run(1);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('falls if resizing or occlusion removes the supported part of the ledge', () => {
    for (const surface of [
      { id: 'floating', x: 200, y: 420, width: 120, originX: 200 },
      { id: 'floating', x: 700, y: 420, width: 100, originX: 200 },
    ]) {
      const s = scene(); s.fall(); s.bounds.surfaces = [surface]; s.pet.resize(); s.run(1);
      expect(s.pet.pet.fy).toBe(s.bounds.floorY);
    }
  });

  it('lands on a lower window after its supporting window disappears', () => {
    const s = scene(); s.fall();
    s.bounds.surfaces = [{ id: 'lower', x: 200, y: 600, width: 600, originX: 200 }];
    s.pet.resize(); s.run(1);
    expect(s.pet.pet.fy).toBe(600);
  });

  it('uses the first visible top crossed, including fast downward motion', () => {
    const s = scene();
    s.bounds.surfaces.push({ id: 'higher', x: 200, y: 250, width: 600, originX: 200 });
    s.pet.resize();
    Object.assign(s.pet.pet, { x: 500, fy: 200, mode: 'air', vy: 2000, vx: 0 });
    s.pet.step(.1);
    expect(s.pet.pet.fy).toBe(250);
  });

  it('rejects ledges too high or narrow for the figure size', () => {
    const s = scene();
    s.bounds.S = 2;
    s.pet.resize(); s.fall();
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('autonomously jumps onto a window while roaming after a roaming hold ends', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(.001);
    try {
      const s = scene(); s.pet.pet.x = 500; s.pet.setRoam('free');
      s.pet.holdRoam(20); s.run(12);
      expect(s.pet.pet.fy).toBe(s.bounds.floorY);
      s.run(14);
      expect(s.pet.pet.fy).toBe(420);
    } finally { random.mockRestore(); }
  });

  it('does not autonomously jump during a dialog, listening, or disabled roaming', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(.001);
    try {
      const dialog = scene({ dialogOpen: () => true });
      dialog.pet.pet.x = 500; dialog.pet.setRoam('free'); dialog.run(30);
      expect(dialog.pet.pet.fy).toBe(dialog.bounds.floorY);
      const listening = scene(); listening.pet.pet.x = 500;
      listening.pet.setRoam('free'); listening.pet.setListening(true); listening.run(30);
      expect(listening.pet.pet.fy).toBe(listening.bounds.floorY);
      const still = scene(); still.pet.pet.x = 500; still.run(30);
      expect(still.pet.pet.fy).toBe(still.bounds.floorY);
    } finally { random.mockRestore(); }
  });

  it('retains the original floor-only behavior when no surfaces are provided', () => {
    const s = scene(); delete s.bounds.surfaces; s.pet.resize(); s.fall();
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });
});
