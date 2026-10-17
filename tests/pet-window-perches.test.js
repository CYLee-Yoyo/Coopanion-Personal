import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPet } from '../packages/cortico-world-desktop-pet/web/kit/body.js';
import { cooFigure, defaultSkin } from '../packages/cortico-world-desktop-pet/web/coo/coo.js';
const { projectWindowSurfaces } = createRequire(import.meta.url)('../packages/cortico-world-desktop-pet/host/window-surfaces.cjs');

function scene(options = {}) {
  const element = () => ({ setAttribute() {}, innerHTML: '' });
  const events = [];
  const bounds = { W: 1200, H: 900, floorY: 880, S: .42, surfaces: [
    { id: 'floating', x: 200, y: 420, width: 600, originX: 200 },
  ] };
  const pet = createPet({ petG: element(), shadowEl: element(), fxG: element() }, {
    sfx: { play() {} }, onEvent: (kind, detail) => events.push({ kind, ...detail }),
    figure: cooFigure(), skin: defaultSkin(), roam: 'off', bounds: () => bounds, ...options,
  });
  const run = seconds => { for (let i = 0; i < seconds * 120; i++) { pet.step(1 / 120); pet.render(); } };
  const fall = (x = 500, y = 300) => { Object.assign(pet.pet, { x, fy: y, mode: 'air', vy: 1, vx: 0, airKind: 'drop' }); run(1); };
  const until = (predicate, seconds = 35, dt = 1 / 120) => {
    for (let i = 0; i < seconds / dt; i++) {
      if (predicate()) return;
      pet.step(dt); pet.render();
    }
    throw new Error(`Body condition was not reached: ${pet.pet.mode}`);
  };
  pet.render();
  return { pet, bounds, run, fall, until, events };
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

describe('autonomous jumps down from window tops', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(.001); });
  afterEach(() => { vi.restoreAllMocks(); });
  function perched(side = -1, options = {}) {
    const s = scene(options);
    s.bounds.surfaces = [{ id: 'floating', x: side === -1 ? 200 : 0, y: 420,
      width: side === -1 ? 1000 : 800, originX: side === -1 ? 200 : 0 }];
    s.pet.resize(); s.fall(); s.pet.setRoam('free'); s.pet.holdRoam(8);
    return s;
  }

  it.each([[-1, 30], [1, 30], [-1, 60], [1, 60], [-1, 120], [1, 120]])(
    'approaches side %s, hops clear, and lands on the desktop at %s fps', (side, fps) => {
      const s = perched(side), dt = 1 / fps, top = s.bounds.surfaces[0];
      s.until(() => s.pet.pet.mode === 'descend-walk', 35, dt);
      expect(s.pet.pet.fy).toBe(top.y);
      s.until(() => s.pet.pet.mode === 'descend-crouch', 35, dt);
      expect(Math.abs(s.pet.pet.x - (side === -1 ? top.x : top.x + top.width))).toBeLessThan(40);
      s.until(() => s.pet.pet.mode === 'air', 35, dt);
      expect(s.pet.pet.vy).toBeLessThan(0);
      expect(Math.sign(s.pet.pet.vx)).toBe(side);
      s.until(() => s.pet.pet.fy > top.y, 5, dt);
      expect(side === -1 ? s.pet.pet.x < top.x : s.pet.pet.x > top.x + top.width).toBe(true);
      s.until(() => s.pet.pet.mode === 'land', 5, dt);
      expect(s.pet.pet.fy).toBe(s.bounds.floorY);
      expect(s.pet.busy()).toBe(false);
    });

  it('lands on the first lower window in the jump path', () => {
    const s = perched(); s.bounds.surfaces[0].width = 600;
    s.bounds.surfaces.push({ id: 'lower', x: 0, y: 650, width: 1200, originX: 0 }); s.pet.resize();
    s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.until(() => s.pet.pet.mode === 'land');
    expect(s.pet.pet.fy).toBe(650);
  });

  it('follows the window during the approach and recomputes takeoff after a move', () => {
    const s = perched(); s.until(() => s.pet.pet.mode === 'descend-walk'); s.run(.5);
    s.bounds.surfaces = [{ id: 'floating', x: 280, y: 450, width: 600, originX: 280 }]; s.pet.resize();
    expect(s.pet.pet.fy).toBe(450);
    s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.bounds.surfaces = [{ id: 'floating', x: 300, y: 430, width: 600, originX: 300 }]; s.pet.resize();
    s.until(() => s.pet.pet.mode === 'air');
    s.until(() => s.pet.pet.fy > 430, 5);
    expect(s.pet.pet.x).toBeLessThan(300);
    s.until(() => s.pet.pet.mode === 'land', 5);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it.each(['quiet', 'listening', 'dialog', 'roam-off'])('cancels preparation when %s starts', change => {
    let dialogOpen = false;
    const s = perched(-1, { dialogOpen: () => dialogOpen });
    s.until(() => s.pet.pet.mode === (change === 'quiet' || change === 'dialog' ? 'descend-walk' : 'descend-crouch'));
    if (change === 'quiet') s.pet.holdRoam(30);
    if (change === 'listening') s.pet.setListening(true);
    if (change === 'dialog') dialogOpen = true;
    if (change === 'roam-off') s.pet.setRoam('off');
    s.run(.6);
    expect(s.pet.pet.mode).toBe('idle');
    expect(s.pet.pet.fy).toBe(420);
  });

  it('falls normally if the supporting window disappears during preparation', () => {
    const s = perched(); s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.bounds.surfaces = []; s.pet.resize(); s.pet.setRoam('off'); s.run(2);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('cancels takeoff when a resize leaves no space beyond the selected edge', () => {
    const s = perched(1); s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.bounds.surfaces = [{ id: 'floating', x: 0, y: 420, width: 1200, originX: 0 }];
    s.pet.resize(); expect(s.pet.pet.mode).toBe('idle'); s.pet.holdRoam(30); s.run(.6);
    expect(s.pet.pet.mode).toBe('idle'); expect(s.pet.pet.fy).toBe(420);
  });

  it('walks to a resized edge before taking off instead of jumping from the old edge', () => {
    const s = perched(1); s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.bounds.surfaces = [{ id: 'floating', x: 0, y: 420, width: 1000, originX: 0 }]; s.pet.resize();
    expect(s.pet.pet.mode).toBe('descend-walk'); expect(s.pet.pet.fy).toBe(420);
    s.until(() => s.pet.pet.mode === 'descend-crouch'); expect(s.pet.pet.x).toBeGreaterThan(950);
    s.until(() => s.pet.pet.mode === 'air'); s.until(() => s.pet.pet.fy > 420, 5);
    expect(s.pet.pet.x).toBeGreaterThan(1000);
    s.until(() => s.pet.pet.mode === 'land', 5); expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('stays supported when neither side has room for a downward jump', () => {
    const s = perched();
    s.bounds.surfaces = [{ id: 'floating', x: 0, y: 420, width: 1200, originX: 0 }]; s.pet.resize();
    s.run(30);
    expect(s.events.some(e => e.mode === 'descend-walk')).toBe(false);
    expect(s.pet.pet.fy).toBeLessThanOrEqual(420);
  });

  it('finishes the flight if roaming is switched off after takeoff', () => {
    const s = perched(); s.until(() => s.pet.pet.mode === 'air'); s.pet.setRoam('off');
    s.until(() => s.pet.pet.mode === 'land', 5);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('can jump back up and later leave the window again while roaming', () => {
    const s = perched();
    s.until(() => s.pet.pet.mode === 'descend-crouch');
    s.until(() => s.pet.pet.mode === 'land'); expect(s.pet.pet.fy).toBe(s.bounds.floorY);
    s.until(() => s.pet.pet.mode === 'land' && s.pet.pet.fy === 420, 80);
    s.until(() => s.pet.pet.mode === 'descend-crouch', 80);
    s.until(() => s.pet.pet.mode === 'land'); expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });
});

describe('autonomous jumps between window tops', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(.001); });
  afterEach(() => { vi.restoreAllMocks(); });
  function neighbors(side = 1, y = 500, options = {}) {
    const s = scene(options);
    s.bounds.surfaces = [
      { id: 'source', x: 300, y: 500, width: 400, originX: 300 },
      { id: 'neighbor', x: side === 1 ? 750 : 0, y, width: side === 1 ? 350 : 250, originX: side === 1 ? 750 : 0 },
    ];
    s.pet.resize(); s.fall(500, 300); s.pet.setRoam('free'); s.pet.holdRoam(8);
    s.pet.pet.lastAct = 'descend';
    return s;
  }

  it.each([-1, 1].flatMap(side => [390, 500, 650].flatMap(y => [30, 60, 120].map(fps => [side, y, fps]))))(
    'approaches side %s and jumps to a neighboring top at y=%s at %s fps', (side, y, fps) => {
      const s = neighbors(side, y), dt = 1 / fps;
      s.until(() => s.pet.pet.mode === 'perch-walk', 35, dt);
      expect(s.pet.layout()).toMatchObject({ busy: true, moving: true });
      expect(s.pet.pet.fy).toBe(500);
      s.until(() => s.pet.pet.mode === 'perch-crouch', 35, dt);
      expect(Math.abs(s.pet.pet.x - (side === 1 ? 700 : 300))).toBeLessThan(40);
      s.until(() => s.pet.pet.mode === 'air', 5, dt);
      expect(Math.sign(s.pet.pet.vx)).toBe(side);
      s.until(() => s.pet.pet.mode === 'land', 5, dt);
      const target = s.bounds.surfaces[1];
      expect(s.pet.pet.fy).toBe(y);
      expect(s.pet.pet.x).toBeGreaterThan(target.x);
      expect(s.pet.pet.x).toBeLessThan(target.x + target.width);
    });

  it('replans moving windows and walks to a resized takeoff edge before jumping', () => {
    const s = neighbors(); s.until(() => s.pet.pet.mode === 'perch-walk');
    s.bounds.surfaces = structuredClone(s.bounds.surfaces);
    const [source, target] = s.bounds.surfaces;
    source.x += 30; source.originX += 30; source.y += 20;
    target.x += 50; target.originX += 50; target.y += 40;
    s.pet.resize(); expect(s.pet.pet.fy).toBe(520);
    s.until(() => s.pet.pet.mode === 'perch-crouch');
    source.width += 40; s.pet.resize();
    expect(s.pet.pet.mode).toBe('perch-walk');
    s.until(() => s.pet.pet.mode === 'perch-crouch');
    expect(s.pet.pet.x).toBeGreaterThan(730);
    s.until(() => s.pet.pet.mode === 'land'); expect(s.pet.pet.fy).toBe(540);
  });

  it.each(['removed', 'narrowed', 'unreachable', 'blocked'])(
    'cancels takeoff when the destination is %s', change => {
      const s = neighbors(1, 650); s.until(() => s.pet.pet.mode === 'perch-crouch');
      s.bounds.surfaces = structuredClone(s.bounds.surfaces);
      if (change === 'removed') s.bounds.surfaces.pop();
      if (change === 'narrowed') s.bounds.surfaces[1].width = 50;
      if (change === 'unreachable') s.bounds.surfaces[1].x = 3000;
      if (change === 'blocked') s.bounds.surfaces.push({ id: 'obstruction', x: 710, y: 550, width: 300, originX: 710 });
      s.pet.resize(); expect(s.pet.pet.mode).toBe('idle');
      s.pet.setRoam('off'); s.run(1);
      expect(s.pet.pet.fy).toBe(500);
    });

  it.each(['quiet', 'listening', 'dialog', 'roam-off'])('cancels preparation when %s starts', change => {
    let dialogOpen = false;
    const s = neighbors(1, 500, { dialogOpen: () => dialogOpen });
    s.until(() => s.pet.pet.mode === (change === 'quiet' || change === 'dialog' ? 'perch-walk' : 'perch-crouch'));
    if (change === 'quiet') s.pet.holdRoam(30);
    if (change === 'listening') s.pet.setListening(true);
    if (change === 'dialog') dialogOpen = true;
    if (change === 'roam-off') s.pet.setRoam('off');
    s.run(.6);
    expect(s.pet.pet.mode).toBe('idle'); expect(s.pet.pet.fy).toBe(500);
  });

  it('lands naturally when its destination disappears after takeoff', () => {
    const s = neighbors(); s.until(() => s.pet.pet.mode === 'air');
    s.bounds.surfaces.pop(); s.pet.resize(); s.pet.setRoam('off');
    s.until(() => s.pet.pet.mode === 'land', 5);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('can return to the first window after the roaming cooldown', () => {
    const s = neighbors(); s.until(() => s.pet.pet.mode === 'perch-walk');
    s.until(() => s.pet.pet.mode === 'land'); expect(s.pet.pet.fy).toBe(500);
    expect(s.pet.pet.x).toBeGreaterThan(750);
    s.pet.holdRoam(25); s.run(24.8);
    s.pet.pet.lastAct = 'descend'; s.pet.pet.nextAt = 0;
    s.until(() => s.pet.pet.mode === 'perch-walk');
    s.until(() => s.pet.pet.mode === 'land');
    expect(s.pet.pet.fy).toBe(500); expect(s.pet.pet.x).toBeLessThan(700);
  });
});

describe('autonomous window-side climbing', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(.001); });
  afterEach(() => { vi.restoreAllMocks(); });
  function climbingScene(side = -1, options = {}) {
    const s = scene(options);
    s.bounds.surfaces = projectWindowSurfaces([
      { id: 'floating', perch: true, rect: { x: 200, y: 420, width: 600, height: 460 } },
    ], { x: 0, y: 0, width: 1200, height: 880 });
    s.bounds.surfaces[0].edges = s.bounds.surfaces[0].edges.filter(e => e.side === side);
    s.pet.pet.x = side === -1 ? 400 : 600;
    s.pet.resize(); s.pet.setRoam('free'); s.pet.holdRoam(8);
    return s;
  }

  it.each([-1, 1])('walks to side %s, climbs with alternating legs, and pulls onto the same window', side => {
    const s = climbingScene(side);
    s.until(() => s.pet.pet.mode === 'climb-walk');
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
    s.until(() => s.pet.pet.mode === 'climb');
    expect(s.pet.layout()).toMatchObject({ busy: true, moving: true });
    const edge = s.bounds.surfaces[0].edges[0];
    expect((s.pet.pet.x - edge.x) * side).toBeGreaterThan(0);
    expect(s.pet.pet.facing).toBe(-side);
    const y = s.pet.pet.fy;
    s.run(.2); const legs = structuredClone(s.pet.pet.feet);
    expect(s.pet.pet.fy).toBeLessThan(y);
    expect(s.pet.pet.fy).toBeGreaterThan(420);
    s.run(.4);
    expect(s.pet.pet.feet).not.toEqual(legs);
    s.until(() => s.pet.pet.mode === 'mantle');
    expect(s.pet.pet.fy).toBeGreaterThan(420);
    s.until(() => s.pet.pet.mode === 'land');
    expect(s.pet.pet.fy).toBe(420);
    expect(s.pet.pet.x).toBeGreaterThan(208);
    expect(s.pet.pet.x).toBeLessThan(792);
    expect(s.pet.busy()).toBe(false);
  });

  it('follows a moving window throughout the ascent and pull-over', () => {
    const s = climbingScene(); s.until(() => s.pet.pet.mode === 'climb'); s.run(1);
    const before = { x: s.pet.pet.x, y: s.pet.pet.fy };
    s.bounds.surfaces = structuredClone(s.bounds.surfaces);
    let surface = s.bounds.surfaces[0];
    surface.x += 100; surface.originX += 100; surface.y -= 80;
    surface.edges[0].x += 100; surface.edges[0].bottom -= 80;
    s.pet.resize();
    expect(s.pet.pet.x).toBeCloseTo(before.x + 100);
    expect(s.pet.pet.fy).toBeCloseTo(before.y - 80);
    s.until(() => s.pet.pet.mode === 'mantle'); s.run(.2);
    s.bounds.surfaces = structuredClone(s.bounds.surfaces); surface = s.bounds.surfaces[0];
    surface.y += 40; surface.edges[0].bottom += 40; s.pet.resize();
    s.until(() => s.pet.pet.mode === 'land');
    expect(s.pet.pet.fy).toBe(surface.y);
  });

  it.each(['removed', 'occluded', 'shortened', 'scaled'])('drops when its climbing edge is %s', change => {
    const s = climbingScene(); s.until(() => s.pet.pet.mode === 'climb'); s.run(.4);
    const y = s.pet.pet.fy;
    if (change === 'removed') s.bounds.surfaces = [];
    if (change === 'occluded') s.bounds.surfaces[0].edges = [];
    if (change === 'shortened') s.bounds.surfaces[0].edges[0].bottom = 500;
    if (change === 'scaled') s.bounds.S *= 1.2;
    s.pet.resize();
    expect(s.pet.pet.mode).toBe('air');
    expect(s.pet.pet.fy).toBe(y);
    s.pet.setRoam('off'); s.run(2);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it.each(['quiet', 'listening', 'dialog', 'roam-off'])('cancels a climb when %s starts', change => {
    let dialogOpen = false;
    const s = climbingScene(-1, { dialogOpen: () => dialogOpen });
    s.until(() => s.pet.pet.mode === 'climb'); s.run(.4);
    if (change === 'quiet') s.pet.holdRoam(30);
    if (change === 'listening') s.pet.setListening(true);
    if (change === 'dialog') dialogOpen = true;
    if (change === 'roam-off') s.pet.setRoam('off');
    s.run(.1);
    expect(s.pet.pet.mode).toBe('air');
    s.run(2); expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('waits for a roaming hold and cancels an approach on dialog without leaving the floor', () => {
    let dialogOpen = false;
    const s = climbingScene(-1, { dialogOpen: () => dialogOpen });
    s.pet.holdRoam(20); s.run(12);
    expect(s.events.some(e => e.mode === 'climb-walk')).toBe(false);
    s.until(() => s.pet.pet.mode === 'climb-walk');
    dialogOpen = true; s.run(.1);
    expect(s.pet.pet.mode).toBe('idle');
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('allows a real pointer to pick the pet up mid-climb and release it normally', () => {
    const s = climbingScene(); s.until(() => s.pet.pet.mode === 'climb'); s.run(.6);
    const { x, y } = s.pet.layout().side;
    expect(s.pet.pointerDown({ x, y, t: 0 })).toBe(true);
    expect(s.pet.pet.mode).toBe('drag');
    s.pet.setRoam('off'); s.pet.pointerUp({ x, y, t: 1 }); s.run(2);
    expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('falls from a removed edge during the pull-over instead of finishing in mid-air', () => {
    const s = climbingScene(); s.until(() => s.pet.pet.mode === 'mantle'); s.run(.3);
    const y = s.pet.pet.fy; s.bounds.surfaces = []; s.pet.resize();
    expect(s.pet.pet.mode).toBe('air'); expect(s.pet.pet.fy).toBe(y);
    s.pet.setRoam('off'); s.run(2); expect(s.pet.pet.fy).toBe(s.bounds.floorY);
  });

  it('keeps jumping available when a floating window side cannot be reached from the ground', () => {
    const s = climbingScene(); s.bounds.surfaces[0].edges[0].bottom = 500; s.pet.resize();
    s.until(() => s.pet.pet.mode === 'land');
    expect(s.events.some(e => CLIMB_MODES.includes(e.mode))).toBe(false);
    expect(s.events.some(e => e.mode === 'crouch')).toBe(true);
    expect(s.pet.pet.fy).toBe(420);
  });
});

const CLIMB_MODES = ['climb-walk', 'climb', 'mantle'];
