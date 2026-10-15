import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const require = createRequire(import.meta.url);
const { ChatGPTAuth, LOGIN_TIMEOUT_MS } = require('../app/chatgpt-auth.cjs');
const sessions: any[] = [];
const servers: Server[] = [];
afterEach(async () => { sessions.splice(0).forEach(session => session.cancel()); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function fixture({ consent = true, nonceCorrect = true, identityCorrect = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'personal-auth-'));
  const encryptionKey = randomBytes(32);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' };
  let opened: URL | null = null;
  let refreshes = 0;
  let codeExchanges = 0;
  let lastRefresh = '';
  let refreshError = false;
  let malformedRefresh = false;
  let revokedToken = '';
  let opens = 0;
  let exchangeRedirect: string | null = null;
  const storage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptStringAsync: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28));
      return { result: Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString() }; },
  };
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    if (input.endsWith('/.well-known/openid-configuration')) return reply({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
      token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (input.endsWith('/.well-known/jwks.json')) return reply({ keys: [jwk] });
    if (input.endsWith('/revoke')) { revokedToken = new URLSearchParams(String(init.body)).get('token')!; return new Response(null, { status: 200 }); }
    if (input.endsWith('/oauth/token')) {
      const fields = new URLSearchParams(String(init.body));
      if (fields.get('grant_type') === 'refresh_token') {
        refreshes++; lastRefresh = fields.get('refresh_token')!;
        await new Promise(resolve => setTimeout(resolve, 10));
        if (malformedRefresh) return new Response('test-refresh-credential private-body NOT JSON', { status: 200 });
        return refreshError ? reply({ error: 'invalid_grant' }, 400) : reply({ access_token: 'replacement-access', refresh_token: 'replacement-refresh', expires_in: 3600 });
      }
      codeExchanges++;
      if (exchangeRedirect) return fetch(exchangeRedirect, init);
      const nonce = nonceCorrect ? opened!.searchParams.get('nonce') : 'wrong-nonce';
      const idToken = await new SignJWT({ nonce, email: 'local-test@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://auth.openai.com').setAudience(identityCorrect ? 'oaiapp_test' : 'wrong-audience').setSubject('test-account').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return reply({ access_token: 'test-access-credential', refresh_token: 'test-refresh-credential', id_token: idToken, expires_in: 3600,
        scope: consent ? 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct' : 'openid email profile' });
    }
    throw new Error('Unexpected upstream request');
  };
  const options = { dataDir: directory, storage, openExternal: async (url: string) => { opened = new URL(url); opens++; }, fetchImpl };
  const auth = new ChatGPTAuth(options); sessions.push(auth); await auth.start();
  const callback = async (state?: string) => {
    const url = new URL(opened!.searchParams.get('redirect_uri')!);
    url.searchParams.set('state', state ?? opened!.searchParams.get('state')!);
    url.searchParams.set('client_id', 'oaiapp_test'); url.searchParams.set('code', 'test-code');
    return fetch(url);
  };
  return { auth, options, storage, directory, callback, get opened() { return opened!; }, get refreshes() { return refreshes; }, get codeExchanges() { return codeExchanges; },
    get lastRefresh() { return lastRefresh; }, get revokedToken() { return revokedToken; }, get opens() { return opens; }, invalidateRefresh() { refreshError = true; },
    malformedRefresh() { malformedRefresh = true; }, redirectExchange(url: string) { exchangeRedirect = url; } };
}

describe('ChatGPT OAuth session', () => {
  it('validates browser authorization, encrypts credentials, and restores the same host after restart', async () => {
    const f = await fixture(); await f.auth.signIn();
    expect(f.opened.searchParams.get('code_challenge_method')).toBe('S256');
    expect((await f.callback()).status).toBe(200);
    expect(f.auth.status()).toMatchObject({ connected: true, sharing: true, pending: false });
    const token = await f.auth.token(); expect(token.accessToken).toBe('test-access-credential');
    const serialized = JSON.stringify(f.auth.status()); expect(serialized).not.toContain('test-access-credential'); expect(serialized).not.toContain('test-refresh-credential');
    const saved = readFileSync(join(f.directory, 'chatgpt', 'session.enc')).toString();
    expect(saved).not.toContain('test-access-credential'); expect(saved).not.toContain('test-refresh-credential');
    const host = readFileSync(join(f.directory, 'chatgpt', 'host.json'), 'utf8');
    const restarted = new ChatGPTAuth(f.options); sessions.push(restarted); await restarted.start();
    expect(restarted.status().sharing).toBe(true);
    expect(readFileSync(join(f.directory, 'chatgpt', 'host.json'), 'utf8')).toBe(host);
  });

  it('rejects a callback with the wrong state without exchanging a code', async () => {
    const f = await fixture(); await f.auth.signIn(); expect((await f.callback('wrong-state')).status).toBe(400);
    expect(f.codeExchanges).toBe(0); expect(f.auth.status().pending).toBe(true); expect(f.auth.status().sharing).toBe(false);
  });

  it.each([{ nonceCorrect: false }, { identityCorrect: false }])('rejects an unverified identity: %s', async options => {
    const f = await fixture(options); await f.auth.signIn(); expect((await f.callback()).status).toBe(400);
    expect(f.auth.status().sharing).toBe(false); await expect(f.auth.token()).rejects.toThrow();
  });

  it('requires subscription consent even when identity sign-in succeeds', async () => {
    const f = await fixture({ consent: false }); await f.auth.signIn(); await f.callback();
    expect(f.auth.status()).toMatchObject({ connected: true, sharing: false }); await expect(f.auth.token()).rejects.toThrow();
  });

  it('serializes concurrent refreshes and keeps the rotating replacement', async () => {
    const f = await fixture(); await f.auth.signIn(); await f.callback();
    const tokens = await Promise.all([f.auth.token(true), f.auth.token(true), f.auth.token(true)]);
    expect(f.refreshes).toBe(1); expect(tokens.every(token => token.accessToken === 'replacement-access')).toBe(true);
    await f.auth.token(true); expect(f.lastRefresh).toBe('replacement-refresh');
  });

  it('clears a revoked session without trying another billing path', async () => {
    const f = await fixture(); await f.auth.signIn(); await f.callback(); f.invalidateRefresh();
    await expect(f.auth.token(true)).rejects.toThrow(); expect(f.auth.status().connected).toBe(false);
    await expect(f.auth.token()).rejects.toThrow(); expect(f.refreshes).toBe(1);
  });

  it('revokes on sign-out and retains only the account registration', async () => {
    const f = await fixture(); await f.auth.signIn(); await f.callback(); await f.auth.signOut();
    expect(f.auth.status()).toMatchObject({ connected: false, sharing: false });
    const restarted = new ChatGPTAuth(f.options); sessions.push(restarted); await restarted.start();
    await restarted.signIn(); expect(f.opened.searchParams.get('client_id')).toBe('oaiapp_test');
  });

  it('does not expose a response fragment when token JSON is malformed', async () => {
    const f = await fixture(); await f.auth.signIn(); await f.callback(); f.malformedRefresh();
    let message = ''; try { await f.auth.invoke('refresh'); } catch (error) { message = String(error); }
    expect(message).toContain('回應格式不符'); expect(message).not.toContain('test-refresh-credential');
    expect(JSON.stringify(f.auth.status())).not.toContain('test-refresh-credential');
  });

  it('cancels during encryption without committing credentials and revokes the uncommitted grant', async () => {
    const f = await fixture(); await f.auth.signIn();
    const encrypt = f.storage.encryptStringAsync;
    let entered!: () => void; let release!: () => void;
    const atEncryption = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.storage.encryptStringAsync = async (text: string) => {
      if (JSON.parse(text).accessToken) { entered(); await gate; }
      return encrypt(text);
    };
    const callback = f.callback(); await atEncryption; f.auth.cancel(); release(); await callback;
    expect(f.auth.status().connected).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.revokedToken).toBe('test-refresh-credential');
    const restored = new ChatGPTAuth(f.options); sessions.push(restored); await restored.start();
    expect(restored.status().connected).toBe(false);
  });

  it('signs out during a rotation using the latest refresh token', async () => {
    const f = await fixture(); await f.auth.signIn(); await f.callback();
    const refresh = f.auth.token(true).catch(() => null); const logout = f.auth.signOut();
    await Promise.all([refresh, logout]); expect(f.revokedToken).toBe('replacement-refresh');
    expect(f.auth.status().sharing).toBe(false);
    const restored = new ChatGPTAuth(f.options); sessions.push(restored); await restored.start(); expect(restored.status().sharing).toBe(false);
  });

  it('opens only one authorization attempt for simultaneous sign-in requests', async () => {
    const f = await fixture(); await Promise.all([f.auth.signIn(), f.auth.signIn(), f.auth.signIn()]);
    expect(f.opens).toBe(1); expect(f.auth.status().pending).toBe(true); expect((await f.callback()).status).toBe(200);
  });

  it('accepts authorization after a user spends more than five minutes on the official page', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await f.auth.signIn();
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(f.auth.status().pending).toBe(true);
      expect((await f.callback()).status).toBe(200);
      expect(f.auth.status().sharing).toBe(true);
    } finally { f.auth.cancel(); vi.useRealTimers(); }
  });

  it('expires the authorization window without exchanging a code', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await f.auth.signIn();
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
      expect(f.auth.status()).toMatchObject({ pending: false, sharing: false, error: '登入已逾時，請重新登入。' });
      expect(f.codeExchanges).toBe(0);
      await expect(f.callback()).rejects.toThrow();
    } finally { f.auth.cancel(); vi.useRealTimers(); }
  });

  it('fails closed when OS encryption is unavailable', async () => {
    const f = await fixture(); f.storage.isAsyncEncryptionAvailable = async () => false;
    await f.auth.signIn(); expect((await f.callback()).status).toBe(400); expect(f.auth.status().connected).toBe(false);
    expect(f.codeExchanges).toBe(0);
  });

  it('never forwards the authorization code or PKCE verifier through a redirect', async () => {
    const f = await fixture(); let forwarded = 0;
    const destination = createServer((_req, res) => { forwarded++; res.end('{}'); }); servers.push(destination);
    await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve));
    const redirect = createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${(destination.address() as { port: number }).port}/capture` }); res.end(); }); servers.push(redirect);
    await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve));
    f.redirectExchange(`http://127.0.0.1:${(redirect.address() as { port: number }).port}/token`);
    await f.auth.signIn(); expect((await f.callback()).status).toBe(400); expect(forwarded).toBe(0);
    expect(f.auth.status().connected).toBe(false);
  });
});
