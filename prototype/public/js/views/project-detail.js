import { api, attachmentUrl, uploadFile } from '../core/api.js';
import { loadOptions, loadAlerts, invalidateAlerts } from '../core/data.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, num, wan, pct, statusPill, categoryPill, dateText, dateTimeText,
  fileSize, CATEGORIES, MATERIAL_STATUS, PROJECT_STATUS, FUND_TYPES, FUND_SUBJECTS, meta, quarterName
} from '../core/format.js';
import {
  modal, drawer, confirmDialog, formValues, setBusy, toast, emptyBlock,
  fileKind, progressBar, field
} from '../core/ui.js';
import { openProjectForm } from './projects.js';

const MAX_SIZE = 20 * 1024 * 1024;

const STATUS_TONE = { SUBMITTED: 'emerald', LATE: 'amber', WAIVED: 'violet', PENDING: 'slate', OVERDUE: 'rose' };

export async function render({ params, query, user, navigate }) {
  const options = await loadOptions();
  const state = {
    projectId: params.id,
    data: null,
    tab: 'materials',
    category: '',
    status: '',
    keyword: ''
  };
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="card card-body"><div class="center" style="padding:40px"><span class="spinner"></span></div></div>`;

  const canWriteFn = (project) => {
    if (!project || user.role === 'VIEWER') return false;
    if (['ADMIN', 'RESEARCH_MANAGER'].includes(user.role)) return true;
    return user.role === 'PROJECT_MANAGER' && project.managerId === user.id;
  };
  const canAdminMaterials = ['ADMIN', 'RESEARCH_MANAGER'].includes(user.role);

  async function load() {
    state.data = await api(`/projects/${state.projectId}`);
    return state.data;
  }

  async function refresh() {
    await load();
    paint();
    invalidateAlerts();
    loadAlerts(true).catch(() => null);
  }

  function heroHTML() {
    const p = state.data.project;
    const canWrite = canWriteFn(p);
    const overdue = p.requiredOverdue;
    return `
      <div class="page-head">
        <div style="min-width:0">
          <div class="eyebrow">Project detail · 项目详情</div>
          <div class="row gap-8 wrap" style="margin-bottom:6px">
            <span class="mono small faint">${escapeHtml(p.code)}</span>
            ${statusPill('project', p.status)}
            ${categoryPill(p.category)}
            <span class="tag">${escapeHtml(p.level || '—')}</span>
          </div>
          <h1 class="page-title" style="font-size:24px">${escapeHtml(p.name)}</h1>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" type="button" data-back>${icon('arrowRight', 'ic-sm')}返回台账</button>
          ${canWrite ? `<button class="btn btn-primary" type="button" data-edit-project>${icon('edit')}编辑项目</button>` : ''}
        </div>
      </div>

      <div class="card detail-hero" style="margin-bottom:16px">
        <div class="detail-head">
          <div style="min-width:0">
            <div class="detail-meta" style="margin-top:0">
              <span class="item">${icon('building')}${escapeHtml(p.deptName)}</span>
              <span class="item">${icon('user')}${escapeHtml(p.managerName)}</span>
              <span class="item">${icon('calendar')}${dateText(p.startDate)} → ${dateText(p.endDate)}</span>
              <span class="item">${icon('wallet')}批复 ${wan(p.fundTotal)} 万元 · ${escapeHtml(p.fundSource || '—')}</span>
            </div>
            <div class="row gap-8 wrap" style="margin-top:10px">
              ${p.erpCode ? `<span class="tag tone-indigo">项目代号 ${escapeHtml(p.erpCode)}</span>` : ''}
              ${p.erpPurchaseCode ? `<span class="tag tone-cyan">ERP采购 ${escapeHtml(p.erpPurchaseCode)}</span>` : ''}
              ${p.inquiryCode ? `<span class="tag tone-violet">询比 ${escapeHtml(p.inquiryCode)}</span>` : ''}
              ${!p.erpCode && !p.erpPurchaseCode && !p.inquiryCode ? '<span class="tag">尚未回填外部系统编号</span>' : ''}
            </div>
          </div>
          <div class="right" style="text-align:right">
            <div class="hint">整体进度</div>
            <div class="strong num" style="font-size:20px">${p.progress}%</div>
            <div style="width:120px;margin-top:5px">${progressBar(p.progress, p.progress >= 100 ? 'tone-emerald' : '')}</div>
          </div>
        </div>
        <div class="detail-stats">
          <div class="detail-stat">
            <div class="lbl">必备材料完成</div>
            <div class="val">${p.requiredDone}/${p.requiredTotal} <small>项</small></div>
          </div>
          <div class="detail-stat">
            <div class="lbl">逾期必备材料</div>
            <div class="val" style="color:${overdue ? '#be123c' : 'inherit'}">${overdue} <small>项</small></div>
          </div>
          <div class="detail-stat">
            <div class="lbl">经费执行率</div>
            <div class="val">${pct(p.rate)} <small>支出 ${wan(p.spent)} 万</small></div>
          </div>
          <div class="detail-stat">
            <div class="lbl">季度报表填报</div>
            <div class="val">${p.quarterDone}/${p.quarterTotal} <small>期</small></div>
          </div>
        </div>
      </div>`;
  }

  function stagesHTML() {
    const stages = state.data.stages;
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('layers')}流程节点</div>
            <div class="card-sub">按流程模板快照生成；全部必备材料完成后节点自动标记为已完成</div>
          </div>
          <span class="hint">共 ${stages.length} 个节点</span>
        </div>
        <div class="card-body">
          <div class="stage-rail">
            ${stages.map((stage) => {
              const overdue = state.data.materials.filter((m) => m.stageId === stage.id && m.required && m.status === 'PENDING' && m.overdueDays > 0).length;
              const tone = overdue ? 'overdue' : stage.status === 'COMPLETED' ? 'done' : stage.status === 'IN_PROGRESS' ? 'active' : '';
              const ratio = stage.requiredTotal ? Math.round((stage.requiredDone / stage.requiredTotal) * 100) : 100;
              return `
                <div class="stage-card ${tone}">
                  <div class="stage-top">
                    <div class="stage-name">${escapeHtml(stage.name)}</div>
                    <span class="stage-seq">${String(stage.seq).padStart(2, '0')}</span>
                  </div>
                  <div class="stage-dates">${dateText(stage.startDate)} → ${dateText(stage.endDate)}</div>
                  <div class="stage-progress">
                    <div class="progress-meta"><span>${stage.requiredTotal ? `${stage.requiredDone}/${stage.requiredTotal} 必备材料` : '无必备材料'}</span><span>${stage.requiredTotal ? `${ratio}%` : '—'}</span></div>
                    ${progressBar(ratio, overdue ? 'tone-rose' : stage.status === 'COMPLETED' ? 'tone-emerald' : '')}
                  </div>
                  <div style="margin-top:8px">${overdue ? `<span class="tag tone-rose">逾期 ${overdue}</span>` : statusPill('stage', stage.status)}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  function materialStatusOf(material) {
    return material.overdueDays > 0 ? 'OVERDUE' : material.status;
  }

  function materialsHTML() {
    const all = state.data.materials;
    const canWrite = canWriteFn(state.data.project);
    const filtered = all.filter((m) => {
      if (state.category && m.category !== state.category) return false;
      if (state.status && materialStatusOf(m) !== state.status) return false;
      if (state.keyword) {
        const k = state.keyword.toLowerCase();
        if (!`${m.name} ${m.code} ${m.stageName}`.toLowerCase().includes(k)) return false;
      }
      return true;
    });
    const counts = {};
    all.forEach((m) => { counts[m.category] = (counts[m.category] || 0) + 1; });
    const chips = [
      `<button class="chip ${state.category === '' ? 'on' : ''}" type="button" data-cat="">全部 <span class="n">${all.length}</span></button>`,
      ...Object.keys(CATEGORIES).filter((code) => counts[code]).map((code) => `
        <button class="chip ${state.category === code ? 'on' : ''}" type="button" data-cat="${code}">${CATEGORIES[code].name} <span class="n">${counts[code]}</span></button>`)
    ];
    return `
      <div class="toolbar" style="justify-content:space-between;margin-bottom:12px">
        <div class="chip-row">${chips.join('')}</div>
        <div class="row gap-8">
          <select class="select" id="material-status" style="height:34px;width:auto">
            <option value="">全部状态</option>
            ${Object.entries(MATERIAL_STATUS).map(([code, item]) => `<option value="${code}" ${state.status === code ? 'selected' : ''}>${item.name}</option>`).join('')}
          </select>
          <div class="input-group" style="width:200px">
            ${icon('search')}
            <input class="input" id="material-keyword" placeholder="搜索材料" value="${escapeHtml(state.keyword)}" style="height:34px" />
          </div>
        </div>
      </div>
      ${canWrite ? `<div class="hint" style="margin-bottom:10px;display:flex;align-items:center;gap:6px">${icon('upload', 'ic-sm')}支持把文件直接拖到材料行完成上传；点击“上传”可在抽屉中填写补传说明。</div>` : ''}
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
        <table class="table" id="material-table">
          <thead>
            <tr>
              <th style="min-width:250px">材料名称</th>
              <th>节点</th>
              <th>分类</th>
              <th>要求</th>
              <th>截止日期</th>
              <th>状态</th>
              <th>附件</th>
              <th class="right">操作</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map((m) => {
              const viewStatus = materialStatusOf(m);
              return `
                <tr data-material="${m.id}" class="${canWrite ? 'drop-target' : ''}">
                  <td>
                    <div class="material-name ${m.required ? '' : 'optional'}">
                      <span class="req-dot"></span>${escapeHtml(m.name)}
                    </div>
                    <div class="cell-sub mono">${escapeHtml(m.code)}</div>
                  </td>
                  <td class="small">${escapeHtml(m.stageName || '—')}</td>
                  <td>${categoryPill(m.category)}</td>
                  <td>${m.required ? '<span class="tag tone-rose">必备</span>' : '<span class="tag">选交</span>'}</td>
                  <td class="num nowrap">
                    <div>${dateText(m.dueDate)}</div>
                    ${m.overdueDays > 0 ? `<div class="cell-sub" style="color:#be123c">逾期 ${m.overdueDays} 天</div>` : ''}
                  </td>
                  <td>${statusPill('material', viewStatus)}</td>
                  <td><span class="attach-count">${icon('clip', 'ic-sm')}${m.attachmentCount}</span></td>
                  <td>
                    <div class="actions">
                      ${canWrite && m.status !== 'WAIVED' ? `<button class="btn btn-xs btn-soft" type="button" data-upload="${m.id}">${icon('upload')}上传</button>` : ''}
                      <button class="btn btn-xs btn-ghost" type="button" data-open="${m.id}">详情</button>
                    </div>
                  </td>
                </tr>`;
            }).join('') : `<tr><td colspan="8"><div class="table-empty">${emptyBlock({ iconName: 'inbox', title: '没有符合条件的材料', text: '调整筛选条件后再试。' })}</div></td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function quarterlyHTML() {
    const rows = state.data.quarterly;
    const canWrite = canWriteFn(state.data.project);
    return `
      <div class="row-between" style="margin-bottom:12px">
        <div class="small muted">按自然季度生成，季度结束后第 15 天截止；逾期仍可补报并留痕。</div>
        <div class="row gap-8">
          <span class="tag tone-emerald">已提交 ${rows.filter((r) => r.status === 'SUBMITTED').length}</span>
          <span class="tag tone-rose">逾期 ${rows.filter((r) => r.displayStatus === 'OVERDUE').length}</span>
          ${canWrite ? `<button class="btn btn-xs btn-secondary" type="button" data-sync-period>${icon('refresh')}同步周期</button>` : ''}
        </div>
      </div>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
        <table class="table">
          <thead><tr><th>季度</th><th>截止日期</th><th>状态</th><th>本期执行情况</th><th>提交人 / 时间</th><th>附件</th><th class="right">操作</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td><div class="cell-main">${quarterName(row.year, row.quarter)}</div></td>
                <td class="num">${dateText(row.dueDate)}</td>
                <td>${statusPill('quarter', row.displayStatus)}</td>
                <td style="max-width:320px">
                  <div class="truncate small" style="color:${row.exec ? 'var(--ink-2)' : 'var(--faint)'}">${escapeHtml(row.exec || '尚未填写')}</div>
                </td>
                <td class="small">${row.status === 'SUBMITTED' ? `<div>${escapeHtml(row.submitterName || '—')}</div><div class="cell-sub">${dateTimeText(row.submitAt)}</div>` : '—'}</td>
                <td><span class="attach-count">${icon('clip', 'ic-sm')}${row.attachmentCount}</span></td>
                <td>
                  <div class="actions">
                    <button class="btn btn-xs ${row.status === 'SUBMITTED' ? 'btn-ghost' : 'btn-soft'}" type="button" data-quarter="${row.id}">${row.status === 'SUBMITTED' ? '查看' : (canWrite ? '填报' : '查看')}</button>
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="7"><div class="table-empty">${emptyBlock({ iconName: 'calendar', title: '暂无季度报表' })}</div></td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function fundingHTML() {
    const rows = state.data.funding;
    const p = state.data.project;
    const canWrite = canWriteFn(p);
    return `
      <div class="grid grid-4" style="margin-bottom:14px">
        <div class="card pad"><div class="kpi-label">批复经费</div><div class="kpi-value" style="font-size:23px">${wan(p.fundTotal)}<span class="unit">万元</span></div></div>
        <div class="card pad"><div class="kpi-label">累计支出</div><div class="kpi-value" style="font-size:23px">${wan(p.spent)}<span class="unit">万元</span></div></div>
        <div class="card pad"><div class="kpi-label">预算余额</div><div class="kpi-value" style="font-size:23px">${wan(p.balance)}<span class="unit">万元</span></div></div>
        <div class="card pad"><div class="kpi-label">执行率</div><div class="kpi-value" style="font-size:23px">${pct(p.rate)}</div></div>
      </div>
      <div class="row-between" style="margin-bottom:10px">
        <div class="small muted">共 ${rows.length} 笔支出明细，保存后自动汇总回写项目累计支出。</div>
        ${canWrite ? `<button class="btn btn-primary btn-sm" type="button" data-add-funding>${icon('plus')}登记支出</button>` : ''}
      </div>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
        <table class="table">
          <thead><tr><th>发生日期</th><th>经费类型</th><th>支出科目</th><th>说明</th><th>登记人</th><th class="right">金额（万元）</th><th class="right">操作</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td class="num">${dateText(row.date)}</td>
                <td><span class="tag tone-indigo">${escapeHtml(row.type)}</span></td>
                <td class="small">${escapeHtml(row.subject || '—')}</td>
                <td class="small muted" style="max-width:260px">${escapeHtml(row.note || '—')}</td>
                <td class="small">${escapeHtml(row.creatorName || '—')}</td>
                <td class="right num strong">${num(row.amount, 2)}</td>
                <td>
                  <div class="actions">
                    ${canWrite ? `<button class="btn btn-xs btn-ghost" type="button" data-edit-funding="${row.id}">编辑</button>` : ''}
                    ${canWrite ? `<button class="btn btn-xs btn-ghost" style="color:#be123c" type="button" data-del-funding="${row.id}">删除</button>` : ''}
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="7"><div class="table-empty">${emptyBlock({ iconName: 'wallet', title: '暂无经费支出', text: '登记第一笔支出后，累计支出与执行率会自动更新。' })}</div></td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function infoHTML() {
    const p = state.data.project;
    const logs = state.data.logs || [];
    const configuredFields = state.data.projectFields || [];
    const customFields = configuredFields.filter((field) => !field.builtin && field.enabled);
    const customValues = p.customFields || {};
    const labelOf = (key, fallback) => {
      const field = configuredFields.find((item) => item.key === key);
      return field && field.label ? field.label : fallback;
    };
    const valueOfField = (key, fallback) => {
      const field = configuredFields.find((item) => item.key === key);
      if (field && !field.enabled) return '—';
      return fallback;
    };
    return `
      <div class="grid grid-2">
        <div class="card pad">
          <div class="card-title" style="margin-bottom:8px">${icon('info')}项目信息</div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('code', '项目编号'))}</div><div class="v mono">${escapeHtml(p.code)}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('category', '代号类型'))}</div><div class="v">${escapeHtml(valueOfField('category', p.category || '—'))}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('source', '项目来源'))}</div><div class="v">${escapeHtml(valueOfField('source', p.source || '—'))}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('deptId', '所属部门'))}</div><div class="v">${escapeHtml(p.deptName)}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('managerId', '项目经理'))}</div><div class="v">${escapeHtml(p.managerName)}</div></div>
          <div class="info-row"><div class="k">起止日期</div><div class="v">${dateText(p.startDate)} → ${dateText(p.endDate)}</div></div>
          <div class="info-row"><div class="k">创建时间</div><div class="v">${dateTimeText(p.createdAt)}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('description', '项目简介'))}</div><div class="v">${escapeHtml(valueOfField('description', p.description || '—'))}</div></div>
        </div>
        <div class="card pad">
          <div class="card-title" style="margin-bottom:8px">${icon('database')}外部系统关联</div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('erpCode', 'ERP 立项编号'))}</div><div class="v mono">${escapeHtml(p.erpCode || '未回填')}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('erpPurchaseCode', 'ERP 采购申请编号'))}</div><div class="v mono">${escapeHtml(p.erpPurchaseCode || '未回填')}</div></div>
          <div class="info-row"><div class="k">${escapeHtml(labelOf('inquiryCode', '采购询比系统编号'))}</div><div class="v mono">${escapeHtml(p.inquiryCode || '未回填')}</div></div>
          <div class="hint" style="margin-top:10px">本系统只记录外部系统编号与材料归集状态，不复制审批流。采购、询比等业务操作仍在数智采购系统、ERP 与采购询比系统中完成。</div>
        </div>
        <div class="card pad" style="grid-column:1/-1">
          <div class="row-between" style="margin-bottom:8px">
            <div class="card-title">${icon('columns')}自定义信息</div>
            <span class="tag">由系统管理 · 项目字段配置</span>
          </div>
          ${customFields.length
            ? `<div class="info-grid">${customFields.map((field) => {
              const value = customValues[field.key];
              let display = '—';
              if (value !== undefined && value !== null && value !== '') {
                if (typeof value === 'boolean') display = value ? '是' : '否';
                else if (field.type === 'number') display = num(value, 2);
                else display = String(value);
              }
              return `<div class="info-row"><div class="k">${escapeHtml(field.label)}</div><div class="v">${escapeHtml(display)}</div></div>`;
            }).join('')}</div>`
            : '<div class="hint">暂无启用的自定义字段，可在「系统管理 → 项目字段」中新增。</div>'}
        </div>
        <div class="card pad" style="grid-column:1/-1">
          <div class="card-title" style="margin-bottom:10px">${icon('history')}操作留痕</div>
          ${logs.length ? logs.map((log) => `
            <div class="row" style="align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line)">
              <span class="avatar sm tone-slate">${escapeHtml(String(log.username || '·').slice(-2))}</span>
              <div class="grow">
                <div class="small"><strong>${escapeHtml(log.username)}</strong> ${escapeHtml(log.action)} ${escapeHtml(log.target || '')}</div>
                <div class="hint">${escapeHtml(log.detail || '')}</div>
              </div>
              <span class="hint nowrap">${dateTimeText(log.at)}</span>
            </div>`).join('') : `<div class="hint">暂无操作记录</div>`}
        </div>
      </div>`;
  }

  function tabBodyHTML() {
    if (state.tab === 'materials') return materialsHTML();
    if (state.tab === 'quarterly') return quarterlyHTML();
    if (state.tab === 'funding') return fundingHTML();
    return infoHTML();
  }

  function bindMaterialsEvents() {
    wrap.querySelectorAll('[data-cat]').forEach((el) => el.addEventListener('click', () => {
      state.category = el.getAttribute('data-cat');
      paintTab();
    }));
    const statusSelect = wrap.querySelector('#material-status');
    statusSelect?.addEventListener('change', () => { state.status = statusSelect.value; paintTab(); });
    const keywordInput = wrap.querySelector('#material-keyword');
    let timer = null;
    keywordInput?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.keyword = keywordInput.value.trim(); paintTab(); }, 250);
    });
    wrap.querySelectorAll('[data-open], [data-upload]').forEach((el) => el.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = el.getAttribute('data-open') || el.getAttribute('data-upload');
      openMaterialDrawer(id, Boolean(el.getAttribute('data-upload')));
    }));
    // 拖拽上传
    wrap.querySelectorAll('tr[data-material]').forEach((row) => {
      if (!row.classList.contains('drop-target')) return;
      const id = row.getAttribute('data-material');
      const enter = (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        row.classList.add('drop-hover');
      };
      row.addEventListener('dragenter', enter);
      row.addEventListener('dragover', enter);
      row.addEventListener('dragleave', (event) => {
        if (!row.contains(event.relatedTarget)) row.classList.remove('drop-hover');
      });
      row.addEventListener('drop', async (event) => {
        event.preventDefault();
        row.classList.remove('drop-hover');
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length) await uploadFilesToMaterial(id, files, '');
      });
    });
  }

  function bindQuarterlyEvents() {
    wrap.querySelectorAll('[data-quarter]').forEach((el) => el.addEventListener('click', () => {
      const row = state.data.quarterly.find((q) => q.id === el.getAttribute('data-quarter'));
      openQuarterlyDrawer(row);
    }));
    wrap.querySelector('[data-sync-period]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, '同步中…');
      try {
        await api(`/projects/${state.projectId}/sync-period`, { method: 'POST' });
        toast('已按当前项目周期同步节点与季度报表', 'success');
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  }

  function bindFundingEvents() {
    const p = state.data.project;
    const canWrite = canWriteFn(p);
    wrap.querySelector('[data-add-funding]')?.addEventListener('click', () => openFundingForm({ projectId: p.id }));
    wrap.querySelectorAll('[data-edit-funding]').forEach((el) => el.addEventListener('click', () => {
      const entry = state.data.funding.find((f) => f.id === el.getAttribute('data-edit-funding'));
      openFundingForm({ projectId: p.id, entry });
    }));
    wrap.querySelectorAll('[data-del-funding]').forEach((el) => el.addEventListener('click', async () => {
      const entry = state.data.funding.find((f) => f.id === el.getAttribute('data-del-funding'));
      const ok = await confirmDialog({
        title: '删除经费记录',
        message: `确定删除 ${dateText(entry.date)} 的「${entry.type}」支出 ${num(entry.amount, 2)} 万元吗？`,
        detail: '删除后项目累计支出与执行率会同步更新。',
        tone: 'danger',
        confirmText: '删除'
      });
      if (!ok) return;
      try {
        await api(`/funding/${entry.id}`, { method: 'DELETE' });
        toast('支出记录已删除', 'success');
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    }));
    void canWrite;
  }

  function paintTab() {
    const body = wrap.querySelector('#tab-body');
    if (!body) return;
    body.innerHTML = tabBodyHTML();
    if (state.tab === 'materials') bindMaterialsEvents();
    if (state.tab === 'quarterly') bindQuarterlyEvents();
    if (state.tab === 'funding') bindFundingEvents();
    wrap.querySelectorAll('#detail-tabs .tab').forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === state.tab);
    });
  }

  function paint() {
    const data = state.data;
    wrap.innerHTML = `
      <div id="hero-slot">${heroHTML()}</div>
      <div id="stages-slot">${stagesHTML()}</div>
      <div class="card">
        <div class="card-head" style="padding-bottom:12px;align-items:center">
          <div class="tabs" id="detail-tabs">
            <button class="tab ${state.tab === 'materials' ? 'active' : ''}" type="button" data-tab="materials">${icon('list', 'ic-sm')}材料清单 <span class="count">${data.materials.length}</span></button>
            <button class="tab ${state.tab === 'quarterly' ? 'active' : ''}" type="button" data-tab="quarterly">${icon('calendar', 'ic-sm')}季度报表 <span class="count">${data.quarterly.length}</span></button>
            <button class="tab ${state.tab === 'funding' ? 'active' : ''}" type="button" data-tab="funding">${icon('wallet', 'ic-sm')}经费台账 <span class="count">${data.funding.length}</span></button>
            <button class="tab ${state.tab === 'info' ? 'active' : ''}" type="button" data-tab="info">${icon('info', 'ic-sm')}项目信息</button>
          </div>
        </div>
        <div class="card-body" id="tab-body"></div>
      </div>`;

    wrap.querySelectorAll('#detail-tabs .tab').forEach((tab) => tab.addEventListener('click', () => {
      state.tab = tab.getAttribute('data-tab');
      paintTab();
    }));
    wrap.querySelector('[data-back]')?.addEventListener('click', () => navigate('/projects'));
    wrap.querySelector('[data-edit-project]')?.addEventListener('click', () => {
      openProjectForm({
        project: state.data.project,
        options,
        user,
        navigate,
        onSaved: async () => { await refresh(); }
      });
    });
    paintTab();
  }

  /* ---------------- 上传与材料抽屉 ---------------- */
  async function uploadFilesToMaterial(materialId, files, note) {
    let uploaded = 0;
    let failed = 0;
    for (const file of files) {
      if (file.size > MAX_SIZE) {
        toast(`「${file.name}」超过 20MB，无法上传`, 'error');
        failed += 1;
        continue;
      }
      try {
        await uploadFile(`/materials/${materialId}/attachments`, file, note ? { note } : {});
        uploaded += 1;
      } catch (error) {
        toast(`「${file.name}」上传失败：${error.message}`, 'error');
        failed += 1;
      }
    }
    if (uploaded) {
      toast(`已上传 ${uploaded} 个附件${failed ? `，${failed} 个失败` : ''}`, 'success');
      await refresh();
    }
    return uploaded;
  }

  function attachmentsHTML(files) {
    if (!files?.length) return `<div class="hint">暂无附件</div>`;
    const canDelete = canWriteFn(state.data.project);
    return `<div class="attachment-list">${files.map((file) => {
      const kind = fileKind(file.filename);
      return `
        <div class="attachment-item">
          <span class="attachment-icon ${kind.cls}">${icon(kind.icon)}</span>
          <div class="attachment-meta">
            <div class="attachment-name">${escapeHtml(file.filename)}</div>
            <div class="attachment-sub">${fileSize(file.size)} · ${dateTimeText(file.uploadedAt)} · ${escapeHtml(file.uploaderName || '')}</div>
          </div>
          <div class="attachment-actions">
            <a class="btn btn-xs btn-ghost" href="${attachmentUrl(file.id, { inline: true })}" target="_blank" rel="noopener">${icon('eye')}预览</a>
            <a class="btn btn-xs btn-ghost" href="${attachmentUrl(file.id)}">${icon('download')}下载</a>
            ${canDelete ? `<button class="btn btn-xs btn-ghost" style="color:#be123c" type="button" data-del-attach="${file.id}">${icon('trash')}</button>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  function bindAttachmentDeletes(scope, material, handle) {
    scope.querySelectorAll('[data-del-attach]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '删除附件',
        message: '确定删除该附件吗？删除最后一个附件后，材料会恢复为待提交。',
        tone: 'danger', confirmText: '删除'
      });
      if (!ok) return;
      try {
        await api(`/attachments/${el.getAttribute('data-del-attach')}`, { method: 'DELETE' });
        toast('附件已删除', 'success');
        handle.close();
        await refresh();
        openMaterialDrawer(material.id);
      } catch (error) {
        toast(error.message, 'error');
      }
    }));
  }

  function openMaterialDrawer(materialId, focusUpload = false) {
    const material = state.data.materials.find((m) => m.id === materialId);
    if (!material) return;
    const project = state.data.project;
    const canWrite = canWriteFn(project);
    const canAdmin = canAdminMaterials;
    const viewStatus = materialStatusOf(material);
    const stage = state.data.stages.find((s) => s.id === material.stageId);
    const handle = drawer({
      title: material.name,
      subtitle: `${stage ? stage.name : ''} · ${material.required ? '必备材料' : '选交材料'} · 截止 ${dateText(material.dueDate)}`,
      body: `
        <div class="row-between" style="margin-bottom:14px">
          <div class="row gap-8">${statusPill('material', viewStatus)}${categoryPill(material.category)}${material.required ? '<span class="tag tone-rose">必备</span>' : '<span class="tag">选交</span>'}</div>
          ${material.overdueDays > 0 ? `<span class="tag tone-rose">逾期 ${material.overdueDays} 天</span>` : ''}
        </div>
        <div class="info-grid" style="margin-bottom:16px">
          <div class="info-row"><div class="k">材料编码</div><div class="v mono">${escapeHtml(material.code)}</div></div>
          <div class="info-row"><div class="k">截止锚点</div><div class="v">${meta({ STAGE_START: { name: '节点开始' }, STAGE_END: { name: '节点结束' }, PROJECT_START: { name: '项目开始' }, PROJECT_END: { name: '项目结束' } }, material.anchor).name} ${material.offsetDays ? `+ ${material.offsetDays} 天` : ''}</div></div>
          <div class="info-row"><div class="k">首次提交</div><div class="v">${material.firstSubmitAt ? `${dateTimeText(material.firstSubmitAt)} · ${escapeHtml(material.submitterName || '')}` : '—'}</div></div>
          <div class="info-row"><div class="k">附件数量</div><div class="v">${material.attachmentCount} 个</div></div>
        </div>
        ${material.waiveReason ? `<div class="anchor-hint" style="margin-bottom:14px"><b>无需提交原因：</b>${escapeHtml(material.waiveReason)}${material.waivedByName ? `（${escapeHtml(material.waivedByName)}）` : ''}</div>` : ''}
        ${material.lateNote ? `<div class="anchor-hint" style="margin-bottom:14px"><b>补传说明：</b>${escapeHtml(material.lateNote)}</div>` : ''}

        <div class="card-title" style="margin-bottom:8px">${icon('clip')}附件</div>
        <div id="material-attachments"><div class="hint">正在加载附件…</div></div>

        ${canWrite && material.status !== 'WAIVED' ? `
          <div style="margin-top:18px">
            <div class="card-title" style="margin-bottom:8px">${icon('upload')}上传附件</div>
            <div class="upload-zone" id="drawer-upload-zone">
              ${icon('upload')}
              <div>把文件拖到这里，或<strong style="color:var(--primary)">点击选择文件</strong></div>
              <div class="hint" style="margin-top:4px">支持 PDF、Office、图片、压缩包、文本，单文件不超过 20MB；可一次选择多个</div>
            </div>
            <input type="file" id="drawer-file-input" multiple style="display:none" />
            <div class="field" style="margin-top:12px">
              <label class="label">补传说明 / 备注 <span class="hint" style="font-weight:400">（逾期补传时建议填写）</span></label>
              <textarea class="textarea" id="drawer-note" rows="2" placeholder="例如：因验收会延期，材料于会后补充提交">${escapeHtml(material.lateNote || '')}</textarea>
            </div>
            <div class="hint" id="drawer-upload-status" style="margin-top:8px"></div>
          </div>` : ''}
      `,
      footer: `
        <div class="left row gap-6">
          ${canAdmin && material.status !== 'WAIVED' ? `<button class="btn btn-sm btn-secondary" type="button" data-waive>${icon('shield')}标记无需提交</button>` : ''}
          ${canAdmin && (material.status === 'WAIVED' || material.attachmentCount === 0) ? `<button class="btn btn-sm btn-ghost" type="button" data-reset>${icon('rotate')}重置为待提交</button>` : ''}
        </div>
        <button class="btn btn-secondary" type="button" data-close>关闭</button>`
    });

    const zone = handle.body.querySelector('#drawer-upload-zone');
    const fileInput = handle.body.querySelector('#drawer-file-input');
    const note = handle.body.querySelector('#drawer-note');
    const status = handle.body.querySelector('#drawer-upload-status');
    let uploading = false;

    const runUpload = async (files) => {
      if (uploading) return;
      if (!files.length) return;
      uploading = true;
      status.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-3px"></span> 正在上传 ${files.length} 个文件…`;
      const uploaded = await uploadFilesToMaterial(material.id, files, note?.value.trim() || '');
      uploading = false;
      if (uploaded) {
        handle.close();
        openMaterialDrawer(material.id);
      } else if (status) {
        status.textContent = '';
      }
    };

    if (zone) {
      zone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => runUpload(Array.from(fileInput.files || [])));
      ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.add('drag-over');
      }));
      ['dragleave', 'dragend'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('drag-over')));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('drag-over');
        runUpload(Array.from(event.dataTransfer?.files || []));
      });
    }
    if (focusUpload) zone?.scrollIntoView({ block: 'center' });

    const attachmentsSlot = handle.body.querySelector('#material-attachments');
    api(`/materials/${material.id}/attachments`).then((files) => {
      attachmentsSlot.innerHTML = attachmentsHTML(files);
      bindAttachmentDeletes(attachmentsSlot, material, handle);
    }).catch((error) => {
      attachmentsSlot.innerHTML = `<div class="hint">附件加载失败：${escapeHtml(error.message)}</div>`;
    });

    handle.footer.querySelector('[data-waive]')?.addEventListener('click', () => {
      openWaiveDialog(material, () => {
        handle.close();
        refresh().then(() => openMaterialDrawer(material.id));
      });
    });
    handle.footer.querySelector('[data-reset]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '重置材料状态',
        message: `确定把「${material.name}」重置为待提交吗？`,
        detail: '该操作不会删除已有附件，但会清除首次提交时间与无需提交标记。',
        confirmText: '重置',
        tone: 'danger'
      });
      if (!ok) return;
      try {
        await api(`/materials/${material.id}/reset`, { method: 'POST' });
        toast('材料已重置为待提交', 'success');
        handle.close();
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function openWaiveDialog(material, after) {
    const handle = modal({
      title: '标记无需提交',
      subtitle: `${material.name} · 请填写原因，操作会记入日志`,
      size: 'narrow',
      body: `
        <div class="field">
          <label class="label">无需提交原因 <span class="req">*</span></label>
          <textarea class="textarea" id="waive-reason" rows="3" placeholder="例如：技术总结合并至项目总结报告，经科研管理员确认无需单独提交"></textarea>
          <div class="hint">标记后材料计入已完成，不再进入逾期提醒。</div>
        </div>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>确认标记</button>`
    });
    handle.footer.querySelector('[data-save]').addEventListener('click', async () => {
      const reason = handle.body.querySelector('#waive-reason').value.trim();
      if (reason.length < 2) return toast('请填写无需提交的原因', 'error');
      const button = handle.footer.querySelector('[data-save]');
      setBusy(button, true, '提交中…');
      try {
        await api(`/materials/${material.id}/waive`, { method: 'POST', body: { reason } });
        toast('已标记为无需提交', 'success');
        handle.close();
        await after?.();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  }

  /* ---------------- 季度报表抽屉 ---------------- */
  function openQuarterlyDrawer(row) {
    const canWrite = canWriteFn(state.data.project);
    const canWithdraw = ['ADMIN', 'RESEARCH_MANAGER'].includes(user.role);
    const editable = canWrite && row.status !== 'SUBMITTED';
    const handle = drawer({
      title: `${quarterName(row.year, row.quarter)} 季度执行情况表`,
      subtitle: `截止 ${dateText(row.dueDate)} · ${row.displayStatus === 'OVERDUE' ? '已逾期，可补报并留痕' : '按自然季度填报'}`,
      body: `
        <div class="row gap-8" style="margin-bottom:14px">
          ${statusPill('quarter', row.displayStatus)}
          ${row.status === 'SUBMITTED' ? `<span class="hint">提交人 ${escapeHtml(row.submitterName || '—')} · ${dateTimeText(row.submitAt)}</span>` : '<span class="hint">草稿状态，提交前可反复修改</span>'}
        </div>
        <form id="quarter-form" class="col gap-12">
          <div class="field">
            <label class="label">本期执行情况 <span class="req">*</span></label>
            <textarea class="textarea" name="exec" rows="4" ${editable ? '' : 'disabled'} placeholder="本季度完成的主要工作、里程碑与指标达成情况">${escapeHtml(row.exec || '')}</textarea>
          </div>
          <div class="field">
            <label class="label">阶段成果</label>
            <textarea class="textarea" name="achievement" rows="2" ${editable ? '' : 'disabled'} placeholder="形成的样机、报告、知识产权等">${escapeHtml(row.achievement || '')}</textarea>
          </div>
          <div class="field">
            <label class="label">存在问题</label>
            <textarea class="textarea" name="issue" rows="2" ${editable ? '' : 'disabled'} placeholder="进度、经费、资源方面的问题">${escapeHtml(row.issue || '')}</textarea>
          </div>
          <div class="field">
            <label class="label">下期计划</label>
            <textarea class="textarea" name="nextPlan" rows="2" ${editable ? '' : 'disabled'} placeholder="下一季度重点工作">${escapeHtml(row.nextPlan || '')}</textarea>
          </div>
          <div class="form-grid">
            <div class="field">
              <label class="label">本期支出（万元）</label>
              <input class="input" type="number" step="0.01" min="0" name="spend" value="${row.spend ?? 0}" ${editable ? '' : 'disabled'} />
            </div>
            <div class="field">
              <label class="label">累计支出（万元）</label>
              <input class="input" type="number" step="0.01" min="0" name="cumSpend" value="${row.cumSpend ?? 0}" ${editable ? '' : 'disabled'} />
            </div>
          </div>
        </form>
        <div class="card-title" style="margin:16px 0 8px">${icon('clip')}报表附件</div>
        ${row.attachments?.length ? `<div class="attachment-list">${row.attachments.map((file) => {
          const kind = fileKind(file.filename);
          return `<div class="attachment-item">
            <span class="attachment-icon ${kind.cls}">${icon(kind.icon)}</span>
            <div class="attachment-meta"><div class="attachment-name">${escapeHtml(file.filename)}</div><div class="attachment-sub">${fileSize(file.size)} · ${dateTimeText(file.uploadedAt)}</div></div>
            <div class="attachment-actions"><a class="btn btn-xs btn-ghost" href="${attachmentUrl(file.id)}">${icon('download')}下载</a></div>
          </div>`;
        }).join('')}</div>` : '<div class="hint">暂无附件</div>'}
        ${editable ? `
          <div class="upload-zone" id="quarter-upload" style="margin-top:12px">
            ${icon('upload')}
            <div>拖入或点击上传季度附件（PDF / Office / 图片）</div>
          </div>
          <input type="file" id="quarter-file" multiple style="display:none" />` : ''}
      `,
      footer: `
        <div class="left">
          ${row.status === 'SUBMITTED' && canWithdraw ? `<button class="btn btn-sm btn-danger" type="button" data-withdraw>${icon('rotate')}撤回报表</button>` : ''}
        </div>
        <button class="btn btn-secondary" type="button" data-close>关闭</button>
        ${editable ? `<button class="btn btn-secondary" type="button" data-draft>保存草稿</button><button class="btn btn-primary" type="button" data-submit>${row.displayStatus === 'OVERDUE' ? '逾期补报' : '提交报表'}</button>` : ''}`
    });

    const form = handle.body.querySelector('#quarter-form');
    const save = async (action, button) => {
      const values = formValues(form);
      if (action === 'submit' && String(values.exec || '').trim().length < 5) {
        return toast('提交前请填写本期执行情况（至少 5 个字）', 'error');
      }
      setBusy(button, true, action === 'submit' ? '提交中…' : '保存中…');
      try {
        await api(`/quarterly/${row.id}`, {
          method: 'PUT',
          body: {
            action,
            exec: values.exec,
            achievement: values.achievement,
            issue: values.issue,
            nextPlan: values.nextPlan,
            spend: Number(values.spend || 0),
            cumSpend: Number(values.cumSpend || 0)
          }
        });
        toast(action === 'submit' ? '季度报表已提交' : '草稿已保存', 'success');
        handle.close();
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    };
    handle.footer.querySelector('[data-draft]')?.addEventListener('click', (event) => save('draft', event.currentTarget));
    handle.footer.querySelector('[data-submit]')?.addEventListener('click', (event) => save('submit', event.currentTarget));
    handle.footer.querySelector('[data-withdraw]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '撤回已提交报表',
        message: `确定撤回 ${quarterName(row.year, row.quarter)} 的季度报表吗？`,
        detail: '撤回后报表回到未提交状态，操作会记入日志。',
        tone: 'danger', confirmText: '撤回'
      });
      if (!ok) return;
      try {
        await api(`/quarterly/${row.id}/withdraw`, { method: 'POST' });
        toast('报表已撤回', 'success');
        handle.close();
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    const uploadZone = handle.body.querySelector('#quarter-upload');
    const fileInput = handle.body.querySelector('#quarter-file');
    if (uploadZone && fileInput) {
      const uploadOne = async (files) => {
        let count = 0;
        for (const file of files) {
          if (file.size > MAX_SIZE) { toast(`「${file.name}」超过 20MB`, 'error'); continue; }
          try {
            await uploadFile(`/quarterly/${row.id}/attachments`, file);
            count += 1;
          } catch (error) {
            toast(error.message, 'error');
          }
        }
        if (count) {
          toast(`已上传 ${count} 个附件`, 'success');
          handle.close();
          await refresh();
        }
      };
      uploadZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => uploadOne(Array.from(fileInput.files || [])));
      ['dragenter', 'dragover'].forEach((type) => uploadZone.addEventListener(type, (event) => {
        event.preventDefault();
        uploadZone.classList.add('drag-over');
      }));
      ['dragleave', 'drop'].forEach((type) => uploadZone.addEventListener(type, (event) => {
        event.preventDefault();
        uploadZone.classList.remove('drag-over');
        if (type === 'drop') uploadOne(Array.from(event.dataTransfer?.files || []));
      }));
    }
  }

  /* ---------------- 经费表单 ---------------- */
  function openFundingForm({ projectId, entry }) {
    const isEdit = Boolean(entry);
    const today = options.today || new Date().toISOString().slice(0, 10);
    const handle = modal({
      title: isEdit ? '编辑经费支出' : '登记经费支出',
      subtitle: '金额单位：万元；保存后自动汇总项目累计支出',
      size: 'narrow',
      body: `
        <form id="funding-form" class="form-grid">
          ${field({ label: '发生日期', name: 'date', type: 'date', value: entry?.date || today, required: true, span: true, hint: '不得晚于今天' })}
          ${field({ label: '金额（万元）', name: 'amount', type: 'number', value: entry?.amount ?? '', min: 0, step: 0.01, required: true })}
          ${field({ label: '经费类型', name: 'type', type: 'select', value: entry?.type || FUND_TYPES[0], options: FUND_TYPES })}
          ${field({ label: '支出科目', name: 'subject', type: 'select', value: entry?.subject || FUND_SUBJECTS[0], options: FUND_SUBJECTS, span: true })}
          ${field({ label: '说明', name: 'note', type: 'textarea', value: entry?.note || '', rows: 2, span: true, placeholder: '例如：采购巡检机器人底盘及云台' })}
        </form>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-save>${isEdit ? '保存修改' : '登记支出'}</button>`
    });
    handle.footer.querySelector('[data-save]').addEventListener('click', async (event) => {
      const body = handle.body;
      const values = formValues(body);
      if (!values.amount || Number(values.amount) <= 0) return toast('金额必须大于 0', 'error');
      if (values.date > today) return toast('发生日期不得晚于今天', 'error');
      const button = event.currentTarget;
      setBusy(button, true, '保存中…');
      try {
        if (isEdit) {
          await api(`/funding/${entry.id}`, { method: 'PUT', body: { ...values, amount: Number(values.amount) } });
          toast('经费记录已更新', 'success');
        } else {
          await api(`/projects/${projectId}/funding`, { method: 'POST', body: { ...values, amount: Number(values.amount) } });
          toast('经费支出已登记', 'success');
        }
        handle.close();
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  }

  try {
    await load();
  } catch (error) {
    wrap.innerHTML = `<div class="card card-body">${emptyBlock({ iconName: 'alertTriangle', title: '项目加载失败', text: error.message, action: '<button class="btn btn-secondary" type="button" onclick="location.href=\'/projects\'">返回项目台账</button>' })}</div>`;
    return wrap;
  }
  paint();
  if (query.open) {
    const [kind, id] = String(query.open).split(':');
    setTimeout(() => {
      if (kind === 'material') openMaterialDrawer(id);
      if (kind === 'quarterly') {
        const row = state.data.quarterly.find((q) => q.id === id);
        if (row) openQuarterlyDrawer(row);
      }
    }, 60);
    history.replaceState({}, '', `/projects/${state.projectId}`);
  }
  return wrap;
}
