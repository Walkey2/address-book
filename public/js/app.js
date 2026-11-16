/* =========================================================
   通讯录 · 前端逻辑（原生 JS，无构建依赖）
   状态机：empty（未选中） → view（查看） → edit（编辑） / new（新建）
   ========================================================= */

(function () {
  'use strict';

  /* ------------------------------ 工具 ------------------------------ */

  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  /** 根据姓名生成稳定的头像配色 */
  function avatarStyle(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    const hue = hash;
    return `background:linear-gradient(140deg,hsl(${hue} 74% 62%),hsl(${(hue + 18) % 360} 72% 48%))`;
  }

  /** 头像文字：中文取末两字，英文取首字母 */
  function avatarText(name) {
    const n = String(name || '').trim();
    if (!n) return '?';
    if (/[\u4e00-\u9fa5]/.test(n)) return n.length >= 2 ? n.slice(-2) : n;
    return n[0].toUpperCase();
  }

  const METHOD_FALLBACK = [
    { value: 'phone', label: '电话' },
    { value: 'email', label: '邮箱' },
    { value: 'wechat', label: '微信' },
    { value: 'qq', label: 'QQ' },
    { value: 'address', label: '地址' },
    { value: 'other', label: '其他' },
  ];

  const state = {
    contacts: [],
    keyword: '',
    filter: 'all',
    selectedId: null,
    current: null,
    mode: 'empty',
    draft: null,
    methodTypes: METHOD_FALLBACK,
    stats: { total: 0, favorites: 0 },
  };

  /* ------------------------------ 网络 ------------------------------ */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (e) { /* 忽略非 JSON 响应 */ }
    if (!res.ok || json.success === false) {
      const err = new Error(json.message || `请求失败（HTTP ${res.status}）`);
      err.payload = json;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /* ------------------------------ 提示 ------------------------------ */

  let toastTimer = null;
  function toast(message, type = 'info', duration = 2400) {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 200);
    }, duration);
  }

  /** 通用弹窗，返回被点击按钮的 value */
  function showModal({ title, body, buttons }) {
    return new Promise((resolve) => {
      const mask = $('#modalMask');
      const footer = $('.modal-footer', mask);
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = body;
      footer.innerHTML = '';

      const close = (value) => {
        mask.hidden = true;
        document.removeEventListener('keydown', onKey);
        mask.removeEventListener('click', onBackdrop);
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      const onBackdrop = (e) => { if (e.target === mask) close(null); };

      (buttons || [{ label: '知道了', value: true, primary: true }]).forEach((b) => {
        const btn = document.createElement('button');
        btn.className = `btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}`;
        btn.textContent = b.label;
        btn.addEventListener('click', () => close(b.value));
        footer.appendChild(btn);
      });

      mask.hidden = false;
      mask.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      const first = footer.querySelector('.btn-primary');
      if (first) first.focus();
    });
  }

  async function confirmDialog(title, text, dangerLabel = '确认删除') {
    const v = await showModal({
      title,
      body: `<p style="margin:4px 0 8px;line-height:1.8">${esc(text)}</p>`,
      buttons: [
        { label: '取消', value: false },
        { label: dangerLabel, value: true, danger: true },
      ],
    });
    return v === true;
  }

  /* ------------------------------ 数据加载 ------------------------------ */

  async function loadMeta() {
    try {
      const res = await api('/api/meta');
      if (res.data && Array.isArray(res.data.methodTypes)) state.methodTypes = res.data.methodTypes;
    } catch (e) { /* 使用内置兜底 */ }
  }

  async function loadStats() {
    try {
      const res = await api('/api/stats');
      state.stats = res.data;
      $('#countAll').textContent = state.stats.total;
      $('#countFav').textContent = state.stats.favorites;
    } catch (e) { /* 静默失败 */ }
  }

  async function loadContacts({ keepSelection = true } = {}) {
    const params = new URLSearchParams();
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.filter === 'fav') params.set('favorite', '1');
    const res = await api(`/api/contacts?${params.toString()}`);
    state.contacts = res.data;

    if (!keepSelection || !state.contacts.some((c) => c.id === state.selectedId)) {
      if (state.mode === 'view' || state.mode === 'empty') {
        state.selectedId = state.contacts.length ? state.contacts[0].id : null;
        state.current = state.selectedId
          ? state.contacts.find((c) => c.id === state.selectedId) || null
          : null;
        state.mode = state.current ? 'view' : 'empty';
      }
    } else {
      const fresh = state.contacts.find((c) => c.id === state.selectedId);
      if (fresh && state.mode === 'view') state.current = fresh;
    }

    renderList();
    renderDetail();
  }

  /* ------------------------------ 列表渲染 ------------------------------ */

  function secondaryLine(c) {
    if (c.company) return c.company;
    const m = c.methods.find((x) => x.type === 'phone') || c.methods[0];
    return m ? m.value : '暂无联系方式';
  }

  function renderList() {
    const list = $('#contactList');
    const empty = $('#listEmpty');

    if (state.contacts.length === 0) {
      list.innerHTML = '';
      list.hidden = true;
      empty.hidden = false;
      if (state.keyword) {
        empty.innerHTML = `<div><strong>没有匹配的联系人</strong>换个关键词试试，或<a href="#" data-action="reset-search" style="color:#2563eb">清空搜索</a></div>`;
      } else if (state.filter === 'fav') {
        empty.innerHTML = '<div><strong>还没有收藏</strong>点击联系人右侧的星标即可收藏</div>';
      } else {
        empty.innerHTML = '<div><strong>通讯录还是空的</strong>点右上角「新建联系人」或「导入」Excel</div>';
      }
      return;
    }

    empty.hidden = true;
    list.hidden = false;
    list.innerHTML = state.contacts
      .map((c) => {
        const active = c.id === state.selectedId ? ' is-active' : '';
        return `
        <li class="contact-item${active}" data-id="${c.id}">
          <div class="avatar" style="${avatarStyle(c.name)}">${esc(avatarText(c.name))}</div>
          <div class="contact-main">
            <div class="contact-name">
              <span>${esc(c.name)}</span>
              ${c.favorite ? '<span class="tag-fav">收藏</span>' : ''}
            </div>
            <div class="contact-sub">${esc(secondaryLine(c))}</div>
          </div>
          <button class="star-btn${c.favorite ? ' is-on' : ''}" data-action="toggle-fav" data-id="${c.id}"
                  title="${c.favorite ? '取消收藏' : '收藏'}" aria-label="收藏">
            <svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"></path></svg>
          </button>
        </li>`;
      })
      .join('');
  }

  /* ------------------------------ 详情渲染 ------------------------------ */

  const ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"></path></svg>';
  const ICON_STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"></path></svg>';
  const ICON_BUILDING = '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"></path></svg>';

  function methodLabel(type) {
    const t = state.methodTypes.find((x) => x.value === type);
    return t ? t.label : '其他';
  }

  function renderDetail() {
    const box = $('#detail');
    if (state.mode === 'edit' || state.mode === 'new') {
      box.innerHTML = renderForm();
      bindForm();
      return;
    }
    if (state.mode === 'empty' || !state.current) {
      box.innerHTML = `
        <div class="detail-empty">
          <div class="illus">${ICON_USER}</div>
          <h2>还没有选中联系人</h2>
          <p>从左侧列表选择一位联系人查看详情，<br>或者点击右上角「新建联系人」开始录入。</p>
        </div>`;
      return;
    }

    const c = state.current;
    const methodCount = c.methods.length;

    box.innerHTML = `
      <div class="detail-head">
        <div class="avatar" style="${avatarStyle(c.name)};font-size:${avatarText(c.name).length > 1 ? 20 : 24}px">
          ${esc(avatarText(c.name))}
        </div>
        <div class="detail-title">
          <h2>
            ${esc(c.name)}
            ${c.favorite ? '<span class="pill-fav">★ 已收藏</span>' : ''}
          </h2>
          <p class="company">
            ${ICON_BUILDING}
            ${c.company ? esc(c.company) : '<span style="color:#a9b4c6">未填写公司</span>'}
          </p>
          <div class="meta">共 ${methodCount} 条联系方式 · 更新于 ${esc((c.updatedAt || '').slice(0, 16))}</div>
        </div>
        <div class="detail-actions">
          <button class="btn-fav${c.favorite ? ' is-on' : ''}" data-action="toggle-fav" data-id="${c.id}">
            ${ICON_STAR}
            ${c.favorite ? '已收藏' : '收藏'}
          </button>
        </div>
      </div>

      <section class="section">
        <div class="section-head">
          <span class="section-title">联系方式</span>
          <span style="font-size:12px;color:#7c8aa0">${methodCount} 条</span>
        </div>
        ${methodCount === 0
          ? '<div class="note-box note-empty">暂无联系方式，点击下方「编辑」添加电话、邮箱或社交账号。</div>'
          : `<div class="method-list">
              ${c.methods.map((m) => `
                <div class="method-item">
                  <span class="method-pill" data-type="${esc(m.type)}">${esc(methodLabel(m.type))}</span>
                  <div class="method-body">
                    <span class="method-value">${esc(m.value)}</span>
                    ${m.label ? `<span class="method-label">${esc(m.label)}</span>` : ''}
                  </div>
                  <button class="copy-btn" data-action="copy" data-value="${esc(m.value)}">复制</button>
                </div>`).join('')}
            </div>`}
      </section>

      <section class="section">
        <div class="section-head"><span class="section-title">备注</span></div>
        <div class="note-box${c.note ? '' : ' note-empty'}">${c.note ? esc(c.note) : '暂无备注'}</div>
      </section>

      <div class="detail-footer">
        <button class="btn btn-primary" data-action="edit">编辑联系人</button>
        <button class="btn btn-danger" data-action="delete">删除</button>
      </div>`;
  }

  /* ------------------------------ 表单渲染 ------------------------------ */

  function renderForm() {
    const d = state.draft;
    const isNew = state.mode === 'new';

    const rows = d.methods.length
      ? d.methods.map((m) => methodRowHtml(m)).join('')
      : methodRowHtml({ type: 'phone', label: '', value: '' });

    return `
      <div class="detail-head" style="align-items:center">
        <div class="avatar" style="${avatarStyle(d.name || '新')};font-size:20px">
          ${esc(avatarText(d.name || '新'))}
        </div>
        <div class="detail-title">
          <h2 style="font-size:19px">${isNew ? '新建联系人' : '编辑联系人'}</h2>
          <div class="meta">带 <span style="color:#e11d48">*</span> 的为必填项，联系方式可添加多行</div>
        </div>
      </div>

      <form class="form" id="contactForm" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="f-name">姓名<span class="req">*</span></label>
            <input class="input" id="f-name" name="name" maxlength="50" placeholder="例如：张三" value="${esc(d.name)}">
          </div>
          <div class="field">
            <label for="f-company">公司 / 单位</label>
            <input class="input" id="f-company" name="company" maxlength="100" placeholder="例如：福州大学" value="${esc(d.company)}">
          </div>
          <div class="field full">
            <label for="f-note">备注</label>
            <textarea class="textarea" id="f-note" name="note" maxlength="500" placeholder="补充说明，例如部门、认识途径、重要事项…">${esc(d.note)}</textarea>
          </div>
        </div>

        <div class="switch-line">
          <label class="switch">
            <input type="checkbox" id="f-favorite" ${d.favorite ? 'checked' : ''}>
            <span class="track"></span>
          </label>
          <label for="f-favorite" style="cursor:pointer">
            <strong style="color:#0f172a">加入收藏</strong>
            <span style="color:#7c8aa0">— 收藏后会在列表顶部优先显示</span>
          </label>
        </div>

        <div class="field">
          <label>联系方式 <span style="font-weight:400;color:#7c8aa0">（可添加多条，类型可重复）</span></label>
          <div class="method-editor" id="methodEditor">${rows}</div>
          <button type="button" class="add-method" data-action="add-method">＋ 添加一行联系方式</button>
        </div>

        <div class="form-footer">
          <button type="submit" class="btn btn-primary">保存</button>
          <button type="button" class="btn" data-action="cancel">取消</button>
          <span class="spacer"></span>
          ${isNew ? '' : '<button type="button" class="btn btn-danger" data-action="delete">删除</button>'}
        </div>
      </form>`;
  }

  function methodRowHtml(m) {
    const options = state.methodTypes
      .map((t) => `<option value="${t.value}"${t.value === m.type ? ' selected' : ''}>${t.label}</option>`)
      .join('');
    return `
      <div class="method-row">
        <select class="select m-type" aria-label="联系方式类型">${options}</select>
        <input class="input m-label-input" maxlength="20" placeholder="标签（如 工作）" value="${esc(m.label)}">
        <input class="input m-value" maxlength="200" placeholder="号码 / 账号 / 地址" value="${esc(m.value)}">
        <button type="button" class="icon-btn" data-action="remove-method" title="删除这一行">&times;</button>
      </div>`;
  }

  /** 把表单当前内容同步回 draft，避免重渲染丢失用户已输入的内容 */
  function collectForm() {
    const form = $('#contactForm');
    if (!form) return;
    state.draft.name = $('#f-name').value;
    state.draft.company = $('#f-company').value;
    state.draft.note = $('#f-note').value;
    state.draft.favorite = $('#f-favorite').checked;
    state.draft.methods = Array.from(form.querySelectorAll('.method-row')).map((row) => ({
      type: row.querySelector('.m-type').value,
      label: row.querySelector('.m-label-input').value.trim(),
      value: row.querySelector('.m-value').value.trim(),
    }));
  }

  function bindForm() {
    const form = $('#contactForm');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveContact();
    });
    $('#f-name').focus();
  }

  /* ------------------------------ 交互动作 ------------------------------ */

  function startNew() {
    state.mode = 'new';
    state.selectedId = null;
    state.current = null;
    state.draft = { name: '', company: '', note: '', favorite: false, methods: [{ type: 'phone', label: '', value: '' }] };
    renderList();
    renderDetail();
    const input = $('#f-name');
    if (input) input.focus();
  }

  function startEdit() {
    if (!state.current) return;
    const c = state.current;
    state.mode = 'edit';
    state.draft = {
      id: c.id,
      name: c.name,
      company: c.company,
      note: c.note,
      favorite: c.favorite,
      methods: c.methods.length
        ? c.methods.map((m) => ({ type: m.type, label: m.label, value: m.value }))
        : [{ type: 'phone', label: '', value: '' }],
    };
    renderDetail();
  }

  async function saveContact() {
    collectForm();
    const isNew = state.mode === 'new';
    const name = state.draft.name.trim();
    if (!name) {
      toast('请填写姓名', 'error');
      $('#f-name').focus();
      return;
    }
    const payload = {
      name,
      company: state.draft.company.trim(),
      note: state.draft.note.trim(),
      favorite: state.draft.favorite,
      methods: state.draft.methods.filter((m) => m.value.trim()),
    };

    try {
      let res;
      if (isNew) {
        res = await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        res = await api(`/api/contacts/${state.draft.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      state.selectedId = res.data.id;
      state.current = res.data;
      state.mode = 'view';
      toast(isNew ? '已添加到通讯录' : '保存成功', 'success');
      await Promise.all([loadContacts({ keepSelection: true }), loadStats()]);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
    }
  }

  async function toggleFavorite(id, ev) {
    if (ev) ev.stopPropagation();
    const target = state.contacts.find((c) => c.id === id) || (state.current && state.current.id === id ? state.current : null);
    if (!target) return;
    try {
      const res = await api(`/api/contacts/${id}/favorite`, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: !target.favorite }),
      });
      if (state.current && state.current.id === id) state.current = res.data;
      await Promise.all([loadContacts({ keepSelection: true }), loadStats()]);
      toast(res.data.favorite ? '已加入收藏' : '已取消收藏', 'success', 1500);
    } catch (err) {
      toast(err.message || '操作失败', 'error');
    }
  }

  async function removeContact(id) {
    const target = state.current;
    if (!target) return;
    const ok = await confirmDialog('删除联系人', `确定要删除「${target.name}」吗？该联系人的所有联系方式会一并删除，且无法恢复。`);
    if (!ok) return;
    try {
      await api(`/api/contacts/${id}`, { method: 'DELETE' });
      state.selectedId = null;
      state.current = null;
      state.mode = 'empty';
      await Promise.all([loadContacts({ keepSelection: false }), loadStats()]);
      toast('已删除', 'success');
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // 非 HTTPS 环境（如直接用 IP 访问）下的降级方案
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('已复制到剪贴板', 'success', 1400);
    } catch (e) {
      toast('复制失败，请手动选中复制', 'error');
    }
  }

  /* ------------------------------ 导入 / 导出 ------------------------------ */

  async function handleImport(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast('仅支持 .xlsx 格式的 Excel 文件', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('文件超过 10MB，请拆分后再导入', 'error');
      return;
    }

    toast('正在导入，请稍候…', 'info', 8000);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.success === false) {
        const detail = json.detail || {};
        const errs = (detail.errors || []).map((e) => `<li>${esc(e.message)}</li>`).join('');
        await showModal({
          title: '导入失败',
          body: `
            <p style="margin:2px 0 10px">${esc(json.message || '文件解析失败')}</p>
            ${detail.totalRows !== undefined ? `<p style="font-size:12.5px;color:#7c8aa0;margin:0 0 8px">共读取 ${detail.totalRows} 行数据，其中有效 ${detail.parsed ?? 0} 行</p>` : ''}
            ${errs ? `<ul class="err-list">${errs}</ul>` : ''}`,
        });
        return;
      }

      const d = json.data;
      const errs = (d.errors || []).map((e) => `<li>${esc(e.message)}</li>`).join('');
      await showModal({
        title: '导入完成',
        body: `
          <div class="stat-row">
            <div class="stat-card"><b>${d.inserted}</b><span>新增联系人</span></div>
            <div class="stat-card"><b>${d.merged}</b><span>合并更新</span></div>
            <div class="stat-card"><b>${d.errors.length}</b><span>跳过行</span></div>
          </div>
          <p style="margin:0 0 8px">共读取 ${d.totalRows} 行，成功解析 ${d.parsed} 行有效数据。</p>
          ${errs ? `<ul class="err-list">${errs}</ul>` : ''}
          <p style="font-size:12px;color:#7c8aa0;margin:10px 0 0">判定规则：姓名相同且至少一个联系方式相同，视为同一人并合并更新。</p>`,
      });
      state.selectedId = null;
      state.mode = 'empty';
      await Promise.all([loadContacts({ keepSelection: false }), loadStats()]);
    } catch (err) {
      toast(err.message || '导入失败，请检查网络', 'error');
    } finally {
      $('#importInput').value = '';
    }
  }

  async function handleExport() {
    const params = new URLSearchParams();
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.filter === 'fav') params.set('favorite', '1');

    try {
      toast('正在生成 Excel…', 'info', 6000);
      const res = await fetch(`/api/export?${params.toString()}`);
      if (!res.ok) throw new Error('导出失败，请稍后重试');
      const blob = await res.blob();

      let filename = '通讯录.xlsx';
      const cd = res.headers.get('content-disposition') || '';
      const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8) filename = decodeURIComponent(utf8[1]);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      const count = res.headers.get('x-export-count');
      toast(`已导出 ${count ?? ''} 位联系人`, 'success');
    } catch (err) {
      toast(err.message || '导出失败', 'error');
    }
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bindGlobal() {
    // 搜索（防抖 260ms）
    let timer = null;
    const input = $('#searchInput');
    input.addEventListener('input', () => {
      const value = input.value.trim();
      $('#clearSearch').hidden = value.length === 0;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        state.keyword = value;
        try {
          await loadContacts({ keepSelection: false });
        } catch (e) {
          toast('搜索失败，请重试', 'error');
        }
      }, 260);
    });

    $('#clearSearch').addEventListener('click', () => {
      input.value = '';
      $('#clearSearch').hidden = true;
      state.keyword = '';
      loadContacts({ keepSelection: false });
      input.focus();
    });

    // 全部 / 收藏 切换
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', async () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        state.filter = tab.dataset.filter;
        state.selectedId = null;
        state.current = null;
        state.mode = 'empty';
        try {
          await loadContacts({ keepSelection: false });
        } catch (e) {
          toast('加载失败，请重试', 'error');
        }
      });
    });

    // 列表点击
    $('#contactList').addEventListener('click', (e) => {
      const star = e.target.closest('[data-action="toggle-fav"]');
      if (star) {
        toggleFavorite(Number(star.dataset.id), e);
        return;
      }
      const item = e.target.closest('.contact-item');
      if (!item) return;
      if (state.mode === 'edit' || state.mode === 'new') {
        // 编辑中切换联系人：直接放弃未保存的修改
        state.mode = 'view';
      }
      state.selectedId = Number(item.dataset.id);
      state.current = state.contacts.find((c) => c.id === state.selectedId) || null;
      if (state.current) state.mode = 'view';
      renderList();
      renderDetail();
    });

    // 空状态里的"清空搜索"链接
    $('#listEmpty').addEventListener('click', (e) => {
      if (e.target.dataset.action === 'reset-search') {
        e.preventDefault();
        $('#clearSearch').click();
      }
    });

    // 详情区动作
    $('#detail').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'edit') return startEdit();
      if (action === 'delete') return removeContact(Number(btn.dataset.id || state.current?.id));
      if (action === 'toggle-fav') return toggleFavorite(Number(btn.dataset.id), e);
      if (action === 'copy') return copyText(btn.dataset.value);
      if (action === 'cancel') {
        state.mode = state.current ? 'view' : 'empty';
        return renderDetail();
      }
      if (action === 'add-method') {
        collectForm();
        state.draft.methods.push({ type: 'phone', label: '', value: '' });
        $('#methodEditor').innerHTML = state.draft.methods.map(methodRowHtml).join('');
        const rows = document.querySelectorAll('.method-row');
        const last = rows[rows.length - 1];
        if (last) last.querySelector('.m-value').focus();
        return;
      }
      if (action === 'remove-method') {
        const row = btn.closest('.method-row');
        const rows = Array.from(document.querySelectorAll('.method-row'));
        if (rows.length === 1) {
          // 只剩一行时清空内容而不是删除，保证表单始终有一行
          row.querySelector('.m-label-input').value = '';
          row.querySelector('.m-value').value = '';
          collectForm();
          return;
        }
        collectForm();
        const index = rows.indexOf(row);
        state.draft.methods.splice(index, 1);
        $('#methodEditor').innerHTML = state.draft.methods.map(methodRowHtml).join('');
        return;
      }
      return null;
    });

    // 新建
    $('#btnNew').addEventListener('click', startNew);

    // 导入
    $('#importInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImport(file);
    });

    // 导出
    $('#btnExport').addEventListener('click', handleExport);

    // 快捷键：Ctrl/Cmd + K 聚焦搜索；Esc 关闭弹窗/退出编辑
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#searchInput').focus();
      }
      if (e.key === 'Escape' && (state.mode === 'edit' || state.mode === 'new')) {
        state.mode = state.current ? 'view' : 'empty';
        renderDetail();
      }
    });

    // 拖拽 Excel 到页面直接导入
    ['dragover', 'drop'].forEach((type) => {
      document.addEventListener(type, (e) => {
        e.preventDefault();
        if (type === 'drop') {
          const file = e.dataTransfer?.files?.[0];
          if (file) handleImport(file);
        }
      });
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  async function init() {
    bindGlobal();
    await loadMeta();
    try {
      await loadContacts({ keepSelection: false });
      await loadStats();
    } catch (err) {
      toast('无法连接服务，请确认后端已启动', 'error', 5000);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
