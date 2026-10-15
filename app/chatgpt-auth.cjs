/** ChatGPT OAuth credentials belong to the Electron main process and are encrypted at rest. */
const { createServer } = require('node:http');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const USAGE_URL = 'https://chatgpt.com/settings/usage';
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const REFRESH_ERRORS = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const OAUTH_ERRORS = new Set([...REFRESH_ERRORS, 'invalid_client', 'invalid_request', 'access_denied', 'unauthorized_client', 'invalid_scope', 'unsupported_grant_type']);
class AuthError extends Error { constructor(message, code) { super(message); this.code = code; } }
const safeAuthMessage = error => error instanceof AuthError ? error.message : 'ChatGPT 登入服務發生錯誤，請重試。';
const validBearer = value => typeof value === 'string' && value.length <= 16_384 && /^[A-Za-z0-9._~+\/-]+=*$/.test(value);

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const opaque = () => randomBytes(32).toString('base64url');

class ChatGPTAuth {
  constructor({ dataDir, storage, openExternal, onChange = () => {}, fetchImpl = fetch }) {
    this.dir = join(dataDir, 'chatgpt');
    this.file = join(this.dir, 'session.enc');
    this.storage = storage;
    this.openExternal = openExternal;
    this.onChange = onChange;
    this.fetch = fetchImpl;
    this.profile = {};
    this.pending = null;
    this.error = null;
    this.refreshing = null;
    this.signingOut = false;
    this.signingIn = null;
    this.loggingOut = null;
    this.writing = Promise.resolve();
    this.epoch = 0;
    this.startAbort = null;
  }

  async start() {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new AuthError('TLS 驗證已停用，拒絕載入 ChatGPT 登入憑證。');
    mkdirSync(this.dir, { recursive: true });
    const hostFile = join(this.dir, 'host.json');
    if (!existsSync(hostFile)) writeFileSync(hostFile, JSON.stringify({ hostId: `urn:uuid:${randomUUID()}` }), { mode: 0o600 });
    this.hostId = JSON.parse(readFileSync(hostFile, 'utf8')).hostId;
    if (existsSync(this.file)) {
      try {
        const plain = await this.storage.decryptStringAsync(readFileSync(this.file));
        const profile = JSON.parse(plain.result);
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)
          || (profile.accessToken && (!validBearer(profile.accessToken) || !validBearer(profile.refreshToken)
            || !Array.isArray(profile.scopes) || !profile.scopes.every(scope => typeof scope === 'string') || !Number.isFinite(profile.expiresAtMs))))
          throw new AuthError('Invalid stored credential');
        this.profile = profile;
      } catch {
        // Preserve the encrypted file when Windows temporarily cannot decrypt it.
        this.error = '無法讀取已保存的登入。請重新使用 ChatGPT 登入。';
      }
    }
    return this.status();
  }

  status() {
    const connected = Boolean(this.profile.accessToken && this.profile.refreshToken && !this.signingOut && !this.pending && !this.signingIn);
    return { connected, sharing: connected && (this.profile.scopes ?? []).includes('chatgpt.tokens.use.direct'),
      email: this.profile.identity?.email ?? null, pending: Boolean(this.pending || this.signingIn), error: this.error,
      account: this.profile.accountKey ?? null };
  }

  changed() { this.onChange(this.status()); }

  async save(profile = this.profile, guard = () => true, committed = () => {}) {
    const snapshot = structuredClone(profile);
    const operation = this.writing.then(async () => {
      if (!await this.storage.isAsyncEncryptionAvailable()) throw new AuthError('Windows 憑證加密目前無法使用，未保存登入。');
      const encrypted = await this.storage.encryptStringAsync(JSON.stringify(snapshot));
      if (!guard()) throw new AuthError('登入操作已取消。');
      writeFileSync(`${this.file}.tmp`, encrypted, { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
      this.profile = snapshot;
      committed();
    });
    this.writing = operation.catch(() => {});
    return operation;
  }

  async discovery(signal) {
    const response = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    if (!response.ok) throw new AuthError(`ChatGPT 登入服務無法使用（${response.status}）。`);
    const config = await response.json();
    if (config.issuer !== ISSUER) throw new AuthError('ChatGPT 登入服務的 issuer 不符。');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
      if (!config[key] && key === 'revocation_endpoint') continue;
      const url = new URL(config[key]);
      if (url.origin !== ISSUER || url.username || url.password) throw new AuthError('ChatGPT 登入服務的端點不符。');
    }
    return config;
  }

  async tokenRequest(url, fields, signal) {
    const response = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    let data;
    try { data = await response.json(); } catch { throw new AuthError('ChatGPT 授權服務回應格式不符。'); }
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      const error = new AuthError(`ChatGPT 授權失敗（${OAUTH_ERRORS.has(code) ? code : response.status}）。`, OAUTH_ERRORS.has(code) ? code : undefined);
      throw error;
    }
    if (!validBearer(data.access_token) || (data.refresh_token && !validBearer(data.refresh_token)) || !Number.isFinite(data.expires_in) || data.expires_in <= 0)
      throw new AuthError('ChatGPT 授權回應缺少有效憑證。');
    return data;
  }

  async signIn() {
    if (this.pending || this.signingOut) return this.status();
    if (this.signingIn) return this.signingIn;
    const epoch = ++this.epoch;
    this.startAbort = new AbortController();
    const operation = this.beginSignIn(epoch).catch(error => {
      if (epoch === this.epoch) this.error = safeAuthMessage(error);
      throw new AuthError(safeAuthMessage(error));
    }).finally(() => { this.signingIn = null; this.changed(); });
    this.signingIn = operation;
    this.changed();
    return operation;
  }

  async beginSignIn(epoch) {
    if (this.refreshing) await this.refreshing.catch(() => {});
    const config = await this.discovery(this.startAbort.signal);
    if (epoch !== this.epoch) throw new AuthError('登入已取消。');
    const attempt = { state: opaque(), nonce: opaque(), verifier: opaque(), config, clientId: this.profile.clientId, handling: false, abort: new AbortController() };
    const server = createServer((req, res) => void this.callback(attempt, req, res).catch(() => { if (!res.writableEnded) res.end(); }));
    attempt.server = server;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (epoch !== this.epoch) { server.close(); throw new AuthError('登入已取消。'); }
    attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    attempt.timer = setTimeout(() => { if (this.pending === attempt) { this.cancel(); this.error = '登入已逾時，請重新登入。'; this.changed(); } }, LOGIN_TIMEOUT_MS);
    attempt.timer.unref();
    this.pending = attempt;
    this.error = null;
    const url = new URL(config.authorization_endpoint);
    const parameters = { response_type: 'code', client_id: attempt.clientId ?? 'dynamic_agent_client', ext_agent_host_id: this.hostId,
      redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') };
    if (!attempt.clientId) parameters.agent_name_hint = 'Coopanion Personal';
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    this.changed();
    try { await this.openExternal(url.href); }
    catch { this.cancel(); throw new AuthError('無法開啟系統瀏覽器，請重試登入。'); }
    return this.status();
  }

  async callback(attempt, req, res) {
    const reply = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
      res.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Coopanion Personal</title><body><h1>Coopanion Personal</h1><p>${text}</p></body></html>`);
    };
    let url;
    try { if (req.url.length > 16_384) throw new AuthError(); url = new URL(req.url, attempt.redirectUri); }
    catch { reply(400, '此登入回呼無效。'); return; }
    if (req.method !== 'GET' || url.pathname !== '/auth/callback' || req.headers.host !== new URL(attempt.redirectUri).host
      || this.pending !== attempt || attempt.handling || !equal(url.searchParams.get('state'), attempt.state)) {
      reply(400, '此登入回呼無效。請回到 Coopanion Personal 重新登入。'); return;
    }
    attempt.handling = true;
    let received;
    let committed = false;
    try {
      if (url.searchParams.has('error')) throw new AuthError('你已取消 ChatGPT 授權。');
      const returnedId = url.searchParams.get('client_id');
      if ((attempt.clientId && returnedId && returnedId !== attempt.clientId) || (!attempt.clientId && !returnedId))
        throw new AuthError('ChatGPT 登入回應的 client ID 不符。');
      const code = url.searchParams.get('code');
      if (!code) throw new AuthError('ChatGPT 登入回應缺少授權碼。');
      const clientId = attempt.clientId ?? returnedId;
      // The issued registration survives an expired code; tokens are not replaced yet.
      if (!attempt.clientId) await this.save({ ...this.profile, clientId }, () => this.pending === attempt);
      const data = await this.tokenRequest(attempt.config.token_endpoint, { grant_type: 'authorization_code', client_id: clientId,
        code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }, attempt.abort.signal);
      received = { ...data, clientId };
      const jwksResponse = await this.fetch(attempt.config.jwks_uri, { redirect: 'error', signal: AbortSignal.any([attempt.abort.signal, AbortSignal.timeout(20_000)]) });
      if (!jwksResponse.ok) throw new AuthError('無法驗證 ChatGPT 登入身分。');
      const { jwtVerify, createLocalJWKSet } = await import('jose');
      const { payload } = await jwtVerify(data.id_token, createLocalJWKSet(await jwksResponse.json()), { issuer: ISSUER, audience: clientId, requiredClaims: ['exp', 'sub', 'nonce'] });
      if (!equal(payload.nonce, attempt.nonce) || typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('ChatGPT 登入身分驗證失敗。');
      if (attempt.clientId && this.profile.identity?.sub && payload.sub !== this.profile.identity.sub) throw new AuthError('請使用原本連線的 ChatGPT 帳號登入。');
      if (!data.refresh_token) throw new AuthError('ChatGPT 授權缺少可更新的登入憑證。');
      if (this.pending !== attempt) throw new AuthError('登入已取消。');
      const next = { clientId, identity: { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }, accountKey: this.profile.accountKey ?? randomUUID(), accessToken: data.access_token,
        refreshToken: data.refresh_token, idToken: data.id_token, scopes: String(data.scope ?? '').split(' '), expiresAtMs: Date.now() + data.expires_in * 1000 };
      await this.save(next, () => this.pending === attempt && !this.signingOut, () => { committed = true; });
      this.error = next.scopes.includes('chatgpt.tokens.use.direct') ? null : '已登入，但尚未授權使用 ChatGPT 訂閱額度。請重新登入並勾選授權。';
      reply(200, '登入已完成。請回到 Coopanion Personal 選擇模型並測試訂閱連線。');
    } catch (error) {
      if (this.pending === attempt) this.error = safeAuthMessage(error);
      reply(400, '登入未完成。請回到 Coopanion Personal 查看狀態並重試。');
    } finally {
      if (received?.refresh_token && !committed) await this.revoke(received.refresh_token, received.clientId, attempt.config);
      if (this.pending === attempt) this.cancel();
    }
  }

  cancel() {
    this.epoch++;
    this.startAbort?.abort();
    const attempt = this.pending;
    this.pending = null;
    if (attempt) { clearTimeout(attempt.timer); attempt.abort.abort(); attempt.server.close(); }
    this.changed();
    return this.status();
  }

  async token(force = false) {
    if (!this.status().sharing) throw new AuthError('請登入 ChatGPT 並授權使用訂閱額度。');
    if (force || Date.now() >= this.profile.expiresAtMs - 90_000) {
      if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.status().sharing) throw new AuthError('ChatGPT 登入已失效，請重新登入。');
    return { accessToken: this.profile.accessToken, account: this.status().account };
  }

  async refresh() {
    const previous = this.profile;
    try {
      const config = await this.discovery();
      const data = await this.tokenRequest(config.token_endpoint, { grant_type: 'refresh_token', client_id: previous.clientId,
        refresh_token: previous.refreshToken, resource: RESOURCE });
      if (this.profile !== previous) throw new AuthError('ChatGPT 連線已變更。');
      const next = { ...previous, accessToken: data.access_token, refreshToken: data.refresh_token ?? previous.refreshToken,
        idToken: data.id_token ?? previous.idToken, scopes: data.scope ? data.scope.split(' ') : previous.scopes, expiresAtMs: Date.now() + data.expires_in * 1000 };
      await this.save(next, () => this.profile === previous);
      this.error = null;
      this.changed();
    } catch (error) {
      if (REFRESH_ERRORS.has(error.code) && this.profile === previous) {
        await this.save({ clientId: previous.clientId, identity: previous.identity, accountKey: previous.accountKey });
        this.error = 'ChatGPT 登入已失效，請重新登入。';
        this.changed();
      }
      throw new AuthError(safeAuthMessage(error));
    }
  }

  async signOut() {
    if (this.loggingOut) return this.loggingOut;
    this.signingOut = true;
    this.cancel();
    this.changed();
    this.loggingOut = this.endSession().finally(() => { this.signingOut = false; this.loggingOut = null; this.changed(); });
    return this.loggingOut;
  }

  async revoke(refreshToken, clientId, config) {
    try {
      const discovery = config ?? await this.discovery();
      if (!discovery.revocation_endpoint) return false;
      const response = await this.fetch(discovery.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
      return response.ok;
    } catch { return false; }
  }

  async endSession() {
    if (this.refreshing) await this.refreshing.catch(() => {});
    await this.writing;
    const previous = this.profile;
    const revoked = !previous.refreshToken || await this.revoke(previous.refreshToken, previous.clientId);
    const next = { clientId: previous.clientId, identity: previous.identity, accountKey: previous.accountKey };
    try { await this.save(next); }
    catch {
      this.profile = next;
      rmSync(this.file, { force: true }); rmSync(`${this.file}.tmp`, { force: true });
    }
    this.error = revoked ? null : '已在本機登出；未確認遠端撤銷，請到 ChatGPT 用量設定中解除連線。';
    return this.status();
  }

  async invoke(method) {
    try { return await this.operation(method); }
    catch (error) { throw new AuthError(safeAuthMessage(error)); }
  }

  async operation(method) {
    if (method === 'status') return this.status();
    if (method === 'signin') return this.signIn();
    if (method === 'cancel') return this.cancel();
    if (method === 'signout') return this.signOut();
    if (method === 'token') return this.token();
    if (method === 'refresh') return this.token(true);
    if (method === 'usage') { await this.openExternal(USAGE_URL); return { ok: true }; }
    throw new AuthError('Unknown ChatGPT operation');
  }
}

module.exports = { ChatGPTAuth, LOGIN_TIMEOUT_MS };
