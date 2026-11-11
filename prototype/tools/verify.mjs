// 原型功能验证：角色权限、拖拽保存、拖拽上传、响应式与大屏。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8088';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const OUT = path.resolve(import.meta.dirname, '..', 'screenshots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-verify-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1600,1000', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const errors = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS ${name}${detail ? ` :: ${detail}` : ''}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`); }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const { result, exceptionDetails } = message.result || {};
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result?.value;
}

async function goto(url, wait = 1000) {
  await send('Page.navigate', { url: `${BASE}${url}` });
  await sleep(wait);
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('#page .page-head') || document.querySelector('.auth') || document.querySelector('.display') || document.querySelector('.key-gate'))`);
    if (ready) break;
    await sleep(250);
  }
  await sleep(350);
}

async function capture(name) {
  const message = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(message.result.data, 'base64'));
  console.log(`  · 截图 ${name}.png`);
}

async function loginAs(username, password = '123456') {
  const result = await evaluate(`(async () => {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${username}', password: '${password}' }) });
    const payload = await res.json();
    if (!payload.data) return { error: payload.message };
    localStorage.setItem('rms.token', payload.data.token);
    localStorage.setItem('rms.user', JSON.stringify(payload.data.user));
    localStorage.setItem('rms.displayKey', 'research2026');
    return { ok: true, role: payload.data.user.role, name: payload.data.user.name };
  })()`);
  return result;
}

async function resetDemo() {
  await evaluate(`(async () => {
    const token = localStorage.getItem('rms.token');
    await fetch('/api/system/reset-demo', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    return true;
  })()`);
}

async function main() {
  await sleep(1200);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  console.log('\n[1] 管理员：流程模板拖拽保存');
  await goto('/login', 700);
  console.log('  登录：', JSON.stringify(await loginAs('admin')));
  await goto('/templates', 1200);
  const dragSaved = await evaluate(`(async () => {
    const block = document.querySelector('[data-block]');
    const track = document.querySelector('#tl-track');
    if (!block || !track) return { error: 'missing' };
    const id = block.getAttribute('data-block');
    const rect = block.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    block.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 120, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 120, clientY: y, bubbles: true, pointerId: 1, button: 0 }));
    await new Promise((r) => setTimeout(r, 200));
    const left = document.querySelector('[data-block="' + id + '"]').style.left;
    const dirty = document.querySelector('#save-state').textContent.trim();
    document.querySelector('#save-btn').click();
    await new Promise((r) => setTimeout(r, 1200));
    const saveState = document.querySelector('#save-state').textContent.trim();
    const templates = await fetch('/api/templates', { headers: { Authorization: 'Bearer ' + localStorage.getItem('rms.token') } }).then((r) => r.json());
    const node = templates.data.nodes.find((n) => n.id === id);
    return { id, left, dirty, saveState, persistedRatio: node ? node.startRatio : null };
  })()`);
  console.log('    拖拽保存结果：', JSON.stringify(dragSaved));
  check('节点拖拽后进入未保存状态', String(dragSaved.dirty).includes('未保存'));
  check('保存后状态回到已保存', String(dragSaved.saveState).includes('已保存'), dragSaved.saveState);
  check('模板比例已持久化到后端', Number(dragSaved.persistedRatio) > 0, `startRatio=${dragSaved.persistedRatio}`);

  console.log('\n[2] 项目材料拖拽上传');
  await resetDemo();
  await goto('/projects/p4', 1200);
  const uploadResult = await evaluate(`(async () => {
    const rows = [...document.querySelectorAll('tr[data-material]')];
    const row = rows.find((r) => r.textContent.includes('验收申请表'));
    if (!row) return { error: '未找到验收申请表' };
    const id = row.getAttribute('data-material');
    const before = /已逾期|待提交/.test(row.textContent);
    const file = new File(['拖拽上传测试内容'], '拖拽上传测试.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 2500));
    const newRow = document.querySelector('tr[data-material="' + id + '"]');
    return {
      beforePending: before,
      afterText: newRow ? newRow.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : 'missing',
      attachmentCount: newRow ? newRow.querySelector('.attach-count')?.textContent.trim() : null
    };
  })()`);
  console.log('    拖拽上传结果：', JSON.stringify(uploadResult));
  check('验收申请表上传前为待提交', uploadResult.beforePending === true);
  check('拖拽文件后材料状态更新', /已提交|逾期提交/.test(uploadResult.afterText || ''), uploadResult.afterText);
  check('附件数量增加', Number(uploadResult.attachmentCount) > 0, uploadResult.attachmentCount);

  console.log('\n[3] 项目经理数据范围与权限');
  console.log('  登录：', JSON.stringify(await loginAs('zhangwei')));
  await goto('/', 1200);
  const pmDashboard = await evaluate(`({
    sub: document.querySelector('.page-sub')?.textContent.trim(),
    hasTemplateNav: [...document.querySelectorAll('.nav-item')].some((a) => a.textContent.includes('流程模板')),
    hasSystemNav: [...document.querySelectorAll('.nav-item')].some((a) => a.textContent.includes('系统管理')),
    kpi: document.querySelector('.kpi-value')?.textContent.trim()
  })`);
  console.log('    项目经理看板：', JSON.stringify(pmDashboard));
  check('项目经理看板限定本人项目', String(pmDashboard.sub).includes('本人负责的 2 个项目'), pmDashboard.sub);
  check('项目经理看不到流程模板菜单', pmDashboard.hasTemplateNav === false);
  check('项目经理看不到系统管理菜单', pmDashboard.hasSystemNav === false);
  await goto('/templates', 900);
  const forbidden = await evaluate(`document.body.textContent.includes('无权访问该模块')`);
  check('项目经理直接访问模板页被拒绝', forbidden === true);
  await capture('15-pm-forbidden');

  console.log('\n[4] 查看角色只读');
  console.log('  登录：', JSON.stringify(await loginAs('viewer')));
  await goto('/projects/p4', 1200);
  const viewerState = await evaluate(`({
    editButton: Boolean(document.querySelector('[data-edit-project]')) && document.querySelector('[data-edit-project]').offsetParent !== null,
    uploadButtons: document.querySelectorAll('[data-upload]').length,
    pageTitle: document.querySelector('.page-title')?.textContent.trim()
  })`);
  console.log('    查看角色项目详情：', JSON.stringify(viewerState));
  check('查看角色无编辑项目按钮', viewerState.editButton === false);
  check('查看角色无上传按钮', viewerState.uploadButtons === 0);
  await goto('/projects', 900);
  const viewerProjects = await evaluate(`({ create: Boolean(document.querySelector('[data-new]')), rows: document.querySelectorAll('tr[data-id]').length })`);
  check('查看角色无新建项目按钮', viewerProjects.create === false);
  check('查看角色可查看全部项目', viewerProjects.rows === 5, `rows=${viewerProjects.rows}`);

  console.log('\n[5] 1366×768 响应式');
  await loginAs('admin');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await goto('/templates', 1200);
  const narrow = await evaluate(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, sidebar: document.querySelector('.sidebar')?.offsetWidth })`);
  console.log('    1366 模板页：', JSON.stringify(narrow));
  check('1366 宽度无横向滚动', narrow.scrollWidth <= narrow.innerWidth + 1, `${narrow.scrollWidth}/${narrow.innerWidth}`);
  await capture('16-templates-1366');

  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await goto('/', 1000);
  const narrowDash = await evaluate(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
  check('1366 看板无横向滚动', narrowDash.scrollWidth <= narrowDash.innerWidth + 1, `${narrowDash.scrollWidth}/${narrowDash.innerWidth}`);

  console.log('\n[6] 1600×1000 展示大屏');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await goto('/display?key=research2026', 1400);
  const displayState = await evaluate(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, clock: document.querySelector('#display-clock-time')?.textContent, kpis: document.querySelectorAll('.display-kpi').length })`);
  console.log('    1600 大屏：', JSON.stringify(displayState));
  check('大屏 1600 无横向滚动', displayState.scrollWidth <= displayState.innerWidth + 1, `${displayState.scrollWidth}/${displayState.innerWidth}`);
  check('大屏时钟正常走时', /\d{2}:\d{2}:\d{2}/.test(displayState.clock || ''), displayState.clock);
  check('大屏 8 项统计卡齐全', displayState.kpis === 8, `kpis=${displayState.kpis}`);
  await capture('17-display-1600');

  console.log('\n[7] 弹窗与表单');
  await loginAs('admin');
  await goto('/projects', 1000);
  await evaluate(`document.querySelector('[data-new]').click()`);
  await sleep(500);
  const modalState = await evaluate(`({ open: Boolean(document.querySelector('.modal')), fields: document.querySelectorAll('.modal [name]').length, title: document.querySelector('.modal-title')?.textContent })`);
  console.log('    新建项目弹窗：', JSON.stringify(modalState));
  check('新建项目弹窗可打开', modalState.open === true);
  check('新建项目表单字段齐全', modalState.fields >= 14, `fields=${modalState.fields}`);
  await capture('18-project-modal');
  await evaluate(`document.querySelector('.modal-close')?.click()`);

  await goto('/projects/p4', 1000);
  await evaluate(`document.querySelector('[data-tab="funding"]').click()`);
  await sleep(400);
  await evaluate(`document.querySelector('[data-add-funding]').click()`);
  await sleep(500);
  check('经费登记弹窗可打开', await evaluate(`Boolean(document.querySelector('.modal'))`));
  await capture('19-funding-modal');
  await evaluate(`document.querySelector('.modal-close')?.click()`);

  await goto('/quarterly', 1000);
  await evaluate(`document.querySelector('[data-open]').click()`);
  await sleep(800);
  check('季度填报抽屉可打开', await evaluate(`Boolean(document.querySelector('.drawer'))`));
  await capture('20-quarter-editor');
  await evaluate(`document.querySelector('.drawer .modal-close')?.click()`);

  console.log('\n[8] 关闭按钮与项目字段配置');
  await loginAs('admin');
  await goto('/projects', 900);
  await evaluate(`document.querySelector('[data-new]').click()`);
  await sleep(1000);
  const modalOpen = await evaluate(`Boolean(document.querySelector('.modal'))`);
  await evaluate(`document.querySelector('.modal .modal-close').click()`);
  await sleep(350);
  const modalClosed = await evaluate(`!document.querySelector('.modal')`);
  check('新建项目弹窗可打开', modalOpen === true);
  check('点击弹窗右上角 X 可关闭', modalClosed === true);

  await goto('/projects/p4', 900);
  await evaluate(`document.querySelector('[data-upload]').click()`);
  await sleep(900);
  const drawerOpen = await evaluate(`Boolean(document.querySelector('.drawer'))`);
  await evaluate(`document.querySelector('.drawer .modal-close').click()`);
  await sleep(350);
  const drawerClosed = await evaluate(`!document.querySelector('.drawer')`);
  check('材料抽屉可打开', drawerOpen === true);
  check('点击抽屉右上角 X 可关闭', drawerClosed === true);

  await goto('/system', 900);
  await evaluate(`document.querySelector('[data-tab="fields"]').click()`);
  await sleep(1000);
  const fieldCount = await evaluate(`document.querySelectorAll('[data-field-row]').length`);
  check('项目字段配置列表加载', fieldCount >= 18, `rows=${fieldCount}`);
  await capture('21-field-config');

  const fieldResult = await evaluate(`(async () => {
    document.querySelector('[data-add-field]').click();
    await new Promise((r) => setTimeout(r, 450));
    const label = document.querySelector('#field-form [name="label"]');
    const key = document.querySelector('#field-form [name="key"]');
    if (!label || !key) return { error: '缺少字段表单' };
    label.value = '合作方联系人';
    key.value = 'partner_contact';
    label.closest('.modal').querySelector('[data-save]').click();
    await new Promise((r) => setTimeout(r, 400));
    const hasRow = [...document.querySelectorAll('.field-config-label')].some((el) => el.textContent.includes('合作方联系人'));
    const saveEnabled = !document.querySelector('[data-save-fields]').disabled;
    document.querySelector('[data-save-fields]').click();
    await new Promise((r) => setTimeout(r, 1000));
    const savedState = document.querySelector('#field-save-state')?.textContent.trim();
    return { hasRow, saveEnabled, savedState };
  })()`);
  console.log('    字段新增结果：', JSON.stringify(fieldResult));
  check('新增字段出现在配置列表', fieldResult.hasRow === true);
  check('新增字段后保存按钮可用', fieldResult.saveEnabled === true);
  check('字段配置保存成功', String(fieldResult.savedState).includes('已同步'), fieldResult.savedState);

  const optionResult = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('[data-field-row]')].find((item) => item.textContent.includes('代号类型'));
    if (!row) return { error: '未找到代号类型字段' };
    row.querySelector('[data-field-options]').click();
    await new Promise((r) => setTimeout(r, 350));
    const modal = document.querySelector('.modal');
    const input = modal.querySelector('#new-option');
    input.value = '测试代号类型';
    modal.querySelector('#add-option').click();
    await new Promise((r) => setTimeout(r, 250));
    const optionCount = modal.querySelectorAll('[data-option-row]').length;
    modal.querySelector('[data-close]').click();
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('[data-save-fields]').click();
    await new Promise((r) => setTimeout(r, 900));
    const saved = await fetch('/api/project-fields', { headers: { Authorization: 'Bearer ' + localStorage.getItem('rms.token') } }).then((r) => r.json());
    const category = saved.data.fields.find((field) => field.key === 'category');
    return { optionCount, saved: category?.options?.includes('测试代号类型') };
  })()`);
  console.log('    选项内容管理结果：', JSON.stringify(optionResult));
  check('字段选项可新增', optionResult.optionCount >= 5, `options=${optionResult.optionCount}`);
  check('字段选项保存成功', optionResult.saved === true);

  await goto('/projects', 900);
  await evaluate(`document.querySelector('[data-new]').click()`);
  await sleep(1100);
  const customFieldVisible = await evaluate(`Boolean(document.querySelector('#project-form [name="custom_partner_contact"]'))`);
  check('新建项目表单出现自定义字段', customFieldVisible === true);
  await evaluate(`document.querySelector('.modal-body').scrollTop = document.querySelector('.modal-body').scrollHeight`);
  await sleep(300);
  await capture('22-project-modal-custom');

  const createResult = await evaluate(`(async () => {
    const form = document.querySelector('#project-form');
    if (!form) return { error: '缺少项目表单' };
    form.querySelector('[name="name"]').value = '字段配置测试项目';
    form.querySelector('[name="custom_partner_contact"]').value = '李四';
    form.closest('.modal').querySelector('[data-save]').click();
    await new Promise((r) => setTimeout(r, 1800));
    document.querySelector('[data-tab="info"]')?.click();
    await new Promise((r) => setTimeout(r, 500));
    const text = document.querySelector('#page')?.textContent || '';
    return { path: location.pathname, hasCard: text.includes('自定义信息'), hasValue: text.includes('李四') };
  })()`);
  console.log('    自定义字段建项结果：', JSON.stringify(createResult));
  check('使用自定义字段创建项目成功', /^\/projects\/p/.test(createResult.path || ''), createResult.path);
  check('项目详情展示自定义信息卡片', createResult.hasCard === true);
  check('项目详情展示自定义字段值', createResult.hasValue === true);
  await evaluate(`[...document.querySelectorAll('.card')].find((card) => card.textContent.includes('自定义信息'))?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await capture('23-project-custom-info');

  console.log('\n[9] ERP 截图 OCR 识别与回填');
  await goto('/projects', 900);
  await evaluate(`document.querySelector('[data-new]').click()`);
  await sleep(1200);
  const docTree = await send('DOM.getDocument', { depth: -1 });
  const fileNode = await send('DOM.querySelector', { nodeId: docTree.result.root.nodeId, selector: '#ocr-file' });
  const samplePath = path.join(import.meta.dirname, '..', 'tools', 'erp-sample-hd.png');
  if (fileNode.result?.nodeId) {
    await send('DOM.setFileInputFiles', { files: [samplePath], nodeId: fileNode.result.nodeId });
  }
  await sleep(8500);
  const ocrState = await evaluate(`(() => {
    const form = document.querySelector('#project-form');
    if (!form) return { error: 'no form' };
    const val = (key) => { const el = form.querySelector('[name="' + key + '"]'); return el ? el.value : null; };
    const checked = (key) => { const el = form.querySelector('[name="' + key + '"]'); return el ? el.checked : null; };
    return {
      status: document.querySelector('#ocr-status')?.textContent.replace(/\\s+/g, ' ').trim(),
      name: val('name'), erpCode: val('erpCode'), deptId: val('deptId'), managerId: val('managerId'),
      startDate: val('startDate'), endDate: val('endDate'), cost: val('custom_cost_control'),
      fundTotal: val('fundTotal'), category: val('category'), settlement: val('custom_settlement_status'),
      approvalNo: val('custom_approval_no'), engineer: val('custom_chief_engineer'),
      preliminary: checked('custom_preliminary'), filled: form.querySelectorAll('.ocr-filled').length
    };
  })()`);
  console.log('    OCR 回填：', JSON.stringify(ocrState));
  check('OCR 识别状态成功', String(ocrState.status || '').includes('识别完成'), ocrState.status);
  check('OCR 回填项目名称', ocrState.name === '收费场景多源异构设备的数据融合技术研究', ocrState.name);
  check('OCR 回填项目代号', ocrState.erpCode === '研687CWY0042', ocrState.erpCode);
  check('OCR 回填承担部门', ocrState.deptId === 'd6', ocrState.deptId);
  check('OCR 回填项目负责人', ocrState.managerId === 'u7', ocrState.managerId);
  check('OCR 回填计划起止时间', ocrState.startDate === '2026-06-08' && ocrState.endDate === '2027-12-31', `${ocrState.startDate} / ${ocrState.endDate}`);
  check('OCR 回填成本控制额与批复经费', Number(ocrState.cost) === 1200000 && Number(ocrState.fundTotal) === 120, `${ocrState.cost} / ${ocrState.fundTotal}`);
  check('OCR 回填代号类型与结算状态', ocrState.category === '技改类' && ocrState.settlement === '未结算', `${ocrState.category} / ${ocrState.settlement}`);
  check('OCR 回填立项序号与项目总工', ocrState.approvalNo === '2026Y0025' && ocrState.engineer === '欧阳涛');

  const lockState = await evaluate(`(() => {
    const editable = document.querySelector('#ocr-editable');
    const name = document.querySelector('#project-form [name="name"]');
    editable.checked = false;
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    const locked = name.disabled;
    editable.checked = true;
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    const unlocked = !name.disabled;
    return { locked, unlocked };
  })()`);
  check('关闭开关锁定 OCR 字段', lockState.locked === true);
  check('打开开关恢复可编辑', lockState.unlocked === true);
  await sleep(3800);
  await evaluate(`document.querySelector('.modal-body').scrollTop = 0`);
  await sleep(300);
  await capture('24-ocr-recognition');

  const createOcr = await evaluate(`(async () => {
    const form = document.querySelector('#project-form');
    form.closest('.modal').querySelector('[data-save]').click();
    await new Promise((r) => setTimeout(r, 2400));
    document.querySelector('[data-tab="info"]')?.click();
    await new Promise((r) => setTimeout(r, 500));
    const text = document.querySelector('#page')?.textContent || '';
    return {
      path: location.pathname,
      hasName: text.includes('收费场景多源异构设备的数据融合技术研究'),
      hasCost: text.includes('1,200,000'),
      hasCode: text.includes('研687CWY0042')
    };
  })()`);
  check('OCR 字段可直接创建项目', /^\/projects\/p/.test(createOcr.path || ''), createOcr.path);
  check('详情展示 OCR 回填的项目名称', createOcr.hasName === true);
  check('详情展示成本控制额', createOcr.hasCost === true, createOcr.hasCost);
  check('详情展示项目代号', createOcr.hasCode === true);
  await evaluate(`[...document.querySelectorAll('.card')].find((card) => card.textContent.includes('自定义信息'))?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await capture('25-ocr-project-detail');

  console.log('\n[10] 菜单启用/停用');
  await goto('/system', 900);
  await evaluate(`document.querySelector('[data-tab="menus"]').click()`);
  await sleep(800);
  const menuRows = await evaluate(`document.querySelectorAll('[data-menu-row]').length`);
  check('菜单管理列表加载', menuRows >= 14, `rows=${menuRows}`);
  await capture('26-menu-config');
  const menuToggled = await evaluate(`(() => {
    const toggle = document.querySelector('[data-menu-toggle="/quarterly"]');
    if (!toggle) return false;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-save-menus]').click();
    return true;
  })()`);
  check('停用菜单配置已提交', menuToggled === true);
  await sleep(3600);
  const menuResult = await evaluate(`({
    hidden: !(document.querySelector('.sidebar')?.textContent || '').includes('季度执行'),
    path: location.pathname,
    loggedIn: Boolean(localStorage.getItem('rms.token'))
  })`);
  console.log('    菜单停用结果：', JSON.stringify(menuResult));
  check('停用菜单后导航隐藏', menuResult.hidden === true);
  await goto('/quarterly', 900);
  const menuBlocked = await evaluate(`document.body.textContent.includes('该菜单已停用')`);
  check('直接访问停用菜单被拦截', menuBlocked === true);
  await capture('27-menu-disabled');

  console.log('\n[11] 重置演示数据');
  await resetDemo();
  const fieldsReset = await evaluate(`fetch('/api/project-fields', { headers: { Authorization: 'Bearer ' + localStorage.getItem('rms.token') } }).then((r) => r.json()).then((j) => !j.data.fields.some((f) => f.key === 'custom_partner_contact'))`);
  check('重置演示数据同时恢复字段配置', fieldsReset === true);
  const menusReset = await evaluate(`fetch('/api/menus', { headers: { Authorization: 'Bearer ' + localStorage.getItem('rms.token') } }).then((r) => r.json()).then((j) => j.data.items.find((m) => m.key === '/quarterly')?.enabled === true)`);
  check('重置演示数据恢复菜单配置', menusReset === true);
  await goto('/', 1000);
  check('重置后数据恢复正常', await evaluate(`document.querySelector('.kpi-value')?.textContent.includes('5')`));

  console.log('');
  if (errors.length) {
    console.log('控制台错误：');
    [...new Set(errors)].slice(0, 10).forEach((text) => console.log(`  - ${String(text).slice(0, 240)}`));
  } else {
    console.log('控制台错误：无');
  }
  console.log(`\n验证完成：${failures} 项失败${errors.length ? `，${errors.length} 条控制台错误` : ''}`);
  await send('Browser.close').catch(() => null);
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = failures ? 1 : 0;
}

main().catch(async (error) => {
  console.error('验证脚本异常：', error);
  try { chrome.kill(); } catch { /* ignore */ }
  process.exitCode = 1;
});
