import { api } from '../core/api.js';
import { loadAlerts, invalidateAlerts } from '../core/data.js';
import { icon } from '../core/icons.js';
import { escapeHtml, dateText, statusPill, CATEGORIES, categoryPill } from '../core/format.js';
import { emptyBlock, debounce } from '../core/ui.js';

const TABS = [
  { key: 'all', label: '全部提醒' },
  { key: 'material', label: '逾期材料' },
  { key: 'quarterly', label: '逾期报表' },
  { key: 'upcoming', label: '30 天内到期' }
];

function summaryCard({ label, value, iconName, tone, foot }) {
  const bg = { rose: '#feecef', amber: '#fef4e5', indigo: '#eef0ff', slate: '#eef2f8' }[tone] || '#eef2f8';
  const fg = { rose: '#e11d48', amber: '#d97706', indigo: '#4f46e5', slate: '#475569' }[tone] || '#475569';
  return `
    <div class="alert-stat">
      <span class="ring" style="background:${bg};color:${fg}">${icon(iconName)}</span>
      <div>
        <div class="lbl">${escapeHtml(label)}</div>
        <div class="val">${value}</div>
        <div class="hint" style="margin-top:1px">${escapeHtml(foot)}</div>
      </div>
    </div>`;
}

export async function render({ user, navigate }) {
  const wrap = document.createElement('div');
  const state = { tab: 'all', keyword: '', items: [], summary: {} };

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Alerts · 逾期提醒</div>
        <h1 class="page-title">逾期与到期提醒</h1>
        <div class="page-sub">实时计算，不依赖定时任务。${user.role === 'PROJECT_MANAGER' ? '当前仅显示本人负责项目的提醒。' : '当前显示全部项目的提醒。'} 点击“去补传 / 去补报”可直接打开对应处理窗口。</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" type="button" data-refresh>${icon('refresh')}刷新</button>
      </div>
    </div>

    <div class="alert-summary" id="alert-summary"></div>

    <div class="card">
      <div class="card-head" style="align-items:center;flex-wrap:wrap;gap:12px">
        <div class="chip-row" id="alert-tabs">
          ${TABS.map((tab) => `<button class="chip ${tab.key === 'all' ? 'on' : ''}" type="button" data-tab="${tab.key}">${tab.label}<span class="n" data-count="${tab.key}"></span></button>`).join('')}
        </div>
        <div class="input-group search-box right" style="width:240px">
          ${icon('search')}
          <input class="input" id="alert-keyword" placeholder="搜索项目 / 材料" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>类型</th>
              <th style="min-width:260px">事项</th>
              <th>项目</th>
              <th>部门</th>
              <th>截止日期</th>
              <th>时效</th>
              <th class="right">处理</th>
            </tr>
          </thead>
          <tbody id="alert-body"></tbody>
        </table>
      </div>
      <div class="card-foot"><span id="alert-foot" class="small muted"></span></div>
    </div>`;

  const tbody = wrap.querySelector('#alert-body');
  const summaryEl = wrap.querySelector('#alert-summary');
  const footEl = wrap.querySelector('#alert-foot');

  const load = async (force = true) => {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><span class="spinner"></span></div></td></tr>`;
    try {
      if (force) {
        invalidateAlerts();
        await loadAlerts(true);
      }
      const params = new URLSearchParams();
      if (state.tab === 'material') { params.set('type', 'MATERIAL'); params.set('status', 'OVERDUE'); }
      if (state.tab === 'quarterly') { params.set('type', 'QUARTERLY'); params.set('status', 'OVERDUE'); }
      if (state.tab === 'upcoming') params.set('status', 'UPCOMING');
      if (state.keyword) params.set('keyword', state.keyword);
      const data = await api(`/alerts?${params.toString()}`);
      state.items = data.items;
      state.summary = data.summary;

      const s = data.summary;
      summaryEl.innerHTML = [
        summaryCard({ label: '逾期材料', value: s.overdueMaterials, iconName: 'fileText', tone: 'rose', foot: '必备且已过截止日期' }),
        summaryCard({ label: '逾期报表', value: s.overdueQuarterly, iconName: 'calendar', tone: 'amber', foot: '季度执行情况表未提交' }),
        summaryCard({ label: '30 天内到期', value: s.upcoming, iconName: 'clock', tone: 'indigo', foot: '材料与报表合计' }),
        summaryCard({ label: '逾期总数', value: s.total, iconName: 'alertTriangle', tone: 'slate', foot: '材料 + 报表' })
      ].join('');
      wrap.querySelector('[data-count="all"]').textContent = s.total + s.upcoming;
      wrap.querySelector('[data-count="material"]').textContent = s.overdueMaterials;
      wrap.querySelector('[data-count="quarterly"]').textContent = s.overdueQuarterly;
      wrap.querySelector('[data-count="upcoming"]').textContent = s.upcoming;

      tbody.innerHTML = state.items.length ? state.items.map((item) => {
        const overdue = item.status === 'OVERDUE';
        return `
          <tr>
            <td>
              <span class="tag ${item.type === 'MATERIAL' ? 'tone-indigo' : 'tone-amber'}">
                ${icon(item.type === 'MATERIAL' ? 'fileText' : 'calendar', 'ic-sm')}${item.type === 'MATERIAL' ? '材料' : '报表'}
              </span>
            </td>
            <td>
              <div class="cell-main">${escapeHtml(item.title)}</div>
              <div class="cell-sub">${item.category && item.category !== 'QUARTERLY' ? escapeHtml(CATEGORIES[item.category]?.name || '') : '季度执行'} · ${escapeHtml(item.stageName || '')}</div>
            </td>
            <td>
              <div>${escapeHtml(item.projectName)}</div>
              <div class="cell-sub mono">${escapeHtml(item.projectCode)}</div>
            </td>
            <td class="small">${escapeHtml(item.deptName)}</td>
            <td class="num">${dateText(item.dueDate)}</td>
            <td>
              ${overdue
                ? `<span class="tag tone-rose">逾期 ${item.overdueDays} 天</span>`
                : `<span class="tag tone-amber">${item.daysLeft} 天后到期</span>`}
            </td>
            <td>
              <div class="actions">
                <button class="btn btn-xs ${overdue ? 'btn-soft' : 'btn-ghost'}" type="button" data-handle="${item.projectId}" data-open="${item.type === 'MATERIAL' ? 'material' : 'quarterly'}:${item.id}">
                  ${item.type === 'MATERIAL' ? '去补传' : '去补报'}${icon('arrowRight')}
                </button>
              </div>
            </td>
          </tr>`;
      }).join('') : `<tr><td colspan="7"><div class="table-empty">${emptyBlock({
        iconName: 'checkCircle', title: state.tab === 'upcoming' ? '近期没有到期事项' : '没有逾期事项',
        text: state.tab === 'all' ? '所有材料与季度报表均在期限内。' : '切换筛选条件可查看其他提醒。'
      })}</div></td></tr>`;

      tbody.querySelectorAll('[data-handle]').forEach((el) => el.addEventListener('click', () => {
        const open = el.getAttribute('data-open');
        navigate(`/projects/${el.getAttribute('data-handle')}?open=${encodeURIComponent(open)}`);
      }));
      footEl.textContent = `共 ${state.items.length} 条提醒${state.keyword ? ` · 关键字“${state.keyword}”` : ''}`;
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty">${emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message })}</div></td></tr>`;
    }
  };

  wrap.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => {
    state.tab = el.getAttribute('data-tab');
    wrap.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('on', tab === el));
    load();
  }));
  wrap.querySelector('#alert-keyword').addEventListener('input', debounce((event) => {
    state.keyword = event.target.value.trim();
    load();
  }, 280));
  wrap.querySelector('[data-refresh]').addEventListener('click', () => load(true));
  await load();
  return wrap;
}
