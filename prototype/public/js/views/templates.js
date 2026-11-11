import { api } from '../core/api.js';
import { loadOptions } from '../core/data.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, dateText, CATEGORIES, ANCHOR_LABEL, MATERIAL_STATUS
} from '../core/format.js';
import { toast, confirmDialog, setBusy, emptyBlock } from '../core/ui.js';

const MIN_WIDTH = 0.6; // 小于 0.6% 视为零宽度节点，单独渲染为标记

function parseDate(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}
function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(value, days) {
  return isoOf(parseDate(value) + Number(days || 0) * 86400000);
}
function dayDiff(a, b) {
  return Math.round((parseDate(a) - parseDate(b)) / 86400000);
}
function stageRange(project, node) {
  const total = Math.max(1, dayDiff(project.endDate, project.startDate));
  const startShift = Math.round(total * Number(node.startRatio || 0)) + Number(node.startOffset || 0);
  const endShift = Math.round(total * Number(node.endRatio || 0)) + Number(node.endOffset || 0);
  const startDate = addDays(project.startDate, startShift);
  let endDate = addDays(project.startDate, endShift);
  if (dayDiff(endDate, startDate) < 0) endDate = startDate;
  return { startDate, endDate };
}
function materialDue(project, stage, material) {
  let base = stage.endDate;
  if (material.anchor === 'STAGE_START') base = stage.startDate;
  if (material.anchor === 'PROJECT_START') base = project.startDate;
  if (material.anchor === 'PROJECT_END') base = project.endDate;
  return addDays(base, material.offsetDays || 0);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function render({ user, navigate }) {
  await loadOptions();
  const [template, projectsData] = await Promise.all([
    api('/templates'),
    api('/projects?size=100&page=1')
  ]);
  const projects = projectsData.items || [];

  const state = {
    nodes: deepClone(template.nodes),
    materials: deepClone(template.materials),
    categories: template.categories || [],
    anchors: template.anchors || [],
    selection: { kind: 'node', id: template.nodes[0]?.id || '' },
    previewProjectId: template.sampleProject?.id || projects[0]?.id || '',
    dirty: false,
    dragKind: '',
    dragId: '',
    dragSourceNode: '',
    updatedAt: template.updatedAt || null
  };
  const previewProject = () => projects.find((p) => p.id === state.previewProjectId) || projects[0] || null;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Process template · 流程模板</div>
        <h1 class="page-title">流程与材料模板</h1>
        <div class="page-sub">用拖拽维护节点周期与材料归属：拖动节点块调整周期位置，拖动两侧把手调整起止比例，拖动材料卡片在节点间归类。保存后仅对新建项目生效，历史项目保持快照。</div>
      </div>
      <div class="page-actions">
        <span class="save-state" id="save-state"><span class="dot"></span><span>已同步</span></span>
        <button class="btn btn-ghost" type="button" id="reset-btn">${icon('rotate')}重置</button>
        <button class="btn btn-primary" type="button" id="save-btn" disabled>${icon('save')}保存更改</button>
      </div>
    </div>

    <div class="card timeline-card">
      <div class="timeline-head">
        <div>
          <div class="card-title">${icon('move')}周期时间轴</div>
          <div class="card-sub">节点计划日期 = 项目开始 + 项目周期 × 比例 + 偏移天数；横向拖动节点块即可调整</div>
        </div>
        <div class="timeline-tools">
          <span class="hint">预览项目</span>
          <select class="select" id="preview-project"></select>
          <button class="btn btn-soft btn-sm" type="button" id="add-node">${icon('plus')}新增节点</button>
        </div>
      </div>
      <div class="timeline-scroll">
        <div class="timeline" id="timeline"></div>
      </div>
      <div class="timeline-head" style="padding-top:0;padding-bottom:14px">
        <div class="hint">${icon('info', 'ic-sm')} 按住节点块左右移动整体周期；拖动左右边缘调整起止比例（步进 1%）；“成果归档”等零宽节点通过偏移天数设置在项目结束后。</div>
      </div>
    </div>

    <div class="designer-grid">
      <div class="card board-card">
        <div class="card-head" style="align-items:center">
          <div>
            <div class="card-title">${icon('columns')}材料编排</div>
            <div class="card-sub">拖动材料卡片在节点间调整归属；拖动列头调整节点顺序</div>
          </div>
          <div class="row gap-8">
            <span class="tag" id="board-summary"></span>
          </div>
        </div>
        <div class="card-body">
          <div class="board" id="board"></div>
        </div>
      </div>
      <div class="card inspector" id="inspector"></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <div>
          <div class="card-title">${icon('calendarCheck')}生效预览</div>
          <div class="card-sub" id="preview-sub">按当前模板与预览项目计算出的计划日期</div>
        </div>
        <span class="tag tone-indigo">仅影响新项目</span>
      </div>
      <div class="card-body flush" id="preview-body"></div>
    </div>`;

  const timelineEl = wrap.querySelector('#timeline');
  const boardEl = wrap.querySelector('#board');
  const inspectorEl = wrap.querySelector('#inspector');
  const previewBody = wrap.querySelector('#preview-body');
  const previewSub = wrap.querySelector('#preview-sub');
  const saveBtn = wrap.querySelector('#save-btn');
  const saveState = wrap.querySelector('#save-state');
  const selectEl = wrap.querySelector('#preview-project');

  selectEl.innerHTML = projects.length
    ? projects.map((p) => `<option value="${p.id}" ${p.id === state.previewProjectId ? 'selected' : ''}>${escapeHtml(p.code)} · ${escapeHtml(p.name)}</option>`).join('')
    : '<option value="">暂无项目</option>';

  function selectedNode() {
    return state.nodes.find((n) => n.id === state.selection.id && state.selection.kind === 'node');
  }
  function selectedMaterial() {
    return state.materials.find((m) => m.id === state.selection.id && state.selection.kind === 'material');
  }
  function nodesSorted() {
    return state.nodes.slice().sort((a, b) => a.seq - b.seq);
  }
  function materialsOf(nodeId) {
    return state.materials.filter((m) => m.nodeId === nodeId).sort((a, b) => a.seq - b.seq);
  }
  function nextSeq() {
    return state.nodes.reduce((max, n) => Math.max(max, n.seq), 0) + 1;
  }

  function markDirty() {
    state.dirty = true;
    saveBtn.disabled = false;
    saveState.classList.add('dirty');
    saveState.innerHTML = `<span class="dot"></span><span>有未保存的修改</span>`;
  }
  function markClean() {
    state.dirty = false;
    saveBtn.disabled = true;
    saveState.classList.remove('dirty');
    saveState.innerHTML = `<span class="dot"></span><span>${state.updatedAt ? `已保存 ${new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已同步'}</span>`;
  }

  /* ---------------- 时间轴 ---------------- */
  function timelineNodes() {
    return state.nodes.slice().sort((a, b) => (a.startRatio - b.startRatio) || (a.seq - b.seq));
  }

  function blockMarkup(node) {
    const width = node.endRatio - node.startRatio;
    const zero = width < MIN_WIDTH / 100;
    const narrow = width < 0.14;
    const style = zero
      ? `top:${7}px;left:max(0px, calc(${node.startRatio * 100}% - 68px));width:66px;`
      : `top:7px;left:${node.startRatio * 100}%;width:${width * 100}%;`;
    const meta = `${Math.round(node.startRatio * 100)}%—${Math.round(node.endRatio * 100)}%`;
    return `
      <div class="tl-block ${node.enabled ? '' : 'disabled'} ${zero ? 'zero-width' : ''} ${narrow ? 'narrow' : ''} ${state.selection.kind === 'node' && state.selection.id === node.id ? 'selected' : ''}"
        data-block="${node.id}" style="${style}" title="${escapeHtml(node.name)} · ${meta}${node.startOffset || node.endOffset ? ` · 偏移 ${node.startOffset}/${node.endOffset} 天` : ''}">
        <i class="tl-handle left" data-handle="left"></i>
        ${zero ? `<span class="tl-block-label">${escapeHtml(node.name)}</span>` : `<span class="tl-block-label">${escapeHtml(node.name)}</span><span class="tl-block-meta">${meta}</span>`}
        <i class="tl-handle right" data-handle="right"></i>
      </div>`;
  }

  function paintTimeline() {
    const project = previewProject();
    const nodes = timelineNodes();
    const height = Math.max(1, nodes.length) * 54 + 16;
    const todayPct = project ? clamp((dayDiff(new Date().toISOString().slice(0, 10), project.startDate) / Math.max(1, dayDiff(project.endDate, project.startDate))) * 100, 0, 100) : null;
    const scale = Array.from({ length: 11 }, (_, i) => `<span>${i * 10}%</span>`).join('');
    const axis = nodes.map((node) => {
      const range = project ? stageRange(project, node) : null;
      return `
        <div class="tl-axis-item ${state.selection.kind === 'node' && state.selection.id === node.id ? 'on' : ''}" data-axis-node="${node.id}" style="height:54px">
          <span class="tl-axis-index">${node.seq}</span>
          <div style="min-width:0">
            <div class="tl-axis-name">${escapeHtml(node.name)}</div>
            <div class="tl-axis-sub">${range ? `${range.startDate.slice(5)} → ${range.endDate.slice(5)}` : '—'}</div>
          </div>
          ${node.enabled ? '' : icon('lock', 'ic-sm')}
        </div>`;
    }).join('');

    timelineEl.innerHTML = `
      <div class="tl-scale">${scale}</div>
      <div class="tl-body" style="height:${height}px">
        <div class="tl-axis">${axis}</div>
        <div class="tl-track-area" id="tl-track" style="height:${height}px">
          <div class="tl-grid">${Array.from({ length: 10 }, () => '<i></i>').join('')}</div>
          ${todayPct !== null ? `<span class="tl-today" style="left:${todayPct}%"></span>` : ''}
          ${nodes.map((node) => `<div class="tl-lane" style="height:54px">${blockMarkup(node)}</div>`).join('')}
        </div>
      </div>`;
    bindTimeline();
  }

  function bindTimeline() {
    const track = timelineEl.querySelector('#tl-track');
    if (!track) return;
    timelineEl.querySelectorAll('[data-block]').forEach((block) => {
      block.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const node = state.nodes.find((n) => n.id === block.getAttribute('data-block'));
        if (!node) return;
        event.preventDefault();
        const handle = event.target.closest('[data-handle]');
        const mode = handle ? handle.getAttribute('data-handle') : 'move';
        const startX = event.clientX;
        const width = track.getBoundingClientRect().width || 1;
        const origin = { start: node.startRatio, end: node.endRatio };
        state.selection = { kind: 'node', id: node.id };
        block.classList.add('dragging');
        timelineEl.querySelectorAll('.tl-block').forEach((el) => el.classList.toggle('selected', el === block));
        paintInspector();
        let moved = false;

        const onMove = (moveEvent) => {
          const delta = Math.round(((moveEvent.clientX - startX) / width) * 100) / 100;
          if (Math.abs(moveEvent.clientX - startX) > 2) moved = true;
          if (mode === 'move') {
            const span = origin.end - origin.start;
            const start = clamp(origin.start + delta, 0, 1 - span);
            node.startRatio = round2(start);
            node.endRatio = round2(start + span);
          } else if (mode === 'left') {
            node.startRatio = round2(clamp(origin.start + delta, 0, origin.end));
          } else {
            node.endRatio = round2(clamp(origin.end + delta, origin.start, 1));
          }
          const updated = track.querySelector(`[data-block="${node.id}"]`);
          if (updated) {
            const zero = node.endRatio - node.startRatio < MIN_WIDTH / 100;
            const narrow = node.endRatio - node.startRatio < 0.14;
            updated.classList.toggle('narrow', narrow);
            if (zero) {
              updated.classList.add('zero-width');
              updated.style.left = `max(0px, calc(${node.startRatio * 100}% - 68px))`;
              updated.style.width = '66px';
            } else {
              updated.classList.remove('zero-width');
              updated.style.left = `${node.startRatio * 100}%`;
              updated.style.width = `${(node.endRatio - node.startRatio) * 100}%`;
            }
            updated.title = `${node.name} · ${Math.round(node.startRatio * 100)}%—${Math.round(node.endRatio * 100)}%`;
            const meta = updated.querySelector('.tl-block-meta');
            if (meta) meta.textContent = `${Math.round(node.startRatio * 100)}%—${Math.round(node.endRatio * 100)}%`;
            const axisSub = timelineEl.querySelector(`[data-axis-node="${node.id}"] .tl-axis-sub`);
            const project = previewProject();
            if (axisSub && project) {
              const range = stageRange(project, node);
              axisSub.textContent = `${range.startDate.slice(5)} → ${range.endDate.slice(5)}`;
            }
          }
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          block.classList.remove('dragging');
          if (moved) {
            markDirty();
            paintTimeline();
            paintPreview();
            paintInspector();
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
    timelineEl.querySelectorAll('[data-axis-node]').forEach((item) => {
      item.addEventListener('click', () => {
        state.selection = { kind: 'node', id: item.getAttribute('data-axis-node') };
        paintAll();
      });
    });
  }

  /* ---------------- 材料编排板 ---------------- */
  function materialCard(material) {
    const cat = CATEGORIES[material.category] || { name: material.category, tone: 'slate' };
    return `
      <div class="mat-card ${state.selection.kind === 'material' && state.selection.id === material.id ? 'selected' : ''} ${material.enabled === false ? 'disabled' : ''}"
        draggable="true" data-material-card="${material.id}">
        <div class="mat-card-top">
          <div class="mat-card-name">${escapeHtml(material.name)}</div>
        </div>
        <div class="mat-card-meta">
          <span class="tag tone-${cat.tone}">${cat.name}</span>
          ${material.required ? '<span class="tag tone-rose">必备</span>' : '<span class="tag">选交</span>'}
        </div>
        <div class="mat-card-foot">
          <span class="mono">${escapeHtml(material.code)}</span>
          <span>${ANCHOR_LABEL[material.anchor] || '节点结束'}${material.offsetDays ? ` ${material.offsetDays > 0 ? '+' : ''}${material.offsetDays}天` : ''}</span>
        </div>
      </div>`;
  }

  function paintBoard() {
    const nodes = nodesSorted();
    boardEl.innerHTML = nodes.map((node) => {
      const materials = materialsOf(node.id);
      return `
        <div class="node-col ${state.selection.kind === 'node' && state.selection.id === node.id ? 'selected' : ''}" data-node-col="${node.id}">
          <div class="node-col-head" draggable="true" data-node-head="${node.id}">
            <div class="node-col-title">
              <span class="grip">${icon('grip')}</span>
              <span class="truncate">${escapeHtml(node.name)}</span>
              ${node.enabled ? '' : '<span class="tag">停用</span>'}
            </div>
            <div class="node-col-meta">
              <span>周期 ${Math.round(node.startRatio * 100)}%—${Math.round(node.endRatio * 100)}%</span>
              <span>${materials.length} 项 · 必备 ${materials.filter((m) => m.required).length}</span>
            </div>
          </div>
          <div class="node-col-body" data-node-body="${node.id}">
            ${materials.map(materialCard).join('')}
            ${materials.length ? '' : '<div class="board-empty">拖入材料卡片，或点击下方按钮添加</div>'}
          </div>
          <div class="node-col-foot">
            <button class="btn btn-xs btn-ghost" type="button" data-add-material="${node.id}" style="width:100%">${icon('plus')}添加材料</button>
          </div>
        </div>`;
    }).join('');
    if (!nodes.length) {
      boardEl.innerHTML = emptyBlock({ iconName: 'columns', title: '还没有流程节点', text: '先新增一个节点，再把材料拖进去。' });
    }
    wrap.querySelector('#board-summary').textContent = `${state.nodes.length} 个节点 · ${state.materials.length} 项材料`;
    bindBoard();
  }

  function selectNode(id) {
    state.selection = { kind: 'node', id };
    paintAll();
  }
  function selectMaterial(id) {
    state.selection = { kind: 'material', id };
    paintAll();
  }

  function bindBoard() {
    boardEl.querySelectorAll('[data-node-head]').forEach((head) => {
      head.addEventListener('click', () => selectNode(head.getAttribute('data-node-head')));
      head.addEventListener('dragstart', (event) => {
        state.dragKind = 'node';
        state.dragId = head.getAttribute('data-node-head');
        head.closest('.node-col')?.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `node:${state.dragId}`);
      });
      head.addEventListener('dragend', () => {
        state.dragKind = '';
        boardEl.querySelectorAll('.node-col').forEach((col) => col.classList.remove('dragging', 'drag-over'));
      });
    });
    boardEl.querySelectorAll('.node-col').forEach((col) => {
      const nodeId = col.getAttribute('data-node-col');
      col.addEventListener('click', (event) => {
        if (event.target.closest('.mat-card') || event.target.closest('button')) return;
        if (event.target.closest('.node-col-head')) return;
        selectNode(nodeId);
      });
      col.addEventListener('dragover', (event) => {
        if (state.dragKind !== 'node') return;
        event.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', (event) => {
        if (!col.contains(event.relatedTarget)) col.classList.remove('drag-over');
      });
      col.addEventListener('drop', (event) => {
        if (state.dragKind !== 'node') return;
        event.preventDefault();
        col.classList.remove('drag-over');
        reorderNodes(state.dragId, nodeId);
      });
      const body = col.querySelector('[data-node-body]');
      body.addEventListener('dragover', (event) => {
        if (state.dragKind !== 'material') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      body.addEventListener('dragleave', (event) => {
        if (!body.contains(event.relatedTarget)) col.classList.remove('drag-over');
      });
      body.addEventListener('drop', (event) => {
        if (state.dragKind !== 'material') return;
        event.preventDefault();
        col.classList.remove('drag-over');
        moveMaterial(state.dragId, nodeId, null);
        state.dragKind = '';
      });
    });
    boardEl.querySelectorAll('[data-material-card]').forEach((card) => {
      const id = card.getAttribute('data-material-card');
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        selectMaterial(id);
      });
      card.addEventListener('dragstart', (event) => {
        state.dragKind = 'material';
        state.dragId = id;
        const material = state.materials.find((m) => m.id === id);
        state.dragSourceNode = material?.nodeId || '';
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `material:${id}`);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        state.dragKind = '';
        boardEl.querySelectorAll('.mat-card').forEach((el) => el.classList.remove('drop-before'));
      });
      card.addEventListener('dragover', (event) => {
        if (state.dragKind !== 'material' || id === state.dragId) return;
        event.preventDefault();
        event.stopPropagation();
        boardEl.querySelectorAll('.mat-card').forEach((el) => el.classList.remove('drop-before'));
        card.classList.add('drop-before');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
      card.addEventListener('drop', (event) => {
        if (state.dragKind !== 'material' || id === state.dragId) return;
        event.preventDefault();
        event.stopPropagation();
        card.classList.remove('drop-before');
        const material = state.materials.find((m) => m.id === id);
        moveMaterial(state.dragId, material.nodeId, id);
        state.dragKind = '';
      });
    });
    boardEl.querySelectorAll('[data-add-material]').forEach((button) => {
      button.addEventListener('click', () => addMaterial(button.getAttribute('data-add-material')));
    });
  }

  function reorderNodes(sourceId, targetId) {
    if (state.dragKind !== 'node' || !sourceId || sourceId === targetId) return;
    const ordered = nodesSorted();
    const from = ordered.findIndex((n) => n.id === sourceId);
    const to = ordered.findIndex((n) => n.id === targetId);
    if (from < 0 || to < 0) return;
    const [moving] = ordered.splice(from, 1);
    ordered.splice(to, 0, moving);
    ordered.forEach((node, index) => { node.seq = index + 1; });
    state.dragKind = '';
    markDirty();
    paintAll();
  }

  function moveMaterial(id, toNodeId, beforeId) {
    const moving = state.materials.find((m) => m.id === id);
    if (!moving) return;
    const targetNode = state.nodes.find((n) => n.id === toNodeId);
    if (!targetNode) return;
    const targetList = materialsOf(toNodeId).filter((m) => m.id !== id);
    if (beforeId) {
      const index = targetList.findIndex((m) => m.id === beforeId);
      if (index >= 0) targetList.splice(index, 0, moving);
      else targetList.push(moving);
    } else {
      targetList.push(moving);
    }
    moving.nodeId = toNodeId;
    const orderedNodes = nodesSorted();
    const ordered = [];
    orderedNodes.forEach((node) => {
      const list = node.id === toNodeId ? targetList : materialsOf(node.id).filter((m) => m.id !== id);
      list.forEach((material) => ordered.push(material));
    });
    ordered.forEach((material, index) => { material.seq = index + 1; });
    state.materials = ordered;
    markDirty();
    paintGrid();
    paintBoard();
    paintPreview();
  }

  function addMaterial(nodeId) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const codeBase = String(node.code || 'NODE').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'MAT';
    let index = state.materials.filter((m) => m.nodeId === nodeId).length + 1;
    let code = `M-${codeBase}-${String(index).padStart(2, '0')}`;
    while (state.materials.some((m) => String(m.code).toUpperCase() === code)) {
      index += 1;
      code = `M-${codeBase}-${String(index).padStart(2, '0')}`;
    }
    const material = {
      id: uid('t'),
      code,
      name: `新增材料 ${index}`,
      nodeId,
      category: 'INITIATION',
      required: true,
      anchor: 'STAGE_END',
      offsetDays: 0,
      allowLate: true,
      note: '',
      seq: state.materials.length + 1,
      enabled: true
    };
    state.materials.push(material);
    state.selection = { kind: 'material', id: material.id };
    markDirty();
    paintAll();
    inspectorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- 检查器 ---------------- */
  function nodeMaterialsStats(nodeId) {
    const list = materialsOf(nodeId);
    return { total: list.length, required: list.filter((m) => m.required).length };
  }

  function paintInspector() {
    const node = selectedNode();
    const material = selectedMaterial();
    if (node) {
      const stats = nodeMaterialsStats(node.id);
      inspectorEl.innerHTML = `
        <div class="inspector-head">
          <div>
            <div class="card-title">${icon('layers')}节点属性</div>
            <div class="card-sub">顺序 #${node.seq} · ${stats.total} 项材料（必备 ${stats.required}）</div>
          </div>
          ${node.enabled ? '<span class="pill tone-emerald"><span class="pill-dot"></span>启用</span>' : '<span class="pill tone-slate"><span class="pill-dot"></span>停用</span>'}
        </div>
        <div class="inspector-body">
          <div class="field">
            <label class="label">节点名称</label>
            <input class="input" data-field="name" data-scope="node" value="${escapeHtml(node.name)}" />
          </div>
          <div class="field">
            <label class="label">节点编码</label>
            <input class="input mono" data-field="code" data-scope="node" value="${escapeHtml(node.code)}" />
            <div class="hint">编码唯一，用于材料归属与历史数据对照</div>
          </div>
          <div class="ratio-row">
            <div class="field">
              <label class="label">开始比例（%）</label>
              <input class="input" type="number" min="0" max="100" step="0.5" data-field="startRatio" data-scope="node" value="${Math.round(node.startRatio * 1000) / 10}" />
            </div>
            <div class="field">
              <label class="label">结束比例（%）</label>
              <input class="input" type="number" min="0" max="100" step="0.5" data-field="endRatio" data-scope="node" value="${Math.round(node.endRatio * 1000) / 10}" />
            </div>
          </div>
          <div class="ratio-row">
            <div class="field">
              <label class="label">开始偏移（天）</label>
              <input class="input" type="number" step="1" data-field="startOffset" data-scope="node" value="${node.startOffset || 0}" />
            </div>
            <div class="field">
              <label class="label">结束偏移（天）</label>
              <input class="input" type="number" step="1" data-field="endOffset" data-scope="node" value="${node.endOffset || 0}" />
            </div>
          </div>
          <div class="anchor-hint">
            ${icon('info', 'ic-sm')} 当前节点计划为项目周期的 <b>${Math.round(node.startRatio * 100)}% — ${Math.round(node.endRatio * 100)}%</b>${node.startOffset || node.endOffset ? `，并偏移 <b>${node.startOffset || 0} / ${node.endOffset || 0}</b> 天` : ''}。
          </div>
          <div class="field">
            <label class="label">节点说明</label>
            <textarea class="textarea" data-field="description" data-scope="node">${escapeHtml(node.description || '')}</textarea>
          </div>
          <label class="switch">
            <input type="checkbox" data-field="enabled" data-scope="node" ${node.enabled ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">新建项目时生成该节点</span>
          </label>
          <div class="danger-zone">
            <span>删除节点会同时移除其材料</span>
            <button class="btn btn-xs btn-danger" type="button" data-delete-node>删除</button>
          </div>
        </div>
        <div class="inspector-foot">
          <button class="btn btn-sm btn-soft" type="button" data-add-material-here>${icon('plus')}新增材料</button>
          <button class="btn btn-sm btn-ghost" type="button" data-focus-timeline>${icon('move')}在时间轴上查看</button>
        </div>`;
      inspectorEl.querySelector('[data-delete-node]').addEventListener('click', () => deleteNode(node));
      inspectorEl.querySelector('[data-add-material-here]').addEventListener('click', () => addMaterial(node.id));
      inspectorEl.querySelector('[data-focus-timeline]').addEventListener('click', () => timelineEl.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } else if (material) {
      const node = state.nodes.find((n) => n.id === material.nodeId);
      const project = previewProject();
      const stage = project ? stageRange(project, node) : null;
      const due = project && stage ? materialDue(project, stage, material) : '—';
      inspectorEl.innerHTML = `
        <div class="inspector-head">
          <div>
            <div class="card-title">${icon('fileText')}材料属性</div>
            <div class="card-sub">${escapeHtml(node?.name || '未归属')} · ${material.required ? '必备材料' : '选交材料'}</div>
          </div>
          ${material.enabled ? '<span class="pill tone-emerald"><span class="pill-dot"></span>启用</span>' : '<span class="pill tone-slate"><span class="pill-dot"></span>停用</span>'}
        </div>
        <div class="inspector-body">
          <div class="field">
            <label class="label">材料名称</label>
            <input class="input" data-field="name" data-scope="material" value="${escapeHtml(material.name)}" />
          </div>
          <div class="field">
            <label class="label">材料编码</label>
            <input class="input mono" data-field="code" data-scope="material" value="${escapeHtml(material.code)}" />
          </div>
          <div class="field">
            <label class="label">所属节点</label>
            <select class="select" data-field="nodeId" data-scope="material">
              ${nodesSorted().map((n) => `<option value="${n.id}" ${n.id === material.nodeId ? 'selected' : ''}>${escapeHtml(n.name)}${n.enabled ? '' : '（停用）'}</option>`).join('')}
            </select>
          </div>
          <div class="ratio-row">
            <div class="field">
              <label class="label">业务分类</label>
              <select class="select" data-field="category" data-scope="material">
                ${state.categories.map((c) => `<option value="${c.code}" ${c.code === material.category ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="label">截止锚点</label>
              <select class="select" data-field="anchor" data-scope="material">
                ${state.anchors.map((a) => `<option value="${a.code}" ${a.code === material.anchor ? 'selected' : ''}>${a.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="ratio-row">
            <div class="field">
              <label class="label">偏移天数</label>
              <input class="input" type="number" step="1" data-field="offsetDays" data-scope="material" value="${material.offsetDays || 0}" />
            </div>
            <div class="field">
              <label class="label">预览截止</label>
              <div class="input" style="display:flex;align-items:center;background:var(--surface-2);color:var(--muted);font-family:var(--mono);font-size:12px">${due}</div>
            </div>
          </div>
          <div class="anchor-hint">${icon('info', 'ic-sm')} 截止日期 = <b>${ANCHOR_LABEL[material.anchor] || '节点结束'}</b> ${material.offsetDays ? `${material.offsetDays > 0 ? '+' : ''}${material.offsetDays} 天` : '当天'}。</div>
          <label class="switch">
            <input type="checkbox" data-field="required" data-scope="material" ${material.required ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">必备材料（纳入逾期提醒）</span>
          </label>
          <label class="switch">
            <input type="checkbox" data-field="allowLate" data-scope="material" ${material.allowLate !== false ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">允许逾期补传</span>
          </label>
          <label class="switch">
            <input type="checkbox" data-field="enabled" data-scope="material" ${material.enabled !== false ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span class="switch-label">新建项目时生成该材料</span>
          </label>
          <div class="field">
            <label class="label">说明</label>
            <textarea class="textarea" data-field="note" data-scope="material">${escapeHtml(material.note || '')}</textarea>
          </div>
          <div class="danger-zone">
            <span>删除后不再生成该材料</span>
            <button class="btn btn-xs btn-danger" type="button" data-delete-material>删除</button>
          </div>
        </div>
        <div class="inspector-foot">
          <button class="btn btn-sm btn-secondary" type="button" data-duplicate-material>${icon('copy')}复制材料</button>
          <button class="btn btn-sm btn-ghost" type="button" data-focus-node>${icon('layers')}定位节点</button>
        </div>`;
      inspectorEl.querySelector('[data-delete-material]').addEventListener('click', () => deleteMaterial(material));
      inspectorEl.querySelector('[data-duplicate-material]').addEventListener('click', () => duplicateMaterial(material));
      inspectorEl.querySelector('[data-focus-node]').addEventListener('click', () => selectNode(material.nodeId));
    } else {
      inspectorEl.innerHTML = `
        <div class="inspector-head"><div class="card-title">${icon('settings')}属性检查器</div></div>
        <div class="inspector-empty">
          <div class="empty-icon" style="margin:0 auto 10px">${icon('move')}</div>
          点击时间轴上的节点或材料卡片<br />在这里编辑详细属性
        </div>
        <div class="inspector-foot"><span class="hint">拖拽首选项：时间轴调整周期，编排板调整归属</span></div>`;
    }
    bindInspector();
  }

  let repaintTimer = null;
  function scheduleRepaint(fn) {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(fn, 90);
  }

  function bindInspector() {
    inspectorEl.querySelectorAll('[data-field]').forEach((input) => {
      const scope = input.getAttribute('data-scope');
      const field = input.getAttribute('data-field');
      const handler = () => {
        const node = selectedNode();
        const material = selectedMaterial();
        if (scope === 'node' && !node) return;
        if (scope === 'material' && !material) return;
        if (input.type === 'checkbox') {
          if (scope === 'node') node[field] = input.checked;
          else material[field] = input.checked;
        } else if (input.type === 'number' || field === 'startRatio' || field === 'endRatio' || field === 'startOffset' || field === 'endOffset' || field === 'offsetDays') {
          let value = Number(input.value);
          if (!Number.isFinite(value)) value = 0;
          if (field === 'startRatio' || field === 'endRatio') value = clamp(value, 0, 100) / 100;
          if (scope === 'node') node[field] = value;
          else material[field] = Math.round(value);
          if (scope === 'node' && field === 'startRatio' && node.startRatio > node.endRatio) node.endRatio = node.startRatio;
          if (scope === 'node' && field === 'endRatio' && node.endRatio < node.startRatio) node.startRatio = node.endRatio;
        } else if (field === 'nodeId') {
          material.nodeId = input.value;
        } else {
          if (scope === 'node') node[field] = input.value;
          else material[field] = input.value;
        }
        markDirty();
        if (field === 'nodeId') {
          paintBoard();
          paintPreview();
        } else if (scope === 'node' && (field === 'startRatio' || field === 'endRatio' || field === 'startOffset' || field === 'endOffset')) {
          scheduleRepaint(() => { paintTimeline(); paintPreview(); });
        } else if (field === 'enabled') {
          paintTimeline(); paintBoard();
        } else {
          scheduleRepaint(() => { paintBoard(); paintTimeline(); paintPreview(); });
        }
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
  }

  function deleteNode(node) {
    confirmDialog({
      title: '删除流程节点',
      message: `确定删除节点「${node.name}」吗？其下的 ${materialsOf(node.id).length} 项材料会一并移除。`,
      detail: '保存后，新建项目将不再生成该节点；已创建项目保持不变。',
      tone: 'danger', confirmText: '删除节点'
    }).then((ok) => {
      if (!ok) return;
      state.nodes = state.nodes.filter((n) => n.id !== node.id);
      state.materials = state.materials.filter((m) => m.nodeId !== node.id);
      state.nodes.sort((a, b) => a.seq - b.seq).forEach((n, index) => { n.seq = index + 1; });
      state.selection = { kind: 'node', id: state.nodes[0]?.id || '' };
      markDirty();
      paintAll();
      toast('节点已删除，保存后生效', 'info');
    });
  }

  function deleteMaterial(material) {
    confirmDialog({
      title: '删除材料模板',
      message: `确定删除材料「${material.name}」吗？`,
      detail: '保存后，新建项目不再生成该材料；历史项目的材料实例不受影响。',
      tone: 'danger', confirmText: '删除'
    }).then((ok) => {
      if (!ok) return;
      state.materials = state.materials.filter((m) => m.id !== material.id);
      state.materials.forEach((m, index) => { m.seq = index + 1; });
      state.selection = { kind: 'node', id: material.nodeId };
      markDirty();
      paintAll();
    });
  }

  function duplicateMaterial(material) {
    const copy = { ...material, id: uid('t'), code: `${material.code}-COPY`, name: `${material.name}（副本）`, seq: state.materials.length + 1, enabled: true };
    state.materials.push(copy);
    state.selection = { kind: 'material', id: copy.id };
    markDirty();
    paintAll();
    toast('已复制材料模板', 'success');
  }

  /* ---------------- 预览 ---------------- */
  function paintPreview() {
    const project = previewProject();
    if (!project) {
      previewBody.innerHTML = `<div style="padding:16px">${emptyBlock({ iconName: 'folder', title: '没有可用于预览的项目', text: '创建项目后即可查看模板生成的实际日期。' })}</div>`;
      return;
    }
    previewSub.textContent = `预览项目：${project.code} · ${project.name}（${project.startDate} → ${project.endDate}）`;
    const rows = nodesSorted().map((node) => {
      const range = stageRange(project, node);
      const list = materialsOf(node.id).filter((m) => m.enabled !== false);
      const dues = list.map((m) => materialDue(project, range, m)).sort();
      return `
        <tr>
          <td>
            <div class="cell-main">${escapeHtml(node.name)} ${node.enabled ? '' : '<span class="tag">停用</span>'}</div>
            <div class="cell-sub mono">${escapeHtml(node.code)}</div>
          </td>
          <td class="num">${Math.round(node.startRatio * 100)}% — ${Math.round(node.endRatio * 100)}%${node.startOffset || node.endOffset ? `<div class="cell-sub">偏移 ${node.startOffset || 0}/${node.endOffset || 0} 天</div>` : ''}</td>
          <td class="num nowrap">${range.startDate} <span class="faint">→</span> ${range.endDate}</td>
          <td class="num">${list.filter((m) => m.required).length} 必备 / ${list.length - list.filter((m) => m.required).length} 选交</td>
          <td class="num nowrap">${dues.length ? (dues[0] === dues[dues.length - 1] ? dues[0] : `${dues[0]} → ${dues[dues.length - 1]}`) : '—'}</td>
        </tr>`;
    }).join('');
    previewBody.innerHTML = `
      <table class="table">
        <thead><tr><th>节点</th><th>周期比例</th><th>计划起止</th><th>材料数量</th><th>材料截止区间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function paintGrid() {
    // 保持面板布局同步（时间轴、编排板、预览）
    paintTimeline();
    paintBoard();
    paintPreview();
  }

  function paintAll() {
    paintTimeline();
    paintBoard();
    paintInspector();
    paintPreview();
    wrap.querySelector('#board-summary').textContent = `${state.nodes.length} 个节点 · ${state.materials.length} 项材料`;
  }

  /* ---------------- 顶部操作 ---------------- */
  wrap.querySelector('#add-node').addEventListener('click', () => {
    const last = nodesSorted().slice(-1)[0];
    const start = last ? Math.min(1, last.endRatio) : 0;
    const end = Math.min(1, start + 0.1);
    let seq = nextSeq();
    while (state.nodes.some((n) => String(n.code).toUpperCase() === `NODE-${String(seq).padStart(2, '0')}`)) seq += 1;
    const node = {
      id: uid('n'),
      code: `NODE-${String(seq).padStart(2, '0')}`,
      name: '新增节点',
      seq: nextSeq(),
      startRatio: round2(start),
      endRatio: round2(Math.max(start, end)),
      startOffset: 0,
      endOffset: 0,
      description: '',
      enabled: true
    };
    state.nodes.push(node);
    state.selection = { kind: 'node', id: node.id };
    markDirty();
    paintAll();
    inspectorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  selectEl.addEventListener('change', () => {
    state.previewProjectId = selectEl.value;
    paintTimeline();
    paintPreview();
    if (state.selection.kind === 'material') paintInspector();
  });

  wrap.querySelector('#reset-btn').addEventListener('click', async () => {
    const confirmReset = async () => {
      const fresh = await api('/templates');
      state.nodes = deepClone(fresh.nodes);
      state.materials = deepClone(fresh.materials);
      state.selection = { kind: 'node', id: state.nodes[0]?.id || '' };
      state.updatedAt = fresh.updatedAt;
      markClean();
      paintAll();
    };
    if (!state.dirty) {
      await confirmReset();
      toast('模板已重新加载', 'info');
      return;
    }
    const ok = await confirmDialog({
      title: '放弃未保存的修改？',
      message: '当前有未保存的模板调整，重置后这些修改会丢失。',
      confirmText: '放弃修改', tone: 'danger'
    });
    if (ok) {
      await confirmReset();
      toast('已恢复为最近一次保存的模板', 'info');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const names = new Set();
    for (const node of state.nodes) {
      const name = String(node.name || '').trim();
      if (!name) return toast('节点名称不能为空', 'error');
      if (names.has(node.id)) return toast(`节点「${name}」重复`, 'error');
      if (!String(node.code || '').trim()) return toast(`节点「${name}」缺少编码`, 'error');
    }
    const codes = new Set();
    for (const node of state.nodes) {
      const code = String(node.code).trim().toUpperCase();
      if (codes.has(code)) return toast(`节点编码 ${code} 重复`, 'error');
      codes.add(code);
    }
    const materialCodes = new Set();
    for (const material of state.materials) {
      if (!String(material.name || '').trim()) return toast('材料名称不能为空', 'error');
      const code = String(material.code || '').trim().toUpperCase();
      if (!code) return toast(`材料「${material.name}」缺少编码`, 'error');
      if (materialCodes.has(code)) return toast(`材料编码 ${code} 重复`, 'error');
      materialCodes.add(code);
      if (!state.nodes.some((n) => n.id === material.nodeId)) return toast(`材料「${material.name}」未归属有效节点`, 'error');
    }
    setBusy(saveBtn, true, '保存中…');
    try {
      const result = await api('/templates', {
        method: 'PUT',
        body: {
          nodes: state.nodes.map((node, index) => ({ ...node, seq: index + 1 })),
          materials: state.materials.map((material, index) => ({ ...material, seq: index + 1 }))
        }
      });
      state.updatedAt = result.updatedAt;
      markClean();
      toast(`模板已保存：${result.nodes} 个节点、${result.materials} 项材料，新项目将按新模板生成`, 'success', 4200);
      paintAll();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(saveBtn, false);
      saveBtn.disabled = !state.dirty;
    }
  });

  if (!state.nodes.length) {
    state.selection = { kind: '', id: '' };
  }
  markClean();
  paintAll();
  return wrap;
}
