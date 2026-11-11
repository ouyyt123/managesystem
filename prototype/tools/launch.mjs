// 自带健康检查的启动器：
// 1) 若服务已在运行，直接打开浏览器，不重复启动；
// 2) 若端口被其他程序占用，给出明确提示；
// 3) 否则拉起 server/index.mjs，等端口就绪后再打开浏览器；
// 4) 支持 --no-open（仅供自动化测试）与 PORT / HOST 环境变量。
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = String(process.env.PORT || 8088);
const HOST = String(process.env.HOST || '127.0.0.1');
const PROBE_HOST = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
const URL_BASE = `http://${PROBE_HOST}:${PORT}`;
const HEALTH = `${URL_BASE}/api/health`;
const OPEN_BROWSER = !process.argv.includes('--no-open');

async function isUp() {
  try {
    const response = await fetch(HEALTH, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.data?.status === 'UP';
  } catch {
    return false;
  }
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: PROBE_HOST, port: Number(PORT) });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

function openBrowser() {
  if (!OPEN_BROWSER) return;
  const command = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', URL_BASE]]
    : process.platform === 'darwin'
      ? ['open', [URL_BASE]]
      : ['xdg-open', [URL_BASE]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
    child.on('error', () => null);
    child.unref();
  } catch {
    // 打不开浏览器不影响服务，用户可手动访问
  }
}

function waitExit(code, message = '') {
  if (message) console.log(message);
  process.exitCode = code;
}

async function main() {
  if (await isUp()) {
    console.log('');
    console.log(`  服务已经在运行：${URL_BASE}`);
    console.log(OPEN_BROWSER ? '  已直接打开浏览器。如需重启，请先运行 stop.cmd。' : '  （测试模式：未打开浏览器）');
    console.log('');
    openBrowser();
    return waitExit(0);
  }

  if (await portInUse()) {
    console.log('');
    console.log(`  [启动失败] 端口 ${PORT} 已被其他程序占用，但该程序不是本原型服务。`);
    console.log('  请先关闭占用程序，或设置其他端口后重试，例如：');
    console.log('    PowerShell:  $env:PORT=8090; node server/index.mjs');
    console.log('');
    return waitExit(1);
  }

  console.log('');
  console.log('  科研项目材料管理系统 · 交互原型');
  console.log(`  启动地址：${URL_BASE}`);
  console.log('  演示账号：admin / keyan / zhangwei / lina / wangqiang / viewer');
  console.log('  统一密码：123456');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });

  let opened = false;
  const poll = setInterval(async () => {
    if (opened) return;
    if (await isUp()) {
      opened = true;
      clearInterval(poll);
      openBrowser();
    }
  }, 400);

  const timeout = setTimeout(() => {
    if (opened) return;
    clearInterval(poll);
    console.log('');
    console.log('  [提示] 服务未在 15 秒内就绪。请检查上方错误信息；');
    console.log(`         端口 ${PORT} 可能被占用，可先运行 stop.cmd 或更换 PORT 后重试。`);
  }, 15000);

  child.on('exit', (code) => {
    clearInterval(poll);
    clearTimeout(timeout);
    // Windows 下被强制结束的进程可能返回 4294967295，视为正常停止
    const normalized = code === null || code < 0 || code >= 0x80000000 ? 0 : code;
    process.exitCode = normalized;
    if (normalized === 0) console.log('\n  服务已停止。');
  });

  child.on('error', (error) => {
    clearInterval(poll);
    clearTimeout(timeout);
    console.error(`  [启动失败] 无法启动 Node 服务：${error.message}`);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try { child.kill(signal); } catch { /* ignore */ }
    });
  }
}

main().catch((error) => {
  console.error('  [启动失败]', error.message);
  process.exitCode = 1;
});
