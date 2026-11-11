import { api } from '../core/api.js';
import { loadOptions } from '../core/data.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, dateText, statusPill, CATEGORIES, MATERIAL_STATUS, PROJECT_STATUS, meta
} from '../core/format.js';
import { emptyBlock, debounce, progressBar } from '../core/ui.js';

const CHIP_TONE = {
  SUBMITTED: 'emerald',
  LATE: 'amber',
  WAIVED: 'violet',
  PENDING: 'slate',
  OVERDUE: 'rose'
};

export async function render({ params, query, navigate }) {
  const code = params.code;
  const cat = CATEGORIES[code];
  const wrap = document.createElement('div');
  if (!cat) {
    wrap.innerHTML = `<div class="card card-body">${emptyBlock({
      iconName: 'inbox', title: '材料分类不存在', text: `未找到分类 ${code}`,
      action: '<button class="btn btn-primary" type="button" onclick="location.href=\'/projects\'">返回项目台账</button>'
    })}</div>`;
    return wrap;
  }
  const options = await loadOptions();
  const state = { keyword: query.keyword || '', deptId: '', status: '', unfinished: false };
  const isProcurement = code === 'PROCUREMENT';

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Material ledger · 分类台账</div>
        <h1 class="page-title">${escapeHtml(cat.name)}归集台账</h1>
        <div class="page-sub">按项目汇总「${escapeHtml(cat.name)}」的归集情况，对应制度 ${escapeHtml(cat.doc)}。点击材料标签可直接打开项目详情并进入上传窗口。</div>
      </div>
      <div class="page-actions">
        <span class="pill tone-${cat.tone}"><span class="pill-dot"></span>${escapeHtml(cat.doc)}</span>
        <button class="btn btn-secondary" type="button" data-projects>${icon('folder')}项目台账</button>
      </div>
    </div>

    <div class="alert-summary" id="cat-summary" style="grid-template-columns:repeat(3,minmax(0,1fr))"></div>

    <div class="card">
      <div class="card-head" style="align-items:center;flex-wrap:wrap;gap:12px">
        <div class="toolbar" style="flex:1">
          <div class="input-group search-box">
            ${icon('search')}
            <input class="input" id="cat-keyword" placeholder="搜索项目 / ERP 编号" value="${escapeHtml(state.keyword)}" />
          </div>
          <select class="select" id="cat-dept">
            <option value="">全部部门</option>
            ${(options.departments || []).map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
          </select>
          <select class="select" id="cat-status">
            <option value="">全部状态</option>
            ${Object.entries(PROJECT_STATUS).map(([status, item]) => `<option value="${status}">${item.name}</option>`).join('')}
          </select>
          <button class="chip" type="button" id="cat-unfinished">仅看未齐项目</button>
        </div>
        <div class="row gap-8 hint">
          <span class="tag tone-emerald">已提交</span>
          <span class="tag tone-amber">逾期提交</span>
          <span class="tag tone-rose">已逾期</span>
          <span class="tag tone-violet">无需提交</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="min-width:240px">项目</th>
              <th>部门 / 经理</th>
              <th>关联编号</th>
              <th style="min-width:340px">${isProcurement ? '采购询比材料链（7 个节点）' : '材料归集情况'}</th>
              <th class="right">完成度</th>
              <th class="right">逾期必备</th>
            </tr>
          </thead>
          <tbody id="cat-body"></tbody>
        </table>
      </div>
      <div class="card-foot"><span class="small muted" id="cat-foot"></span></div>
    </div>`;

  const tbody = wrap.querySelector('#cat-body');
  const summaryEl = wrap.querySelector('#cat-summary');
  const footEl = wrap.querySelector('#cat-foot');

  const load = async () => {
    tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty"><span class="spinner"></span></div></td></tr>`;
    try {
      const params = new URLSearchParams();
      if (state.keyword) params.set('keyword', state.keyword);
      if (state.deptId) params.set('deptId', state.deptId);
      if (state.status) params.set('status', state.status);
      if (state.unfinished) params.set('unfinished', '1');
      const data = await api(`/categories/${code}?${params.toString()}`);
      const summary = data.summary;
      summaryEl.innerHTML = `
        <div class="alert-stat">
          <span class="ring" style="background:var(--primary-soft);color:var(--primary)">${icon(cat.icon)}</span>
          <div><div class="lbl">涉及项目</div><div class="val">${summary.projects}</div><div class="hint">当前筛选范围</div></div>
        </div>
        <div class="alert-stat">
          <span class="ring" style="background:#e7f8f0;color:#059669">${icon('checkCircle')}</span>
          <div><div class="lbl">材料归集完成</div><div class="val">${summary.done} / ${summary.materials}</div><div class="hint">含已提交、逾期提交与无需提交</div></div>
        </div>
        <div class="alert-stat">
          <span class="ring" style="background:#feecef;color:#e11d48">${icon('alertTriangle')}</span>
          <div><div class="lbl">逾期必备材料</div><div class="val">${summary.overdue}</div><div class="hint">已过截止日期且未提交</div></div>
        </div>`;

      if (!data.rows.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty">${emptyBlock({
          iconName: cat.icon, title: `暂无${cat.name}数据`,
          text: state.keyword || state.deptId || state.status || state.unfinished ? '尝试调整筛选条件。' : '项目创建后，系统会按模板生成该类材料。'
        })}</div></td></tr>`;
        footEl.textContent = '共 0 个项目';
        return;
      }

      tbody.innerHTML = data.rows.map((row) => {
        const chips = row.materials.map((material) => {
          const status = material.status;
          const m = meta(MATERIAL_STATUS, status);
          return `<button class="tag tone-${CHIP_TONE[status] || 'slate'}" type="button"
            style="cursor:pointer;max-width:100%"
            title="${escapeHtml(material.name)} · ${m.name} · 截止 ${dateText(material.dueDate)}"
            data-open-project="${row.projectId}" data-open-material="${material.id}">
            ${escapeHtml(material.name.length > 14 ? `${material.name.slice(0, 13)}…` : material.name)}
            ${status === 'OVERDUE' ? ' ⚠' : ''}
          </button>`;
        }).join('');
        return `
          <tr>
            <td>
              <div class="cell-main">${escapeHtml(row.name)}</div>
              <div class="cell-sub"><span class="mono">${escapeHtml(row.code)}</span> · ${escapeHtml(row.erpCode || '未回填 ERP 编号')}</div>
            </td>
            <td>
              <div>${escapeHtml(row.deptName)}</div>
              <div class="cell-sub">${escapeHtml(row.managerName)}</div>
            </td>
            <td class="small">
              <div class="mono">${escapeHtml(row.erpCode || '—')}</div>
              ${isProcurement ? `<div class="cell-sub mono">ERP采购 ${escapeHtml(row.erpPurchaseCode || '—')}</div><div class="cell-sub mono">询比 ${escapeHtml(row.inquiryCode || '—')}</div>` : `<div class="cell-sub mono">询比 ${escapeHtml(row.inquiryCode || '—')}</div>`}
            </td>
            <td><div class="chip-row" style="gap:4px">${chips}</div></td>
            <td class="right" style="min-width:120px">
              <div class="num small">${row.done}/${row.total}</div>
              <div style="margin-top:5px">${progressBar(row.total ? (row.done / row.total) * 100 : 0, row.overdue ? 'tone-rose' : 'tone-emerald')}</div>
            </td>
            <td class="right">
              ${row.overdue ? `<span class="tag tone-rose">逾期 ${row.overdue}</span>` : '<span class="tag tone-emerald">正常</span>'}
            </td>
          </tr>`;
      }).join('');

      tbody.querySelectorAll('[data-open-material]').forEach((el) => el.addEventListener('click', () => {
        navigate(`/projects/${el.getAttribute('data-open-project')}?open=material:${el.getAttribute('data-open-material')}`);
      }));
      footEl.textContent = `共 ${data.summary.projects} 个项目 · ${data.summary.materials} 项${cat.name}${state.unfinished ? ' · 仅看未齐项目' : ''}`;
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty">${emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message })}</div></td></tr>`;
    }
  };

  wrap.querySelector('#cat-keyword').addEventListener('input', debounce((event) => {
    state.keyword = event.target.value.trim();
    load();
  }, 280));
  wrap.querySelector('#cat-dept').addEventListener('change', (event) => { state.deptId = event.target.value; load(); });
  wrap.querySelector('#cat-status').addEventListener('change', (event) => { state.status = event.target.value; load(); });
  wrap.querySelector('#cat-unfinished').addEventListener('click', (event) => {
    state.unfinished = !state.unfinished;
    event.currentTarget.classList.toggle('on', state.unfinished);
    load();
  });
  wrap.querySelector('[data-projects]').addEventListener('click', () => navigate('/projects'));

  await load();
  return wrap;
}
