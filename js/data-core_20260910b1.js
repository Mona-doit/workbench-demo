/* ============================================================
   data-core.js — 核心：每日滚动函数（dayIndex）
   由 data-content.js 于 2026-09-09 拆分而来，题目内容未作改动
   
   ============================================================ */
(function (global) {
  'use strict';

/* ---------- 每日滚动函数：按日期取第 n 个 ---------- */
  // 统一按北京时间自然日轮换：+8h 偏移后取整，使北京时间每天 00:00 切换
  function dayIndex() {
    const t = new Date();
    return Math.floor((t.getTime() + 8 * 60 * 60 * 1000) / (1000 * 60 * 60 * 24));
  }

  global.Content = global.Content || {};
  Object.assign(global.Content, { dayIndex });
})(window);
