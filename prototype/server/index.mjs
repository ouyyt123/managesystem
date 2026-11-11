import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { Store, writeUpload } from './store.mjs';
import { hashPassword, loadSecret, readToken, ROLES, sha256, signToken, uuid, verifyPassword } from './auth.mjs';
import { seedDatabase } from './seed.mjs';
import { defaultProjectFields, FIELD_TYPES, normalizeCustomValues, normalizeProjectFields } from './project-fields.mjs';
import { defaultMenus, normalizeMenus } from './menus.mjs';
import { extractProjectFields, recognizeImage, summarizeOcr } from './ocr.mjs';
import {
  ANCHORS, MATERIAL_CATEGORIES, PROJECT_STATUSES, addDaysISO, iso, materialDue, quarterEnd,
  quarterLabel, stageDates, today
} from './dates.mjs';
import {
  alerts, assert, attachmentCounts, attachmentsOf, buildProjectInstances, categoryLedger,
  dashboard, decorateProject, displayPayload, DONE_STATUSES, effectiveMaterialStatus, projectSpent,
  projectStats, quarterProgress, quarterStatus, quarterSummary, quarterlyRows, recalculateProject,
  stageStatus, visibleProjects, scopeProjectIds
} from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || '127.0.0.1';

const store = new Store(ROOT);
const fresh = store.load();
if (fresh || !store.data) {
  store.data = null;
  seedDatabase(store);
}
if (!Array.isArray(store.data.projectFields) || store.data.projectFields.length === 0) {
  store.data.projectFields = defaultProjectFields();
  store.saveNow();
}
if (!Array.isArray(store.data.menus) || store.data.menus.length === 0) {
  store.data.menus = defaultMenus();
  store.saveNow();
}
try {
  fs.rmSync(path.join(store.dataDir, 'ocr-temp'), { recursive: true, force: true });
} catch { /* ignore */ }
const secret = loadSecret(store.dataDir);
const displayKey = process.env.DISPLAY_KEY || store.data.meta.displayKey || 'research2026';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

function sendJSON(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function ok(res, data) {
  sendJSON(res, 200, { code: 0, message: 'ok', data });
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new HttpError(413, '上传内容过大，单文件请控制在 20MB 以内', 'PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, '请求内容不是合法 JSON', 'BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || '';
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleName: (ROLES[user.role] || {}).name || user.role,
    deptId: user.deptId,
    deptName: (store.data.departments.find((d) => d.id === user.deptId) || {}).name || '—',
    title: user.title,
    email: user.email,
    phone: user.phone,
    enabled: user.enabled,
    lastLoginAt: user.lastLoginAt
  };
}

function currentUser(req, query) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token && query && query.token) token = String(query.token);
  const payload = readToken(token, secret);
  if (!payload) return null;
  const user = store.data.users.find((u) => u.id === payload.uid);
  if (!user || !user.enabled) return null;
  return user;
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, '登录状态已失效，请重新登录', 'UNAUTHORIZED');
  return ctx.user;
}

function requireRole(ctx, roles) {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) throw new HttpError(403, '当前角色无权执行该操作', 'FORBIDDEN');
  return user;
}

function getProject(id) {
  const project = store.data.projects.find((p) => p.id === id && !p.deleted);
  if (!project) throw new HttpError(404, '项目不存在或已删除', 'PROJECT_NOT_FOUND');
  return project;
}

function canWriteProject(user, project) {
  if (user.role === 'ADMIN' || user.role === 'RESEARCH_MANAGER') return true;
  if (user.role === 'PROJECT_MANAGER') return project.managerId === user.id;
  return false;
}

function assertProjectWrite(user, project) {
  if (user.role === 'VIEWER') throw new HttpError(403, '查看角色不可修改数据', 'FORBIDDEN');
  if (!canWriteProject(user, project)) throw new HttpError(403, '只能维护本人负责的项目', 'FORBIDDEN');
}

function logWrite(ctx, module, action, target, detail) {
  store.log({
    userId: ctx.user ? ctx.user.id : null,
    username: ctx.user ? ctx.user.name : '匿名',
    role: ctx.user ? ctx.user.role : 'GUEST',
    module, action, target, detail, ip: ipOf(ctx.req)
  });
}

function validateProjectInput(body, user, existing) {
  const name = String(body.name || '').trim();
  assert(name.length >= 2, 400, '项目名称至少 2 个字符');
  assert(name.length <= 80, 400, '项目名称不能超过 80 个字符');
  const deptId = String(body.deptId || '');
  assert(store.data.departments.some((d) => d.id === deptId), 400, '请选择所属部门');
  let managerId = String(body.managerId || '');
  if (user.role === 'PROJECT_MANAGER') {
    if (existing && existing.managerId === user.id) managerId = user.id;
    else if (!managerId) managerId = user.id;
    assert(managerId === user.id, 403, '项目经理只能把本人设为项目负责人，且不能转交项目');
  }
  assert(store.data.users.some((u) => u.id === managerId), 400, '请选择项目经理');
  const startDate = String(body.startDate || '');
  const endDate = String(body.endDate || '');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(startDate), 400, '开始日期格式不正确');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(endDate), 400, '结束日期格式不正确');
  assert(endDate >= startDate, 400, '结束日期不得早于开始日期');
  const fundTotal = Number(body.fundTotal);
  assert(Number.isFinite(fundTotal) && fundTotal >= 0, 400, '批复经费必须是非负数字');
  const spent = existing ? projectSpent(store.data, existing.id) : 0;
  assert(fundTotal + 1e-9 >= spent, 400, `批复经费不得小于已支出 ${spent} 万元`);
  const progress = Number(body.progress ?? (existing ? existing.progress : 0));
  assert(progress >= 0 && progress <= 100, 400, '进度必须在 0—100 之间');
  const status = String(body.status || 'PLANNING');
  assert(PROJECT_STATUSES.some((s) => s.code === status), 400, '项目状态不合法');
  return {
    name, deptId, managerId, startDate, endDate, fundTotal,
    category: String(body.category || '技术开发').trim().slice(0, 40),
    level: String(body.level || '公司级').trim().slice(0, 20),
    source: String(body.source || '公司自筹').trim().slice(0, 40),
    fundSource: String(body.fundSource || '公司自筹').trim().slice(0, 40),
    status,
    progress: Math.round(progress),
    description: String(body.description || '').slice(0, 2000),
    erpCode: String(body.erpCode || '').slice(0, 60),
    erpPurchaseCode: String(body.erpPurchaseCode || '').slice(0, 60),
    inquiryCode: String(body.inquiryCode || '').slice(0, 60),
    members: Array.isArray(body.members) ? body.members.filter((id) => store.data.users.some((u) => u.id === id)) : (existing ? existing.members : [])
  };
}

function projectPayload(project) {
  const db = store.data;
  const materials = db.materials.filter((m) => m.projectId === project.id);
  const statusMap = new Map(materials.map((m) => [m.id, effectiveMaterialStatus(db, m)]));
  const counts = attachmentCounts(db);
  const stages = db.stages
    .filter((s) => s.projectId === project.id)
    .sort((a, b) => a.seq - b.seq)
    .map((stage) => {
      const list = materials.filter((m) => m.stageId === stage.id);
      const required = list.filter((m) => m.required);
      return {
        ...stage,
        status: stageStatus(db, stage, statusMap),
        materialTotal: list.length,
        requiredTotal: required.length,
        requiredDone: required.filter((m) => DONE_STATUSES.has(statusMap.get(m.id))).length
      };
    });

  const materialViews = materials
    .slice()
    .sort((a, b) => {
      const sa = db.stages.find((s) => s.id === a.stageId);
      const sb = db.stages.find((s) => s.id === b.stageId);
      return (sa ? sa.seq : 0) - (sb ? sb.seq : 0) || a.seq - b.seq;
    })
    .map((material) => {
      const stage = db.stages.find((s) => s.id === material.stageId) || {};
      const status = statusMap.get(material.id) || 'PENDING';
      const days = Math.floor((Date.parse(today()) - Date.parse(material.dueDate)) / 86400000);
      return {
        ...material,
        status,
        stageName: stage.name,
        stageSeq: stage.seq,
        attachmentCount: counts.get(material.id) || 0,
        overdueDays: status === 'PENDING' && days > 0 ? days : 0,
        submitterName: (db.users.find((u) => u.id === material.submitterId) || {}).name || '',
        waivedByName: (db.users.find((u) => u.id === material.waivedBy) || {}).name || ''
      };
    });

  const quarterly = quarterProgress(db, project.id).map((row) => ({
    ...row,
    attachmentCount: counts.get(row.id) || 0,
    submitterName: (db.users.find((u) => u.id === row.submitterId) || {}).name || ''
  }));

  const funding = db.funding
    .filter((f) => f.projectId === project.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((f) => ({
      ...f,
      creatorName: (db.users.find((u) => u.id === f.createdBy) || {}).name || '',
      type: f.type,
      subject: f.subject
    }));

  return {
    project: decorateProject(db, project),
    stages,
    materials: materialViews,
    quarterly,
    funding,
    categories: MATERIAL_CATEGORIES,
    projectFields: db.projectFields.filter((field) => field.enabled).slice().sort((a, b) => a.seq - b.seq),
    logs: db.logs.filter((l) => l.target === project.code).slice(0, 20)
  };
}

async function handleApi(ctx) {
  const { method, pathname, query, req, res } = ctx;

  // ---- 基础 ----
  if (method === 'GET' && pathname === '/api/health') {
    return ok(res, { status: 'UP', today: today(), projects: store.data.projects.filter((p) => !p.deleted).length });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = store.data.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.passwordHash) || !user.enabled) {
      throw new HttpError(401, '账号或密码错误', 'BAD_CREDENTIALS');
    }
    user.lastLoginAt = new Date().toISOString();
    store.log({ userId: user.id, username: user.name, role: user.role, module: '认证', action: '登录', target: user.username, detail: '登录成功', ip: ipOf(req) });
    store.save();
    return ok(res, { token: signToken(user.id, secret), user: publicUser(user) });
  }

  if (pathname === '/api/display') {
    if (method !== 'GET') throw new HttpError(405, '大屏为只读接口');
    const key = String(query.key || req.headers['x-display-key'] || '');
    if (key !== displayKey) throw new HttpError(403, '访问码不正确，无法打开展示大屏', 'BAD_DISPLAY_KEY');
    return ok(res, displayPayload(store.data));
  }

  // 以下接口都需要登录
  const user = ctx.user;
  if (!user) throw new HttpError(401, '登录状态已失效，请重新登录', 'UNAUTHORIZED');

  if (method === 'GET' && pathname === '/api/auth/me') {
    return ok(res, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/auth/password') {
    const body = await readBody(req);
    assert(verifyPassword(String(body.oldPassword || ''), user.passwordHash), 400, '原密码不正确');
    assert(String(body.newPassword || '').length >= 6, 400, '新密码至少 6 位');
    user.passwordHash = hashPassword(String(body.newPassword));
    logWrite(ctx, '认证', '修改密码', user.username, '用户修改本人密码');
    store.save();
    return ok(res, { changed: true });
  }

  if (method === 'GET' && pathname === '/api/options') {
    const db = store.data;
    return ok(res, {
      departments: db.departments.filter((d) => d.enabled !== false),
      users: db.users.filter((u) => u.enabled).map(publicUser),
      managers: db.users.filter((u) => u.enabled && (u.role === 'PROJECT_MANAGER' || u.role === 'RESEARCH_MANAGER') || u.role === 'ADMIN').map(publicUser),
      roles: Object.values(ROLES),
      categories: MATERIAL_CATEGORIES,
      projectStatuses: PROJECT_STATUSES,
      anchors: ANCHORS,
      fundingTypes: ['设备费', '材料费', '测试化验加工费', '差旅费', '劳务费', '委托业务费', '其他'],
      fundingSubjects: ['研发支出-直接投入', '研发支出-人员费用', '研发支出-折旧费用', '研发支出-其他费用'],
      projectFields: db.projectFields.filter((field) => field.enabled).slice().sort((a, b) => a.seq - b.seq),
      menus: db.menus.slice().sort((a, b) => a.seq - b.seq),
      demoAccounts: db.users.filter((u) => u.enabled).map((u) => ({ username: u.username, role: u.role, name: u.name, password: '123456' })),
      displayKey,
      today: today()
    });
  }

  // ---- 项目 ----
  if (method === 'GET' && pathname === '/api/projects') {
    const db = store.data;
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(query.size) || 10));
    const keyword = String(query.keyword || '').trim().toLowerCase();
    let items = visibleProjects(db, user);
    if (keyword) items = items.filter((p) => `${p.code} ${p.name} ${p.erpCode || ''} ${p.inquiryCode || ''}`.toLowerCase().includes(keyword));
    if (query.status) items = items.filter((p) => p.status === query.status);
    if (query.deptId) items = items.filter((p) => p.deptId === query.deptId);
    if (query.category) items = items.filter((p) => p.category === query.category);
    const summary = {
      total: items.length,
      active: items.filter((p) => ['ACTIVE', 'MID_TERM', 'FINAL'].includes(p.status)).length,
      completed: items.filter((p) => p.status === 'COMPLETED').length,
      fundTotal: items.reduce((s, p) => s + Number(p.fundTotal || 0), 0),
      overdue: items.reduce((s, p) => s + projectStats(db, p).requiredOverdue, 0)
    };
    const decorated = items
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((p) => decorateProject(db, p));
    return ok(res, {
      items: decorated.slice((page - 1) * size, page * size),
      total: decorated.length,
      page,
      size,
      summary
    });
  }

  if (pathname === '/api/project-fields' && method === 'GET') {
    const fields = store.data.projectFields.slice().sort((a, b) => a.seq - b.seq);
    return ok(res, { fields, types: FIELD_TYPES });
  }

  if (pathname === '/api/project-fields' && method === 'PUT') {
    requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
    const body = await readBody(req);
    const fields = normalizeProjectFields(body.fields);
    store.data.projectFields = fields;
    logWrite(ctx, '项目字段', '保存配置', `${fields.length} 个字段`, '更新新建科研项目表单的字段配置');
    store.save();
    return ok(res, { fields, updatedAt: new Date().toISOString() });
  }

  if (pathname === '/api/ocr' && method === 'POST') {
    requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER', 'PROJECT_MANAGER']);
    const body = await readBody(req, 24 * 1024 * 1024);
    const filename = String(body.filename || 'erp.png').slice(0, 200);
    const base64 = String(body.dataBase64 || '');
    assert(base64, 400, '请上传 ERP 项目截图');
    const buffer = Buffer.from(base64, 'base64');
    assert(buffer.length > 0, 400, '截图内容为空');
    assert(buffer.length <= 12 * 1024 * 1024, 400, '截图不能超过 12MB，请压缩后重试');
    const ext = (path.extname(filename) || '.png').toLowerCase();
    assert(['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext), 400, '仅支持 PNG、JPG、WebP、BMP 格式的截图');
    const ocrDir = path.join(store.dataDir, 'ocr-temp');
    fs.mkdirSync(ocrDir, { recursive: true });
    const tempFile = path.join(ocrDir, `${uuid()}${ext}`);
    fs.writeFileSync(tempFile, buffer);
    const started = Date.now();
    try {
      const ocr = await recognizeImage(tempFile, ocrDir);
      const extracted = extractProjectFields(ocr, {
        fields: store.data.projectFields,
        departments: store.data.departments,
        users: store.data.users.filter((user) => user.enabled)
      });
      logWrite(ctx, 'OCR', '识别ERP截图', filename, `识别到 ${extracted.matchedCount} 个字段，${extracted.warnings.length} 个待确认`);
      return ok(res, {
        ...extracted,
        ...summarizeOcr(ocr),
        fileName: filename,
        size: buffer.length,
        durationMs: Date.now() - started
      });
    } finally {
      for (const file of [tempFile, `${tempFile}.ocr.json`]) {
        try { fs.unlinkSync(file); } catch { /* ignore */ }
      }
    }
  }

  if (pathname === '/api/menus' && method === 'GET') {
    return ok(res, { items: store.data.menus.slice().sort((a, b) => a.seq - b.seq) });
  }

  if (pathname === '/api/menus' && method === 'PUT') {
    requireRole(ctx, ['ADMIN']);
    const body = await readBody(req);
    const menus = normalizeMenus(body.menus);
    store.data.menus = menus;
    logWrite(ctx, '菜单', '保存配置', `${menus.filter((menu) => menu.enabled).length}/${menus.length} 启用`, '更新左侧菜单启用状态');
    store.save();
    return ok(res, { items: menus, updatedAt: new Date().toISOString() });
  }

  if (method === 'POST' && pathname === '/api/projects') {
    const body = await readBody(req);
    const role = requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER', 'PROJECT_MANAGER']).role;
    const data = validateProjectInput(body, { ...user, role });
    const customFields = normalizeCustomValues(body.customFields, store.data.projectFields, { requireAll: true });
    let code = String(body.code || '').trim();
    if (!code) {
      const year = data.startDate.slice(0, 4);
      const existing = store.data.projects.filter((p) => p.code.startsWith(`KY-${year}-`));
      code = `KY-${year}-${String(existing.length + 1).padStart(3, '0')}`;
    }
    assert(!store.data.projects.some((p) => p.code === code), 409, `项目编号 ${code} 已存在`);
    const project = {
      id: store.nextId('p'),
      code,
      ...data,
      customFields,
      deleted: false,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.data.projects.push(project);
    const created = buildProjectInstances(store, project);
    logWrite(ctx, '项目', '新建', code, `创建项目并生成 ${created.stages.length} 个节点、${created.materials.length} 项材料、${created.quarterly.length} 条季度报表`);
    store.save();
    return ok(res, projectPayload(project));
  }

  if (pathname.startsWith('/api/projects/')) {
    const rest = pathname.slice('/api/projects/'.length);
    const [id, action] = rest.split('/');
    const project = getProject(id);

    if (method === 'GET' && !action) {
      const visible = visibleProjects(store.data, user).some((p) => p.id === project.id);
      if (!visible) throw new HttpError(403, '无权查看该项目', 'FORBIDDEN');
      return ok(res, projectPayload(project));
    }

    if (method === 'PUT' && !action) {
      requireUser(ctx);
      assertProjectWrite(user, project);
      const body = await readBody(req);
      const data = validateProjectInput(body, user, project);
      const customFields = normalizeCustomValues(body.customFields, store.data.projectFields, { requireAll: false });
      const datesChanged = data.startDate !== project.startDate || data.endDate !== project.endDate;
      Object.assign(project, data, {
        updatedAt: new Date().toISOString(),
        customFields: { ...(project.customFields || {}), ...customFields }
      });
      if (datesChanged) recalculateProject(store, project);
      logWrite(ctx, '项目', '修改', project.code, datesChanged ? '修改项目基础信息，并重算未提交材料截止日期' : '修改项目基础信息');
      store.save();
      return ok(res, projectPayload(project));
    }

    if (method === 'DELETE' && !action) {
      requireUser(ctx);
      assertProjectWrite(user, project);
      project.deleted = true;
      project.updatedAt = new Date().toISOString();
      logWrite(ctx, '项目', '删除', project.code, '逻辑删除项目，历史报表与附件保留');
      store.save();
      return ok(res, { deleted: true });
    }

    if (action === 'sync-period' && method === 'POST') {
      assertProjectWrite(user, project);
      recalculateProject(store, project);
      logWrite(ctx, '项目', '同步周期', project.code, '按最新项目起止日期重算节点、材料截止日期并补充季度报表行');
      store.save();
      return ok(res, projectPayload(project));
    }

    if (action === 'funding') {
      if (method === 'POST') {
        assertProjectWrite(user, project);
        const body = await readBody(req);
        const amount = Number(body.amount);
        assert(Number.isFinite(amount) && amount > 0, 400, '金额必须大于 0');
        const date = String(body.date || today());
        assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 400, '发生日期格式不正确');
        assert(date <= today(), 400, '发生日期不得晚于今天');
        const entry = {
          id: store.nextId('f'),
          projectId: project.id,
          date,
          amount: Math.round(amount * 100) / 100,
          type: String(body.type || '设备费'),
          subject: String(body.subject || '研发支出-直接投入'),
          note: String(body.note || '').slice(0, 300),
          createdBy: user.id,
          createdAt: new Date().toISOString()
        };
        store.data.funding.push(entry);
        logWrite(ctx, '经费', '新增', `${project.code} / ${entry.type} ${entry.amount} 万元`, entry.note || '登记经费支出');
        store.save();
        return ok(res, projectPayload(project));
      }
      if (method === 'GET') return ok(res, projectPayload(project).funding);
    }
  }

  if (pathname.startsWith('/api/funding/')) {
    const id = pathname.slice('/api/funding/'.length);
    const entry = store.data.funding.find((f) => f.id === id);
    if (!entry) throw new HttpError(404, '经费记录不存在', 'FUNDING_NOT_FOUND');
    const project = getProject(entry.projectId);
    assertProjectWrite(user, project);
    if (method === 'PUT') {
      const body = await readBody(req);
      const amount = Number(body.amount);
      assert(Number.isFinite(amount) && amount > 0, 400, '金额必须大于 0');
      const date = String(body.date || entry.date);
      assert(date <= today(), 400, '发生日期不得晚于今天');
      Object.assign(entry, {
        date, amount: Math.round(amount * 100) / 100,
        type: String(body.type || entry.type),
        subject: String(body.subject || entry.subject),
        note: String(body.note ?? entry.note).slice(0, 300)
      });
      logWrite(ctx, '经费', '修改', `${project.code} / ${entry.type}`, `金额调整为 ${entry.amount} 万元`);
      store.save();
      return ok(res, projectPayload(project));
    }
    if (method === 'DELETE') {
      store.data.funding = store.data.funding.filter((f) => f.id !== id);
      logWrite(ctx, '经费', '删除', `${project.code} / ${entry.type}`, `删除 ${entry.amount} 万元支出记录`);
      store.save();
      return ok(res, projectPayload(project));
    }
  }

  // ---- 流程模板 ----
  if (pathname === '/api/templates' && method === 'GET') {
    const db = store.data;
    const nodes = db.templates.nodes
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((node) => ({ ...node, materialCount: db.templates.materials.filter((m) => m.nodeId === node.id && m.enabled).length }));
    return ok(res, {
      nodes,
      materials: db.templates.materials.slice().sort((a, b) => a.seq - b.seq),
      categories: MATERIAL_CATEGORIES,
      anchors: ANCHORS,
      sampleProject: db.projects.find((p) => !p.deleted && p.status !== 'COMPLETED') || db.projects[0] || null,
      updatedAt: db.meta.templateUpdatedAt || null
    });
  }

  if (pathname === '/api/templates/preview' && method === 'POST') {
    const body = await readBody(req);
    const project = store.data.projects.find((p) => p.id === body.projectId && !p.deleted) || store.data.projects.find((p) => !p.deleted);
    if (!project) return ok(res, { rows: [] });
    const nodes = Array.isArray(body.nodes) ? body.nodes : store.data.templates.nodes;
    const materials = Array.isArray(body.materials) ? body.materials : store.data.templates.materials;
    const rows = nodes
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((node) => {
        const range = stageDates(project, node);
        return {
          node: { ...node },
          startDate: range.startDate,
          endDate: range.endDate,
          materials: materials
            .filter((m) => (m.nodeId === node.id || m.nodeCode === node.code) && m.enabled !== false)
            .map((m) => ({ ...m, dueDate: materialDue(project, range, m) }))
        };
      });
    return ok(res, { project: { id: project.id, code: project.code, name: project.name, startDate: project.startDate, endDate: project.endDate }, rows });
  }

  if (pathname === '/api/templates' && method === 'PUT') {
    requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
    const body = await readBody(req);
    const db = store.data;
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const materials = Array.isArray(body.materials) ? body.materials : [];
    assert(nodes.length > 0, 400, '流程节点不能为空');
    const seenNodeCodes = new Set();
    const normalizedNodes = nodes.map((node, index) => {
      const code = String(node.code || '').trim().toUpperCase();
      const name = String(node.name || '').trim();
      assert(code, 400, `第 ${index + 1} 个节点缺少编码`);
      assert(!seenNodeCodes.has(code), 400, `节点编码 ${code} 重复`);
      seenNodeCodes.add(code);
      assert(name, 400, '节点名称不能为空');
      const startRatio = Number(node.startRatio);
      const endRatio = Number(node.endRatio);
      assert(startRatio >= 0 && startRatio <= 1 && endRatio >= 0 && endRatio <= 1, 400, `节点「${name}」的周期比例必须在 0%—100% 之间`);
      return {
        id: node.id || store.nextId('n'),
        code,
        name,
        seq: index + 1,
        startRatio: Math.round(startRatio * 1000) / 1000,
        endRatio: Math.round(endRatio * 1000) / 1000,
        startOffset: Number(node.startOffset || 0),
        endOffset: Number(node.endOffset || 0),
        description: String(node.description || '').slice(0, 500),
        enabled: node.enabled !== false
      };
    });
    const nodeIds = new Set(normalizedNodes.map((n) => n.id));
    const seenMaterialCodes = new Set();
    const normalizedMaterials = materials.map((material, index) => {
      const code = String(material.code || '').trim().toUpperCase();
      assert(code, 400, `第 ${index + 1} 项材料缺少编码`);
      assert(!seenMaterialCodes.has(code), 400, `材料编码 ${code} 重复`);
      seenMaterialCodes.add(code);
      const name = String(material.name || '').trim();
      assert(name, 400, '材料名称不能为空');
      const nodeId = String(material.nodeId || '');
      assert(nodeIds.has(nodeId), 400, `材料「${name}」未归属有效节点`);
      const category = String(material.category || 'INITIATION');
      assert(MATERIAL_CATEGORIES.some((c) => c.code === category), 400, `材料「${name}」的业务分类不合法`);
      const anchor = String(material.anchor || 'STAGE_END');
      assert(ANCHORS.some((a) => a.code === anchor), 400, `材料「${name}」的截止锚点不合法`);
      return {
        id: material.id || store.nextId('t'),
        code,
        name,
        nodeId,
        category,
        required: !!material.required,
        anchor,
        offsetDays: Number(material.offsetDays || 0),
        allowLate: material.allowLate !== false,
        note: String(material.note || '').slice(0, 500),
        seq: index + 1,
        enabled: material.enabled !== false
      };
    });
    db.templates.nodes = normalizedNodes;
    db.templates.materials = normalizedMaterials;
    db.meta.templateUpdatedAt = new Date().toISOString();
    logWrite(ctx, '流程模板', '保存', `${normalizedNodes.length} 个节点 / ${normalizedMaterials.length} 项材料`, '保存流程与材料模板，新项目按最新模板生成，历史项目保持快照');
    store.save();
    return ok(res, { nodes: normalizedNodes.length, materials: normalizedMaterials.length, updatedAt: db.meta.templateUpdatedAt });
  }

  // ---- 材料 ----
  if (pathname.startsWith('/api/materials/')) {
    const rest = pathname.slice('/api/materials/'.length);
    const [id, action] = rest.split('/');
    const material = store.data.materials.find((m) => m.id === id);
    if (!material) throw new HttpError(404, '材料不存在', 'MATERIAL_NOT_FOUND');
    const project = getProject(material.projectId);
    if (!visibleProjects(store.data, user).some((p) => p.id === project.id)) {
      throw new HttpError(403, '无权访问他人项目的材料', 'FORBIDDEN');
    }

    if (action === 'attachments' && method === 'POST') {
      assertProjectWrite(user, project);
      if (!material.allowLate && material.dueDate < today() && effectiveMaterialStatus(store.data, material) === 'PENDING') {
        throw new HttpError(400, '该材料不允许逾期补传，请联系科研管理员', 'LATE_NOT_ALLOWED');
      }
      const body = await readBody(req);
      const filename = String(body.filename || '附件').slice(0, 200);
      const base64 = String(body.dataBase64 || '');
      assert(base64, 400, '请选择要上传的文件');
      const buffer = Buffer.from(base64, 'base64');
      assert(buffer.length > 0, 400, '文件内容为空');
      assert(buffer.length <= 20 * 1024 * 1024, 400, '单个附件不能超过 20MB');
      const ext = (path.extname(filename) || '').toLowerCase() || '.bin';
      const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt', '.md', '.zip', '.rar', '.7z', '.csv'];
      assert(allowed.includes(ext) || ext === '.bin', 400, `不支持的文件类型 ${ext}`);
      const now = new Date();
      const relativeDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const storedName = `${uuid()}${ext}`;
      const target = writeUpload(store, relativeDir, storedName);
      fs.writeFileSync(target.absolute, buffer);

      const uploadDay = iso(now);
      const wasPending = effectiveMaterialStatus(store.data, material) === 'PENDING';
      if (wasPending || !material.firstSubmitAt) {
        material.firstSubmitAt = now.toISOString();
        material.submitterId = user.id;
      }
      material.status = uploadDay > material.dueDate ? 'LATE' : 'SUBMITTED';
      material.waiveReason = null;
      material.waivedBy = null;
      if (body.note) material.lateNote = String(body.note).slice(0, 500);

      const attachment = {
        id: store.nextId('a'),
        materialId: material.id,
        quarterlyId: null,
        filename,
        storedName,
        relativePath: target.relative,
        size: buffer.length,
        mime: String(body.mime || MIME[ext] || 'application/octet-stream'),
        sha256: sha256(buffer),
        uploaderId: user.id,
        uploadedAt: now.toISOString(),
        deleted: false
      };
      store.data.attachments.push(attachment);
      logWrite(ctx, '材料', uploadDay > material.dueDate ? '逾期补传' : '上传', `${project.code} / ${material.name}`,
        `${filename}（${(buffer.length / 1024).toFixed(1)} KB）${body.note ? `；补传说明：${body.note}` : ''}`);
      store.save();
      return ok(res, { material: materialView(material, project), attachment });
    }

    if (action === 'waive' && method === 'POST') {
      requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
      const body = await readBody(req);
      const reason = String(body.reason || '').trim();
      assert(reason.length >= 2, 400, '标记无需提交必须填写原因');
      material.status = 'WAIVED';
      material.waiveReason = reason.slice(0, 500);
      material.waivedBy = user.id;
      material.waivedAt = new Date().toISOString();
      logWrite(ctx, '材料', '标记无需提交', `${project.code} / ${material.name}`, reason);
      store.save();
      return ok(res, projectPayload(project));
    }

    if (action === 'reset' && method === 'POST') {
      requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
      material.status = 'PENDING';
      material.waiveReason = null;
      material.waivedBy = null;
      material.firstSubmitAt = null;
      material.submitterId = null;
      logWrite(ctx, '材料', '重置为待提交', `${project.code} / ${material.name}`, '科研管理员重置材料状态');
      store.save();
      return ok(res, projectPayload(project));
    }

    if (action === 'note' && method === 'POST') {
      assertProjectWrite(user, project);
      const body = await readBody(req);
      material.lateNote = String(body.note || '').slice(0, 500);
      logWrite(ctx, '材料', '补传说明', `${project.code} / ${material.name}`, material.lateNote);
      store.save();
      return ok(res, projectPayload(project));
    }

    if (action === 'attachments' && method === 'GET') {
      return ok(res, attachmentsOf(store.data, { materialId: material.id }).map((f) => ({
        ...f,
        uploaderName: (store.data.users.find((u) => u.id === f.uploaderId) || {}).name || ''
      })));
    }
  }

  // ---- 附件 ----
  if (pathname.startsWith('/api/attachments/')) {
    const rest = pathname.slice('/api/attachments/'.length);
    const [id, action] = rest.split('/');
    const attachment = store.data.attachments.find((f) => f.id === id && !f.deleted);
    if (!attachment) throw new HttpError(404, '附件不存在或已删除', 'ATTACHMENT_NOT_FOUND');
    const ownerProject = attachment.materialId
      ? (() => {
        const material = store.data.materials.find((m) => m.id === attachment.materialId);
        return material ? store.data.projects.find((p) => p.id === material.projectId) : null;
      })()
      : (() => {
        const row = store.data.quarterly.find((q) => q.id === attachment.quarterlyId);
        return row ? store.data.projects.find((p) => p.id === row.projectId) : null;
      })();
    if (ownerProject && !visibleProjects(store.data, user).some((p) => p.id === ownerProject.id)) {
      throw new HttpError(403, '无权访问该附件', 'FORBIDDEN');
    }

    if (action === 'download' && method === 'GET') {
      const absolute = path.join(store.uploadDir, attachment.relativePath);
      if (!absolute.startsWith(store.uploadDir) || !fs.existsSync(absolute)) {
        throw new HttpError(404, '附件文件已丢失', 'FILE_MISSING');
      }
      const inline = query.inline === '1';
      res.writeHead(200, {
        'Content-Type': attachment.mime || 'application/octet-stream',
        'Content-Length': attachment.size,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        'Cache-Control': 'private, max-age=60'
      });
      fs.createReadStream(absolute).pipe(res);
      return true;
    }

    if (method === 'DELETE') {
      const project = ownerProject;
      if (project) assertProjectWrite(user, project);
      attachment.deleted = true;
      const material = attachment.materialId ? store.data.materials.find((m) => m.id === attachment.materialId) : null;
      let remaining = 0;
      let resetTo = null;
      if (material) {
        remaining = store.data.attachments.filter((f) => !f.deleted && f.materialId === material.id).length;
        if (remaining === 0 && material.status !== 'WAIVED') {
          material.status = 'PENDING';
          material.firstSubmitAt = null;
          material.submitterId = null;
          resetTo = 'PENDING';
        }
      }
      const quarterly = attachment.quarterlyId ? store.data.quarterly.find((q) => q.id === attachment.quarterlyId) : null;
      if (quarterly) {
        remaining = store.data.attachments.filter((f) => !f.deleted && f.quarterlyId === quarterly.id).length;
      }
      logWrite(ctx, '附件', '删除', attachment.filename, `${material ? material.name : '季度报表'} 剩余附件 ${remaining} 个${resetTo ? '，材料恢复为待提交' : ''}`);
      store.save();
      return ok(res, { deleted: true, remaining, resetTo, project: project ? projectPayload(project) : null });
    }
  }

  // ---- 季度报表 ----
  if (pathname === '/api/quarterly' && method === 'GET') {
    const rows = quarterlyRows(store.data, user, query);
    return ok(res, { items: rows, summary: quarterSummary(rows), years: [...new Set(store.data.quarterly.map((q) => q.year))].sort((a, b) => b - a) });
  }

  if (pathname.startsWith('/api/quarterly/')) {
    const rest = pathname.slice('/api/quarterly/'.length);
    const [id, action] = rest.split('/');
    const row = store.data.quarterly.find((q) => q.id === id);
    if (!row) throw new HttpError(404, '季度报表不存在', 'QUARTERLY_NOT_FOUND');
    const project = getProject(row.projectId);
    const view = () => {
      const counts = attachmentCounts(store.data);
      return {
        ...row,
        projectCode: project.code,
        projectName: project.name,
        deptName: (store.data.departments.find((d) => d.id === project.deptId) || {}).name || '—',
        managerName: (store.data.users.find((u) => u.id === project.managerId) || {}).name || '',
        displayStatus: quarterStatus(row),
        submitterName: (store.data.users.find((u) => u.id === row.submitterId) || {}).name || '',
        attachmentCount: counts.get(row.id) || 0,
        attachments: attachmentsOf(store.data, { quarterlyId: row.id }).map((f) => ({
          ...f, uploaderName: (store.data.users.find((u) => u.id === f.uploaderId) || {}).name || ''
        }))
      };
    };

    if (method === 'GET' && !action) return ok(res, view());

    if (method === 'PUT' && !action) {
      assertProjectWrite(user, project);
      const body = await readBody(req);
      const action2 = String(body.action || 'draft');
      if (body.exec !== undefined) row.exec = String(body.exec).slice(0, 4000);
      if (body.achievement !== undefined) row.achievement = String(body.achievement).slice(0, 4000);
      if (body.issue !== undefined) row.issue = String(body.issue).slice(0, 4000);
      if (body.nextPlan !== undefined) row.nextPlan = String(body.nextPlan).slice(0, 4000);
      if (body.spend !== undefined) row.spend = Number(body.spend) || 0;
      if (body.cumSpend !== undefined) row.cumSpend = Number(body.cumSpend) || 0;
      if (action2 === 'submit') {
        assert(row.exec.trim().length >= 5, 400, '提交前请填写本期执行情况');
        row.status = 'SUBMITTED';
        row.submitAt = new Date().toISOString();
        row.submitterId = user.id;
        logWrite(ctx, '季度报表', '提交', `${project.code} / ${quarterLabel(row.year, row.quarter)}`, row.dueDate < today() ? '逾期提交季度执行情况表' : '按时提交季度执行情况表');
      } else {
        row.updatedAt = new Date().toISOString();
        logWrite(ctx, '季度报表', '保存草稿', `${project.code} / ${quarterLabel(row.year, row.quarter)}`, '保存季度执行情况草稿');
      }
      store.save();
      return ok(res, view());
    }

    if (action === 'withdraw' && method === 'POST') {
      requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
      assert(row.status === 'SUBMITTED', 400, '仅已提交的报表可以撤回');
      row.status = 'PENDING';
      row.submitAt = null;
      row.submitterId = null;
      logWrite(ctx, '季度报表', '撤回', `${project.code} / ${quarterLabel(row.year, row.quarter)}`, '科研管理员撤回已提交报表');
      store.save();
      return ok(res, view());
    }

    if (action === 'attachments' && method === 'POST') {
      assertProjectWrite(user, project);
      const body = await readBody(req);
      const filename = String(body.filename || '附件').slice(0, 200);
      const buffer = Buffer.from(String(body.dataBase64 || ''), 'base64');
      assert(buffer.length > 0, 400, '文件内容为空');
      assert(buffer.length <= 20 * 1024 * 1024, 400, '单个附件不能超过 20MB');
      const ext = (path.extname(filename) || '.bin').toLowerCase();
      const now = new Date();
      const target = writeUpload(store, `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`, `${uuid()}${ext}`);
      fs.writeFileSync(target.absolute, buffer);
      store.data.attachments.push({
        id: store.nextId('a'),
        materialId: null,
        quarterlyId: row.id,
        filename,
        storedName: path.basename(target.absolute),
        relativePath: target.relative,
        size: buffer.length,
        mime: String(body.mime || MIME[ext] || 'application/octet-stream'),
        sha256: sha256(buffer),
        uploaderId: user.id,
        uploadedAt: now.toISOString(),
        deleted: false
      });
      logWrite(ctx, '季度报表', '上传附件', `${project.code} / ${quarterLabel(row.year, row.quarter)}`, filename);
      store.save();
      return ok(res, view());
    }
  }

  // ---- 提醒 ----
  if (pathname === '/api/alerts' && method === 'GET') {
    const data = alerts(store.data, user);
    let items = data.items;
    if (query.type) items = items.filter((i) => i.type === query.type);
    if (query.status) items = items.filter((i) => i.status === query.status);
    if (query.keyword) {
      const k = String(query.keyword).toLowerCase();
      items = items.filter((i) => `${i.projectCode} ${i.projectName} ${i.title}`.toLowerCase().includes(k));
    }
    return ok(res, { summary: data.summary, items, total: items.length });
  }

  // ---- 看板 ----
  if (pathname === '/api/dashboard' && method === 'GET') {
    return ok(res, dashboard(store.data, user));
  }

  // ---- 分类台账 ----
  if (pathname === '/api/categories' && method === 'GET') {
    const payload = MATERIACATEGORY_SUMMARY();
    return ok(res, payload);
  }
  if (pathname.startsWith('/api/categories/') && method === 'GET') {
    const code = pathname.slice('/api/categories/'.length);
    assert(MATERIAL_CATEGORIES.some((c) => c.code === code), 404, '材料分类不存在');
    let data = categoryLedger(store.data, code, user);
    if (query.keyword) {
      const k = String(query.keyword).toLowerCase();
      data = { ...data, rows: data.rows.filter((r) => `${r.code} ${r.name} ${r.erpCode}`.toLowerCase().includes(k)) };
    }
    if (query.deptId) data = { ...data, rows: data.rows.filter((r) => r.deptName === (store.data.departments.find((d) => d.id === query.deptId) || {}).name) };
    if (query.status) data = { ...data, rows: data.rows.filter((r) => r.status === query.status) };
    if (query.unfinished === '1') data = { ...data, rows: data.rows.filter((r) => r.overdue > 0 || r.done < r.total) };
    return ok(res, data);
  }

  // ---- 系统管理 ----
  if (pathname === '/api/users' && method === 'GET') {
    requireRole(ctx, ['ADMIN']);
    const items = store.data.users.map(publicUser);
    return ok(res, { items });
  }

  if (pathname === '/api/users' && method === 'POST') {
    requireRole(ctx, ['ADMIN']);
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    assert(/^[a-zA-Z0-9_]{3,20}$/.test(username), 400, '账号需为 3—20 位字母、数字或下划线');
    assert(!store.data.users.some((u) => u.username === username), 409, '账号已存在');
    assert(String(body.name || '').trim(), 400, '请填写姓名');
    assert(ROLES[body.role], 400, '角色不合法');
    const user = {
      id: store.nextId('u'),
      username,
      name: String(body.name).trim(),
      role: body.role,
      deptId: String(body.deptId || 'd1'),
      title: String(body.title || ''),
      phone: String(body.phone || ''),
      email: String(body.email || ''),
      enabled: body.enabled !== false,
      passwordHash: hashPassword(String(body.password || '123456')),
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    store.data.users.push(user);
    logWrite(ctx, '用户', '新增', username, `新增 ${ROLES[user.role].name}：${user.name}`);
    store.save();
    return ok(res, publicUser(user));
  }

  if (pathname.startsWith('/api/users/')) {
    const rest = pathname.slice('/api/users/'.length);
    const [id, action] = rest.split('/');
    const target = store.data.users.find((u) => u.id === id);
    if (!target) throw new HttpError(404, '用户不存在', 'USER_NOT_FOUND');
    requireRole(ctx, ['ADMIN']);
    if (method === 'PUT' && !action) {
      const body = await readBody(req);
      if (body.name !== undefined) target.name = String(body.name).slice(0, 40);
      if (body.role !== undefined) { assert(ROLES[body.role], 400, '角色不合法'); target.role = body.role; }
      if (body.deptId !== undefined) target.deptId = String(body.deptId);
      if (body.title !== undefined) target.title = String(body.title).slice(0, 60);
      if (body.phone !== undefined) target.phone = String(body.phone).slice(0, 30);
      if (body.email !== undefined) target.email = String(body.email).slice(0, 60);
      if (body.enabled !== undefined) {
        if (target.id === user.id && body.enabled === false) throw new HttpError(400, '不能停用当前登录账号');
        target.enabled = !!body.enabled;
      }
      logWrite(ctx, '用户', '修改', target.username, `更新用户信息：${target.name}`);
      store.save();
      return ok(res, publicUser(target));
    }
    if (action === 'reset-password' && method === 'POST') {
      const body = await readBody(req);
      const password = String(body.password || '123456');
      assert(password.length >= 6, 400, '密码至少 6 位');
      target.passwordHash = hashPassword(password);
      logWrite(ctx, '用户', '重置密码', target.username, '管理员重置密码');
      store.save();
      return ok(res, { reset: true });
    }
  }

  if (pathname === '/api/departments' && method === 'GET') {
    requireUser(ctx);
    return ok(res, { items: store.data.departments });
  }

  if (pathname === '/api/departments' && method === 'POST') {
    requireRole(ctx, ['ADMIN']);
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    assert(name, 400, '请填写部门名称');
    const dept = { id: store.nextId('d'), name, code: String(body.code || '').toUpperCase(), leader: String(body.leader || ''), enabled: true };
    store.data.departments.push(dept);
    logWrite(ctx, '部门', '新增', name, '新增部门');
    store.save();
    return ok(res, dept);
  }

  if (pathname.startsWith('/api/departments/') && method === 'PUT') {
    requireRole(ctx, ['ADMIN']);
    const id = pathname.slice('/api/departments/'.length);
    const dept = store.data.departments.find((d) => d.id === id);
    if (!dept) throw new HttpError(404, '部门不存在', 'DEPT_NOT_FOUND');
    const body = await readBody(req);
    dept.name = String(body.name || dept.name).trim();
    dept.code = String(body.code || dept.code || '').toUpperCase();
    dept.leader = String(body.leader || dept.leader || '');
    logWrite(ctx, '部门', '修改', dept.name, '修改部门信息');
    store.save();
    return ok(res, dept);
  }

  if (pathname === '/api/logs' && method === 'GET') {
    requireRole(ctx, ['ADMIN', 'RESEARCH_MANAGER']);
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(query.size) || 20));
    let items = store.data.logs;
    if (query.module) items = items.filter((l) => l.module === query.module);
    if (query.keyword) {
      const k = String(query.keyword).toLowerCase();
      items = items.filter((l) => `${l.username} ${l.target} ${l.detail} ${l.action}`.toLowerCase().includes(k));
    }
    return ok(res, {
      items: items.slice((page - 1) * size, page * size),
      total: items.length,
      page,
      size,
      modules: [...new Set(store.data.logs.map((l) => l.module))]
    });
  }

  if (pathname === '/api/system/reset-demo' && method === 'POST') {
    requireRole(ctx, ['ADMIN']);
    seedDatabase(store);
    return ok(res, { reset: true });
  }

  throw new HttpError(404, `接口不存在：${method} ${pathname}`, 'NOT_FOUND');
}

function materialView(material, project) {
  const db = store.data;
  const stage = db.stages.find((s) => s.id === material.stageId) || {};
  const attachments = attachmentsOf(db, { materialId: material.id });
  return {
    ...material,
    stageName: stage.name,
    attachmentCount: attachments.length,
    status: effectiveMaterialStatus(db, material),
    submitterName: (db.users.find((u) => u.id === material.submitterId) || {}).name || '',
    attachments
  };
}

function MATERIACATEGORY_SUMMARY() {
  return MATERIAL_CATEGORIES.map((category) => {
    let total = 0;
    let done = 0;
    let overdue = 0;
    for (const material of store.data.materials) {
      if (material.category !== category.code) continue;
      total += 1;
      const status = effectiveMaterialStatus(store.data, material);
      if (DONE_STATUSES.has(status)) done += 1;
      if (status === 'PENDING' && material.required && material.dueDate < today()) overdue += 1;
    }
    return { ...category, total, done, overdue, rate: total ? Math.round((done / total) * 100) : 0 };
  });
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (path.extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-store' : 'no-cache'
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const ctx = {
    req, res, method: req.method,
    pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    user: null
  };
  try {
    if (pathname.startsWith('/api/')) {
      ctx.user = currentUser(req, ctx.query);
      await handleApi(ctx);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJSON(res, 405, { code: 405, message: 'Method Not Allowed', data: null });
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    if (res.headersSent) return;
    const status = error.status || 500;
    if (status >= 500) console.error(`[api] ${req.method} ${pathname}`, error);
    sendJSON(res, status, {
      code: status,
      message: error.message || '服务器内部错误',
      data: null
    });
  } finally {
    if (process.env.DEBUG_HTTP) console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  [启动失败] 端口 ${PORT} 已被占用。`);
    console.error('  如果是之前启动的原型服务，请先运行 stop.cmd；');
    console.error('  如果是其他程序占用，请设置不同的 PORT 后重试，例如：');
    console.error('    PowerShell:  $env:PORT=8090; node server/index.mjs');
    console.error('');
  } else {
    console.error('  [启动失败]', error.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  科研项目材料管理系统 · 交互原型');
  console.log(`  → 本机访问：http://${HOST}:${PORT}`);
  console.log(`  → 展示大屏：http://${HOST}:${PORT}/display?key=${displayKey}`);
  console.log(`  → 演示账号：admin / keyan / zhangwei / lina / wangqiang / viewer，密码 123456`);
  console.log('  → 按 Ctrl+C 停止服务');
  console.log('');
});

process.on('SIGINT', () => {
  store.saveNow();
  console.log('\n  已保存数据，服务停止。');
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.saveNow();
  process.exit(0);
});
process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error);
});
