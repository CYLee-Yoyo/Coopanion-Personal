import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('upgrades old console names while preserving model, appearance, permissions and private files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'personal-upgrade-'));
    seedPersonal(directory, 'zh-Hant');
    const deploy = join(directory, DEPLOYMENT);
    const file = join(deploy, 'config.json');
    const config = { displayName: 'Fixture companion', language: 'zh-Hant', activeProvider: CHATGPT_ENDPOINT,
      web: { port: CONSOLE_PORT, theme: 'fixture-scheme' }, companion: { telemetry: false }, logging: { console: 'warn', file: 'error' },
      worlds: { terminal: { enabled: true }, 'desktop-pet': { skin: { figure: 'whale', scheme: 'fixture-scheme' },
        windowPerches: { enabled: true }, cua: { enabled: true, control: true, permission: 'ask-once', grantMinutes: 45 } } } };
    writeFileSync(file, JSON.stringify(config));
    const endpoint = join(directory, 'providers', CHATGPT_ENDPOINT, 'config.json');
    const provider = { kind: CHATGPT_KIND, spec: { model: 'fixture-selected-model' }, multimodal: true };
    writeFileSync(endpoint, JSON.stringify(provider));
    const constitution = join(deploy, 'workspace', 'CONSTITUTION.md');
    writeFileSync(constitution, 'Fixture custom persona');
    const privateDir = join(directory, 'chatgpt'); mkdirSync(privateDir);
    const encrypted = join(privateDir, 'session.enc');
    const bytes = Buffer.from([1, 11, 23, 41, 53, 67]); writeFileSync(encrypted, bytes);
    seedPersonal(directory, 'en');
    const { terminal, ...worlds } = config.worlds;
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...config, worlds: { ...worlds, console: terminal }, logging: { stdout: 'warn', file: 'error' } });
    expect(JSON.parse(readFileSync(endpoint, 'utf8'))).toEqual(provider);
    expect(readFileSync(constitution, 'utf8')).toBe('Fixture custom persona');
    expect(readFileSync(encrypted)).toEqual(bytes);
  });
});
