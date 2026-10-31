/**
 * 工具回执：给模型看的极简结果行。
 *
 * 设计目标是「一眼知道成没成、为什么没成」，同时尽量短——回执会一直留在上下文里。
 *
 *   成功  [wx] 送达 09:25 32字
 *   多条  [wx] 送达 09:25 3条 42字
 *   失败  [wx] 失败:他还没先说话
 *   失败  [wx] 失败:服务无响应(-2)
 */

/** 本地 HH:mm（可指定时区）。 */
export function clockOf(date = new Date(), timezone = '') {
  const value = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      ...(timezone ? { timeZone: timezone } : {}),
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  } catch {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * 字数按**码点**算，避免 emoji 被算成 2 个字。
 */
export function countChars(text) {
  return [...String(text ?? '')].length;
}

/**
 * 成功回执。
 *
 * @param {object} params
 * @param {Date} [params.at] - 发送时间，缺省为现在
 * @param {number} [params.chars] - 总字数（码点）
 * @param {number} [params.messages] - 消息条数，缺省 1 条不显示
 * @param {string} [params.detail] - 构成说明，如 `2文+1图`
 * @param {string} [params.timezone]
 */
export function sentReceipt({ at = new Date(), chars = 0, messages = 1, detail = '', timezone = '' } = {}) {
  const count = Number.isFinite(messages) && messages > 1 ? `${messages}条` : '';
  const mix = detail ? (count ? `(${detail})` : detail) : '';
  const head = count ? `${count}${mix}` : mix;
  const zeros = !Number.isFinite(chars) || chars === 0;
  // 纯发图时没有字数可说，别再显示「0字」
  const tail = zeros && detail ? '' : `${zeros ? 0 : chars}字`;
  const body = [head, tail].filter(Boolean).join(' ');
  return `[wx] 送达 ${clockOf(at, timezone)}${body ? ` ${body}` : ''}`;
}

/** 失败回执：`reason` 是要给模型看的一句短原因。 */
export function failedReceipt(reason) {
  const text = String(reason ?? '').trim() || '未知错误';
  return `[wx] 失败:${text}`;
}

/** 从错误里取出括号里要显示的那段（ret / HTTP / 网络码），并按阶段加标签。 */
export function describeSendError(err) {
  if (!err || typeof err !== 'object') return '发送失败';

  const stage = String(err.stage ?? '');
  const label = stage === 'getuploadurl' ? '上传地址失败'
    : stage === 'upload' ? '上传失败'
      : stage === 'sendmessage' ? '发送失败'
        : '服务无响应';

  const ret = err.ret;
  if (Number.isFinite(Number(ret))) return `${label}(${Number(ret)})`;

  const status = err.status;
  if (Number.isFinite(Number(status))) return `${label}(${Number(status)})`;

  const name = String(err.name ?? '');
  const message = String(err.message ?? '');
  const causeCode = err.cause && typeof err.cause === 'object' ? String(err.cause.code ?? '') : '';

  if (name === 'AbortError' || name === 'TimeoutError') return '网络错误(超时)';

  const code = causeCode
    || (/\((ECONN[A-Z]*|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_[A-Z_]+)\)/.exec(message)?.[1] ?? '');
  if (code) return `网络错误(${code})`;

  if (/non-JSON/.test(message)) return '服务返回异常';

  // 兜底也带点线索：优先用接口返回的 errmsg，其次用错误信息
  const detail = String(err.detail ?? '').trim() || message
    .replace(/^(?:POST|GET)\s+\S+\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return detail ? `${label}(${detail.slice(0, 28)})` : label;
}
