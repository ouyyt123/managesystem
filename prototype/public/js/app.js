import { api, ApiError } from './core/api.js';
import { session, setSession, setUser, clearSession, isLoggedIn } from './core/session.js';
import { loadAlerts, loadOptions, displayLink } from './core/data.js';
import { icon } from './core/icons.js';
import { escapeHtml, roleTone, ROLES } from './core/format.js';
import { toast, modal, formValues, setBusy, emptyBlock } from './core/ui.js';

import * as loginView from './views/login.js';
import * as dashboardView from './views/dashboard.js';
import * as projectsView from './views/projects.js';
import * as projectDetailView from './views/project-detail.js';
import * as templatesView from './views/templates.js';
import * as quarterlyView from './views/quarterly.js';
import * as alertsView from './views/alerts.js';
import * as categoryView from './views/category.js';
import * as systemView from './views/system.js';
import * as displayView from './views/display.js';

const ROUTES = [
  { path: '/', title: '运行总览', view: dashboardView.render },
  { path: '/projects', title: '项目台账', view: projectsView.render },
  { path: '/projects/:id', title: '项目详情', view: projectDetailView.render },
  { path: '/categories/:code', title: '分类材料台账', view: categoryView.render },
  { path: '/quarterly', title: '季度执行', view: quarterlyView.render },
  { path: '/alerts', title: '逾期提醒', view: alertsView.render },
  { path: '/templates', title: '流程模板', view: templatesView.render, roles: ['ADMIN', 'RESEARCH_MANAGER'] },
  { path: '/system', title: '系统管理', view: systemView.render, roles: ['ADMIN', 'RESEARCH_MANAGER'] }
];

const NAV_GROUPS = [
  {
    label: '概览',
    items: [{ path: '/', label: '运行总览', icon: 'activity' }]
  },
  {
    label: '项目',
    items: [
      { path: '/projects', label: '项目台账', icon: 'folder' },
      { path: '/categories/INITIATION', label: '立项管理', icon: 'flag' }
    ]
  },
  {
    label: '过程执行',
    items: [
      { path: '/quarterly', label: '季度执行', icon: 'calendar' },
      { path: '/categories/PROCUREMENT', label: '采购管理', icon: 'cart' },
      { path: '/categories/CHANGE', label: '变更管理', icon: 'branch' },
      { path: '/categories/TESTING', label: '检测报告', icon: 'flask' },
      { path: '/categories/IP', label: '知识产权', icon: 'bulb' }
    ]
  },
  {
    label: '验收归档',
    items: [
      { path: '/categories/ACCEPTANCE', label: '验收管理', icon: 'checkSquare' },
      { path: '/categories/ARCHIVE', label: '成果归档', icon: 'archive' }
    ]
  },
  {
    label: '协同',
    items: [{ path: '/alerts', label: '逾期提醒', icon: 'bell', badge: true }]
  },
  {
    label: '配置',
    items: [
      { path: '/templates', label: '流程模板', icon: 'layout', roles: ['ADMIN', 'RESEARCH_MANAGER'] },
      { path: '/system', label: '系统管理', icon: 'settings', roles: ['ADMIN', 'RESEARCH_MANAGER'] }
    ]
  }
];

function matchRoute(pathname) {
  for (const route of ROUTES) {
    const keys = [];
    const pattern = route.path.replace(/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${pattern}$`);
    const match = pathname.match(regex);
    if (match) {
      const params = {};
      keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); });
      return { route, params };
    }
  }
  return null;
}

function activeFor(pathname) {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/projects/')) return '/projects';
  if (pathname.startsWith('/categories/')) return pathname;
  return pathname;
}

function menuEnabled(path) {
  const menus = session.options?.menus;
  if (!Array.isArray(menus) || !menus.length) return true;
  const found = menus.find((menu) => menu.key === path);
  return found ? found.enabled !== false : true;
}

function menuKeyForPath(path) {
  if (path === '/') return '/';
  if (path.startsWith('/projects')) return '/projects';
  if (path.startsWith('/categories/')) return path;
  return path;
}

function sidebarHTML(active, user) {
  const groups = NAV_GROUPS.map((group) => {
    const items = group.items.filter((item) => (!item.roles || item.roles.includes(user.role)) && menuEnabled(item.path));
    if (!items.length) return '';
    return `
      <div class="nav-group">
        <div class="nav-label">${group.label}</div>
        ${items.map((item) => {
          const on = active === item.path || (item.path === '/' && active === '');
          const badge = item.badge && session.alerts?.summary?.total
            ? `<span class="count-badge nav-badge">${session.alerts.summary.total}</span>` : '';
          return `<a class="nav-item ${on ? 'active' : ''}" href="${item.path}" data-link>${icon(item.icon)}<span>${item.label}</span>${badge}</a>`;
        }).join('')}
      </div>`;
  }).join('');
  const displayEntry = menuEnabled('/display')
    ? `<div class="nav-group">
        <div class="nav-label">展示</div>
        <a class="nav-item" href="${displayLink()}" target="_blank" rel="noopener">${icon('monitor')}<span>展示大屏</span>${icon('external', 'ic-sm right')}</a>
      </div>`
    : '';
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark">${icon('layers', 'ic-lg')}</div>
        <div class="brand-text">
          <div class="brand-title">科研材料管理</div>
          <div class="brand-sub">RESEARCH MATERIAL HUB</div>
        </div>
      </div>
      <div class="sidebar-scroll">${groups}${displayEntry}
      </div>
      <div class="sidebar-footer">
        <div class="user-card" id="user-menu">
          <span class="avatar tone-${roleTone(user.role)}">${escapeHtml(String(user.name).slice(-2))}</span>
          <div class="user-meta">
            <div class="user-name">${escapeHtml(user.name)}</div>
            <div class="user-role">${escapeHtml(ROLES[user.role]?.name || user.role)}</div>
          </div>
          ${icon('more')}
        </div>
      </div>
    </aside>`;
}

function topbarHTML(title, user) {
  const alertCount = session.alerts?.summary?.total || 0;
  return `
    <header class="topbar">
      <div class="crumb">${icon('home')}<span>科研项目管理</span>${icon('chevronRight')}<strong>${escapeHtml(title)}</strong></div>
      <form class="topbar-search" id="global-search" role="search">
        <div class="input-group">
          ${icon('search')}
          <input class="input" name="keyword" placeholder="搜索项目编号 / 名称…" autocomplete="off" />
        </div>
      </form>
      <div class="topbar-actions">
        <button class="icon-btn" type="button" data-goto="/alerts" title="提醒中心">
          ${icon('bell')}
          ${alertCount ? `<span class="notice-dot"></span>` : ''}
        </button>
        <div class="topbar-user" id="user-chip">
          <span class="avatar sm tone-${roleTone(user.role)}">${escapeHtml(String(user.name).slice(-2))}</span>
          <div class="user-meta">
            <div class="user-name">${escapeHtml(user.name)}</div>
            <div class="user-role">${escapeHtml(ROLES[user.role]?.name || user.role)}</div>
          </div>
          ${icon('chevronDown', 'ic-sm')}
        </div>
      </div>
    </header>`;
}

function mountChrome() {
  document.querySelectorAll('[data-link]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      navigate(el.getAttribute('href'));
    });
  });
  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.getAttribute('data-goto')));
  });
  const search = document.getElementById('global-search');
  if (search) {
    search.addEventListener('submit', (event) => {
      event.preventDefault();
      const keyword = search.querySelector('input').value.trim();
      navigate(keyword ? `/projects?keyword=${encodeURIComponent(keyword)}` : '/projects');
    });
  }
  document.getElementById('user-chip')?.addEventListener('click', openAccountModal);
  document.getElementById('user-menu')?.addEventListener('click', openAccountModal);
}

function openAccountModal() {
  const user = session.user;
  if (!user) return;
  const handle = modal({
    title: '账号信息',
    subtitle: '当前登录身份与权限范围',
    body: `
      <div class="row gap-16" style="align-items:flex-start">
        <span class="avatar lg tone-${roleTone(user.role)}">${escapeHtml(String(user.name).slice(-2))}</span>
        <div style="flex:1;min-width:0">
          <div class="row-between">
            <div>
              <div class="strong" style="font-size:15px">${escapeHtml(user.name)}</div>
              <div class="hint">${escapeHtml(user.username)} · ${escapeHtml(user.title || '—')}</div>
            </div>
            <span class="pill tone-${roleTone(user.role)}"><span class="pill-dot"></span>${escapeHtml(ROLES[user.role]?.name || user.role)}</span>
          </div>
          <div class="info-grid" style="margin-top:12px">
            <div class="info-row"><div class="k">所属部门</div><div class="v">${escapeHtml(user.deptName || '—')}</div></div>
            <div class="info-row"><div class="k">角色编码</div><div class="v mono">${escapeHtml(user.role)}</div></div>
            <div class="info-row"><div class="k">邮箱</div><div class="v">${escapeHtml(user.email || '—')}</div></div>
            <div class="info-row"><div class="k">最近登录</div><div class="v">${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '—'}</div></div>
          </div>
          <div class="hint" style="margin-top:12px">${user.role === 'PROJECT_MANAGER' ? '项目经理仅可维护本人负责的项目，系统会自动收敛数据范围。' : user.role === 'VIEWER' ? '查看角色仅可浏览数据与展示大屏，不能进行写操作。' : '该角色可查看全部项目并执行管理与配置操作。'}</div>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-secondary" type="button" data-password>${icon('key')}修改密码</button>
      <button class="btn btn-danger" type="button" data-logout>${icon('logout')}退出登录</button>`
  });
  handle.footer.querySelector('[data-password]').addEventListener('click', () => {
    handle.close();
    openPasswordModal();
  });
  handle.footer.querySelector('[data-logout]').addEventListener('click', () => {
    clearSession();
    handle.close();
    navigate('/login', { replace: true });
  });
}

function openPasswordModal() {
  const handle = modal({
    title: '修改密码',
    subtitle: '修改成功后需要重新登录其他设备',
    size: 'narrow',
    body: `
      <form id="password-form" class="col gap-12">
        <div class="field">
          <label class="label">原密码</label>
          <input class="input" type="password" name="oldPassword" placeholder="请输入当前密码" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="label">新密码</label>
          <input class="input" type="password" name="newPassword" placeholder="至少 6 位" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="label">确认新密码</label>
          <input class="input" type="password" name="confirmPassword" placeholder="再次输入新密码" autocomplete="new-password" />
        </div>
      </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>确认修改</button>`,
    onMount: (body, h) => {
      h.footer.querySelector('[data-save]').addEventListener('click', async () => {
        const values = formValues(body);
        if (!values.oldPassword || !values.newPassword) return toast('请填写原密码与新密码', 'error');
        if (values.newPassword.length < 6) return toast('新密码至少 6 位', 'error');
        if (values.newPassword !== values.confirmPassword) return toast('两次输入的新密码不一致', 'error');
        const button = h.footer.querySelector('[data-save]');
        setBusy(button, true, '提交中…');
        try {
          await api('/auth/password', { method: 'POST', body: { oldPassword: values.oldPassword, newPassword: values.newPassword } });
          toast('密码已修改，请使用新密码登录', 'success');
          h.close();
          clearSession();
          navigate('/login', { replace: true });
        } catch (error) {
          toast(error.message, 'error');
          setBusy(button, false);
        }
      });
    }
  });
}

export function navigate(to, { replace = false } = {}) {
  if (!to) return;
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  render().catch((error) => {
    console.error(error);
    toast(error.message || '页面加载失败', 'error');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function ensureUser() {
  if (session.user) return session.user;
  const data = await api('/auth/me');
  setUser(data.user);
  return data.user;
}

async function renderShell({ route, params, query, path, user }) {
  const app = document.getElementById('app');
  const pageEl = document.createElement('main');
  pageEl.className = 'page';
  pageEl.id = 'page';
  const active = activeFor(path);
  app.className = 'app-root';
  app.innerHTML = `<div class="shell">${sidebarHTML(active, user)}<div class="main">${topbarHTML(route.title, user)}<main class="page" id="page"></main></div></div>`;
  const host = document.getElementById('page');
  let content;
  try {
    content = await route.view({ params, query, user, path, navigate });
  } catch (error) {
    console.error(error);
    content = document.createElement('div');
    content.innerHTML = `<div class="card card-body">${emptyBlock({ iconName: 'alertTriangle', title: '页面加载失败', text: error.message || '请稍后重试', action: `<button class="btn btn-secondary" type="button" onclick="location.reload()">重新加载</button>` })}</div>`;
    toast(error.message || '页面加载失败', 'error');
  }
  if (content instanceof Node) host.appendChild(content);
  else if (typeof content === 'string') host.innerHTML = content;
  mountChrome();
  document.title = `${route.title} · 科研项目材料管理系统`;
  void pageEl;
}

function statusPage({ title, message, iconName = 'alertTriangle', action = '', code = '提示' }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${code}</div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <div class="page-sub">${escapeHtml(message)}</div>
      </div>
    </div>
    <div class="card card-body">
      ${emptyBlock({ iconName, title, text: message, action })}
    </div>`;
  return wrap;
}

async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams(location.search).entries());

  if (path === '/display') {
    document.title = '展示大屏 · 科研项目材料管理系统';
    const el = await displayView.render({ query, navigate });
    document.getElementById('app').replaceChildren(el);
    return;
  }

  if (path === '/login') {
    if (isLoggedIn()) {
      navigate('/', { replace: true });
      return;
    }
    document.title = '登录 · 科研项目材料管理系统';
    const el = await loginView.render({ query });
    document.getElementById('app').replaceChildren(el);
    return;
  }

  if (!isLoggedIn()) {
    const next = encodeURIComponent(location.pathname + location.search);
    history.replaceState({}, '', `/login?next=${next}`);
    await render();
    return;
  }

  try {
    const user = await ensureUser();
    await loadOptions().catch(() => null);
    await loadAlerts().catch(() => null);
    const matched = matchRoute(path);
    if (!matched) {
      const el = statusPage({ title: '页面不存在', message: `没有找到 ${path} 对应的页面`, iconName: 'inbox', code: '404' });
      const app = document.getElementById('app');
      app.innerHTML = `<div class="shell">${sidebarHTML('', user)}<div class="main">${topbarHTML('页面不存在', user)}<main class="page" id="page"></main></div></div>`;
      document.getElementById('page').appendChild(el);
      mountChrome();
      return;
    }
    const { route, params } = matched;
    if (route.roles && !route.roles.includes(user.role)) {
      const app = document.getElementById('app');
      app.innerHTML = `<div class="shell">${sidebarHTML(activeFor(path), user)}<div class="main">${topbarHTML(route.title, user)}<main class="page" id="page"></main></div></div>`;
      document.getElementById('page').appendChild(statusPage({
        title: '无权访问该模块',
        message: `当前角色（${ROLES[user.role]?.name || user.role}）没有访问「${route.title}」的权限。`,
        iconName: 'lock',
        code: '403',
        action: `<button class="btn btn-primary" type="button" data-back>返回运行总览</button>`
      }));
      document.querySelector('[data-back]')?.addEventListener('click', () => navigate('/'));
      mountChrome();
      return;
    }
    const menuKey = menuKeyForPath(path);
    if (menuKey && !menuEnabled(menuKey)) {
      const app = document.getElementById('app');
      app.innerHTML = `<div class="shell">${sidebarHTML(activeFor(path), user)}<div class="main">${topbarHTML(route.title, user)}<main class="page" id="page"></main></div></div>`;
      document.getElementById('page').appendChild(statusPage({
        title: '该菜单已停用',
        message: `管理员已在「系统管理 → 菜单管理」中停用「${route.title}」。如需使用，请联系系统管理员启用。`,
        iconName: 'lock',
        code: '菜单停用',
        action: '<button class="btn btn-primary" type="button" data-back>返回运行总览</button>'
      }));
      document.querySelector('[data-back]')?.addEventListener('click', () => navigate('/'));
      mountChrome();
      return;
    }
    await renderShell({ route, params, query, path, user });  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    console.error(error);
    toast(error.message || '系统异常', 'error');
  }
}

async function bootstrap() {
  window.addEventListener('popstate', () => {
    render().catch((error) => console.error(error));
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(link.getAttribute('href'));
  });
  if (isLoggedIn()) {
    try {
      const data = await api('/auth/me');
      setUser(data.user);
    } catch {
      clearSession();
    }
  }
  await render();
}

bootstrap();
