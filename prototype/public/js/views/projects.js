import { api, uploadFile } from '../core/api.js';
import { loadOptions, loadAlerts, invalidateAlerts } from '../core/data.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, num, wan, pct, statusPill, categoryPill, dateText, PROJECT_STATUS,
  PROJECT_CATEGORIES, PROJECT_LEVELS, PROJECT_SOURCES, FUND_SOURCES, meta, fileSize
} from '../core/format.js';
import { field, formValues, modal, confirmDialog, setBusy, toast, emptyBlock, debounce, progressBar } from '../core/ui.js';

const PAGE_SIZE = 10;
const PROJECT_STATUSES = Object.entries(PROJECT_STATUS).map(([code, item]) => ({ code, name: item.name, tone: item.tone }));

function projectRow(project, { canWrite, navigate, onEdit, onDelete }) {
  const overdue = project.requiredOverdue > 0;
  return `
    <tr class="clickable" data-id="${project.id}">
      <td>
        <div class="cell-main">
          ${escapeHtml(project.name)}
          ${project.status === 'COMPLETED' ? `<span class="tag tone-emerald">已完成</span>` : ''}
        </div>
        <div class="cell-sub"><span class="mono">${escapeHtml(project.code)}</span> · ${categoryPill(project.category)} <span class="tag">${escapeHtml(project.level || '—')}</span></div>
      </td>
      <td>
        <div>${escapeHtml(project.deptName)}</div>
        <div class="cell-sub">${escapeHtml(project.managerName)}</div>
      </td>
      <td class="num nowrap" style="font-size:12px">
        <div>${dateText(project.startDate)}</div>
        <div class="cell-sub">至 ${dateText(project.endDate)}</div>
      </td>
      <td>${statusPill('project', project.status)}</td>
      <td style="min-width:132px">
        <div class="progress-meta"><span>必备 ${project.requiredDone}/${project.requiredTotal}</span><span>${project.materialProgress}%</span></div>
        ${progressBar(project.materialProgress, overdue ? 'tone-rose' : project.materialProgress >= 100 ? 'tone-emerald' : '')}
      </td>
      <td style="min-width:118px">
        <div class="num" style="font-size:12px">${wan(project.spent)} / ${wan(project.fundTotal)} 万</div>
        <div class="progress-meta" style="margin-top:4px"><span class="faint">执行率</span><span>${pct(project.rate)}</span></div>
        ${progressBar(Math.min(100, project.rate), project.rate > 100 ? 'tone-rose' : 'tone-emerald')}
      </td>
      <td>${overdue ? `<span class="tag tone-rose">逾期 ${project.requiredOverdue}</span>` : '<span class="tag tone-emerald">正常</span>'}</td>
      <td>
        <div class="actions row-actions">
          <button class="btn btn-xs btn-ghost" type="button" data-detail="${project.id}">详情</button>
          ${canWrite ? `<button class="btn btn-xs btn-ghost" type="button" data-edit="${project.id}">编辑</button>` : ''}
          ${canWrite ? `<button class="btn btn-xs btn-ghost" type="button" style="color:#be123c" data-delete="${project.id}">删除</button>` : ''}
        </div>
      </td>
    </tr>`;
}

function managersOf(options) {
  return (options.users || []).filter((u) => ['PROJECT_MANAGER', 'RESEARCH_MANAGER', 'ADMIN'].includes(u.role));
}

function projectDefaults(options, user) {
  const startDate = options.today || new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + 365);
  const configured = (key, fallback) => {
    const field = (options.projectFields || []).find((item) => item.key === key);
    return field && field.options && field.options.length ? field.options : fallback;
  };
  const categories = configured('category', PROJECT_CATEGORIES);
  const levels = configured('level', PROJECT_LEVELS);
  const sources = configured('source', PROJECT_SOURCES);
  const fundSources = configured('fundSource', FUND_SOURCES);
  return {
    startDate,
    endDate: end.toISOString().slice(0, 10),
    fundTotal: 100,
    status: 'PLANNING',
    progress: 0,
    managerId: user.id,
    deptId: user.deptId,
    category: categories[0],
    level: levels[1] || levels[0],
    source: sources[1] || sources[0],
    fundSource: fundSources[1] || fundSources[0],
    customFields: {}
  };
}

function projectFormBody(project, options, user, fields) {
  const isEdit = Boolean(project);
  const defaults = projectDefaults(options, user);
  const data = project || defaults;
  const managers = managersOf(options);
  const canChooseManager = user.role !== 'PROJECT_MANAGER';
  const deptOptions = (options.departments || []).map((d) => ({ value: d.id, label: d.name }));
  const managerOptions = managers.map((u) => ({ value: u.id, label: `${u.name}（${u.deptName}）` }));
  const statusOptions = PROJECT_STATUSES.map((s) => ({ value: s.code, label: s.name }));
  const groupLabels = { erp: 'ERP 基本信息', system: '系统信息' };
  let currentGroup = '';

  const controls = fields.filter((field) => field.enabled).map((field) => {
    const group = field.group === 'system' ? 'system' : 'erp';
    const section = group !== currentGroup
      ? `<div class="form-section">${groupLabels[group]}</div>`
      : '';
    currentGroup = group;

    const builtin = field.builtin;
    let value = builtin ? (data[field.key] ?? '') : (data.customFields?.[field.key] ?? '');
    if (!isEdit && builtin && (value === '' || value === undefined || value === null)) {
      value = defaults[field.key] ?? '';
    }
    let controlType = 'text';
    let fieldOptions = [];
    let disabled = false;
    let hint = field.hint || '';

    if (field.type === 'select') {
      controlType = 'select';
      fieldOptions = (field.options || []).map((item) => ({ value: item, label: item }));
    } else if (field.type === 'department') {
      controlType = 'select';
      fieldOptions = deptOptions;
    } else if (field.type === 'manager') {
      controlType = 'select';
      fieldOptions = canChooseManager ? managerOptions : [{ value: user.id, label: `${user.name}（本人）` }];
      disabled = !canChooseManager;
      if (!canChooseManager) {
        value = user.id;
        hint = '项目经理只能维护本人项目，不可转交';
      }
    } else if (field.type === 'status') {
      controlType = 'select';
      fieldOptions = statusOptions;
    } else if (field.type === 'number') {
      controlType = 'number';
    } else if (field.type === 'date') {
      controlType = 'date';
    } else if (field.type === 'textarea') {
      controlType = 'textarea';
    }

    if (field.key === 'code') {
      value = data.code || '';
      disabled = isEdit;
      if (isEdit) hint = '项目编号创建后不可修改';
    }

    if (controlType === 'select' && value !== '' && value !== undefined && value !== null
      && !fieldOptions.some((item) => String(item.value) === String(value))) {
      fieldOptions = [{ value, label: String(value) }, ...fieldOptions];
    }

    if (field.type === 'checkbox') {
      const checked = value === true || value === 'true' || value === 1 || value === '是';
      return `${section}<div class="field ${field.full ? 'span-2' : ''}">
        <div class="label">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ''}</div>
        <label class="switch">
          <input type="checkbox" name="${escapeHtml(field.key)}" data-ocr-field ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <span class="switch-track"></span>
          <span class="switch-label">${checked ? '是' : '否'}</span>
        </label>
        ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
      </div>`;
    }

    if (controlType === 'select' && fieldOptions.length && !field.required && !fieldOptions.some((item) => item.value === '')) {
      fieldOptions = [{ value: '', label: '请选择' }, ...fieldOptions];
    }

    const numberExtra = controlType === 'number'
      ? {
        min: field.key === 'custom_planned_profit' ? undefined : 0,
        max: field.key === 'progress' ? 100 : undefined,
        step: field.key === 'progress' ? 1 : field.key === 'fundTotal' ? 0.1 : 0.01
      }
      : {};

    return `${section}${fieldComponent({
      label: field.label,
      name: field.key,
      type: controlType,
      value,
      options: fieldOptions,
      required: field.required,
      span: field.full,
      placeholder: field.placeholder,
      hint,
      disabled,
      rows: field.type === 'textarea' ? 4 : 3,
      ...numberExtra
    })}`;
  }).join('');

  return `<form id="project-form" class="form-grid cols-3">${controls}</form>`;
}

// 与 ui.js 的 field 区分命名，避免与配置字段变量混淆
function fieldComponent(config) {
  return field(config);
}

function ocrPanelHTML() {
  return `
    <div class="ocr-panel" id="ocr-panel">
      <div class="ocr-head">
        <span class="ocr-icon">${icon('sparkles')}</span>
        <div class="grow">
          <div class="ocr-title">ERP 截图识别</div>
          <div class="ocr-sub">上传 ERP「项目基本信息」截图，自动识别并填入下方字段，识别后仍可核对修改</div>
        </div>
        <label class="switch ocr-switch">
          <input type="checkbox" id="ocr-editable" checked />
          <span class="switch-track"></span>
          <span class="switch-label">允许修改识别结果</span>
        </label>
      </div>
      <div class="ocr-drop" id="ocr-drop">
        ${icon('upload')}
        <div><strong>点击上传</strong> 或把 ERP 截图拖到这里</div>
        <div class="hint">支持 PNG / JPG / WebP / BMP，建议使用清晰的“基本信息”页截图；关闭“允许修改”后识别字段将锁定</div>
        <input type="file" id="ocr-file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden />
      </div>
      <div class="ocr-preview hidden" id="ocr-preview">
        <img id="ocr-preview-img" alt="ERP 截图预览" />
        <div class="ocr-file-meta">
          <div class="ocr-file-name" id="ocr-file-name"></div>
          <div class="hint" id="ocr-file-size"></div>
          <div class="row gap-6">
            <button class="btn btn-xs btn-soft" type="button" id="ocr-retry">${icon('refresh')}重新识别</button>
            <button class="btn btn-xs btn-ghost" type="button" id="ocr-remove">${icon('trash')}移除</button>
          </div>
        </div>
      </div>
      <div class="ocr-status" id="ocr-status"></div>
      <details class="ocr-raw" id="ocr-raw" hidden>
        <summary>查看 OCR 原始文本</summary>
        <pre id="ocr-raw-text"></pre>
      </details>
    </div>`;
}

function setupOcrPanel({ body, form, fields, user }) {
  const panel = body.querySelector('#ocr-panel');
  if (!panel) return;
  const drop = panel.querySelector('#ocr-drop');
  const fileInput = panel.querySelector('#ocr-file');
  const preview = panel.querySelector('#ocr-preview');
  const previewImg = panel.querySelector('#ocr-preview-img');
  const fileName = panel.querySelector('#ocr-file-name');
  const fileSizeEl = panel.querySelector('#ocr-file-size');
  const status = panel.querySelector('#ocr-status');
  const raw = panel.querySelector('#ocr-raw');
  const rawText = panel.querySelector('#ocr-raw-text');
  const editable = panel.querySelector('#ocr-editable');
  const retryBtn = panel.querySelector('#ocr-retry');
  const removeBtn = panel.querySelector('#ocr-remove');

  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  const alwaysDisabled = new Set(user.role === 'PROJECT_MANAGER' ? ['managerId'] : []);
  const filled = new Map();
  let file = null;
  let objectUrl = null;

  const inputOf = (key) => form.querySelector(`[name="${key}"]`);

  const setStatus = (html, tone = '') => {
    status.className = `ocr-status ${tone}`.trim();
    status.innerHTML = html;
  };

  const syncCheckboxLabels = () => {
    form.querySelectorAll('.field .switch input[type="checkbox"]').forEach((input) => {
      const label = input.parentElement.querySelector('.switch-label');
      if (label) label.textContent = input.checked ? '是' : '否';
    });
  };

  const applyLock = () => {
    const allow = editable.checked;
    for (const [key, baseDisabled] of filled.entries()) {
      const input = inputOf(key);
      if (!input) continue;
      input.disabled = !allow || baseDisabled || alwaysDisabled.has(key);
    }
  };

  const clearFilled = () => {
    for (const [key, baseDisabled] of filled.entries()) {
      const input = inputOf(key);
      if (!input) continue;
      input.disabled = baseDisabled;
      input.classList.remove('ocr-filled');
    }
    filled.clear();
  };

  const applyResult = (data) => {
    clearFilled();
    const warnings = data.warnings || [];
    let applied = 0;
    for (const [key, info] of Object.entries(data.fields || {})) {
      const fieldDef = fieldMap.get(key);
      const input = inputOf(key);
      if (!fieldDef || !input || alwaysDisabled.has(key)) continue;
      filled.set(key, Boolean(input.disabled));
      if (fieldDef.type === 'checkbox') {
        input.checked = Boolean(info.value);
      } else if (info.value !== undefined && info.value !== null) {
        input.value = info.value;
      }
      input.classList.add('ocr-filled');
      applied += 1;
    }
    applyLock();
    syncCheckboxLabels();
    const engines = data.engine === 'rapidocr' ? 'RapidOCR' : 'Windows OCR';
    if (!applied) {
      setStatus(`${icon('alertTriangle')} 未识别到可回填的字段，请检查截图是否为 ERP「项目基本信息」页`, 'error');
    } else {
      const parts = [`识别完成：匹配 ${applied} 个字段`, engines];
      if (data.durationMs) parts.push(`${(data.durationMs / 1000).toFixed(1)} 秒`);
      if (warnings.length) parts.push(`${warnings.length} 项待确认`);
      setStatus(`
        <div class="ocr-status-main">${icon('checkCircle')}${escapeHtml(parts.join(' · '))}</div>
        ${data.fallbackReason ? `<div class="hint">${escapeHtml(data.fallbackReason)}</div>` : ''}
        ${warnings.length ? `<ul class="ocr-warning-list">${warnings.map((warning) => `<li>${escapeHtml(warning.label)}：${escapeHtml(warning.message)}（识别为“${escapeHtml(warning.raw || '空')}”）</li>`).join('')}</ul>` : ''}
      `, warnings.length ? 'warn' : 'success');
    }
    raw.hidden = false;
    rawText.textContent = data.rawText || '';
  };

  const recognize = async () => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setStatus(`${icon('alertTriangle')} 截图超过 12MB，请压缩后重试`, 'error');
      return;
    }
    retryBtn.disabled = true;
    setStatus('<span class="spinner" style="display:inline-block;vertical-align:-3px"></span> 正在识别截图，请稍候（本地 OCR，约 2—5 秒）…', 'loading');
    try {
      const data = await uploadFile('/ocr', file);
      applyResult(data);
    } catch (error) {
      setStatus(`${icon('alertTriangle')} 识别失败：${escapeHtml(error.message)}`, 'error');
    } finally {
      retryBtn.disabled = false;
    }
  };

  const showPreview = (selected) => {
    file = selected;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(selected);
    previewImg.src = objectUrl;
    fileName.textContent = selected.name;
    fileSizeEl.textContent = `${fileSize(selected.size)} · ${selected.type || '图片'}`;
    drop.classList.add('hidden');
    preview.classList.remove('hidden');
    recognize();
  };

  const resetPanel = () => {
    file = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.classList.add('hidden');
    drop.classList.remove('hidden');
    status.className = 'ocr-status';
    status.innerHTML = '';
    raw.hidden = true;
    rawText.textContent = '';
  };

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) showPreview(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('drag-over');
  }));
  ['dragleave', 'dragend'].forEach((type) => drop.addEventListener(type, () => drop.classList.remove('drag-over')));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag-over');
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) showPreview(dropped);
  });
  retryBtn.addEventListener('click', recognize);
  removeBtn.addEventListener('click', resetPanel);
  editable.addEventListener('change', () => {
    applyLock();
    toast(editable.checked ? 'OCR 识别结果已解锁，可以直接修改' : 'OCR 识别结果已锁定，关闭开关前不能修改', 'info');
  });
}

export async function openProjectForm({ project, options, user, onSaved, navigate }) {
  const isEdit = Boolean(project);
  let fields = [];
  try {
    const data = await api('/project-fields');
    fields = (data.fields || []).filter((item) => item.enabled).sort((a, b) => a.seq - b.seq);
  } catch (error) {
    toast(`项目字段配置加载失败：${error.message}`, 'error');
    return null;
  }
  if (!fields.length) {
    toast('项目字段配置为空，请先在系统管理中配置字段', 'error');
    return null;
  }

  const handle = modal({
    title: isEdit ? '编辑项目' : '新建科研项目',
    subtitle: isEdit ? `${project.code} · 修改后立即生效` : '提交后系统按流程模板自动生成节点、材料与季度报表',
    size: 'wide',
    body: isEdit
      ? projectFormBody(project, options, user, fields)
      : `${ocrPanelHTML()}<div class="ocr-form-divider"></div>${projectFormBody(project, options, user, fields)}`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close>取消</button>
      <button class="btn btn-primary" type="button" data-save>${isEdit ? '保存修改' : '创建项目'}</button>`,
    onMount: (body, h) => {
      const form = body.querySelector('#project-form');
      const syncCheckboxLabels = () => {
        form.querySelectorAll('.field .switch input[type="checkbox"]').forEach((input) => {
          const label = input.parentElement.querySelector('.switch-label');
          if (label) label.textContent = input.checked ? '是' : '否';
        });
      };
      syncCheckboxLabels();
      form.querySelectorAll('.field .switch input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', syncCheckboxLabels);
      });

      if (!isEdit) setupOcrPanel({ body, form, fields, user });

      const costInput = form.querySelector('[name="custom_cost_control"]');
      const fundInput = form.querySelector('[name="fundTotal"]');
      costInput?.addEventListener('input', () => {
        const cost = Number(costInput.value);
        if (Number.isFinite(cost) && cost > 0 && fundInput) {
          fundInput.value = (cost / 10000).toFixed(2);
        }
      });

      h.footer.querySelector('[data-save]').addEventListener('click', async () => {
        const values = formValues(form);
        const defaults = projectDefaults(options, user);
        const data = project || defaults;

        for (const field of fields) {
          if (!field.enabled) continue;
          if (!isEdit && field.key === 'code') continue;
          if (field.type === 'checkbox') {
            if (field.required && !values[field.key]) return toast(`请勾选${field.label}`, 'error');
            continue;
          }
          const raw = values[field.key];
          if (field.required && String(raw ?? '').trim() === '') {
            return toast(`请填写${field.label}`, 'error');
          }
          if (field.type === 'number' && String(raw ?? '').trim() !== '' && !Number.isFinite(Number(raw))) {
            return toast(`${field.label}必须是数字`, 'error');
          }
        }

        const name = String(values.name ?? '').trim();
        if (name.length < 2) return toast('请输入项目名称（至少 2 个字符）', 'error');
        if (!values.startDate || !values.endDate) return toast('请选择项目起止日期', 'error');
        if (values.endDate < values.startDate) return toast('结束日期不得早于开始日期', 'error');
        if (Number(values.fundTotal) < 0) return toast('批复经费必须为非负数字', 'error');

        const payload = {
          code: isEdit ? project.code : (values.code || ''),
          name,
          category: values.category ?? data.category ?? defaults.category,
          level: values.level ?? data.level ?? defaults.level,
          source: values.source ?? data.source ?? defaults.source,
          deptId: values.deptId ?? data.deptId ?? defaults.deptId,
          managerId: values.managerId ?? data.managerId ?? defaults.managerId,
          status: values.status ?? data.status ?? defaults.status,
          startDate: values.startDate ?? data.startDate ?? defaults.startDate,
          endDate: values.endDate ?? data.endDate ?? defaults.endDate,
          fundTotal: Number(values.fundTotal ?? data.fundTotal ?? 0),
          fundSource: values.fundSource ?? data.fundSource ?? defaults.fundSource,
          progress: Number(values.progress ?? data.progress ?? 0),
          erpCode: values.erpCode ?? data.erpCode ?? '',
          erpPurchaseCode: values.erpPurchaseCode ?? data.erpPurchaseCode ?? '',
          inquiryCode: values.inquiryCode ?? data.inquiryCode ?? '',
          description: values.description ?? data.description ?? '',
          customFields: {}
        };
        for (const field of fields) {
          if (field.builtin || !field.enabled) continue;
          const raw = values[field.key];
          if (field.type === 'checkbox') payload.customFields[field.key] = !!values[field.key];
          else if (field.type === 'number') payload.customFields[field.key] = String(raw ?? '').trim() === '' ? '' : Number(raw);
          else payload.customFields[field.key] = String(raw ?? '');
        }

        const cost = Number(payload.customFields.custom_cost_control);
        if (Number.isFinite(cost) && cost > 0 && (values.fundTotal === undefined || String(values.fundTotal).trim() === '')) {
          payload.fundTotal = Math.round((cost / 10000) * 100) / 100;
        }

        const button = h.footer.querySelector('[data-save]');
        setBusy(button, true, '保存中…');
        try {
          const result = isEdit
            ? await api(`/projects/${project.id}`, { method: 'PUT', body: payload })
            : await api('/projects', { method: 'POST', body: payload });
          handle.close();
          invalidateAlerts();
          await loadAlerts(true).catch(() => null);
          if (isEdit) {
            toast('项目信息已保存', 'success');
            onSaved?.(result);
          } else {
            const materialCount = result.materials?.length || 0;
            const stageCount = result.stages?.length || 0;
            const quarterCount = result.quarterly?.length || 0;
            toast(`项目已创建：生成 ${stageCount} 个节点、${materialCount} 项材料、${quarterCount} 条季度报表`, 'success', 4200);
            navigate(`/projects/${result.project.id}`);
          }
        } catch (error) {
          toast(error.message, 'error');
          setBusy(button, false);
        }
      });
    }
  });
  return handle;
}

export async function render({ user, query, navigate }) {
  const options = await loadOptions();
  const state = {
    keyword: query.keyword || '',
    status: query.status || '',
    deptId: query.deptId || '',
    category: query.category || '',
    page: Number(query.page) || 1
  };
  const canWrite = user.role !== 'VIEWER';
  const categoryField = (options.projectFields || []).find((field) => field.key === 'category' && field.enabled);
  const categoryOptions = categoryField?.options?.length ? categoryField.options : PROJECT_CATEGORIES;
  const wrap = document.createElement('div');

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Project ledger · 项目台账</div>
        <h1 class="page-title">项目台账</h1>
        <div class="page-sub">项目主数据、流程节点、材料归集与经费执行情况的总入口；ERP、采购、询比编号在此统一关联。</div>
      </div>
      <div class="page-actions">
        ${canWrite ? `<button class="btn btn-primary" type="button" data-new>${icon('plus')}新建项目</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head" style="align-items:center;flex-wrap:wrap;gap:12px">
        <div class="toolbar" style="flex:1">
          <div class="input-group search-box">
            ${icon('search')}
            <input class="input" id="keyword" placeholder="搜索项目编号 / 名称 / ERP 编号" value="${escapeHtml(state.keyword)}" />
          </div>
          <select class="select" id="filter-status">
            <option value="">全部状态</option>
            ${PROJECT_STATUSES.map((s) => `<option value="${s.code}" ${state.status === s.code ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
          <select class="select" id="filter-dept">
            <option value="">全部部门</option>
            ${(options.departments || []).map((d) => `<option value="${d.id}" ${state.deptId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
          <select class="select" id="filter-category">
            <option value="">全部类别</option>
            ${categoryOptions.map((c) => `<option value="${escapeHtml(c)}" ${state.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" type="button" id="reset-filter">${icon('rotate')}重置</button>
        </div>
        <div class="small muted" id="summary-line"></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th style="min-width:230px">项目</th>
              <th>部门 / 经理</th>
              <th>周期</th>
              <th>状态</th>
              <th>必备材料</th>
              <th>经费</th>
              <th>逾期</th>
              <th class="right">操作</th>
            </tr>
          </thead>
          <tbody id="project-tbody">
            <tr><td colspan="8"><div class="table-empty">${emptyBlock({ title: '正在加载项目…' })}</div></td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-foot">
        <span id="page-info" class="small muted"></span>
        <div class="row gap-6">
          <button class="btn btn-sm btn-secondary" type="button" id="prev-page">${icon('chevronLeft')}上一页</button>
          <button class="btn btn-sm btn-secondary" type="button" id="next-page">下一页${icon('chevronRight')}</button>
        </div>
      </div>
    </div>`;

  const tbody = wrap.querySelector('#project-tbody');
  const summaryLine = wrap.querySelector('#summary-line');
  const pageInfo = wrap.querySelector('#page-info');
  let lastResult = { items: [], total: 0, summary: {} };

  const syncUrl = () => {
    const params = new URLSearchParams();
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.status) params.set('status', state.status);
    if (state.deptId) params.set('deptId', state.deptId);
    if (state.category) params.set('category', state.category);
    if (state.page > 1) params.set('page', String(state.page));
    const next = `/projects${params.toString() ? `?${params}` : ''}`;
    history.replaceState({}, '', next);
  };

  const bindRowActions = () => {
    tbody.querySelectorAll('[data-detail]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        navigate(`/projects/${el.getAttribute('data-detail')}`);
      });
    });
    tbody.querySelectorAll('[data-edit]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        const project = lastResult.items.find((p) => p.id === el.getAttribute('data-edit'));
        openProjectForm({
          project, options, user, navigate,
          onSaved: async () => { await load(); }
        });
      });
    });
    tbody.querySelectorAll('[data-delete]').forEach((el) => {
      el.addEventListener('click', async (event) => {
        event.stopPropagation();
        const project = lastResult.items.find((p) => p.id === el.getAttribute('data-delete'));
        const ok = await confirmDialog({
          title: '删除项目',
          message: `确定删除项目「${project.name}」吗？`,
          detail: '删除为逻辑删除，历史报表、附件与操作日志仍保留在数据库中。',
          confirmText: '删除项目',
          tone: 'danger'
        });
        if (!ok) return;
        try {
          await api(`/projects/${project.id}`, { method: 'DELETE' });
          toast('项目已删除', 'success');
          invalidateAlerts();
          await loadAlerts(true).catch(() => null);
          await load();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => navigate(`/projects/${row.getAttribute('data-id')}`));
    });
  };

  const load = async () => {
    tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty"><span class="spinner"></span></div></td></tr>`;
    try {
      const params = new URLSearchParams({
        page: String(state.page),
        size: String(PAGE_SIZE)
      });
      if (state.keyword) params.set('keyword', state.keyword);
      if (state.status) params.set('status', state.status);
      if (state.deptId) params.set('deptId', state.deptId);
      if (state.category) params.set('category', state.category);
      const data = await api(`/projects?${params}`);
      lastResult = data;
      const { items, total, summary } = data;
      summaryLine.innerHTML = `共 <strong>${total}</strong> 个项目 · 在研 ${summary.active} · 已完成 ${summary.completed} · 批复 ${wan(summary.fundTotal)} 万元 · 逾期材料 ${summary.overdue}`;
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty">${emptyBlock({
          iconName: 'folder', title: '没有符合条件的项目',
          text: state.keyword || state.status || state.deptId || state.category ? '尝试调整筛选条件。' : '新建第一个项目后，系统会自动生成节点、材料与季度报表。',
          action: canWrite ? `<button class="btn btn-primary" type="button" data-empty-new>${icon('plus')}新建项目</button>` : ''
        })}</div></td></tr>`;
        tbody.querySelector('[data-empty-new]')?.addEventListener('click', () => openProjectForm({ options, user, navigate }));
      } else {
        tbody.innerHTML = items.map((project) => projectRow(project, { canWrite, navigate })).join('');
        bindRowActions();
      }
      const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
      pageInfo.textContent = `第 ${state.page} / ${maxPage} 页 · 每页 ${PAGE_SIZE} 条`;
      wrap.querySelector('#prev-page').disabled = state.page <= 1;
      wrap.querySelector('#next-page').disabled = state.page >= maxPage;
      state.maxPage = maxPage;
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty">${emptyBlock({ iconName: 'alertTriangle', title: '加载失败', text: error.message })}</div></td></tr>`;
    }
  };

  wrap.querySelector('#keyword').addEventListener('input', debounce((event) => {
    state.keyword = event.target.value.trim();
    state.page = 1;
    syncUrl();
    load();
  }, 280));
  wrap.querySelector('#filter-status').addEventListener('change', (event) => { state.status = event.target.value; state.page = 1; syncUrl(); load(); });
  wrap.querySelector('#filter-dept').addEventListener('change', (event) => { state.deptId = event.target.value; state.page = 1; syncUrl(); load(); });
  wrap.querySelector('#filter-category').addEventListener('change', (event) => { state.category = event.target.value; state.page = 1; syncUrl(); load(); });
  wrap.querySelector('#reset-filter').addEventListener('click', () => {
    state.keyword = ''; state.status = ''; state.deptId = ''; state.category = ''; state.page = 1;
    wrap.querySelector('#keyword').value = '';
    wrap.querySelector('#filter-status').value = '';
    wrap.querySelector('#filter-dept').value = '';
    wrap.querySelector('#filter-category').value = '';
    syncUrl();
    load();
  });
  wrap.querySelector('#prev-page').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; syncUrl(); load(); } });
  wrap.querySelector('#next-page').addEventListener('click', () => { if (state.page < (state.maxPage || 1)) { state.page += 1; syncUrl(); load(); } });
  wrap.querySelector('[data-new]')?.addEventListener('click', () => openProjectForm({ options, user, navigate }));

  await load();
  if (query.new === '1' && canWrite) {
    openProjectForm({ options, user, navigate });
  }
  return wrap;
}
