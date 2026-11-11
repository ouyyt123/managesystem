import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, dateText, dateTimeText, statusPill, QUARTER_STATUS, PROJECT_STATUS
} from '../core/format.js';
import { emptyBlock, debounce } from '../core/ui.js';
import { openQuarterEditor } from '../components/quarter-editor.js';

function statCard(label, value, iconName, tone, foot = '') {
  return `
    <div class="alert-stat">
      <span class="ring" style="background:var(--surface-3);color:var(--${tone})">${icon(iconName)}</span>
      <div>
        <div class="lbl">${label}</div>
        <div class="val">${value}</div>
        ${foot ? `<div class="hint" style="margin-top:1px">${foot}</div>` : ''}
      </div>
    </div>`;
}

export async function render({ user, query, navigate }) {
  const wrap = document.createElement('div');
  const state = {
    year: query.year || '',
    quarter: query.quarter || '',
    status: query.status || '',
    keyword: query.keyword || '',
    items: [],
    summary: {},
    years: []
  };

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Quarterly report · 季度执行</div>
        <h1 class="page-title">季度执行情况</h1>
        <div class="page-sub">按自然季度生成执行报表，季度结束后第 15 天截止；逾期仍可补报，提交后保留提交人与时间。</div>
      </div>
      <div class="page-actions">
        <span class="pill tone-indigo"><span class="pill-dot"></span>季度末 + 15 天截止</span>
        <button class="btn btn-secondary" type="button" data-goto-alerts>${icon('bell')}查看提醒</button>
      </div>
    </div>

    <div class="alert-summary" id="quarter-summary"></div>

    <div class="card">
      <div class="card-head" style="align-items:center;flex-wrap:wrap">
        <div class="toolbar" style="flex:1">
          <div class="input-group search-box">
            ${icon('search')}
            <input class="input" id="q-keyword" placeholder="搜索项目编号 / 名称" value="${escapeHtml(state.keyword)}" />
          </div>
          <select class="select" id="q-year"><option value="">全部年度</option></select>
          <select class="select" id="q-quarter">
            <option value="">全部季度</option>
            ${[1, 2, 3, 4].map((q) => `<option value="${q}" ${String(state.quarter) === String(q) ? 'selected' : ''}>Q${q}</option>`).join('')}
          </select>
          <select class="select" id="q-status">
            <option value="">全部状态</option>
            ${Object.entries(QUARTER_STATUS).map(([code, item]) => `<option value="${code}" ${state.status === code ? 'selected' : ''}>${item.name}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" type="button" id="q-reset">${icon('rotate')}重置</button>
        </div>
        <div class="small muted" id="q-total"></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="min-width:240px">项目</th>
              <th>季度</th>
              <th>截止日期</th>
              <th>状态</th>
              <th style="min-width:220px">本期执行情况</th>
              <th>提交人</th>
              <th>附件</th>
              <th class="right">操作</th>
            </tr>
          </thead>
          <tbody id="q-body"></tbody>
        </table>
      </div>
      <div class="card-foot"><span class="small muted" id="q-foot"></span></div>
    </div>`;

  const tbody = wrap.querySelector('#q-body');
  const summaryEl = wrap.querySelector('#quarter-summary');
  const totalEl = wrap.querySelector('#q-total');
  const footEl = wrap.querySelector('#q-foot');

  const bindRows = () => {
    tbody.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => {
      openQuarterEditor(el.getAttribute('data-open'), {
        user,
        onSaved: () => load()
      });
    }));
  };

  const load = async () => {
    tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty"><span class="spinner"></span></div></td></tr>`;
    try {
      const params = new URLSearchParams();
      if (state.year) params.set('year', state.year);
      if (state.quarter) params.set('quarter', state.quarter);
      if (state.status) params.set('status', state.status);
      if (state.keyword) params.set('keyword', state.keyword);
      const data = await api(`/quarterly?${params.toString()}`);
      state.items = data.items;
      state.summary = data.summary;
      state.years = data.years || [];
      const yearSelect = wrap.querySelector('#q-year');
      if (yearSelect.options.length <= 1) {
        state.years.forEach((year) => {
          const option = document.createElement('option');
          option.value = String(year);
          option.textContent = `${year} 年`;
          yearSelect.appendChild(option);
        });
        yearSelect.value = state.year;
      }

      summaryEl.innerHTML = [
        statCard('报表总数', data.summary.total, 'calendar', 'primary', '范围内全部季度行'),
        statCard('已提交', data.summary.submitted, 'checkCircle', 'emerald', `逾期提交 ${data.summary.late} 期`),
        statCard('已逾期', data.summary.overdue, 'alertTriangle', 'rose', '需尽快补报'),
        statCard('未到期', data.summary.pending, 'clock', 'amber', '尚未到截止日期')
      ].join('');
      totalEl.textContent = `共 ${data.summary.total} 期报表`;
      footEl.textContent = `当前筛选：${[state.year ? `${state.year} 年` : '', state.quarter ? `Q${state.quarter}` : '', state.status ? QUARTER_STATUS[state.status]?.name : ''].filter(Boolean).join(' · ') || '全部'}`;

      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty">${emptyBlock({
          iconName: 'calendar', title: '没有符合条件的季度报表',
          text: '尝试调整年度、季度或状态筛选。'
        })}</div></td></tr>`;
        return;
      }
      tbody.innerHTML = data.items.map((row) => `
        <tr>
          <td>
            <div class="cell-main">${escapeHtml(row.projectName)}</div>
            <div class="cell-sub"><span class="mono">${escapeHtml(row.projectCode)}</span> · ${escapeHtml(row.deptName)} · ${escapeHtml(row.managerName)}</div>
          </td>
          <td><span class="tag tone-indigo">${row.year} Q${row.quarter}</span></td>
          <td class="num">${dateText(row.dueDate)}</td>
          <td>${statusPill('quarter', row.displayStatus)}</td>
          <td>
            <div class="truncate small" style="max-width:280px;color:${row.exec ? 'var(--ink-2)' : 'var(--faint)'}">${escapeHtml(row.exec || '尚未填写')}</div>
            <div class="cell-sub">${row.achievement ? escapeHtml(row.achievement.slice(0, 40)) : ''}</div>
          </td>
          <td class="small">${row.status === 'SUBMITTED' ? `<div>${escapeHtml(row.submitterName || '—')}</div><div class="cell-sub">${dateTimeText(row.submitAt)}</div>` : '—'}</td>
          <td><span class="attach-count">${icon('clip', 'ic-sm')}${row.attachmentCount || 0}</span></td>
          <td>
            <div class="actions">
              <button class="btn btn-xs ${row.status === 'SUBMITTED' ? 'btn-ghost' : 'btn-soft'}" type="button" data-open="${row.id}">
                ${row.status === 'SUBMITTED' ? '查看' : (user.role === 'VIEWER' ? '查看' : '填报')}
              </button>
            </div>
          </td>
        </tr>`).join('');
      bindRows();
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty">${emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message })}</div></td></tr>`;
    }
  };

  wrap.querySelector('#q-keyword').addEventListener('input', debounce((event) => {
    state.keyword = event.target.value.trim();
    load();
  }, 280));
  wrap.querySelector('#q-year').addEventListener('change', (event) => { state.year = event.target.value; load(); });
  wrap.querySelector('#q-quarter').addEventListener('change', (event) => { state.quarter = event.target.value; load(); });
  wrap.querySelector('#q-status').addEventListener('change', (event) => { state.status = event.target.value; load(); });
  wrap.querySelector('#q-reset').addEventListener('click', () => {
    state.year = ''; state.quarter = ''; state.status = ''; state.keyword = '';
    wrap.querySelector('#q-year').value = '';
    wrap.querySelector('#q-quarter').value = '';
    wrap.querySelector('#q-status').value = '';
    wrap.querySelector('#q-keyword').value = '';
    load();
  });
  wrap.querySelector('[data-goto-alerts]').addEventListener('click', () => navigate('/alerts'));

  await load();
  return wrap;
}
