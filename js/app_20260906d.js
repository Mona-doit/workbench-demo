/* ============================================================
   app.js — 应用入口 & 路由 & 全局状态
   ============================================================ */
(function (global) {
  'use strict';
  const U = global.Utils;
  const Views = global.Views;

  const APP = {
    current: 'countdown',
    pageEl: document.getElementById('pageContainer'),

    init() {
      // 初始化连接状态
      U.detectOnline();
      U.updateConnUI();

      // 解析 hash 路由
      const hash = location.hash.replace('#', '');
      const target = Views[hash] ? hash : 'countdown';
      this.renderPage(target);

      // 导航事件（hash 变化）
      window.addEventListener('hashchange', () => {
        const h = location.hash.replace('#', '');
        if (Views[h]) this.renderPage(h);
      });

      // 左侧导航点击
      document.getElementById('sidebarNav').addEventListener('click', (e) => {
        const item = e.target.closest('.nav-item');
        if (item) {
          const page = item.getAttribute('data-page');
          if (Views[page]) {
            location.hash = page;
            this.renderPage(page);
          }
        }
      });

      // 底部导航点击
      const bottomNav = document.getElementById('bottomNav');
      bottomNav.addEventListener('click', (e) => {
        const item = e.target.closest('.bn-item');
        if (item) {
          const page = item.getAttribute('data-page');
          if (Views[page]) {
            location.hash = page;
            this.renderPage(page);
          }
        }
      });

      // 菜单按钮（移动端展开侧栏）
      document.getElementById('menuBtn').addEventListener('click', () => {
        toggleSidebar();
      });
      document.getElementById('sidebar').addEventListener('click', (e) => {
        // 点击导航项后收起（移动端）
        if (e.target.closest('.nav-item') && window.innerWidth <= 760) {
          toggleSidebar(false);
        }
      });

      // 记录首次使用
      if (!localStorage.getItem(Store.PREFIX + 'inited')) {
        localStorage.setItem(Store.PREFIX + 'inited', '1');
      }
    },

    renderPage(key) {
      const view = Views[key];
      if (!view) return;
      this.current = key;
      // 路由切换时同步应用主题（防御：若 start() 时序异常或主题被外部重置）
      try { applyTheme(Store.getThemeMode ? Store.getThemeMode() : 'day'); } catch (e) {}

      // 更新标题
      document.getElementById('topbarTitle').textContent = view.title.replace(/^[^\s]+\s/, '');

      // 渲染
      this.pageEl.innerHTML = '<div class="page active-page" data-page="' + key + '"></div>';
      const page = this.pageEl.querySelector('.page');
      page.__key = key;
      try {
        page.innerHTML = view.render();
      } catch (err) {
        // 渲染异常时避免整页白屏，显示友好提示
        console.error('渲染页面出错:', key, err);
        page.innerHTML =
          '<div class="empty" style="padding:30px;text-align:center">' +
            '<div class="e-icon" style="font-size:40px">😵</div>' +
            '<div class="e-txt">页面渲染出了一点小问题，请刷新重试</div>' +
            '<div class="li-meta" style="margin-top:6px;color:var(--ink-3)">' + U.esc(String(err && err.message || err)) + '</div>' +
            '<button class="btn btn-soft" style="margin-top:16px" data-reloadpage>🔄 重新加载</button>' +
          '</div>';
      }

      // 激活导航
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.getAttribute('data-page') === key));
      document.querySelectorAll('.bn-item').forEach(n => n.classList.toggle('active', n.getAttribute('data-page') === key));

      // 滚动到顶部
      this.pageEl.scrollTop = 0;

      // 绑定事件
      if (view.bind) view.bind();

      // 补打卡按钮：元素级直接绑定（双保险，避免任何委托被吞导致“点了没反应”）
      try {
        this.pageEl.querySelectorAll('[data-makeup]').forEach(function (btn) {
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            U.openMakeupSheet(btn.getAttribute('data-makeup'));
          });
        });
      } catch (e) {}

      // 清理：防止重复事件
      this.cleanupDelegated();

      // 更新未复习提醒角标
      try { this.updateBadges(); } catch (e) {}

      // 绑定每日计划区
      if (this.pageEl.querySelector('[data-modplan]')) {
        // 已由各模块 bind 处理
      }
    },

    // 更新导航上的未复习提醒角标
    updateBadges() {
      try {
        let cnt = 0;
        if (typeof Store.mistakeReviewsDueOn === 'function') {
          cnt += Store.mistakeReviewsDueOn(U.todayStr()).length;
        }
        if (typeof Store.memoryReviewsDueOn === 'function') {
          cnt += Store.memoryReviewsDueOn(U.todayStr()).length;
        }
        document.querySelectorAll('[data-navbadge]').forEach(el => {
          if (cnt > 0) {
            el.style.display = 'inline-flex';
            el.textContent = cnt > 99 ? '99+' : cnt;
          } else {
            el.style.display = 'none';
            el.textContent = '';
          }
        });
      } catch (e) {}
    },

    // 清理 document 上可能残留的事件监听（避免重复绑定）
    _handlers: [],
    addDelegated(fn) {
      this._handlers.push(fn);
    },
    cleanupDelegated() {
      // 使用一次性委托：简单方式 —— 绑定在 document 上的监听通过标记避免重复
    },
  };

  // 侧栏开关（移动端）
  function toggleSidebar(force) {
    const sb = document.getElementById('sidebar');
    const show = force !== undefined ? force : sb.classList.contains('show') ? false : true;
    // 移动端用覆盖方式
    if (show) {
      sb.style.display = 'flex';
      sb.style.position = 'fixed';
      sb.style.left = '0';
      sb.style.top = '0';
      sb.style.zIndex = '50';
      sb.style.boxShadow = '0 0 30px rgba(0,0,0,0.2)';
    } else {
      if (window.innerWidth <= 760) {
        sb.style.display = 'none';
        sb.style.position = '';
      }
    }
  }

  // 处理 document 级委托事件（避免每次 render 重复 addEventListener）
  function setupGlobalDelegated() {
    if (window.__delegatedReady) return;
    window.__delegatedReady = true;

    document.addEventListener('click', function (e) {
      // ===== 数据互通（导出/导入）入口 =====
      const opensync = e.target.closest('[data-opensync]');
      if (opensync) { U.openSyncSheet(); return; }

      // ===== 主题切换（底部导航）入口 =====
      const themeNav = e.target.closest('[data-theme-nav]');
      if (themeNav) { openThemeSheet(); return; }

      // ===== 跳转到模块页（每日计划页未完成待办点击跳转） =====
      const goto = e.target.closest('[data-goto]');
      if (goto) {
        const target = goto.getAttribute('data-goto');
        const pageMap = {
          politics: 'politics', common: 'common', language: 'language',
          logic: 'logic', quantity: 'quantity', data: 'data',
          essay: 'essay', composition: 'composition',
        };
        const page = pageMap[target];
        if (page && Views[page]) {
          location.hash = page;
          global.APP.renderPage(page);
          U.toast('🚀 前往 ' + (U.catInfo(target).label || target) + ' 模块');
        }
        return;
      }

      // ===== 每日计划（通用卡片中）添加按钮 =====
      const addPlan = e.target.closest('[data-act="add-plan"]');
      if (addPlan) { const c = addPlan.getAttribute('data-cat'); U.openAddPlanSheet(c); return; }

      // ===== 模块打卡勾选 =====
      const mt = e.target.closest('[data-mt]');
      if (mt) {
        const mcat = mt.getAttribute('data-mt');
        const mtitle = mt.getAttribute('data-mtt');
        const mItems = Store.moduleDoneToday(mcat);
        const m = mItems.find(i => i.title === mtitle);
        if (m && m.checked) Store.unmarkModuleDone(mcat, mtitle);
        else Store.markModuleDone(mcat, mtitle);
        U.toast('✅ 打卡已更新');
        global.APP.renderPage(global.APP.current);
        return;
      }

      // ===== 模块待办勾选 =====
      const rtodo = e.target.closest('[data-rtodo]');
      if (rtodo) {
        const key = rtodo.getAttribute('data-rtodo');
        const on = localStorage.getItem(Store.PREFIX + key) === '1';
        localStorage.setItem(Store.PREFIX + key, on ? '0' : '1');
        // 同步模块打卡记录（让"每日学习进度"联动更新）
        const mcat = rtodo.getAttribute('data-cat');
        const mtitle = rtodo.getAttribute('data-title');
        if (mcat && mtitle && typeof Store.markModuleDone === 'function') {
          try {
            if (on) Store.unmarkModuleDone(mcat, mtitle);
            else Store.markModuleDone(mcat, mtitle);
          } catch (e) { /* 静默：模块打卡同步失败不影响待办状态 */ }
        }
        U.toast(on ? '↩️ 已恢复待办' : '✅ 待办完成，继续加油！');
        global.APP.renderPage(global.APP.current);
        return;
      }
      // ===== 模块页今日待办：修改标题（保存后全站同步） =====
      const editmt = e.target.closest('[data-editmtodo]');
      if (editmt) {
        const parts = (editmt.getAttribute('data-editmtodo') || '').split(':');
        if (parts.length === 2 && typeof U.openEditModuleTodoSheet === 'function') {
          U.openEditModuleTodoSheet(parts[0], parseInt(parts[1], 10));
        }
        return;
      }
      // ===== 模块页今日待办：删除（全站同步移除） =====
      const delmt = e.target.closest('[data-delmtodo]');
      if (delmt) {
        const parts = (delmt.getAttribute('data-delmtodo') || '').split(':');
        if (parts.length === 2 && typeof U.openDeleteModuleTodoConfirm === 'function') {
          U.openDeleteModuleTodoConfirm(parts[0], parseInt(parts[1], 10));
        }
        return;
      }

      // ===== 每日计划页：添加/勾选/删除 =====
      const addpl = e.target.closest('[data-addpl]');
      if (addpl) { U.openAddPlanSheet('political'); return; }
      const clearpl = e.target.closest('[data-clearpl]');
      if (clearpl) {
        const doClear = () => {
          Store.clearPlanToday();
          if (U.seedTodayFromPlans) U.seedTodayFromPlans();
          U.toast('已清空并重新生成今日目标');
          global.APP.renderPage(global.APP.current || 'dailyplan');
        };
        if (typeof U.openConfirm === 'function') {
          U.openConfirm('确定清空今日所有目标吗？清空后会自动重新生成课程规划任务（干净数据）。', doClear);
        } else if (window.confirm('确定清空今日所有目标吗？清空后会自动重新生成课程规划任务。')) {
          doClear();
        }
        return;
      }
      const ck = e.target.closest('[data-plan]');
      if (ck) {
        Store.togglePlanItem(ck.getAttribute('data-plan'));
        U.toast('✅ 已更新');
        // 刷新当前所在页（每日计划页或任意模块页），保持停留位置并同步数据
        global.APP.renderPage(global.APP.current || 'dailyplan');
        return;
      }
      const editp = e.target.closest('[data-editplan]');
      if (editp) {
        U.openEditPlanSheet(editp.getAttribute('data-editplan'));
        return;
      }
      const delp = e.target.closest('[data-delplan]');
      if (delp) {
        Store.removePlanItem(delp.getAttribute('data-delplan'));
        U.toast('🗑️ 已删除');
        // 刷新当前所在页（每日计划页或任意模块页），保持停留位置并同步数据
        global.APP.renderPage(global.APP.current || 'dailyplan');
        return;
      }
      // 整行勾选兜底：点标签/文字/空白都切状态（编辑/删除按钮已先被上面分支拦截）
      const row = e.target.closest('[data-plan-row]');
      if (row) {
        Store.togglePlanItem(row.getAttribute('data-plan-row'));
        U.toast('✅ 已更新');
        global.APP.renderPage(global.APP.current || 'dailyplan');
        return;
      }

      // ===== 智能课程规划：打开弹窗 / 删除 / 修改 / 移动顺序 =====
      const smart = e.target.closest('[data-smartplan]');
      if (smart) { U.openSmartPlanSheet(); return; }
      const exportPlan = e.target.closest('[data-exportplan]');
      if (exportPlan) { U.exportPlanDiagnosis(); return; }
      const makeup = e.target.closest('[data-makeup]');
      if (makeup) { U.openMakeupSheet(makeup.getAttribute('data-makeup')); return; }
      const editc = e.target.closest('[data-editplan-c]');
      if (editc) {
        const pid = editc.getAttribute('data-editplan-c');
        const plan = (Store.getPlans() || []).find(p => p.id === pid);
        if (plan) { U.openEditCourseSheet(plan); return; }
        U.toast('未找到该课程'); return;
      }
      const delc = e.target.closest('[data-delplan-c]');
      if (delc) {
        Store.removePlan(delc.getAttribute('data-delplan-c'));
        U.toast('🗑️ 已删除课程规划');
        global.APP.renderPage('dailyplan');
        return;
      }
      // ===== 渲染失败后的重新加载按钮 =====
      const reloadP = e.target.closest('[data-reloadpage]');
      if (reloadP) { global.APP.renderPage(global.APP.current); U.toast('已重新加载'); return; }

      // ===== 倒计时页：添加/删除考试 =====
      const addExam = e.target.closest('[data-add-exam]');
      if (addExam) {
        U.openSheet(
          '<div class="field"><label>考试名称</label><input class="input" id="neName" placeholder="如：国考、事业单位"></div>' +
          '<div class="field"><label>考试日期</label><input class="input" type="date" id="neDate"></div>' +
          '<button class="btn btn-block" id="neOk">保存</button>', '添加考试'
        );
        document.getElementById('neOk').addEventListener('click', () => {
          const name = document.getElementById('neName').value.trim();
          const date = document.getElementById('neDate').value;
          if (!name) { U.toast('请输入考试名称'); return; }
          Store.addExam(name, date);
          U.closeSheet(); U.toast('✅ 已添加');
          global.APP.renderPage('countdown');
        });
        return;
      }
      const delExam = e.target.closest('[data-del-exam]');
      if (delExam) {
        Store.removeExam(delExam.getAttribute('data-del-exam'));
        U.toast('🗑️ 已删除');
        global.APP.renderPage('countdown');
        return;
      }

      // ===== 错题本：删除/新增 =====
      const delmist = e.target.closest('[data-delmist]');
      if (delmist) {
        Store.removeMistake(delmist.getAttribute('data-delmist'));
        U.toast('🗑️ 已删除');
        global.APP.renderPage('mistake');
        return;
      }
      const mi = e.target.closest('[data-mi]');
      if (mi) {
        const mode = mi.getAttribute('data-mi');
        Views['mistake'].openInput ? Views['mistake'].openInput(mode) : openMistakeInput(mode);
        return;
      }
    });
  }

  // 错题输入入口（全局）
  function openMistakeInput(mode) {
    if (mode === 'photo') {
      let fi = document.getElementById('mistFileInput');
      if (!fi) {
        fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*'; fi.id = 'mistFileInput'; fi.style.display = 'none';
        document.body.appendChild(fi);
        fi.addEventListener('change', (e) => {
          const f = e.target.files[0]; if (!f) return;
          const reader = new FileReader();
          reader.onload = () => compressImage(reader.result, (dataUrl) => { window.__mistImage = dataUrl; openMistakeEditor('photo', dataUrl); });
          reader.readAsDataURL(f);
          e.target.value = '';
        });
      }
      fi.click();
    } else if (mode === 'voice') {
      openVoiceSheetGlobal();
    } else {
      openMistakeEditor('text', '');
    }
  }

  function compressImage(dataUrl, cb) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 800; let w = img.width, h = img.height;
      if (w > maxW) { h = h * maxW / w; w = maxW; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => cb(dataUrl);
    img.src = dataUrl;
  }

  function openVoiceSheetGlobal() {
    const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SpeechRecognition) { U.toast('⚠️ 当前浏览器不支持语音识别'); openMistakeEditor('text', ''); return; }
    U.openSheet(
      '<div style="text-align:center;padding:10px">' +
        '<div style="font-size:44px" id="voiceIcon">🎤</div>' +
        '<div style="font-size:15px;font-weight:700;margin:10px 0">点击开始录音</div>' +
        '<div style="font-size:12px;color:var(--ink-3);margin-bottom:14px">说话即可转成文字（支持普通话）</div>' +
        '<div class="analysis" style="display:none;min-height:60px" id="voiceResult"></div>' +
        '<button class="btn btn-block" id="voiceBtn">🎤 开始</button>' +
        '<button class="btn btn-block btn-ghost" id="voiceCancel" style="margin-top:8px">取消</button>' +
      '</div>', '语音转文字'
    );
    let rec = null; let finalText = '';
    document.getElementById('voiceBtn').addEventListener('click', () => {
      if (rec && rec.state === 'listening') { rec.stop(); return; }
      rec = new SpeechRecognition();
      rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
      const resEl = document.getElementById('voiceResult');
      const iconEl = document.getElementById('voiceIcon');
      const btnEl = document.getElementById('voiceBtn');
      resEl.style.display = 'block'; resEl.innerHTML = '🟢 正在聆听……';
      iconEl.innerHTML = '🔴'; btnEl.textContent = '⏹ 完成';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        resEl.innerHTML = U.esc(finalText + interim) || '🟢 正在聆听……';
      };
      rec.onerror = (e) => { U.toast('⚠️ 语音识别出错：' + (e.error || '')); };
      rec.onend = () => {
        if (!finalText) { U.toast('未识别到内容'); U.closeSheet(); return; }
        iconEl.innerHTML = '✅'; btnEl.textContent = '🎤 再录一次';
        U.closeSheet(); openMistakeEditor('text', finalText);
      };
      rec.start();
    });
    document.getElementById('voiceCancel').addEventListener('click', () => { if (rec) { try { rec.stop(); } catch(e){} } U.closeSheet(); });
  }

  // 错题本可选的模块分类（与各模块页对应，映射到 CAT_META 显示）
  const MISTAKE_MODULES = [
    { key: 'politics', label: '政治理论' },
    { key: 'common',   label: '常识判断' },
    { key: 'language', label: '言语理解' },
    { key: 'logic',    label: '判断推理' },
    { key: 'quantity', label: '数量关系' },
    { key: 'data',     label: '资料分析' },
    { key: 'essay',    label: '申论小题' },
    { key: 'composition', label: '申论大作文' },
  ];

  function openMistakeEditor(mode, preText) {
    // 模块分类下拉选项
    const moduleOptions = MISTAKE_MODULES.map(m =>
      '<option value="' + m.key + '">' + U.catInfo(m.key).icon + ' ' + m.label + '</option>'
    ).join('');
    const sheetBody =
      '<div class="field"><label>所属模块</label>' +
        '<select class="input" id="meModule">' + moduleOptions + '</select></div>' +
      '<div class="field"><label>题干</label>' +
        '<textarea class="textarea" id="meStem" style="min-height:70px" placeholder="输入题目内容/题干">' + U.esc(preText || '') + '</textarea></div>' +
      '<div class="field"><label>正确答案</label>' +
        '<input class="input" id="meAnswer" placeholder="如：A / 具体答案要点"></div>' +
      '<div class="field"><label>我选错的（可选）</label>' +
        '<input class="input" id="meMyAnswer" placeholder="我的错误选项或答案"></div>' +
      '<div class="field"><label>分析思路（拆解）</label>' +
        '<textarea class="textarea" id="meAnalysis" style="min-height:80px" placeholder="逐条拆解：①题干要点 ②答题思路 ③易错点……"></textarea></div>' +
      '<div class="field"><label>知识点/考点（可选）</label>' +
        '<input class="input" id="meKnowledge" placeholder="如：增长率公式 / 递进关联词"></div>' +
      (mode === 'photo' && window.__mistImage ? '<div class="mc-img" style="margin-bottom:10px"><img src="' + window.__mistImage + '" alt="预览"></div>' : '') +
      '<button class="btn btn-block" id="meSave">💾 保存错题</button>';
    U.openSheet(sheetBody, mode === 'photo' ? '📷 拍照错题' : '✏️ 记录错题');
    if (mode === 'photo' && preText) window.__mistImage = preText;
    document.getElementById('meSave').addEventListener('click', () => {
      const module = document.getElementById('meModule').value;
      const stem = document.getElementById('meStem').value.trim();
      const answer = document.getElementById('meAnswer').value.trim();
      const myAnswer = document.getElementById('meMyAnswer').value.trim();
      const analysis = document.getElementById('meAnalysis').value.trim();
      const knowledge = document.getElementById('meKnowledge').value.trim();
      if (!stem && !window.__mistImage) { U.toast('请输入题干或添加图片'); return; }
      // 兼容旧版单字段 note：拼接为可读文本，便于旧版错题本/搜索显示
      const noteParts = [];
      if (stem) noteParts.push(stem);
      if (answer) noteParts.push('正确答案：' + answer);
      if (myAnswer) noteParts.push('我错选：' + myAnswer);
      if (analysis) noteParts.push('分析思路：' + analysis);
      if (knowledge) noteParts.push('考点：' + knowledge);
      Store.addMistake({
        module, category: MISTAKE_MODULES.find(m => m.key === module)?.label || '',
        note: noteParts.join('\n'),
        stem, answer, myAnswer, analysis, knowledge,
        image: mode === 'photo' ? (window.__mistImage || '') : '',
      });
      window.__mistImage = '';
      U.closeSheet(); U.toast('✅ 错题已保存，已自动加入复习计划');
      global.APP.renderPage('mistake');
      try { global.APP.updateBadges(); } catch (e) {}
    });
  }

  global.APP = APP;

  /* ============================================================
     第13项 · 主题切换（莫兰迪日间 / 夜间 / 护眼）
     日间模式下还提供 8 套莫兰迪色板（data-day-palette）供切换
     ============================================================ */
  const THEME_META = {
    day:   { label: '日间', icon: '☀️', desc: '莫兰迪 · 柔和' },
    night: { label: '夜间', icon: '🌙', desc: '深色 · 护眼' },
    eye:   { label: '护眼', icon: '👁️', desc: '米黄 · 低蓝光' },
  };
  // 日间莫兰迪色板元数据（id 顺序与 Store.DAY_PALETTES 一致；
  // swatch 为预览主色，name 为色板中文名）
  const DAY_PALETTE_META = [
    { id: 'mist',  name: '雾霾蓝', swatch: '#a8c0c8' },
    { id: 'sage',  name: '烟青绿', swatch: '#a8bfb3' },
    { id: 'rose',  name: '樱粉',   swatch: '#c9a8b0' },
    { id: 'oat',   name: '燕麦黄', swatch: '#c8b89a' },
    { id: 'mauve', name: '雾紫',   swatch: '#b0a8c0' },
    { id: 'latte', name: '浅茶',   swatch: '#b8a89a' },
    { id: 'moss',  name: '豆沙绿', swatch: '#a8b8a3' },
    { id: 'blend', name: '灰玫',   swatch: '#c0a8b0' },
  ];
  // 应用主题到 <html data-theme> + data-day-palette 与浏览器 meta theme-color
  function applyTheme(mode) {
    const m = ['day', 'night', 'eye'].includes(mode) ? mode : 'day';
    document.documentElement.setAttribute('data-theme', m);
    // 日间模式下同步 data-day-palette（控制 8 套色板），其他模式清除
    try {
      if (m === 'day') {
        const p = (Store && typeof Store.getDayPalette === 'function') ? Store.getDayPalette() : 'mist';
        document.documentElement.setAttribute('data-day-palette', p);
      } else {
        document.documentElement.removeAttribute('data-day-palette');
      }
    } catch (e) {}
    // 同步浏览器地址栏/状态栏主题色（取日间色板主色/夜间/护眼）
    try {
      const palette = (m === 'day')
        ? ((DAY_PALETTE_META.find(p => p.id === document.documentElement.getAttribute('data-day-palette')) || DAY_PALETTE_META[0]).swatch)
        : (m === 'night' ? '#171b20' : '#c0ac87');
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', palette);
    } catch (e) {}
    return m;
  }
  // 打开主题选择面板（底部弹窗）。日间模式下展开 8 套色板选择
  function openThemeSheet() {
    const cur = Store.getThemeMode ? Store.getThemeMode() : 'day';
    const curPalette = (Store && typeof Store.getDayPalette === 'function') ? Store.getDayPalette() : 'mist';
    // 顶部 3 个主模式卡片
    const cards = Object.keys(THEME_META).map(k => {
      const t = THEME_META[k];
      return '<div class="theme-mode-card' + (k === cur ? ' on' : '') + '" data-theme-opt="' + k + '">' +
        '<div class="tmc-ic">' + t.icon + '</div>' +
        '<div class="tmc-name">' + t.label + '</div>' +
        '<div class="tmc-desc">' + t.desc + '</div>' +
      '</div>';
    }).join('');
    // 日间色板区（仅在当前为 day 时显示，方便用户调色调）
    const paletteActive = (cur === 'day');
    const paletteRow = DAY_PALETTE_META.map(p => {
      return '<div class="theme-palette-dot' + (p.id === curPalette ? ' on' : '') + '"' +
        ' data-day-palette-opt="' + p.id + '"' +
        ' title="' + p.name + '"' +
        ' style="--swatch:' + p.swatch + '">' +
        '<span class="tpd-color"></span>' +
        '<span class="tpd-name">' + p.name + '</span>' +
      '</div>';
    }).join('');
    const paletteHTML =
      '<div class="theme-palette-section' + (paletteActive ? '' : ' is-hidden') + '" data-palette-section>' +
        '<div class="tps-title">日间莫兰迪色板</div>' +
        '<div class="theme-palette-row">' + paletteRow + '</div>' +
      '</div>';
    const html =
      '<div class="theme-sheet">' +
        '<div class="theme-sheet-title">选择主题模式</div>' +
        '<div class="theme-sheet-row">' + cards + '</div>' +
        paletteHTML +
      '</div>';
    U.openSheet(html);
    // 绑定主模式点选
    document.querySelectorAll('[data-theme-opt]').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-theme-opt');
        if (Store.setThemeMode) Store.setThemeMode(mode);
        applyTheme(mode);
        document.querySelectorAll('[data-theme-opt]').forEach(c => c.classList.toggle('on', c === card));
        // 切换到夜间/护眼时，色板区隐藏；切回日间时显示
        const sec = document.querySelector('[data-palette-section]');
        if (sec) {
          if (mode === 'day') sec.classList.remove('is-hidden');
          else sec.classList.add('is-hidden');
        }
        U.toast('🎨 已切换为「' + THEME_META[mode].label + '」主题');
        try { global.APP.updateThemeNav(); } catch (e) {}
        // 日间模式下用户可能继续点选色板，延迟关闭
        if (mode !== 'day') setTimeout(() => { U.closeSheet(); }, 350);
      });
    });
    // 绑定色板点选（日间模式下生效）
    document.querySelectorAll('[data-day-palette-opt]').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation(); // 避免触发外层模式卡片事件
        if (cur !== 'day') return; // 非日间模式不允许切换色板（视觉无意义）
        const pid = dot.getAttribute('data-day-palette-opt');
        if (Store && typeof Store.setDayPalette === 'function') Store.setDayPalette(pid);
        // 立即应用色板（无需关闭弹窗）
        const html2 = document.documentElement;
        html2.setAttribute('data-day-palette', pid);
        // 同步状态栏主色
        try {
          const meta = document.querySelector('meta[name="theme-color"]');
          if (meta) {
            const swatch = (DAY_PALETTE_META.find(p => p.id === pid) || {}).swatch || '#a8c0c8';
            meta.setAttribute('content', swatch);
          }
        } catch (e) {}
        // 高亮切换
        document.querySelectorAll('[data-day-palette-opt]').forEach(d => d.classList.toggle('on', d === dot));
        const name = (DAY_PALETTE_META.find(p => p.id === pid) || {}).name || pid;
        U.toast('🎨 已切换「' + name + '」色板');
      });
    });
  }
  // 更新导航栏主题按钮的图标与状态
  function updateThemeNav() {
    const m = Store.getThemeMode ? Store.getThemeMode() : 'day';
    const t = THEME_META[m] || THEME_META.day;
    // 移动端底部导航
    const navBtn = document.getElementById('themeNavBtn');
    if (navBtn) {
      const ic = navBtn.querySelector('.bn-icon');
      if (ic) ic.textContent = t.icon;
      const lb = navBtn.querySelector('.bn-label');
      if (lb) lb.textContent = t.label;
    }
    // 桌面侧栏
    const sIcon = document.getElementById('sidebarThemeIcon');
    if (sIcon) sIcon.textContent = t.icon;
    const sLabel = document.getElementById('sidebarThemeLabel');
    if (sLabel) sLabel.textContent = t.label;
  }

  // 启动
  function start() {
    // 应用已保存的主题（在任何渲染之前，避免闪烁）
    try { applyTheme(Store.getThemeMode ? Store.getThemeMode() : 'day'); } catch (e) {}
    try { updateThemeNav(); } catch (e) {}
    if (location.search.indexOf('demo=1') !== -1) {
      try { seedDemoData(); } catch(e) { console.warn('seed failed', e); }
    }
    // 可选：?debug=1 时显示错误覆盖层（仅用于开发/调试）
    if (location.search.indexOf('debug=1') !== -1) {
      window.addEventListener('error', e => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff5252;color:#fff;font-size:11px;padding:6px;z-index:99999;white-space:pre-wrap;font-family:monospace';
        d.textContent = '❌ ' + (e.error?.message || e.message);
        document.body && document.body.appendChild(d);
      });
    }
    Store.reload();
    // 一次性迁移：清除旧 modtodo_* 覆盖，使最新默认待办文案对未来每天生效
    if (U && typeof U.migrateModuleTodosV2 === 'function') {
      try { U.migrateModuleTodosV2(); } catch(e) { console.warn('migrateModuleTodosV2 failed', e); }
    }
    // 一次性迁移：清理 stats 中同一模块同一天的重复 records（防刷新重复 addStat）
    if (U && typeof U.migrateStatsDedup === 'function') {
      try { U.migrateStatsDedup(); } catch(e) { console.warn('migrateStatsDedup failed', e); }
    }
    // 数据完整性：展示启动自检结果（损坏隔离 / schema 修复），帮助用户感知并定位问题
    try {
      const chk = Store.startupCheck || { isolated: [], issues: [] };
      if ((chk.isolated && chk.isolated.length) || (chk.issues && chk.issues.length)) {
        const nIso = (chk.isolated || []).length;
        const nFix = (chk.issues || []).length;
        const lines = [];
        if (nIso) lines.push('已隔离 ' + nIso + ' 份损坏数据（备份在系统内，可忽略）');
        if (nFix) lines.push('已自动修复 ' + nFix + ' 处异常数据');
        console.warn('[数据自检]', chk);
        setTimeout(function () {
          if (typeof U.toast === 'function') {
            U.toast('🩺 已自动修复 ' + (nFix) + ' 处异常数据' + (nIso ? '，隔离 ' + nIso + ' 份损坏数据' : ''));
          }
        }, 1200);
      }
    } catch (e) { console.warn('startup check notify failed', e); }
    setupGlobalDelegated();
    // 自动生成今日课程规划任务（若有处于规划期的课程）—— 包裹 try-catch 防止启动失败
    if (U && U.seedTodayFromPlans) {
      try { U.seedTodayFromPlans(); } catch(e) { console.warn('seedTodayFromPlans failed', e); }
    }
    try { APP.init(); } catch(e) { console.error('APP.init failed', e); }
    // 启动后更新一次未复习提醒角标
    try { APP.updateBadges(); } catch (e) {}
    // 离线可用：注册 Service Worker（失败静默降级，不影响正常使用）
    registerServiceWorker();
  }

  // 注册 Service Worker 实现离线缓存。SW 脚本采用运行时缓存策略，
  // 不随资源版本戳变化，故 SW 自身版本仅在逻辑调整时更新。
  const SW_VER = '6cc64009';
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const doReg = () => {
      navigator.serviceWorker.register('sw.js?v=' + SW_VER)
        .then((reg) => {
          console.info('[SW] 离线缓存已启用', reg.scope);
          // 后台静默更新：新版本 SW 安装后自动接管
          if (reg && reg.update) { try { reg.update(); } catch (e) {} }
        })
        .catch((e) => console.warn('[SW] 注册失败（已降级为普通加载）', e));
    };
    if (document.readyState === 'complete') doReg();
    else window.addEventListener('load', doReg);
  }
  document.addEventListener('DOMContentLoaded', start);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 0);
  }

  // 注入演示数据（仅 ?demo=1 时调用，便于预览）
  function seedDemoData() {
    const today = new Date();
    const pad = n => n < 10 ? '0'+n : ''+n;
    const date = today.getFullYear()+'-'+pad(today.getMonth()+1)+'-'+pad(today.getDate());
    localStorage.setItem('shangan_settings', JSON.stringify({examDate: '2027-03-13', examName: '福建省考', connected: true}));
    localStorage.setItem('shangan_planToday', JSON.stringify({
      date: date,
      items: [
        {id:'p1', category:'political', title:'学习时政热点', done:true, ts:Date.now()-10000},
        {id:'p2', category:'language',  title:'言语理解 20 题', done:true, ts:Date.now()-8000},
        {id:'p3', category:'logic',     title:'逻辑真题 15 题', done:false, ts:Date.now()-6000},
        {id:'p4', category:'data',      title:'资料分析 20 题', done:false, ts:Date.now()-4000},
        {id:'p5', category:'common',    title:'常识速记 20 条', done:true, ts:Date.now()-2000},
      ]
    }));
    const mods = {};
    [
      ['political', [{date, title:'学习时政热点', ts:Date.now()-10000, checked:true}]],
      ['language',  [{date, title:'言语理解 20 题', ts:Date.now()-8000, checked:true}]],
      ['logic',     [{date, title:'逻辑真题 15 题', ts:Date.now()-6000, checked:false}]],
      ['data',      [{date, title:'资料分析 20 题', ts:Date.now()-4000, checked:false}]],
      ['common',    [{date, title:'常识速记 20 条', ts:Date.now()-2000, checked:true}]],
      ['quantity', []], ['essay', []], ['composition', []]
    ].forEach(p => { mods[p[0]] = { done: p[1], lastDate: date }; });
    localStorage.setItem('shangan_modules', JSON.stringify(mods));
    localStorage.setItem('shangan_stats', JSON.stringify({ records: [
      {id:'s1', date, module:'language',  count:20, durationMin:35, correct:16, total:20, ts:Date.now()-3600000},
      {id:'s2', date, module:'logic',     count:15, durationMin:28, correct:11, total:15, ts:Date.now()-7200000},
      {id:'s3', date, module:'data',      count:20, durationMin:45, correct:18, total:20, ts:Date.now()-10800000},
      {id:'s4', date, module:'common',    count:20, durationMin:15, correct:17, total:20, ts:Date.now()-14400000},
      {id:'s5', date, module:'quantity',  count:10, durationMin:25, correct:6,  total:10, ts:Date.now()-18000000},
      {id:'s6', date, module:'politics',  count:10, durationMin:12, correct:9,  total:10, ts:Date.now()-21600000},
    ]}));
    function weekKey() {
      const d = new Date(); const y = d.getFullYear();
      const day = Math.floor((d - new Date(y,0,1))/86400000);
      return y+'-W'+String(Math.floor(day/7)+1).padStart(2,'0');
    }
    const week = weekKey();
    localStorage.setItem('shangan_mistakes', JSON.stringify({ items: [
      {id:'m1', date, week, module:'行测', category:'言语理解', note:'下列各句中，加点的成语使用恰当的一项是：\n正确答案：A"日新月异"与"与时俱进"搭配恰当。\n我的错误：选了B。', image:'', voiceText:'', ts:Date.now()-1000},
      {id:'m2', date, week, module:'行测', category:'数量关系', note:'工程问题：甲单独8天，乙单独12天，合作几天？\n正解：4.8天。\n易错：通分错误。', image:'', voiceText:'', ts:Date.now()-2000},
      {id:'m3', date, week, module:'申论', category:'提出对策', note:'针对社区垃圾分类推进缓慢：①加强宣传；②完善设施；③健全激励；④强化监督。', image:'', voiceText:'', ts:Date.now()-3000},
    ]}));
    localStorage.setItem('shangan_exams', JSON.stringify([
      {id:'fj2025', name:'福建省考', date:'2027-03-13', icon:'🎯'},
      {id:'gk2025',  name:'国考',     date:'2026-11-30', icon:'🇨🇳'},
    ]));
  }
})(window);
