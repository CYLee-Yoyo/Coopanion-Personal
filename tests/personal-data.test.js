import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const { pinnedDataDirectory } = createRequire(import.meta.url)('../app/personal-data.cjs');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'personal-location-')); roots.push(root);
  return { root, location: join(root, 'location.json'), first: join(root, 'first'), second: join(root, 'second') };
}

describe('personal data location', () => {
  it('keeps the first physical directory when another launch supplies a different AppData path', () => {
    const f = fixture();
    const first = pinnedDataDirectory(f.first, f.location);
    writeFileSync(join(first, 'settings.json'), '{"roam":"free"}');
    const second = pinnedDataDirectory(f.second, f.location);
    expect(second).toBe(first); expect(second).toBe(realpathSync.native(f.first));
    expect(JSON.parse(readFileSync(join(second, 'settings.json'), 'utf8'))).toEqual({ roam: 'free' });
  });

  it('uses an explicitly restored directory without modifying either profile', () => {
    const f = fixture(); mkdirSync(f.second); mkdirSync(f.first);
    writeFileSync(f.location, JSON.stringify({ directory: f.second }));
    writeFileSync(join(f.first, 'settings.json'), 'first'); writeFileSync(join(f.second, 'settings.json'), 'restored');
    expect(pinnedDataDirectory(f.first, f.location)).toBe(f.second);
    expect(readFileSync(join(f.first, 'settings.json'), 'utf8')).toBe('first');
    expect(readFileSync(join(f.second, 'settings.json'), 'utf8')).toBe('restored');
  });

  it.each(['missing', 'relative', 'file', 'malformed'])('stops for a %s pinned location instead of seeding a blank profile', kind => {
    const f = fixture();
    if (kind === 'file') writeFileSync(f.second, 'not a directory');
    writeFileSync(f.location, kind === 'malformed' ? '{' : JSON.stringify({ directory: kind === 'relative' ? 'relative-profile' : f.second }));
    expect(() => pinnedDataDirectory(f.first, f.location)).toThrow();
  });
});
