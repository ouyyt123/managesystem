// 使用 Chrome DevTools Protocol 对原型页面截图并收集前端错误。
// 用法：node tools/screenshot.mjs [baseUrl] [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8088';
const OUT = path.resolve(process.argv[3] || path.join(import.meta.dirname, '..', 'screenshots'));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,1000',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  'about:blank'
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const events = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    const { result } = await send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && (document.querySelector('#page .page-head') || document.querySelector('.auth') || document.querySelector('.display') || document.querySelector('.key-gate')) ? 'ready' : document.readyState`,
      returnByValue: true
    });
    if (result.value === 'ready') return true;
    await sleep(250);
  }
  return false;
}

async function evaluate(expression, awaitPromise = true) {
  const message = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
  const { result, exceptionDetails } = message.result || {};
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result?.value;
}

async function capture(name, fullPage = false) {
  let params = { format: 'png', fromSurface: true };
  if (fullPage) {
    const metricsMessage = await send('Page.getLayoutMetrics');
    const metrics = metricsMessage.result || {};
    const content = metrics.cssContentSize || metrics.contentSize;
    params = {
      ...params,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: content.width, height: Math.min(content.height, 6000), scale: 1 }
    };
  }
  const message = await send('Page.captureScreenshot', params);
  const data = message.result?.data;
  if (!data) throw new Error(`截图失败：${JSON.stringify(message).slice(0, 300)}`);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ✓ ${name}.png`);
}

function drainErrors(label) {
  const errors = events.splice(0, events.length).filter((item) => item.level === 'error');
  if (errors.length) {
    console.log(`  ! ${label} 控制台错误：`);
    errors.slice(0, 8).forEach((item) => console.log(`      ${item.text}`));
  }
  return errors.length;
}

async function goto(url, name, { fullPage = true, wait = 900 } = {}) {
  await send('Page.navigate', { url: `${BASE}${url}` });
  await sleep(wait);
  const ok = await waitReady();
  await sleep(450);
  await capture(name, fullPage);
  const errors = drainErrors(name);
  return { ok, errors };
}

async function main() {
  await sleep(1200);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
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
      const detail = message.params.exceptionDetails;
      events.push({ level: 'error', text: `异常：${detail.exception?.description || detail.text}` });
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      events.push({ level: 'error', text: `${message.params.entry.text} ${message.params.entry.url || ''}` });
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      events.push({ level: 'error', text: `console.error：${message.params.args.map((a) => a.value ?? a.description).join(' ')}` });
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  console.log('登录页');
  await goto('/login', '01-login', { fullPage: false });
  drainErrors('login');

  const loginResult = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    });
    const payload = await response.json();
    if (!payload.data) return { error: payload.message };
    localStorage.setItem('rms.token', payload.data.token);
    localStorage.setItem('rms.user', JSON.stringify(payload.data.user));
    localStorage.setItem('rms.displayKey', 'research2026');
    return { ok: true, user: payload.data.user.name };
  })()`);
  console.log('  登录接口：', JSON.stringify(loginResult));

  const pages = [
    ['/', '02-dashboard'],
    ['/projects', '03-projects'],
    ['/projects/p2', '04-project-detail'],
    ['/templates', '05-templates'],
    ['/quarterly', '06-quarterly'],
    ['/alerts', '07-alerts'],
    ['/categories/INITIATION', '08-initiation'],
    ['/categories/PROCUREMENT', '09-procurement'],
    ['/system', '10-system']
  ];
  for (const [url, name] of pages) {
    console.log(`页面 ${url}`);
    await goto(url, name);
  }

  // 模板拖拽验证
  console.log('模板拖拽验证');
  await goto('/templates', '11-templates-drag-before', { fullPage: false });
  const dragResult = await evaluate(`(async () => {
    const block = document.querySelector('[data-block]');
    const track = document.querySelector('#tl-track');
    if (!block || !track) return { error: '缺少节点块' };
    const rect = block.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const before = block.style.left;
    const fire = (type, x, y) => {
      const ev = new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      document.dispatchEvent(ev);
    };
    block.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
    fire('pointermove', startX + 90, startY);
    fire('pointerup', startX + 90, startY);
    await new Promise((r) => setTimeout(r, 300));
    const after = document.querySelector('[data-block]').style.left;
    const dirty = document.querySelector('#save-state')?.textContent.trim();
    return { before, after, dirty };
  })()`);
  console.log('  拖拽结果：', JSON.stringify(dragResult));
  await sleep(400);
  await capture('11-templates-drag', false);

  // 材料跨节点拖拽验证
  const materialDrag = await evaluate(`(async () => {
    const cards = [...document.querySelectorAll('[data-material-card]')];
    const columns = [...document.querySelectorAll('[data-node-body]')];
    if (!cards.length || columns.length < 2) return { error: '缺少材料或节点列' };
    const card = cards[0];
    const targetCol = columns[columns.length - 1];
    const beforeNode = card.closest('[data-node-col]')?.getAttribute('data-node-col');
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    targetCol.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    targetCol.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    await new Promise((r) => setTimeout(r, 300));
    const moved = document.querySelector('[data-material-card="' + card.getAttribute('data-material-card') + '"]')?.closest('[data-node-col]')?.getAttribute('data-node-col');
    return { beforeNode, movedTo: moved };
  })()`);
  console.log('  材料拖拽结果：', JSON.stringify(materialDrag));

  // 材料抽屉
  console.log('项目材料抽屉');
  await goto('/projects/p4', '12-project-final', { fullPage: false });
  await evaluate(`document.querySelector('[data-upload]')?.click()`);
  await sleep(900);
  await capture('13-material-drawer', false);

  // 大屏
  console.log('展示大屏');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await goto('/display?key=research2026', '14-display-1920', { fullPage: false, wait: 1200 });

  drainErrors('全部');

  await send('Browser.close').catch(() => null);
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n截图已保存到：${OUT}`);
}

main().catch(async (error) => {
  console.error('截图失败：', error);
  try { chrome.kill(); } catch { /* ignore */ }
  process.exitCode = 1;
});
