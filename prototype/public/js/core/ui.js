import { escapeHtml } from './format.js';
import { icon } from './icons.js';

/* ---------------- 轻提示 ---------------- */
export function toast(message, type = 'info', timeout = 3400) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  const iconName = type === 'success' ? 'checkCircle' : type === 'error' ? 'alertCircle' : 'info';
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(iconName)}<div class="toast-text">${escapeHtml(message)}</div>`;
  root.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  };
  const timer = setTimeout(remove, timeout);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/* ---------------- 弹窗 ---------------- */
export function modal(options = {}) {
  const {
    title = '', subtitle = '', body = '', footer = '', size = '',
    onMount, onClose, closable = true
  } = options;
  const root = document.getElementById('overlay-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <div class="modal-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="modal-sub">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        ${closable ? `<button class="modal-close" type="button" aria-label="关闭">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  const bodyEl = backdrop.querySelector('.modal-body');
  const footEl = backdrop.querySelector('.modal-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  if (footEl) {
    if (typeof footer === 'string') footEl.innerHTML = footer;
    else if (footer instanceof Node) footEl.appendChild(footer);
  }
  root.appendChild(backdrop);

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (typeof onClose === 'function') onClose(result);
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && closable) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && closable) close();
  });
  backdrop.querySelectorAll('[data-close], .modal-close').forEach((el) => el.addEventListener('click', () => close()));
  const handle = { el: backdrop, body: bodyEl, footer: footEl, close };
  if (typeof onMount === 'function') onMount(bodyEl, handle);
  return handle;
}

/* ---------------- 抽屉 ---------------- */
export function drawer(options = {}) {
  const { title = '', subtitle = '', body = '', footer = '', onMount, onClose } = options;
  const root = document.getElementById('overlay-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true">
      <div class="drawer-head">
        <div>
          <div class="modal-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="modal-sub">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        <button class="modal-close" type="button" aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body"></div>
      ${footer ? '<div class="drawer-foot"></div>' : ''}
    </div>`;
  const bodyEl = backdrop.querySelector('.drawer-body');
  const footEl = backdrop.querySelector('.drawer-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  if (footEl) {
    if (typeof footer === 'string') footEl.innerHTML = footer;
    else if (footer instanceof Node) footEl.appendChild(footer);
  }
  root.appendChild(backdrop);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (typeof onClose === 'function') onClose(result);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-close], .modal-close').forEach((el) => el.addEventListener('click', () => close()));
  const handle = { el: backdrop, body: bodyEl, footer: footEl, close };
  if (typeof onMount === 'function') onMount(bodyEl, handle);
  return handle;
}

/* ---------------- 确认框 ---------------- */
export function confirmDialog(options = {}) {
  const {
    title = '确认操作', message = '', confirmText = '确认', cancelText = '取消',
    tone = 'primary', detail = ''
  } = options;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const handle = modal({
      title,
      size: 'narrow',
      body: `
        <div style="display:flex;gap:13px;align-items:flex-start">
          <span class="alert-stat" style="padding:0;border:0;box-shadow:none;background:transparent">
            <span class="ring" style="background:${tone === 'danger' ? '#feecef' : '#eef0ff'};color:${tone === 'danger' ? '#e11d48' : '#4f46e5'};width:38px;height:38px;border-radius:11px">${icon(tone === 'danger' ? 'alertTriangle' : 'info')}</span>
          </span>
          <div>
            <div style="font-size:13px;line-height:1.65;color:var(--ink-2)">${escapeHtml(message)}</div>
            ${detail ? `<div class="hint" style="margin-top:7px">${escapeHtml(detail)}</div>` : ''}
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" type="button" data-cancel>${escapeHtml(cancelText)}</button>
        <button class="btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}" type="button" data-confirm>${escapeHtml(confirmText)}</button>`,
      onClose: () => finish(false)
    });
    handle.footer.querySelector('[data-cancel]').addEventListener('click', () => { finish(false); handle.close(); });
    handle.footer.querySelector('[data-confirm]').addEventListener('click', () => { finish(true); handle.close(); });
  });
}

/* ---------------- 表单读取 ---------------- */
export function formValues(scope) {
  const values = {};
  scope.querySelectorAll('[name]').forEach((el) => {
    const name = el.getAttribute('name');
    if (!name) return;
    if (el.type === 'checkbox') values[name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) values[name] = el.value; }
    else values[name] = el.value;
  });
  return values;
}

export function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.original) button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner light" style="width:14px;height:14px"></span>${escapeHtml(label)}`;
  } else {
    button.disabled = false;
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }
}

export function debounce(fn, wait = 260) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ---------------- 通用片段 ---------------- */
export function emptyBlock({ iconName = 'inbox', title = '暂无数据', text = '', action = '' } = {}) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      ${text ? `<div class="empty-text">${escapeHtml(text)}</div>` : ''}
      ${action}
    </div>`;
}

export function fileKind(filename = '') {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return { cls: 'pdf', icon: 'fileText' };
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return { cls: 'img', icon: 'eye' };
  if (['doc', 'docx'].includes(ext)) return { cls: 'doc', icon: 'fileText' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { cls: 'doc', icon: 'fileText' };
  if (['ppt', 'pptx'].includes(ext)) return { cls: 'doc', icon: 'fileText' };
  if (['zip', 'rar', '7z'].includes(ext)) return { cls: 'zip', icon: 'archive' };
  return { cls: '', icon: 'fileText' };
}

export function progressBar(value, tone = '') {
  const v = Math.max(0, Math.min(100, Number(value || 0)));
  return `<div class="progress"><div class="progress-bar ${tone}" style="width:${v}%"></div></div>`;
}

export function field({ label, name, type = 'text', value = '', placeholder = '', hint = '', required = false, span = false, options = [], rows = 3, min, max, step, disabled = false }) {
  const spanCls = span ? 'span-2' : '';
  const req = required ? '<span class="req">*</span>' : '';
  let control = '';
  if (type === 'select') {
    control = `<select class="select" name="${name}" ${disabled ? 'disabled' : ''}>${options.map((opt) => {
      const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
      const selected = String(o.value) === String(value) ? 'selected' : '';
      return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea" name="${name}" rows="${rows}" placeholder="${escapeHtml(placeholder)}" ${disabled ? 'disabled' : ''}>${escapeHtml(value)}</textarea>`;
  } else {
    const extra = [min !== undefined ? `min="${min}"` : '', max !== undefined ? `max="${max}"` : '', step !== undefined ? `step="${step}"` : ''].filter(Boolean).join(' ');
    control = `<input class="input" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${extra} ${disabled ? 'disabled' : ''} />`;
  }
  return `<div class="field ${spanCls}">
    <label class="label">${escapeHtml(label)}${req}</label>
    ${control}
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

export function switchField({ label, name, checked = true, hint = '' }) {
  return `<div class="field">
    <div class="label">${escapeHtml(label)}</div>
    <label class="switch">
      <input type="checkbox" name="${name}" ${checked ? 'checked' : ''} />
      <span class="switch-track"></span>
      <span class="switch-label">${checked ? '启用' : '停用'}</span>
    </label>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

export function avatarHTML(name, tone = '', size = '') {
  const chars = String(name || '·').trim().slice(-2) || '·';
  return `<span class="avatar ${size} ${tone ? `tone-${tone}` : ''}">${escapeHtml(chars)}</span>`;
}
