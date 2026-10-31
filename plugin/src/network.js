/**
 * 出站网络出口。
 *
 * inherit 交给 Coopanion 的 --use-env-proxy（系统/环境代理）；
 * direct 用独立的 undici Agent 绕过代理；proxy 用显式 HTTP/HTTPS 代理。
 */
import { Agent, ProxyAgent } from 'undici';

export function createDispatcher({ mode = 'inherit', proxyUrl = '', forceIpv4 = false } = {}) {
  if (mode === 'inherit') return null;

  const connect = {
    timeout: 10000,
    ...(forceIpv4 === true ? { family: 4 } : {}),
  };
  if (mode === 'direct') return new Agent({ connect });
  if (mode === 'proxy') {
    const proxy = String(proxyUrl ?? '').trim();
    if (!proxy) throw new Error('proxy 模式需要填写 proxyUrl');
    if (!/^https?:\/\//i.test(proxy)) throw new Error('proxyUrl 只支持 http:// 或 https://');
    return new ProxyAgent({ uri: proxy, connect });
  }
  throw new Error(`未知 networkMode: ${mode}`);
}

export async function closeDispatcher(dispatcher) {
  if (!dispatcher || typeof dispatcher.close !== 'function') return;
  try {
    await dispatcher.close();
  } catch {
    /* 关闭失败不影响 World 停止。 */
  }
}
