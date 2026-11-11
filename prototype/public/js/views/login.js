import { api } from '../core/api.js';
import { setSession } from '../core/session.js';
import { icon } from '../core/icons.js';
import { escapeHtml, ROLES } from '../core/format.js';

const DEMO = [
  { username: 'admin', name: '系统管理员', role: 'ADMIN' },
  { username: 'keyan', name: '赵文', role: 'RESEARCH_MANAGER' },
  { username: 'zhangwei', name: '张伟', role: 'PROJECT_MANAGER' },
  { username: 'viewer', name: '孙立', role: 'VIEWER' }
];

export async function render({ query }) {
  const wrap = document.createElement('div');
  wrap.className = 'auth';
  wrap.innerHTML = `
    <section class="auth-art">
      <div class="auth-brand">
        <div class="brand-mark">${icon('layers', 'ic-lg')}</div>
        <div>
          <div class="auth-brand-title">科研项目材料管理系统</div>
          <div class="auth-brand-sub">RESEARCH MATERIAL HUB</div>
        </div>
      </div>
      <div class="auth-copy">
        <span class="auth-eyebrow">${icon('sparkles', 'ic-sm')} 项目 · 节点 · 材料 · 经费 一体化</span>
        <h1 class="auth-title">让每一份科研材料<br />都<em>如期归集</em></h1>
        <p class="auth-desc">以“项目—流程节点—节点材料—附件”为主线，配合季度执行、经费台账与逾期提醒，把分散在个人电脑与聊天工具中的材料收拢成一本可追踪的台账。</p>
        <div class="auth-features">
          <div class="auth-feature">${icon('layout')}<div><div class="t">拖拽式流程模板</div><div class="s">节点周期、材料归属可视化调整</div></div></div>
          <div class="auth-feature">${icon('bell')}<div><div class="t">逾期与到期提醒</div><div class="s">实时计算，逾期补传全程留痕</div></div></div>
          <div class="auth-feature">${icon('calendarCheck')}<div><div class="t">季度执行报表</div><div class="s">按自然季度生成，截止日自动提醒</div></div></div>
          <div class="auth-feature">${icon('monitor')}<div><div class="t">门口展示大屏</div><div class="s">投入趋势、验收进展一屏掌握</div></div></div>
        </div>
      </div>
      <div class="auth-foot">
        <span>内部科研数据 · 请规范使用</span>
        <span>原型演示版 · 数据保存在本地</span>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="kicker">Sign in</div>
        <h2>登录工作台</h2>
        <div class="sub">使用科研管理账号登录，不同角色看到的数据范围不同。</div>
        <form class="auth-form" id="login-form" autocomplete="off">
          <div class="auth-error" id="login-error">${icon('alertCircle')}<span></span></div>
          <div class="field">
            <label class="label">账号</label>
            <div class="input-group">${icon('user')}<input class="input" name="username" placeholder="请输入账号，如 admin" autocomplete="username" /></div>
          </div>
          <div class="field">
            <label class="label">密码</label>
            <div class="input-group">${icon('lock')}
              <input class="input" name="password" type="password" placeholder="请输入密码" autocomplete="current-password" style="padding-right:44px" />
              <button class="icon-btn" type="button" id="toggle-password" style="position:absolute;right:3px;width:34px;height:34px;border:0" title="显示密码">${icon('eye', 'ic-sm')}</button>
            </div>
          </div>
          <button class="btn btn-primary btn-block auth-submit" type="submit" id="login-submit">进入工作台 ${icon('arrowRight')}</button>
        </form>
        <div class="demo-accounts">
          <div class="demo-title">演示账号 · 密码均为 123456</div>
          <div class="demo-grid">
            ${DEMO.map((item) => `
              <button class="demo-account" type="button" data-username="${item.username}">
                <span class="avatar sm tone-${ROLES[item.role].tone}">${escapeHtml(item.name.slice(-2))}</span>
                <span>
                  <span class="name">${escapeHtml(item.name)}</span>
                  <span class="role" style="display:block">${escapeHtml(ROLES[item.role].name)}</span>
                </span>
              </button>`).join('')}
          </div>
        </div>
        <div class="auth-note">原型演示环境 · 不支持找回密码，请联系管理员重置</div>
      </div>
    </section>`;

  const form = wrap.querySelector('#login-form');
  const errorBox = wrap.querySelector('#login-error');
  const submit = wrap.querySelector('#login-submit');

  const showError = (message) => {
    errorBox.querySelector('span').textContent = message;
    errorBox.classList.add('show');
  };
  const clearError = () => errorBox.classList.remove('show');

  wrap.querySelector('#toggle-password').addEventListener('click', (event) => {
    const input = form.querySelector('input[name="password"]');
    input.type = input.type === 'password' ? 'text' : 'password';
    event.currentTarget.innerHTML = input.type === 'password' ? icon('eye', 'ic-sm') : icon('lock', 'ic-sm');
  });

  wrap.querySelectorAll('[data-username]').forEach((button) => {
    button.addEventListener('click', () => {
      form.querySelector('input[name="username"]').value = button.getAttribute('data-username');
      form.querySelector('input[name="password"]').value = '123456';
      form.querySelector('input[name="password"]').focus();
      clearError();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const username = form.querySelector('input[name="username"]').value.trim();
    const password = form.querySelector('input[name="password"]').value;
    if (!username || !password) {
      showError('请输入账号和密码');
      return;
    }
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner light" style="width:14px;height:14px"></span>正在登录…';
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      setSession(data.token, data.user);
      const next = query.next && query.next.startsWith('/') ? query.next : '/';
      location.replace(next);
    } catch (error) {
      showError(error.message || '登录失败，请稍后重试');
      submit.disabled = false;
      submit.innerHTML = `进入工作台 ${icon('arrowRight')}`;
    }
  });

  return wrap;
}
