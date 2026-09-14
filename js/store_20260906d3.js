/* ============================================================
   store.js — 数据存储层 (localStorage)
   所有数据本地保存，自动同步、自动保存
   ============================================================ */
(function (global) {
  'use strict';

  const PREFIX = 'shangan_';
  const store = {
    version: 1,
  };

  /* ---------- 内部工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weekKey(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const year = d.getFullYear();
    const start = new Date(year, 0, 1);
    const dayOfYear = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const week = Math.floor(dayOfYear / 7) + 1;
    return year + '-W' + pad(week);
  }

  // 安全读写 localStorage
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, val) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(val));
      return true;
    } catch (e) {
      toast('⚠️ 存储空间不足，数据可能无法保存');
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  /* ---------- 默认数据 ---------- */

  // 考试类型与日期
  const DEFAULT_EXAMS = [
    { id: 'fj2025', name: '福建省考', date: '', icon: '🎯' },
  ];

  // 每日计划：打卡目标
  const DEFAULT_PLAN_TODAY = {
    date: '', // 对应日期 YYYY-MM-DD
    items: [],
  };

  // 各模块打卡记录
  // politics/common/language/logic/quantity/data
  const DEFAULT_MODULES = {
    politics:   { done: [], lastDate: '' },
    common:     { done: [], lastDate: '' },
    language:   { done: [], lastDate: '' },
    logic:      { done: [], lastDate: '' },
    quantity:   { done: [], lastDate: '' },
    data:       { done: [], lastDate: '' },
    essay:      { done: [], lastDate: '' },   // 申论小题
    composition:{ done: [], lastDate: '' },   // 大作文
  };

  // 每日统计：做题记录
  const DEFAULT_STATS = {
    records: [], // { id, date, module, count, durationMin, correct, total, ts }
  };

  // 错题本
  const DEFAULT_MISTAKES = {
    items: [], // { id, date, module, category, note, image, voiceText, week }
  };

  // 长期课程规划（智能规划）
  // 每条 plan: { id, courseName, category, totalHours, days, dailyHours, startDate, createdTs }
  const DEFAULT_PLANS = { plans: [] };

  // 艾宾浩斯复习（遗忘曲线）
  // 第1天为学习/录入日，之后按间隔复习
  const DEFAULT_REVIEWS = { moduleReviews: [], mistakeReviews: [], memoryReviews: [] };
  // 每个模块：{ id, module, learnDate, lastReviewDate } —— learnDate 记录首次学习
  // 每条错题复习：{ id, mistakeId, learnDate, lastReviewDate, round }
  // 每条记忆复习：{ id, memoryKey, memoryType, learnDate, lastReviewDate } —— memoryKey 唯一标识某条口诀/知识点

  // 每日记忆小测验结果
  // 结构: { days: { 'YYYY-MM-DD': [{ key, type, result:'known'|'unknown'|'pending', ts }] } }
  // key 为记忆条目稳定标识（如 'kj:1' 口诀 / 'kd:高质量发展' 考点 / 'fm:现期量' 公式 / 'id:a-b' 成语）
  const DEFAULT_MEMORY_QUIZ = { days: {} };

  // 全局设置
  const DEFAULT_SETTINGS = {
    examDate: '',         // 主考试日期
    examName: '福建省考',
    connected: true,
    themeMode: 'day',     // 主题模式：day(莫兰迪日间) / night(夜间) / eye(护眼)
    dayPalette: 'mist',   // 日间模式下的莫兰迪色板：mist(雾霾蓝) / sage(烟青绿) / rose(樱粉) / oat(燕麦黄) / mauve(雾紫) / latte(浅茶) / moss(豆沙绿) / blend(灰玫)
  };
  // 有效的日间色板 id 集合（用于白名单校验，防止 settings 损坏或外部篡改导致异常主题）
  const DAY_PALETTES = ['mist', 'sage', 'rose', 'oat', 'mauve', 'latte', 'moss', 'blend'];

  /* ============================================================
     数据正确性校验 (Data Integrity)
     ============================================================
     三大机制：
       1. 启动自检 + 损坏隔离：遍历所有 shangan_ key 逐个 JSON.parse，
          非法 JSON / 非对象项移入备份区(shangan_corrupt_backup)并重置默认。
       2. 核心数据 schema 校验：对每类数据做类型/必填字段/数值范围/日期格式校验，
          可修复项自动修正，不可修复项删除（损坏条目标记后重写）。
       3. 导入同步码强化校验：导入时逐 key 解析 + 复用 schema 校验，
          非法项跳过并汇总提示。
   ============================================================ */

  // 备份区 key（存放所有被隔离的损坏数据）
  const CORRUPT_BACKUP_KEY = PREFIX + '_corrupt_backup';

  // 日期格式校验 YYYY-MM-DD（空串合法）
  function _isDateStr(v) {
    if (v === '' || v === null || v === undefined) return true;
    if (typeof v !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }
  // 有限非负数字（数值或可转数字的字符串），返回修正后的数值或 -1
  function _num(v, max) {
    let n = Number(v);
    if (v === null || v === undefined || isNaN(n)) return -1;
    if (n < 0) n = 0;
    if (typeof max === 'number' && n > max) n = max;
    return n;
  }
  // 确保 obj[key] 是数组，非数组则重建为空数组（记录隔离）
  function _ensureArr(obj, key, repaired) {
    if (!Array.isArray(obj[key])) {
      if (obj[key] !== undefined && obj[key] !== null) repaired.push('`' + key + '` 应为数组');
      obj[key] = [];
    }
  }
  // 备份一份损坏数据到备份区（追加），返回 true
  function _backupRaw(key, raw) {
    try {
      const backup = JSON.parse(localStorage.getItem(CORRUPT_BACKUP_KEY) || '{}');
      const list = Array.isArray(backup.entries) ? backup.entries : (backup.entries = []);
      if (list.length > 50) list.splice(0, list.length - 50); // 限制容量
      list.push({ key, raw: String(raw || '').slice(0, 20000), ts: Date.now() });
      localStorage.setItem(CORRUPT_BACKUP_KEY, JSON.stringify(backup));
    } catch (e) {}
  }

  // 可校验的核心 key 集合（saveAll / _readAll 会读写的正式 key）
  const CORE_KEYS = ['exams', 'planToday', 'modules', 'stats', 'mistakes', 'plans', 'reviews', 'settings', 'memoryQuiz'];

  /* ---- 各类数据的 schema 校验函数：输入对象引用，就地修正并返回修复记录 ---- */

  // exams: [{ id, name, date, icon }]
  function _vExams(obj, repaired) {
    _ensureArr(obj, 'exams', repaired);
    obj.exams = obj.exams.filter(ex => {
      if (!ex || typeof ex !== 'object') { repaired.push('exams 存在非法条目已移除'); return false; }
      if (typeof ex.id !== 'string' || ex.id === '') { repaired.push('考试缺少 id 已移除'); return false; }
      if (typeof ex.name !== 'string') ex.name = '考试';
      if (!_isDateStr(ex.date)) { repaired.push('考试日期格式非法已重置'); ex.date = ''; }
      return true;
    });
  }
  // planToday: { date, items:[{id,category,title,done,ts}] }
  function _vPlanToday(obj, repaired) {
    if (!obj.planToday || typeof obj.planToday !== 'object') { repaired.push('planToday 结构异常已重置'); obj.planToday = { date: '', items: [] }; }
    const pt = obj.planToday;
    if (!_isDateStr(pt.date)) { repaired.push('planToday.date 格式非法已重置'); pt.date = ''; }
    _ensureArr(pt, 'items', repaired);
    pt.items = pt.items.filter(it => it && typeof it === 'object' && (typeof it.title === 'string'));
    pt.items.forEach(it => {
      if (typeof it.category !== 'string') it.category = 'political';
      if (typeof it.done !== 'boolean') it.done = !!it.done;
    });
    // 去重自愈：同一 title 的 item 只保留一条（保留已勾选状态），避免"重复 id 命中错误条目"导致勾选失效
    if (!pt.history || typeof pt.history !== 'object') pt.history = {};
    const seenTitle = {};
    const deduped = [];
    pt.items.forEach(it => {
      const key = it.title;
      if (seenTitle[key]) {
        if (it.done && !seenTitle[key].done) seenTitle[key].done = true;
      } else {
        seenTitle[key] = it;
        deduped.push(it);
      }
    });
    if (deduped.length !== pt.items.length) {
      repaired.push('planToday.items 重复标题已合并');
      pt.items = deduped;
    }
  }
  // modules: { key: { done:[], lastDate } }
  function _vModules(obj, repaired) {
    if (!obj.modules || typeof obj.modules !== 'object') { repaired.push('modules 结构异常已重置'); obj.modules = {}; }
    const M = obj.modules;
    Object.keys(M).forEach(k => {
      const m = M[k];
      if (!m || typeof m !== 'object') { repaired.push('模块 ' + k + ' 非法已移除'); delete M[k]; return; }
      _ensureArr(m, 'done', repaired);
      m.done = m.done.filter(d => d && typeof d === 'object' && typeof d.title === 'string');
      m.done.forEach(d => {
        if (!_isDateStr(d.date)) { repaired.push('模块打卡日期非法已修正'); d.date = ''; }
        if (typeof d.ts !== 'number') d.ts = Date.now();
        if (typeof d.checked !== 'boolean') d.checked = true;
      });
      if (!_isDateStr(m.lastDate)) { repaired.push('模块 ' + k + ' lastDate 非法已修正'); m.lastDate = ''; }
    });
  }
  // stats: { records:[{id,date,module,count,durationMin,correct,total,ts}] }  关键：correct<=total
  function _vStats(obj, repaired) {
    if (!obj.stats || typeof obj.stats !== 'object') { repaired.push('stats 结构异常已重置'); obj.stats = { records: [] }; }
    _ensureArr(obj.stats, 'records', repaired);
    obj.stats.records = obj.stats.records.filter(r => r && typeof r === 'object');
    obj.stats.records.forEach(r => {
      if (typeof r.id !== 'string' || r.id === '') r.id = 's' + Date.now() + Math.floor(Math.random() * 1000);
      if (!_isDateStr(r.date)) { repaired.push('做题记录日期非法已修正'); r.date = ''; }
      if (typeof r.module !== 'string') r.module = '行测';
      const c = _num(r.correct, 100000); const t = _num(r.total, 100000);
      if (c < 0) { repaired.push('做题正确数非法已归零'); r.correct = 0; }
      else if (c > t && t >= 0) { repaired.push('做题正确数>总数已修正为总数'); r.correct = t; }
      if (t < 0) { repaired.push('做题总数非法已归零'); r.total = 0; }
      const co = _num(r.count, 100000); if (co < 0) { r.count = 0; }
      const du = _num(r.durationMin, 100000); if (du < 0) { r.durationMin = 0; }
      if (typeof r.ts !== 'number') r.ts = Date.now();
    });
  }
  // mistakes: { items:[{id,date,module,category,note,...}] }
  function _vMistakes(obj, repaired) {
    if (!obj.mistakes || typeof obj.mistakes !== 'object') { repaired.push('mistakes 结构异常已重置'); obj.mistakes = { items: [] }; }
    _ensureArr(obj.mistakes, 'items', repaired);
    obj.mistakes.items = obj.mistakes.items.filter(i => i && typeof i === 'object' && typeof i.id === 'string' && i.id !== '');
    obj.mistakes.items.forEach(i => {
      if (!_isDateStr(i.date)) { repaired.push('错题日期非法已修正'); i.date = ''; }
      if (typeof i.module !== 'string') i.module = '行测';
      ['category', 'note', 'stem', 'answer', 'myAnswer', 'analysis', 'knowledge', 'image', 'voiceText', 'week']
        .forEach(f => { if (typeof i[f] !== 'string') i[f] = ''; });
    });
  }
  // plans: { plans:[{id,courseName,category,totalHours,days,dailyHours,startDate,createdTs}] }
  function _vPlans(obj, repaired) {
    if (!obj.plans || typeof obj.plans !== 'object') { repaired.push('plans 结构异常已重置'); obj.plans = { plans: [] }; }
    _ensureArr(obj.plans, 'plans', repaired);
    obj.plans.plans = obj.plans.plans.filter(p => p && typeof p === 'object' && typeof p.courseName === 'string');
    obj.plans.plans.forEach(p => {
      const h = _num(p.totalHours, 100000); if (h < 0) { p.totalHours = 0; } else { p.totalHours = h; }
      const d = _num(p.days, 100000); if (d < 0) { p.days = 1; } else { p.days = d || 1; }
      const dh = _num(p.dailyHours, 100000);
      p.dailyHours = dh >= 0 ? dh : (p.totalHours && p.days ? Math.ceil(p.totalHours / p.days) : 0);
      if (typeof p.category !== 'string') p.category = 'political';
      if (!_isDateStr(p.startDate)) { repaired.push('课程规划日期非法已修正'); p.startDate = ''; }
      if (typeof p.createdTs !== 'number') p.createdTs = Date.now();
    });
  }
  // reviews: { moduleReviews:[], mistakeReviews:[], memoryReviews:[] }
  function _vReviews(obj, repaired) {
    if (!obj.reviews || typeof obj.reviews !== 'object') { repaired.push('reviews 结构异常已重置'); obj.reviews = { moduleReviews: [], mistakeReviews: [], memoryReviews: [] }; }
    const R = obj.reviews;
    _ensureArr(R, 'moduleReviews', repaired);
    _ensureArr(R, 'mistakeReviews', repaired);
    _ensureArr(R, 'memoryReviews', repaired);
    R.moduleReviews = R.moduleReviews.filter(r => r && typeof r === 'object' && typeof r.id === 'string');
    R.mistakeReviews = R.mistakeReviews.filter(r => r && typeof r === 'object' && typeof r.id === 'string');
    R.memoryReviews = R.memoryReviews.filter(r => r && typeof r === 'object' && typeof r.id === 'string');
    [R.moduleReviews, R.mistakeReviews, R.memoryReviews].forEach(arr => arr.forEach(r => {
      if (!_isDateStr(r.learnDate)) { repaired.push('复习学习日期非法已修正'); r.learnDate = ''; }
      if (!_isDateStr(r.lastReviewDate)) r.lastReviewDate = '';
      if (typeof r.module !== 'string' && typeof r.module !== 'undefined') r.module = '';
    }));
  }
  // settings: { examDate, examName, connected, themeMode, dayPalette }
  function _vSettings(obj, repaired) {
    if (!obj.settings || typeof obj.settings !== 'object') { repaired.push('settings 结构异常已重置'); obj.settings = { examDate: '', examName: '福建省考', connected: true, themeMode: 'day', dayPalette: 'mist' }; }
    const s = obj.settings;
    if (!_isDateStr(s.examDate)) { repaired.push('考试日期设置非法已重置'); s.examDate = ''; }
    if (typeof s.examName !== 'string') s.examName = '福建省考';
    if (typeof s.connected !== 'boolean') s.connected = !!s.connected;
    if (!['day', 'night', 'eye'].includes(s.themeMode)) s.themeMode = 'day';
    if (typeof s.dayPalette !== 'string' || !DAY_PALETTES.includes(s.dayPalette)) s.dayPalette = 'mist';
  }
  // memoryQuiz: { days: { 'YYYY-MM-DD': [{key,type,result,ts}] } }
  function _vMemoryQuiz(obj, repaired) {
    if (!obj.memoryQuiz || typeof obj.memoryQuiz !== 'object') { repaired.push('memoryQuiz 结构异常已重置'); obj.memoryQuiz = { days: {} }; }
    const MQ = obj.memoryQuiz;
    if (typeof MQ.days !== 'object' || MQ.days === null || Array.isArray(MQ.days)) { repaired.push('memoryQuiz.days 异常已重置'); MQ.days = {}; }
    Object.keys(MQ.days).forEach(dateStr => {
      if (!_isDateStr(dateStr)) { repaired.push('记忆测验日期非法已清理'); delete MQ.days[dateStr]; return; }
      if (!Array.isArray(MQ.days[dateStr])) { repaired.push('记忆测验记录异常已清理'); delete MQ.days[dateStr]; return; }
      MQ.days[dateStr] = MQ.days[dateStr].filter(it => it && typeof it === 'object' && typeof it.key === 'string' && it.key !== '');
      MQ.days[dateStr].forEach(it => {
        if (!['known', 'unknown', 'pending'].includes(it.result)) it.result = 'pending';
        if (typeof it.type !== 'string') it.type = '';
        if (typeof it.ts !== 'number') it.ts = Date.now();
      });
    });
    // 清理超过60天的旧记录，防止无限增长
    const cutoff = todayStr();
    const keys = Object.keys(MQ.days);
    if (keys.length > 60) {
      keys.sort();
      keys.slice(0, keys.length - 60).forEach(k => delete MQ.days[k]);
    }
  }

  // 统一入口：对单个核心数据对象执行全部 schema 校验，就地修正
  // 返回 { repairedCount, issues:[...] }
  function _validate(dataObj) {
    const repaired = [];
    try { _vExams(dataObj, repaired); } catch (e) {}
    try { _vPlanToday(dataObj, repaired); } catch (e) {}
    try { _vModules(dataObj, repaired); } catch (e) {}
    try { _vStats(dataObj, repaired); } catch (e) {}
    try { _vMistakes(dataObj, repaired); } catch (e) {}
    try { _vPlans(dataObj, repaired); } catch (e) {}
    try { _vReviews(dataObj, repaired); } catch (e) {}
    try { _vSettings(dataObj, repaired); } catch (e) {}
    try { _vMemoryQuiz(dataObj, repaired); } catch (e) {}
    return { repairedCount: repaired.length, issues: repaired };
  }

  // 启动自检 + 损坏隔离：
  //   * 遍历所有 shangan_ 前缀 key，非备份区/非 JSON/非法项 → 移入备份区并移除原 key
  //   * 对 8 个核心 key 执行 schema 校验，有修复则重写
  // 返回 { isolated:[key...], repaired:issues }，供 UI 提示
  function _selfCheck() {
    const isolated = [];
    const toRemove = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        if (k === CORRUPT_BACKUP_KEY) continue; // 备份区自身不校验
        const raw = localStorage.getItem(k);
        if (raw === null) continue;
        let val = null;
        try { val = JSON.parse(raw); } catch (e) { val = null; }
        // 仅核心 key 要求为对象；其余 shangan_* key（如 modtodo_*、inited）容忍任意合法 JSON
        if (val === null) {
          // 非法 JSON 或值为 null/undefined → 隔离
          _backupRaw(k, raw);
          isolated.push(k);
          toRemove.push(k);
          continue;
        }
        // 核心 key 结构检查：exams 顶层为数组（合法）；其余核心数据顶层为普通对象
        const shortKey = k.slice(PREFIX.length);
        const isExams = shortKey === 'exams';
        const structurallyInvalid =
          typeof val !== 'object' || val === null ||
          (isExams ? !Array.isArray(val) : Array.isArray(val));
        if (CORE_KEYS.indexOf(shortKey) >= 0 && structurallyInvalid) {
          _backupRaw(k, raw);
          isolated.push(k);
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) {}

    // 核心数据 schema 校验（在隔离之后进行，确保读到的都是对象）
    let issues = [];
    try {
      const d = _readAll();
      const r = _validate(d);
      issues = r.issues;
      if (r.repairedCount > 0) saveAll();
    } catch (e) {}

    return { isolated, issues };
  }

  /* ---------- 数据访问器 ---------- */
  // 读取单个核心 key，并做一次结构兜底：非法时返回默认值（不会抛出）
  // 注意：exams 顶层本身就是数组，因此数组同样保留；结构合法性交由 schema 校验(_validate)与自检(_selfCheck)把关
  function _readCore(key, fallback) {
    const val = read(key, fallback);
    if (val === null || val === undefined) return fallback;
    if (typeof val !== 'object') return fallback; // 非对象（数字/字符串/布尔）一律回退默认
    return val;
  }
  function _readAll() {
    return {
      exams:    _readCore('exams', DEFAULT_EXAMS),
      planToday: _readCore('planToday', DEFAULT_PLAN_TODAY),
      modules:  _readCore('modules', DEFAULT_MODULES),
      stats:    _readCore('stats', DEFAULT_STATS),
      mistakes: _readCore('mistakes', DEFAULT_MISTAKES),
      plans:    _readCore('plans', DEFAULT_PLANS),
      reviews:  _readCore('reviews', DEFAULT_REVIEWS),
      settings: _readCore('settings', DEFAULT_SETTINGS),
      memoryQuiz: _readCore('memoryQuiz', DEFAULT_MEMORY_QUIZ),
    };
  }
  let data = _readAll();

  // 模块加载时执行一次启动自检：隔离损坏数据 + 修复核心 schema
  // 结果暂存，供外部读取（app 启动后展示给用户）
  const __startupCheck = (function () {
    try { return _selfCheck(); } catch (e) { return { isolated: [], issues: [] }; }
  })();
  // 自检可能隔离/修复了数据，重新读取以反映最终状态
  data = _readAll();

  // 重新从 localStorage 读取（当外部修改了 localStorage 后调用），并做 schema 校验/修复
  function reload() {
    data = _readAll();
    try {
      const r = _validate(data);
      if (r.repairedCount > 0) saveAll();
    } catch (e) {}
  }

  function saveAll() {
    write('exams', data.exams);
    write('planToday', data.planToday);
    write('modules', data.modules);
    write('stats', data.stats);
    write('mistakes', data.mistakes);
    write('plans', data.plans);
    write('reviews', data.reviews);
    write('settings', data.settings);
    write('memoryQuiz', data.memoryQuiz);
  }

  function save(key) {
    write(key, data[key]);
  }

  /* ---------- 业务方法 ---------- */

  // 考试列表增删
  function addExam(name, date, icon) {
    const exam = { id: 'exam_' + Date.now(), name: name || '考试', date: date || '', icon: icon || '🎯' };
    data.exams.push(exam);
    save('exams');
    return exam;
  }
  function removeExam(id) {
    data.exams = data.exams.filter(e => e.id !== id);
    save('exams');
  }

  // 获取主考试日期（优先 settings.examDate；未设置时回退到"我的考试"中第一个设置了日期的考试）
  function getExamDate() {
    if (data.settings.examDate) return data.settings.examDate;
    const first = (data.exams || []).find(e => e && e.date && _isDateStr(e.date));
    return first ? first.date : '';
  }
  function setExamDate(d) {
    data.settings.examDate = d || '';
    save('settings');
  }
  // 名称与日期来自同一来源：settings.examDate 已设置时用 settings；否则跟随 exams 第一个有日期的考试
  function getExamName() {
    if (data.settings.examDate) return data.settings.examName || '考试';
    const first = (data.exams || []).find(e => e && e.date && _isDateStr(e.date));
    return first ? (first.name || '考试') : (data.settings.examName || '福建省考');
  }
  function setExamName(n) {
    data.settings.examName = n || '福建省考';
    save('settings');
  }

  // 主题模式：day(莫兰迪日间) / night(夜间) / eye(护眼)
  function getThemeMode() {
    return ['day', 'night', 'eye'].includes(data.settings.themeMode) ? data.settings.themeMode : 'day';
  }
  function setThemeMode(m) {
    if (['day', 'night', 'eye'].includes(m)) data.settings.themeMode = m;
    else data.settings.themeMode = 'day';
    save('settings');
  }
  // 日间色板：仅在 themeMode === 'day' 时生效；非法值回退 'mist'
  function getDayPalette() {
    return DAY_PALETTES.includes(data.settings.dayPalette) ? data.settings.dayPalette : 'mist';
  }
  function setDayPalette(p) {
    data.settings.dayPalette = DAY_PALETTES.includes(p) ? p : 'mist';
    save('settings');
    return data.settings.dayPalette;
  }

  // 今日打卡目标
  // data.planToday 结构: { date: 'YYYY-MM-DD', history: { 'YYYY-MM-DD': [...items 副本...] }, items: [...] }
  // history 用来回溯过去任意一天的目标勾选状态,使 planProgressInfo 能精确计算"过去 N 天中已学几天"
  function getPlanItems(dateStr) {
    if (data.planToday.date !== dateStr) {
      // 切日:先把前一天的 items 深拷贝到 history(精确回溯过去每一天的勾选状态)
      if (_isDateStr(data.planToday.date) && Array.isArray(data.planToday.items) && data.planToday.items.length) {
        if (!data.planToday.history || typeof data.planToday.history !== 'object') {
          data.planToday.history = {};
        }
        // 仅当 history 里没有该日期快照时写入(避免重复)
        if (!data.planToday.history[data.planToday.date]) {
          data.planToday.history[data.planToday.date] = JSON.parse(JSON.stringify(data.planToday.items));
        }
      }
      data.planToday.date = dateStr;
      data.planToday.items = [];
      save('planToday');
    }
    // 兼容迁移：早期版本只有合并的"shenlun"分类，现已拆为"essay（申论·小题）"和"composition（申论·大作文）"
    // 旧 category === 'shenlun' 的目标无感迁移到 essay（申论·小题）
    let migrated = false;
    (data.planToday.items || []).forEach(it => {
      if (it && it.category === 'shenlun') { it.category = 'essay'; migrated = true; }
    });
    if (migrated) save('planToday');
    // 读取时强制去重自愈：同名 title 只保留一条（合并 done 状态），
    // 杜绝“重复 id 命中错误条目”或脏数据导致勾选失效。
    // 历史遗留数据中可能存在多条同名但 id 不同的目标（早期版本用 Date.now() 生成 id），
    // 此处统一归并，保证渲染出去的 id 与 items 内存储的 id 完全一致。
    const titleMap = {};
    const cleaned = [];
    (data.planToday.items || []).forEach(it => {
      if (!it || typeof it.title !== 'string') return;
      if (titleMap[it.title]) {
        if (it.done && !titleMap[it.title].done) titleMap[it.title].done = true;
      } else {
        titleMap[it.title] = it;
        cleaned.push(it);
      }
    });
    if (cleaned.length !== (data.planToday.items || []).length) {
      data.planToday.items = cleaned;
      save('planToday');
    }
    return data.planToday.items;
  }
  // 查询某个历史日期里,与 plan 同课程的目标是否被勾选
  // 两级匹配：①以「课程名」开头的标准 title（seedTodayFromPlans 生成）
  // ②title 含 plan.courseName 子串（兼容早期版本/手动添加/字符变体的脏数据）
  function isPlanHistoryItemDone(plan, dateStr) {
    try {
      const hist = (data.planToday && data.planToday.history) || {};
      const arr = hist[dateStr] || [];
      const prefix = '\u300C' + plan.courseName + '\u300D';
      const cn = String(plan.courseName || '');
      if (arr.some(it => it && it.title && it.title.indexOf(prefix) === 0 && it.done === true)) return true;
      if (cn && arr.some(it => it && it.title && it.done === true && it.title.indexOf(cn) >= 0)) return true;
      return false;
    } catch (e) { return false; }
  }
  // 基于 title 生成稳定 id：同一天同一 title 永远对应唯一 id，杜绝重复生成与"重复 id 命中错误条目"
  // 补打卡：把历史某（几）天里该课程的目标标记为已完成。
  // 用于「某天忘了在应用里勾选、但实际学了」的场景，补回后被扣减的进度自动回涨。
  // 注意：只改写 history[date] 里对应条目的 done，不动其它日期；
  // 即使之后切日（ensureToday 只会把「当前 items」复制到 history[切出当天]），
  // 也不会回写已补的旧历史天，因此补卡结果持久。
  function makeupPlanHistory(planId, dates) {
    try {
      const plans = getPlans();
      const plan = plans.find(p => p && p.id === planId);
      if (!plan || !plan.courseName) return 0;
      const cn = String(plan.courseName);
      const prefix = '「' + cn + '」';
      const today = todayStr();
      const hist = (data.planToday && data.planToday.history) || {};
      let changed = 0;
      (dates || []).forEach(dateStr => {
        if (!hist[dateStr] || !Array.isArray(hist[dateStr])) return;
        hist[dateStr].forEach(it => {
          if (!it || !it.title) return;
          const match = it.title.indexOf(prefix) === 0 || (cn && it.title.indexOf(cn) >= 0);
          if (match && it.done !== true) {
            it.done = true;
            it.ts = Date.now();
            changed++;
          }
        });
        // 若补的正好是今天，联动当前 items 的勾选态
        if (dateStr === today) {
          (getPlanItems(today) || []).forEach(it => {
            if (it && it.title && (it.title.indexOf(prefix) === 0 || (cn && it.title.indexOf(cn) >= 0)) && it.done !== true) {
              it.done = true;
              changed++;
            }
          });
        }
      });
      if (changed) save('planToday');
      return changed;
    } catch (e) { return 0; }
  }
  function planItemId(title) {
    let h = 0;
    const s = String(title || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'pl' + h.toString(36);
  }
  function addPlanItem(category, title) {
    const dateStr = todayStr();
    const items = getPlanItems(dateStr);
    // 已存在相同 title 的，直接复用其 id（避免重复 id / 重复条目）
    let it = items.find(i => i && i.title === title);
    if (!it) {
      const id = planItemId(title);
      it = { id, category, title, done: false, ts: Date.now() };
      items.push(it);
      save('planToday');
    } else {
      it.category = category;
    }
    // 同时登记到模块打卡记录，保证"每日计划"区显示
    registerModuleTodo(category, title);
    return it.id;
  }
  function togglePlanItem(id, title) {
    const dateStr = todayStr();
    const items = getPlanItems(dateStr);
    let it = items.find(i => i.id === id);
    // 兜底：id 命中失败时按 title 匹配（应对脏数据里残留的旧 id）
    if (!it && title) it = items.find(i => i.title === title);
    if (!it) return;
    it.done = !it.done;
    // 同步所有同名条目，消灭残留的“幽灵”副本，避免勾选看起来不生效
    items.forEach(o => { if (o !== it && o.title === it.title) o.done = it.done; });
    save('planToday');
    // 同步模块打卡状态
    if (it.done) markModuleDone(it.category, it.title);
    else unmarkModuleDone(it.category, it.title);
  }
  function removePlanItem(id) {
    const dateStr = todayStr();
    data.planToday.items = data.planToday.items.filter(i => i.id !== id);
    save('planToday');
  }
  // 清空今日目标（保留 date / history），用于脏数据自愈。清空后由 seedTodayFromPlans 重新生成干净的课程任务
  function clearPlanToday() {
    if (!data.planToday || typeof data.planToday !== 'object') {
      data.planToday = { date: todayStr(), history: {}, items: [] };
    }
    data.planToday.items = [];
    save('planToday');
  }
  // 修改今日打卡目标（分类 / 内容），并同步模块打卡记录
  function updatePlanItem(id, patch) {
    const dateStr = todayStr();
    const items = getPlanItems(dateStr);
    const it = items.find(i => i.id === id);
    if (!it) return null;
    const oldCategory = it.category, oldTitle = it.title;
    if (patch && typeof patch.category === 'string') it.category = patch.category;
    if (patch && typeof patch.title === 'string') it.title = patch.title.trim() || it.title;
    save('planToday');
    // 若分类或内容变化，同步模块打卡记录：注销旧的、登记新的
    if ((it.category !== oldCategory || it.title !== oldTitle)) {
      const m = data.modules[oldCategory];
      if (m) {
        m.done = (m.done || []).filter(d => !(d.date === dateStr && d.title === oldTitle));
        if (m.done.length === 0) delete data.modules[oldCategory];
        save('modules');
      }
      registerModuleTodo(it.category, it.title);
    }
    return it;
  }
  function planProgress(dateStr) {
    const items = getPlanItems(dateStr);
    const total = items.length;
    const done = items.filter(i => i.done).length;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  // 模块 todo：同一目标当天只完成一次（防重复打卡）
  // checked 可选：渲染待办列表时传入当前勾选态，保证进度分母=待办数且勾选态一致
  function registerModuleTodo(cat, title, checked) {
    // 兼容迁移：早期合并的 shenlun 分类 → essay（申论·小题）
    if (cat === 'shenlun') cat = 'essay';
    const m = data.modules[cat] || (data.modules[cat] = { done: [], lastDate: '' });
    const dateStr = todayStr();
    let exists = m.done.find(d => d.date === dateStr && d.title === title);
    if (!exists) {
      exists = { date: dateStr, title, ts: Date.now(), checked: !!checked };
      m.done.push(exists);
      if (m.lastDate !== dateStr) m.lastDate = dateStr;
      save('modules');
    } else if (typeof checked === 'boolean' && exists.checked !== checked) {
      exists.checked = checked;
      save('modules');
    }
  }
  // 模块打卡完成后，同步"今日计划"中对应目标的状态（反向联动）
  // 使模块页完成待办后，"每日学习进度"（planProgress 看 planToday.items）随之更新
  function syncPlanFromModule(cat, title, done) {
    try {
      const items = getPlanItems(todayStr());
      let changed = false;
      items.forEach(it => {
        if (it.category === cat && it.title === title && it.done !== done) {
          it.done = done;
          changed = true;
        }
      });
      if (changed) save('planToday');
    } catch (e) {}
  }
  function markModuleDone(cat, title) {
    let m = data.modules[cat];
    if (!m) { m = { done: [], lastDate: '' }; data.modules[cat] = m; }
    const dateStr = todayStr();
    let hit = m.done.find(d => d.date === dateStr && d.title === title);
    if (!hit) {
      hit = { date: dateStr, title, ts: Date.now(), checked: true };
      m.done.push(hit);
      if (m.lastDate !== dateStr) m.lastDate = dateStr;
    }
    hit.checked = true;
    save('modules');
    // 反向联动：同步今日计划目标为已完成
    syncPlanFromModule(cat, title, true);
  }
  function unmarkModuleDone(cat, title) {
    const m = data.modules[cat]; if (!m) return;
    const dateStr = todayStr();
    const hit = m.done.find(d => d.date === dateStr && d.title === title);
    if (hit) { hit.checked = false; save('modules'); }
    // 反向联动：同步今日计划目标为未完成
    syncPlanFromModule(cat, title, false);
  }
  // 某模块今天是否已打卡某目标，或是否存在任何打卡
  function moduleDoneToday(cat) {
    const m = data.modules[cat]; if (!m) return [];
    return m.done.filter(d => d.date === todayStr());
  }
  // 重命名某模块今日打卡记录（模块待办标题被修改时同步）
  function __renameModuleTodo(cat, oldTitle, newTitle) {
    const m = data.modules[cat]; if (!m) return;
    const dateStr = todayStr();
    let changed = false;
    m.done = (m.done || []).map(d => {
      if (d.date === dateStr && d.title === oldTitle) { d.title = newTitle; changed = true; }
      return d;
    });
    if (changed) save('modules');
  }
  // 删除某模块今日打卡记录（模块待办被删除时同步移除当天打卡）
  function __removeModuleTodo(cat, title) {
    const m = data.modules[cat]; if (!m) return;
    const dateStr = todayStr();
    const before = (m.done || []).length;
    m.done = (m.done || []).filter(d => !(d.date === dateStr && d.title === title));
    // 若删除后当天无打卡，重置 lastDate（避免残留"已打卡"状态）
    const todayHas = (m.done || []).some(d => d.date === dateStr);
    if (!todayHas && m.lastDate === dateStr) m.lastDate = '';
    if ((m.done || []).length !== before) save('modules');
  }

  // 记录做题（每日统计）
  function addStat(module, count, durationMin, correct, total) {
    const rec = {
      id: 's' + Date.now(),
      date: todayStr(),
      module,
      count: count || 0,
      durationMin: durationMin || 0,
      correct: correct || 0,
      total: total || count || 0,
      ts: Date.now(),
    };
    data.stats.records.push(rec);
    save('stats');
    return rec;
  }
  function statsOfDate(dateStr) {
    return data.stats.records.filter(r => r.date === dateStr);
  }
  function statsAll() {
    return data.stats.records;
  }

  // 错题本
  function addMistake(obj) {
    const it = Object.assign({
      id: 'm' + Date.now(),
      date: todayStr(),
      module: obj.module || '行测',
      category: obj.category || '',
      note: obj.note || '',
      // 结构化拆解（题干/正确答案/我的错误/分析思路/知识点）
      stem: obj.stem || '',
      answer: obj.answer || '',
      myAnswer: obj.myAnswer || '',
      analysis: obj.analysis || '',
      knowledge: obj.knowledge || '',
      image: obj.image || '',
      voiceText: obj.voiceText || '',
      week: weekKey(todayStr()),
      ts: Date.now(),
    }, obj);
    it.id = it.id || 'm' + Date.now();
    it.date = it.date || todayStr();
    it.week = it.week || weekKey(it.date);
    // 老数据回填：若错题无 options 数组，尝试在题库中按 stem 匹配（适用于早期录入的错题）
    try { enrichMistakeWithOptions(it); } catch (e) {}
    data.mistakes.items.unshift(it);
    save('mistakes');
    // 自动生成艾宾浩斯错题复习计划（录入当天为第1天）
    try { addMistakeReview(it.id); } catch (e) {}
    return it;
  }

  // 题库池（来自 data-content.js 的 global.Content）
  function getQuizPools() {
    const pools = [];
    try {
      const C = global.Content || {};
      ['POLITICS_QUIZ', 'COMMON_QUIZ', 'LANGUAGE_QUIZ', 'LOGIC_QUIZ', 'QUANTITY_QUIZ', 'DATA_QUIZ'].forEach(function (k) {
        if (Array.isArray(C[k])) pools.push(C[k]);
      });
      // 判断推理按题型分子数组（figure/define/analogy/logic），需逐一纳入，否则定义/类比/图形题匹配不到
      if (C.LOGIC_QUIZ_BY_TYPE && typeof C.LOGIC_QUIZ_BY_TYPE === 'object') {
        ['figure', 'define', 'analogy', 'logic'].forEach(function (t) {
          if (Array.isArray(C.LOGIC_QUIZ_BY_TYPE[t])) pools.push(C.LOGIC_QUIZ_BY_TYPE[t]);
        });
      }
    } catch (e) {}
    return pools;
  }

  // 老数据回填：若错题无 options 数组，尝试在题库中按 stem 完全匹配
  // 找到则回填 options / answerIndex / explain / source，并修正 stem/answer
  // 注意：仅在 addMistake / dueReviewList 时调用，对已保存的错题原地更新一次
  function enrichMistakeWithOptions(mis) {
    if (!mis || typeof mis !== 'object') return false;
    if (Array.isArray(mis.options) && mis.options.length >= 2) return false; // 已有选项
    const stem = (mis.stem || '').trim();
    if (!stem) return false;
    const pools = getQuizPools();
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const hit = pool.find(function (q) { return q && typeof q.q === 'string' && q.q.trim() === stem; });
      if (hit && Array.isArray(hit.options) && hit.options.length >= 2) {
        mis.options = hit.options.slice();
        mis.answerIndex = typeof hit.answer === 'number' ? hit.answer : 0;
        if (hit.explain && !mis.analysis) mis.analysis = hit.explain;
        if (hit.source && !mis.knowledge) mis.knowledge = hit.source;
        if (!mis.source) mis.source = hit.source || '';
        // 同步更新 answer 字符串（兼容旧展示）
        const letter = 'ABCDEFGH';
        mis.answer = letter[mis.answerIndex] + ' ' + (hit.options[mis.answerIndex] || '');
        return true;
      }
    }
    return false;
  }
  function removeMistake(id) {
    data.mistakes.items = data.mistakes.items.filter(i => i.id !== id);
    save('mistakes');
    // 同步移除错题复习记录
    try { removeMistakeReview(id); } catch (e) {}
  }
  function updateMistake(id, patch) {
    const it = data.mistakes.items.find(i => i.id === id);
    if (it) { Object.assign(it, patch); save('mistakes'); }
    return it;
  }
  function mistakesByWeek(week) {
    // week 格式: "YYYY-MM-DD~YYYY-MM-DD"(按"周一到周日"自然周区间)
    // 即使旧错题的 week 字段被错误算法拆分,这里仍按日期范围精确匹配
    if (week && week.indexOf('~') > 0) {
      const [s, e] = week.split('~');
      const start = new Date(s + 'T00:00:00').getTime();
      const end = new Date(e + 'T23:59:59').getTime();
      return data.mistakes.items.filter(i => {
        if (!i.date) return false;
        const t = new Date(i.date + 'T00:00:00').getTime();
        return t >= start && t <= end;
      });
    }
    return data.mistakes.items.filter(i => i.week === week);
  }
  // 所有自然周(去重排序,最新在前)
  // 严格按"周一为周首日"把日期映射到自然周区间,避免旧 week 字段被错误算法拆分导致的"重复周汇总"bug
  function allWeeks() {
    const set = {};
    data.mistakes.items.forEach(i => {
      const d = i.date ? new Date(i.date + 'T00:00:00') : new Date();
      // 锚定到当周周一(getDay: 周日=0,周一=1...六=6;把周日折回7再减得周一偏移)
      const dow = d.getDay() || 7;
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow - 1));
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      const label = Ufmt(monday) + '~' + Ufmt(sunday);
      set[label] = true;
    });
    return Object.keys(set).sort().reverse();
  }
  function Ufmt(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  /* ---------- 艾宾浩斯复习（遗忘曲线） ---------- */
  // 标准艾宾浩斯遗忘曲线间隔（天）：第1天学习，之后第2/4/7/15/30天复习
  // intervals[i] 表示距 learnDate 多少天后复习（i 从 1 开始，0 表示学习当天不计复习）
  const EBH_INTERVALS = [1, 2, 4, 7, 15, 30];
  // 返回每个复习轮次对应的间隔天数（供 UI 展示："第X天"）
  function ebhIntervals() { return EBH_INTERVALS.slice(); }
  // 由学习日期计算后续复习日期列表 [{ round:1..n, date:'YYYY-MM-DD', dueDays }]
  function calcReviewDates(learnDate) {
    if (!learnDate) return [];
    const base = new Date(learnDate + 'T00:00:00');
    if (isNaN(base.getTime())) return [];
    return EBH_INTERVALS.map((iv, idx) => {
      const d = new Date(base.getTime());
      d.setDate(d.getDate() + iv);
      return {
        round: idx + 1,
        date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        dueDays: iv,
      };
    });
  }
  // 两个日期字符串差几天（b - a）
  function diffDays(aStr, bStr) {
    const a = new Date(aStr + 'T00:00:00');
    const b = new Date(bStr + 'T00:00:00');
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  /* --- 模块复习 --- */
  // 记录某模块今天学习了（生成后续复习任务）。module 为模块 key
  function addModuleReview(module) {
    const dateStr = todayStr();
    // 同一天同一模块只登记一次
    const exists = data.reviews.moduleReviews.find(r => r.module === module && r.learnDate === dateStr);
    if (exists) return exists;
    const rec = {
      id: 'mr' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      module: module,
      learnDate: dateStr,
      lastReviewDate: '',
    };
    data.reviews.moduleReviews.push(rec);
    save('reviews');
    return rec;
  }
  // 获取某天到期的模块复习列表：模块在 learnDate 学习，经过某一复习间隔后正好到今天
  function moduleReviewsDueOn(dateStr) {
    const out = [];
    data.reviews.moduleReviews.forEach(r => {
      if (!r.learnDate) return;
      const diff = diffDays(r.learnDate, dateStr);
      if (diff <= 0) return; // 今天或过去的不算待复习（今天当天学习，未到期）
      // 是否命中某一复习间隔，且尚未在最后一个间隔之后被标记完成（lastReviewDate 已更新）
      const hit = EBH_INTERVALS.indexOf(diff) >= 0;
      if (hit) {
        // 若 lastReviewDate 已 >= 今天（已经复习过），不再待复习
        if (r.lastReviewDate && diffDays(r.learnDate, r.lastReviewDate) >= diff) return;
        out.push(Object.assign({}, r, { dueDays: diff, round: EBH_INTERVALS.indexOf(diff) + 1 }));
      }
    });
    // 去重：同一模块同一天可能因多个 learnDate 命中，合并为最近一次
    const byModule = {};
    out.forEach(r => {
      if (!byModule[r.module] || byModule[r.module].dueDays < r.dueDays) byModule[r.module] = r;
    });
    return Object.keys(byModule).map(k => byModule[k]);
  }
  // 标记某模块今天已复习（更新 lastReviewDate）
  function markModuleReviewed(id) {
    const r = data.reviews.moduleReviews.find(x => x.id === id);
    if (!r) return false;
    const dateStr = todayStr();
    r.lastReviewDate = diffDays(r.learnDate, dateStr) > (diffDays(r.learnDate, r.lastReviewDate || '') || 0)
      ? dateStr : r.lastReviewDate;
    r.lastReviewDate = dateStr;
    save('reviews');
    return true;
  }
  function getModuleReviews() { return data.reviews.moduleReviews || []; }
  // 移除某模块的所有复习记录（如模块被删除/清理）
  function removeModuleReviews(module) {
    data.reviews.moduleReviews = (data.reviews.moduleReviews || []).filter(r => r.module !== module);
    save('reviews');
  }

  /* --- 错题复习 --- */
  // 为错题自动生成复习计划（录入当天为 learnDate）。mistakeId 唯一
  function addMistakeReview(mistakeId) {
    const dateStr = todayStr();
    const exists = data.reviews.mistakeReviews.find(r => r.mistakeId === mistakeId);
    if (exists) return exists;
    const rec = {
      id: 'mk' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      mistakeId: mistakeId,
      learnDate: dateStr,
      lastReviewDate: '',
    };
    data.reviews.mistakeReviews.push(rec);
    save('reviews');
    return rec;
  }
  // 获取某天到期的错题复习列表
  function mistakeReviewsDueOn(dateStr) {
    const out = [];
    (data.reviews.mistakeReviews || []).forEach(r => {
      if (!r.learnDate) return;
      const diff = diffDays(r.learnDate, dateStr);
      if (diff <= 0) return;
      const hit = EBH_INTERVALS.indexOf(diff) >= 0;
      if (!hit) return;
      if (r.lastReviewDate && diffDays(r.learnDate, r.lastReviewDate) >= diff) return;
      out.push(Object.assign({}, r, { dueDays: diff, round: EBH_INTERVALS.indexOf(diff) + 1 }));
    });
    return out;
  }
  // 标记某错题今天已复习
  function markMistakeReviewed(id) {
    const r = (data.reviews.mistakeReviews || []).find(x => x.id === id);
    if (!r) return false;
    r.lastReviewDate = todayStr();
    save('reviews');
    return true;
  }
  // 重练中"仍需巩固"：把该错题重新加入艾宾浩斯复习队列（重置学习日期为今天，重新开始新一轮）
  function requeueMistakeReview(mistakeId) {
    let r = (data.reviews.mistakeReviews || []).find(x => x.mistakeId === mistakeId);
    if (!r) {
      r = addMistakeReview(mistakeId);
    } else {
      r.learnDate = todayStr();
      r.lastReviewDate = '';
      save('reviews');
    }
    return r;
  }
  function getMistakeReviews() { return data.reviews.mistakeReviews || []; }
  // 移除某错题的复习记录（错题被删除时调用）
  function removeMistakeReview(mistakeId) {
    data.reviews.mistakeReviews = (data.reviews.mistakeReviews || []).filter(r => r.mistakeId !== mistakeId);
    save('reviews');
  }
  // 某错题当前的复习进度（第几轮 / 总轮次），无记录返回 null
  function mistakeReviewProgress(mistakeId) {
    const r = (data.reviews.mistakeReviews || []).find(x => x.mistakeId === mistakeId);
    if (!r) return null;
    const dateStr = todayStr();
    const diff = diffDays(r.learnDate, dateStr);
    // 当前已进入的轮次（今天到期即为本轮）
    let current = 0;
    for (let i = 0; i < EBH_INTERVALS.length; i++) {
      if (diff >= EBH_INTERVALS[i]) current = i + 1;
    }
    // 若已复习且到达最后阶段，视为完成
    const lastIv = EBH_INTERVALS[EBH_INTERVALS.length - 1];
    const done = r.lastReviewDate && diffDays(r.learnDate, r.lastReviewDate) >= lastIv;
    return { round: current, totalRounds: EBH_INTERVALS.length, done: done };
  }

  /* --- 记忆内容复习（口诀/知识点，艾宾浩斯间隔重复） --- */
  // 登记某条记忆内容今天已学习，加入复习队列。memoryKey 唯一标识；type: 'koujue'|'knowledge' 等
  function addMemoryReview(memoryKey, memoryType) {
    const dateStr = todayStr();
    const exists = (data.reviews.memoryReviews || []).find(r => r.memoryKey === memoryKey);
    if (exists) {
      // 已登记过：若已完成全部轮次则重新开始，否则保持原计划
      return exists;
    }
    const rec = {
      id: 'me' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      memoryKey: memoryKey,
      memoryType: memoryType || 'koujue',
      learnDate: dateStr,
      lastReviewDate: '',
    };
    data.reviews.memoryReviews = data.reviews.memoryReviews || [];
    data.reviews.memoryReviews.push(rec);
    save('reviews');
    return rec;
  }
  // 获取某天到期的记忆复习列表
  function memoryReviewsDueOn(dateStr) {
    const out = [];
    (data.reviews.memoryReviews || []).forEach(r => {
      if (!r.learnDate) return;
      const diff = diffDays(r.learnDate, dateStr);
      if (diff <= 0) return;
      const hit = EBH_INTERVALS.indexOf(diff) >= 0;
      if (!hit) return;
      if (r.lastReviewDate && diffDays(r.learnDate, r.lastReviewDate) >= diff) return;
      out.push(Object.assign({}, r, { dueDays: diff, round: EBH_INTERVALS.indexOf(diff) + 1 }));
    });
    return out;
  }
  // 标记某记忆今天已复习
  function markMemoryReviewed(id) {
    const r = (data.reviews.memoryReviews || []).find(x => x.id === id);
    if (!r) return false;
    r.lastReviewDate = todayStr();
    save('reviews');
    return true;
  }
  // "再练一遍/没记住"：重新加入艾宾浩斯队列（重置学习日期为今天，重新开始新一轮）
  function requeueMemoryReview(memoryKey, memoryType) {
    let r = (data.reviews.memoryReviews || []).find(x => x.memoryKey === memoryKey);
    if (!r) {
      r = addMemoryReview(memoryKey, memoryType || 'koujue');
    } else {
      r.learnDate = todayStr();
      r.lastReviewDate = '';
      save('reviews');
    }
    return r;
  }
  // 某记忆当前的复习进度（第几轮 / 总轮次），无记录返回 null
  function memoryReviewProgress(memoryKey) {
    const r = (data.reviews.memoryReviews || []).find(x => x.memoryKey === memoryKey);
    if (!r) return null;
    const dateStr = todayStr();
    const diff = diffDays(r.learnDate, dateStr);
    let current = 0;
    for (let i = 0; i < EBH_INTERVALS.length; i++) {
      if (diff >= EBH_INTERVALS[i]) current = i + 1;
    }
    const lastIv = EBH_INTERVALS[EBH_INTERVALS.length - 1];
    const done = r.lastReviewDate && diffDays(r.learnDate, r.lastReviewDate) >= lastIv;
    return { round: current, totalRounds: EBH_INTERVALS.length, done: done };
  }
  function getMemoryReviews() { return data.reviews.memoryReviews || []; }

  /* --- 每日记忆小测验（countdown 页入口） --- */
  // 获取某天的测验记录数组（无则返回空数组）
  function getMemoryQuizOfDay(dateStr) {
    const d = (data.memoryQuiz && data.memoryQuiz.days) ? data.memoryQuiz.days[dateStr] : null;
    return d || [];
  }
  // 获取某条 key 在某天的测验结果（'known'/'unknown'/'pending' 或 null）
  function memoryQuizResultOfDay(dateStr, key) {
    const rec = getMemoryQuizOfDay(dateStr).find(r => r.key === key);
    return rec ? rec.result : null;
  }
  // 记录某天某条记忆条目的测验结果。
  // result: 'known'(记住了) | 'unknown'(没记住) | 'pending'(待测/重置)
  // 联动艾宾浩斯复习：known → 登记复习(若未登记)；unknown → 重新进入复习队列(明天再测)；pending → 清除当天结果
  function markMemoryQuizResult(key, type, result) {
    const dateStr = todayStr();
    data.memoryQuiz.days = data.memoryQuiz.days || {};
    const list = data.memoryQuiz.days[dateStr] || (data.memoryQuiz.days[dateStr] = []);
    let rec = list.find(r => r.key === key);
    if (!rec) {
      rec = { key, type: type || '', result: 'pending', ts: Date.now() };
      list.push(rec);
    }
    rec.result = result || 'pending';
    rec.ts = Date.now();
    // 联动复习队列
    try {
      if (result === 'known') {
        // 记住了：登记艾宾浩斯复习（若尚未登记）
        addMemoryReview(key, type || 'koujue');
      } else if (result === 'unknown') {
        // 没记住：重新进入队列，明天再测
        requeueMemoryReview(key, type);
      }
    } catch (e) {}
    save('memoryQuiz');
    return rec;
  }
  // 某天的测验汇总统计
  function memoryQuizStats(dateStr) {
    const list = getMemoryQuizOfDay(dateStr);
    const known = list.filter(r => r.result === 'known').length;
    const unknown = list.filter(r => r.result === 'unknown').length;
    const pending = list.filter(r => r.result !== 'known' && r.result !== 'unknown').length;
    return { total: list.length, known, unknown, pending };
  }
  // 成语专项统计：已掌握辨析(对) / 已学释义(条) / 待复习(条)
  // 仅基于记忆测验历史，避免与艾宾浩斯复习队列类型耦合
  function idiomMasteryStats() {
    const days = (data.memoryQuiz && data.memoryQuiz.days) || {};
    const diffSet = {}, meanKnown = {}, meanUnknown = {};
    Object.keys(days).forEach(d => {
      (days[d] || []).forEach(r => {
        if (!r || !r.key) return;
        if (r.key.indexOf('id:') === 0) {
          if (r.result === 'known') diffSet[r.key] = 1;
        } else if (r.key.indexOf('im:') === 0) {
          if (r.result === 'known') meanKnown[r.key] = 1;
          if (r.result === 'unknown') meanUnknown[r.key] = 1;
        }
      });
    });
    return {
      masteredDiff: Object.keys(diffSet).length,
      learnedMean: Object.keys(meanKnown).length,
      reviewMean: Object.keys(meanUnknown).length,
    };
  }

  // 连接状态
  function setConnected(c) {
    data.settings.connected = !!c;
    save('settings');
  }
  function isConnected() {
    return !!data.settings.connected;
  }

  /* ---------- 长期课程规划（智能规划） ---------- */

  // 计算第 i 天（0 基）该课程应分配的课时数
  // 规则：dailyHours = ceil(total/days)；第 i 天 = min(dailyHours, total - 已分配)
  function planDailyHours(plan, dayIndex) {
    if (dayIndex >= plan.days) return 0;
    let assigned = 0;
    for (let k = 0; k < dayIndex; k++) assigned += Math.min(plan.dailyHours, plan.totalHours - assigned);
    return Math.min(plan.dailyHours, plan.totalHours - assigned);
  }

  function addPlan({ courseName, category, totalHours, days, startDate }) {
    const plan = {
      id: 'c' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      courseName: String(courseName || '').trim(),
      category: category || 'political',
      totalHours: parseInt(totalHours, 10) || 0,
      days: parseInt(days, 10) || 1,
      dailyHours: Math.ceil((parseInt(totalHours, 10) || 0) / (parseInt(days, 10) || 1)),
      startDate: startDate || todayStr(),
      createdTs: Date.now(),
    };
    data.plans.plans.push(plan);
    save('plans');
    return plan;
  }
  function removePlan(id) {
    data.plans.plans = data.plans.plans.filter(p => p.id !== id);
    save('plans');
  }
  // 更新课程规划字段（支持部分更新）
  function updatePlan(id, patch) {
    const plan = data.plans.plans.find(p => p.id === id);
    if (!plan) return null;
    if (patch.courseName !== undefined) plan.courseName = String(patch.courseName).trim();
    if (patch.category !== undefined) plan.category = patch.category;
    if (patch.totalHours !== undefined) plan.totalHours = parseInt(patch.totalHours, 10) || 0;
    if (patch.days !== undefined) plan.days = parseInt(patch.days, 10) || 1;
    if (patch.startDate !== undefined) plan.startDate = patch.startDate;
    if (patch.dailyHours !== undefined) {
      plan.dailyHours = parseInt(patch.dailyHours, 10) || Math.ceil(plan.totalHours / plan.days);
    } else if (plan.totalHours > 0 && plan.days > 0) {
      plan.dailyHours = Math.ceil(plan.totalHours / plan.days);
    }
    save('plans');
    return plan;
  }
  // 移动课程规划顺序：dir = -1 上移，1 下移
  function movePlan(id, dir) {
    const arr = data.plans.plans;
    const i = arr.findIndex(p => p.id === id);
    if (i < 0) return false;
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= arr.length) return false;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    save('plans');
    return true;
  }
  function getPlans() {
    return data.plans.plans || [];
  }
  // 计划是否在给定日期仍有效（该天有课时安排）
  function planActiveOn(plan, dateStr) {
    if (!dateStr) return false;
    const start = new Date(plan.startDate + 'T00:00:00');
    const today = new Date(dateStr + 'T00:00:00');
    const diff = Math.round((today - start) / (1000 * 60 * 60 * 24));
    if (diff < 0 || diff >= plan.days) return false;
    return planDailyHours(plan, diff) > 0;
  }
  // 某天某课程的应学课时（0 表示当天无需学习）
  function planHoursOn(plan, dateStr) {
    if (!dateStr) return 0;
    const start = new Date(plan.startDate + 'T00:00:00');
    const today = new Date(dateStr + 'T00:00:00');
    const diff = Math.round((today - start) / (1000 * 60 * 60 * 24));
    if (diff < 0 || diff >= plan.days) return 0;
    return planDailyHours(plan, diff);
  }

  /* ---------- 数据互通：导出 / 导入（跨设备同步） ---------- */
  const SYNC_APP = 'free-in-higher';
  const SYNC_VER = 1;

  // 导出全部数据：扫描所有 shangan_ 前缀的 key，打包成一个 JSON 字符串
  // 返回 { ok:true, json, keys, size }
  function exportAllData() {
    const payload = {};
    let keys = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) {
          const raw = localStorage.getItem(k);
          if (raw !== null) { payload[k] = raw; keys++; }
        }
      }
    } catch (e) { /* 忽略读取失败项 */ }
    const json = JSON.stringify({ app: SYNC_APP, ver: SYNC_VER, ts: Date.now(), data: payload });
    return { ok: true, json, keys, size: json.length };
  }

  // 解析并校验同步码文本
  // 返回 { ok:true, payload } 或 { ok:false, msg }
  function parseSyncCode(text) {
    if (!text || typeof text !== 'string') return { ok: false, msg: '同步码为空' };
    let trimmed = text.trim();
    // 兼容复制时可能带上"```"等包装
    trimmed = trimmed.replace(/^```[a-z]*/i, '').replace(/```$/, '');
    trimmed = trimmed.trim();
    let payload;
    try { payload = JSON.parse(trimmed); }
    catch (e) { return { ok: false, msg: '同步码格式不正确，请检查是否完整复制' }; }
    if (!payload || payload.app !== SYNC_APP || !payload.data || typeof payload.data !== 'object') {
      return { ok: false, msg: '这不是「自由在高处」的同步码' };
    }
    return { ok: true, payload };
  }

  // 导入数据。mode: 'overwrite' 覆盖本地（清空现有 shangan_ 数据）/ 'merge' 合并（用导入项覆盖同名，保留本地独有）
  // 返回 { ok:true, importedKeys, mode } 或 { ok:false, msg }
  function importAllData(text, mode) {
    const parsed = parseSyncCode(text);
    if (!parsed.ok) return parsed;
    const payloadData = parsed.payload.data;
    const importedKeys = Object.keys(payloadData);
    if (!importedKeys.length) return { ok: false, msg: '同步码里没有可导入的数据' };

    if (mode === 'overwrite') {
      // 先清空本地所有 shangan_ 数据
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }
    // 逐 key 解析 + schema 校验后写回：非法 JSON 或 schema 校验失败（结构异常）的项跳过并汇总
    const skipped = [];
    let written = 0;
    importedKeys.forEach(k => {
      if (k.indexOf(PREFIX) !== 0) { skipped.push(k); return; } // 非本应用 key 跳过
      const raw = payloadData[k];
      let val = null;
      try { val = JSON.parse(raw); } catch (e) { val = null; }
      if (val === null) { skipped.push(k); return; } // 非法 JSON 跳过
      // 核心 key：schema 校验通过才写回（校验会就地修正可修复项，并标记不可修复项）
      const shortKey = k.slice(PREFIX.length);
      if (CORE_KEYS.indexOf(shortKey) >= 0) {
        // exams 顶层为数组（合法），其余核心数据顶层为普通对象
        const isExams = shortKey === 'exams';
        const structurallyOk = isExams
          ? Array.isArray(val)
          : (val && typeof val === 'object' && !Array.isArray(val));
        if (!structurallyOk) { skipped.push(k); return; }
        // 构造 { shortKey: val } 用对应校验函数；校验失败（结构异常被重置为空）也视为跳过
        const holder = { [shortKey]: val };
        _validate(holder);
        // 校验后，holder[shortKey] 即修正后的数据；按其自身结构判定是否仍不可用
        const fixed = holder[shortKey];
        const invalidAfterFix =
          (shortKey === 'exams'    && !Array.isArray(fixed)) ||
          (shortKey === 'planToday' && (!fixed || !fixed.items)) ||
          (shortKey === 'modules'   && (typeof fixed !== 'object' || fixed === null)) ||
          (shortKey === 'stats'     && (!fixed || !fixed.records)) ||
          (shortKey === 'mistakes'  && (!fixed || !fixed.items)) ||
          (shortKey === 'plans'     && (!fixed || !fixed.plans)) ||
          (shortKey === 'reviews'   && (!fixed || !fixed.moduleReviews)) ||
          (shortKey === 'settings'  && (typeof fixed !== 'object' || fixed === null));
        if (invalidAfterFix) { skipped.push(k); return; }
        localStorage.setItem(k, JSON.stringify(fixed));
        written++;
      } else {
        // 非核心 key（modtodo_*、inited 等）：合法 JSON 即可写回
        try { localStorage.setItem(k, raw); written++; } catch (e) { skipped.push(k); }
      }
    });
    reload();
    // 写回后再次自检，兜底清理潜在异常
    try { _selfCheck(); } catch (e) {}
    return { ok: true, importedKeys: written, skipped, mode: mode || 'merge' };
  }

  global.Store = {
    // data 用 getter，确保 reload() 后外部读取到最新数据
    get data() { return data; },
    reload,
    saveAll, save,
    addExam, removeExam,
    getExamDate, setExamDate, getExamName, setExamName,
    getThemeMode, setThemeMode, getDayPalette, setDayPalette,
    getPlanItems, addPlanItem, togglePlanItem, removePlanItem, clearPlanToday, updatePlanItem, planProgress, isPlanHistoryItemDone, makeupPlanHistory,
    moduleDoneToday, markModuleDone, unmarkModuleDone, registerModuleTodo, __renameModuleTodo, __removeModuleTodo,
    addStat, statsOfDate, statsAll,
    addMistake, removeMistake, updateMistake, mistakesByWeek, allWeeks, enrichMistakeWithOptions,
    setConnected, isConnected,
    addPlan, removePlan, updatePlan, movePlan, getPlans, planDailyHours, planActiveOn, planHoursOn,
    ebhIntervals, calcReviewDates, diffDays,
    addModuleReview, moduleReviewsDueOn, markModuleReviewed, getModuleReviews, removeModuleReviews,
    addMistakeReview, mistakeReviewsDueOn, markMistakeReviewed, getMistakeReviews,
    removeMistakeReview, mistakeReviewProgress, requeueMistakeReview,
    addMemoryReview, memoryReviewsDueOn, markMemoryReviewed, requeueMemoryReview,
    memoryReviewProgress, getMemoryReviews,
    getMemoryQuizOfDay, memoryQuizResultOfDay, markMemoryQuizResult, memoryQuizStats, idiomMasteryStats,
    exportAllData, importAllData, parseSyncCode,
    _validate, _selfCheck, _isDateStr, _backupRaw, CORRUPT_BACKUP_KEY,
    get startupCheck() { return __startupCheck; },
    PREFIX,
  };
})(window);
