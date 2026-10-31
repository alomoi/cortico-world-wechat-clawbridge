/**
 * 入站消息去重。
 *
 * 长轮询的同步游标理论上可能重放（断线重连、游标回退），重复处理会让桌宠对同一句话回复两次。
 * 这里用一个有上限的 FIFO 集合兜底：只记最近 N 条 id，内存恒定。
 */

/**
 * @param {number} [max] 最多记住多少条（默认 500）
 */
export function createSeenSet(max = 500) {
  const limit = Math.max(1, Math.floor(Number(max) || 500));
  const ids = new Set();

  return {
    /** 只检查，不记录。 */
    has(id) {
      return ids.has(String(id ?? '').trim());
    },
    /**
     * 检查并记录。
     * @returns {boolean} true 表示这条以前见过（应当跳过）
     */
    seen(id) {
      const key = String(id ?? '').trim();
      if (!key) return false; // 没有 id 的消息无法去重，按新消息处理
      if (ids.has(key)) return true;
      ids.add(key);
      if (ids.size > limit) {
        const oldest = ids.values().next().value;
        ids.delete(oldest);
      }
      return false;
    },
    get size() {
      return ids.size;
    },
    clear() {
      ids.clear();
    },
  };
}

/** 从一条 iLink 消息里取稳定 id（优先 message_id，其次 msg_id）。 */
export function messageKeyOf(message) {
  const id = message?.message_id ?? message?.msg_id ?? '';
  return String(id ?? '').trim();
}
