import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedPersonal } from '../core/personal-seed.ts';
import { CONSOLE_PORT, DEPLOYMENT } from '../core/seed.ts';
import { CHATGPT_ENDPOINT, CHATGPT_KIND } from 'cortico-provider-coo/src/chatgpt/types.ts';

describe('personal deployment', () => {
  it('starts with the subscription provider and preserves user settings on later starts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'personal-seed-'));
    seedPersonal(directory, 'zh-Hant');
    const file = join(directory, DEPLOYMENT, 'config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    expect(config).toMatchObject({ activeProvider: CHATGPT_ENDPOINT, web: { port: CONSOLE_PORT }, companion: { telemetry: false } });
    const entry = JSON.parse(readFileSync(join(directory, 'providers', CHATGPT_ENDPOINT, 'config.json'), 'utf8'));
    expect(entry.kind).toBe(CHATGPT_KIND); expect(entry).not.toHaveProperty('secret');
    config.displayName = 'My Coo'; writeFileSync(file, JSON.stringify(config)); seedPersonal(directory, 'en');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(config);
  });
});
