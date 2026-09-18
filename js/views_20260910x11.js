/* ============================================================
   views.js — 12 个页面渲染逻辑
   每个页面返回 HTML 字符串，挂载后由 app.js 绑定事件
   ============================================================ */
(function (global) {
  'use strict';
  const U = global.Utils;
  const C = global.Content;
  const S = global.Store;

  const dayIdx = C.dayIndex();

  // 错题重练状态：null=不重练；{ module: null|'common'等, cur: 当前序号, known:[], need:[], answered:bool }
  let mistakeReviewState = null;

  // 今日待复习错题（艾宾浩斯到期）逐题模式：{ cur, list:[{review, mis}], known:[reviewId], need:[reviewId], answered:bool, finished:bool }
  let dueReviewState = null;

  function pick(arr) { return arr[dayIdx % arr.length]; }
  function pickN(arr, n) {
    const res = [];
    const len = arr.length;
    for (let i = 0; i < n; i++) res.push(arr[(dayIdx + i) % len]);
    return res;
  }
  function pickRange(arr, start, count) {
    const res = [];
    const len = arr.length;
    for (let i = 0; i < count; i++) res.push(arr[(dayIdx + start + i) % len]);
    return res;
  }

  // 聚合今日记忆小测验条目：口诀 / 核心考点 / 公式 / 成语
  // 返回统一结构: { key, type, icon, label, question, answer, tag }
  //  - key 为稳定标识（'kj:num' / 'kd:title' / 'fm:name' / 'id:a-b'），供 memoryQuiz 存储追踪
  //  - type: 'koujue' | 'kaodian' | 'formula' | 'idiom'
  function collectMemoryQuizItems() {
    const items = [];
    // 1. 口诀（今日1条）
    const kjList = (C.COMMON_KOUJUE && C.COMMON_KOUJUE.length) ? C.COMMON_KOUJUE : [];
    if (kjList.length) {
      const kj = pick(kjList);
      const key = 'kj:' + String(kj.num != null ? kj.num : kj.id);
      items.push({
        key, type: 'koujue', icon: '📜', label: '口诀',
        question: (kj.title || '口诀' + key) + ' 用什么口诀记忆？',
        answer: kj.koujue || '', tag: '口诀',
      });
    }
    // 2. 核心考点（今日5条，政治理论）
    const kdAll = (C.POLITICS_KAODIAN && C.POLITICS_KAODIAN.length) ? C.POLITICS_KAODIAN : [];
    if (kdAll.length) {
      pickRange(kdAll, (dayIdx * 5) % kdAll.length, 5).forEach(kd => {
        items.push({
          key: 'kd:' + (kd.title || ''), type: 'kaodian', icon: '💎', label: '考点',
          question: (kd.title || '') + ' 的核心要点是什么？',
          answer: kd.point || '', tag: '考点',
        });
      });
    }
    // 3. 核心公式（今日10条，资料分析）
    const fmAll = (C.DATA_FORMULAS && C.DATA_FORMULAS.length) ? C.DATA_FORMULAS : [];
    if (fmAll.length) {
      pickRange(fmAll, (dayIdx * 10) % fmAll.length, 10).forEach(fm => {
        items.push({
          key: 'fm:' + (fm.name || ''), type: 'formula', icon: '📊', label: '公式',
          question: (fm.name || '') + (fm.note ? '（' + fm.note + '）' : '') + ' 的公式是？',
          answer: fm.formula || '', tag: '公式',
        });
      });
    }
    // 4. 成语辨析（今日1组，言语）
    const idAll = (C.IDIOMS && C.IDIOMS.length) ? C.IDIOMS : [];
    if (idAll.length) {
      pickRange(idAll, dayIdx % idAll.length, 1).forEach(id => {
        items.push({
          key: 'id:' + (id.a || '') + '-' + (id.b || ''), type: 'idiom', icon: '🔤', label: '成语',
          question: (id.a || '') + ' ↔ ' + (id.b || '') + ' 的用法区别？',
          answer: id.diff || '', tag: '成语',
        });
      });
    }
    return items;
  }

  /* ================================================================
     1. 省考倒计时
     ================================================================ */
  function viewCountdown() {
    const examDate = S.getExamDate();
    const cd = U.daysUntil(examDate);
    const quote = pick(C.QUOTES);
    const exams = S.data.exams;

    let examPills = '';
    exams.forEach((e, i) => {
      const ed = U.daysUntil(e.date);
      examPills +=
        '<div class="list-item">' +
          '<span class="li-icon">' + (e.icon || '🎯') + '</span>' +
          '<div class="li-body">' +
            '<div class="li-title">' + U.esc(e.name) + '</div>' +
            '<div class="li-meta">' + (e.date ? U.fmtDate(e.date) + ' · 还有 ' + (ed.expired ? '已过' : ed.days + ' 天') : '未设置日期') + '</div>' +
          '</div>' +
          '<div class="li-actions">' +
            '<button class="btn btn-sm btn-soft" data-del-exam="' + e.id + '">🗑️</button>' +
          '</div>' +
        '</div>';
    });

    const daysNum = cd.days === null ? '—' : (cd.expired ? 0 : cd.days);

    // ===== 今日记忆小测验（数据互通卡下方、考试设置上方） =====
    const mqItems = collectMemoryQuizItems();
    const todayStr = U.todayStr();
    const mqStats = (S && typeof S.memoryQuizStats === 'function') ? S.memoryQuizStats(todayStr) : { total: 0, known: 0, unknown: 0, pending: 0 };
    const mqDone = mqStats.known + mqStats.unknown;
    const mqTotal = mqItems.length;
    const mqPct = mqTotal ? Math.round(mqDone / mqTotal * 100) : 0;
    const mqLeft = Math.max(0, mqTotal - mqDone);
    // 各条目的测验状态
    const mqStateOf = {};
    if (S && typeof S.memoryQuizResultOfDay === 'function') {
      mqItems.forEach(it => { mqStateOf[it.key] = S.memoryQuizResultOfDay(todayStr, it.key); });
    }
    // 按未测→记住→没记住排序（未测在前，便于逐条完成）
    const order = { known: 1, unknown: 2, pending: 0 };
    const mqSorted = mqItems.slice().sort((a, b) => {
      const sa = order[mqStateOf[a.key]] !== undefined ? order[mqStateOf[a.key]] : 0;
      const sb = order[mqStateOf[b.key]] !== undefined ? order[mqStateOf[b.key]] : 0;
      return sa - sb;
    });
    // 单条渲染
    const mqItemHTML = (it, st) => {
      if (st === 'known') {
        return '<div class="mq-item mq-known">' +
          '<div class="mq-head"><span class="mq-icon">' + it.icon + '</span><b class="mq-label">' + it.label + ' · ' + U.esc(it.question) + '</b>' +
            '<span class="mq-state mq-s-known">✅ 记住了</span></div>' +
          '<div class="mq-answer">' + U.esc(it.answer) + '</div>' +
          '<div class="mq-foot"><span class="mq-note">已登记复习 · 2天后到期</span></div>' +
        '</div>';
      }
      if (st === 'unknown') {
        return '<div class="mq-item mq-unknown">' +
          '<div class="mq-head"><span class="mq-icon">' + it.icon + '</span><b class="mq-label">' + it.label + ' · ' + U.esc(it.question) + '</b>' +
            '<span class="mq-state mq-s-unknown">😵 没记住</span></div>' +
          '<div class="mq-answer">' + U.esc(it.answer) + '</div>' +
          '<div class="mq-foot"><span class="mq-note">↻ 已加入复习队列 · 明天再测</span></div>' +
        '</div>';
      }
      // pending / 未测
      return '<div class="mq-item mq-pending" data-mqkey="' + U.esc(it.key) + '" data-mqtype="' + it.type + '">' +
        '<div class="mq-head"><span class="mq-icon">' + it.icon + '</span><b class="mq-label">' + it.label + ' · ' + U.esc(it.question) + '</b>' +
          '<span class="mq-state mq-s-pending">⏳ 待测</span></div>' +
        '<div class="mq-question">🤔 先回忆，再点「核对答案」对照</div>' +
        '<div class="mq-answer" style="display:none">' + U.esc(it.answer) + '</div>' +
        '<div class="mq-actions">' +
          '<button class="btn btn-sm btn-primary" data-mq-show>🙋 核对答案</button>' +
          '<button class="btn btn-sm btn-success" data-mq-known style="display:none">✅ 记住了</button>' +
          '<button class="btn btn-sm btn-danger" data-mq-unknown style="display:none">↻ 没记住</button>' +
        '</div>' +
      '</div>';
    };
    const mqBodyHTML = mqSorted.map(it => mqItemHTML(it, mqStateOf[it.key])).join('');
    const memoryQuizCard =
      '<div class="card mq-card">' +
        '<div class="mq-toggle" data-mq-toggle>' +
          '<div class="mq-toggle-left">' +
            '<span class="mq-toggle-icon">🧠</span>' +
            '<div class="mq-toggle-text"><div class="mq-toggle-title">今日记忆小测试</div>' +
            '<div class="mq-toggle-sub">口诀 · 考点 · 公式 · 成语 · 逐条回忆勾选</div></div>' +
          '</div>' +
          '<div class="mq-toggle-right">' +
            '<div class="mq-badge"><div class="mq-badge-num">' + mqLeft + '</div><div class="mq-badge-label">待测</div></div>' +
            '<span class="mq-chev">▾</span>' +
          '</div>' +
        '</div>' +
        '<div class="mq-progress-wrap">' +
          '<div class="mq-progress"><div class="mq-progress-bar" style="width:' + mqPct + '%"></div></div>' +
          '<div class="mq-progress-label">今日已测 ' + mqDone + '/' + mqTotal + '</div>' +
        '</div>' +
        '<div class="mq-body" data-mq-body style="display:none">' +
          (mqBodyHTML || '<div class="empty"><div class="e-txt">今日无记忆任务</div></div>') +
          '<div class="mq-footer">' +
            '<div class="mq-summary">已记住 <b>' + mqStats.known + '</b> · 待复习 <b>' + mqStats.unknown + '</b> · 未测 <b>' + mqLeft + '</b></div>' +
            '<button class="btn btn-block btn-soft" data-mq-finish>✅ 完成今日测验</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    return '' +
      // 今日申论金句（可运用于大作文）
      '<div class="quote-card">' +
        '<div class="quote-mark">"</div>' +
        '<div class="quote-text">' + U.esc(quote.text) + '</div>' +
        '<div class="quote-source">📚 今日金句 · 来源：' + U.esc(quote.source) + '</div>' +
        (quote.theme ? '<div class="quote-theme">🏷️ 适用主题：' + U.esc(quote.theme) + '</div>' : '') +
        (quote.usage ? '<div class="quote-usage">✍️ 使用建议：' + U.esc(quote.usage) + '</div>' : '') +
      '</div>' +

      // 倒计时
      '<div class="countdown-hero">' +
        '<div class="cd-label">距离 ' + U.esc(S.getExamName()) + '</div>' +
        '<div class="cd-num">' + daysNum + '</div>' +
        '<div class="cd-unit">天</div>' +
        '<div class="cd-date">' + (examDate ? '考试日期：' + U.fmtDate(examDate) + '（' + examDate + '）' : '尚未设置考试日期') + '</div>' +
      '</div>' +

      // 数据互通（手机 ↔ 电脑）
      '<div class="card sync-entry-card">' +
        '<button class="btn btn-soft btn-block" data-opensync style="width:100%">🔗 数据互通 · 手机 ↔ 电脑同步</button>' +
      '</div>' +

      // 今日记忆小测试（自定义考试上方）
      memoryQuizCard +

      // 自定义考试列表
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🗓️</span>我的考试<button class="btn btn-sm btn-soft" data-add-exam style="margin-left:auto">＋ 添加</button></div>' +
        '<div class="section-tip">可添加多个考试类型并分别设置倒计时。</div>' +
        (exams.length ? examPills : '<div class="empty"><div class="e-txt">暂无自定义考试</div></div>') +
      '</div>' +

      '<div class="conn-badge-row"><span class="conn-badge ' + (S.isConnected() ? 'green' : 'red') + '">' + (S.isConnected() ? '🟢 已连接 · 数据可同步' : '🔴 未连接 · 仅本地存储') + '</span></div>';
  }

  function bindCountdown() {
    // ===== 今日记忆小测试交互 =====
    const mqToggle = document.querySelector('[data-mq-toggle]');
    const mqBody = document.querySelector('[data-mq-body]');
    if (mqToggle && mqBody) {
      mqToggle.addEventListener('click', (e) => {
        // 点击条目内部按钮不触发收起
        if (e.target.closest('[data-mq-show], [data-mq-known], [data-mq-unknown], [data-mq-finish]')) return;
        const showing = mqBody.style.display !== 'none';
        mqBody.style.display = showing ? 'none' : 'block';
        const chev = mqToggle.querySelector('.mq-chev');
        if (chev) chev.textContent = showing ? '▾' : '▴';
      });
    }
    // 展开答案
    document.querySelectorAll('[data-mq-show]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('[data-mqkey]');
        const ans = item.querySelector('.mq-answer');
        if (ans) ans.style.display = 'block';
        const showBtn = item.querySelector('[data-mq-show]');
        if (showBtn) showBtn.style.display = 'none';
        const knownBtn = item.querySelector('[data-mq-known]');
        const unkBtn = item.querySelector('[data-mq-unknown]');
        if (knownBtn) knownBtn.style.display = 'inline-flex';
        if (unkBtn) unkBtn.style.display = 'inline-flex';
      });
    });
    // 记住了 / 没记住
    document.querySelectorAll('[data-mq-known], [data-mq-unknown]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('[data-mqkey]');
        if (!item) return;
        const key = item.getAttribute('data-mqkey');
        const type = item.getAttribute('data-mqtype') || '';
        const result = btn.hasAttribute('data-mq-known') ? 'known' : 'unknown';
        if (S && typeof S.markMemoryQuizResult === 'function') {
          S.markMemoryQuizResult(key, type, result);
        }
        U.toast(result === 'known' ? '✅ 记住了！已登记复习' : '😵 已加入复习队列，明天再测');
        global.APP.renderPage(global.APP.current || 'countdown');
      });
    });
    // 完成今日测验：全部标记后提示
    const mqFinish = document.querySelector('[data-mq-finish]');
    if (mqFinish) {
      mqFinish.addEventListener('click', (e) => {
        e.stopPropagation();
        const stats = (S && typeof S.memoryQuizStats === 'function') ? S.memoryQuizStats(U.todayStr()) : { known: 0, unknown: 0, pending: 0 };
        const left = (typeof stats.pending === 'number') ? stats.pending : 0;
        if (left > 0) {
          U.toast('还有 ' + left + ' 条未测，继续加油！');
        } else {
          U.toast('🎉 今日记忆测验已完成！');
        }
      });
    }
  }

  /* ================================================================
     2. 每日计划
     ================================================================ */
  function viewDailyPlan() {
    const dateStr = U.todayStr();
    const items = S.getPlanItems(dateStr);
    const { done, total, pct } = S.planProgress(dateStr);

    // 今日目标统一在下方「今日计划」卡片内通过 goalList 渲染，
    // 此处不再重复渲染（早期版本此处 catBlocks 与 goalList 重复渲染了同一批 items，
    // 会导致“页面上出现两个张弓”且点击错位时 toggle 失效）
    const byCat = {};
    items.forEach(i => { (byCat[i.category] = byCat[i.category] || []).push(i); });

    // ===== 未完成的模块每日待办（与各模块页同步） =====
    const pending = U.pendingTodos(); // 仅未完成
    const allTodos = (typeof U.getAllModuleTodos === 'function') ? U.getAllModuleTodos() : U.MODULE_TODOS;
    const moduleTotal = Object.keys(allTodos).reduce((s, c) => s + (allTodos[c] || []).length, 0);
    const moduleDoneCount = moduleTotal - pending.length;
    const pendingHTML =
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">⏰</span>今日待办' +
          '<span class="tag tag-logic" style="margin-left:auto">' + pending.length + ' 项未完成</span>' +
        '</div>' +
        '<div class="section-tip">点击待办即可跳转到对应模块页去完成；完成后再回到这里会自动消失。</div>' +
        U.progressHTML(moduleDoneCount, moduleTotal) +
        '<div class="todo-list" style="margin-top:10px">' +
          (pending.length ? pending.map(p =>
            '<div class="todo-item todo-goto-row" data-goto="' + p.cat + '">' +
              '<span class="todo-go-icon">🔗</span>' +
              '<div class="todo-txt" style="flex:1">' + U.esc(p.title) + ' <span style="color:var(--primary-deep);font-size:13px">›</span></div>' +
              '<span class="tag ' + U.catInfo(p.cat).cls + '" style="flex-shrink:0">' + p.catLabel + '</span>' +
            '</div>'
          ).join('') : '<div class="empty" style="padding:14px"><div class="e-icon">🎉</div><div class="e-txt">今日待办已全部完成，太棒了！</div></div>') +
        '</div>' +
      '</div>';

    // ===== 课程规划（智能规划） =====
    // 注意：S.getPlans/U.planProgressInfo 是较新版本才有的方法，
    // 在旧版本或部分缓存的情况下可能不存在，用 typeof 保护避免渲染失败
    let plans = [];
    try {
      if (S && typeof S.getPlans === 'function') {
        const allPlans = S.getPlans() || [];
        plans = allPlans.filter(p =>
          p && typeof p.courseName === 'string' &&
          p.totalHours > 0 && p.days > 0 && p.dailyHours > 0 && p.startDate
        );
        // 按开始日期升序排列（YYYY-MM-DD 字符串可直接比较）
        plans.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
      }
    } catch (e) { plans = []; }
    // 渲染规划卡片：整个块包 try-catch，万一新方法不可用也不影响主页面
    let plansHTML;
    try {
      plansHTML =
        '<div class="card">' +
          '<div class="card-title"><span class="emoji">🗓️</span>课程规划' +
            '<span style="margin-left:auto;display:flex;gap:6px">' +
              '<button class="btn btn-sm btn-ghost" data-exportplan>📤 诊断</button>' +
              '<button class="btn btn-sm btn-soft" data-smartplan>⚡ 智能规划</button>' +
            '</span>' +
          '</div>' +
          '<div class="section-tip">输入课程名称、课时、期望天数与开始日期，系统自动分配每天学习课时并生成预计完成日期。</div>' +
          (plans.length ? plans.slice().sort((a, b) => {
            // 已学完的课程自动排到最底下（在读结束日期之前的视为进行中）
            const af = U.planProgressInfo(a).finished ? 1 : 0;
            const bf = U.planProgressInfo(b).finished ? 1 : 0;
            return af - bf;
          }).map((p, idx) => {
            const ci = U.catInfo(p.category);
            const pi = U.planProgressInfo(p);
            const isFirst = idx === 0;
            const isLast = idx === plans.length - 1;
            const status = pi.finished
              ? '<span class="tag tag-success">已学完</span>'
              : '<span class="tag ' + ci.cls + '">剩 ' + pi.remainingDays + ' 天 · ' + pi.remainingHours + ' 课时</span>';
            return '<div class="plan-card">' +
              '<div class="plan-head">' +
                '<span class="plan-icon">' + ci.icon + '</span>' +
                '<div class="plan-title">' + U.esc(p.courseName) + status + '</div>' +
                '<div class="plan-ops">' +
                  '<button class="btn btn-sm btn-ghost" data-makeup="' + p.id + '" title="补打卡" style="padding:3px 7px;font-size:12px">📌 补打卡</button>' +
                  '<button class="btn btn-sm btn-soft" data-editplan-c="' + p.id + '" title="修改" style="padding:3px 7px;font-size:12px">✎</button>' +
                  '<button class="btn btn-sm btn-danger" data-delplan-c="' + p.id + '" title="删除" style="padding:3px 7px;font-size:11px">✕</button>' +
                '</div>' +
              '</div>' +
              '<div class="plan-meta">' +
                '共 ' + p.totalHours + ' 课时 · 每天 ' + p.dailyHours + ' 课时 · ' + p.days + ' 天' +
              '</div>' +
              '<div class="plan-date">📅 ' + pi.startDate + ' ~ ' + pi.endDate + ' · 已学 ' + pi.learned + '/' + p.totalHours + ' 课时</div>' +
              U.progressHTML(pi.learned, p.totalHours) +
            '</div>';
          }).join('') : '<div class="empty" style="padding:14px"><div class="e-icon">⚡</div><div class="e-txt">还没有课程规划<br>点击「智能规划」，输入课程和课时，自动安排每日学习</div></div>') +
        '</div>';
    } catch (e) {
      // 新功能不可用时，整个规划卡片不渲染，主页面仍然完整
      plansHTML = '';
    }

    // ===== 今日目标条目列表（直接显示在卡片内） =====
    const goalList = items.length ? items.map(it => {
      const ci = U.catInfo(it.category);
      return '<div class="todo-item' + (it.done ? ' done' : '') + '" data-plan-row="' + it.id + '">' +
        '<div class="todo-check' + (it.done ? ' checked' : '') + '" data-plan="' + it.id + '">' + (it.done ? '✓' : '') + '</div>' +
        '<span class="tag ' + ci.cls + ' todo-cat-tag" style="flex-shrink:0">' + ci.label + '</span>' +
        '<div class="todo-txt' + (it.done ? ' checked' : '') + '">' + U.esc(it.title) + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-editplan="' + it.id + '" title="修改" style="padding:4px 7px;font-size:12px;flex-shrink:0">✎</button>' +
        '<button class="btn btn-sm btn-danger" data-delplan="' + it.id + '" title="删除" style="padding:4px 8px;font-size:11px;flex-shrink:0">✕</button>' +
      '</div>';
    }).join('') : '<div class="empty" style="padding:14px"><div class="e-icon">🎯</div><div class="e-txt">今天还没有目标<br>点击右上角「＋ 添加目标」开始规划</div></div>';

    return '' +
      renderReviewCard() +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📅</span>' + U.fmtDate(dateStr) + ' 今日计划' +
          '<button class="btn btn-sm btn-soft" data-addpl style="margin-left:8px">＋ 添加</button>' +
          '<button class="btn btn-sm btn-ghost" data-clearpl title="清空今日目标并重新生成" style="margin-left:8px">清空</button>' +
        '</div>' +
        U.progressHTML(done, total) +
        '<div class="todo-list" style="margin-top:10px">' + goalList + '</div>' +
        '<div class="section-tip" style="margin-top:10px">💡 每个目标每日仅完成一次，完成后同步到对应模块。</div>' +
      '</div>' +
      pendingHTML +
      plansHTML;
  }

  function bindDailyPlan() {
    // 自动生成今日的课程规划任务
    U.seedTodayFromPlans();
    // 事件由全局委托处理 (data-plan, data-delplan, data-addpl, data-smartplan, data-delplan-c, data-editplan-c)
    // 绑定艾宾浩斯待复习打卡
    bindReviewDoneEvents();
  }

  /* ================================================================
     艾宾浩斯复习 · 今日待复习卡片（今日计划页顶部）
     ================================================================ */
  // 计算今日到期的口诀记忆复习
  function collectDueReviews() {
    const dateStr = U.todayStr();
    const dueMemories = [];
    try {
      if (S && typeof S.memoryReviewsDueOn === 'function') {
        S.memoryReviewsDueOn(dateStr).forEach(r => {
          // 仅处理口诀类（kj: 前缀）。其他类型（id:成语辨析、im:成语释义等）
          // 会在各自模块的复习入口中处理，不混入口诀复习卡片。
          if (!r.memoryKey || r.memoryKey.indexOf('kj:') !== 0) return;
          // 解析口诀编号（memoryKey 形如 'kj:12'）
          const kjNum = r.memoryKey.slice(3);
          let snippet = '记忆内容', title = '', kjObj = null;
          if (kjNum) {
            const kjList = (C.COMMON_KOUJUE || []);
            const kj = kjList.find(x => String(x.num || x.id) === String(kjNum));
            if (kj) {
              kjObj = kj;
              snippet = (kj.koujue || kj.title || '').slice(0, 34);
              title = '口诀' + kjNum + (kj.title ? ' · ' + kj.title : '');
            }
          }
          dueMemories.push({
            id: r.id, memoryKey: r.memoryKey, round: r.round, dueDays: r.dueDays,
            snippet: snippet, title: title, kj: kjObj,
          });
        });
      }
    } catch (e) {}
    return { dueMemories, total: dueMemories.length };
  }

  // 生成"今日待复习"卡片 HTML（无到期时返回空串，不显示卡片）
  function renderReviewCard() {
    const { dueMemories, total } = collectDueReviews();
    if (total === 0) return '';
    const memHTML = dueMemories.map(m =>
      '<div class="todo-item">' +
        '<span class="todo-go-icon">📜</span>' +
        '<div class="todo-txt" data-showkj-mem="' + m.id + '" style="cursor:pointer;flex:1">' +
          '<b>' + U.esc(m.title || '记忆内容') + '</b>' +
          '<div class="li-meta" style="font-weight:400;color:var(--ink-3)">' + U.esc(m.snippet) + '</div>' +
          '<div class="li-meta" style="font-weight:500;color:var(--brand);font-size:11px;margin-top:2px">📖 点这里查看完整口诀 →</div>' +
        '</div>' +
        '<span class="tag tag-mistake" style="flex-shrink:0">第' + m.round + '轮</span>' +
        '<button class="btn btn-sm btn-soft" data-reviewdone-mem="' + m.id + '" style="flex-shrink:0">✓ 已复习</button>' +
      '</div>'
    ).join('');
    return '' +
      '<div class="card review-card">' +
        '<div class="card-title"><span class="emoji">🧠</span>今日待复习' +
          '<span class="tag tag-logic" style="margin-left:auto">' + total + ' 项到期</span>' +
        '</div>' +
        '<div class="section-tip">根据艾宾浩斯遗忘曲线，以下内容今天需要复习巩固，趁热打铁记得更牢。</div>' +
        (memHTML ? '<div class="cc-title" style="margin:6px 0 4px">📜 口诀记忆复习</div><div class="todo-list">' + memHTML + '</div>' : '') +
      '</div>';
  }

  // 绑定"已复习"打卡：今日计划页口诀记忆复习"已复习"按钮
  function bindReviewDoneEvents() {
    const page = document.querySelector('.page.active-page');
    if (!page) return;
    // 口诀记忆复习"已复习"打卡
    page.querySelectorAll('[data-reviewdone-mem]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-reviewdone-mem');
        if (S && typeof S.markMemoryReviewed === 'function') {
          S.markMemoryReviewed(id);
        }
        U.toast('✅ 已复习，口诀更牢固！');
        global.APP.renderPage(global.APP.current || 'dailyplan');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
    // 口诀记忆复习"查看完整内容"弹层
    page.querySelectorAll('[data-showkj-mem]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-showkj-mem');
        const { dueMemories } = collectDueReviews();
        const m = dueMemories.find(x => x.id === id);
        if (!m || !m.kj) {
          U.toast('⚠️ 暂无完整口诀内容');
          return;
        }
        const kj = m.kj;
        const quizList = (kj.quiz && kj.quiz.length) ? kj.quiz : [];
        const quizHTML = quizList.map(function (qz) {
          const optsHTML = (qz.options || []).map(function (o) {
            return '<div class="quiz-op">' + U.esc(o) + '</div>';
          }).join('');
          return '<div class="koujue-quiz">' +
            '<div class="quiz-q">' + U.esc(qz.q) + '</div>' +
            (optsHTML ? '<div class="quiz-opts">' + optsHTML + '</div>' : '') +
            '<div class="quiz-ans"><b>答案：</b>' + U.esc(qz.answer) + '</div>' +
            '<div class="quiz-exp"><b>解析：</b>' + U.esc(qz.explain) + '</div>' +
          '</div>';
        }).join('');
        const body = '' +
          '<div style="padding:14px 18px 20px">' +
            '<div class="koujue-divider"></div>' +
            '<div class="koujue-label">📜 口诀全文</div>' +
            '<div class="koujue-summary" style="font-size:15px;line-height:1.8;font-weight:600">' + U.esc(kj.koujue || '') + '</div>' +
            (kj.summary ? (
              '<div class="koujue-divider"></div>' +
              '<div class="koujue-label">📖 口诀释义</div>' +
              '<div class="koujue-summary">' + U.esc(kj.summary) + '</div>'
            ) : '') +
            (quizHTML ? (
              '<div class="koujue-divider"></div>' +
              '<div class="koujue-label">🎯 口诀实战</div>' +
              quizHTML
            ) : '') +
          '</div>';
        U.openSheet(body, '口诀 ' + (kj.num ? kj.num + ' · ' : '') + U.esc(kj.title || ''));
      });
    });
  }

  /* ================================================================
     行测各模块 —— 通用结构（待办事项 → 每日进度 → 专属内容）
     ================================================================ */
  function moduleShell(catKey, title, icon, todoTexts, innerHTML) {
    // 待办事项：统一使用共享配置 U.getModuleTodoEntries（保留原始 index，支持修改/删除，与每日计划页同步）
    const todos = (typeof U.getModuleTodoEntries === 'function')
      ? U.getModuleTodoEntries(catKey)
      : (U.MODULE_TODOS[catKey] || []).map((t, i) => ({ index: i, title: t }));
    // 模块每日真题已暂停：该模块的「完成今日XX真题」待办视为已完成（显示勾选态，并计入每日学习进度）
    const dqPaused = (typeof U.dqPaused === 'function') ? U.dqPaused(catKey) : false;
    const isTodoDone = function (key, t) {
      if (dqPaused && /真题/.test(t)) return true;
      return U.todoDone(key);
    };
    // 渲染前先把每条待办注册进模块打卡记录（保持勾选态一致），
    // 这样"每日学习进度"分母=待办数，勾选即联动，进度从 0/N 而非 0/0 开始
    todos.forEach((e) => {
      const key = U.todoKey(catKey, e.index);
      const done = isTodoDone(key, e.title);
      try { S.registerModuleTodo(catKey, e.title, done); } catch (err) {}
    });
    // 每日进度（该模块今日打卡）
    const mItems = S.moduleDoneToday(catKey);
    const mDone = mItems.filter(i => i.checked).length;
    const todoHTML = todos.map((e) => {
      const i = e.index;
      const t = e.title;
      const key = U.todoKey(catKey, i);
      const done = isTodoDone(key, t);
      return '<div class="todo-item' + (done ? ' done' : '') + '">' +
        '<div class="todo-check' + (done ? ' checked' : '') + '" data-rtodo="' + key + '" data-cat="' + U.esc(catKey) + '" data-title="' + U.esc(t) + '">' + (done ? '✓' : '') + '</div>' +
        '<div class="todo-txt' + (done ? ' checked' : '') + '">' + U.esc(t) + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-editmtodo="' + catKey + ':' + i + '" title="修改" style="padding:3px 7px;font-size:11px;flex-shrink:0">✎</button>' +
        '<button class="btn btn-sm btn-ghost" data-delmtodo="' + catKey + ':' + i + '" title="删除" style="padding:3px 7px;font-size:11px;flex-shrink:0;color:#e06666">✕</button>' +
      '</div>';
    }).join('');

    return '' +
      // ① 待办事项
      '<div class="card">' +
        '<div class="todo-header"><span style="font-size:20px">📝</span><span class="th-title">今日待办 · ' + title + '</span></div>' +
        '<div class="todo-list" data-mtodo="' + U.esc(catKey) + '">' + (todoHTML || '<div class="e-txt" style="color:var(--ink-3);font-size:12px">今日暂无待办</div>') + '</div>' +
      '</div>' +
      // ② 每日进度
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📈</span>每日学习进度</div>' +
        U.progressHTML(mDone, mItems.length) +
        '<div class="li-meta" style="margin-top:8px">已完成 ' + mDone + '/' + mItems.length + ' 个打卡目标（同步自每日计划）</div>' +
      '</div>' +
      // ③ 专属内容
      innerHTML;
  }

  // 局部刷新「今日待办」卡片的勾选态（基于 localStorage 的 todoKey），
  // 用于点击「已记忆」等联动场景——只重渲染待办列表，不整页重渲染，避免页面跳回顶部。
  function refreshModuleTodo(catKey) {
    const listEl = document.querySelector('[data-mtodo="' + catKey + '"]');
    if (!listEl) return;
    const todos = (typeof U.getModuleTodoEntries === 'function') ? U.getModuleTodoEntries(catKey) : [];
    const dqPaused = (typeof U.dqPaused === 'function') ? U.dqPaused(catKey) : false;
    listEl.innerHTML = (todos.length ? todos.map(function (e) {
      const i = e.index;
      const t = e.title;
      const key = U.todoKey(catKey, i);
      const done = (dqPaused && /真题/.test(t)) ? true : U.todoDone(key);
      return '<div class="todo-item' + (done ? ' done' : '') + '">' +
        '<div class="todo-check' + (done ? ' checked' : '') + '" data-rtodo="' + key + '" data-cat="' + U.esc(catKey) + '" data-title="' + U.esc(t) + '">' + (done ? '✓' : '') + '</div>' +
        '<div class="todo-txt' + (done ? ' checked' : '') + '">' + U.esc(t) + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-editmtodo="' + catKey + ':' + i + '" title="修改" style="padding:3px 7px;font-size:11px;flex-shrink:0">✎</button>' +
        '<button class="btn btn-sm btn-ghost" data-delmtodo="' + catKey + ':' + i + '" title="删除" style="padding:3px 7px;font-size:11px;flex-shrink:0;color:#e06666">✕</button>' +
      '</div>';
    }).join('') : '<div class="e-txt" style="color:var(--ink-3);font-size:12px">今日暂无待办</div>');
  }

  /* ---------- 3. 政治理论 ---------- */
  function viewPolitics() {
    // 近日时政热点：每天滚动 10 条，点击展开考点、来源、原文链接，无翻页
    const shizhengAll = (C.POLITICS && C.POLITICS.length) ? C.POLITICS : [];
    const shizhengDay = 10;
    const shizhengOfDay = shizhengAll.length ? pickRange(shizhengAll, (dayIdx * shizhengDay) % shizhengAll.length, shizhengDay) : [];
    const shizhengHTML = shizhengOfDay.map((p, i) =>
      '<details class="custom" style="margin-bottom:8px">' +
        '<summary>📰 ' + (i + 1) + '. ' + U.esc(p.title) + '</summary>' +
        '<div class="d-body">' +
          (p.kaodian ? '<div class="li-meta" style="margin-bottom:6px"><span class="kaodian">🎯 考点：' + U.esc(p.kaodian) + '</span></div>' : '') +
          (p.source ? '<div class="li-meta" style="margin-bottom:6px">📌 来源：' + U.esc(p.source) + '</div>' : '') +
          (p.link ? '<div class="li-meta"><a class="link" href="' + U.esc(p.link) + '" target="_blank" rel="noopener">🔗 查看原文</a></div>' : '') +
        '</div>' +
      '</details>'
    ).join('');

    // 核心考点卡：每日滚动展示 5 条，标题 + 可展开要点；每条可点「✓ 已学」计入政治考点累积统计
    const kaodianAll = (C.POLITICS_KAODIAN && C.POLITICS_KAODIAN.length) ? C.POLITICS_KAODIAN : [];
    const kaodianDay = 5;
    const kaodianOfDay = kaodianAll.length ? pickRange(kaodianAll, (dayIdx * kaodianDay) % kaodianAll.length, kaodianDay) : [];
    const kdLearned = (S && typeof S.kaodianMasteryStats === 'function') ? S.kaodianMasteryStats().learned : 0;
    const kdToday = U.todayStr();
    const kaodianHTML = kaodianOfDay.map((k) => {
      const title = k.title || '';
      const st = (S && typeof S.memoryQuizResultOfDay === 'function') ? S.memoryQuizResultOfDay(kdToday, 'kd:' + title) : null;
      const knowCls = st === 'known' ? ' on' : '';
      return '<details class="custom">' +
        '<summary>📌 ' + U.esc(title) +
          (k.source ? '<span class="src-tag ' + U.esc(k.source) + '">' + U.esc(k.source) + '</span>' : '') +
        '</summary>' +
        '<div class="d-body"><b>要点：</b>' + U.esc(k.point) + '</div>' +
        '<div class="kd-act"><button class="pill know' + knowCls + '" data-kd-title="' + U.esc(title) + '">✓ 已学</button></div>' +
      '</details>';
    }).join('');

    // 每日真题训练进度（累计已做 / 题库总量）
    const dqP = (typeof U.dqProgress === 'function') ? U.dqProgress('politics', 10) : { answered: 0, total: 10 };
    const cumCount = (typeof U.cumulativeQuizCount === 'function') ? U.cumulativeQuizCount('politics') : dqP.answered;
    const quizTotal = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal('politics') : 0;

    return moduleShell('politics', '政治理论', '🏛️', [
      '学习今日时政热点10条',
      '熟记5个核心考点',
    ], '' +
      '<div class="conn-badge-row"><span class="conn-badge ' + (S.isConnected() ? 'green' : 'red') + '">' + (S.isConnected() ? '🟢 联网已连接' : '🔴 未连接') + '</span></div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🏛️</span>近日时政热点<span class="card-sub">（每日更新 · 每天10条 · 标注公考考点）</span></div>' +
        '<div class="section-tip">内容整理自新华社、人民网、中国政府网、人民日报、半月谈等各大官媒，每日展示 10 条，点击展开考点、来源与原文链接。</div>' +
        (shizhengHTML || '<div class="empty"><div class="e-txt">时政热点整理中，敬请期待</div></div>') +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">💎</span>核心考点<span class="card-sub">（每日' + kaodianOfDay.length + '条 · 已学<span data-kd-count>' + kdLearned + '</span>/' + kaodianAll.length + '条）</span></div>' +
        '<div class="section-tip">政治理论高频考点精要，源自核心考点库，务必熟记掌握。</div>' +
        (kaodianHTML || '<div class="empty"><div class="e-txt">核心考点库整理中，敬请期待</div></div>') +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>每日真题训练<span class="card-sub">（考点精练 · 每日10题 · 累计已做 ' + cumCount + ' 题 / 共 ' + quizTotal + ' 题）</span></div>' +
        '<div class="section-tip">涵盖时政、理论、政策等政治理论高频考点，单题作答，答对自动下一题，答错加入错题本。</div>' +
        '<div data-dailyquiz data-module="politics" data-min="3"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="politics"></div>' +
      '</div>');
  }
  function bindPolitics() {
    bindModulePlanEvents('politics');
    bindDailyQuiz('politics', C.POLITICS_QUIZ, { label: '政治理论' });
    // 核心考点：点「✓ 已学」即计入政治考点累积统计，并接入艾宾浩斯复习队列
    document.querySelectorAll('[data-kd-title]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = btn.getAttribute('data-kd-title');
        if (!title) return;
        if (S && typeof S.markMemoryQuizResult === 'function') {
          S.markMemoryQuizResult('kd:' + title, 'kaodian', 'known');
        }
        btn.classList.add('on');
        btn.blur();
        U.toast('✅ 已记为「已学」，计入政治考点累积统计');
        // 仅就地更新「已学x/共y」计数，避免整页重渲染导致页面跳回顶部
        try {
          const learned = (S && typeof S.kaodianMasteryStats === 'function') ? S.kaodianMasteryStats().learned : 0;
          document.querySelectorAll('[data-kd-count]').forEach(el => { el.textContent = learned; });
        } catch (err) {}
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
  }

  /* ---------- 4. 常识判断 ---------- */
  function viewCommon() {
    /* ---------- 常识每日速记：COMMON 六类 + 口诀速背池，两池合并统一滚动 ---------- */
    const PER_CAT = 2; // 每类每日滚动条数
    // 口诀已独立成「口诀速背」卡片，常识每日速记卡不再单设「口诀」类，避免重复
    const kjCat = null;
    const allCats = kjCat ? C.COMMON.concat([kjCat]) : C.COMMON.slice();
    const cats = pickRange(allCats, (dayIdx * allCats.length) % allCats.length, allCats.length); // 每天展示全部类别（顺序每日轮转）
    const poolTotal = C.COMMON.reduce(function (n, c) { return n + (c.items ? c.items.length : 0); }, 0) + (kjCat ? kjCat.items.length : 0);
    const dailyTotal = cats.length * PER_CAT;
    // 类内滚动：每天固定前进 PER_CAT 条。注意不能用 pickRange（它会再叠加一次 dayIdx，
    // 导致步长被放大为 PER_CAT+1 倍，当条数与步长不互质时会漏掉部分条目并提前重复）
    function rollItems(items, n) {
      const len = items.length;
      const start = ((dayIdx * n) % len + len) % len;
      const res = [];
      for (let i = 0; i < n; i++) res.push(items[(start + i) % len]);
      return res;
    }
    const blocks = cats.map(c =>
      '<div class="cat-card">' +
        '<div class="cc-title">' + c.icon + ' ' + c.cat + '</div>' +
        rollItems(c.items, PER_CAT).map(it => // 每类每日滚动取 PER_CAT 条
          '<details class="custom"><summary>❓ ' + U.esc(it.q) +
            (it.source ? '<span class="src-tag ' + U.esc(it.source) + '">' + U.esc(it.source) + '</span>' : '') +
            '</summary>' +
            '<div class="d-body"><b>答案：</b>' + U.esc(it.a) + '<br><br><b>解析：</b>' + U.esc(it.note) + '</div>' +
          '</details>'
        ).join('') +
      '</div>'
    ).join('');

    // 每日真题训练进度（累计已做 / 题库总量）
    const dqP = (typeof U.dqProgress === 'function') ? U.dqProgress('common', 10) : { answered: 0, total: 10 };
    const cumCount = (typeof U.cumulativeQuizCount === 'function') ? U.cumulativeQuizCount('common') : dqP.answered;
    const quizTotal = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal('common') : 0;

    /* ---------- 口诀速背（常识88条 · 每日1条） ---------- */
    const kjList = (C.COMMON_KOUJUE && C.COMMON_KOUJUE.length) ? C.COMMON_KOUJUE : [];
    const kjOfDay = kjList.length ? pick(kjList) : null;
    const kjLearned = (S && typeof S.koujueMasteryStats === 'function') ? S.koujueMasteryStats().learned : 0;
    const kjQuizHTML = (qzs) => qzs.map(function (qz) {
      const hasLabel = qz.options && qz.options.some(function (o) { return /^[A-Ha-h][\.、)）]/.test(o); });
      const optsHTML = qz.options ? qz.options.map(function (o, i) {
        if (o === '正确' || o === '错误') return '<div class="quiz-op">' + U.esc(o) + '</div>';
        const pre = hasLabel ? '' : ('ABCDEFGH'[i] + '. ');
        return '<div class="quiz-op">' + pre + U.esc(o) + '</div>';
      }).join('') : '';
      return '<div class="koujue-quiz">' +
        '<div class="quiz-q">' + U.esc(qz.q) + '</div>' +
        (optsHTML ? '<div class="quiz-opts">' + optsHTML + '</div>' : '') +
        '<div class="quiz-ans"><b>答案：</b>' + U.esc(qz.answer) + '</div>' +
        '<div class="quiz-exp"><b>解析：</b>' + U.esc(qz.explain) + '</div>' +
      '</div>';
    }).join('');
    const kjCard = kjOfDay ? (
      (function() {
        // 该口诀的复习进度
        const kjKey = String(kjOfDay.num || kjOfDay.id);
        const prog = (S && typeof S.memoryReviewProgress === 'function') ? S.memoryReviewProgress('kj:' + kjKey) : null;
        let progHTML = '';
        if (prog && !prog.done) {
          progHTML = '<span class="tag tag-mistake" style="margin-left:8px">复习 ' + prog.round + '/' + prog.totalRounds + ' 轮</span>';
        } else if (prog && prog.done) {
          progHTML = '<span class="tag tag-success" style="margin-left:8px">✅ 已完成复习</span>';
        }
        return '<div class="card kj-card">' +
          '<div class="card-title"><span class="emoji">📜</span>口诀速背<span class="card-sub">（常识88条 · 每日1条 · 已学' + kjLearned + '/' + kjList.length + '条）</span>' + progHTML + '</div>' +
          '<div class="section-tip">每天滚动1条公考高频常识口诀，点击口诀原文展开口诀释义与口诀实战真题。背熟后点「✅ 已背」，系统将按艾宾浩斯曲线安排到期复习。</div>' +
          '<details class="custom koujue-details">' +
            '<summary class="koujue-text"><span class="koujue-num">口诀' + kjKey + ' · ' + U.esc(kjOfDay.title) + '</span><span class="koujue-text-body">' + U.esc(kjOfDay.koujue) + '</span></summary>' +
            '<div class="d-body">' +
              '<div class="koujue-divider"></div>' +
              '<div class="koujue-label">📖 口诀释义</div>' +
              '<div class="koujue-summary">' + U.esc(kjOfDay.summary) + '</div>' +
              ((kjOfDay.quiz && kjOfDay.quiz.length) ? (
                '<div class="koujue-divider"></div>' +
                '<div class="koujue-label">🎯 口诀实战</div>' +
                kjQuizHTML(kjOfDay.quiz)
              ) : '') +
            '</div>' +
          '</details>' +
          '<button class="btn btn-primary" data-kj-learn="' + kjKey + '" style="width:100%;margin-top:10px">✅ 已背这条口诀</button>' +
        '</div>';
      })()
    ) : '';

    return moduleShell('common', '常识判断', '🌏', [
      '记忆今日常识12条',
    ], '' +
      kjCard +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🌏</span>常识每日速记<span class="card-sub">（每日' + dailyTotal + '条 · 池共' + poolTotal + '条）</span></div>' +
        '<div class="section-tip">涵盖历史、人文、科技、地理、福建省情、新法速记共' + cats.length + '类，每天滚动全部' + cats.length + '类、每类' + PER_CAT + '条，点击展开答案。约10天一轮回。</div>' +
        blocks +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>每日真题训练<span class="card-sub">（考点精练 · 每日10题 · 累计已做 ' + cumCount + ' 题 / 共 ' + quizTotal + ' 题）</span></div>' +
        '<div class="section-tip">涵盖法律、历史、科技、文化等常识高频考点，单题作答，答对自动下一题，答错加入错题本。</div>' +
        '<div data-dailyquiz data-module="common" data-min="3"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="common"></div>' +
      '</div>');
  }
  function bindCommon() {
    bindModulePlanEvents('common');
    bindDailyQuiz('common', C.COMMON_QUIZ, { label: '常识判断' });
    // "已背"登记：把今日口诀加入记忆复习队列，并联动勾选"记忆常识口诀1条"待办
    document.querySelectorAll('[data-kj-learn]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = el.getAttribute('data-kj-learn');
        if (!key) return;
        let changed = false;
        if (S && typeof S.addMemoryReview === 'function') {
          S.addMemoryReview('kj:' + key, 'koujue');
          changed = true;
        }
        // 联动：自动勾选"今日待办"中的"记忆常识口诀"条目（若无则跳过，不强行创建）
        // 匹配策略：优先标题含"口诀"，兜底匹配默认标题"记忆常识口诀1条"（兼容用户改过标题）
        let linked = false;
        try {
          const entries = (typeof U.getModuleTodoEntries === 'function') ? U.getModuleTodoEntries('common') : [];
          let kjTodo = entries.find(function (en) { return en.title.indexOf('口诀') !== -1; });
          if (!kjTodo) kjTodo = entries.find(function (en) { return en.index === 0; });
          if (kjTodo) {
            const tKey = U.todoKey('common', kjTodo.index);
            const already = localStorage.getItem(Store.PREFIX + tKey) === '1';
            if (!already) {
              localStorage.setItem(Store.PREFIX + tKey, '1');
              if (typeof S.markModuleDone === 'function') S.markModuleDone('common', kjTodo.title);
            }
            linked = true;
          }
        } catch (err) { /* 静默：待办联动失败不影响口诀登记 */ }
        U.toast(changed
          ? (linked ? '✅ 已登记！待办"口诀"已同步勾选，将于 2/4/7/15/30 天后提醒复习' : '✅ 已登记背诵！未找到口诀待办，可到「每日计划」自行添加')
          : '已背');
        try { global.APP.updateBadges(); } catch (err) {}
        global.APP.renderPage(global.APP.current || 'common');
      });
    });
  }

  /* ---------- 5. 言语理解 ---------- */
  // 今日成语释义卡（每日10条，来自 IDIOM_MEANING 库；点「已记忆」接入复习闭环）
  function idiomMeaningCard() {
    const all = (C.IDIOM_MEANING && C.IDIOM_MEANING.length) ? C.IDIOM_MEANING : [];
    if (!all.length) return '';
    const DAY_COUNT = 10;
    const list = pickRange(all, (dayIdx * DAY_COUNT) % all.length, DAY_COUNT);
    const today = U.todayStr();
    const rows = list.map(m => {
      const key = 'im:' + m.word;
      const st = (S && typeof S.memoryQuizResultOfDay === 'function') ? S.memoryQuizResultOfDay(today, key) : null;
      const knowCls = st === 'known' ? ' on' : '';
      const ex = (m.example && m.example.trim()) ? '<div class="im-ex">' + U.esc(m.example) + '</div>' : '';
      return '<div class="im-row">' +
        '<div class="im-main">' +
          '<div class="im-word">' + U.esc(m.word) + '</div>' +
          '<details class="im-detail">' +
            '<summary>📖 释义</summary>' +
            '<div class="im-mn">' + U.esc(m.meaning) + '</div>' + ex +
          '</details>' +
        '</div>' +
        '<div class="im-acts">' +
          '<button class="pill know' + knowCls + '" data-im-word="' + U.esc(m.word) + '" data-im-result="known">✓ 已记忆</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="card">' +
      '<div class="card-title"><span class="emoji">📚</span>今日成语释义<span class="card-sub">（每日10条 · 库共' + all.length + '条 · 常用成语意思学习）</span></div>' +
      '<div class="section-tip">你补充的成语知识库在此承接。点「已记忆」即归档今日所学，计入「成语积累统计」。</div>' +
      rows +
    '</div>';
  }
  // 成语积累统计卡
  function idiomStatCard() {
    const st = (S && typeof S.idiomMasteryStats === 'function') ? S.idiomMasteryStats() : { masteredDiff: 0, learnedMean: 0, reviewMean: 0 };
    const total = (C.IDIOM_MEANING && C.IDIOM_MEANING.length) || 0;
    const pct = total ? Math.round(st.learnedMean / total * 100) : 0;
    return '<div class="card">' +
      '<div class="card-title"><span class="emoji">📊</span>成语积累统计</div>' +
      '<div class="im-stat">' +
        '<div class="im-box"><div class="im-num">' + st.masteredDiff + '</div><div class="im-lab">已掌握辨析(对)</div></div>' +
        '<div class="im-box"><div class="im-num">' + st.learnedMean + '</div><div class="im-lab">已学释义(条)</div></div>' +
        '<div class="im-box"><div class="im-num">' + pct + '%</div><div class="im-lab">覆盖率</div></div>' +
      '</div>' +
    '</div>';
  }
  // 常识口诀累积统计卡（样式同成语积累统计）
  function koujueStatCard() {
    const st = (S && typeof S.koujueMasteryStats === 'function') ? S.koujueMasteryStats() : { learned: 0 };
    const total = (C.COMMON_KOUJUE && C.COMMON_KOUJUE.length) || 0;
    const pct = total ? Math.round(st.learned / total * 100) : 0;
    return '<div class="card">' +
      '<div class="card-title"><span class="emoji">📜</span>常识口诀累积统计</div>' +
      '<div class="im-stat">' +
        '<div class="im-box"><div class="im-num">' + st.learned + '</div><div class="im-lab">已背(条)</div></div>' +
        '<div class="im-box"><div class="im-num">' + total + '</div><div class="im-lab">共(条)</div></div>' +
        '<div class="im-box"><div class="im-num">' + pct + '%</div><div class="im-lab">覆盖率</div></div>' +
      '</div>' +
    '</div>';
  }
  // 政治考点累积统计卡（样式同成语积累统计）
  function kaodianStatCard() {
    const st = (S && typeof S.kaodianMasteryStats === 'function') ? S.kaodianMasteryStats() : { learned: 0 };
    const total = (C.POLITICS_KAODIAN && C.POLITICS_KAODIAN.length) || 0;
    const pct = total ? Math.round(st.learned / total * 100) : 0;
    return '<div class="card">' +
      '<div class="card-title"><span class="emoji">💎</span>政治考点累积统计</div>' +
      '<div class="im-stat">' +
        '<div class="im-box"><div class="im-num">' + st.learned + '</div><div class="im-lab">已学(条)</div></div>' +
        '<div class="im-box"><div class="im-num">' + total + '</div><div class="im-lab">共(条)</div></div>' +
        '<div class="im-box"><div class="im-num">' + pct + '%</div><div class="im-lab">覆盖率</div></div>' +
      '</div>' +
    '</div>';
  }
  function viewLanguage() {
    const pairs = pickRange(C.IDIOMS, dayIdx % C.IDIOMS.length, 1);
    // 每日一组近义/易混成语串讲（用户补充的 19 组轮播）
    const grp = (C.IDIOM_GROUPS && C.IDIOM_GROUPS.length) ? C.IDIOM_GROUPS[dayIdx % C.IDIOM_GROUPS.length] : null;
    // 成语辨析已掌握对数（跨天累计，供「✓ 已掌握辨析」按钮与卡片计数）
    const idMastered = (S && typeof S.idiomMasteryStats === 'function') ? S.idiomMasteryStats().masteredDiff : 0;
    const idToday = U.todayStr();

    // 每日真题训练进度（累计已做 / 题库总量）
    const dqP = (typeof U.dqProgress === 'function') ? U.dqProgress('language', 10) : { answered: 0, total: 10 };
    const cumCount = (typeof U.cumulativeQuizCount === 'function') ? U.cumulativeQuizCount('language') : dqP.answered;
    const quizTotal = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal('language') : 0;

    return moduleShell('language', '言语理解', '💬', [
      '完成今日言语理解20题',
      '背诵成语辨析1组',
    ], '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📖</span>今日成语辨析<span class="card-sub">（每日1对辨析 + 1组串讲 · 共 ' + C.IDIOMS.length + ' 对 / ' + (C.IDIOM_GROUPS ? C.IDIOM_GROUPS.length : 0) + ' 组 · 已掌握<span data-id-count>' + idMastered + '</span>对）</span></div>' +
        '<div class="section-tip">上方为高频近义成语「用法区别」对比（附近5年真题频次）；下方为「近义/易混成语串讲」，逐条给出释义，便于横向区分。</div>' +
        pairs.map(p => {
          const st = (S && typeof S.memoryQuizResultOfDay === 'function') ? S.memoryQuizResultOfDay(idToday, 'id:' + (p.a || '') + '-' + (p.b || '')) : null;
          const knowCls = st === 'known' ? ' on' : '';
          return '<details class="custom"><summary>🔤 ' + U.esc(p.a) + ' ↔ ' + U.esc(p.b) +
            (p.gk ? '<span class="src-tag gk">国考' + p.gk + '次</span>' : '') +
            (p.fj ? '<span class="src-tag fj">福建' + p.fj + '次</span>' : '') +
          '</summary>' +
            '<div class="d-body"><b>用法区别：</b>' + U.esc(p.diff) + '</div>' +
            ((p.gk || p.fj) ? '<div class="li-meta" style="margin-top:8px"><span class="freq-tag">📊 近5年真题频次：国考 ' + (p.gk || 0) + ' 次 · 福建省考 ' + (p.fj || 0) + ' 次</span></div>' : '') +
            '<div class="kd-act"><button class="pill know' + knowCls + '" data-id-a="' + U.esc(p.a) + '" data-id-b="' + U.esc(p.b) + '">✓ 已掌握辨析</button></div>' +
          '</details>';
        }).join('') +
        (grp ?
          '<div class="grp-divider"></div>' +
          '<div class="grp-block">' +
            '<div class="grp-tag">🧩 ' + U.esc(grp.tag) + ' · 近义/易混成语串讲</div>' +
            '<details class="custom" open>' +
              '<summary>🔤 ' + U.esc(grp.title) + '</summary>' +
              '<div class="grp-items">' +
                grp.items.map(function (it) {
                  return '<div class="grp-item"><span class="grp-w">' + U.esc(it.word) + '</span>' +
                    '<span class="grp-mn">：' + U.esc(it.meaning) + '</span></div>';
                }).join('') +
              '</div>' +
            '</details>' +
          '</div>'
        : '') +
      '</div>' +
      idiomMeaningCard() +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>每日真题训练<span class="card-sub">（考点精练 · 每日10题 · 累计已做 ' + cumCount + ' 题 / 共 ' + quizTotal + ' 题）</span></div>' +
        '<div class="section-tip">单题作答，答对自动下一题，答错显示解析并加入错题本。</div>' +
        '<div data-dailyquiz data-module="language" data-min="3"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="language"></div>' +
      '</div>');
  }
  function bindLanguage() {
    bindModulePlanEvents('language');
    bindDailyQuiz('language', C.LANGUAGE_QUIZ, { label: '言语理解' });
    // 成语释义：点「已记忆」即归档今日所学，接入复习闭环
    document.querySelectorAll('[data-im-word]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.getAttribute('data-im-word');
        const result = btn.getAttribute('data-im-result');
        if (S && typeof S.markMemoryQuizResult === 'function') {
          S.markMemoryQuizResult('im:' + word, 'idiomMeaning', result);
        }
        // 仅就地更新当前按钮状态，避免整页重渲染导致页面跳回顶部
        btn.classList.add('on');
        btn.blur();
        U.toast('✅ 已记为「已记忆」，加入复习计划');

        // 联动：当日 10 个成语全部「已记忆」后，自动勾选今日待办「积累成语10个」
        try {
          const allBtns = document.querySelectorAll('[data-im-word]');
          const total = allBtns.length;
          const done = document.querySelectorAll('[data-im-word].on').length;
          if (total > 0 && done >= total) {
            const entries = (typeof U.getModuleTodoEntries === 'function') ? U.getModuleTodoEntries('language') : [];
            const cy = entries.find(function (en) { return en.title && en.title.indexOf('积累成语') !== -1; });
            if (cy) {
              const tKey = U.todoKey('language', cy.index);
              const already = localStorage.getItem(Store.PREFIX + tKey) === '1';
              if (!already) {
                localStorage.setItem(Store.PREFIX + tKey, '1');
                if (S && typeof S.markModuleDone === 'function') S.markModuleDone('language', cy.title);
                // 局部刷新「今日待办」卡片（用户可见的"今日待办 · 言语理解"），即时显示勾选
                if (typeof refreshModuleTodo === 'function') refreshModuleTodo('language');
                // 同步刷新「今日计划」卡片（data-modplan），保持两处一致
                if (typeof bindModulePlanEvents === 'function') bindModulePlanEvents('language');
                if (global.APP && typeof global.APP.updateBadges === 'function') global.APP.updateBadges();
                U.toast('🎯 今日「积累成语10个」已完成！');
              }
            }
          }
        } catch (err) { /* 静默：联动失败不影响成语登记 */ }
      });
    });
    // 成语辨析：点「✓ 已掌握辨析」计入成语积累统计，并接入艾宾浩斯复习队列
    document.querySelectorAll('[data-id-a]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = btn.getAttribute('data-id-a') || '';
        const b = btn.getAttribute('data-id-b') || '';
        const key = 'id:' + a + '-' + b;
        if (S && typeof S.markMemoryQuizResult === 'function') {
          S.markMemoryQuizResult(key, 'idiom', 'known');
        }
        btn.classList.add('on');
        btn.blur();
        U.toast('✅ 已记为「已掌握辨析」，计入成语积累统计');
        // 仅就地更新「已掌握x对」计数，避免整页重渲染导致页面跳回顶部
        try {
          const mastered = (S && typeof S.idiomMasteryStats === 'function') ? S.idiomMasteryStats().masteredDiff : 0;
          document.querySelectorAll('[data-id-count]').forEach(el => { el.textContent = mastered; });
        } catch (err) {}
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
  }

  /* ---------- 6. 判断推理 ---------- */
  function viewLogic() {
    const t = pick(C.LOGIC_TYPES);
    // 每日真题训练进度（累计已做 / 题库总量）
    const dqP = (typeof U.dqProgress === 'function') ? U.dqProgress('logic', 10) : { answered: 0, total: 10 };
    const cumCount = (typeof U.cumulativeQuizCount === 'function') ? U.cumulativeQuizCount('logic') : dqP.answered;
    const quizTotal = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal('logic') : 0;
    return moduleShell('logic', '判断推理', '🧩', [
      '完成今日判断推理真题10题',
      '掌握今日题型解题要点',
    ], '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📐</span>今日题型：' + t.icon + ' ' + t.type + '</div>' +
        (t.freq ? '<div class="li-meta" style="margin-top:6px"><span class="freq-tag">📊 ' + U.esc(t.freq) + '</span> ' + (t.years ? '<span style="color:#666">' + U.esc(t.years) + '</span>' : '') + '</div>' : '') +
        '<div class="card-sub" style="margin:10px 0 6px">核心考点：</div>' +
        '<div class="formula-box">' + U.esc(t.formula).replace(/\n/g, '<br>') + '</div>' +
        (t.key ? '<div class="card-sub" style="margin:10px 0 6px">解题要点：</div>' +
          '<div class="analysis" style="display:block;margin-top:0">💡 ' + U.esc(t.key) + '</div>' : '') +
        (t.pitfall ? '<div class="card-sub" style="margin:10px 0 6px">易错点：</div>' +
          '<div class="analysis warn" style="display:block;margin-top:0">⚠️ ' + U.esc(t.pitfall) + '</div>' : '') +
        '<div class="card-sub" style="margin:10px 0 6px">经典例题：</div>' +
        '<div class="analysis" style="display:block;margin-top:0">' + U.esc(t.example) + '</div>' +
        '<div class="analysis" style="display:block;margin-top:8px"><b>解答：</b>' + U.esc(t.solution) + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>每日真题训练<span class="card-sub">（今日题型4 + 定义2 + 类比2 + 逻辑2 · 累计已做 ' + cumCount + ' 题 / 共 ' + quizTotal + ' 题）</span></div>' +
        '<div class="section-tip">前4题为今日题型"' + U.esc(t.type) + '"相关真题，后6题为定义判断、类比推理、逻辑判断各2题，共10题。单题作答，答对自动下一题，答错加入错题本。</div>' +
        '<div data-dailyquiz data-module="logic" data-min="4"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="logic"></div>' +
      '</div>');
  }
  function bindLogic() {
    bindModulePlanEvents('logic');
    // 每日真题训练10题：定义2 + 类比2 + 逻辑2 + 今日题型相关4题
    const pool = C.LOGIC_QUIZ_BY_TYPE || {};
    // 图形推理题库原仅有模拟题且已删除（figure 池已清空），轮换到图形推理时改从其他真实题型借题，当天不出图形题
    const FIG_TYPES = ['图形推理·位置规律', '图形推理·数量规律'];
    let t = pick(C.LOGIC_TYPES);
    if (FIG_TYPES.indexOf(t.type) >= 0) {
      const realTypes = (C.LOGIC_TYPES || []).filter(function (x) { return FIG_TYPES.indexOf(x.type) < 0; });
      t = pick(realTypes);
    }
    // 今日题型 → 题库大类映射
    const typeMap = {
      '定义判断': 'define',
      '类比推理·对应语义': 'analogy',
      '逻辑判断·加强论证': 'logic',
      '逻辑判断·削弱论证': 'logic',
      '逻辑判断·翻译推理': 'logic',
      '逻辑判断·分析推理': 'logic',
    };
    const todayKey = typeMap[t.type] || 'logic';
    const todayPool = pool[todayKey] || [];
    const sections = [
      { key: 'today',   count: 4, label: '今日题型·' + t.type },
      { key: 'define',  count: 2, label: '定义判断' },
      { key: 'analogy', count: 2, label: '类比推理' },
      { key: 'logic',   count: 2, label: '逻辑判断' },
    ];
    bindDailyQuiz('logic', Object.assign({}, pool, { today: todayPool }), {
      label: '判断推理',
      sections: sections
    });
  }

  /* ---------- 7. 数量关系 ---------- */
  function viewQuantity() {
    const t = pick(C.QUANTITY);
    // 每日真题训练进度（累计已做 / 题库总量）
    const dqP = (typeof U.dqProgress === 'function') ? U.dqProgress('quantity', 10) : { answered: 0, total: 10 };
    const cumCount = (typeof U.cumulativeQuizCount === 'function') ? U.cumulativeQuizCount('quantity') : dqP.answered;
    const quizTotal = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal('quantity') : 0;
    return moduleShell('quantity', '数量关系', '🔢', [
      '掌握今日题型解题要点',
      '完成今日数量关系真题10题',
    ], '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📐</span>今日题型：' + t.icon + ' ' + t.type + '</div>' +
        (t.freq ? '<div class="li-meta" style="margin-top:6px"><span class="freq-tag">📊 ' + U.esc(t.freq) + '</span> ' + (t.years ? '<span style="color:#666">' + U.esc(t.years) + '</span>' : '') + '</div>' : '') +
        '<div class="card-sub" style="margin:10px 0 6px">核心公式：</div>' +
        '<div class="formula-box">' + U.esc(t.formula).replace(/\n/g, '<br>') + '</div>' +
        (t.key ? '<div class="card-sub" style="margin:10px 0 6px">解题要点：</div>' +
          '<div class="analysis" style="display:block;margin-top:0">💡 ' + U.esc(t.key) + '</div>' : '') +
        (t.pitfall ? '<div class="card-sub" style="margin:10px 0 6px">易错点：</div>' +
          '<div class="analysis warn" style="display:block;margin-top:0">⚠️ ' + U.esc(t.pitfall) + '</div>' : '') +
        '<div class="card-sub" style="margin:10px 0 6px">经典例题：</div>' +
        '<div class="analysis" style="display:block;margin-top:0">' + U.esc(t.example) + '</div>' +
        '<div class="analysis" style="display:block;margin-top:8px"><b>解答：</b>' + U.esc(t.solution) + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>每日真题训练<span class="card-sub">（考点精练 · 每日10题，前5题契合今日题型 · 累计已做 ' + cumCount + ' 题 / 共 ' + quizTotal + ' 题）</span></div>' +
        '<div class="section-tip">第1—5题为今日题型"' + U.esc(t.type) + '"的考点精练，第6—10题为综合训练。单题作答，答对自动下一题，答错显示解析并加入错题本。</div>' +
        '<div data-dailyquiz data-module="quantity" data-min="2"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="quantity"></div>' +
      '</div>');
  }
  function bindQuantity() {
    bindModulePlanEvents('quantity');
    // 每日真题训练共10题：前5题为今日题型，后5题为其他题型综合训练
    const t = pick(C.QUANTITY);
    const todayPool = (C.QUANTITY_QUIZ_BY_TYPE && C.QUANTITY_QUIZ_BY_TYPE[t.type]) || [];
    // 其他题型题库：聚合数组中排除今日题型
    const allPool = C.QUANTITY_QUIZ || [];
    const otherPool = allPool.filter(function (q) {
      return q.source && q.source.indexOf('·' + t.type) < 0;
    });
    if (todayPool.length && otherPool.length) {
      const sections = [
        { key: 'today', count: 5, label: '今日题型·' + t.type },
        { key: 'other', count: 5, label: '综合训练' }
      ];
      bindDailyQuiz('quantity', { today: todayPool, other: otherPool }, { label: '数量关系', sections: sections });
    } else {
      // 兜底：题库分组缺失时退回原题源
      bindDailyQuiz('quantity', allPool, { label: '数量关系' });
    }
  }

  /* ---------- 8. 资料分析 ---------- */
  function viewData() {
    // 核心公式速记：每日滚动 10 条，直接展示；每条可点开查看关联变形与要点
    const fsAll = (C.DATA_FORMULAS && C.DATA_FORMULAS.length) ? C.DATA_FORMULAS : [];
    const fsDay = 10;
    const fsOfDay = fsAll.length ? pickRange(fsAll, (dayIdx * fsDay) % fsAll.length, fsDay) : [];
    const fsTotal = fsOfDay.length;
    const fsHTML = fsOfDay.map((f, i) => formulaItemHTML(i, f)).join('');
    return moduleShell('data', '资料分析', '📊', [
      '复习资料分析核心公式',
    ], '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📊</span>核心公式速记<span class="card-sub">（今日 ' + fsTotal + ' 条 · 点击展开变形与要点）</span></div>' +
        '<div class="section-tip">资料分析高频公式，每日滚动 10 条，点开查看公式的关联变形与解题要点。</div>' +
        '<div data-f-list>' + (fsHTML || '<div class="e-txt" style="color:var(--ink-3);font-size:12px">公式库整理中</div>') + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="data"></div>' +
      '</div>');
  }
  // 单条公式渲染：标题 + 公式，点开显示关联变形与要点
  function formulaItemHTML(idx, f) {
    const variants = (f.variants && f.variants.length) ? f.variants : [];
    const points = (f.points && f.points.length) ? f.points : [];
    return '<details class="custom" style="margin-bottom:8px">' +
        '<summary>📐 ' + U.esc(f.name) + '<span class="li-meta" style="margin-left:6px">💡 ' + U.esc(f.note) + '</span></summary>' +
        '<div class="d-body">' +
          '<div class="formula-box" style="margin:0 0 8px">' + U.esc(f.formula).replace(/\n/g, '<br>') + '</div>' +
          (variants.length
            ? '<div style="margin:0 0 6px"><b>🔀 关联变形：</b></div>' +
              '<ul style="margin:0 0 8px;padding-left:18px">' +
              variants.map(v => '<li style="margin-bottom:2px">' + U.esc(v) + '</li>').join('') +
              '</ul>'
            : '') +
          (points.length
            ? '<div style="margin:0 0 4px"><b>🎯 要点：</b></div>' +
              '<ul style="margin:0;padding-left:18px">' +
              points.map(p => '<li style="margin-bottom:2px">' + U.esc(p) + '</li>').join('') +
              '</ul>'
            : '') +
        '</div>' +
      '</details>';
  }
  function bindData() {
    bindModulePlanEvents('data');
  }

  /* ---------- 9. 每日统计 ---------- */
  function viewStats() {
    // 进入统计页时,先扫一遍所有模块的 dq records,把"已答但没累加到 stats"的差额一次性补录
    // （解决用户答了 N 题就切走/关闭页面,导致 stats 漏记的问题）
    try { U.flushAllDqStats(); } catch (e) {}
    const today = U.todayStr();
    const records = S.statsOfDate(today);
    const all = S.statsAll();

    // 今日汇总
    let todayCount = 0, todayMin = 0, todayCorrect = 0, todayTotal = 0;
    records.forEach(r => {
      todayCount += r.count; todayMin += r.durationMin; todayCorrect += r.correct; todayTotal += r.total;
    });
    const todayAcc = todayTotal ? Math.round(todayCorrect / todayTotal * 100) : 0;

    // 各模块统计（全部历史）
    const mods = {};
    const modMeta = { politics:['政治理论','🏛️'], common:['常识判断','🌏'], language:['言语理解','💬'], logic:['判断推理','🧩'], quantity:['数量关系','🔢'], data:['资料分析','📊'], essay:['申论小题','✏️'], composition:['大作文','🖋️'] };
    // 各模块题库总题量(来自 Content 静态题库,作为"分母"用于覆盖率展示)
    // 注意：数据里同一模块可能有顶层 *_QUIZ(精选/混合) 与 *_QUIZ_BY_TYPE(全量分组) 两套并存,
    //       取"全量"才能反映真实题库规模。
    function _modTotal(key) {
      try {
        if (key === 'politics')    return (C.POLITICS_QUIZ    && C.POLITICS_QUIZ.length)    || 0;
        if (key === 'common')      return (C.COMMON_QUIZ      && C.COMMON_QUIZ.length)      || 0;
        if (key === 'language')    return (C.LANGUAGE_QUIZ    && C.LANGUAGE_QUIZ.length)    || 0;
        // 判断推理：顶层 LOGIC_QUIZ(82)只是 LOGIC_QUIZ_BY_TYPE.logic 的子集,
        //          实际题库规模 = 各 BY_TYPE 组合并去重 = 246(图形/定义/类比/逻辑)
        if (key === 'logic') {
          const bt = C.LOGIC_QUIZ_BY_TYPE;
          if (bt && typeof bt === 'object') {
            const seen = {};
            Object.keys(bt).forEach(function (k) {
              (bt[k] || []).forEach(function (q) {
                const key2 = (q && q.q) ? String(q.q).slice(0, 80) : JSON.stringify(q).slice(0, 80);
                if (!seen[key2]) seen[key2] = 1;
              });
            });
            const n = Object.keys(seen).length;
            if (n > 0) return n;
          }
          return (C.LOGIC_QUIZ && C.LOGIC_QUIZ.length) || 0; // 兜底:顶层长度
        }
        // 数量关系:QUANTITY_QUIZ 顶层已包含"BY_TYPE 全量 + 58 道并入新增",直接用顶层 length(201)
        if (key === 'quantity')    return (C.QUANTITY_QUIZ    && C.QUANTITY_QUIZ.length)    || 0;
        if (key === 'essay')       return (C.SHENLUN_SMALL    && C.SHENLUN_SMALL.length)    || 0;
        if (key === 'composition') return (C.COMPOSITION_SUBJECTS && C.COMPOSITION_SUBJECTS.length) || 0;
        return 0; // data(资料分析)无独立题库,暂记 0
      } catch (e) { return 0; }
    }
    all.forEach(r => { (mods[r.module] = mods[r.module] || []).push(r); });

    let modRows = '';
    let modData = [];
    for (const key in mods) {
      const rs = mods[key];
      let cnt = 0, min = 0, cor = 0, tot = 0;
      rs.forEach(r => { cnt += r.count; min += r.durationMin; cor += r.correct; tot += r.total; });
      const acc = tot ? Math.round(cor / tot * 100) : 0;
      const meta = modMeta[key] || [key, '📌'];
      // 题库覆盖 = 累计作答题数 / 题库总量 → 比例 + 颜色（封顶 100%）
      const total = _modTotal(key);
      let coverHTML = '';
      if (total > 0) {
        // 题库覆盖 = 累计已做题数 / 题库总量。
        // 注：历史刷题只保存了"每日做题数"，无题级指纹，无法还原去重覆盖率，
        //     故采用"累计作答数"口径（封顶题库总量），与上方"累计 X 题"保持一致。
        const done = Math.min(cnt, total);
        const pct = Math.round(done / total * 100);
        let c = 'var(--ink-2)';
        if (pct >= 70) c = '#3a9d5b';
        else if (pct >= 30) c = '#f0a84c';
        else if (pct > 0) c = '#d9534f';
        coverHTML = ' · 题库覆盖 <b>' + done + '/' + total + '</b> · <b style="color:' + c + '">' + pct + '%</b>';
      }
      modData.push({ name: meta[0], count: cnt, acc });
      modRows +=
        '<div class="list-item">' +
          '<span class="li-icon">' + meta[1] + '</span>' +
          '<div class="li-body">' +
            '<div class="li-title">' + meta[0] + '</div>' +
            '<div class="li-meta">累计 ' + cnt + ' 题 · ' + min + ' 分钟 · 正确率 ' + acc + '%' + coverHTML + '</div>' +
          '</div>' +
        '</div>';
    }

    // 为图表准备 JSON 数据
    const chartData = JSON.stringify(modData);

    // ===== ③ 各模块做题量 vs 正确率（双轴图）数据 =====
    const dualData = JSON.stringify(modData.filter(d => d.count > 0));

    // ===== ④ 每日错题趋势（近14天） =====
    const misItems = (S.data && S.data.mistakes && S.data.mistakes.items) || [];
    const misByDate = {};
    misItems.forEach(m => { if (m.date) misByDate[m.date] = (misByDate[m.date] || 0) + 1; });
    const last14 = [];
    const _now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate() - i);
      const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
      const ds = y + '-' + mo + '-' + da;
      last14.push({ label: mo + '/' + da, value: misByDate[ds] || 0, full: ds });
    }
    const misTrendData = JSON.stringify(last14);
    const misToday = misByDate[today] || 0;

    // ===== ④ 模块正确率排行榜（从低到高，只看有做题记录的） =====
    const accRank = modData.filter(d => d.count > 0).slice().sort((a, b) => (a.acc || 0) - (b.acc || 0));
    const weakest = accRank.length ? accRank[0] : null;
    const strongest = accRank.length ? accRank[accRank.length - 1] : null;
    let accRankHTML = '';
    if (accRank.length) {
      accRankHTML = '<div class="rank-list">' + accRank.map((m, idx) => {
        const isWeak = idx === 0; const isStrong = idx === accRank.length - 1;
        return '<div class="rank-item">' +
          '<span class="rank-num" style="background:' + (isWeak ? '#ffe4e9;color:#d9534f' : isStrong ? '#e0f4e0;color:#3a9d5b' : 'var(--bg-soft);color:var(--ink-2)') + '">' + (idx + 1) + '</span>' +
          '<span class="rank-name">' + U.esc(m.name) + '</span>' +
          '<div class="rank-bar" style="flex:1;margin:0 8px"><div class="rank-bar-in" style="width:' + Math.max(m.acc, 3) + '%;background:' + (isWeak ? 'linear-gradient(90deg,#f0a0a0,#d9534f)' : isStrong ? 'linear-gradient(90deg,#7cc37c,#3a9d5b)' : 'linear-gradient(90deg,#a8d8ea,#7cc3e0)') + '"></div></div>' +
          '<span class="rank-acc" style="color:' + (isWeak ? '#d9534f' : isStrong ? '#3a9d5b' : 'var(--ink-2)') + '">' + m.acc + '%</span>' +
          '<span class="rank-count">' + m.count + '题</span>' +
        '</div>';
      }).join('') + '</div>';
      // 一句话定位短板
      accRankHTML += '<div class="section-tip" style="margin-top:10px">🎯 最薄弱：<b style="color:#d9534f">' + U.esc(weakest.name) + '</b>（' + weakest.acc + '%）· 最擅长：<b style="color:#3a9d5b">' + U.esc(strongest.name) + '</b>（' + strongest.acc + '%）</div>';
    } else {
      accRankHTML = '<div class="empty"><div class="e-txt">暂无做题数据</div></div>';
    }

    // ===== ⑤ 平均每题耗时 + 一句话总结 =====
    let totalCount = 0, totalMin = 0, totalCor = 0, totalTot = 0;
    all.forEach(r => { totalCount += r.count; totalMin += r.durationMin; totalCor += r.correct; totalTot += r.total; });
    const overallAcc = totalTot ? Math.round(totalCor / totalTot * 100) : 0;
    const avgSecPerQ = totalCount ? Math.round(totalMin * 60 / totalCount) : 0;
    const avgMinPerQ = totalCount ? (totalMin / totalCount) : 0;
    const effDesc = totalCount
      ? (avgSecPerQ < 60 ? '每题约 <b style="color:#3a9d5b">' + avgSecPerQ + ' 秒</b>，速度较理想' :
         avgSecPerQ < 120 ? '每题约 <b style="color:#f0a84c">' + Math.round(avgMinPerQ * 10) / 10 + ' 分钟</b>，速度适中' :
         '每题约 <b style="color:#d9534f">' + Math.round(avgMinPerQ * 10) / 10 + ' 分钟</b>，偏慢，建议加强限时训练')
      : '暂无做题数据';

    // 一句话总结
    let summary = '坚持就是胜利，继续保持学习节奏！';
    if (totalCount) {
      const parts = [];
      parts.push('累计做题 <b>' + totalCount + '</b> 题 · 总用时 <b>' + totalMin + '</b> 分钟');
      parts.push('整体正确率 <b>' + overallAcc + '%</b>');
      if (weakest) parts.push('重点突破 <b style="color:#d9534f">' + U.esc(weakest.name) + '</b>');
      if (misToday > 0) parts.push('今日新增错题 <b>' + misToday + '</b> 道');
      summary = '📌 ' + parts.join('，') + '。';
      // 今日 vs 昨日正确率对比
      const yestD = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate() - 1);
      const yds = yestD.getFullYear() + '-' + String(yestD.getMonth() + 1).padStart(2, '0') + '-' + String(yestD.getDate()).padStart(2, '0');
      const yRecs = S.statsOfDate(yds);
      let yCor = 0, yTot = 0;
      yRecs.forEach(r => { yCor += r.correct; yTot += r.total; });
      const yAcc = yTot ? Math.round(yCor / yTot * 100) : null;
      if (yAcc !== null && todayTotal > 0) {
        const diff = todayAcc - yAcc;
        summary += (diff > 0 ? '较昨日正确率<span style="color:#3a9d5b">↑' + diff + '%</span>，状态回升！' : diff < 0 ? '较昨日正确率<span style="color:#d9534f">↓' + Math.abs(diff) + '%</span>，注意巩固' : '正确率与昨日持平');
      }
    }

    return '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📈</span>今日学习总览</div>' +
        '<div class="grid-3">' +
          '<div class="stat-box"><div class="sb-num">' + todayCount + '</div><div class="sb-label">今日做题</div></div>' +
          '<div class="stat-box"><div class="sb-num green">' + todayMin + '</div><div class="sb-label">分钟时长</div></div>' +
          '<div class="stat-box"><div class="sb-num orange">' + todayAcc + '%</div><div class="sb-label">今日正确率</div></div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🗂️</span>分模块明细</div>' +
        (modRows || '<div class="empty"><div class="e-txt">还没有做题记录，去模块里练习吧</div></div>') +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📝</span>今日做题明细</div>' +
        (records.length ? (() => {
          // 按 module 聚合：避免"每答一题 1 条"导致明细区出现 8 行 "1 题 · ..." 啰嗦
          const agg = {};
          records.forEach(r => {
            if (!r || !r.module) return;
            if (!agg[r.module]) agg[r.module] = { module: r.module, count: 0, durationMin: 0, correct: 0, total: 0 };
            const a = agg[r.module];
            a.count += (parseInt(r.count, 10) || 0);
            a.durationMin += (parseInt(r.durationMin, 10) || 0);
            a.correct += (parseInt(r.correct, 10) || 0);
            a.total += (parseInt(r.total, 10) || 0);
          });
          const list = Object.values(agg);
          return list.map(a => {
            const meta = modMeta[a.module] || [a.module, '📌'];
            // 今日正确率 = 对题数 / 总题数
            const accuracy = a.total > 0 ? Math.round((a.correct * 100) / a.total) : 0;
            // 平均用时 = 总分钟 / 总题数（秒/题，向下取整）
            const avgSec = a.total > 0 ? Math.round((a.durationMin * 60) / a.total) : 0;
            const avgTip = avgSec > 0 ? (avgSec >= 60
              ? Math.floor(avgSec / 60) + '分' + (avgSec % 60) + '秒/题'
              : avgSec + '秒/题') : '—';
            return '<div class="list-item"><span class="li-icon">' + meta[1] + '</span>' +
              '<div class="li-body"><div class="li-title">' + meta[0] + '</div>' +
              '<div class="li-meta">' + a.count + ' 题 · ' + a.durationMin + ' 分钟 · 对 ' + a.correct + '/' + a.total +
                ' · <span class="li-acc" style="color:' + (accuracy >= 70 ? '#3fae6c' : (accuracy >= 50 ? '#e0a020' : '#d9534f')) + '">正确率 ' + accuracy + '%</span>' +
                ' · 均速 ' + avgTip +
              '</div></div></div>';
          }).join('');
        })() : '<div class="empty"><div class="e-icon">🍃</div><div class="e-txt">今天还没有做题记录</div></div>') +
      '</div>' +

      // 成语积累统计：置于「今日做题明细」卡下方
      idiomStatCard() +
      koujueStatCard() +
      kaodianStatCard() +

      // ③ 各模块做题量 vs 正确率（双轴图）
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🎯</span>做题量 vs 正确率（短板定位）</div>' +
        '<div class="chart-box" data-chart="dual" data-chartdata="' + U.esc(dualData) + '"></div>' +
        '<div class="section-tip">柱 = 各模块累计做题量，橙线 = 正确率。柱矮且线低的模块是短板，建议优先重点突破。</div>' +
      '</div>' +

      // ④ 模块正确率排行榜
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🏆</span>模块正确率排行（薄弱在前）</div>' +
        accRankHTML +
      '</div>' +

      // ⑤ 效率与一句话总结
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">⏱️</span>答题效率</div>' +
        '<div class="grid-3">' +
          '<div class="stat-box"><div class="sb-num">' + totalCount + '</div><div class="sb-label">累计做题</div></div>' +
          '<div class="stat-box"><div class="sb-num green">' + totalMin + '</div><div class="sb-label">累计分钟</div></div>' +
          '<div class="stat-box"><div class="sb-num orange">' + (avgSecPerQ ? avgSecPerQ + 's' : '—') + '</div><div class="sb-label">平均每题</div></div>' +
        '</div>' +
        '<div class="section-tip" style="margin-top:10px">' + effDesc + '</div>' +
      '</div>' +

      '<div class="card summary-card">' +
        '<div class="card-title"><span class="emoji">💬</span>学习总结</div>' +
        '<div class="summary-text">' + summary + '</div>' +
      '</div>';
  }
  function bindStats() {
    // 绘制图表
    document.querySelectorAll('[data-chart]').forEach(el => {
      const type = el.getAttribute('data-chart');
      let raw;
      try { raw = JSON.parse(el.getAttribute('data-chartdata')); } catch(e) { raw = []; }
      renderChart(el, type, raw);
    });
  }

  function renderChart(el, type, data) {
    const w = el.clientWidth || 320;
    const h = 200;
    el.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '200');

    if (type === 'bar') {
      if (!data.length) { el.innerHTML = '<div class="empty"><div class="e-txt">暂无数据</div></div>'; return; }
      const colors = ['#a8d8ea','#ffb6c1','#b5e3b5','#ffd28a','#c3b5ff','#a5e0d0','#f0a84c','#ff9a9a'];
      const padB = 34, padT = 20, padL = 34, padR = 10;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxV = Math.max(...data.map(d => d.count), 1);
      const bw = plotW / data.length * 0.6;
      const step = plotW / data.length;

      data.forEach((d, i) => {
        const barH = (d.count / maxV) * plotH;
        const x = padL + i * step + (step - bw) / 2;
        const y = padT + plotH - barH;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', bw); rect.setAttribute('height', barH);
        rect.setAttribute('rx', 4);
        rect.setAttribute('fill', colors[i % colors.length]);
        svg.appendChild(rect);
        // 数值
        const t1 = document.createElementNS(svgNS, 'text');
        t1.setAttribute('x', x + bw / 2); t1.setAttribute('y', y - 6);
        t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', '11');
        t1.setAttribute('fill', '#6b7f8f'); t1.textContent = d.count;
        svg.appendChild(t1);
        // 标签
        const t2 = document.createElementNS(svgNS, 'text');
        t2.setAttribute('x', x + bw / 2); t2.setAttribute('y', h - 12);
        t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', '10');
        t2.setAttribute('fill', '#9fb2c0');
        t2.textContent = d.name.length > 3 ? d.name.slice(0, 3) + '…' : d.name;
        svg.appendChild(t2);
      });
      // 图例
      const legend = document.createElementNS(svgNS, 'text');
      legend.setAttribute('x', padL); legend.setAttribute('y', 12); legend.setAttribute('font-size','11'); legend.setAttribute('fill','#6b7f8f');
      legend.textContent = '各模块累计做题量';
      svg.appendChild(legend);

    } else if (type === 'pie') {
      const filtered = data.filter(d => d.count > 0);
      if (!filtered.length) { el.innerHTML = '<div class="empty"><div class="e-txt">暂无数据</div></div>'; return; }
      const colors = ['#a8d8ea','#ffb6c1','#b5e3b5','#ffd28a','#c3b5ff','#a5e0d0','#f0a84c','#ff9a9a'];
      const cx = w * 0.34, cy = h / 2, R = Math.min(h / 2 - 20, w * 0.2);
      let total = filtered.reduce((s, d) => s + d.count, 0);
      let start = -Math.PI / 2;

      filtered.forEach((d, i) => {
        const ang = (d.count / total) * 2 * Math.PI;
        const x0 = cx + R * Math.cos(start), y0 = cy + R * Math.sin(start);
        const x1 = cx + R * Math.cos(start + ang), y1 = cy + R * Math.sin(start + ang);
        const largeArc = ang > Math.PI ? 1 : 0;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', 'M ' + cx + ' ' + cy + ' L ' + x0 + ' ' + y0 + ' A ' + R + ' ' + R + ' 0 ' + largeArc + ' 1 ' + x1 + ' ' + y1 + ' Z');
        path.setAttribute('fill', colors[i % colors.length]);
        path.setAttribute('stroke', '#fff'); path.setAttribute('stroke-width', '2');
        svg.appendChild(path);
        start += ang;
      });
      // 图例（右侧）
      const lx = w * 0.58;
      filtered.forEach((d, i) => {
        const ly = 30 + i * 26;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', lx); rect.setAttribute('y', ly - 10);
        rect.setAttribute('width', 12); rect.setAttribute('height', 12); rect.setAttribute('rx', 3);
        rect.setAttribute('fill', colors[i % colors.length]);
        svg.appendChild(rect);
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('x', lx + 18); t.setAttribute('y', ly);
        t.setAttribute('font-size', '11'); t.setAttribute('fill', '#6b7f8f');
        t.textContent = d.name + ' (' + Math.round(d.count / total * 100) + '%)';
        svg.appendChild(t);
      });
      // 中心文字
      const ct = document.createElementNS(svgNS, 'text');
      ct.setAttribute('x', cx); ct.setAttribute('y', cy + 4);
      ct.setAttribute('text-anchor','middle'); ct.setAttribute('font-size','12'); ct.setAttribute('font-weight','bold'); ct.setAttribute('fill','#7cc3e0');
      ct.textContent = total + '题';
      svg.appendChild(ct);

    } else if (type === 'dual') {
      // 双轴图：柱 = 做题量(count, 左轴)，折线 = 正确率%(acc, 右轴 0-100)
      if (!data.length) { el.innerHTML = '<div class="empty"><div class="e-txt">暂无数据</div></div>'; return; }
      const colors = ['#a8d8ea','#ffb6c1','#b5e3b5','#ffd28a','#c3b5ff','#a5e0d0','#f0a84c','#ff9a9a'];
      const padB = 34, padT = 30, padL = 34, padR = 40;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxV = Math.max(...data.map(d => d.count), 1);
      const bw = plotW / data.length * 0.5;
      const step = plotW / data.length;
      const barColor = '#a8d8ea';

      // 左轴刻度（做题量）
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const yv = Math.round(maxV * i / yTicks);
        const y = padT + plotH - (i / yTicks) * plotH;
        const gline = document.createElementNS(svgNS, 'line');
        gline.setAttribute('x1', padL); gline.setAttribute('y1', y);
        gline.setAttribute('x2', w - padR); gline.setAttribute('y2', y);
        gline.setAttribute('stroke', '#eef3f6'); gline.setAttribute('stroke-width', '1');
        svg.appendChild(gline);
        const gtxt = document.createElementNS(svgNS, 'text');
        gtxt.setAttribute('x', padL - 6); gtxt.setAttribute('y', y + 4);
        gtxt.setAttribute('text-anchor', 'end'); gtxt.setAttribute('font-size', '10'); gtxt.setAttribute('fill', '#9fb2c0');
        gtxt.textContent = yv;
        svg.appendChild(gtxt);
      }

      // 柱（做题量）
      data.forEach((d, i) => {
        const barH = (d.count / maxV) * plotH;
        const x = padL + i * step + (step - bw) / 2;
        const y = padT + plotH - barH;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', bw); rect.setAttribute('height', barH);
        rect.setAttribute('rx', 3); rect.setAttribute('fill', colors[i % colors.length]); rect.setAttribute('opacity', '0.75');
        svg.appendChild(rect);
        // 做题量数值
        const t1 = document.createElementNS(svgNS, 'text');
        t1.setAttribute('x', x + bw / 2); t1.setAttribute('y', y - 4);
        t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', '10'); t1.setAttribute('fill', '#6b7f8f');
        t1.textContent = d.count;
        svg.appendChild(t1);
        // 模块标签
        const t2 = document.createElementNS(svgNS, 'text');
        t2.setAttribute('x', padL + i * step + step / 2); t2.setAttribute('y', h - 12);
        t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', '9'); t2.setAttribute('fill', '#9fb2c0');
        t2.textContent = d.name.length > 3 ? d.name.slice(0, 3) + '…' : d.name;
        svg.appendChild(t2);
      });

      // 折线（正确率%），右轴 0-100
      const lineColor = '#f0a84c';
      const points = data.map((d, i) => {
        const x = padL + i * step + step / 2;
        const y = padT + plotH - (Math.min(Math.max(d.acc, 0), 100) / 100) * plotH;
        return { x, y };
      });
      // 折线路径
      const poly = document.createElementNS(svgNS, 'polyline');
      poly.setAttribute('points', points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
      poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', lineColor); poly.setAttribute('stroke-width', '2.5'); poly.setAttribute('stroke-linejoin', 'round'); poly.setAttribute('stroke-linecap', 'round');
      svg.appendChild(poly);
      // 数据点 + 正确率数值
      points.forEach((p, i) => {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', '3.5'); dot.setAttribute('fill', '#fff'); dot.setAttribute('stroke', lineColor); dot.setAttribute('stroke-width', '2');
        svg.appendChild(dot);
        const vt = document.createElementNS(svgNS, 'text');
        vt.setAttribute('x', p.x); vt.setAttribute('y', p.y - 8);
        vt.setAttribute('text-anchor', 'middle'); vt.setAttribute('font-size', '9'); vt.setAttribute('fill', lineColor);
        vt.textContent = data[i].acc + '%';
        svg.appendChild(vt);
      });
      // 右轴刻度（0-100%）
      for (let i = 0; i <= yTicks; i++) {
        const v = Math.round(100 * i / yTicks);
        const y = padT + plotH - (i / yTicks) * plotH;
        const gtxt = document.createElementNS(svgNS, 'text');
        gtxt.setAttribute('x', w - padR + 6); gtxt.setAttribute('y', y + 4);
        gtxt.setAttribute('font-size', '10'); gtxt.setAttribute('fill', lineColor);
        gtxt.textContent = v;
        svg.appendChild(gtxt);
      }
      // 图例
      const lg1 = document.createElementNS(svgNS, 'text');
      lg1.setAttribute('x', padL); lg1.setAttribute('y', 14); lg1.setAttribute('font-size', '10'); lg1.setAttribute('fill', '#6b7f8f');
      lg1.textContent = '▍各模块做题量';
      svg.appendChild(lg1);
      const lg2 = document.createElementNS(svgNS, 'text');
      lg2.setAttribute('x', padL + 95); lg2.setAttribute('y', 14); lg2.setAttribute('font-size', '10'); lg2.setAttribute('fill', lineColor);
      lg2.textContent = '─ 正确率%';
      svg.appendChild(lg2);

    } else if (type === 'line') {
      // 通用折线图：data = [{ label, value }]
      if (!data.length) { el.innerHTML = '<div class="empty"><div class="e-txt">暂无数据</div></div>'; return; }
      const color = '#a8d8ea';
      const padB = 26, padT = 20, padL = 30, padR = 14;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxV = Math.max(...data.map(d => d.value), 1);
      const step = plotW / Math.max(data.length - 1, 1);

      // 横向网格 + 左轴
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const yv = Math.round(maxV * i / yTicks);
        const y = padT + plotH - (i / yTicks) * plotH;
        const gline = document.createElementNS(svgNS, 'line');
        gline.setAttribute('x1', padL); gline.setAttribute('y1', y);
        gline.setAttribute('x2', w - padR); gline.setAttribute('y2', y);
        gline.setAttribute('stroke', '#eef3f6'); gline.setAttribute('stroke-width', '1');
        svg.appendChild(gline);
        const gtxt = document.createElementNS(svgNS, 'text');
        gtxt.setAttribute('x', padL - 6); gtxt.setAttribute('y', y + 4);
        gtxt.setAttribute('text-anchor', 'end'); gtxt.setAttribute('font-size', '9'); gtxt.setAttribute('fill', '#9fb2c0');
        gtxt.textContent = yv;
        svg.appendChild(gtxt);
      }
      const points = data.map((d, i) => {
        const x = padL + i * step;
        const y = padT + plotH - (d.value / maxV) * plotH;
        return { x, y };
      });
      const poly = document.createElementNS(svgNS, 'polyline');
      poly.setAttribute('points', points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
      poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', color); poly.setAttribute('stroke-width', '2.5'); poly.setAttribute('stroke-linejoin', 'round'); poly.setAttribute('stroke-linecap', 'round');
      svg.appendChild(poly);
      // 填充渐变
      const area = document.createElementNS(svgNS, 'polygon');
      const areaPts = points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
      area.setAttribute('points', padL + ',' + (padT + plotH) + ' ' + areaPts + ' ' + (padL + (data.length - 1) * step) + ',' + (padT + plotH));
      area.setAttribute('fill', color); area.setAttribute('opacity', '0.12');
      svg.appendChild(area);
      // 点 + 数值
      points.forEach((p, i) => {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', '3'); dot.setAttribute('fill', '#fff'); dot.setAttribute('stroke', color); dot.setAttribute('stroke-width', '2');
        svg.appendChild(dot);
        const vt = document.createElementNS(svgNS, 'text');
        vt.setAttribute('x', p.x); vt.setAttribute('y', p.y - 8);
        vt.setAttribute('text-anchor', 'middle'); vt.setAttribute('font-size', '9'); vt.setAttribute('fill', '#6b7f8f');
        vt.textContent = data[i].value;
        svg.appendChild(vt);
      });
      // X 轴标签（日期缩写，间隔显示避免拥挤）
      const labelStep = Math.max(1, Math.ceil(data.length / 6));
      data.forEach((d, i) => {
        if (i % labelStep !== 0 && i !== data.length - 1) return;
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('x', padL + i * step); t.setAttribute('y', h - 8);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '9'); t.setAttribute('fill', '#9fb2c0');
        t.textContent = d.label;
        svg.appendChild(t);
      });
    }
    el.appendChild(svg);
  }

  /* ---------- 通用：模块底部"今日计划"渲染（与每日计划模块"今日计划"完全同步） ----------
     展示的是每日计划模块"今日计划"卡片中的全部目标（含各分类标签），
     勾选 / 修改 / 删除走全局 data-plan / data-editplan / data-delplan 委托，
     与每日计划模块数据实时联动；不再重复展示本模块的"今日待办"清单。 */
  function bindModulePlanEvents(cat) {
    const listEl = document.querySelector('[data-modplan="' + cat + '"]');
    if (!listEl) return;
    // 当前模块对应的计划分类（politics → political，其余同名）
    const myLabel = (function () {
      try { return U.catInfo(cat).label; } catch (e) { return cat; }
    })();
    let items = [];
    try {
      if (S && typeof S.getPlanItems === 'function') {
        const all = S.getPlanItems(U.todayStr());
        if (Array.isArray(all)) items = all;
      }
    } catch (e) { items = []; }
    // 只展示属于本模块分类的目标（与每日计划"今日计划"同步，但仅显示该分类）
    const mine = items.filter(it => {
      let lbl;
      try { lbl = U.catInfo(it && it.category).label; } catch (e) { lbl = it && it.category; }
      return lbl === myLabel;
    });
    // 进度条（仅统计本分类目标）
    const doneCount = mine.filter(i => i.done).length;
    listEl.innerHTML =
      U.progressHTML(doneCount, mine.length) +
      '<div class="todo-list" style="margin-top:10px">' +
      (mine.length ? mine.map(it => {
        const ci = U.catInfo(it.category);
        return '<div class="todo-item' + (it.done ? ' done' : '') + '" data-plan-row="' + it.id + '">' +
          '<div class="todo-check' + (it.done ? ' checked' : '') + '" data-plan="' + it.id + '">' + (it.done ? '✓' : '') + '</div>' +
          '<span class="tag ' + ci.cls + ' todo-cat-tag" style="flex-shrink:0">' + ci.label + '</span>' +
          '<div class="todo-txt' + (it.done ? ' checked' : '') + '">' + U.esc(it.title) + '</div>' +
          '<button class="btn btn-sm btn-ghost" data-editplan="' + it.id + '" title="修改" style="padding:4px 7px;font-size:12px;flex-shrink:0">✎</button>' +
          '<button class="btn btn-sm btn-danger" data-delplan="' + it.id + '" title="删除" style="padding:4px 8px;font-size:11px;flex-shrink:0">✕</button>' +
        '</div>';
      }).join('') : '<div class="empty" style="padding:14px"><div class="e-icon">🎯</div><div class="e-txt">本分类暂无今日目标<br>请到「每日计划」页点击「＋ 添加目标」为该模块规划</div></div>') +
      '</div>';
  }

  /* ---------- 通用：试题作答区绑定 ---------- */
  function bindQuizArea(module, pool, count) {
    const area = document.querySelector('[data-quiz-area][data-module="' + module + '"]');
    if (!area) return;
    const min = parseInt(area.getAttribute('data-min') || '3', 10);
    const quizList = pickRange(pool, min, count);
    area.innerHTML = '';
    let answeredCount = 0, correctCount = 0, totalCount = quizList.length;

    quizList.forEach((quiz, idx) => {
      const box = U.quizBlock(quiz, (correct, total) => {
        answeredCount++;
        if (correct) correctCount++;
        if (answeredCount === totalCount) {
          U.logStudy(module, totalCount, min, correctCount, totalCount);
          U.toast('📊 已计入今日统计');
        }
      });
      area.appendChild(box);
    });
  }

  /* ================================================================
     行测模块 · 每日真题训练（单题模式）
     每日 10 题，卡片每次显示 1 题：
     - 答对：绿色高亮 + 自动跳下一题
     - 答错：显示解析 + 自动加入错题本
     - 底部翻页按钮可翻看今天练习过的题目
     ================================================================ */
  function bindDailyQuiz(module, pool, opts) {
    const opts_ = opts || {};
    const area = document.querySelector('[data-dailyquiz][data-module="' + module + '"]');
    if (!area) return;
    const catLabel = opts_.label || module;
    const min = parseInt(area.getAttribute('data-min') || '3', 10);
    // 题型标签（用于按题型分组的题库）
    const SEC_LABELS = { figure: '图形推理', define: '定义判断', analogy: '类比推理', logic: '逻辑判断' };

    // 组装今日题目：支持两种模式
    // 1) 分组配比：pool 为对象 + opts.sections（如判断推理：图形3+定义2+类比2+逻辑3）
    // 2) 普通题库：pool 为数组，直接每日滚动取前 TOTAL 题
    // 已训练题过滤：答过的题不再出现；全部训练完则暂停（见 renderPaused）
    let trainedArr = (typeof U.dqTrainedLoad === 'function') ? U.dqTrainedLoad(module) : [];
    let trainedSet = {};
    trainedArr.forEach(function (f) { if (f) trainedSet[f] = 1; });
    const isTrained = function (q) { return !q || trainedSet[U.dqFp(q.q)]; };

    // 汇总本模块全部题目（数组题库 / 分组题库通用），供"标记完成"与旧数据修复使用
    function allQuestions() {
      if (Array.isArray(pool)) return pool;
      const arr = [];
      const secs = (opts_ && Array.isArray(opts_.sections)) ? opts_.sections : [];
      if (secs.length) {
        secs.forEach(function (s) { (pool[s.key] || []).forEach(function (q) { arr.push(q); }); });
      } else {
        Object.keys(pool || {}).forEach(function (k) { (pool[k] || []).forEach(function (q) { arr.push(q); }); });
      }
      return arr;
    }
    // 历史累计已答数（来自旧版 dq_logged 计数标记）
    function historicalSum() {
      let s = 0;
      const p = Store.PREFIX + 'dq_logged_' + module + '_';
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(p) === 0) s += (parseInt(localStorage.getItem(k) || '0', 10) || 0);
      }
      return s;
    }
    // 旧数据自修复：旧版仅记录"每日已答数"(dq_logged)，从未记录题级指纹(dq_counted)；
    // 累计已答数 >= 题库总量 ⇒ 用户已刷完整库 ⇒ 把全部题标记为已训练（实现 100% 自动暂停）
    // 仅迁移一次（dq_migrated_<module> 标记），避免"重新开启"后被反复重新标记
    (function repairLegacyTrained() {
      try {
        const flag = Store.PREFIX + 'dq_migrated_' + module;
        if (localStorage.getItem(flag) === '1') return;
        const totalNow = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal(module) : 0;
        if (!totalNow) { try { localStorage.setItem(flag, '1'); } catch (e) {} return; }
        if (historicalSum() >= totalNow) {
          const fps = allQuestions().map(function (q) { return U.dqFp(q.q); }).filter(Boolean);
          if (fps.length) {
            U.dqTrainedMark(module, fps);
            trainedArr = (typeof U.dqTrainedLoad === 'function') ? U.dqTrainedLoad(module) : trainedArr;
            trainedSet = {};
            trainedArr.forEach(function (f) { if (f) trainedSet[f] = 1; });
          }
        }
        try { localStorage.setItem(flag, '1'); } catch (e) {}
      } catch (e) {}
    })();
    // 在真题区下方固定一个"标记完成"按钮（不随内部重渲染被覆盖）
    function ensureFoot() {
      try {
        const parent = area.parentNode;
        if (!parent) return;
        let foot = parent.querySelector('[data-dq-foot="' + module + '"]');
        if (!foot) {
          foot = document.createElement('div');
          foot.setAttribute('data-dq-foot', module);
          foot.className = 'dq-foot';
          parent.insertBefore(foot, area.nextSibling);
        }
        const done = (typeof U.dqTrainedCount === 'function') ? U.dqTrainedCount(module) : 0;
        const totalNow = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal(module) : 0;
        if (historicalSum() > 0 && done < totalNow) {
          foot.style.display = '';
          foot.innerHTML = '<button type="button" class="dq-done-btn" data-dq-done="' + module + '">🏁 本模块我已全部刷完（暂停每日训练）</button>';
          foot.querySelector('[data-dq-done]').onclick = function () {
            const fps = allQuestions().map(function (q) { return U.dqFp(q.q); }).filter(Boolean);
            if (fps.length) U.dqTrainedMark(module, fps);
            bindDailyQuiz(module, pool, opts);
          };
        } else {
          foot.style.display = 'none';
        }
      } catch (e) {}
    }
    ensureFoot();
    // 全部已训练 → 暂停该模块每日训练，等扩充题库后自动恢复
    function renderPaused() {
      const totalNow = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal(module) : 0;
      area.innerHTML =
        '<div class="dq-paused">' +
          '<div class="dq-pause-icon">🌱</div>' +
          '<div class="dq-pause-title">该模块的每日真题训练已暂停</div>' +
          '<div class="dq-pause-tip">题库已 100% 训练完成（已训练 <b>' + trainedArr.length + '</b> / 共 <b>' + totalNow + '</b> 题）。' +
          '新增题目到这里后，每日训练会自动重新开始；已训练的题不会再出现。</div>' +
          '<div class="dq-pause-sub">想巩固薄弱点，可前往「错题重练」继续练习 👉</div>' +
          '<div class="dq-pause-actions"><button type="button" class="dq-resume-btn" data-dq-resume="' + module + '">↺ 重新开启每日训练（清空已完成标记）</button></div>' +
        '</div>';
      const rb = area.querySelector('[data-dq-resume]');
      if (rb) rb.onclick = function () {
        try { localStorage.setItem(Store.PREFIX + U.dqTrainedKey(module), '[]'); } catch (e) {}
        bindDailyQuiz(module, pool, opts);
      };
      // 已暂停时隐藏"标记完成"按钮
      try {
        const f = area.parentNode && area.parentNode.querySelector('[data-dq-foot="' + module + '"]');
        if (f) f.style.display = 'none';
      } catch (e) {}
    }

    let quizList = [];
    if (pool && typeof pool === 'object' && !Array.isArray(pool) && Array.isArray(opts_.sections) && opts_.sections.length) {
      const chosenRefs = [];
      opts_.sections.forEach(sec => {
        // 排除前面 section 已选走的题（如今日题型与逻辑判断同池时防止撞题）
        // 同时排除已训练的题（答过的不再出现）
        let arr = (pool[sec.key] || []).filter(function (q) { return !isTrained(q); });
        if (chosenRefs.length) arr = arr.filter(q => chosenRefs.indexOf(q) < 0);
        if (!arr.length) return;
        // 每天取该题型「未训练」的前 sec.count 题，逐题推进
        pickRange(arr, 0, sec.count).forEach(q => {
          chosenRefs.push(q);
          quizList.push(Object.assign({}, q, { secLabel: sec.label || SEC_LABELS[sec.key] || sec.key }));
        });
      });
    } else if (Array.isArray(pool) && pool.length) {
      // 普通题库：只取「未训练」的题，每天取前 cnt 题逐题推进
      const cand = pool.filter(function (q) { return !isTrained(q); });
      const cnt = (typeof opts_.count === 'number' && opts_.count > 0) ? opts_.count : 10;
      if (!cand.length) { renderPaused(); return; }
      quizList = pickRange(cand, 0, cnt);
    }
    if (!quizList.length) { renderPaused(); return; }

    // 总题数以实际取到的题目数为准（今日题型分组模式下为当天题型题量）
    const TOTAL = quizList.length;

    // 作答状态：records[i] = { choice: 用户选项索引, correct: bool }；未答为 null
    // 从 localStorage 恢复今日进度（同一天内刷新不丢失做题痕迹），跨天自动重新开始
    const records = new Array(quizList.length).fill(null);
    try {
      if (typeof U.dqLoad === 'function') {
        const saved = U.dqLoad(module);
        if (saved && Array.isArray(saved) && saved.length === TOTAL) {
          for (let i = 0; i < TOTAL; i++) records[i] = (saved[i] && typeof saved[i] === 'object') ? saved[i] : null;
        }
      }
    } catch (err) {}
    let cur = 0;            // 当前显示题号（0 基）
    // 若已恢复部分进度，从第一个未做题开始展示（便于继续作答）
    try {
      const firstUnanswered = records.findIndex(r => r === null);
      if (firstUnanswered > 0) cur = firstUnanswered;
    } catch (err) {}
    let statsLogged = false;
    // 已计入 stats 的题数（用于"每答一题实时累加"和"中途离开不丢统计"）
    // 持久化到 localStorage: shangan_dq_logged_<module>_<date>
    let lastLoggedCount = 0;
    try {
      const lk = Store.PREFIX + 'dq_logged_' + module + '_' + U.todayStr();
      const v = parseInt(localStorage.getItem(lk) || '0', 10);
      if (v > 0 && v <= TOTAL) lastLoggedCount = v;
    } catch (err) {}

    // ===== 单题计时：每道题展示开始时记时，作答时记录耗时 =====
    let timer = null;        // setInterval 句柄
    let qStart = Date.now(); // 当前题目开始展示的时间戳
    // 单题推荐时限（秒）：整卷推荐 min 分钟按题数折算，下限 30s
    const perQLimit = Math.max(30, Math.round(min * 60 / TOTAL));
    const recTime = (rec) => (rec && typeof rec.time === 'number') ? rec.time : 0;

    // 清除并重建计时器（用于渲染新题目时）
    function resetTimer() {
      if (timer) { clearInterval(timer); timer = null; }
      qStart = Date.now();
    }

    /* ===== 按「题目指纹」去重计数 =====
       旧逻辑按"已答数量"计数：今日题目做过一遍后（或点"再来一次"重练），
       再答时 answeredCount <= lastLoggedCount 直接 return，导致"做了题统计却不变"。
       新逻辑：同一道题（指纹相同）当天只计一次；中途切走/关闭页面回来可正常补录。 */
    function fpOf(i) {
      const q = quizList[i];
      const s = (q && q.q) ? String(q.q) : '';
      return s.replace(/\s+/g, '').slice(0, 60) || ('idx:' + i);
    }
    function countedKey() {
      return Store.PREFIX + 'dq_counted_' + module + '_' + U.todayStr();
    }
    function loadCounted() {
      let m = null;
      try { m = JSON.parse(localStorage.getItem(countedKey()) || 'null'); } catch (e) {}
      if (m && typeof m === 'object') return m;
      // 迁移：把旧的"已计数题数"标记转成指纹集合，避免升级后重复计数
      m = {};
      try {
        const oldN = parseInt(localStorage.getItem(Store.PREFIX + 'dq_logged_' + module + '_' + U.todayStr()) || '0', 10) || 0;
        for (let i = 0; i < Math.min(oldN, records.length); i++) {
          m[(records[i] && records[i].fp) || ('idx:' + i)] = 1;
        }
      } catch (e) {}
      return m;
    }

    // 把新增答对/总累加到 stats（每答一题或刷新页面后调用，按题目去重）
    function flushStats() {
      const counted = loadCounted();
      let addCount = 0, addCorrect = 0;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (!r) continue;
        const f = fpOf(i);
        if (counted[f]) continue;
        counted[f] = 1;
        addCount++;
        if (r.correct) addCorrect++;
      }
      if (addCount <= 0) return;
      // 时长按"本题推荐时限"折算（最小 1 分钟，避免 0 显示）
      const addedMin = Math.max(1, Math.round(addCount * perQLimit / 60));
      try {
        if (typeof U.logStudy === 'function') {
          U.logStudy(module, addCount, addedMin, addCorrect, addCount);
        }
      } catch (err) {}
      try { localStorage.setItem(countedKey(), JSON.stringify(counted)); } catch (err) {}
      // 兼容：继续维护旧的"已答数"标记，供其他逻辑读取
      lastLoggedCount = records.filter(function (r) { return r !== null; }).length;
      try {
        const lk = Store.PREFIX + 'dq_logged_' + module + '_' + U.todayStr();
        localStorage.setItem(lk, String(lastLoggedCount));
      } catch (err) {}
    }

    // 持久化当前进度（每次作答后调用）
    function persist() {
      try { if (typeof U.dqSave === 'function') U.dqSave(module, records); } catch (err) {}
      // 同步更新卡片标题中的"累计已做 X / 共 Y 题"进度
      // 注：addStat 在全部答完后才触发，过程中"累计"=历史累计+当前已答
      const answeredCount = records.filter(r => r !== null).length;
      try {
        const titleEl = document.querySelector('[data-dailyquiz][data-module="' + module + '"]')
          ? area.closest('.card') && area.closest('.card').querySelector('.card-title')
          : null;
        if (titleEl) {
          let cumShown = answeredCount;
          if (typeof U.cumulativeQuizCount === 'function') {
            // 取"今日之前的累计"+"今日已答"（避免 addStat 未触发时 X 不变）
            const today = (typeof U.todayStr === 'function') ? U.todayStr() : '';
            const historical = (U.statsAll ? U.statsAll() : [])
              .filter(r => r && r.module === module && r.date !== today)
              .reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0);
            cumShown = historical + answeredCount;
          }
          const quizTotalShown = (typeof U.getModuleQuizTotal === 'function') ? U.getModuleQuizTotal(module) : 0;
          titleEl.textContent = titleEl.textContent.replace(
            /累计已做\s*\d+\s*题\s*\/[^)]*共\s*\d+\s*题/,
            '累计已做 ' + cumShown + ' 题 / 共 ' + quizTotalShown + ' 题'
          );
        }
      } catch (err) {}
    }

    function render() {
      const quiz = quizList[cur];
      const rec = records[cur]; // { choice, correct, time } 或 null
      const isAnswered = rec !== null;
      const answeredCount = records.filter(r => r !== null).length;

      // ===== 计时器 UI：未答题显示实时已用时，已答题显示该题耗时 =====
      resetTimer();
      let timerHTML = '';
      if (!isAnswered) {
        timerHTML = '<div class="dquiz-timer" data-timer>⏱ 已用时 <b>0s</b></div>';
        timer = setInterval(function () {
          const el = area.querySelector('[data-timer]');
          if (!el) return;
          const sec = Math.floor((Date.now() - qStart) / 1000);
          el.innerHTML = '⏱ 已用时 <b>' + sec + 's</b>' + (sec >= perQLimit ? ' <span class="timer-over">· 超时!</span>' : '');
          const tb = el.querySelector('b');
          if (tb) tb.style.color = (sec >= perQLimit ? '#d9534f' : '');
        }, 500);
      } else {
        const t = recTime(rec);
        const over = t >= perQLimit;
        timerHTML = '<div class="dquiz-timer ' + (over ? 'is-over' : '') + '" data-timer>⏱ 本题用时 <b>' + t + 's</b>' + (over ? ' · 超时' : '') + '</div>';
      }

      const optsHtml = quiz.options.map((op, i) => {
        const letter = 'ABCDEFGH'[i];
        let cls = 'option';
        let mark = '';
        if (isAnswered) {
          if (i === quiz.answer) { cls += ' correct'; mark = '<span class="opt-tag">✔ 正确答案</span>'; }
          else if (i === rec.choice && !rec.correct) { cls += ' wrong'; mark = '<span class="opt-tag">✘ 你的选择</span>'; }
          else cls += ' dim';
        }
        return '<div class="' + cls + '" data-i="' + i + '"><span class="opt-letter">' + letter + '</span><span class="opt-txt">' + U.esc(op) + '</span>' + mark + '</div>';
      }).join('');

      const srcHtml = quiz.source ? '<div class="quiz-source">📌 ' + U.esc(quiz.source) + '</div>' : '';
      const secTag = quiz.secLabel
        ? '<span class="tag tag-logic" style="margin-bottom:8px;display:inline-block">' + U.esc(quiz.secLabel) + '</span>'
        : '';
      const answerBar = isAnswered
        ? '<div class="analysis" style="display:block"><b>正确答案：' + 'ABCDEFGH'[quiz.answer] + '</b>' +
            (rec.correct ? '　🎉 回答正确！' : '　😢 已加入错题本') +
            '<br>' + U.esc(quiz.explain || '') + '</div>'
        : '<div class="analysis" style="display:none"></div>';

      // 进度条宽度
      const pct = Math.round((answeredCount / TOTAL) * 100);

      // ===== 全部答完时：成绩小结（每次 render 均重新生成，翻页不丢失） =====
      let scoreBlock = '';
      if (answeredCount === TOTAL) {
        const correctCount = records.filter(r => r !== null && r.correct).length;
        const totalSpent = records.reduce(function (s, r) { return s + (r && r.time ? r.time : 0); }, 0);
        const avgSpent = TOTAL ? Math.round(totalSpent / TOTAL) : 0;
        const overCount = records.filter(r => r && r.time && r.time >= perQLimit).length;
        const accPct = TOTAL ? Math.round(correctCount / TOTAL * 100) : 0;
        const fmtSpent = (totalSpent >= 60)
          ? Math.floor(totalSpent / 60) + 'm' + String(totalSpent % 60).padStart(2, '0') + 's'
          : totalSpent + 's';
        scoreBlock =
          '<div class="dq-summary">' +
            '<div class="dq-summary-title">📊 本次成绩</div>' +
            '<div class="dq-summary-grid">' +
              '<div class="dq-sum-cell"><div class="dq-sum-num">' + correctCount + '/' + TOTAL + '</div><div class="dq-sum-label">答对/总题</div></div>' +
              '<div class="dq-sum-cell"><div class="dq-sum-num">' + accPct + '%</div><div class="dq-sum-label">正确率</div></div>' +
              '<div class="dq-sum-cell"><div class="dq-sum-num">' + fmtSpent + '</div><div class="dq-sum-label">总用时</div></div>' +
              '<div class="dq-sum-cell"><div class="dq-sum-num">' + avgSpent + 's</div><div class="dq-sum-label">平均每题</div></div>' +
              '<div class="dq-sum-cell"><div class="dq-sum-num ' + (overCount ? 'over' : 'ok') + '">' + overCount + '</div><div class="dq-sum-label">超时题</div></div>' +
            '</div>' +
            '<div class="dq-sum-tip">单题推荐时限约 <b>' + perQLimit + 's</b>，' +
              (overCount ? '有 <b style="color:#d9534f">' + overCount + '</b> 题超时，建议加强限时提速' : '速度控制良好，继续保持') +
            '</div>' +
            '<button class="btn btn-primary" data-dq-redo style="margin-top:14px;width:100%">🔄 再来一次（今日重练）</button>' +
          '</div>';
      }

      area.innerHTML =
        '<div class="dquiz" data-cur="' + cur + '">' +
          // ① 顶部：进度 + 题号
          '<div class="dquiz-head">' +
            '<span class="dquiz-progress-txt">已完成 ' + answeredCount + '/' + TOTAL + '</span>' +
            '<span class="dquiz-pos">第 ' + (cur + 1) + ' / ' + TOTAL + ' 题</span>' +
          '</div>' +
          '<div class="dquiz-bar"><div class="dquiz-bar-fill" style="width:' + pct + '%"></div></div>' +
          timerHTML +
          // ② 题目卡片
          '<div class="quiz-block card">' +
            secTag +
            srcHtml +
            '<div class="quiz-q">' + U.esc(quiz.q, true) + '</div>' +
            '<div class="options">' + optsHtml + '</div>' +
            answerBar +
            scoreBlock +
            '<div class="dquiz-note" style="display:' + (isAnswered ? 'none' : 'block') + '">选择答案后自动判断对错；答对自动进入下一题，答错会显示解析并加入错题本。</div>' +
          '</div>' +
          // ③ 底部翻页
          '<div class="pager">' +
            '<button class="page-btn" data-dq="prev" ' + (cur === 0 ? 'disabled' : '') + '>‹</button>' +
            '<span class="page-indicator">' + (cur + 1) + ' / ' + TOTAL + '</span>' +
            '<button class="page-btn" data-dq="next" ' + (cur === TOTAL - 1 ? 'disabled' : '') + '>›</button>' +
          '</div>' +
        '</div>';

      // 绑定选项点击（未答时）
      if (!isAnswered) {
        area.querySelectorAll('.option').forEach(op => {
          op.addEventListener('click', function (e) {
            if (records[cur] !== null) return;
            const i = parseInt(op.getAttribute('data-i'), 10);
            const correct = (i === quiz.answer);
            // 记录该题作答耗时（秒），至少 1s
            const spent = Math.max(1, Math.floor((Date.now() - qStart) / 1000));
            records[cur] = { choice: i, correct: correct, time: spent, fp: fpOf(cur) };
            // 标记该题已进入"已训练集"：之后每日真题训练不再推送（全部训练完则自动暂停）
            try { if (typeof U.dqTrainedMark === 'function') U.dqTrainedMark(module, [U.dqFp(quiz.q)]); } catch (e) {}
            persist();  // 保存进度，刷新后不丢失
            render();  // 重新渲染显示结果
            if (correct) {
              U.toast('🎉 回答正确！');
              // 自动进入下一题
              setTimeout(function () { if (cur < TOTAL - 1) { cur++; render(); } }, 500);
            } else {
              let __dup = false;
              // 答错：加入错题本 + 提示
              try {
                if (typeof S.addMistake === 'function') {
                  // 当天同题去重：重刷"今日重练"时，今天已收录的题不再重复加入错题本
                  const __today = U.todayStr();
                  __dup = (S.data.mistakes.items || []).some(function (it) {
                    return it.module === module && (it.stem || '') === (quiz.q || '') && (it.date === __today);
                  });
                  if (!__dup) {
                  // 记录用户错选的字母与索引（供错题本逐题模式以选项方式回放）
                  const letter = 'ABCDEFGH';
                  const ansIdx = quiz.answer;
                  const myIdx = (typeof records[cur] === 'object' && typeof records[cur].choice === 'number') ? records[cur].choice : -1;
                  S.addMistake({
                    module: module,
                    category: catLabel,
                    // 兼容字段：note 仍按原有拼接方式存储（错题列表/搜索仍可用旧版展示）
                    note: '【' + catLabel + '·每日一练】' + quiz.q + '\n正确答案：' + letter[ansIdx] + ' ' + (quiz.options && quiz.options[ansIdx] || '') + '\n解析：' + (quiz.explain || ''),
                    // 结构化字段：用于错题本「选项模式」逐题练习
                    q: quiz.q || '',
                    options: Array.isArray(quiz.options) ? quiz.options.slice() : [],
                    answerIndex: typeof ansIdx === 'number' ? ansIdx : -1,
                    myAnswerIndex: myIdx >= 0 ? myIdx : -1,
                    explain: quiz.explain || '',
                    source: quiz.source || '',
                    // 结构化拆解（与手动录入保持一致字段名）
                    stem: quiz.q || '',
                    answer: letter[ansIdx] + ' ' + (quiz.options && quiz.options[ansIdx] || ''),
                    myAnswer: myIdx >= 0 ? (letter[myIdx] + ' ' + (quiz.options && quiz.options[myIdx] || '')) : '',
                    analysis: quiz.explain || '',
                    knowledge: quiz.source || '',
                    image: ''
                  });
                  }
                }
              } catch (err) {
                // 加入错题本失败不应影响做题体验，仅静默记录
              }
              U.toast(__dup ? '😢 答错啦（今日已收录，不再重复）' : '😢 答错啦，已加入错题本');
            }
            // 实时把本题的"作答结果"累加到 stats（按增量累加，避免"答完 TOTAL 才一次性 addStat"导致中途停止就漏记）
            try { flushStats(); } catch (e) {}
            maybeLogStats();
          });
        });
      }
      // 绑定翻页
      area.querySelector('[data-dq="prev"]').addEventListener('click', function () {
        if (cur > 0) { cur--; render(); }
      });
      area.querySelector('[data-dq="next"]').addEventListener('click', function () {
        if (cur < TOTAL - 1) { cur++; render(); }
      });
      // 再来一次（今日重练）：清空进度重做本日同组题，便于补刷漏记的错题
      const redoBtn = area.querySelector('[data-dq-redo]');
      if (redoBtn) {
        redoBtn.addEventListener('click', function () {
          records.fill(null);
          cur = 0;
          try { U.dqSave(module, records); } catch (e) {}
          // statsLogged 保持 true：重练不重复累加统计，但错题仍照常加入
          resetTimer();
          render();
          U.toast('🔄 已重置，可重新练习今日 ' + TOTAL + ' 题');
        });
      }
    }

    // 全部答完后自动勾选"完成今日XX真题"待办项（stats 已由 flushStats 实时累加，无需在这里 addStat）
    function maybeLogStats() {
      const answeredCount = records.filter(r => r !== null).length;
      if (answeredCount === TOTAL && !statsLogged) {
        statsLogged = true;
        // 持久化标记：今日该模块的"完成真题"待办已勾选，刷新页面后不再重复触发
        const statFlagKey = 'dq_stat_' + module + '_' + U.todayStr();
        try {
          if (localStorage.getItem(Store.PREFIX + statFlagKey) === '1') return;
          localStorage.setItem(Store.PREFIX + statFlagKey, '1');
        } catch (err) {}
        const correctCount = records.filter(r => r !== null && r.correct).length;
        // 自动勾选该模块的"完成今日XX真题"待办项（按标题含"真题"动态定位，而非固定第 0 项）
        let dqTitle = '';
        try {
          const dqIdx = (typeof U.dqTodoIndex === 'function') ? U.dqTodoIndex(module) : -1;
          if (dqIdx >= 0) {
            const tkey = U.todoKey(module, dqIdx);
            if (tkey && Store.PREFIX) {
              localStorage.setItem(Store.PREFIX + tkey, '1');
            }
            // 取出待办标题，用于同步模块打卡记录（与手动勾选待办的行为保持一致）
            try {
              if (typeof U.getModuleTodoEntries === 'function') {
                const ents = U.getModuleTodoEntries(module) || [];
                const hit = ents.find(en => en.index === dqIdx);
                if (hit && hit.title) dqTitle = hit.title;
              }
            } catch (err) {}
          }
        } catch (err) {}
        // 同步模块打卡记录：登记今日打卡并反向联动"每日计划"，使"每日学习进度"立即刷新
        // （原实现只写 localStorage 待办 key，未调 markModuleDone，导致当前页进度滞后）
        if (dqTitle && typeof S.markModuleDone === 'function') {
          try { S.markModuleDone(module, dqTitle); } catch (err) {}
        }
        setTimeout(function () {
          U.toast('🏆 今日' + TOTAL + '题已完成：答对 ' + correctCount + ' 题，已计入待办');
          // 重新渲染当前页，让"每日学习进度"与待办勾选态立即联动更新
          try {
            const curPage = (global.APP && global.APP.current) || '';
            if (curPage && typeof global.APP.renderPage === 'function') {
              global.APP.renderPage(curPage);
            }
          } catch (err) {}
        }, 400);
      }
    }

    render();

    // 页面初次加载：补 addStat（处理"上次做了 8 题就关闭页面,这次打开页面"的情况）
    try { flushStats(); } catch (e) {}
    // 若恢复的进度已全部完成（例如作答后刷新页面），补勾选"今日真题"待办
    if (records.every(function (r) { return r !== null; }) && !statsLogged) {
      maybeLogStats();
    }
  }

  /* ================================================================
     10. 申论·小题
     ================================================================ */
  function viewEssay() {
    const s = pick(C.SHENLUN_SMALL);
    // 今日规范表述：优先用扩充词库 SHENLUN_WORDS，兜底用 STANDARD_PHRASES
    // 每天滚动展示一组，避免一次显示过多
    const phrasesAll = (C.SHENLUN_WORDS && C.SHENLUN_WORDS.length) ? C.SHENLUN_WORDS : (C.STANDARD_PHRASES || []);
    const phrasesDay = 10; // 每天展示 10 个
    const phrasesStart = (dayIdx * phrasesDay) % phrasesAll.length;
    const phrasesOfDay = pickRange(phrasesAll, phrasesStart, phrasesDay);
    return moduleShell('essay', '申论小题', '✏️', [
      '掌握今日题型解题要点',
      '积累规范表述10个',
    ], '' +
      // ===== 规范表述栏目（每日 10 个，直接展示） =====
      '<div class="card">' +
        '<div class="card-title">' +
          '<span class="emoji">📚</span>' +
          '<span>规范表述</span>' +
          '<span class="card-sub">（今日' + phrasesOfDay.length + '个）</span>' +
        '</div>' +
        '<div data-phrases-list>' +
          phrasesOfDay.map((p, i) =>
            '<div class="sp-item">' +
              '<div class="sp-badge">' + (i + 1) + '</div>' +
              '<div class="sp-body">' +
                '<div class="sp-phrase">' + U.esc(p.phrase) + '</div>' +
                '<div class="sp-scene">' + U.esc(p.scene) + '</div>' +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">' + s.icon + '</span>今日题型：' + s.type +
          (s.count ? '<span class="tag tag-shenlun" style="margin-left:auto">福建省考出现 ' + s.count + ' 次</span>' : '') +
        '</div>' +
        // 答题要点
        '<div class="section-tip" style="margin-bottom:8px">📌 答题要点</div>' +
        '<div class="analysis" style="display:block;margin-top:0;background:var(--card);border:1px solid var(--line)">' +
          U.esc(s.point) +
        '</div>' +
        // 历年出现年份
        '<div class="section-tip" style="margin:12px 0 8px">🗓️ 历年福建省考出现年份</div>' +
        '<div class="year-chips">' +
          (s.years && s.years.length ? s.years.map(y => '<span class="year-chip">' + y + '</span>').join('') : '<span class="e-txt" style="color:var(--ink-3)">暂无数据</span>') +
        '</div>' +
        (s.count ? '<div class="li-meta" style="margin-top:8px;color:var(--ink-3)">近十年福建省考申论共出现 <b>' + s.count + '</b> 次，高频必考题型，务必重点掌握。</div>' : '') +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="essay"></div>' +
      '</div>');
  }
  function bindEssay() {
    bindModulePlanEvents('essay');
  }

  /* ================================================================
     11. 申论·大作文
     ================================================================ */
  /* ---------- 申论大作文·金句素材库（按主题，来源：金句素材汇总.pdf） ---------- */
  function jinjuListHTML(theme) {
    const arr = (C.COMPOSITION_JINJU) || [];
    const t = arr.find(x => x.theme === theme) || arr[0];
    if (!t) return '';
    return t.sentences.map(s =>
      '<div class="quote-card" style="margin-bottom:8px"><div class="quote-mark">“</div><div class="quote-text">' + U.esc(s) + '</div></div>'
    ).join('');
  }
  function jinjuChipsHTML(active) {
    const arr = (C.COMPOSITION_JINJU) || [];
    return arr.map(t => {
      const on = (t.theme === active);
      const st = on
        ? 'flex:0 0 auto;padding:6px 12px;border-radius:14px;background:var(--primary);color:#fff;font-size:13px;cursor:pointer;border:1px solid var(--primary)'
        : 'flex:0 0 auto;padding:6px 12px;border-radius:14px;background:var(--bg-2);color:var(--ink-2);font-size:13px;cursor:pointer;border:1px solid transparent';
      return '<span class="jj-chip" data-jj-theme="' + U.esc(t.theme) + '" style="' + st + '">' + U.esc(t.theme) + '</span>';
    }).join('');
  }
  function jinjuCardHTML(active) {
    const arr = (C.COMPOSITION_JINJU) || [];
    const cnt = arr.reduce((a, t) => a + t.sentences.length, 0);
    return '<div class="card">' +
      '<div class="card-title"><span class="emoji">📚</span>金句素材库<span class="card-sub">（按主题 · ' + arr.length + ' 类 / ' + cnt + ' 条）</span></div>' +
      '<div class="section-tip">按作文适用主题分类整理的素材库原文，点击主题切换查看，可直接抄录套用到大作文开头与分论点。</div>' +
      '<div class="jj-chips" style="display:flex;gap:8px;overflow-x:auto;padding:6px 0;white-space:nowrap;-webkit-overflow-scrolling:touch">' + jinjuChipsHTML(active) + '</div>' +
      '<div id="jjList">' + jinjuListHTML(active) + '</div>' +
    '</div>';
  }

  // 今日主题卡片：每日滚动 1 个主题（按考察频次），默认展示核心内涵，点击展开真题溯源 / 分论点 / 金句 / 福建素材
  function themeCardHTML(sub) {
    if (!sub) return '';
    const points = (sub.points || []).map(p => '<li>' + U.esc(p) + '</li>').join('');
    const quotes = (sub.quotes || []).map(q =>
      '<div class="quote-card" style="margin-bottom:8px"><div class="quote-mark">“</div><div class="quote-text">' + U.esc(q) + '</div></div>'
    ).join('');
    return '' +
      '<div class="card theme-card" data-theme-toggle style="cursor:pointer">' +
        '<div class="card-title" style="display:flex;align-items:center;justify-content:space-between">' +
          '<span><span class="emoji">🖋️</span>今日主题：<b>' + U.esc(sub.title) + '</b></span>' +
          '<span class="theme-arrow" style="transition:transform .2s;color:var(--ink-3);font-size:13px">▾</span>' +
        '</div>' +
        '<div class="exam-info" style="margin:10px 0"><span class="exam-tag">📊 考察频次</span>近 5 年国省考共 ' + (sub.freq || 0) + ' 次考查</div>' +
        '<div class="section-tip" style="margin-bottom:0"><b>核心内涵：</b>' + U.esc(sub.core || '') + '</div>' +
        '<div class="theme-detail" style="display:none;margin-top:10px;border-top:1px dashed var(--bd,#e5e7eb);padding-top:10px">' +
          '<div class="section-tip" style="margin-bottom:6px"><b>📌 真题溯源</b></div>' +
          '<div class="li-desc" style="margin-bottom:12px">' + U.esc(sub.trace || '') + '</div>' +
          '<div class="section-tip" style="margin-bottom:6px"><b>🧩 通用 3 组分论点</b></div>' +
          '<ol class="theme-points" style="margin:0 0 12px 18px;line-height:1.8;color:var(--ink-2)">' + points + '</ol>' +
          '<div class="section-tip" style="margin-bottom:6px"><b>💎 金句</b></div>' +
          quotes +
          '<div class="section-tip" style="margin:10px 0 6px"><b>🏠 福建本土素材</b></div>' +
          '<div class="li-desc">' + U.esc(sub.local || '') + '</div>' +
        '</div>' +
        '<div class="section-tip" style="margin-top:10px;color:var(--primary)">👆 点击卡片展开 / 收起 详情</div>' +
      '</div>';
  }

  function viewComposition() {
    const sub = pick(C.COMPOSITION_SUBJECTS);

    // 金句素材库（按主题）：默认展示第一主题
    const jinjuArr = (C.COMPOSITION_JINJU) || [];
    const defaultTheme = jinjuArr[0] ? jinjuArr[0].theme : '';

    return moduleShell('composition', '大作文', '🖋️', [
      '积累今日作文主题素材',
      '背诵金句2句',
    ], '' +
      // 今日主题：每日滚动 1 个主题（按考察频次），点开展开详情
      themeCardHTML(sub) +

      // 金句素材库（按主题）：默认展示第一主题，置于「每日学习进度」卡片下方
      jinjuCardHTML(defaultTheme) +

      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📋</span>今日计划</div>' +
        '<div class="section-tip">今日全部目标同步自「每日计划」，勾选后自动同步到每日计划页与各模块待办。</div>' +
        '<div data-modplan="composition"></div>' +
      '</div>');
  }
  function bindComposition() {
    bindModulePlanEvents('composition');
    // 今日主题卡片：点击展开 / 收起详情（局部 DOM 切换，不整页重渲染，避免跳回顶部）
    const themeCard = document.querySelector('[data-theme-toggle]');
    if (themeCard) {
      themeCard.addEventListener('click', () => {
        const detail = themeCard.querySelector('.theme-detail');
        const arrow = themeCard.querySelector('.theme-arrow');
        if (!detail) return;
        const show = (detail.style.display === 'none');
        detail.style.display = show ? 'block' : 'none';
        if (arrow) arrow.style.transform = show ? 'rotate(180deg)' : 'rotate(0deg)';
        themeCard.blur();
      });
    }
    // 金句素材库：主题切换（局部刷新列表，不整页重渲染，避免跳回顶部）
    const chips = document.querySelectorAll('.jj-chips .jj-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => {
          c.style.background = 'var(--bg-2)';
          c.style.color = 'var(--ink-2)';
          c.style.borderColor = 'transparent';
        });
        chip.style.background = 'var(--primary)';
        chip.style.color = '#fff';
        chip.style.borderColor = 'var(--primary)';
        const list = document.getElementById('jjList');
        if (list) list.innerHTML = jinjuListHTML(chip.getAttribute('data-jj-theme'));
      });
    });
  }

  /* ================================================================
     12. 错题本
     ================================================================ */
  /* --- 错题重练：逐题自评界面 --- */
  // 当前重练的题目列表（支持乱序序列 st.seq）
  function reviewList(items) {
    const st = mistakeReviewState;
    let list = items;
    if (st.onlyNeed) { const s = new Set(st.onlyNeed); list = list.filter(i => s.has(i.id)); }
    else if (st.module) list = list.filter(i => i.module === st.module);
    // 若为乱序序列，按 st.seq 的顺序排序
    if (st.seq && Array.isArray(st.seq)) {
      const map = {};
      list.forEach(i => { map[i.id] = i; });
      const ordered = [];
      st.seq.forEach(id => { if (map[id]) ordered.push(map[id]); });
      // 补上 seq 中未包含（理论上不会发生），保持原序
      list.forEach(i => { if (!st.seq.includes(i.id)) ordered.push(i); });
      list = ordered;
    }
    return list;
  }

  function mistakeReviewHTML(items) {
    const st = mistakeReviewState;
    const list = reviewList(items);
    // 全部重练时按录入先后顺序
    const total = list.length;
    if (!total) {
      mistakeReviewState = null;
      return '<div class="empty"><div class="e-icon">🎉</div><div class="e-txt">该模块暂无错题</div>' +
        '<button class="btn btn-sm btn-ghost" data-mreview-exit>返回错题本</button></div>';
    }

    // ===== 已完成 =====
    if (st.cur >= total) {
      const knownN = st.known.length, needN = st.need.length;
      const needSnippet = st.need.map(id => {
        const mis = items.find(m => m.id === id);
        if (!mis) return '';
        const meta = U.catInfo(mis.module);
        return '<div class="todo-item">' +
          '<span class="todo-go-icon">🔁</span>' +
          '<div class="todo-txt">' + U.esc((mis.stem || mis.note || '').slice(0, 40)) +
            '<div class="li-meta">' + meta.icon + ' ' + meta.label + '</div></div>' +
        '</div>';
      }).join('');
      return '' +
        '<div class="card">' +
          '<div class="card-title"><span class="emoji">🎓</span>本次重练完成' +
            '<span class="tag tag-success" style="margin-left:auto">记住 ' + knownN + ' · 巩固 ' + needN + '</span>' +
          '</div>' +
          '<div class="section-tip">共重练 ' + total + ' 道。<b style="color:var(--success)">' + knownN + ' 道</b>已掌握，<b style="color:var(--danger)">' + needN + ' 道</b>仍需巩固（已自动重新进入艾宾浩斯复习队列，明天起再次提醒）。</div>' +
          (st.need.length ? '<div class="card-title" style="margin-top:14px"><span class="emoji">📌</span>仍需巩固</div><div class="todo-list">' + needSnippet + '</div>' : '') +
          '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
            (st.need.length ? '<button class="btn" data-mreview-repeat="need">🔁 只练仍需巩固（' + needN + '）</button>' : '') +
            '<button class="btn btn-primary" data-mreview-exit>✅ 完成，返回错题本</button>' +
          '</div>' +
        '</div>';
    }

    const it = list[st.cur];
    const meta = U.catInfo(it.module);
    const stemHtml = it.stem
      ? '<div class="mc-q" style="font-size:16px;line-height:1.7"><b>题目：</b>' + U.esc(it.stem) + '</div>'
      : '<div class="mc-note" style="font-size:16px">' + U.esc(it.note || '').replace(/\n/g, '<br>') + '</div>';

    // 尝试从每日真题训练题库补齐选项（错题大多源自题库，按题干匹配回填 options/answerIndex）
    if (!(Array.isArray(it.options) && it.options.length >= 2)) {
      try { if (S && typeof S.enrichMistakeWithOptions === 'function') S.enrichMistakeWithOptions(it); } catch (e) {}
    }
    const hasOptions = Array.isArray(it.options) && it.options.length >= 2 && typeof it.answerIndex === 'number';
    const letter = 'ABCDEFGH';

    // 已回答：展示答案 + 自评按钮；未回答：只展示题干 + "显示答案"
    let answerArea = '';
    if (hasOptions) {
      // ===== 选择题：A/B/C/D 选项作答（与每日真题训练一致） =====
      const ans = (st.optAnswers && st.optAnswers[it.id]) || null;
      const isAnswered = !!ans;
      const optsHtml = it.options.map(function (op, i) {
        let cls = 'option';
        let mark = '';
        if (isAnswered) {
          if (i === it.answerIndex) { cls += ' correct'; mark = '<span class="opt-tag">✔ 正确答案</span>'; }
          else if (i === ans.choice && !ans.correct) { cls += ' wrong'; mark = '<span class="opt-tag">✘ 你的选择</span>'; }
          else cls += ' dim';
        }
        return '<div class="' + cls + '" data-mreview-opt="' + i + '" style="' + (isAnswered ? 'pointer-events:none' : 'cursor:pointer') + '">' +
          '<span class="opt-letter">' + letter[i] + '</span>' +
          '<span class="opt-txt">' + U.esc(op) + '</span>' +
          mark +
        '</div>';
      }).join('');
      let optExtra = '';
      if (isAnswered) {
        const analysisHtml = (it.analysis || it.explain)
          ? '<div class="mc-line" style="margin-top:10px">💡 分析思路：' + U.esc(it.analysis || it.explain).replace(/\n/g, '<br>') + '</div>' : '';
        const knowledgeHtml = it.knowledge
          ? '<div class="mc-line">🏷️ 考点：' + U.esc(it.knowledge) + '</div>' : '';
        const sourceHtml = it.source
          ? '<div class="mc-line" style="color:var(--ink-3);font-size:12px">📌 ' + U.esc(it.source) + '</div>' : '';
        optExtra =
          '<div class="mistake-card card" style="box-shadow:none;margin-top:14px;background:var(--bg-soft)">' +
            '<div class="mc-body">' +
              (ans.correct
                ? '<div class="mc-line" style="color:var(--success)">🎉 回答正确！</div>'
                : '<div class="mc-line err">❌ 正确答案为 ' + letter[it.answerIndex] + '：' + U.esc(it.options[it.answerIndex] || '') + '</div>') +
              analysisHtml + knowledgeHtml + sourceHtml +
            '</div>' +
          '</div>' +
          (ans.correct
            ? '<div style="margin-top:10px;color:var(--ink-3);font-size:12px;text-align:center">✓ 已自动跳下一题</div>'
            : '<button class="btn btn-primary" data-mreview-next style="width:100%;margin-top:14px">下一题 ›</button>');
      }
      answerArea = '<div class="options" style="margin-top:12px">' + optsHtml + '</div>' + optExtra;
    } else if (st.answered) {
      const answerHtml = it.answer ? '<div class="mc-line ans">✅ 正确答案：' + U.esc(it.answer) + '</div>' : '';
      const myAnswerHtml = it.myAnswer ? '<div class="mc-line err">❌ 我错选：' + U.esc(it.myAnswer) + '</div>' : '';
      const analysisHtml = it.analysis ? '<div class="mc-line">💡 分析思路：' + U.esc(it.analysis).replace(/\n/g, '<br>') + '</div>' : '';
      const knowledgeHtml = it.knowledge ? '<div class="mc-line">🏷️ 考点：' + U.esc(it.knowledge) + '</div>' : '';
      answerArea =
        '<div class="mistake-card card" style="box-shadow:none;margin:12px 0;background:var(--bg-soft)">' +
          '<div class="mc-body">' + answerHtml + myAnswerHtml + analysisHtml + knowledgeHtml + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
          '<button class="btn btn-primary" data-mreview-known style="flex:1">😊 记住了</button>' +
          '<button class="btn btn-danger" data-mreview-need style="flex:1">🤔 仍需巩固</button>' +
        '</div>';
    } else {
      answerArea =
        '<button class="btn btn-ghost" data-mreview-show-ans style="width:100%;margin-top:14px">👁 显示答案</button>';
    }

    const progText = '第 ' + (st.cur + 1) + ' / ' + total + ' 道';
    return '' +
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">🔁</span>错题重练' +
          '<span class="tag tag-mistake" style="margin-left:auto">' + progText + '</span>' +
        '</div>' +
        (st.module ? '<div class="li-meta" style="margin-bottom:6px">专项 · ' + meta.icon + ' ' + meta.label + '</div>' : '') +
        '<div class="section-tip" style="margin-bottom:8px">选择题直接点选项作答，问答题先回忆再看答案自评；<b style="color:var(--danger)">答错或仍需巩固</b>会自动重新进入艾宾浩斯复习队列。</div>' +
        '<div class="mistake-card card" style="box-shadow:none">' +
          '<div class="mc-head">' +
            '<span class="mc-tag" style="background:var(--primary-soft);color:var(--primary-deep)">' + meta.icon + ' ' + meta.label + '</span>' +
            (it.category ? '<span class="mc-tag" style="background:#ffe4e9;color:#d9534f">' + U.esc(it.category) + '</span>' : '') +
          '</div>' +
          '<div class="mc-body" style="margin-top:10px">' + stemHtml + answerArea + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button class="btn btn-sm btn-ghost" data-mreview-prev ' + (st.cur === 0 ? 'disabled' : '') + '>← 上一题</button>' +
          '<button class="btn btn-sm btn-ghost" data-mreview-exit style="margin-left:auto">✕ 退出</button>' +
        '</div>' +
      '</div>';
  }

  // 今日待复习错题：构造待复习列表（按艾宾浩斯轮次排序）
  function dueReviewList() {
    const items = (S && S.data && S.data.mistakes && S.data.mistakes.items) || [];
    const out = [];
    try {
      if (S && typeof S.mistakeReviewsDueOn === 'function') {
        S.mistakeReviewsDueOn(U.todayStr()).forEach(r => {
          const mis = items.find(m => m.id === r.mistakeId);
          if (mis) {
            // 老数据回填：若错题无 options，尝试在题库匹配并补全
            try { if (S && typeof S.enrichMistakeWithOptions === 'function') S.enrichMistakeWithOptions(mis); } catch (e) {}
            out.push({ review: r, mis: mis });
          }
        });
      }
    } catch (e) {}
    // 按轮次升序（先复习的先做）
    out.sort(function (a, b) { return (a.review.round || 0) - (b.review.round || 0); });
    return out;
  }

  // 今日待复习错题·逐题模式 HTML
  function dueReviewHTML(items) {
    const st = dueReviewState;
    const list = st.list;
    const total = list.length;

    // ===== 全部完成 =====
    if (st.cur >= total || st.finished) {
      const knownN = st.known.length, needN = st.need.length;
      // 需要巩固的题目列表（仅提示，不展开）
      const needSnippet = st.need.map(function (id) {
        const mis = items.find(function (m) { return m.id === id; });
        if (!mis) return '';
        const meta = U.catInfo(mis.module);
        return '<div class="todo-item">' +
          '<span class="todo-go-icon">🔁</span>' +
          '<div class="todo-txt">' + U.esc((mis.stem || mis.note || '').slice(0, 50)) +
            '<div class="li-meta">' + meta.icon + ' ' + meta.label + '</div></div>' +
        '</div>';
      }).join('');
      return '' +
        '<div class="card">' +
          '<div class="card-title"><span class="emoji">🎓</span>今日复习完成' +
            '<span class="tag tag-success" style="margin-left:auto">已复习 ' + total + ' · 记住 ' + knownN + ' · 巩固 ' + needN + '</span>' +
          '</div>' +
          '<div class="section-tip">共复习 <b>' + total + '</b> 道，全部已计入"已复习"。' +
            '<b style="color:var(--success)">' + knownN + ' 道</b>已掌握进入下一轮，' +
            '<b style="color:var(--danger)">' + needN + ' 道</b>仍需巩固（已重新进入艾宾浩斯复习队列，明天起再次提醒）。</div>' +
          (st.need.length ? '<div class="card-title" style="margin-top:14px"><span class="emoji">📌</span>仍需巩固</div><div class="todo-list">' + needSnippet + '</div>' : '') +
          '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
            (st.need.length ? '<button class="btn" data-due-repeat="need">🔁 只练仍需巩固（' + needN + '）</button>' : '') +
            '<button class="btn btn-primary" data-due-exit style="margin-left:auto">✅ 返回错题本</button>' +
          '</div>' +
        '</div>';
    }

    const cur = list[st.cur];
    const it = cur.mis;
    const meta = U.catInfo(it.module);
    const stemHtml = it.stem
      ? '<div class="mc-q" style="font-size:16px;line-height:1.7">' + U.esc(it.stem) + '</div>'
      : '<div class="mc-note" style="font-size:16px">' + U.esc(it.note || '').replace(/\n/g, '<br>') + '</div>';

    // 判断本题是否带选项：options 数组长度 >= 2 即视为选择题
    const hasOptions = Array.isArray(it.options) && it.options.length >= 2;
    const curChoice = st.choices[st.cur];   // 用户当前题选择索引（未答为 undefined）
    const curCorrect = st.correct[st.cur];  // 用户当前题作答正确性（未答为 undefined）
    const isAnswered = (curChoice !== undefined && curChoice !== null && curChoice !== -1);

    // ===== 题干下方内容区：选项题 与 问答题 不同 =====
    let bodyExtra = '';
    if (hasOptions) {
      // 选择题：渲染 A/B/C/D 选项按钮
      const letter = 'ABCDEFGH';
      const optsHtml = it.options.map(function (op, i) {
        let cls = 'option';
        let mark = '';
        if (isAnswered) {
          if (i === it.answerIndex) { cls += ' correct'; mark = '<span class="opt-tag">✔ 正确答案</span>'; }
          else if (i === curChoice && !curCorrect) { cls += ' wrong'; mark = '<span class="opt-tag">✘ 你的选择</span>'; }
          else cls += ' dim';
        }
        return '<div class="' + cls + '" data-i="' + i + '" data-due-opt="' + i + '" style="' + (isAnswered ? 'pointer-events:none' : 'cursor:pointer') + '">' +
          '<span class="opt-letter">' + letter[i] + '</span>' +
          '<span class="opt-txt">' + U.esc(op) + '</span>' +
          mark +
        '</div>';
      }).join('');
      bodyExtra += '<div class="options" style="margin-top:12px">' + optsHtml + '</div>';

      if (isAnswered) {
        // 已答：显示解析（用户错选时尤其需要）
        const analysisHtml = (it.analysis || it.explain)
          ? '<div class="mc-line" style="margin-top:10px">💡 分析思路：' + U.esc(it.analysis || it.explain).replace(/\n/g, '<br>') + '</div>'
          : '';
        const knowledgeHtml = it.knowledge
          ? '<div class="mc-line">🏷️ 考点：' + U.esc(it.knowledge) + '</div>'
          : '';
        const sourceHtml = it.source
          ? '<div class="mc-line" style="color:var(--ink-3);font-size:12px">📌 ' + U.esc(it.source) + '</div>'
          : '';
        bodyExtra +=
          '<div class="mistake-card card" style="box-shadow:none;margin-top:14px;background:var(--bg-soft)">' +
            '<div class="mc-body">' +
              (curCorrect
                ? '<div class="mc-line" style="color:var(--success)">🎉 回答正确！已计入"已复习"</div>'
                : '<div class="mc-line err">❌ 正确答案为 ' + letter[it.answerIndex] + '：' + U.esc(it.options[it.answerIndex] || '') + '</div>') +
              analysisHtml + knowledgeHtml + sourceHtml +
            '</div>' +
          '</div>' +
          // 答错时显示「下一题」按钮（答对会自动跳转，500ms 后无需按钮）
          (curCorrect
            ? '<div style="margin-top:10px;color:var(--ink-3);font-size:12px;text-align:center">✓ 已自动跳下一题</div>'
            : '<button class="btn btn-primary" data-due-next style="width:100%;margin-top:14px">下一题 ›</button>'
          );
      } else {
        // 未答：底部小提示（与每日真题训练一致）
        bodyExtra += '<div class="dquiz-note" style="margin-top:10px">选择答案后自动判断对错；答对自动进入下一题，答错会显示解析。</div>';
      }
    } else {
      // 问答题：保留「显示答案 / 做对-仍需巩固」双按钮流程
      if (st.answered) {
        const answerHtml = it.answer ? '<div class="mc-line ans">✅ 正确答案：' + U.esc(it.answer) + '</div>' : '';
        const myAnswerHtml = it.myAnswer ? '<div class="mc-line err">❌ 我错选：' + U.esc(it.myAnswer) + '</div>' : '';
        const analysisHtml = it.analysis ? '<div class="mc-line">💡 分析思路：' + U.esc(it.analysis).replace(/\n/g, '<br>') + '</div>' : '';
        const knowledgeHtml = it.knowledge ? '<div class="mc-line">🏷️ 考点：' + U.esc(it.knowledge) + '</div>' : '';
        bodyExtra +=
          '<div class="mistake-card card" style="box-shadow:none;margin-top:12px;background:var(--bg-soft)">' +
            '<div class="mc-body">' + answerHtml + myAnswerHtml + analysisHtml + knowledgeHtml + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
            '<button class="btn btn-primary" data-due-known style="flex:1">✓ 做对了</button>' +
            '<button class="btn btn-danger" data-due-need style="flex:1">✗ 仍需巩固</button>' +
          '</div>';
      } else {
        bodyExtra += '<button class="btn btn-ghost" data-due-show-ans style="width:100%;margin-top:14px">👁 显示答案与解析</button>';
      }
    }

    const progText = '第 ' + (st.cur + 1) + ' / ' + total + ' 道';
    const answeredCount = st.known.length + st.need.length;
    const pct = total ? Math.round(answeredCount / total * 100) : 0;
    const barHTML = '<div class="dquiz-bar" style="margin:6px 0 10px"><div class="dquiz-bar-fill" style="width:' + pct + '%"></div></div>';

    return '' +
      '<div class="card review-card">' +
        '<div class="card-title"><span class="emoji">🧠</span>今日待复习错题' +
          '<span class="tag tag-mistake" style="margin-left:auto">' + progText + '</span>' +
        '</div>' +
        '<div class="li-meta" style="margin-bottom:6px">已完成 ' + answeredCount + ' / ' + total + ' · 第' + cur.review.round + '轮复习</div>' +
        barHTML +
        '<div class="mistake-card card" style="box-shadow:none">' +
          '<div class="mc-head">' +
            '<span class="mc-tag" style="background:var(--primary-soft);color:var(--primary-deep)">' + meta.icon + ' ' + meta.label + '</span>' +
            (it.category ? '<span class="mc-tag" style="background:#ffe4e9;color:#d9534f">' + U.esc(it.category) + '</span>' : '') +
          '</div>' +
          '<div class="mc-body" style="margin-top:10px">' + stemHtml + bodyExtra + '</div>' +
        '</div>' +
        '<div class="pager" style="margin-top:14px">' +
          '<button class="btn btn-sm btn-ghost" data-due-prev ' + (st.cur === 0 ? 'disabled' : '') + ' style="flex:1">‹ 上一题</button>' +
          '<span class="page-indicator">' + (st.cur + 1) + ' / ' + total + '</span>' +
          '<button class="btn btn-sm btn-ghost" data-due-next ' + (st.cur === total - 1 ? 'disabled' : '') + ' style="flex:1">下一题 ›</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button class="btn btn-sm btn-ghost" data-due-exit style="margin-left:auto">✕ 退出复习</button>' +
        '</div>' +
      '</div>';
  }

  function viewMistake() {
    const items = S.data.mistakes.items;
    const allWeeksList = S.allWeeks();
    // 默认只展示「本周错题汇总」一张卡；更早的自然周收进下方折叠入口，避免页面被多张周卡占满
    const curWeek = currentWeekKey();
    const weeks = allWeeksList.filter(function (w) { return w === curWeek; });
    const historyWeeks = allWeeksList.filter(function (w) { return w !== curWeek; });

    // ===== 若处于重练模式，直接渲染重练界面 =====
    if (mistakeReviewState) return mistakeReviewHTML(items);

    // ===== 若处于今日待复习逐题模式，直接渲染逐题界面 =====
    if (dueReviewState) return dueReviewHTML(items);

    const weekCardHTML = week => {
      const wk = S.mistakesByWeek(week);
      // 周汇总
      const byModule = {};
      wk.forEach(i => { (byModule[i.module] = byModule[i.module] || []).push(i); });
      const modSummary = Object.keys(byModule).map(k => {
        const meta = U.catInfo(k);
        return '<span class="summary-pill">' + meta.icon + ' ' + meta.label + ' ' + byModule[k].length + '题</span>';
      }).join('');

      return '<details class="custom wsum-card">' +
          '<summary>' +
            '<span class="wsum-head">' +
              '<span class="emoji">🗓️</span>' +
              '<span>' + weekName(week) + '错题汇总</span>' +
              '<span class="tag tag-logic">' + wk.length + ' 条</span>' +
              '<span style="font-size:11px;color:var(--ink-3);margin-left:6px">' + U.esc(weekLabel(week)) + '</span>' +
              '<span class="wsum-chevron">▼</span>' +
            '</span>' +
            (modSummary ? '<span class="wsum-pills">' + modSummary + '</span>' : '') +
            '<span class="wsum-block">' +
              '<div class="wsum-block-title">📊 ' + weekName(week) + '情况汇总</div>' +
              '<div class="li-meta" style="margin-bottom:6px">共记录 <b style="color:var(--primary-deep)">' + wk.length + '</b> 道错题</div>' +
              '<div class="li-desc">🔎 <b>薄弱点分析：</b>' + weekWeakness(byModule, weekName(week)) + '</div>' +
              '<div class="li-desc">💪 <b>提升建议：</b>' + weekAdvice(byModule) + '</div>' +
            '</span>' +
          '</summary>' +
          '<div class="wsum-list">' +
            wk.map(it => {
              const meta = U.catInfo(it.module);
              const prog = (S && typeof S.mistakeReviewProgress === 'function') ? S.mistakeReviewProgress(it.id) : null;
              // 复习进度标签
              let progTag = '';
              if (prog && !prog.done) {
                progTag = '<span class="tag tag-mistake" style="margin-right:6px">复习 ' + prog.round + '/' + prog.totalRounds + ' 轮</span>';
              } else if (prog && prog.done) {
                progTag = '<span class="tag tag-success" style="margin-right:6px">✅ 已全部复习</span>';
              }
              // 结构化字段展示（题干/正确答案/我的错误/分析思路/知识点）
              const stemHtml = it.stem
                ? '<div class="mc-q"><b>题干：</b>' + U.esc(it.stem) + '</div>'
                : (it.note ? '<div class="mc-note">' + U.esc(it.note).replace(/\n/g, '<br>') + '</div>' : '');
              const answerHtml = it.answer ? '<div class="mc-line ans">✅ 正确答案：' + U.esc(it.answer) + '</div>' : '';
              const myAnswerHtml = it.myAnswer ? '<div class="mc-line err">❌ 我错选：' + U.esc(it.myAnswer) + '</div>' : '';
              const analysisHtml = it.analysis ? '<div class="mc-line">💡 分析思路：' + U.esc(it.analysis).replace(/\n/g, '<br>') + '</div>' : '';
              const knowledgeHtml = it.knowledge ? '<div class="mc-line">🏷️ 考点：' + U.esc(it.knowledge) + '</div>' : '';
              return '<div class="mistake-card card" style="box-shadow:none;margin-bottom:8px">' +
                '<div class="mc-head">' +
                  '<span class="mc-tag" style="background:var(--primary-soft);color:var(--primary-deep)">' + meta.icon + ' ' + meta.label + '</span>' +
                  (it.category ? '<span class="mc-tag" style="background:#ffe4e9;color:#d9534f">' + U.esc(it.category) + '</span>' : '') +
                  '<span class="mc-date">' + U.fmtDate(it.date) + '</span>' +
                  '<button class="btn btn-sm btn-danger" data-delmist="' + it.id + '" style="padding:3px 8px;font-size:11px">✕</button>' +
                '</div>' +
                '<div class="mc-body" style="margin-top:8px">' +
                  progTag +
                  stemHtml +
                  answerHtml +
                  myAnswerHtml +
                  analysisHtml +
                  knowledgeHtml +
                '</div>' +
                (it.image ? '<div class="mc-img"><img src="' + it.image + '" alt="错题图片"></div>' : '') +
              '</div>';
            }).join('') +
          '</div>' +
        '</details>';
    };

    let blocks = '';
    if (weeks.length) {
      blocks += weekCardHTML(weeks[0]);
    } else {
      blocks += '<div class="card"><div class="li-meta" style="text-align:center;padding:6px 0;color:var(--ink-3)">本周还没有错题记录，继续加油 💪</div></div>';
    }
    if (historyWeeks.length) {
      const histN = historyWeeks.reduce(function (n, w) { return n + S.mistakesByWeek(w).length; }, 0);
      blocks +=
        '<details class="card" style="margin-top:2px">' +
          '<summary style="cursor:pointer;font-size:12px;color:var(--ink-3)">📦 更早错题 ' + histN + ' 条 · 点击展开查看</summary>' +
          '<div style="margin-top:8px">' + historyWeeks.map(w => weekCardHTML(w)).join('') + '</div>' +
        '</details>';
    }

    // ===== 重练错题入口（一键全部 + 按模块专项） =====
    const byModuleAll = {};
    items.forEach(i => { (byModuleAll[i.module] = byModuleAll[i.module] || 0) + 1; byModuleAll[i.module]++; });
    const modKeys = Object.keys(byModuleAll);
    const modChips = modKeys.map(k => {
      const meta = U.catInfo(k);
      return '<button class="btn btn-sm btn-ghost" data-mreview-mod="' + U.esc(k) + '" style="margin:3px 4px 0 0">' + meta.icon + ' ' + meta.label + ' ' + byModuleAll[k] + '</button>';
    }).join('');

    // 今日新增已并入下方「本周错题汇总」中可展开查看，故此处不再单独显示

    return '' +
      (items.length ? '<div class="card">' +
        '<div class="card-title"><span class="emoji">🔁</span>错题重练' +
          '<span class="tag tag-mistake" style="margin-left:auto">共 ' + items.length + ' 道</span>' +
        '</div>' +
        '<div class="section-tip">把错题当题重做一遍：先看题干回忆作答，再显示答案比对，标记"记住了 / 仍需巩固"；需巩固的会自动重新进入艾宾浩斯复习队列。</div>' +
        '<button class="btn btn-primary" data-mreview="shuffle" style="width:100%">🔀 乱序重练全部</button>' +
        '<div class="li-meta" style="margin:6px 0 0;color:var(--ink-3)">共 ' + items.length + ' 道错题；题序会打乱，避免按录入顺序机械记忆。</div>' +
        (modChips ? '<div class="li-meta" style="margin:10px 0 4px;color:var(--ink-3)">按模块专项重练：</div><div>' + modChips + '</div>' : '') +
      '</div>' : '') +
      // ② 新增错题
      '<div class="card">' +
        '<div class="card-title"><span class="emoji">📒</span>新增错题</div>' +
        '<div class="mistake-input-row">' +
          '<button class="btn" data-mi="photo">📷 拍照</button>' +
          '<button class="btn" data-mi="voice">🎤 语音</button>' +
          '<button class="btn" data-mi="text">✏️ 文字</button>' +
        '</div>' +
        '<div class="section-tip">选择所属模块录入，支持拆解题干、正确答案与分析思路；录入后自动按艾宾浩斯曲线安排复习。</div>' +
      '</div>' +
      (blocks || '<div class="empty"><div class="e-icon">📕</div><div class="e-txt">还没有错题记录<br>加油，错题是上岸路上的宝贵财富！</div></div>');
  }

  function currentWeekKey() {
    // 返回当前自然周的 key，形如 "YYYY-MM-DD~YYYY-MM-DD"（周一~周日），与 Store.allWeeks() 口径一致
    const now = new Date();
    const dow = now.getDay() || 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const f = function (d) {
      const mm = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
      const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
      return d.getFullYear() + '-' + mm + '-' + dd;
    };
    return f(monday) + '~' + f(sunday);
  }

  function weekName(week) {
    // week 形如 "YYYY-MM-DD~YYYY-MM-DD"（周一~周日），返回相对称谓：本周/上周/N 周前
    try {
      if (!week || week.indexOf('~') < 0) return '本周';
      const s = week.split('~')[0];
      const monday = new Date(s + 'T00:00:00');
      const now = new Date();
      const dow = now.getDay() || 7;
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1));
      const diff = Math.round((thisMonday - monday) / 86400000);
      if (diff <= 0) return '本周';
      if (diff === 7) return '上周';
      return Math.round(diff / 7) + ' 周前';
    } catch (e) { return '本周'; }
  }

  function weekLabel(week) {
    // week 形如 "YYYY-MM-DD~YYYY-MM-DD",输出可读的 "08/25 周一 ~ 08/31 周日"
    if (!week || week.indexOf('~') < 0) {
      // 兼容旧 weekKey("YYYY-WNN")
      return week || '';
    }
    const [s, e] = week.split('~');
    const dows = ['周日','周一','周二','周三','周四','周五','周六'];
    function fmt(part) {
      const d = new Date(part + 'T00:00:00');
      const mm = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
      const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
      return mm + '/' + dd + ' ' + dows[d.getDay()];
    }
    return fmt(s) + ' ~ ' + fmt(e);
  }

  function weekWeakness(byModule, name) {
    name = name || '本周';
    let maxMod = null, maxN = 0;
    for (const k in byModule) { if (byModule[k].length > maxN) { maxN = byModule[k].length; maxMod = k; } }
    if (!maxMod) return name + '暂无错题';
    return name + '在 <b>' + U.catInfo(maxMod).label + '</b> 板块错题较多（' + maxN + '题），为薄弱环节，建议重点回顾。';
  }
  function weekAdvice(byModule) {
    if (!Object.keys(byModule).length) return '继续保持学习节奏，及时巩固。';
    const keys = Object.keys(byModule);
    return '针对 ' + keys.map(k => U.catInfo(k).label).join('、') + ' 板块，建议：①重做错题，分析错因；②归纳同类题型规律；③限时训练提升速度；④建立知识框架，查漏补缺。';
  }

  function bindMistake() {
    // 事件由全局委托处理 (data-delmist, data-mi)
    // 绑定"已复习"打卡
    document.querySelectorAll('[data-reviewdone]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const rid = el.getAttribute('data-reviewdone');
        if (S && typeof S.markMistakeReviewed === 'function') {
          S.markMistakeReviewed(rid);
        }
        U.toast('✅ 已复习，记忆更牢固！');
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });

    // ===== 今日待复习错题·逐题模式 =====
    // 进入：点击"开始复习"
    document.querySelectorAll('[data-due-start]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = dueReviewList();
        if (!list.length) { U.toast('今日无待复习错题'); return; }
        dueReviewState = { cur: 0, list: list, known: [], need: [], choices: new Array(list.length).fill(null), correct: new Array(list.length).fill(null), answered: false, finished: false };
        global.APP.renderPage('mistake');
      });
    });
    // 选项题：点击选项
    document.querySelectorAll('[data-due-opt]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState) return;
        const st = dueReviewState;
        const cur = st.list[st.cur];
        if (!cur) return;
        // 重复点击：若已作答，忽略
        if (st.choices[st.cur] !== null && st.choices[st.cur] !== undefined) return;
        const idx = parseInt(el.getAttribute('data-due-opt'), 10);
        const it = cur.mis;
        const correct = (typeof it.answerIndex === 'number' && idx === it.answerIndex);
        // 记录作答
        st.choices[st.cur] = idx;
        st.correct[st.cur] = correct;
        // 标记今日已复习
        if (S && typeof S.markMistakeReviewed === 'function') {
          S.markMistakeReviewed(cur.review.id);
        }
        if (correct) {
          st.known.push(cur.mis.id);
          U.toast('🎉 回答正确！');
        } else {
          // 错：重新进入艾宾浩斯队列
          if (S && typeof S.requeueMistakeReview === 'function') {
            S.requeueMistakeReview(cur.mis.id);
          }
          // 再置 lastReviewDate=今天（确保计入"已复习"）
          if (S && typeof S.markMistakeReviewed === 'function') {
            S.markMistakeReviewed(cur.review.id);
          }
          st.need.push(cur.mis.id);
          U.toast('✗ 已加入下次复习');
        }
        // 渲染（显示对错 + 解析）
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
        // 答对自动跳下一题（最后一题时不跳，等用户点下一题/退出）
        if (correct && st.cur < st.list.length - 1) {
          setTimeout(function () {
            if (!dueReviewState) return;
            dueReviewState.cur++;
            global.APP.renderPage('mistake');
          }, 700);
        } else if (correct && st.cur === st.list.length - 1) {
          // 最后一题答对：完成
          setTimeout(function () {
            if (!dueReviewState) return;
            dueReviewState.cur++;
            dueReviewState.finished = true;
            global.APP.renderPage('mistake');
            try { global.APP.updateBadges(); } catch (err) {}
          }, 700);
        }
      });
    });
    // 显示答案（问答题用）
    document.querySelectorAll('[data-due-show-ans]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dueReviewState) dueReviewState.answered = true;
        global.APP.renderPage('mistake');
      });
    });
    // 做对了：标记已复习 + 计入 known + 推进
    document.querySelectorAll('[data-due-known]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState) return;
        const st = dueReviewState;
        const cur = st.list[st.cur];
        if (cur) {
          // 标记今日已复习
          if (S && typeof S.markMistakeReviewed === 'function') {
            S.markMistakeReviewed(cur.review.id);
          }
          st.known.push(cur.mis.id);
          U.toast('✓ 记住了，继续！');
        }
        st.cur++;
        st.answered = false;
        if (st.cur >= st.list.length) st.finished = true;
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
    // 仍需巩固：标记已复习 + 重置学习日期 + 计入 need + 推进
    document.querySelectorAll('[data-due-need]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState) return;
        const st = dueReviewState;
        const cur = st.list[st.cur];
        if (cur) {
          // 先重置该错题的艾宾浩斯队列（重新从今天开始新一轮，清空 lastReviewDate）
          if (S && typeof S.requeueMistakeReview === 'function') {
            S.requeueMistakeReview(cur.mis.id);
          }
          // 再标记今日已复习（requeue 后置 lastReviewDate=今天，确保计入"已复习"）
          // 明天 learnDate=today 距 lastReviewDate=today 为 0 < 1，不会被跳过，明天照常提醒
          if (S && typeof S.markMistakeReviewed === 'function') {
            S.markMistakeReviewed(cur.review.id);
          }
          st.need.push(cur.mis.id);
          U.toast('✗ 已加入下次复习');
        }
        st.cur++;
        st.answered = false;
        if (st.cur >= st.list.length) st.finished = true;
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
    // 上一题
    document.querySelectorAll('[data-due-prev]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState || dueReviewState.cur <= 0) return;
        dueReviewState.cur--;
        dueReviewState.answered = false;
        global.APP.renderPage('mistake');
      });
    });
    // 下一题
    document.querySelectorAll('[data-due-next]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState) return;
        // 允许从最后一题跳到完成页（cur === list.length - 1 时也允许一次）
        const N = dueReviewState.list.length;
        if (dueReviewState.cur >= N) return;
        dueReviewState.cur++;
        dueReviewState.answered = false;
        if (dueReviewState.cur >= N) dueReviewState.finished = true;
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
    // 退出复习（重置状态，返回错题本主页）
    document.querySelectorAll('[data-due-exit]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        dueReviewState = null;
        global.APP.renderPage('mistake');
      });
    });
    // 只练仍需巩固（重新从 need 列表开始）
    document.querySelectorAll('[data-due-repeat="need"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dueReviewState) return;
        const needSet = new Set(dueReviewState.need);
        const all = dueReviewState.list;
        // 重新拉取最新 due 列表（重置后 learnDate 已是今天，下次复习=明天，所以不会出现在 due 中）
        // 这里直接从原列表按 id 过滤 need，构造新序列
        const filtered = all.filter(function (it) { return needSet.has(it.mis.id); });
        if (!filtered.length) { U.toast('无仍需巩固的题目'); return; }
        dueReviewState = { cur: 0, list: filtered, known: [], need: [], choices: new Array(filtered.length).fill(null), correct: new Array(filtered.length).fill(null), answered: false, finished: false };
        global.APP.renderPage('mistake');
      });
    });

    // ===== 错题重练交互 =====
    // 进入重练模式（乱序 shuffle / 专项 mod）
    document.querySelectorAll('[data-mreview="shuffle"], [data-mreview-mod]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = el.hasAttribute('data-mreview') ? el.getAttribute('data-mreview') : null; // 'all' | 'shuffle' | null(专项)
        const isMod = el.hasAttribute('data-mreview-mod');
        // 收集待练题目
        let pool = S.data.mistakes.items;
        if (isMod) { const m = el.getAttribute('data-mreview-mod'); pool = pool.filter(i => i.module === m); }
        // 乱序：打乱 pool 的 id 序列
        let seq = null;
        if (mode === 'shuffle') {
          seq = pool.map(i => i.id);
          for (let i = seq.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = seq[i]; seq[i] = seq[j]; seq[j] = t;
          }
        }
        mistakeReviewState = {
          module: isMod ? el.getAttribute('data-mreview-mod') : null,
          cur: 0, known: [], need: [], answered: false,
          seq: seq,  // null=原始顺序；array=乱序 id 序列
        };
        global.APP.renderPage('mistake');
      });
    });
    // 选择题选项作答（错题重练 · 与每日真题训练一致）
    document.querySelectorAll('[data-mreview-opt]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const st = mistakeReviewState;
        if (!st) return;
        const list = reviewList(S.data.mistakes.items);
        const it = list[st.cur];
        if (!it) return;
        if (!st.optAnswers) st.optAnswers = {};
        if (st.optAnswers[it.id]) return; // 已作答，忽略
        const idx = parseInt(el.getAttribute('data-mreview-opt'), 10);
        const correct = (typeof it.answerIndex === 'number' && idx === it.answerIndex);
        st.optAnswers[it.id] = { choice: idx, correct: correct };
        if (correct) {
          if (st.known.indexOf(it.id) < 0) st.known.push(it.id);
          U.toast('🎉 回答正确！');
        } else {
          if (st.need.indexOf(it.id) < 0) st.need.push(it.id);
          // 答错：重新进入艾宾浩斯复习队列
          if (S && typeof S.requeueMistakeReview === 'function') {
            try { S.requeueMistakeReview(it.id); } catch (err) {}
          }
          U.toast('✗ 已加入下次复习');
        }
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
        // 答对自动跳下一题（最后一题答对 → 进入完成界面）
        if (correct) {
          setTimeout(function () {
            if (!mistakeReviewState) return;
            mistakeReviewState.cur++;
            global.APP.renderPage('mistake');
          }, 700);
        }
      });
    });
    // 选择题答错的「下一题」按钮
    document.querySelectorAll('[data-mreview-next]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mistakeReviewState) return;
        mistakeReviewState.cur++;
        mistakeReviewState.answered = false;
        global.APP.renderPage('mistake');
      });
    });
    // 显示答案
    document.querySelectorAll('[data-mreview-show-ans]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mistakeReviewState) mistakeReviewState.answered = true;
        global.APP.renderPage('mistake');
      });
    });
    // 记住了
    document.querySelectorAll('[data-mreview-known]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mistakeReviewState) return;
        const st = mistakeReviewState;
        const list = reviewList(S.data.mistakes.items);
        const it = list[st.cur];
        if (it) st.known.push(it.id);
        st.cur++;
        st.answered = false;
        U.toast('😊 记住了，继续！');
        global.APP.renderPage('mistake');
      });
    });
    // 仍需巩固（重新进入艾宾浩斯队列）
    document.querySelectorAll('[data-mreview-need]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mistakeReviewState) return;
        const st = mistakeReviewState;
        const list = reviewList(S.data.mistakes.items);
        const it = list[st.cur];
        if (it) {
          st.need.push(it.id);
          if (S && typeof S.requeueMistakeReview === 'function') {
            S.requeueMistakeReview(it.id);
          }
        }
        st.cur++;
        st.answered = false;
        U.toast('🤔 已重新加入复习队列');
        global.APP.renderPage('mistake');
      });
    });
    // 上一题
    document.querySelectorAll('[data-mreview-prev]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mistakeReviewState || mistakeReviewState.cur <= 0) return;
        mistakeReviewState.cur--;
        mistakeReviewState.answered = false;
        global.APP.renderPage('mistake');
      });
    });
    // 只练仍需巩固
    document.querySelectorAll('[data-mreview-repeat="need"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mistakeReviewState) return;
        const needSet = new Set(mistakeReviewState.need);
        // 重新构造仅含需巩固题目的重练序列
        const list = S.data.mistakes.items.filter(it => (needSet.has(it.id)));
        if (!list.length) { U.toast('无仍需巩固的错题'); return; }
        mistakeReviewState.module = null;
        mistakeReviewState.cur = 0;
        mistakeReviewState.known = [];
        mistakeReviewState.need = [];
        mistakeReviewState.answered = false;
        mistakeReviewState.seq = null;
        mistakeReviewState.optAnswers = {}; // 清空选项作答记录，重新作答
        mistakeReviewState.onlyNeed = list.map(i => i.id);
        global.APP.renderPage('mistake');
      });
    });
    // 退出重练
    document.querySelectorAll('[data-mreview-exit]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        mistakeReviewState = null;
        global.APP.renderPage('mistake');
        try { global.APP.updateBadges(); } catch (err) {}
      });
    });
  }

  /* ================================================================
    页面注册表
    ================================================================ */
  global.Views = {
    countdown: { title: '⏳ 省考倒计时', render: viewCountdown, bind: bindCountdown },
    dailyplan: { title: '📋 每日计划', render: viewDailyPlan, bind: bindDailyPlan },
    politics:  { title: '🏛️ 政治理论', render: viewPolitics, bind: bindPolitics },
    common:    { title: '🌏 常识判断', render: viewCommon, bind: bindCommon },
    language:  { title: '💬 言语理解', render: viewLanguage, bind: bindLanguage },
    logic:     { title: '🧩 判断推理', render: viewLogic, bind: bindLogic },
    quantity:  { title: '🔢 数量关系', render: viewQuantity, bind: bindQuantity },
    data:      { title: '📊 资料分析', render: viewData, bind: bindData },
    stats:     { title: '📈 每日统计', render: viewStats, bind: bindStats },
    essay:     { title: '✏️ 申论·小题', render: viewEssay, bind: bindEssay },
    composition:{ title: '🖋️ 申论·大作文', render: viewComposition, bind: bindComposition },
    mistake:   { title: '📒 错题本', render: viewMistake, bind: bindMistake },
  };
})(window);
