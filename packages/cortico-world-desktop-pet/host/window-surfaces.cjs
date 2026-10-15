/** Read-only window geometry for the pet's one-way platforms. No window text or input is requested. */
const { randomUUID } = require('node:crypto');

/** Visible top segments and continuous side edges, in page DIPs; windows arrive from front to back. */
function projectWindowSurfaces(windows, area) {
  const surfaces = [], blockers = [];
  for (const window of windows) {
    const r = window.rect;
    const left = Math.max(0, r.x - area.x), right = Math.min(area.width, r.x + r.width - area.x);
    const y = r.y - area.y;
    if (window.perch && y > 0 && y < area.height && right - left > 24) {
      let spans = [[left + 8, right - 8]];
      for (const b of blockers) {
        if (b.y > r.y + 1 || b.y + b.height < r.y - 1) continue;
        const x0 = b.x - area.x - 2, x1 = x0 + b.width + 4;
        spans = spans.flatMap(([a, z]) => x1 <= a || x0 >= z ? [[a, z]]
          : [[a, Math.min(z, x0)], [Math.max(a, x1), z]].filter(([a, z]) => z - a >= 24));
      }
      const edges = [-1, 1].flatMap(side => {
        const x = r.x + (side === 1 ? r.width : 0);
        if (x <= area.x || x >= area.x + area.width) return [];
        let bottom = Math.min(r.y + r.height, area.y + area.height);
        for (const b of blockers) {
          if (x < b.x - 2 || x > b.x + b.width + 2 || b.y + b.height < r.y - 1) continue;
          bottom = Math.min(bottom, b.y - 2);
        }
        return bottom - r.y >= 24 ? [{ side, x: x - area.x, bottom: bottom - area.y }] : [];
      });
      for (const [x, end] of spans) if (end - x >= 24) surfaces.push({ id: window.id, x, y, width: end - x, originX: r.x - area.x,
        edges: edges.filter(e => Math.abs((e.side === -1 ? x : end) - (e.x - e.side * 8)) < .5) });
    }
    blockers.push(r);
  }
  return surfaces;
}

function createWindowSurfaceSource({ screen }) {
  const unavailable = { supported: false, read: () => [] };
  if (process.platform !== 'win32') return unavailable;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), dwm = koffi.load('dwmapi.dll');
    const callback = koffi.proto('int __stdcall PetSurfaceEnum(void *hwnd, intptr_t param)');
    const EnumWindows = user32.func('int __stdcall EnumWindows(PetSurfaceEnum *callback, intptr_t param)');
    const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hwnd)');
    const IsIconic = user32.func('int __stdcall IsIconic(void *hwnd)');
    const IsZoomed = user32.func('int __stdcall IsZoomed(void *hwnd)');
    const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(void *hwnd, int index)');
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, void *buffer, int max)');
    const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hwnd, void *rect)');
    const DwmGetWindowAttribute = dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, void *value, uint32_t size)');
    const desktop = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
    const ids = new Map();
    return {
      supported: true,
      read(ownWindow) {
        try {
          const handle = ownWindow.getNativeWindowHandle();
          const own = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
          const windows = [], seen = new Set();
          EnumWindows(hwnd => {
            const address = koffi.address(hwnd);
            if (address === own || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
            const ex = GetWindowLongW(hwnd, -20);
            // Transparent overlays and utility windows have no usable solid top edge.
            if (ex & (0x80 | 0x20 | 0x08000000)) return 1;
            const cloaked = Buffer.alloc(4);
            if (DwmGetWindowAttribute(hwnd, 14, cloaked, 4) === 0 && cloaked.readUInt32LE()) return 1;
            const name = Buffer.alloc(128);
            if (GetClassNameW(hwnd, name, 64) && desktop.has(name.toString('utf16le').split('\0')[0])) return 1;
            const frame = Buffer.alloc(16);
            if (DwmGetWindowAttribute(hwnd, 9, frame, 16) !== 0 && !GetWindowRect(hwnd, frame)) return 1;
            const rect = { x: frame.readInt32LE(0), y: frame.readInt32LE(4),
              width: frame.readInt32LE(8) - frame.readInt32LE(0), height: frame.readInt32LE(12) - frame.readInt32LE(4) };
            if (rect.width <= 0 || rect.height <= 0) return 1;
            seen.add(address);
            if (!ids.has(address)) ids.set(address, randomUUID());
            const style = GetWindowLongW(hwnd, -16);
            windows.push({ id: ids.get(address), rect: screen.screenToDipRect(ownWindow, rect),
              perch: !IsZoomed(hwnd) && !!(style & (0x00c00000 | 0x00040000)) });
            return windows.length < 512 ? 1 : 0;
          }, 0);
          for (const address of ids.keys()) if (!seen.has(address)) ids.delete(address);
          return projectWindowSurfaces(windows, ownWindow.getBounds());
        } catch { return []; }
      },
    };
  } catch { return unavailable; }
}

module.exports = { createWindowSurfaceSource, projectWindowSurfaces };
