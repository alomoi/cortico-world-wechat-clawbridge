/**
 * 控制台「微信绑定」面板（浏览器侧 ES 模块）。
 *
 * 只使用 ctx.ui 和 ctx.invoke；服务端方法见 world.js 的 #invokePanel。
 * 表情别名表走 ctx.setConfig 写回框架配置面。
 * 二维码由服务端生成 data URL，这里只负责显示。
 */

/** 必须与 plugin/src/config.js 的 `ID` 一致（面板是独立 ES 模块，不能 import 服务端代码）。 */
const WORLD_ID = 'clawbridge';

const ZH = {
  title: '微信绑定',
  desc: '用手机微信扫码，把这个微信号的 ClawBot 接到这里。',
  status: '状态',
  network: '网络出口',
  account: '账号',
  user: '微信用户',
  last: '最近消息',
  contextTokens: '可用会话',
  unbound: '未绑定',
  binding: '等待扫码',
  requesting: '正在连接 iLink…',
  loadingQr: '正在生成二维码…',
  wait: '等待扫码',
  scaned: '已扫码，等待确认',
  needCode: '需要在手机上输入数字',
  connected: '已连接',
  connecting: '连接中',
  error: '连接异常',
  start: '生成二维码',
  restart: '重新生成',
  cancel: '取消',
  reconnect: '重新连接',
  reconnecting: '正在重新连接…',
  verify: '提交',
  codeLabel: '手机显示的数字',
  codePlaceholder: '输入验证码',
  qrAlt: '微信 ClawBot 登录二维码',
  qrLink: '二维码打不开时，复制这个链接：',
  noQr: '点「生成二维码」，然后用手机微信扫描。',
  bound: '已绑定；关掉面板不会断开连接。',
  loading: '读取中…',
  bad: '读不到绑定状态',
  sent: '已提交',
  mediaEmpty: '还没有收到图片。',
  mediaBad: '读不到图片列表',
  mediaRefresh: '刷新',
  mediaSending: '（发送时用的是原图）',
  mediaTitle: '收到的图片',
  mediaDesc: '微信发来的图片，按时间倒序；缩略图只用于查看，发出去的是原图。',
  emoteTitle: '微信表情',
  emoteDesc: '把她的表情换成微信原生表情，并在两边之间翻译名字。'
    + '打开时：她写「害羞」发出去就是微信的[害羞]，你发来的[破涕为笑]她会读到「笑哭了」；'
    + '她写的名字微信没有，会退成圆括号旁白，比如「（歪头看鱼）」，内容不丢。'
    + '关掉时：一切按原来的 Unicode 表情走，不翻译。',
  emoteOn: '启用微信表情转换',
  emoteOnTitle: '关掉后她的表情恢复成 😳 这样的 Unicode 符号，别名表也不再起作用。',
  emoteHow: '怎么用：下表和开关一起保存。左边填微信里的名字，右边填她内部用的名字，两列都要带方括号。'
    + '例如 [破涕为笑] → [笑哭了]：她写[笑哭了]发出去就是[破涕为笑]，你发[破涕为笑]她收到[笑哭了]。',
  emoteWechat: '微信名',
  emoteInner: '内部名',
  emoteAdd: '添加一行',
  emoteSave: '保存',
  emoteSaved: '已保存，下一句回复就生效。',
  emoteEmpty: '还没有别名。',
  emoteBad: '保存失败',
  emoteHint: '内置的 8 个表情（害羞、惊讶、得意、疑惑、困、开心、生气、害怕）不用写在这里，插件自己会换。',
  emoteNameBad: '两边都要写成 [名字] 的样子',
  errors: {
    verify_blocked: '验证码多次错误，请稍后再试。',
    expired: '二维码多次失效，请重新生成。',
    already_bound: '这个微信已经绑定过另一个客户端；请先在微信里解除绑定。',
    confirmed_incomplete: '微信确认了登录，但没有返回完整凭据。',
    qr_failed: '生成二维码失败。',
    poll_failed: '扫码轮询失败。',
  },
};

const EN = {
  title: 'WeChat binding',
  desc: 'Scan with WeChat to bind this ClawBot contact.',
  status: 'State',
  network: 'Network route',
  account: 'Account',
  user: 'WeChat user',
  last: 'Last message',
  contextTokens: 'Sessions',
  unbound: 'not bound',
  binding: 'waiting for scan',
  requesting: 'Connecting to iLink…',
  loadingQr: 'Generating QR…',
  wait: 'waiting for scan',
  scaned: 'scanned, confirm on the phone',
  needCode: 'enter the number shown on the phone',
  connected: 'connected',
  connecting: 'connecting',
  error: 'error',
  start: 'Generate QR',
  restart: 'Regenerate',
  cancel: 'Cancel',
  reconnect: 'Reconnect',
  reconnecting: 'Reconnecting…',
  verify: 'Submit',
  codeLabel: 'Number on the phone',
  codePlaceholder: 'Enter the code',
  qrAlt: 'WeChat ClawBot login QR code',
  qrLink: 'If the QR code does not open, copy this link:',
  noQr: 'Click Generate QR, then scan it with WeChat.',
  bound: 'Bound; closing the panel does not disconnect.',
  loading: 'Loading…',
  bad: 'Could not read the binding state',
  sent: 'Submitted',
  mediaEmpty: 'No images received yet.',
  mediaBad: 'Could not read the image list',
  mediaRefresh: 'Refresh',
  mediaSending: '(sending uses the original)',
  mediaTitle: 'Received images',
  mediaDesc: 'Images received from WeChat, newest first. Thumbnails are for viewing only; sending uses the original.',
  emoteTitle: 'WeChat emotes',
  emoteDesc: 'Turn her expressions into native WeChat emotes and translate names both ways. '
    + 'On: her "shy" leaves as [害羞], and an incoming [破涕为笑] reads to her as "笑哭了". '
    + 'A name WeChat does not have falls back to a parenthetical aside, e.g. (歪头看鱼), so nothing is lost. '
    + 'Off: everything stays Unicode, no translation.',
  emoteOn: 'Enable WeChat emote translation',
  emoteOnTitle: 'When off, her expressions go back to Unicode symbols like 😳 and the alias table is ignored.',
  emoteHow: 'How: the table and the switch are saved together. Left is the WeChat name, right is the name she uses internally; both need the brackets. '
    + 'Example [破涕为笑] → [笑哭了]: when she writes [笑哭了] it leaves as [破涕为笑], and when you send [破涕为笑] she reads [笑哭了].',
  emoteWechat: 'WeChat name',
  emoteInner: 'Internal name',
  emoteAdd: 'Add a row',
  emoteSave: 'Save',
  emoteSaved: 'Saved; takes effect on her next message.',
  emoteEmpty: 'No aliases yet.',
  emoteBad: 'Could not save',
  emoteHint: 'The 8 built-in expressions (shy, surprised, smug, confused, sleepy, happy, angry, scared) are already translated by the plugin; no need to list them here.',
  emoteNameBad: 'Both sides must look like [name]',
  errors: {
    verify_blocked: 'Too many wrong codes; try again later.',
    expired: 'The QR code expired repeatedly; generate a new one.',
    already_bound: 'This WeChat is bound to another client; unbind it in WeChat first.',
    confirmed_incomplete: 'WeChat confirmed the login but did not return complete credentials.',
    qr_failed: 'Could not generate the QR code.',
    poll_failed: 'QR status polling failed.',
  },
};

export default {
  panels: {
    binding: {
      mount: async (ctx) => {
        const { ui, root } = ctx;
        const zh = String(ctx.language ?? '').startsWith('zh');
        const S = zh ? ZH : EN;

        const card = ui.sheet({ title: S.title, desc: S.desc });
        const facts = ui.h('div');
        const message = ui.msgline();

        const qrSection = ui.section(S.title);
        const qrImage = ui.h('img');
        qrImage.alt = S.qrAlt;
        qrImage.style.width = '100%';
        qrImage.style.maxWidth = '320px';
        qrImage.style.display = 'none';
        const qrHint = ui.h('div', 'mono');
        qrHint.style.wordBreak = 'break-all';
        qrHint.style.fontSize = '12px';
        qrHint.style.opacity = '.72';
        const startButton = ui.button(S.start, { variant: 'primary', onClick: () => start() });
        const cancelButton = ui.button(S.cancel, { onClick: () => cancel() });
        cancelButton.style.display = 'none';
        const qrButtons = ui.rowbar();
        qrButtons.append(startButton, cancelButton);
        qrSection.append(qrImage, qrHint, qrButtons);

        const codeInput = ui.input({ placeholder: S.codePlaceholder, cls: 'mono' });
        const codeButton = ui.button(S.verify, { variant: 'primary', onClick: () => verify() });
        const codeSection = ui.section(S.needCode);
        const codeBar = ui.rowbar();
        codeBar.append(codeButton);
        codeSection.append(ui.field(S.codeLabel, codeInput), codeBar);
        codeSection.style.display = 'none';

        const boundNote = ui.msgline(S.bound);
        boundNote.style.display = 'none';
        const reconnectButton = ui.button(S.reconnect, { onClick: () => reconnect() });
        const reconnectBar = ui.rowbar();
        reconnectBar.append(reconnectButton);
        reconnectBar.style.display = 'none';

        card.body.append(facts, qrSection, codeSection, boundNote, reconnectBar, message);
        root.append(card.el);

        let current = null;

        function statusLabel(state) {
          if (state.loginStatus === 'requesting') return S.requesting;
          if (state.loginStatus === 'rendering') return S.loadingQr;
          if (state.loginStatus === 'need_verifycode') return S.needCode;
          if (state.loginStatus === 'scaned') return S.scaned;
          if (state.status === 'binding') return S.binding;
          if (state.status === 'connected') return S.connected;
          if (state.status === 'connecting') return S.connecting;
          if (state.status === 'error') return S.error;
          return S.unbound;
        }

        function render(state) {
          current = state;
          const account = state.accountId || '—';
          const user = state.userId || '—';
          const last = state.lastMessageAt ? state.lastMessageAt.slice(11, 19) : '—';
          facts.replaceChildren(ui.kv([
            { k: S.status, v: statusLabel(state) },
            { k: S.network, v: state.networkMode || '—' },
            { k: S.account, v: account },
            { k: S.user, v: user },
            { k: S.last, v: last },
            { k: S.contextTokens, v: String(state.contextTokens ?? 0) },
          ]));

          const binding = state.status === 'binding';
          const bound = state.bound;
          qrSection.style.display = bound ? 'none' : '';
          boundNote.style.display = bound ? '' : 'none';
          reconnectBar.style.display = bound ? '' : 'none';
          codeSection.style.display = state.loginStatus === 'need_verifycode' ? '' : 'none';

          if (binding && state.qrDataUrl) {
            qrImage.src = state.qrDataUrl;
            qrImage.style.display = '';
            qrHint.textContent = state.qrUrl ? `${S.qrLink}\n${state.qrUrl}` : '';
          } else {
            qrImage.removeAttribute('src');
            qrImage.style.display = 'none';
            qrHint.textContent = bound
              ? ''
              : (state.loginStatus === 'requesting'
                ? S.requesting
                : (state.loginStatus === 'rendering' ? S.loadingQr : S.noQr));
          }

          startButton.textContent = binding ? S.restart : S.start;
          startButton.style.display = bound ? 'none' : '';
          cancelButton.style.display = binding ? '' : 'none';

          const errorCode = state.loginErrorCode;
          const errorText = state.loginError
            || (errorCode ? (S.errors[errorCode] ?? '') : '');
          if (errorText) {
            message.textContent = errorText;
            message.classList.add('bad');
          } else if (message.classList.contains('bad')) {
            message.textContent = '';
            message.classList.remove('bad');
          }
        }

        async function load() {
          try {
            render(await ctx.invoke('state'));
          } catch (error) {
            message.textContent = `${S.bad}: ${String(error)}`;
            message.classList.add('bad');
          }
        }

        async function start() {
          const release = ui.disable(startButton);
          message.classList.remove('bad');
          message.textContent = S.loading;
          try {
            render(await ctx.invoke('start'));
            message.textContent = '';
          } catch (error) {
            message.textContent = String(error);
            message.classList.add('bad');
          } finally {
            release.dispose();
          }
        }

        async function verify() {
          const release = ui.disable(codeButton);
          try {
            render(await ctx.invoke('verify', [codeInput.value]));
            codeInput.value = '';
            message.textContent = S.sent;
            message.classList.remove('bad');
          } catch (error) {
            message.textContent = String(error);
            message.classList.add('bad');
          } finally {
            release.dispose();
          }
        }

        async function cancel() {
          try {
            render(await ctx.invoke('cancel'));
            message.textContent = '';
            message.classList.remove('bad');
          } catch (error) {
            message.textContent = String(error);
            message.classList.add('bad');
          }
        }

        async function reconnect() {
          const release = ui.disable(reconnectButton);
          message.classList.remove('bad');
          message.textContent = S.reconnecting;
          try {
            render(await ctx.invoke('reconnect'));
          } catch (error) {
            message.textContent = String(error);
            message.classList.add('bad');
          } finally {
            release.dispose();
          }
        }

        ctx.interval(() => { void load(); }, 2000);
        ctx.interval(() => { void ctx.refresh().catch(() => {}); }, 15000);
        await load();
      },
    },
    media: {
      mount: async (ctx) => {
        const { ui, root } = ctx;
        const zh = String(ctx.language ?? '').startsWith('zh');
        const S = zh ? ZH : EN;

        const card = ui.sheet({ title: S.mediaTitle, desc: S.mediaDesc });
        const grid = ui.h('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(132px, 1fr))';
        grid.style.gap = '10px';
        const message = ui.msgline();
        const refreshButton = ui.button(S.mediaRefresh, { onClick: () => { void load(); } });
        const bar = ui.rowbar();
        bar.append(refreshButton);

        card.body.append(grid, bar, message);
        root.append(card.el);

        function tile(item) {
          const box = ui.h('div');
          box.style.display = 'flex';
          box.style.flexDirection = 'column';
          box.style.gap = '4px';

          const img = ui.h('img');
          img.alt = item.name;
          img.style.width = '100%';
          img.style.aspectRatio = '1 / 1';
          img.style.objectFit = 'cover';
          img.style.borderRadius = '8px';
          img.style.background = 'rgba(127,127,127,.12)';
          if (item.thumb) img.src = item.thumb;

          const caption = ui.h('div', 'mono');
          caption.style.fontSize = '11px';
          caption.style.opacity = '.72';
          caption.style.wordBreak = 'break-all';
          const size = item.size >= 1024 * 1024
            ? `${(item.size / 1024 / 1024).toFixed(1)} MB`
            : `${Math.round(item.size / 1024)} KB`;
          const when = String(item.at ?? '').slice(5, 16).replace('T', ' ');
          caption.textContent = `${when} · ${size}${item.width ? ` · ${item.width}×${item.height}` : ''}`;

          box.append(img, caption);
          return box;
        }

        async function load() {
          const release = ui.disable(refreshButton);
          message.classList.remove('bad');
          message.textContent = S.loading;
          try {
            const items = await ctx.invoke('list');
            grid.replaceChildren(...(Array.isArray(items) ? items.map(tile) : []));
            message.textContent = Array.isArray(items) && items.length ? '' : S.mediaEmpty;
          } catch (error) {
            message.textContent = `${S.mediaBad}: ${String(error)}`;
            message.classList.add('bad');
          } finally {
            release.dispose();
          }
        }

        await load();
      },
    },
    emotes: {
      mount: async (ctx) => {
        const { ui, root } = ctx;
        const zh = String(ctx.language ?? '').startsWith('zh');
        const S = zh ? ZH : EN;

        const card = ui.sheet({ title: S.emoteTitle, desc: S.emoteDesc });

        // 总开关和别名表放同一张卡：它们是一件事，分开放会让人以为互不相干。
        // 真正的持久化交给 webui 的 ctx.setConfig（见 save），这里的 invoke('save')
        // 只让服务端这次运行立刻换上新值。
        const toggle = ui.checkbox(S.emoteOn, { title: S.emoteOnTitle, checked: true });
        const how = ui.h('div');
        how.style.fontSize = '12px';
        how.style.opacity = '.72';
        how.textContent = S.emoteHow;

        const rows = ui.h('div');
        rows.style.display = 'flex';
        rows.style.flexDirection = 'column';
        rows.style.gap = '8px';
        const message = ui.msgline();
        const saveButton = ui.button(S.emoteSave, { onClick: () => { void save(); } });
        const addButton = ui.button(S.emoteAdd, { onClick: () => { appendRow('', ''); markDirty(); } });
        const bar = ui.rowbar();
        bar.append(addButton, saveButton);

        const hint = ui.h('div');
        hint.style.fontSize = '11px';
        hint.style.opacity = '.62';
        hint.textContent = S.emoteHint;

        card.body.append(toggle.el, how, rows, hint, bar, message);
        root.append(card.el);

        /** 改了没存的提示：按钮上点出来就够了，不用额外状态机。 */
        const markDirty = () => {
          saveButton.disabled = false;
        };

        toggle.input.addEventListener('change', markDirty);

        /** 收一行：[微信名] → [内部名]。两边不带方括号时自动补上，省得她手打。 */
        function normalizeName(value) {
          const text = String(value ?? '').trim();
          if (!text) return '';
          if (text.startsWith('[') && text.endsWith(']')) return text;
          if (text.startsWith('[') || text.endsWith(']')) return ''; // 半截括号，别猜
          return `[${text}]`;
        }

        function appendRow(wechat, inner) {
          const row = ui.rowbar();
          const left = ui.h('input');
          left.type = 'text';
          left.value = wechat;
          left.placeholder = S.emoteWechat;
          left.style.flex = '1';
          const arrow = ui.h('span');
          arrow.textContent = '→';
          arrow.style.opacity = '.5';
          const right = ui.h('input');
          right.type = 'text';
          right.value = inner;
          right.placeholder = S.emoteInner;
          right.style.flex = '1';
          const del = ui.button('✕', {
            onClick: () => {
              row.remove();
              markDirty();
            },
          });
          left.addEventListener('input', markDirty);
          right.addEventListener('input', markDirty);
          row.append(left, arrow, right, del);
          rows.append(row);
          return row;
        }

        function collect() {
          const out = {};
          for (const row of [...rows.children]) {
            const inputs = row.querySelectorAll('input');
            const wechat = normalizeName(inputs[0]?.value);
            const inner = normalizeName(inputs[1]?.value);
            if (!wechat && !inner) continue; // 空行直接丢
            if (!wechat || !inner) throw new Error(S.emoteNameBad);
            out[wechat] = inner;
          }
          return out;
        }

        async function save() {
          const release = ui.disable(saveButton);
          message.classList.remove('bad');
          try {
            const aliases = collect();
            const wechatEmoji = toggle.checked;
            // 框架配置面写回：校验、持久化、热更新都由宿主负责；
            // 不用自己改 config.json，也不用重启。
            await ctx.setConfig(`world:${WORLD_ID}`, {
              [`worlds.${WORLD_ID}.emojiAliases`]: aliases,
              [`worlds.${WORLD_ID}.wechatEmoji`]: wechatEmoji,
            });
            // 再通知服务端：配置热更新有时要等下一轮，这里让它立刻换。
            try {
              await ctx.invoke('save', { aliases, wechatEmoji });
            } catch {
              // 内存更新失败不影响已落盘的配置，下一轮照样生效。
            }
            message.textContent = S.emoteSaved;
          } catch (error) {
            message.textContent = `${S.emoteBad}: ${String(error?.message ?? error)}`;
            message.classList.add('bad');
          } finally {
            release.dispose();
          }
        }

        async function load() {
          message.classList.remove('bad');
          message.textContent = S.loading;
          try {
            const state = await ctx.invoke('list');
            const aliases = state && typeof state === 'object' && !Array.isArray(state)
              && !('aliases' in state) ? state : state?.aliases;
            toggle.setChecked(state?.wechatEmoji !== false);
            rows.replaceChildren();
            const entries = Object.entries(aliases && typeof aliases === 'object' ? aliases : {});
            for (const [wechat, inner] of entries) appendRow(wechat, String(inner ?? ''));
            if (entries.length === 0) {
              const empty = ui.h('div');
              empty.style.opacity = '.62';
              empty.textContent = S.emoteEmpty;
              rows.append(empty);
            }
            saveButton.disabled = true;
            message.textContent = '';
          } catch (error) {
            message.textContent = `${S.emoteBad}: ${String(error)}`;
            message.classList.add('bad');
          }
        }

        await load();
      },
    },
  },
};
