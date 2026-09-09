/* ============================================================
   utils.js — 通用工具函数 & 全局小工具
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 日期工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------- 每日真题训练 · 进度持久化 ----------
     用于：① 刷新页面后保留做题痕迹；② 卡片标题显示"已做X/共Y题"
     存储结构：{ date: 'YYYY-MM-DD', records: [null|{choice,correct}, ...] }
     仅当天有效；跨天自动作废（新的一天重新开始每日10题）。
     ================================================================ */
  function dqStorageKey(module) {
    return 'dq_' + module;
  }
  // 保存某模块今日做题进度
  function dqSave(module, records) {
    try {
      localStorage.setItem(Store.PREFIX + dqStorageKey(module), JSON.stringify({
        date: todayStr(),
        records: records || []
      }));
    } catch (e) {}
  }
  // 读取某模块今日做题进度；非当天或异常返回 null
  function dqLoad(module) {
    try {
      const raw = localStorage.getItem(Store.PREFIX + dqStorageKey(module));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.date !== todayStr() || !Array.isArray(d.records)) return null;
      return d.records;
    } catch (e) { return null; }
  }
  // 返回某模块今日已作答数 / 总题数（total 可传入，默认按 10）
  function dqProgress(module, total) {
    const records = dqLoad(module);
    const answered = (records && Array.isArray(records)) ? records.filter(r => r !== null).length : 0;
    return { answered: answered, total: total || 10 };
  }
  // 全量补录每日真题训练的 stats（一次性扫描所有模块的 dq records，把"已答但未累加"的部分补到 stats）
  // 解决:用户答了几题后直接切走/关闭页面/没进对应模块,导致 answeredCount 没被 flushStats 累加到 stats
  // 通过 dq_logged_<module>_<date> 记录"已累加到第几题",本次只补差额
  function flushAllDqStats() {
    try {
      if (typeof Store === 'undefined' || !Store.PREFIX) return;
      const P = Store.PREFIX;
      const dateStr = todayStr();
      const modules = ['politics', 'common', 'language', 'logic', 'quantity', 'data'];
      modules.forEach(function (mod) {
        // 1) 读今日 records
        let records = null;
        try {
          const raw = localStorage.getItem(P + 'dq_' + mod);
          if (!raw) return;
          const d = JSON.parse(raw);
          if (!d || d.date !== dateStr || !Array.isArray(d.records)) return;
          records = d.records;
        } catch (e) { return; }
        const answeredCount = records.filter(function (r) { return r !== null; }).length;
        if (answeredCount <= 0) return;
        // 2) 读已累加数
        let lastLogged = 0;
        try {
          lastLogged = parseInt(localStorage.getItem(P + 'dq_logged_' + mod + '_' + dateStr) || '0', 10) || 0;
        } catch (e) {}
        if (answeredCount <= lastLogged) return;
        // 3) 统计本批新增中答对数
        let newCorrect = 0;
        for (let i = lastLogged; i < answeredCount; i++) {
          const r = records[i];
          if (r && r.correct) newCorrect++;
        }
        const added = answeredCount - lastLogged;
        const addedMin = Math.max(1, Math.round(added * 30 / 60)); // 单题推荐时限兜底 30s
        try {
          if (typeof Store.addStat === 'function') {
            Store.addStat(mod, added, addedMin, newCorrect, added);
          }
        } catch (e) {}
        // 4) 写回已累加数
        try {
          localStorage.setItem(P + 'dq_logged_' + mod + '_' + dateStr, String(answeredCount));
        } catch (e) {}
      });
    } catch (e) { /* 静默 */ }
  }

  // 一次性迁移：清理 stats.records 中的重复条目
  // 旧实现按 (module, date) 仅保留 1 条，会误删"每答一题 1 条"的细粒度记录 → 改为按 id 唯一去重
  // 用 localStorage 标记 shangan_dedup_stats_v1 防重复执行
  function migrateStatsDedup() {
    try {
      if (localStorage.getItem(Store.PREFIX + 'dedup_stats_v1') === '1') return;
      if (!Store || typeof Store.statsAll !== 'function') return;
      const all = Store.statsAll() || [];
      if (!Array.isArray(all) || !all.length) {
        localStorage.setItem(Store.PREFIX + 'dedup_stats_v1', '1');
        return;
      }
      // 按 id 唯一去重：保留首次出现的；无 id 的记录一律保留
      const seenId = {};
      const keep = [];
      all.forEach(r => {
        if (!r) return;
        if (!r.id) { keep.push(r); return; }
        if (seenId[r.id]) return;
        seenId[r.id] = true;
        keep.push(r);
      });
      if (keep.length < all.length) {
        try {
          Store.data.stats.records = keep;
          if (typeof Store.save === 'function') Store.save('stats');
        } catch (e) {
          localStorage.setItem(Store.PREFIX + 'stats', JSON.stringify({ records: keep }));
        }
      }
      localStorage.setItem(Store.PREFIX + 'dedup_stats_v1', '1');
    } catch (e) { /* 静默 */ }
  }
  // 累计已做题数：从 stats 记录中按模块过滤求 count 总和
  function cumulativeQuizCount(module) {
    try {
      if (!Store || typeof Store.statsAll !== 'function') return 0;
      const all = Store.statsAll() || [];
      return all.filter(r => r && r.module === module).reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0);
    } catch (e) { return 0; }
  }
  // 获取某模块题库总题数（基于 Content 已导出的聚合题库）
  // politics/common/language/logic/quantity；逻辑判断与数量关系含多类题库，需要汇总
  function getModuleQuizTotal(cat) {
    try {
      const C = (typeof window !== 'undefined') ? window.Content : null;
      if (!C) return 0;
      switch (cat) {
        case 'politics':   return (C.POLITICS_QUIZ || []).length;
        case 'common':     return (C.COMMON_QUIZ || []).length;
        case 'language':   return (C.LANGUAGE_QUIZ || []).length;
        case 'logic': {
          // 汇总 LOGIC_QUIZ_BY_TYPE 四类（figure/define/analogy/logic）
          const t = C.LOGIC_QUIZ_BY_TYPE || {};
          return ['figure','define','analogy','logic'].reduce((s, k) => s + (t[k] || []).length, 0);
        }
        case 'quantity': {
          // 汇总 QUANTITY_QUIZ_BY_TYPE 全部题型
          const t = C.QUANTITY_QUIZ_BY_TYPE || {};
          return Object.keys(t).reduce((s, k) => s + (t[k] || []).length, 0);
        }
        case 'data': {
          // 资料分析模块未设真题训练，题库总量为 0
          return 0;
        }
        default: return 0;
      }
    } catch (e) { return 0; }
  }
  // 定位某模块"完成今日XX真题"待办的索引（找不到返回 -1）
  function dqTodoIndex(module) {
    try {
      const entries = getModuleTodoEntries(module);
      for (let i = 0; i < entries.length; i++) {
        if (/真题/.test(entries[i].title)) return entries[i].index;
      }
    } catch (e) {}
    return -1;
  }

  // 计算开始日期 + 天数 后的预计完成日期（开始当天算第1天，共 days 天）
  function calcEndDate(startDate, days) {
    const d = new Date(startDate + 'T00:00:00');
    d.setDate(d.getDate() + (days - 1));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // 计算距某日期还剩多少天（不含今天），返回 {days, passed, expired}
  function daysUntil(dateStr) {
    if (!dateStr) return { days: null, expired: false };
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    now.setHours(0,0,0,0);
    const diff = target - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return { days, expired: days < 0 };
  }

  // 周 key：如 2025-W23
  function weekKey(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const year = d.getFullYear();
    // 计算一年中的第几周（简单近似）
    const start = new Date(year, 0, 1);
    const dayOfYear = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const week = Math.floor(dayOfYear / 7) + 1;
    return year + '-W' + pad(week);
  }

  // 格式化日期显示 2025-06-01 -> 6月1日
  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const p = dateStr.split('-');
    return (+p[1]) + '月' + (+p[2]) + '日';
  }

  /* ---------- 网络/连接状态 ---------- */
  // 检测在线状态
  function detectOnline() {
    const online = navigator.onLine;
    Store.setConnected(online);
    return online;
  }
  window.addEventListener('online', () => { Store.setConnected(true); updateConnUI(); toast('🟢 已连接，可同步'); });
  window.addEventListener('offline', () => { Store.setConnected(false); updateConnUI(); toast('🔴 未连接，仅本地存储'); });

  function updateConnUI() {
    const on = Store.isConnected();
    document.querySelectorAll('#connStatus, #connStatusTop').forEach(el => {
      if (!el) return;
      const dot = el.querySelector('.conn-dot');
      const txt = el.querySelector('.conn-text');
      if (dot) { dot.className = 'conn-dot ' + (on ? 'green' : 'red'); }
      if (txt) txt.textContent = on ? '已连接 · 可同步' : '未连接 · 仅本地';
    });
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------- 弹窗 (Bottom Sheet) ---------- */
  function openSheet(html, title) {
    const sheet = document.getElementById('bottomSheet');
    const mask = document.getElementById('sheetMask');
    if (title) {
      sheet.innerHTML = '<div class="sheet-handle"></div><div class="sheet-title">' + title + '</div>' + html;
    } else {
      sheet.innerHTML = '<div class="sheet-handle"></div>' + html;
    }
    sheet.classList.add('show');
    mask.classList.add('show');
  }
  function closeSheet() {
    document.getElementById('bottomSheet').classList.remove('show');
    document.getElementById('sheetMask').classList.remove('show');
  }
  document.getElementById('sheetMask').addEventListener('click', closeSheet);

  /* ---------- 分类标签样式 ---------- */
  const CAT_META = {
    political: { label: '政治理论', cls: 'tag-political', icon: '🏛️' },
    common:    { label: '常识判断', cls: 'tag-common',    icon: '🌏' },
    language:  { label: '言语理解', cls: 'tag-language',  icon: '💬' },
    logic:     { label: '判断推理', cls: 'tag-logic',     icon: '🧩' },
    quantity:  { label: '数量关系', cls: 'tag-quantity',  icon: '🔢' },
    data:      { label: '资料分析', cls: 'tag-data',      icon: '📊' },
    essay:     { label: '申论·小题', cls: 'tag-shenlun',  icon: '✏️' },
    composition:{label: '申论·大作文', cls: 'tag-shenlun',icon: '🖋️' },
    shenlun:   { label: '申论',    cls: 'tag-shenlun',   icon: '✏️' },
  };
  // key 别名（历史遗留：打卡分类用 political，模块页用 politics）
  const CAT_ALIAS = { politics: 'political' };
  function catInfo(key) {
    const k = CAT_ALIAS[key] || key;
    return CAT_META[k] || { label: key, cls: 'tag-common', icon: '📌' };
  }
  function catTag(key) {
    const c = catInfo(key);
    return '<span class="tag ' + c.cls + '">' + c.label + '</span>';
  }
  // 所有可打卡分类（用于每日计划）
  const PLAN_CATS = [
    { key: 'political',   label: '政治理论',  icon: '🏛️' },
    { key: 'language',    label: '言语理解',  icon: '💬' },
    { key: 'logic',       label: '判断推理',  icon: '🧩' },
    { key: 'quantity',    label: '数量关系',  icon: '🔢' },
    { key: 'data',        label: '资料分析',  icon: '📊' },
    { key: 'common',      label: '常识判断',  icon: '🌏' },
    { key: 'essay',       label: '申论·小题', icon: '✏️' },
    { key: 'composition', label: '申论·大作文', icon: '🖋️' },
  ];

  // 各模块的每日待办清单（模块页顶部 + 每日计划页共用，保证同步）
  // key 规则：todo_<日期>_<模块>_<序号>，值 '1' 已完成 / '0' 未完成
  // 默认配置（用户可在模块页修改标题，覆盖保存到 localStorage，key: modtodo_<模块>_<序号>）
  const DEFAULT_MODULE_TODOS = {
    // 顺序与各模块页面上专属内容栏目的显示顺序保持一致
    politics:    ['学习今日时政热点10条', '完成今日政治理论真题10题', '熟记5个核心考点'],
    common:      ['记忆常识口诀1条', '记忆今日常识12条', '完成今日常识判断真题10题'],
    language:    ['背诵成语辨析1对', '完成今日言语理解真题10题', '积累成语10个'],
    logic:       ['完成今日判断推理真题10题', '掌握今日题型解题要点'],
    quantity:    ['掌握今日题型解题要点', '完成今日数量关系真题10题'],
    data:        ['复习资料分析核心公式'],
    essay:       ['积累规范表述10个', '掌握今日题型解题要点'],
    composition: ['积累今日作文主题素材', '背诵金句2句'],
  };
  // 兼容旧引用：MODULE_TODOS 指向默认值（读取方统一改用 getModuleTodos / getAllModuleTodos）
  const MODULE_TODOS = DEFAULT_MODULE_TODOS;
  // 用户自定义标题的 localStorage key
  function modTodoKey(cat, index) {
    return 'modtodo_' + cat + '_' + index;
  }
  // 删除标记 key（值为 '1' 表示已删除）
  function modTodoDelKey(cat, index) {
    return 'modtodo_del_' + cat + '_' + index;
  }
  // 获取某模块的待办条目（含原始 index，跳过已删除项；标题取用户覆盖或默认）
  function getModuleTodoEntries(cat) {
    const defs = DEFAULT_MODULE_TODOS[cat] || [];
    const out = [];
    defs.forEach((t, i) => {
      if (localStorage.getItem(Store.PREFIX + modTodoDelKey(cat, i)) === '1') return; // 已删除
      const saved = localStorage.getItem(Store.PREFIX + modTodoKey(cat, i));
      out.push({ index: i, title: (saved && saved.trim()) ? saved : t });
    });
    return out;
  }
  // 获取某模块最终的待办标题数组（跳过已删除项，兼容旧调用）
  function getModuleTodos(cat) {
    return getModuleTodoEntries(cat).map(e => e.title);
  }
  // 获取所有模块的待办（用于每日计划页汇总）
  function getAllModuleTodos() {
    const out = {};
    for (const cat in DEFAULT_MODULE_TODOS) {
      out[cat] = getModuleTodos(cat);
    }
    return out;
  }
  // 修改模块待办标题，并同步模块打卡记录
  function updateModuleTodoTitle(cat, index, newTitle) {
    const t = (newTitle || '').trim();
    if (!t) return false;
    const defs = DEFAULT_MODULE_TODOS[cat];
    if (!defs || index < 0 || index >= defs.length) return false;
    const oldTitle = getModuleTodoEntries(cat).find(e => e.index === index);
    const oldTitleStr = oldTitle ? oldTitle.title : defs[index];
    localStorage.setItem(Store.PREFIX + modTodoKey(cat, index), t);
    // 同步模块打卡记录：注销旧标题、登记新标题
    if (oldTitleStr !== t && typeof Store === 'object' && Store && typeof Store.__renameModuleTodo === 'function') {
      Store.__renameModuleTodo(cat, oldTitleStr, t);
    }
    return true;
  }
  // 删除模块待办项（保存删除标记，全站同步），并同步清理打卡记录
  function removeModuleTodo(cat, index) {
    const defs = DEFAULT_MODULE_TODOS[cat];
    if (!defs || index < 0 || index >= defs.length) return false;
    if (localStorage.getItem(Store.PREFIX + modTodoDelKey(cat, index)) === '1') return false;
    const title = getModuleTodoEntries(cat).find(e => e.index === index);
    const titleStr = title ? title.title : defs[index];
    localStorage.setItem(Store.PREFIX + modTodoDelKey(cat, index), '1');
    // 清理勾选状态与模块打卡记录
    try {
      localStorage.removeItem(Store.PREFIX + todoKey(cat, index));
    } catch (e) {}
    if (typeof Store === 'object' && Store && typeof Store.__removeModuleTodo === 'function') {
      Store.__removeModuleTodo(cat, titleStr);
    }
    return true;
  }
  // 一次性迁移：清除所有旧的 modtodo_* 覆盖值与删除标记，
  // 使 DEFAULT_MODULE_TODOS 最新默认文案对所有日期强制生效。
  // 以 localStorage 标记 shangan_modtodo_v2 防止重复执行。
  function migrateModuleTodosV2() {
    try {
      if (localStorage.getItem(Store.PREFIX + 'modtodo_v2') === '1') return;
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(Store.PREFIX + 'modtodo_') === 0) {
          // 只清覆盖与删除标记，不动打卡勾选态（todo_ 开头）
          if (k.indexOf('modtodo_') === (Store.PREFIX.length)) {
            keysToRemove.push(k);
          }
        }
      }
      keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      localStorage.setItem(Store.PREFIX + 'modtodo_v2', '1');
    } catch (e) { /* 静默：迁移失败不影响主流程 */ }
  }
  // 待办 key 生成
  function todoKey(catKey, index) {
    return 'todo_' + todayStr() + '_' + catKey + '_' + index;
  }
  function todoDone(key) {
    return localStorage.getItem(Store.PREFIX + key) === '1';
  }
  function toggleTodo(key) {
    const on = localStorage.getItem(Store.PREFIX + key) === '1';
    localStorage.setItem(Store.PREFIX + key, on ? '0' : '1');
    return !on;
  }
  // 汇总所有模块今日的未完成待办
  function pendingTodos() {
    const pending = [];
    for (const cat in DEFAULT_MODULE_TODOS) {
      const entries = getModuleTodoEntries(cat);
      entries.forEach(e => {
        const key = todoKey(cat, e.index);
        if (!todoDone(key)) {
          const ci = catInfo(cat);
          pending.push({ cat, catLabel: ci.label, catIcon: ci.icon, title: e.title, key });
        }
      });
    }
    return pending;
  }

  /* ---------- 转义 ---------- */
  function esc(s, allowTags) {
    if (s === null || s === undefined) return '';
    let out = String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    if (allowTags) {
      // 把白名单标签还原（默认允许 <u>/<b>/<i>）
      out = out.replace(/&lt;(\/?)(u|b|i|strong|em|br)&gt;/g, '<$1$2>');
    }
    return out;
  }

  /* ---------- 进度条组件 ---------- */
  function progressHTML(done, total) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return (
      '<div class="progress-wrap">' +
        '<div class="progress-info"><span>今日进度</span><span>' + done + '/' + total + ' · ' + pct + '%</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }

  /* ---------- 每日计划区（通用，插到各模块顶部） ---------- */
  function renderModuleDailyPlan(container, catKey, title) {
    const items = Store.moduleDoneToday(catKey);
    const done = items.filter(i => i.checked).length;
    const html =
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>每日计划<button class="btn btn-sm btn-soft" data-act="add-plan" data-cat="' + catKey + '" style="margin-left:auto">＋ 添加打卡</button></div>' +
        '<div class="section-tip">每个打卡目标每日仅完成一次，完成后自动同步至「每日计划」页。</div>' +
        progressHTML(done, items.length) +
        '<div class="todo-list" style="margin-top:10px">' +
          (items.length === 0 ? '<div class="empty"><div class="e-icon">📝</div><div class="e-txt">今天还没有打卡目标，点击右上角添加</div></div>' : '') +
          items.map(it =>
            '<div class="todo-item' + (it.checked ? ' done' : '') + '">' +
              '<div class="todo-check' + (it.checked ? ' checked' : '') + '" data-todo="' + esc(it.title) + '" data-cat="' + catKey + '">' + (it.checked ? '✓' : '') + '</div>' +
              '<div class="todo-txt' + (it.checked ? ' checked' : '') + '">' + esc(it.title) + '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>';
    container.insertAdjacentHTML('beforeend', html);
  }

  /* 绑定每日计划里的加打卡按钮和打卡勾选事件（事件委托到 container） */
  function bindPlanEvents(container) {
    container.addEventListener('click', function (e) {
      const addBtn = e.target.closest('[data-act="add-plan"]');
      if (addBtn) {
        e.stopPropagation();
        const cat = addBtn.getAttribute('data-cat');
        openAddPlanSheet(cat);
        return;
      }
      const check = e.target.closest('[data-todo]');
      if (check) {
        e.stopPropagation();
        const title = check.getAttribute('data-todo');
        const cat = check.getAttribute('data-cat');
        // 切换：先看主打卡表，再同步
        const items = Store.getPlanItems(todayStr());
        const hit = items.find(i => i.title === title);
        if (hit) {
          Store.togglePlanItem(hit.id);
        } else {
          const mItems = Store.moduleDoneToday(cat);
          const m = mItems.find(i => i.title === title);
          if (m && m.checked) Store.unmarkModuleDone(cat, title);
          else Store.markModuleDone(cat, title);
        }
        toast('✅ 打卡已更新');
        // 刷新当前页
        const page = document.querySelector('.page.active-page');
        if (page && page.__key) APP.renderPage(page.__key);
      }
    });
  }

  function openAddPlanSheet(cat) {
    const cats = PLAN_CATS;
    const rows = cats.map(c =>
      '<button class="chip" data-pick-cat="' + c.key + '">' + c.icon + ' ' + c.label + '</button>'
    ).join('');
    openSheet(
      '<div class="field">' +
        '<label>选择分类</label><div class="chips" id="sheetCats">' + rows + '</div>' +
      '</div>' +
      '<div class="field"><label>打卡内容</label>' +
        '<input class="input" id="sheetPlanTitle" placeholder="例如：刷言语真题20题">' +
      '</div>' +
      '<button class="btn btn-block" id="sheetPlanOk">保存目标</button>',
      '新增打卡目标'
    );
    let selCat = cat || 'political';
    document.getElementById('sheetCats').querySelectorAll('.chip').forEach(c => {
      if (c.getAttribute('data-pick-cat') === selCat) c.classList.add('active');
      c.addEventListener('click', () => {
        document.getElementById('sheetCats').querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selCat = c.getAttribute('data-pick-cat');
      });
    });
    document.getElementById('sheetPlanOk').addEventListener('click', () => {
      const title = document.getElementById('sheetPlanTitle').value.trim();
      if (!title) { toast('请输入打卡内容'); return; }
      Store.addPlanItem(selCat, title);
      closeSheet();
      toast('✅ 已添加打卡目标');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 修改打卡目标弹窗（预填分类+内容） ---------- */
  function openEditPlanSheet(id) {
    let item = null;
    try {
      const items = (typeof Store.getPlanItems === 'function') ? Store.getPlanItems(todayStr()) : [];
      item = items.find(i => i.id === id);
    } catch (e) { item = null; }
    if (!item) { toast('未找到该目标，可能已删除'); return; }

    const cats = PLAN_CATS;
    const rows = cats.map(c =>
      '<button class="chip" data-pick-cat="' + c.key + '">' + c.icon + ' ' + c.label + '</button>'
    ).join('');
    openSheet(
      '<div class="field">' +
        '<label>选择分类</label><div class="chips" id="sheetCats">' + rows + '</div>' +
      '</div>' +
      '<div class="field"><label>打卡内容</label>' +
        '<input class="input" id="sheetPlanTitle" value="' + esc(item.title) + '">' +
      '</div>' +
      '<div class="row2">' +
        '<button class="btn btn-ghost" id="sheetPlanCancel">取消</button>' +
        '<button class="btn btn-block" id="sheetPlanOk">保存修改</button>' +
      '</div>',
      '修改打卡目标'
    );
    let selCat = item.category;
    document.getElementById('sheetCats').querySelectorAll('.chip').forEach(c => {
      if (c.getAttribute('data-pick-cat') === selCat) c.classList.add('active');
      c.addEventListener('click', () => {
        document.getElementById('sheetCats').querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selCat = c.getAttribute('data-pick-cat');
      });
    });
    document.getElementById('sheetPlanCancel').addEventListener('click', closeSheet);
    document.getElementById('sheetPlanOk').addEventListener('click', () => {
      const title = document.getElementById('sheetPlanTitle').value.trim();
      if (!title) { toast('请输入打卡内容'); return; }
      if (typeof Store.updatePlanItem === 'function') {
        Store.updatePlanItem(id, { category: selCat, title: title });
      }
      closeSheet();
      toast('✅ 已修改打卡目标');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 修改模块页"今日待办"标题（系统预设项可编辑，保存后全站同步） ---------- */
  function openEditModuleTodoSheet(cat, index) {
    const defs = DEFAULT_MODULE_TODOS[cat];
    if (!defs || index < 0 || index >= defs.length) { toast('无法编辑该待办'); return; }
    const current = getModuleTodoEntries(cat).find(e => e.index === index);
    if (!current) { toast('该待办已删除'); return; }
    openSheet(
      '<div class="field"><label>待办内容</label>' +
        '<input class="input" id="modTodoTitle" value="' + esc(current.title) + '" maxlength="40">' +
      '</div>' +
      '<div class="section-tip" style="color:var(--ink-3);font-size:11px">修改后，该模块页、每日计划页、今日未完成待办会同步更新。</div>' +
      '<div class="row2">' +
        '<button class="btn btn-ghost" id="modTodoCancel">取消</button>' +
        '<button class="btn btn-block" id="modTodoOk">保存修改</button>' +
      '</div>',
      '修改今日待办'
    );
    document.getElementById('modTodoCancel').addEventListener('click', closeSheet);
    document.getElementById('modTodoOk').addEventListener('click', () => {
      const title = document.getElementById('modTodoTitle').value.trim();
      if (!title) { toast('请输入待办内容'); return; }
      updateModuleTodoTitle(cat, index, title);
      closeSheet();
      toast('✅ 已修改，全站已同步');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 删除模块页"今日待办"确认弹窗（保存删除标记，全站同步） ---------- */
  function openDeleteModuleTodoConfirm(cat, index) {
    const defs = DEFAULT_MODULE_TODOS[cat];
    if (!defs || index < 0 || index >= defs.length) { toast('无法删除该待办'); return; }
    const entry = getModuleTodoEntries(cat).find(e => e.index === index);
    if (!entry) { toast('该待办已删除'); return; }
    openSheet(
      '<div class="field" style="text-align:center;font-size:14px;color:var(--ink);padding:6px 0 4px">确定要删除「' + esc(entry.title) + '」吗？</div>' +
      '<div class="section-tip" style="color:var(--ink-3);font-size:11px;text-align:center">删除后，该模块页、每日计划页、今日未完成待办将不再显示此项。</div>' +
      '<div class="row2" style="margin-top:14px">' +
        '<button class="btn btn-ghost" id="modTodoDelCancel">取消</button>' +
        '<button class="btn btn-danger" id="modTodoDelOk">删除</button>' +
      '</div>',
      '删除今日待办'
    );
    document.getElementById('modTodoDelCancel').addEventListener('click', closeSheet);
    document.getElementById('modTodoDelOk').addEventListener('click', () => {
      removeModuleTodo(cat, index);
      closeSheet();
      toast('🗑️ 已删除，全站已同步');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 智能课程规划弹窗（输入课程+课时+天数 → 自动规划每日） ---------- */
  function openSmartPlanSheet() {
    const cats = PLAN_CATS;
    const rows = cats.map(c =>
      '<button class="chip" data-sel-cat="' + c.key + '">' + c.icon + ' ' + c.label + '</button>'
    ).join('');
    openSheet(
      '<div class="field"><label>课程名称</label>' +
        '<input class="input" id="splanName" placeholder="例如：资料分析精讲班">' +
      '</div>' +
      '<div class="field"><label>选择分类</label><div class="chips" id="splanCats">' + rows + '</div></div>' +
      '<div class="row2">' +
        '<div class="field"><label>课时总数</label>' +
          '<input class="input" id="splanTotal" type="number" min="1" placeholder="总课时">' +
        '</div>' +
        '<div class="field"><label>期望完成（天）</label>' +
          '<input class="input" id="splanDays" type="number" min="1" placeholder="天数">' +
        '</div>' +
      '</div>' +
      '<div class="field"><label>课程开始日期</label>' +
        '<input class="input" id="splanStart" type="date" value="' + todayStr() + '">' +
      '</div>' +
      '<div class="plan-preview" id="splanPreview">输入课时、天数与开始日期后，这里会显示每天应学的课时及预计完成日期</div>' +
      '<button class="btn btn-block" id="splanOk">⚡ 自动规划并加入今日计划</button>',
      '⚡ 智能课程规划'
    );

    // 分类选择
    let selCat = 'political';
    document.getElementById('splanCats').querySelectorAll('.chip').forEach(c => {
      if (c.getAttribute('data-sel-cat') === selCat) c.classList.add('active');
      c.addEventListener('click', () => {
        document.getElementById('splanCats').querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selCat = c.getAttribute('data-sel-cat');
      });
    });

    // 实时预览
    const nameEl = document.getElementById('splanName');
    const totalEl = document.getElementById('splanTotal');
    const daysEl = document.getElementById('splanDays');
    const startEl = document.getElementById('splanStart');
    const preview = document.getElementById('splanPreview');
    function updatePreview() {
      const total = parseInt(totalEl.value, 10);
      const days = parseInt(daysEl.value, 10);
      const nm = nameEl.value.trim();
      const start = startEl.value;
      if (!total || total <= 0 || !days || days <= 0 || !start) {
        preview.innerHTML = '输入课时总数、期望天数与开始日期后，将自动显示每天应学的课时及预计完成日期';
        preview.classList.remove('ok');
        return;
      }
      const daily = Math.ceil(total / days);
      const endDate = calcEndDate(start, days);
      preview.innerHTML = '🎯 <b>' + esc(nm || '课程') + '</b><br>共 <b>' + total + '</b> 课时 ÷ <b>' + days + '</b> 天 ≈ 每天学习 <b>' + daily + '</b> 课时' +
        '<br>📅 <b>' + start + '</b> 开始 · <b>' + endDate + '</b> 预计完成' +
        (daily * days > total ? '<br><span class="dim">分配不均，最后几天将略少以补齐 ' + total + ' 课时</span>' : '');
      preview.classList.add('ok');
    }
    [nameEl, totalEl, daysEl, startEl].forEach(el => el.addEventListener('input', updatePreview));
    updatePreview();

    // 保存并规划
    document.getElementById('splanOk').addEventListener('click', () => {
      const nm = nameEl.value.trim();
      const total = parseInt(totalEl.value, 10);
      const days = parseInt(daysEl.value, 10);
      const start = startEl.value;
      if (!nm) { toast('请输入课程名称'); return; }
      if (!total || total <= 0) { toast('课时总数需大于0'); return; }
      if (!days || days <= 0) { toast('期望完成天数需大于0'); return; }
      if (!start) { toast('请选择课程开始日期'); return; }
      const plan = Store.addPlan({ courseName: nm, category: selCat, totalHours: total, days: days, startDate: start });
      // 自动写入今日任务
      seedTodayFromPlans();
      closeSheet();
      const endDate = calcEndDate(start, days);
      toast('✅ 已规划「' + nm + '」，' + start + ' 开课 · ' + endDate + ' 完成');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 编辑课程规划弹窗（修改课程信息） ---------- */
  function openEditCourseSheet(plan) {
    if (!plan || !Store || typeof Store.updatePlan !== 'function') return;
    const cats = PLAN_CATS;
    const rows = cats.map(c =>
      '<button class="chip" data-sel-cat="' + c.key + '">' + c.icon + ' ' + c.label + '</button>'
    ).join('');
    openSheet(
      '<div class="field"><label>课程名称</label>' +
        '<input class="input" id="eplanName" value="' + esc(plan.courseName || '') + '">' +
      '</div>' +
      '<div class="field"><label>选择分类</label><div class="chips" id="eplanCats">' + rows + '</div></div>' +
      '<div class="row2">' +
        '<div class="field"><label>课时总数</label>' +
          '<input class="input" id="eplanTotal" type="number" min="1" value="' + (plan.totalHours || '') + '">' +
        '</div>' +
        '<div class="field"><label>期望完成（天）</label>' +
          '<input class="input" id="eplanDays" type="number" min="1" value="' + (plan.days || '') + '">' +
        '</div>' +
      '</div>' +
      '<div class="field"><label>课程开始日期</label>' +
        '<input class="input" id="eplanStart" type="date" value="' + (plan.startDate || '') + '">' +
      '</div>' +
      '<div class="plan-preview" id="eplanPreview">修改后将自动重新计算每天课时与预计完成日期</div>' +
      '<div class="row2">' +
        '<button class="btn btn-soft" id="eplanCancel" style="flex:1">取消</button>' +
        '<button class="btn btn-block" id="eplanOk" style="flex:2">💾 保存修改</button>' +
      '</div>',
      '✏️ 编辑课程规划'
    );

    // 分类选择
    let selCat = plan.category || 'political';
    document.getElementById('eplanCats').querySelectorAll('.chip').forEach(c => {
      if (c.getAttribute('data-sel-cat') === selCat) c.classList.add('active');
      c.addEventListener('click', () => {
        document.getElementById('eplanCats').querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selCat = c.getAttribute('data-sel-cat');
      });
    });

    // 实时预览
    const nameEl = document.getElementById('eplanName');
    const totalEl = document.getElementById('eplanTotal');
    const daysEl = document.getElementById('eplanDays');
    const startEl = document.getElementById('eplanStart');
    const preview = document.getElementById('eplanPreview');
    function updatePreview() {
      const total = parseInt(totalEl.value, 10);
      const days = parseInt(daysEl.value, 10);
      const nm = nameEl.value.trim();
      const start = startEl.value;
      if (!total || total <= 0 || !days || days <= 0 || !start) {
        preview.innerHTML = '请填写课时总数、期望天数与开始日期';
        preview.classList.remove('ok');
        return;
      }
      const daily = Math.ceil(total / days);
      const endDate = calcEndDate(start, days);
      preview.innerHTML = '🎯 <b>' + esc(nm || '课程') + '</b><br>共 <b>' + total + '</b> 课时 ÷ <b>' + days + '</b> 天 ≈ 每天学习 <b>' + daily + '</b> 课时' +
        '<br>📅 <b>' + start + '</b> 开始 · <b>' + endDate + '</b> 预计完成';
      preview.classList.add('ok');
    }
    [nameEl, totalEl, daysEl, startEl].forEach(el => el.addEventListener('input', updatePreview));
    updatePreview();

    // 取消
    document.getElementById('eplanCancel').addEventListener('click', closeSheet);

    // 保存
    document.getElementById('eplanOk').addEventListener('click', () => {
      const nm = nameEl.value.trim();
      const total = parseInt(totalEl.value, 10);
      const days = parseInt(daysEl.value, 10);
      const start = startEl.value;
      if (!nm) { toast('请输入课程名称'); return; }
      if (!total || total <= 0) { toast('课时总数需大于0'); return; }
      if (!days || days <= 0) { toast('期望完成天数需大于0'); return; }
      if (!start) { toast('请选择课程开始日期'); return; }
      Store.updatePlan(plan.id, { courseName: nm, category: selCat, totalHours: total, days: days, startDate: start });
      seedTodayFromPlans();
      closeSheet();
      toast('✅ 已更新「' + nm + '」');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 数据互通：导出/导入（手机 ↔ 电脑） ---------- */
  function openSyncSheet() {
    // 导出数据概况
    let planCount = 0, mistakeCount = 0, reviewCount = 0;
    try {
      planCount = (Store.getPlans && Store.getPlans() || []).length;
      mistakeCount = (Store.data.mistakes && Store.data.mistakes.items || []).length;
      reviewCount = (Store.getMistakeReviews && Store.getMistakeReviews() || []).length;
    } catch (e) {}
    const overview =
      '课程规划 ' + planCount + ' 项 · 今日目标 ' + (Store.getPlanItems ? Store.getPlanItems(todayStr()).length : 0) +
      ' 条 · 错题 ' + mistakeCount + ' 道 · 复习任务 ' + reviewCount + ' 项';

    const sheetHTML =
      '<div class="sync-tabs">' +
        '<button class="sync-tab active" data-sync-tab="export">📤 导出</button>' +
        '<button class="sync-tab" data-sync-tab="import">📥 导入</button>' +
      '</div>' +
      '<div id="syncExportPanel">' +
        '<div class="section-tip">把本设备数据打包，发到电脑端导入即可互通课程规划、今日目标、错题、复习记录等。</div>' +
        '<div class="sync-overview">' + overview + '</div>' +
        '<button class="btn btn-block" id="syncExportCopy">📋 复制同步码</button>' +
        '<button class="btn btn-block" id="syncExportFile" style="margin-top:8px">📁 导出同步文件</button>' +
        '<div class="section-tip" style="margin-top:10px;color:var(--ink-3);font-size:11px">复制同步码用于同手机内互通；导出同步文件用于手机 → 电脑，无长度限制。</div>' +
      '</div>' +
      '<div id="syncImportPanel" style="display:none">' +
        '<div class="section-tip">粘贴同步码，或选择另一台设备发来的同步文件（.json），即可把数据导入当前设备。</div>' +
        '<textarea class="textarea" id="syncImportText" style="min-height:120px;font-family:monospace;font-size:11px" placeholder="在此粘贴同步码……"></textarea>' +
        '<div class="field" style="margin-top:8px"><label>📁 或直接选择同步文件</label>' +
          '<input type="file" id="syncImportFile" accept=".json,application/json" style="width:100%;font-size:13px">' +
        '</div>' +
        '<div class="field" style="margin-top:10px"><label>导入方式</label>' +
          '<div class="chips" id="syncImportMode">' +
            '<button class="chip active" data-sync-mode="overwrite">🔄 覆盖（推荐）</button>' +
            '<button class="chip" data-sync-mode="merge">➕ 合并</button>' +
          '</div>' +
          '<div class="section-tip" style="margin-top:6px;color:var(--ink-3);font-size:11px">覆盖：用同步码整体替换本设备数据；合并：把同步码并进来（同名覆盖，本设备独有保留）。</div>' +
        '</div>' +
        '<button class="btn btn-block" id="syncImportOk">📥 开始导入</button>' +
      '</div>';

    openSheet(sheetHTML, '🔗 数据互通');
    let importMode = 'overwrite';

    // 页签切换
    document.querySelectorAll('[data-sync-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-sync-tab]').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        const isExport = tab.getAttribute('data-sync-tab') === 'export';
        document.getElementById('syncExportPanel').style.display = isExport ? 'block' : 'none';
        document.getElementById('syncImportPanel').style.display = isExport ? 'none' : 'block';
      });
    });

    // 导出：复制
    document.getElementById('syncExportCopy').addEventListener('click', () => {
      const res = Store.exportAllData();
      const text = res.json;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          toast('✅ 同步码已复制（' + (res.size / 1024).toFixed(1) + ' KB）');
        }).catch(() => { fallbackCopy(text); });
      } else {
        fallbackCopy(text);
      }
    });
    // 导出：生成 .json 文件（无长度限制，推荐用于电脑端同步）
    document.getElementById('syncExportFile').addEventListener('click', () => {
      try {
        const res = Store.exportAllData();
        const blob = new Blob([res.json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const d = new Date();
        const pad = n => (n < 10 ? '0' + n : '' + n);
        const fname = 'workbench-sync-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('✅ 已生成同步文件 ' + fname + '，用微信/QQ/隔空投送发到电脑后导入');
      } catch (e) {
        toast('⚠️ 生成文件失败：' + (e && e.message || e));
      }
    });

    // 导入：方式选择
    document.querySelectorAll('[data-sync-mode]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-sync-mode]').forEach(x => x.classList.remove('active'));
        chip.classList.add('active');
        importMode = chip.getAttribute('data-sync-mode');
      });
    });

    // 导入：选文件时自动把内容填入文本框
    const syncFileInput = document.getElementById('syncImportFile');
    if (syncFileInput) {
      syncFileInput.addEventListener('change', () => {
        const f = syncFileInput.files && syncFileInput.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const ta = document.getElementById('syncImportText');
          if (ta) ta.value = String(reader.result || '');
          toast('📁 已读取文件，点「开始导入」即可');
        };
        reader.onerror = () => toast('⚠️ 文件读取失败');
        reader.readAsText(f);
      });
    }

    // 导入：执行
    document.getElementById('syncImportOk').addEventListener('click', () => {
      const text = document.getElementById('syncImportText').value;
      if (!text.trim()) { toast('请先粘贴同步码或选择同步文件'); return; }
      const res = Store.importAllData(text, importMode);
      if (!res.ok) { toast('⚠️ ' + res.msg); return; }
      closeSheet();
      toast('✅ 导入成功：' + res.importedKeys + ' 项数据（' + (res.mode === 'overwrite' ? '覆盖' : '合并') + '）');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
      if (global.APP && typeof global.APP.updateBadges === 'function') global.APP.updateBadges();
    });
  }

  // 降级复制（clipboard API 不可用时用隐藏输入框）
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('✅ 同步码已复制（' + (text.length / 1024).toFixed(1) + ' KB）');
    } catch (e) {
      toast('⚠️ 复制失败，请长按手动复制');
    }
  }

  /* ---------- 每日自动生成：把今天落在规划期内的课程任务写入每日计划 ---------- */
  function seedTodayFromPlans() {
    try {
      const dateStr = todayStr();
      // 检查新方法是否存在（旧版本 Store 可能没有）
      if (!Store || typeof Store.getPlans !== 'function' || typeof Store.planHoursOn !== 'function') return;
      const allPlans = Store.getPlans() || [];
      const plans = allPlans.filter(p =>
        p && typeof p.courseName === 'string' && p.totalHours > 0 && p.days > 0 && p.startDate
      );
      // 今日已有的打卡标题集合，避免重复生成
      let existing;
      try { existing = new Set(Store.getPlanItems(dateStr).map(i => i.title)); }
      catch (e) { existing = new Set(); }
      plans.forEach(p => {
        const hours = Store.planHoursOn(p, dateStr);
        if (hours <= 0) return;
        const title = '「' + p.courseName + '」今日学习 ' + hours + '/' + p.totalHours + ' 课时';
        if (!existing.has(title)) {
          Store.addPlanItem(p.category, title);
          existing.add(title);
        }
      });
    } catch (e) { /* 静默：plan 自动生成失败不影响主流程 */ }
  }

  // 今日 planToday.items 里,是否有与 plan 同 courseName 的目标已勾选
  // 两级匹配：①以「课程名」开头的标准 title（seedTodayFromPlans 生成）
  // ②title 含 plan.courseName 子串（兼容早期版本/手动添加/字符变体的脏数据）
  function isPlanTodayItemDone(plan) {
    try {
      const dateStr = todayStr();
      const items = (Store.getPlanItems && Store.getPlanItems(dateStr)) || [];
      const prefix = '\u300C' + plan.courseName + '\u300D';
      const cn = String(plan.courseName || '');
      if (items.some(it => it && it.title && it.title.indexOf(prefix) === 0 && it.done === true)) return true;
      if (cn && items.some(it => it && it.title && it.done === true && it.title.indexOf(cn) >= 0)) return true;
      return false;
    } catch (e) { return false; }
  }

  /* ---------- 课程规划进度信息 ----------
   * 算法：startDate~昨天为「已推进天数」，今天按勾选决定。
   * - history 有记录且 done===false → 显式标记未学，扣除 1 天；
   * - history 无记录 → 视为漏打卡，仍计入（避免漏打卡时被算低）。
   * 今天未勾选 → +0。learned 总和 = 已推进天数 − 显式未勾选天数。 */
  function planProgressInfo(plan) {
    const dateStr = todayStr();
    const start = new Date(plan.startDate + 'T00:00:00');
    const now = new Date(dateStr + 'T00:00:00');
    const elapsed = Math.round((now - start) / (1000 * 60 * 60 * 24)); // 已过天数(0基)
    const todayDone = (elapsed >= 0 && elapsed < plan.days) ? isPlanTodayItemDone(plan) : false;
    const priorDays = Math.max(0, Math.min(elapsed + 1, plan.days));
    let learned = 0;
    let skipped = 0; // 因 history 显式标记未完成而被扣除的天数
    for (let k = 0; k < priorDays; k++) {
      const dayDate = new Date(start.getTime() + k * 86400000);
      const dayStr = dayDate.getFullYear() + '-' + String(dayDate.getMonth() + 1).padStart(2, '0') + '-' + String(dayDate.getDate()).padStart(2, '0');
      if (k < elapsed) {
        // 过去天：history 有 done=false 的项 → 扣除；否则视为已学
        const snap = getHistorySnapshot(dayStr);
        const explicitSkip = Array.isArray(snap) && snap.some(function (it) {
          if (!it || it.done !== false) return false;
          if (!it.title) return false;
          const prefix = '\u300C' + plan.courseName + '\u300D';
          return it.title.indexOf(prefix) === 0 || it.title.indexOf(plan.courseName) >= 0;
        });
        if (explicitSkip) {
          skipped++;
        } else {
          learned += Store.planDailyHours(plan, k);
        }
      } else {
        // 今天：只有勾选才算
        if (todayDone) learned += Store.planDailyHours(plan, k);
      }
    }
    const used = Math.max(0, Math.min(elapsed - skipped + (todayDone ? 1 : 0), plan.days));
    const remainingHours = plan.totalHours - learned;
    const remainingDays = plan.days - used;
    const pct = plan.totalHours ? Math.round(learned / plan.totalHours * 100) : 0;
    const end = new Date(start.getTime() + (plan.days - 1) * 86400000);
    const endStr = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
    return {
      learned, remainingHours, remainingDays, pct, used,
      startDate: plan.startDate, endDate: endStr, dailyHours: plan.dailyHours,
      totalHours: plan.totalHours, days: plan.days, finished: learned >= plan.totalHours,
    };
  }

  // 读取 planToday.history 里某天的快照(items 数组,可能是 undefined)
  function getHistorySnapshot(dateStr) {
    try {
      const pt = Store.data && Store.data.planToday;
      if (!pt || !pt.history) return null;
      const snap = pt.history[dateStr];
      return Array.isArray(snap) ? snap : null;
    } catch (e) { return null; }
  }

  // 导出课程进度诊断数据(复制到剪贴板),便于排查进度偏差
  function exportPlanDiagnosis() {
    try {
      const PRE = (Store && Store.PREFIX) ? Store.PREFIX : 'shangan_';
      const plans = localStorage.getItem(PRE + 'plans');
      const pt = localStorage.getItem(PRE + 'planToday');
      const dump = {
        ts: new Date().toISOString(),
        today: todayStr(),
        plans: plans ? JSON.parse(plans) : null,
        planToday: pt ? JSON.parse(pt) : null,
      };
      const text = JSON.stringify(dump, null, 2);
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
      toast(ok ? '📤 诊断数据已复制，发给助手即可定位' : '📤 已生成，请长按选择复制');
    } catch (e) { toast('⚠️ 导出失败：' + (e && e.message)); }
  }

  /* ---------- 补打卡弹窗（补回历史某天漏勾选的课程进度） ---------- */
  function openMakeupSheet(planId) {
    try {
      const plans = (Store && typeof Store.getPlans === 'function') ? Store.getPlans() : [];
      const plan = plans.find(p => p && p.id === planId);
      if (!plan || !plan.courseName) { toast('未找到该课程'); return; }
      const cn = String(plan.courseName);
      const prefix = '「' + cn + '」';
      const today = todayStr();
      const hist = (Store.data && Store.data.planToday && Store.data.planToday.history) || {};
      // 收集 history 里含该课程的日期（截至昨天，今天用正常勾选）
      const dates = Object.keys(hist)
        .filter(d => d < today && Array.isArray(hist[d]) &&
          hist[d].some(it => it && it.title && (it.title.indexOf(prefix) === 0 || (cn && it.title.indexOf(cn) >= 0))))
        .sort().reverse();
      if (!dates.length) {
        openSheet(
          '<div class="plan-preview ok" style="text-align:center;padding:14px">🎉 没有需要补打卡的历史记录<br><span class="dim">该课程在过往日期里都没有「未完成但有记录」的目标，无需补卡</span></div>',
          '📌 补打卡 · ' + esc(cn)
        );
        return;
      }
      const rows = dates.map(d => {
        const arr = hist[d];
        const it = arr.find(x => x && x.title && (x.title.indexOf(prefix) === 0 || (cn && x.title.indexOf(cn) >= 0)));
        const done = !!(it && it.done === true);
        const checked = done ? 'checked disabled' : 'checked';
        const labelCls = done ? 'dim' : '';
        return '<label class="makeup-row">' +
          '<input type="checkbox" class="makeup-chk" data-date="' + d + '" ' + checked + '>' +
          '<span class="makeup-date">' + d + '</span>' +
          '<span class="makeup-status ' + labelCls + '">' + (done ? '✅ 已完成' : '⚠️ 未完成（可补）') + '</span>' +
          '</label>';
      }).join('');
      openSheet(
        '<div class="section-tip">勾选要补打卡的日期，确认后这些天会被标记为已完成，课程进度自动回涨。</div>' +
        '<div class="makeup-list">' + rows + '</div>' +
        '<button class="btn btn-block" id="makeupOk">✅ 确认补打卡</button>',
        '📌 补打卡 · ' + esc(cn)
      );
      document.getElementById('makeupOk').addEventListener('click', () => {
        const sel = [...document.querySelectorAll('.makeup-chk')].filter(c => c.checked && !c.disabled).map(c => c.getAttribute('data-date'));
        if (!sel.length) { toast('请勾选要补的日期'); return; }
        const n = Store.makeupPlanHistory(planId, sel);
        closeSheet();
        toast('📌 已补打卡 ' + n + ' 天，进度已更新');
        const page = document.querySelector('.page.active-page');
        if (page && page.__key) APP.renderPage(page.__key);
        else if (typeof APP.renderPage === 'function') APP.renderPage('plan');
      });
    } catch (e) { toast('⚠️ 补打卡失败：' + (e && e.message)); }
  }

  /* ---------- 待办事项区域（模块专属任务） ---------- */
  function renderTodoArea(container, catKey, title, todos) {
    const html =
      '<div class="card">' +
        '<div class="todo-header">' +
          '<span style="font-size:20px">📌</span>' +
          '<span class="th-title">今日待办 · ' + title + '</span>' +
        '</div>' +
        '<div class="todo-list">' +
          (todos.map((t, i) => {
            const key = 'todo_' + todayStr() + '_' + catKey + '_' + i;
            const done = localStorage.getItem(Store.PREFIX + key) === '1';
            return '<div class="todo-item' + (done ? ' done' : '') + '">' +
              '<div class="todo-check' + (done ? ' checked' : '') + '" data-rtodo="' + key + '">' + (done ? '✓' : '') + '</div>' +
              '<div class="todo-txt' + (done ? ' checked' : '') + '">' + t + '</div>' +
            '</div>';
          }).join('')) +
        '</div>' +
      '</div>';
    container.insertAdjacentHTML('beforeend', html);
  }
  function bindTodoEvents(container) {
    container.addEventListener('click', function (e) {
      const c = e.target.closest('[data-rtodo]');
      if (!c) return;
      const key = c.getAttribute('data-rtodo');
      const on = localStorage.getItem(Store.PREFIX + key) === '1';
      localStorage.setItem(Store.PREFIX + key, on ? '0' : '1');
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
  }

  /* ---------- 每日打卡目标（记录到每日统计） ---------- */
  // 在作答完成后调用：addStat(module, count, minutes, correct, total)
  function logStudy(module, count, minutes, correct, total) {
    Store.addStat(module, count, minutes, correct, total);
    // 学习当天登记艾宾浩斯模块复习（同一天同模块不重复登记）
    try {
      if (typeof Store.addModuleReview === 'function') Store.addModuleReview(module);
    } catch (e) {}
  }

  /* ---------- 通用作答逻辑 ---------- */
  // 渲染一道选择题
  function quizBlock(quiz, onDone) {
    const container = document.createElement('div');
    container.className = 'quiz-block card';
    // 来源标注（若题目有 source 字段则显示）
    const srcHtml = quiz.source
      ? '<div class="quiz-source">📌 ' + esc(quiz.source) + '</div>'
      : '';
    container.innerHTML =
      srcHtml +
      '<div class="quiz-q">' + esc(quiz.q) + '</div>' +
      '<div class="options">' +
        quiz.options.map((op, i) => {
          const letter = 'ABCDEFGH'[i];
          return '<div class="option" data-i="' + i + '"><span class="opt-letter">' + letter + '</span><span>' + esc(op) + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="analysis" style="display:none"></div>' +
      '<div class="quiz-actions">' +
        '<button class="btn btn-sm btn-ghost" data-a="check">查看解析</button>' +
        '<button class="btn btn-sm btn-soft" data-a="next" style="display:none">下一题</button>' +
      '</div>';
    const opts = container.querySelectorAll('.option');
    const ansEl = container.querySelector('.analysis');
    let chosen = null;
    const answerIndex = quiz.answer; // 0-based

    opts.forEach((op, i) => {
      op.addEventListener('click', () => {
        if (chosen !== null) return;
        chosen = i;
        opts.forEach(o => o.disabled = true);
        if (i === answerIndex) {
          op.classList.add('correct');
          toast('🎉 回答正确！');
          if (onDone) onDone(1, quiz.options.length);
        } else {
          op.classList.add('wrong');
          opts[answerIndex].classList.add('correct');
          toast('😢 答错啦，看看解析吧');
          if (onDone) onDone(0, quiz.options.length);
        }
        container.querySelector('[data-a="check"]').style.display = 'none';
        container.querySelector('[data-a="next"]').style.display = 'inline-flex';
      });
    });
    container.querySelector('[data-a="check"]').addEventListener('click', () => {
      const showAns = container.querySelector('.analysis');
      if (chosen === null) {
        // 直接看解析，不计数
        showAns.innerHTML = '<b>正确答案：' + 'ABCDEFGH'[answerIndex] + '</b><br>' + esc(quiz.explain || '');
        showAns.style.display = 'block';
      }
    });
    container.querySelector('[data-a="next"]').addEventListener('click', () => {
      const page = document.querySelector('.page.active-page');
      if (page && page.__key) APP.renderPage(page.__key);
    });
    return container;
  }

  /* ---------- 资料分析·真题题组渲染（材料 + 5 小题） ---------- */
  function quizSetBlock(set, onDone) {
    const container = document.createElement('div');
    container.className = 'quiz-block card';
    // 材料内容允许少量受控 HTML（<br>、<b>、表格），不转义以正常渲染
    container.innerHTML =
      '<div class="quiz-material">' + set.material + '</div>';

    let answeredCount = 0, correctCount = 0;
    const totalCount = set.questions.length;

    set.questions.forEach((quiz, idx) => {
      const sub = document.createElement('div');
      sub.className = 'quiz-sub';
      // 来源标注（每题显示出处）
      const srcHtml = quiz.source
        ? '<div class="quiz-source">📌 ' + esc(quiz.source) + '</div>'
        : '';
      sub.innerHTML =
        srcHtml +
        '<div class="quiz-q">' + (idx + 1) + '. ' + esc(quiz.q) + '</div>' +
        '<div class="options">' +
          quiz.options.map((op, i) => {
            const letter = 'ABCDEFGH'[i];
            return '<div class="option" data-i="' + i + '"><span class="opt-letter">' + letter + '</span><span>' + esc(op) + '</span></div>';
          }).join('') +
        '</div>' +
        '<div class="analysis" style="display:none"></div>' +
        '<div class="quiz-actions">' +
          '<button class="btn btn-sm btn-ghost" data-a="check">查看解析</button>' +
        '</div>';
      container.appendChild(sub);

      const opts = sub.querySelectorAll('.option');
      const ansEl = sub.querySelector('.analysis');
      let chosen = null;
      const answerIndex = quiz.answer;

      opts.forEach((op, i) => {
        op.addEventListener('click', () => {
          if (chosen !== null) return;
          chosen = i;
          opts.forEach(o => o.disabled = true);
          if (i === answerIndex) {
            op.classList.add('correct');
            toast('🎉 第' + (idx + 1) + '题正确！');
            correctCount++;
          } else {
            op.classList.add('wrong');
            opts[answerIndex].classList.add('correct');
            toast('😢 第' + (idx + 1) + '题答错啦，看看解析吧');
          }
          answeredCount++;
          sub.querySelector('[data-a="check"]').style.display = 'none';
          if (answeredCount === totalCount) {
            if (onDone) onDone(correctCount, totalCount);
          }
        });
      });
      sub.querySelector('[data-a="check"]').addEventListener('click', () => {
        if (chosen === null) {
          ansEl.innerHTML = '<b>正确答案：' + 'ABCDEFGH'[answerIndex] + '</b><br>' + esc(quiz.explain || '');
          ansEl.style.display = 'block';
        }
      });
    });

    return container;
  }

  /* ---------- 收藏/学习进度（通用） ---------- */

  global.Utils = {
    pad, todayStr, daysUntil, weekKey, fmtDate,
    detectOnline, updateConnUI, toast,
    openSheet, closeSheet,
    esc, catInfo, catTag, PLAN_CATS,
    MODULE_TODOS, todoKey, todoDone, toggleTodo, pendingTodos,
    getModuleTodos, getModuleTodoEntries, getAllModuleTodos, updateModuleTodoTitle, removeModuleTodo,
    migrateModuleTodosV2,
    openEditModuleTodoSheet, openDeleteModuleTodoConfirm,
    progressHTML, renderModuleDailyPlan, bindPlanEvents,
    renderTodoArea, bindTodoEvents, logStudy, quizBlock, quizSetBlock,
    dqSave, dqLoad, dqProgress, dqTodoIndex, cumulativeQuizCount, getModuleQuizTotal, migrateStatsDedup, flushAllDqStats,
    openAddPlanSheet, openEditPlanSheet, openEditCourseSheet, openSmartPlanSheet, seedTodayFromPlans, planProgressInfo,
    openSyncSheet, exportPlanDiagnosis, openMakeupSheet,
  };
})(window);
