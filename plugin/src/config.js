/**
 * 配置段与文案。
 *
 * 本包是 cortico-world-clawbot 的 ClawBridge 分支：
 *   - World id 换成 `clawbridge`，与原插件可同时安装、互不冲突；
 *   - 数据目录仍沿用 `clawbot/`，复用已扫码的绑定，不必重新扫码；
 *   - 段名是 `config.json` 的 `worlds.clawbridge`。
 *
 * 绑定状态不在配置里：bot_token、游标和 context_token 都放在
 * 部署数据目录的 `clawbot/` 下。
 */

/** World id：配置段、事件来源、事件类型前缀都用它。 */
export const ID = 'clawbridge';
/** 数据目录名：与原插件共用，以便复用已有登录凭据。 */
export const DATA_ID = 'clawbot';
export const LABEL = '微信 ClawBridge';

export const EVENT_MESSAGE = `${ID}.message`;

export const DEFAULTS = Object.freeze({
  enabled: false,
  /** inherit = 跟随 Coopanion 的代理；direct = 绕过代理；proxy = 用 proxyUrl。 */
  networkMode: 'inherit',
  proxyUrl: '',
  forceIpv4: false,
  /** 是否把入站图片作为附件送进模型上下文（模型不支持视觉时自动降级）。 */
  mediaAttach: true,
  /** 是否下载入站图片；关掉只保留凭证与正文路径。 */
  mediaDownload: true,
  /** 单件媒体上限，默认 32 MiB（对齐 DeepSeek inline 限制）。 **只管图片**。 */
  maxMediaBytes: 32 * 1024 * 1024,
  /** 单次回复最多拆成几条微信消息。 */
  maxSegments: 4,
  /** 多条消息之间的间隔（毫秒），0 表示不留间隔。 */
  segmentDelayMs: 600,
  /** 是否把【表情】替换成微信 emoji；关掉后只当分段符。 */
  emojiReplace: true,
  /** 用户自定义映射：{ "翻白眼": "🙄" }，只能写在 config.json 里。 */
  emojiOverrides: {},
  /** 单次最多发几张图。 */
  maxImages: 2,
  /** 图片 mid_size 取值：cipher（密文长度，官方注释口径）或 plain（明文字节数）。 */
  midSizeMode: 'cipher',
  /** 除数据目录外，允许读取图片的额外根目录（只能写在 config.json 里）。 */
  imageRoots: [],
  /** 收到消息后是否在微信侧显示「对方正在输入」。 */
  typingIndicator: true,
  /** 送模型的图片长边上限（像素）；0 表示不降采样。 */
  mediaMaxEdge: 768,
  /** 降采样后的 JPEG 质量。 */
  mediaQuality: 82,
  /** 图片与媒体凭证保留天数；0 表示不清理。 */
  mediaRetentionDays: 7,
  /**
   * 收发文件总开关，默认关闭。
   *
   * 关着时：入站文件只给 `[文件 名字]` 占位（不下载、不给路径），
   * `clawbridge_send` 的 `files` 参数一律拒绝。
   * 收下的文件落 `blobs`，按 `mediaRetentionDays` 一起清理。
   */
  fileTransfer: false,
  /** 单次最多发几个文件。 */
  maxFiles: 2,
  /**
   * 单个文件/视频上限（**兆字节**），收发都按它卡。
   *
   * 用 MB 而不是字节：让人填 100 而不是 104857600。
   * 内部仍换算成字节（`maxFileMb * 1024 * 1024`）去做判断。
   *
   * **和图片的 `maxMediaBytes` 是两个独立口径**：图片要进模型，受 inline 附件上限约束（32 MiB）；
   * 文件与视频只落盘给路径、**不进模型**，所以没有模型侧理由卡在 32 MiB。
   * 100 MB 纯粹是「磁盘占用 + 内存里整块读一遍」的务实上限，
   * **不是微信的限制**——服务端真实上限未实测，需要时自行调整。
   */
  maxFileMb: 100,
});

const ZH = {
  label: LABEL,
  lamp: '微信',
  connected: '已连接',
  unbound: '未绑定',
  binding: '绑定中',
  connecting: '连接中',
  error: '连接异常',
  hintReady: (who) => (who ? `微信：${who}` : '微信：已连接'),
  hintUnbound: '在「微信绑定」面板扫码',
  panelTitle: '微信绑定',
  panelDesc: '用手机微信扫码，把这个微信号的 ClawBot 接到这里。',
  panelMediaTitle: '收到的图片',
  panelMediaDesc: '微信发来的图片（已解密落盘），按时间倒序；缩略图仅用于查看，发出去的是原图。',
  promptTitle: '提示词',
  badgeAccount: '账号',
  badgeLast: '最近消息',
  badgeState: '状态',
  config: {
    title: '微信 ClawBridge',
    description: '通过微信 ClawBot（iLink）接入；只支持一对一私聊，扫码绑定在「微信绑定」面板。',
    enabled: '启用微信 ClawBridge',
    enabledDesc: '打开后挂载本 World，并尝试用已保存的凭据连接；没有凭据时在「微信绑定」面板扫码。',
    networkMode: '网络出口',
    networkModeDesc: 'inherit = 跟随 Coopanion 的系统/环境代理；direct = 直连，绕过代理；proxy = 使用下面的代理地址。修改后需重启。',
    proxyUrl: '代理地址',
    proxyUrlDesc: 'proxy 模式使用；例如 http://127.0.0.1:7890，只支持 HTTP/HTTPS 代理。修改后需重启。',
    forceIpv4: '优先 IPv4',
    forceIpv4Desc: 'direct/proxy 模式下强制 IPv4；连接超时且系统 IPv6 路由不可用时打开。修改后需重启。',
    mediaAttach: '图片送入模型',
    mediaAttachDesc: '把收到的图片作为附件交给模型。当前模型不支持视觉时会自动降级为只给本地路径。修改后需重启。',
    mediaDownload: '下载图片',
    mediaDownloadDesc: '收到图片时下载解密并落盘（<数据目录>/clawbot/blobs）。关闭后只保留占位与凭证。修改后需重启。',
    maxMediaBytes: '单张大小上限（字节）',
    maxMediaBytesDesc: '超过该大小的图片不下载，默认 33554432（32 MiB）。修改后需重启。',
    maxSegments: '单次最多几条消息',
    maxSegmentsDesc: '一条回复用【…】拆成多条时，最多发几条（默认 4，上限 10），超出并入最后一条。修改后需重启。',
    segmentDelayMs: '消息间隔（毫秒）',
    segmentDelayMsDesc: '多条消息之间的发送间隔，默认 600，会带 ±30% 抖动；填 0 表示不等待。修改后需重启。',
    emojiReplace: '表情替换成 emoji',
    emojiReplaceDesc: '把【shy】这类表情标记换成 😳 这样的微信 emoji；动作标记始终只当分段符。关掉后所有标记都只分段。修改后需重启。',
    maxImages: '单次最多几张图',
    maxImagesDesc: '一次回复里最多附带几张图片，默认 2，上限 4。图片在文字之后按顺序发出。修改后需重启。',
    typingIndicator: '显示「正在输入」',
    typingIndicatorDesc: '收到消息后，在微信里显示「对方正在输入」，直到回复发出（每 4 秒续一次）。修改后需重启。',
    mediaMaxEdge: '送模型图片长边（像素）',
    mediaMaxEdgeDesc: '图片送进模型前把长边缩到这个值，默认 768（省约 36% 的图片 token）；填 0 关闭。落盘原图不受影响。修改后需重启。',
    mediaQuality: '降采样质量',
    mediaQualityDesc: '缩放后 JPEG 的质量，默认 82。数值越大越清晰也越大。修改后需重启。',
    mediaRetentionDays: '图片保留天数',
    mediaRetentionDaysDesc: '启动时删除超过这个天数的图片与媒体凭证（blobs 和 media 目录），默认 7；填 0 不清理。修改后需重启。',
    fileTransfer: '收发文件',
    fileTransferDesc: '打开后才能收发文件。收到的文件落在 <数据目录>/clawbot/blobs，按上面的图片保留天数清理；她只能发自己 workspace 里的文件。默认关闭。修改后需重启。',
    maxFiles: '单次最多几个文件',
    maxFilesDesc: '一次回复里最多附带几个文件，默认 2，上限 4。文件在文字与图片之后按顺序发出。修改后需重启。',
    maxFileMb: '单件文件/视频上限（MB）',
    maxFileMbDesc: '超过该大小的文件与视频既不收也不发，默认 100（MB）。'
      + '与图片上限是两个口径：图片要进模型所以卡 32 MiB，文件/视频只落盘、不进模型。'
      + '**这不是微信的限制**（服务端真实上限未实测），只是磁盘与内存的务实上限——'
      + '想探真实边界就改大后逐档试。修改后需重启。',
  },
};

const EN = {
  label: 'WeChat ClawBot',
  lamp: 'WeChat',
  connected: 'connected',
  unbound: 'not bound',
  binding: 'binding',
  connecting: 'connecting',
  error: 'error',
  hintReady: (who) => (who ? `WeChat: ${who}` : 'WeChat: connected'),
  hintUnbound: 'Scan in the WeChat binding panel',
  panelTitle: 'WeChat binding',
  panelDesc: 'Scan with WeChat to bind this ClawBot contact.',
  panelMediaTitle: 'Received images',
  panelMediaDesc: 'Images received from WeChat (decrypted on disk), newest first. Thumbnails are for viewing only; sending uses the original.',
  promptTitle: 'Prompt',
  badgeAccount: 'Account',
  badgeLast: 'Last message',
  badgeState: 'State',
  config: {
    title: 'WeChat ClawBot',
    description: 'Connect through WeChat ClawBot (iLink). 1:1 private chat only; bind by QR in the WeChat binding panel.',
    enabled: 'Enable WeChat ClawBot',
    enabledDesc: 'Mount this World and connect with the saved credentials; if there are none, scan in the WeChat binding panel.',
    networkMode: 'Network route',
    networkModeDesc: 'inherit = follow Coopanion\'s system/environment proxy; direct = bypass the proxy; proxy = use the URL below. Restart after changing.',
    proxyUrl: 'Proxy URL',
    proxyUrlDesc: 'Used by proxy mode, e.g. http://127.0.0.1:7890. HTTP/HTTPS proxies only. Restart after changing.',
    forceIpv4: 'Prefer IPv4',
    forceIpv4Desc: 'Force IPv4 in direct/proxy mode; turn on when connections time out and the system IPv6 route is broken. Restart after changing.',
    mediaAttach: 'Attach images to the model',
    mediaAttachDesc: 'Pass received images to the model as attachments. Falls back to the local path when the active model has no vision support. Restart after changing.',
    mediaDownload: 'Download images',
    mediaDownloadDesc: 'Download and decrypt incoming images into <dataDir>/clawbot/blobs. When off, only the placeholder and credentials remain. Restart after changing.',
    maxMediaBytes: 'Max bytes per image',
    maxMediaBytesDesc: 'Images larger than this are not downloaded. Default 33554432 (32 MiB). Restart after changing.',
    maxSegments: 'Max messages per reply',
    maxSegmentsDesc: 'How many WeChat messages one reply may split into via 【…】 (default 4, max 10); overflow merges into the last one. Restart after changing.',
    segmentDelayMs: 'Delay between messages (ms)',
    segmentDelayMsDesc: 'Gap between consecutive messages, default 600 with ±30% jitter; 0 sends immediately. Restart after changing.',
    emojiReplace: 'Turn expressions into emoji',
    emojiReplaceDesc: 'Replace expression markers like 【shy】 with WeChat emoji such as 😳. Motion markers always act as plain separators. When off, every marker only splits. Restart after changing.',
    maxImages: 'Max images per reply',
    maxImagesDesc: 'How many images one reply may attach, default 2, max 4. Images go out after the text in order. Restart after changing.',
    typingIndicator: 'Show typing indicator',
    typingIndicatorDesc: 'Show "typing" on the WeChat side after a message arrives, until the reply goes out (refreshed every 4s). Restart after changing.',
    mediaMaxEdge: 'Max edge for model images (px)',
    mediaMaxEdgeDesc: 'Downscale images to this longest edge before handing them to the model, default 768 (saves ~36% image tokens); 0 disables. The archived original is untouched. Restart after changing.',
    mediaQuality: 'Downscale quality',
    mediaQualityDesc: 'JPEG quality after downscaling, default 82. Higher is sharper and larger. Restart after changing.',
    mediaRetentionDays: 'Keep images for (days)',
    mediaRetentionDaysDesc: 'On startup, delete images and media credentials older than this (blobs and media folders). Default 7; 0 disables. Restart after changing.',
    fileTransfer: 'File transfer',
    fileTransferDesc: 'Turn on to send and receive files. Received files land in <dataDir>/clawbot/blobs and are cleaned up with the image retention setting above; she may only send files from her own workspace. Off by default. Restart after changing.',
    maxFiles: 'Max files per reply',
    maxFilesDesc: 'How many files one reply may attach, default 2, max 4. Files go out after the text and images, in order. Restart after changing.',
    maxFileMb: 'Max size per file/video (MB)',
    maxFileMbDesc: 'Files and videos larger than this are neither received nor sent. Default 100 (MB). '
      + 'This is a separate limit from images: images go into the model and are capped at 32 MiB, while files/videos '
      + 'are only stored and never sent to the model. It is not a WeChat limit (the real server limit is untested), '
      + 'just a practical disk/memory ceiling — raise it and test if you want the true boundary. Restart after changing.',
  },
};

export function text(language = 'zh') {
  return language === 'en' ? EN : ZH;
}

export function configGroup(language = 'zh') {
  const t = text(language).config;
  const K = `worlds.${ID}`;
  return {
    id: `world:${ID}`,
    owner: `world:${ID}`,
    schema: {
      type: 'object',
      title: t.title,
      description: t.description,
      properties: {
        [`${K}.enabled`]: {
          type: 'boolean',
          title: t.enabled,
          description: t.enabledDesc,
          'x-hot': true,
        },
        [`${K}.networkMode`]: {
          type: 'string',
          title: t.networkMode,
          description: t.networkModeDesc,
          enum: ['inherit', 'direct', 'proxy'],
          'x-hot': false,
        },
        [`${K}.proxyUrl`]: {
          type: 'string',
          title: t.proxyUrl,
          description: t.proxyUrlDesc,
          'x-hot': false,
        },
        [`${K}.forceIpv4`]: {
          type: 'boolean',
          title: t.forceIpv4,
          description: t.forceIpv4Desc,
          'x-hot': false,
        },
        [`${K}.mediaAttach`]: {
          type: 'boolean',
          title: t.mediaAttach,
          description: t.mediaAttachDesc,
          'x-hot': false,
        },
        [`${K}.mediaDownload`]: {
          type: 'boolean',
          title: t.mediaDownload,
          description: t.mediaDownloadDesc,
          'x-hot': false,
        },
        [`${K}.maxMediaBytes`]: {
          type: 'integer',
          title: t.maxMediaBytes,
          description: t.maxMediaBytesDesc,
          'x-hot': false,
        },
        [`${K}.maxSegments`]: {
          type: 'integer',
          title: t.maxSegments,
          description: t.maxSegmentsDesc,
          'x-hot': false,
        },
        [`${K}.segmentDelayMs`]: {
          type: 'integer',
          title: t.segmentDelayMs,
          description: t.segmentDelayMsDesc,
          'x-hot': false,
        },
        [`${K}.emojiReplace`]: {
          type: 'boolean',
          title: t.emojiReplace,
          description: t.emojiReplaceDesc,
          'x-hot': false,
        },
        [`${K}.maxImages`]: {
          type: 'integer',
          title: t.maxImages,
          description: t.maxImagesDesc,
          'x-hot': false,
        },
        [`${K}.typingIndicator`]: {
          type: 'boolean',
          title: t.typingIndicator,
          description: t.typingIndicatorDesc,
          'x-hot': false,
        },
        [`${K}.mediaMaxEdge`]: {
          type: 'integer',
          title: t.mediaMaxEdge,
          description: t.mediaMaxEdgeDesc,
          'x-hot': false,
        },
        [`${K}.mediaQuality`]: {
          type: 'integer',
          title: t.mediaQuality,
          description: t.mediaQualityDesc,
          'x-hot': false,
        },
        [`${K}.mediaRetentionDays`]: {
          type: 'integer',
          title: t.mediaRetentionDays,
          description: t.mediaRetentionDaysDesc,
          'x-hot': false,
        },
        [`${K}.fileTransfer`]: {
          type: 'boolean',
          title: t.fileTransfer,
          description: t.fileTransferDesc,
          'x-hot': false,
        },
        [`${K}.maxFiles`]: {
          type: 'integer',
          title: t.maxFiles,
          description: t.maxFilesDesc,
          'x-hot': false,
        },
        [`${K}.maxFileMb`]: {
          type: 'integer',
          title: t.maxFileMb,
          description: t.maxFileMbDesc,
          'x-hot': false,
        },
      },
    },
  };
}
