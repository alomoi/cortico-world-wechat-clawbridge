/**
 * 部署数据目录里的 iLink 凭据与游标。
 *
 * 目录是 <dataDir>/clawbot：
 *   auth.json             bot_token、baseUrl、bot 账号、微信用户
 *   sync.json             get_updates_buf
 *   context-tokens.json   from_user_id → context_token
 *
 * bot_token 和 context_token 都是凭据，不写进 config.json，也不进日志。
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const msg = (err) => (err instanceof Error ? err.message : String(err));

export class ILinkStore {
  #dir;
  #log;

  constructor(dir, log = null) {
    this.#dir = dir;
    this.#log = log;
  }

  get dir() {
    return this.#dir;
  }

  #path(name) {
    return join(this.#dir, name);
  }

  async #readJson(name) {
    try {
      return JSON.parse(await readFile(this.#path(name), 'utf8'));
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#log?.warn?.('ilink: 状态文件读不出来，按空状态继续', {
          file: this.#path(name),
          error: msg(err),
        });
      }
      return null;
    }
  }

  async #writeJson(name, value) {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#path(name);
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
    try {
      await chmod(file, 0o600);
    } catch {
      /* Windows 不保证 chmod，凭据文件仍在自己的部署目录里。 */
    }
  }

  async loadAuth() {
    const data = await this.#readJson('auth.json');
    const token = String(data?.token ?? '').trim();
    if (!token) return null;
    return {
      token,
      baseUrl: String(data?.baseUrl ?? '').trim(),
      accountId: String(data?.accountId ?? '').trim(),
      userId: String(data?.userId ?? '').trim(),
      savedAt: String(data?.savedAt ?? ''),
    };
  }

  async saveAuth(auth) {
    await this.#writeJson('auth.json', {
      token: String(auth?.token ?? ''),
      baseUrl: String(auth?.baseUrl ?? ''),
      accountId: String(auth?.accountId ?? ''),
      userId: String(auth?.userId ?? ''),
      savedAt: auth?.savedAt || new Date().toISOString(),
    });
  }

  async clearAuth() {
    await rm(this.#path('auth.json'), { force: true });
  }

  async loadSyncBuf() {
    const data = await this.#readJson('sync.json');
    return typeof data?.get_updates_buf === 'string' ? data.get_updates_buf : '';
  }

  async saveSyncBuf(value) {
    await this.#writeJson('sync.json', { get_updates_buf: String(value ?? '') });
  }

  async loadContextTokens() {
    const data = await this.#readJson('context-tokens.json');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const tokens = {};
    for (const [userId, token] of Object.entries(data)) {
      if (typeof token === 'string' && token) tokens[userId] = token;
    }
    return tokens;
  }

  async saveContextToken(userId, token) {
    const tokens = await this.loadContextTokens();
    tokens[String(userId)] = String(token);
    await this.#writeJson('context-tokens.json', tokens);
    return Object.keys(tokens).length;
  }

  async getContextToken(userId) {
    const tokens = await this.loadContextTokens();
    return tokens[String(userId)] ?? '';
  }

  async clearContextTokens() {
    await rm(this.#path('context-tokens.json'), { force: true });
  }

  async clearSession() {
    await Promise.all([
      this.clearAuth(),
      this.clearContextTokens(),
      rm(this.#path('sync.json'), { force: true }),
    ]);
  }
}
