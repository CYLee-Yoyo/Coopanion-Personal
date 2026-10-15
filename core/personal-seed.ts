/** New personal deployments start on the subscription provider with separate storage and no telemetry. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from 'cortico/core/language.ts';
import { CHATGPT_BASE_URL, CHATGPT_ENDPOINT, CHATGPT_KIND } from 'cortico-provider-coo/src/chatgpt/types.ts';
import { DEPLOYMENT, seed } from './seed.ts';

export function seedPersonal(home: string, language: Language): void {
  const file = join(home, DEPLOYMENT, 'config.json');
  const fresh = !existsSync(file);
  seed(home, language);
  if (!fresh) return;
  const directory = join(home, 'providers', CHATGPT_ENDPOINT);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ kind: CHATGPT_KIND, baseUrl: CHATGPT_BASE_URL, pricing: [], multimodal: true }, null, 2));
  const config = JSON.parse(readFileSync(file, 'utf8'));
  config.activeProvider = CHATGPT_ENDPOINT;
  config.companion = { ...config.companion, telemetry: false };
  writeFileSync(file, JSON.stringify(config, null, 2));
}
