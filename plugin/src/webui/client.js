/**
 * 控制台「微信绑定」面板（浏览器侧 ES 模块）。
 *
 * 只使用 ctx.ui 和 ctx.invoke；服务端方法见 world.js 的 #invokePanel。
 * 二维码由服务端生成 data URL，这里只负责显示。
 */

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
  },
};
