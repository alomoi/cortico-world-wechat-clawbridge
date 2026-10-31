/**
 * WorldDefinition：默认配置、预检、实例工厂和自描述。
 * create() 必须保持纯：不读凭据、不建目录、不发起网络请求。
 */
import { DEFAULTS, EVENT_MESSAGE, ID, LABEL } from './config.js';
import { CLAWBOT_TOOL_DECLS, ClawbotWorld } from './world.js';

const TOOL_SUMMARIES = {
  clawbridge_send: {
    zh: '回复最近一条微信消息；只能发给刚发消息的人。',
    en: 'Reply to the latest WeChat message; sends only to the person who just wrote.',
  },
  clawbridge_status: {
    zh: '查看微信 ClawBridge 连接、账号、最近消息和错误。',
    en: 'Show the WeChat ClawBridge connection, account, last message and errors.',
  },
  clawbridge_events: {
    zh: '按类型和时间查已归档的微信事件。',
    en: 'Read archived WeChat events by kind and time.',
  },
};

function describeTools(decls) {
  return decls.map(({ name, description, parameters, tags }) => ({
    name,
    description,
    parameters,
    tags,
    summary: TOOL_SUMMARIES[name],
  }));
}

export const clawbotDefinition = {
  id: ID,
  label: LABEL,
  defaults: () => structuredClone(DEFAULTS),
  preflight: () => {
    if (typeof fetch !== 'function') throw new Error('微信小龙虾需要 Node 22+ 的 fetch。');
    if (typeof structuredClone !== 'function') {
      throw new Error('微信小龙虾需要 Node 22+ 的 structuredClone。');
    }
  },
  create: (ctx) => new ClawbotWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    timezone: ctx.timezone,
  }),
  describe: {
    tools: describeTools(CLAWBOT_TOOL_DECLS),
    events: [
      {
        type: EVENT_MESSAGE,
        description: {
          zh: '一条微信私聊消息；正文是可读的一行，meta.raw 是精简后的信封（无媒体凭证，媒体凭 msgId 另存）。',
          en: 'A WeChat 1:1 message; text is a readable line and meta.raw is a slimmed envelope without media credentials (media is stored under its msgId).',
        },
        trigger: 'debounce',
      },
    ],
  },
};

export default clawbotDefinition;
