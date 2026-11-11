import { api, attachmentUrl, uploadFile } from '../core/api.js';
import { icon } from '../core/icons.js';
import { escapeHtml, dateText, dateTimeText, fileSize, statusPill, quarterName } from '../core/format.js';
import { drawer, formValues, setBusy, toast, confirmDialog, fileKind } from '../core/ui.js';

const MAX_SIZE = 20 * 1024 * 1024;

export async function openQuarterEditor(rowId, { user, onSaved } = {}) {
  let row;
  try {
    row = await api(`/quarterly/${rowId}`);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const canWrite = user.role !== 'VIEWER';
  const editable = canWrite && row.status !== 'SUBMITTED';
  const canWithdraw = ['ADMIN', 'RESEARCH_MANAGER'].includes(user.role);

  const handle = drawer({
    title: `${quarterName(row.year, row.quarter)} 季度执行情况表`,
    subtitle: `${row.projectCode} · ${row.projectName} · 截止 ${dateText(row.dueDate)}`,
    body: `
      <div class="row gap-8 wrap" style="margin-bottom:14px">
        ${statusPill('quarter', row.displayStatus)}
        ${row.status === 'SUBMITTED' ? `<span class="hint">${escapeHtml(row.submitterName || '—')} · ${dateTimeText(row.submitAt)} 提交</span>` : '<span class="hint">未提交，可保存草稿后再次编辑</span>'}
        ${row.displayStatus === 'OVERDUE' ? '<span class="tag tone-rose">已过截止日期，提交将标记逾期</span>' : ''}
      </div>
      <form id="quarter-editor-form" class="col gap-12">
        <div class="field">
          <label class="label">本期执行情况 <span class="req">*</span></label>
          <textarea class="textarea" name="exec" rows="4" ${editable ? '' : 'disabled'} placeholder="本季度完成的主要工作、里程碑与指标达成情况">${escapeHtml(row.exec || '')}</textarea>
        </div>
        <div class="field">
          <label class="label">阶段成果</label>
          <textarea class="textarea" name="achievement" rows="2" ${editable ? '' : 'disabled'} placeholder="样机、报告、知识产权等成果">${escapeHtml(row.achievement || '')}</textarea>
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
      <div id="quarter-attachments"></div>
      ${editable ? `
        <div class="upload-zone" id="quarter-upload-zone" style="margin-top:12px">
          ${icon('upload')}
          <div>拖入或点击上传季度附件</div>
          <div class="hint" style="margin-top:3px">PDF、Office、图片、压缩包，单文件不超过 20MB</div>
        </div>
        <input type="file" id="quarter-file-input" multiple style="display:none" />` : ''}
    `,
    footer: `
      <div class="left">
        ${row.status === 'SUBMITTED' && canWithdraw ? `<button class="btn btn-sm btn-danger" type="button" data-withdraw>${icon('rotate')}撤回报表</button>` : ''}
      </div>
      <button class="btn btn-secondary" type="button" data-close>关闭</button>
      ${editable ? `<button class="btn btn-secondary" type="button" data-draft>保存草稿</button><button class="btn btn-primary" type="button" data-submit>${row.displayStatus === 'OVERDUE' ? '逾期补报' : '提交报表'}</button>` : ''}`
  });

  const attachmentsSlot = handle.body.querySelector('#quarter-attachments');
  const renderAttachments = (files) => {
    if (!files?.length) {
      attachmentsSlot.innerHTML = '<div class="hint">暂无附件</div>';
      return;
    }
    attachmentsSlot.innerHTML = `<div class="attachment-list">${files.map((file) => {
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
            ${canWrite ? `<button class="btn btn-xs btn-ghost" style="color:#be123c" type="button" data-del="${file.id}">${icon('trash')}</button>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
    attachmentsSlot.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '删除附件', message: '确定删除该报表附件吗？', tone: 'danger', confirmText: '删除' });
      if (!ok) return;
      try {
        await api(`/attachments/${el.getAttribute('data-del')}`, { method: 'DELETE' });
        toast('附件已删除', 'success');
        await reload();
      } catch (error) {
        toast(error.message, 'error');
      }
    }));
  };
  renderAttachments(row.attachments || []);

  const reload = async () => {
    row = await api(`/quarterly/${rowId}`);
    renderAttachments(row.attachments || []);
    onSaved?.();
  };

  const form = handle.body.querySelector('#quarter-editor-form');
  const save = async (action, button) => {
    const values = formValues(form);
    if (action === 'submit' && String(values.exec || '').trim().length < 5) {
      toast('提交前请填写本期执行情况（至少 5 个字）', 'error');
      return;
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
      onSaved?.();
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
      onSaved?.();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const uploadZone = handle.body.querySelector('#quarter-upload-zone');
  const fileInput = handle.body.querySelector('#quarter-file-input');
  if (uploadZone && fileInput) {
    const upload = async (files) => {
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
        await reload();
      }
    };
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => upload(Array.from(fileInput.files || [])));
    ['dragenter', 'dragover'].forEach((type) => uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach((type) => uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (type === 'drop') upload(Array.from(event.dataTransfer?.files || []));
    }));
  }
  return handle;
}
