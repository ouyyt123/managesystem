import { api } from '../core/api.js';
import { loadOptions, loadAlerts, invalidateAlerts } from '../core/data.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, dateTimeText, roleTone, ROLES, statusPill
} from '../core/format.js';
import { field, formValues, modal, confirmDialog, setBusy, toast, emptyBlock, avatarHTML, debounce } from '../core/ui.js';

export async function render({ user, navigate }) {
  const isAdmin = user.role === 'ADMIN';
  const canFields = ['ADMIN', 'RESEARCH_MANAGER'].includes(user.role);
  const options = await loadOptions(true);
  const state = {
    tab: isAdmin ? 'users' : 'logs',
    users: [],
    departments: [],
    projectFields: [],
    fieldsDirty: false,
    draggingField: '',
    menus: [],
    menusDirty: false,
    logs: { items: [], total: 0, page: 1, size: 15, modules: [] },
    logModule: '',
    logKeyword: ''
  };
  const wrap = document.createElement('div');

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">System · 系统管理</div>
        <h1 class="page-title">系统管理</h1>
        <div class="page-sub">${isAdmin ? '维护部门与账号、配置新建项目表单字段与 OCR 关键词、启停菜单、查看操作日志；停用后账号立即无法登录。' : '配置新建科研项目的表单字段与 OCR 关键词，查看操作日志，追踪关键写操作。'}</div>
      </div>
      <div class="page-actions">
        ${isAdmin ? `<button class="btn btn-secondary" type="button" data-reset-demo>${icon('database')}重置演示数据</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head" style="padding-bottom:0;border-bottom:0">
        <div class="tabs" id="system-tabs">
          ${isAdmin ? `<button class="tab active" type="button" data-tab="users">${icon('users', 'ic-sm')}用户管理</button>
          <button class="tab" type="button" data-tab="departments">${icon('building', 'ic-sm')}部门管理</button>` : ''}
          ${canFields ? `<button class="tab" type="button" data-tab="fields">${icon('columns', 'ic-sm')}项目字段</button>` : ''}
          ${isAdmin ? `<button class="tab" type="button" data-tab="menus">${icon('layout', 'ic-sm')}菜单管理</button>` : ''}
          <button class="tab ${isAdmin ? '' : 'active'}" type="button" data-tab="logs">${icon('scroll', 'ic-sm')}操作日志</button>
        </div>
        <div class="row gap-8" id="system-actions"></div>
      </div>
      <div class="card-body" id="system-body"></div>
    </div>`;

  const body = wrap.querySelector('#system-body');
  const actions = wrap.querySelector('#system-actions');

  function bindTabs() {
    wrap.querySelectorAll('#system-tabs .tab').forEach((tab) => tab.addEventListener('click', () => {
      state.tab = tab.getAttribute('data-tab');
      wrap.querySelectorAll('#system-tabs .tab').forEach((el) => el.classList.toggle('active', el === tab));
      renderTab();
    }));
  }

  async function renderTab() {
    actions.innerHTML = '';
    if (state.tab === 'users') return renderUsers();
    if (state.tab === 'departments') return renderDepartments();
    if (state.tab === 'fields') return renderFields();
    if (state.tab === 'menus') return renderMenus();
    return renderLogs();
  }

  /* ---------------- 用户 ---------------- */
  async function renderUsers() {
    body.innerHTML = '<div class="center" style="padding:30px"><span class="spinner"></span></div>';
    actions.innerHTML = `<button class="btn btn-primary btn-sm" type="button" data-add-user>${icon('plus')}新增用户</button>`;
    actions.querySelector('[data-add-user]').addEventListener('click', () => openUserForm());
    try {
      const data = await api('/users');
      state.users = data.items;
      body.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>用户</th><th>账号</th><th>角色</th><th>部门 / 职务</th><th>联系方式</th><th>最近登录</th><th>状态</th><th class="right">操作</th></tr></thead>
            <tbody>
              ${state.users.map((item) => `
                <tr>
                  <td>
                    <div class="row gap-8">
                      ${avatarHTML(item.name, roleTone(item.role), 'sm')}
                      <div>
                        <div class="cell-main">${escapeHtml(item.name)}</div>
                        <div class="cell-sub">${escapeHtml(item.title || '—')}</div>
                      </div>
                    </div>
                  </td>
                  <td class="mono small">${escapeHtml(item.username)}</td>
                  <td><span class="pill tone-${roleTone(item.role)}"><span class="pill-dot"></span>${escapeHtml(ROLES[item.role]?.name || item.role)}</span></td>
                  <td><div class="small">${escapeHtml(item.deptName)}</div></td>
                  <td class="small muted"><div>${escapeHtml(item.phone || '—')}</div><div class="cell-sub">${escapeHtml(item.email || '')}</div></td>
                  <td class="small muted">${item.lastLoginAt ? dateTimeText(item.lastLoginAt) : '从未登录'}</td>
                  <td>${item.enabled ? '<span class="tag tone-emerald">启用</span>' : '<span class="tag tone-rose">停用</span>'}</td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-xs btn-ghost" type="button" data-edit-user="${item.id}">编辑</button>
                      <button class="btn btn-xs btn-ghost" type="button" data-reset-user="${item.id}">重置密码</button>
                      <button class="btn btn-xs btn-ghost" type="button" style="color:${item.enabled ? '#be123c' : '#059669'}" data-toggle-user="${item.id}" data-enabled="${item.enabled ? '0' : '1'}">${item.enabled ? '停用' : '启用'}</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      body.querySelectorAll('[data-edit-user]').forEach((el) => el.addEventListener('click', () => {
        openUserForm(state.users.find((u) => u.id === el.getAttribute('data-edit-user')));
      }));
      body.querySelectorAll('[data-reset-user]').forEach((el) => el.addEventListener('click', async () => {
        const target = state.users.find((u) => u.id === el.getAttribute('data-reset-user'));
        const ok = await confirmDialog({
          title: '重置用户密码',
          message: `确定把「${target.name}（${target.username}）」的密码重置为 123456 吗？`,
          detail: '请提醒用户首次登录后立即修改密码。',
          confirmText: '重置密码'
        });
        if (!ok) return;
        try {
          await api(`/users/${target.id}/reset-password`, { method: 'POST', body: { password: '123456' } });
          toast(`已重置 ${target.name} 的密码为 123456`, 'success');
        } catch (error) {
          toast(error.message, 'error');
        }
      }));
      body.querySelectorAll('[data-toggle-user]').forEach((el) => el.addEventListener('click', async () => {
        const target = state.users.find((u) => u.id === el.getAttribute('data-toggle-user'));
        const enable = el.getAttribute('data-enabled') === '1';
        try {
          await api(`/users/${target.id}`, { method: 'PUT', body: { enabled: enable } });
          toast(enable ? '账号已启用' : '账号已停用，立即无法登录', 'success');
          await renderUsers();
        } catch (error) {
          toast(error.message, 'error');
        }
      }));
    } catch (error) {
      body.innerHTML = emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message });
    }
  }

  function openUserForm(target) {
    const isEdit = Boolean(target);
    const deptOptions = (options.departments || []).map((d) => ({ value: d.id, label: d.name }));
    const handle = modal({
      title: isEdit ? '编辑用户' : '新增用户',
      subtitle: isEdit ? `${target.username} · 修改角色或部门后重新登录生效` : '初始密码默认为 123456',
      body: `
        <form id="user-form" class="form-grid">
          ${field({ label: '登录账号', name: 'username', value: target?.username || '', required: true, placeholder: '3—20 位字母、数字或下划线', disabled: isEdit, hint: isEdit ? '账号创建后不可修改' : '' })}
          ${field({ label: '姓名', name: 'name', value: target?.name || '', required: true })}
          ${field({ label: '角色', name: 'role', type: 'select', value: target?.role || 'PROJECT_MANAGER', options: Object.values(ROLES).map((r) => ({ value: r.code, label: r.name })) })}
          ${field({ label: '所属部门', name: 'deptId', type: 'select', value: target?.deptId || options.departments?.[0]?.id, options: deptOptions })}
          ${field({ label: '职务', name: 'title', value: target?.title || '' })}
          ${field({ label: '手机号', name: 'phone', value: target?.phone || '' })}
          ${field({ label: '邮箱', name: 'email', value: target?.email || '', span: true })}
          ${isEdit ? '' : field({ label: '初始密码', name: 'password', type: 'password', value: '123456', hint: '至少 6 位，建议首次登录后修改', span: true })}
        </form>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>${isEdit ? '保存修改' : '创建用户'}</button>`
    });
    handle.footer.querySelector('[data-save]').addEventListener('click', async (event) => {
      const values = formValues(handle.body);
      if (!values.name || !values.name.trim()) return toast('请填写姓名', 'error');
      if (!isEdit && !/^[a-zA-Z0-9_]{3,20}$/.test(values.username || '')) return toast('账号需为 3—20 位字母、数字或下划线', 'error');
      if (!isEdit && (!values.password || values.password.length < 6)) return toast('初始密码至少 6 位', 'error');
      const button = event.currentTarget;
      setBusy(button, true, '保存中…');
      try {
        if (isEdit) {
          await api(`/users/${target.id}`, {
            method: 'PUT',
            body: {
              name: values.name, role: values.role, deptId: values.deptId,
              title: values.title, phone: values.phone, email: values.email
            }
          });
          toast('用户信息已更新', 'success');
        } else {
          await api('/users', { method: 'POST', body: values });
          toast('用户已创建，可使用初始密码登录', 'success');
        }
        handle.close();
        await renderUsers();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  }

  /* ---------------- 部门 ---------------- */
  async function renderDepartments() {
    body.innerHTML = '<div class="center" style="padding:30px"><span class="spinner"></span></div>';
    actions.innerHTML = `<button class="btn btn-primary btn-sm" type="button" data-add-dept>${icon('plus')}新增部门</button>`;
    actions.querySelector('[data-add-dept]').addEventListener('click', () => openDeptForm());
    try {
      const [data, usersData] = await Promise.all([api('/departments'), api('/users')]);
      state.departments = data.items;
      state.users = usersData.items;
      body.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>部门名称</th><th>编码</th><th>负责人</th><th>用户数</th><th>项目归属</th><th>状态</th><th class="right">操作</th></tr></thead>
            <tbody>
              ${data.items.map((dept) => `
                <tr>
                  <td><div class="cell-main">${icon('building', 'ic-sm')}${escapeHtml(dept.name)}</div></td>
                  <td class="mono small">${escapeHtml(dept.code || '—')}</td>
                  <td>${escapeHtml(dept.leader || '—')}</td>
                  <td class="num">${state.users.filter((u) => u.deptId === dept.id).length}</td>
                  <td class="hint">项目按所属部门统计</td>
                  <td><span class="tag tone-emerald">启用</span></td>
                  <td><div class="actions"><button class="btn btn-xs btn-ghost" type="button" data-edit-dept="${dept.id}">编辑</button></div></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      body.querySelectorAll('[data-edit-dept]').forEach((el) => el.addEventListener('click', () => {
        openDeptForm(state.departments.find((d) => d.id === el.getAttribute('data-edit-dept')));
      }));
    } catch (error) {
      body.innerHTML = emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message });
    }
  }

  function openDeptForm(dept) {
    const isEdit = Boolean(dept);
    const handle = modal({
      title: isEdit ? '编辑部门' : '新增部门',
      subtitle: '部门用于项目归属与统计口径',
      size: 'narrow',
      body: `
        <form id="dept-form" class="col gap-12">
          <div class="field"><label class="label">部门名称</label><input class="input" name="name" value="${escapeHtml(dept?.name || '')}" placeholder="如：智能装备部" /></div>
          <div class="field"><label class="label">部门编码</label><input class="input mono" name="code" value="${escapeHtml(dept?.code || '')}" placeholder="如：ZNZB" /></div>
          <div class="field"><label class="label">负责人</label><input class="input" name="leader" value="${escapeHtml(dept?.leader || '')}" /></div>
        </form>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>保存</button>`
    });
    handle.footer.querySelector('[data-save]').addEventListener('click', async (event) => {
      const values = formValues(handle.body);
      if (!values.name?.trim()) return toast('请填写部门名称', 'error');
      setBusy(event.currentTarget, true, '保存中…');
      try {
        if (isEdit) await api(`/departments/${dept.id}`, { method: 'PUT', body: values });
        else await api('/departments', { method: 'POST', body: values });
        toast('部门已保存', 'success');
        handle.close();
        await loadOptions(true);
        await renderDepartments();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(event.currentTarget, false);
      }
    });
  }

  /* ---------------- 日志 ---------------- */
  async function renderLogs() {
    body.innerHTML = '<div class="center" style="padding:30px"><span class="spinner"></span></div>';
    actions.innerHTML = '';
    try {
      const params = new URLSearchParams({ page: String(state.logs.page), size: String(state.logs.size) });
      if (state.logModule) params.set('module', state.logModule);
      if (state.logKeyword) params.set('keyword', state.logKeyword);
      const data = await api(`/logs?${params.toString()}`);
      state.logs = { ...state.logs, ...data };
      const maxPage = Math.max(1, Math.ceil(data.total / state.logs.size));
      body.innerHTML = `
        <div class="toolbar" style="margin-bottom:14px">
          <div class="input-group search-box">
            ${icon('search')}
            <input class="input" id="log-keyword" placeholder="搜索操作人 / 对象 / 详情" value="${escapeHtml(state.logKeyword)}" />
          </div>
          <select class="select" id="log-module">
            <option value="">全部模块</option>
            ${data.modules.map((m) => `<option value="${escapeHtml(m)}" ${state.logModule === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
          <span class="small muted" style="margin-left:auto">共 ${data.total} 条日志</span>
        </div>
        <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
          <table class="table">
            <thead><tr><th style="width:150px">时间</th><th>操作人</th><th>模块</th><th>动作</th><th>对象</th><th style="min-width:260px">详情</th><th>IP</th></tr></thead>
            <tbody>
              ${data.items.length ? data.items.map((log) => `
                <tr>
                  <td class="small muted num nowrap">${dateTimeText(log.at)}</td>
                  <td><div class="small">${escapeHtml(log.username)}</div><div class="cell-sub mono">${escapeHtml(log.role)}</div></td>
                  <td><span class="tag">${escapeHtml(log.module)}</span></td>
                  <td class="small">${escapeHtml(log.action)}</td>
                  <td class="small mono">${escapeHtml(log.target || '—')}</td>
                  <td class="small muted">${escapeHtml(log.detail || '—')}</td>
                  <td class="small mono faint">${escapeHtml(log.ip || '—')}</td>
                </tr>`).join('') : `<tr><td colspan="7"><div class="table-empty">${emptyBlock({ iconName: 'scroll', title: '暂无日志', text: '关键写操作会自动记录在这里。' })}</div></td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="row-between" style="margin-top:14px">
          <span class="small muted">第 ${state.logs.page} / ${maxPage} 页</span>
          <div class="row gap-6">
            <button class="btn btn-sm btn-secondary" type="button" id="log-prev">${icon('chevronLeft')}上一页</button>
            <button class="btn btn-sm btn-secondary" type="button" id="log-next">下一页${icon('chevronRight')}</button>
          </div>
        </div>`;
      body.querySelector('#log-keyword').addEventListener('input', debounce((event) => {
        state.logKeyword = event.target.value.trim();
        state.logs.page = 1;
        renderLogs();
      }, 280));
      body.querySelector('#log-module').addEventListener('change', (event) => {
        state.logModule = event.target.value;
        state.logs.page = 1;
        renderLogs();
      });
      body.querySelector('#log-prev').disabled = state.logs.page <= 1;
      body.querySelector('#log-next').disabled = state.logs.page >= maxPage;
      body.querySelector('#log-prev').addEventListener('click', () => { state.logs.page = Math.max(1, state.logs.page - 1); renderLogs(); });
      body.querySelector('#log-next').addEventListener('click', () => { state.logs.page = Math.min(maxPage, state.logs.page + 1); renderLogs(); });
    } catch (error) {
      body.innerHTML = emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message });
    }
  }

  /* ---------------- 项目字段配置 ---------------- */
  const FIELD_TYPE_LABELS = {
    text: '单行文本',
    textarea: '多行文本',
    number: '数字',
    date: '日期',
    select: '下拉选择',
    checkbox: '是/否勾选',
    department: '部门选择',
    manager: '人员选择',
    status: '项目状态'
  };
  const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

  function fieldTypeLabel(type) {
    return FIELD_TYPE_LABELS[type] || type;
  }

  async function renderFields() {
    body.innerHTML = '<div class="center" style="padding:30px"><span class="spinner"></span></div>';
    actions.innerHTML = `
      <span class="save-state" id="field-save-state"><span class="dot"></span><span>配置已同步</span></span>
      <button class="btn btn-ghost btn-sm" type="button" data-reset-fields>${icon('rotate')}重置</button>
      <button class="btn btn-secondary btn-sm" type="button" data-add-field>${icon('plus')}新增字段</button>
      <button class="btn btn-primary btn-sm" type="button" data-save-fields disabled>${icon('save')}保存配置</button>`;
    const saveBtn = actions.querySelector('[data-save-fields]');
    try {
      const data = await api('/project-fields');
      state.projectFields = data.fields;
      state.fieldsDirty = false;
      paintFields();
      actions.querySelector('[data-add-field]').addEventListener('click', () => openFieldForm());
      actions.querySelector('[data-reset-fields]').addEventListener('click', resetFields);
      saveBtn.addEventListener('click', saveFields);
    } catch (error) {
      body.innerHTML = emptyBlock({ iconName: 'alertTriangle', title: '字段配置加载失败', text: error.message });
    }
  }

  function updateFieldSaveState() {
    const saveBtn = actions.querySelector('[data-save-fields]');
    const saveState = actions.querySelector('#field-save-state');
    if (!saveBtn || !saveState) return;
    saveBtn.disabled = !state.fieldsDirty;
    saveState.classList.toggle('dirty', state.fieldsDirty);
    saveState.innerHTML = state.fieldsDirty
      ? '<span class="dot"></span><span>有未保存的修改</span>'
      : '<span class="dot"></span><span>配置已同步</span>';
  }

  function markFieldsDirty() {
    state.fieldsDirty = true;
    updateFieldSaveState();
  }

  function fieldRowHTML(field, index) {
    const optionsText = field.type === 'select' && field.options.length
      ? `<span class="hint">${escapeHtml(field.options.slice(0, 4).join(' / '))}${field.options.length > 4 ? ' …' : ''}</span>`
      : '';
    return `
      <div class="field-config-row ${field.enabled ? '' : 'disabled'} ${field.locked ? 'locked' : ''}" draggable="true" data-field-row="${escapeHtml(field.id)}">
        <span class="field-drag" title="拖动调整顺序">${icon('grip')}</span>
        <span class="field-seq">${index + 1}</span>
        <div class="field-config-main">
          <div class="field-config-label">${escapeHtml(field.label)} <span class="field-key">${escapeHtml(field.key)}</span></div>
          <div class="field-config-meta">
            <span class="tag ${field.group === 'system' ? 'tone-slate' : 'tone-indigo'}">${field.group === 'system' ? '系统信息' : 'ERP 基本信息'}</span>
            <span class="tag">${fieldTypeLabel(field.type)}</span>
            ${field.full ? '<span class="tag">整行显示</span>' : ''}
            ${field.builtin ? '<span class="tag tone-slate">内置</span>' : '<span class="tag tone-indigo">自定义</span>'}
            ${field.locked ? '<span class="tag tone-amber">锁定</span>' : ''}
            ${field.ocrKeywords?.length ? `<span class="tag tone-amber" title="${escapeHtml(field.ocrKeywords.join(' / '))}">OCR</span>` : ''}
            ${optionsText}
          </div>
        </div>
        <div class="field-switch-group">
          <label class="switch">
            <input type="checkbox" data-field-required ${field.required ? 'checked' : ''} ${field.locked ? 'disabled' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">必填</span>
          </label>
          <label class="switch">
            <input type="checkbox" data-field-enabled ${field.enabled ? 'checked' : ''} ${field.locked ? 'disabled' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">${field.enabled ? '启用' : '停用'}</span>
          </label>
        </div>
        <div class="actions">
          ${field.type === 'select' ? '<button class="btn btn-xs btn-ghost" type="button" data-field-options>选项</button>' : ''}
          <button class="btn btn-xs btn-ghost" type="button" data-edit-field>编辑</button>
          ${field.builtin ? '' : '<button class="btn btn-xs btn-ghost" type="button" style="color:#be123c" data-del-field>删除</button>'}
        </div>
      </div>`;
  }

  function paintFields() {
    const fields = state.projectFields;
    body.innerHTML = `
      <div class="field-config-tip">
        ${icon('info')}
        <div>
          在这里维护「新建科研项目」表单：可按 ERP 基本信息页调整字段名称、分组、顺序、必填与下拉选项；下拉字段可点「选项」增删改内容；「OCR 关键词」用于 ERP 截图识别回填。
          内置字段不可删除，锁定字段（项目名称、部门、经理、起止日期、经费、状态等）不能停用，以保证计算与权限规则。修改后点右上角「保存配置」生效。
        </div>
      </div>
      <div class="field-config-list" id="field-config-list">
        ${fields.length ? fields.map((field, index) => fieldRowHTML(field, index)).join('') : emptyBlock({ iconName: 'columns', title: '暂无字段配置' })}
      </div>
      <div class="hint" style="margin-top:12px">共 ${fields.length} 个字段，其中自定义字段 ${fields.filter((f) => !f.builtin).length} 个 · 自定义字段的值会显示在项目详情的「项目信息」页。</div>`;
    bindFieldRows();
    updateFieldSaveState();
  }

  function findField(id) {
    return state.projectFields.find((field) => field.id === id);
  }

  function reorderField(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const list = state.projectFields;
    const from = list.findIndex((field) => field.id === sourceId);
    const to = list.findIndex((field) => field.id === targetId);
    if (from < 0 || to < 0) return;
    const [moving] = list.splice(from, 1);
    list.splice(to, 0, moving);
    list.forEach((field, index) => { field.seq = index + 1; });
    state.draggingField = '';
    markFieldsDirty();
    paintFields();
  }

  function bindFieldRows() {
    body.querySelectorAll('[data-field-row]').forEach((row) => {
      const field = findField(row.getAttribute('data-field-row'));
      if (!field) return;
      const requiredInput = row.querySelector('[data-field-required]');
      const enabledInput = row.querySelector('[data-field-enabled]');
      requiredInput.addEventListener('change', () => {
        field.required = requiredInput.checked;
        markFieldsDirty();
      });
      enabledInput.addEventListener('change', () => {
        field.enabled = enabledInput.checked;
        row.classList.toggle('disabled', !field.enabled);
        row.querySelector('.field-switch-group .switch:last-child .switch-label').textContent = field.enabled ? '启用' : '停用';
        markFieldsDirty();
      });
      row.querySelector('[data-edit-field]').addEventListener('click', () => openFieldForm(field));
      row.querySelector('[data-field-options]')?.addEventListener('click', () => openOptionsManager(field));
      row.querySelector('[data-del-field]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '删除自定义字段',
          message: `确定删除字段「${field.label}」吗？保存配置后，新建和编辑项目将不再显示该字段。`,
          detail: '已填写的历史值会保留在项目数据中，但页面不再展示。',
          tone: 'danger', confirmText: '删除字段'
        });
        if (!ok) return;
        state.projectFields = state.projectFields.filter((item) => item.id !== field.id);
        state.projectFields.forEach((item, index) => { item.seq = index + 1; });
        markFieldsDirty();
        paintFields();
      });

      row.addEventListener('dragstart', (event) => {
        state.draggingField = field.id;
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', field.id);
      });
      row.addEventListener('dragend', () => {
        state.draggingField = '';
        row.classList.remove('dragging');
        body.querySelectorAll('.field-config-row').forEach((el) => el.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (event) => {
        if (!state.draggingField || state.draggingField === field.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('drag-over');
        reorderField(state.draggingField, field.id);
      });
    });
  }

  function openOptionsManager(field) {
    const handle = modal({
      title: `管理「${field.label}」的选项`,
      subtitle: '这些内容会出现在新建/编辑项目的下拉框中，支持增删改，保存字段配置后生效',
      body: `
        <div class="option-manager">
          <div class="option-list" id="option-list"></div>
          <div class="row gap-6" style="margin-top:10px">
            <input class="input" id="new-option" placeholder="输入新的选项内容，如：技改类" style="flex:1" />
            <button class="btn btn-secondary" type="button" id="add-option">${icon('plus')}添加</button>
          </div>
          <div class="hint" style="margin-top:8px">修改后别忘了点击「项目字段」页的「保存配置」，否则刷新后会恢复。</div>
        </div>`,
      footer: `<button class="btn btn-secondary" type="button" data-close>完成</button>`
    });

    const list = handle.body.querySelector('#option-list');
    const newInput = handle.body.querySelector('#new-option');
    const render = () => {
      list.innerHTML = field.options.length
        ? field.options.map((option, index) => `
            <div class="option-row" data-option-row="${index}">
              <span class="option-seq">${index + 1}</span>
              <input class="input" value="${escapeHtml(option)}" data-option-input="${index}" />
              <button class="btn btn-xs btn-ghost" type="button" title="上移" data-option-up="${index}">${icon('chevronUp')}</button>
              <button class="btn btn-xs btn-ghost" type="button" title="下移" data-option-down="${index}">${icon('chevronDown')}</button>
              <button class="btn btn-xs btn-ghost" type="button" style="color:#be123c" data-option-remove="${index}">${icon('trash')}</button>
            </div>`).join('')
        : '<div class="hint" style="padding:14px;border:1px dashed var(--line);border-radius:10px;text-align:center">暂无选项，请先添加</div>';
      list.querySelectorAll('[data-option-input]').forEach((input) => {
        input.addEventListener('input', () => {
          field.options[Number(input.getAttribute('data-option-input'))] = input.value;
          field.options = field.options.map((item) => item.trim()).filter(Boolean);
          markFieldsDirty();
        });
      });
      list.querySelectorAll('[data-option-remove]').forEach((button) => button.addEventListener('click', () => {
        field.options.splice(Number(button.getAttribute('data-option-remove')), 1);
        markFieldsDirty();
        render();
      }));
      list.querySelectorAll('[data-option-up]').forEach((button) => button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-option-up'));
        if (index <= 0) return;
        [field.options[index - 1], field.options[index]] = [field.options[index], field.options[index - 1]];
        markFieldsDirty();
        render();
      }));
      list.querySelectorAll('[data-option-down]').forEach((button) => button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-option-down'));
        if (index >= field.options.length - 1) return;
        [field.options[index + 1], field.options[index]] = [field.options[index], field.options[index + 1]];
        markFieldsDirty();
        render();
      }));
    };
    const add = () => {
      const value = newInput.value.trim();
      if (!value) return;
      if (field.options.includes(value)) {
        toast('该选项已存在', 'error');
        return;
      }
      field.options.push(value);
      newInput.value = '';
      markFieldsDirty();
      render();
      newInput.focus();
    };
    handle.body.querySelector('#add-option').addEventListener('click', add);
    newInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
    render();
  }

  function openFieldForm(existing) {
    const isEdit = Boolean(existing);
    const isBuiltin = Boolean(existing?.builtin);
    const locked = Boolean(existing?.locked);
    const type = existing?.type || 'text';
    const optionsText = (existing?.options || []).join('\n');
    const handle = modal({
      title: isEdit ? `编辑字段「${existing.label}」` : '新增自定义字段',
      subtitle: isEdit ? (isBuiltin ? '内置字段：可改名称、必填、说明与下拉选项，标识和类型固定' : '自定义字段：可改名称、类型、必填与下拉选项') : '保存配置后，新建科研项目表单立即出现该字段',
      body: `
        <form id="field-form" class="col gap-12">
          <div class="field">
            <label class="label">字段名称 <span class="req">*</span></label>
            <input class="input" name="label" value="${escapeHtml(existing?.label || '')}" placeholder="如：合作单位、验收方式" />
          </div>
          ${isBuiltin
            ? `<div class="field"><div class="label">字段标识</div><div class="input mono" style="display:flex;align-items:center;background:var(--surface-2);color:var(--muted)">${escapeHtml(existing.key)}</div><div class="hint">内置字段标识不可修改</div></div>`
            : `<div class="field"><label class="label">字段标识</label><input class="input mono" name="key" value="${escapeHtml((existing?.key || '').replace(/^custom_/, ''))}" placeholder="如 partner，系统会自动加 custom_ 前缀" ${isEdit ? 'disabled' : ''} /><div class="hint">仅支持字母、数字、下划线；创建后不可修改</div></div>`}
          ${isBuiltin
            ? `<div class="field"><div class="label">字段类型</div><div class="row gap-8"><span class="tag tone-indigo">${fieldTypeLabel(type)}</span><span class="hint">内置字段类型不可修改</span></div></div>`
            : `<div class="field"><label class="label">字段类型</label><select class="select" name="type" id="field-type">${CUSTOM_FIELD_TYPES.map((item) => `<option value="${item}" ${item === type ? 'selected' : ''}>${fieldTypeLabel(item)}</option>`).join('')}</select></div>`}
          <div class="form-grid">
            <div class="field">
              <label class="label">所属分组</label>
              <select class="select" name="group">
                <option value="erp" ${(existing?.group || 'erp') === 'erp' ? 'selected' : ''}>ERP 基本信息</option>
                <option value="system" ${existing?.group === 'system' ? 'selected' : ''}>系统信息</option>
              </select>
            </div>
            <div class="field">
              <label class="label">OCR 识别关键词</label>
              <input class="input" name="ocrKeywords" value="${escapeHtml((existing?.ocrKeywords || []).join(', '))}" placeholder="如：项目名称, 顶目名称" />
              <div class="hint">用逗号分隔，OCR 按关键词找到对应值并回填；留空表示不参与识别</div>
            </div>
          </div>
          <div class="form-grid">
            <label class="switch">
              <input type="checkbox" name="required" ${existing?.required ? 'checked' : ''} ${locked ? 'disabled' : ''} />
              <span class="switch-track"></span>
              <span class="switch-label">设为必填</span>
            </label>
            <label class="switch">
              <input type="checkbox" name="full" ${existing?.full ? 'checked' : ''} />
              <span class="switch-track"></span>
              <span class="switch-label">整行显示</span>
            </label>
          </div>
          <div class="field" id="field-options-wrap" style="${type === 'select' ? '' : 'display:none'}">
            <label class="label">下拉选项</label>
            <textarea class="textarea" name="options" rows="4" placeholder="每行一个选项，例如：&#10;集团级&#10;公司级&#10;部门级">${escapeHtml(optionsText)}</textarea>
            <div class="hint">每行一个选项，保存配置后新建/编辑项目按下拉显示</div>
          </div>
          <div class="field">
            <label class="label">占位提示</label>
            <input class="input" name="placeholder" value="${escapeHtml(existing?.placeholder || '')}" placeholder="输入框内的灰色提示文字" />
          </div>
          <div class="field">
            <label class="label">字段说明</label>
            <input class="input" name="hint" value="${escapeHtml(existing?.hint || '')}" placeholder="显示在输入框下方的说明文字" />
          </div>
        </form>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>${isEdit ? '保存字段' : '添加字段'}</button>`
    });

    const form = handle.body.querySelector('#field-form');
    const typeSelect = form.querySelector('#field-type');
    const optionsWrap = form.querySelector('#field-options-wrap');
    const toggleOptions = () => {
      const current = typeSelect ? typeSelect.value : type;
      optionsWrap.style.display = current === 'select' ? '' : 'none';
    };
    typeSelect?.addEventListener('change', toggleOptions);

    handle.footer.querySelector('[data-save]').addEventListener('click', () => {
      const values = formValues(form);
      const label = String(values.label || '').trim();
      if (!label) return toast('请填写字段名称', 'error');
      const nextType = isBuiltin ? type : (values.type || 'text');
      const group = values.group === 'system' ? 'system' : 'erp';
      const ocrKeywords = String(values.ocrKeywords || '')
        .split(/[,，、\n]/)
        .map((item) => item.replace(/\s+/g, '').trim())
        .filter(Boolean)
        .slice(0, 20);
      const options = String(values.options || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      if (nextType === 'select' && options.length === 0) {
        return toast('下拉字段至少需要一个选项', 'error');
      }

      if (isEdit) {
        existing.label = label;
        existing.group = group;
        existing.ocrKeywords = ocrKeywords;
        existing.full = !!values.full;
        existing.placeholder = String(values.placeholder || '').slice(0, 120);
        existing.hint = String(values.hint || '').slice(0, 240);
        if (!locked) existing.required = !!values.required;
        if (isBuiltin) {
          existing.options = nextType === 'select' ? options : [];
        } else {
          existing.type = nextType;
          existing.options = nextType === 'select' ? options : [];
        }
      } else {
        const rawKey = String(values.key || '').trim().replace(/^custom_/i, '');
        if (!/^[a-zA-Z][a-zA-Z0-9_]{1,30}$/.test(rawKey)) {
          return toast('字段标识需以字母开头，仅包含字母、数字和下划线', 'error');
        }
        const key = `custom_${rawKey.toLowerCase()}`;
        if (state.projectFields.some((field) => field.key === key)) {
          return toast(`字段标识 ${key} 已存在`, 'error');
        }
        const created = {
          id: `pf-${Date.now()}`,
          key,
          label,
          type: nextType,
          required: !!values.required,
          enabled: true,
          builtin: false,
          locked: false,
          full: !!values.full,
          group,
          placeholder: String(values.placeholder || '').slice(0, 120),
          hint: String(values.hint || '').slice(0, 240),
          options: nextType === 'select' ? options : [],
          ocrKeywords,
          seq: state.projectFields.length + 1
        };
        if (group === 'system') {
          state.projectFields.push(created);
        } else {
          // ERP 字段排在“备注”之前，避免被长文本域挤到表单最底部
          const descIndex = state.projectFields.findIndex((field) => field.key === 'description');
          if (descIndex >= 0) state.projectFields.splice(descIndex, 0, created);
          else state.projectFields.push(created);
        }
        state.projectFields.forEach((field, index) => { field.seq = index + 1; });
      }
      markFieldsDirty();
      paintFields();
      handle.close();
    });
  }

  async function saveFields() {
    const saveBtn = actions.querySelector('[data-save-fields]');
    setBusy(saveBtn, true, '保存中…');
    try {
      const payload = state.projectFields.map((field, index) => ({ ...field, seq: index + 1 }));
      const result = await api('/project-fields', { method: 'PUT', body: { fields: payload } });
      state.projectFields = result.fields;
      state.fieldsDirty = false;
      await loadOptions(true).catch(() => null);
      paintFields();
      toast('项目字段配置已保存，新建项目表单立即生效', 'success', 3600);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(saveBtn, false);
      updateFieldSaveState();
    }
  }

  async function resetFields() {
    if (state.fieldsDirty) {
      const ok = await confirmDialog({
        title: '放弃未保存的字段修改？',
        message: '当前字段配置有未保存的修改，重置后会丢失。',
        confirmText: '放弃修改', tone: 'danger'
      });
      if (!ok) return;
    }
    const data = await api('/project-fields');
    state.projectFields = data.fields;
    state.fieldsDirty = false;
    paintFields();
    toast('已恢复为最近一次保存的字段配置', 'info');
  }

  /* ---------------- 菜单管理 ---------------- */
  function updateMenuSaveState() {
    const saveBtn = actions.querySelector('[data-save-menus]');
    const saveState = actions.querySelector('#menu-save-state');
    if (!saveBtn || !saveState) return;
    saveBtn.disabled = !state.menusDirty;
    saveState.classList.toggle('dirty', state.menusDirty);
    saveState.innerHTML = state.menusDirty
      ? '<span class="dot"></span><span>有未保存的修改</span>'
      : '<span class="dot"></span><span>配置已同步</span>';
  }

  function markMenusDirty() {
    state.menusDirty = true;
    updateMenuSaveState();
  }

  function paintMenus() {
    const groups = [...new Set(state.menus.map((menu) => menu.group))];
    body.innerHTML = `
      <div class="field-config-tip">
        ${icon('info')}
        <div>菜单停用后，左侧导航会隐藏对应入口，直接访问地址也会提示“该菜单已停用”。「运行总览」「项目台账」「系统管理」为锁定菜单，避免管理员把自己锁在系统外。</div>
      </div>
      ${groups.map((group) => `
        <div class="menu-config-group">
          <div class="menu-group-title">${escapeHtml(group)}</div>
          ${state.menus.filter((menu) => menu.group === group).map((menu) => `
            <div class="menu-config-row ${menu.enabled ? '' : 'disabled'}" data-menu-row="${escapeHtml(menu.key)}">
              <div class="menu-config-main">
                <div class="menu-config-label">
                  ${escapeHtml(menu.label)}
                  ${menu.locked ? '<span class="tag tone-amber">锁定</span>' : ''}
                </div>
                <div class="menu-config-path mono">${escapeHtml(menu.key)}</div>
              </div>
              <label class="switch">
                <input type="checkbox" data-menu-toggle="${escapeHtml(menu.key)}" ${menu.enabled ? 'checked' : ''} ${menu.locked ? 'disabled' : ''} />
                <span class="switch-track"></span>
                <span class="switch-label">${menu.enabled ? '启用' : '停用'}</span>
              </label>
            </div>`).join('')}
        </div>`).join('')}
      <div class="hint" style="margin-top:12px">共 ${state.menus.length} 个菜单，当前启用 ${state.menus.filter((menu) => menu.enabled).length} 个；保存后页面会自动刷新。</div>`;
    body.querySelectorAll('[data-menu-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const menu = state.menus.find((item) => item.key === input.getAttribute('data-menu-toggle'));
        if (!menu) return;
        menu.enabled = input.checked;
        const row = input.closest('.menu-config-row');
        row.classList.toggle('disabled', !menu.enabled);
        row.querySelector('.switch-label').textContent = menu.enabled ? '启用' : '停用';
        markMenusDirty();
      });
    });
    updateMenuSaveState();
  }

  async function renderMenus() {
    body.innerHTML = '<div class="center" style="padding:30px"><span class="spinner"></span></div>';
    actions.innerHTML = `
      <span class="save-state" id="menu-save-state"><span class="dot"></span><span>配置已同步</span></span>
      <button class="btn btn-ghost btn-sm" type="button" data-reset-menus>${icon('rotate')}重置</button>
      <button class="btn btn-primary btn-sm" type="button" data-save-menus disabled>${icon('save')}保存菜单</button>`;
    try {
      const data = await api('/menus');
      state.menus = data.items;
      state.menusDirty = false;
      paintMenus();
      actions.querySelector('[data-reset-menus]').addEventListener('click', async () => {
        if (state.menusDirty) {
          const ok = await confirmDialog({
            title: '放弃未保存的菜单修改？',
            message: '当前菜单启停有未保存的修改，重置后会丢失。',
            confirmText: '放弃修改', tone: 'danger'
          });
          if (!ok) return;
        }
        const fresh = await api('/menus');
        state.menus = fresh.items;
        state.menusDirty = false;
        paintMenus();
      });
      actions.querySelector('[data-save-menus]').addEventListener('click', async () => {
        const button = actions.querySelector('[data-save-menus]');
        setBusy(button, true, '保存中…');
        try {
          const result = await api('/menus', { method: 'PUT', body: { menus: state.menus } });
          state.menus = result.items;
          state.menusDirty = false;
          await loadOptions(true).catch(() => null);
          paintMenus();
          toast('菜单配置已保存，页面即将刷新', 'success', 2200);
          setTimeout(() => location.reload(), 900);
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          setBusy(button, false);
          updateMenuSaveState();
        }
      });
    } catch (error) {
      body.innerHTML = emptyBlock({ iconName: 'alertTriangle', title: '菜单配置加载失败', text: error.message });
    }
  }

  wrap.querySelector('[data-reset-demo]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '重置演示数据',
      message: '将重新生成部门、账号、模板、项目与附件数据，当前所有修改会丢失。',
      detail: '该操作需要重新登录。',
      tone: 'danger', confirmText: '重置数据'
    });
    if (!ok) return;
    try {
      await api('/system/reset-demo', { method: 'POST' });
      invalidateAlerts();
      await loadAlerts(true).catch(() => null);
      toast('演示数据已重置，正在刷新…', 'success');
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  bindTabs();
  await renderTab();
  return wrap;
}
