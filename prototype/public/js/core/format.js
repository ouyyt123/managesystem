export const CATEGORIES = {
  INITIATION: { name: '立项材料', tone: 'indigo', doc: '附件1—4', icon: 'flag', short: '立项' },
  PROCUREMENT: { name: '采购材料', tone: 'cyan', doc: '5.2-1—5.2-7', icon: 'cart', short: '采购' },
  CHANGE: { name: '变更材料', tone: 'amber', doc: '5.3', icon: 'branch', short: '变更' },
  TESTING: { name: '检测报告', tone: 'violet', doc: '5.4', icon: 'flask', short: '检测' },
  IP: { name: '知识产权', tone: 'rose', doc: '5.5', icon: 'bulb', short: '知识产权' },
  ACCEPTANCE: { name: '验收材料', tone: 'emerald', doc: '附件6—9', icon: 'checkSquare', short: '验收' },
  ARCHIVE: { name: '归档材料', tone: 'slate', doc: '档案管理要求', icon: 'archive', short: '归档' }
};

export const MATERIAL_STATUS = {
  PENDING: { name: '待提交', tone: 'slate' },
  SUBMITTED: { name: '已提交', tone: 'emerald' },
  LATE: { name: '逾期提交', tone: 'amber' },
  WAIVED: { name: '无需提交', tone: 'violet' },
  OVERDUE: { name: '已逾期', tone: 'rose' }
};

export const STAGE_STATUS = {
  NOT_STARTED: { name: '未开始', tone: 'slate' },
  IN_PROGRESS: { name: '进行中', tone: 'indigo' },
  COMPLETED: { name: '已完成', tone: 'emerald' }
};

export const PROJECT_STATUS = {
  PLANNING: { name: '立项准备', tone: 'slate' },
  ACTIVE: { name: '在研', tone: 'indigo' },
  MID_TERM: { name: '中期检查', tone: 'violet' },
  FINAL: { name: '结题验收', tone: 'amber' },
  COMPLETED: { name: '已完成', tone: 'emerald' },
  TERMINATED: { name: '已终止', tone: 'rose' }
};

export const QUARTER_STATUS = {
  PENDING: { name: '未提交', tone: 'slate' },
  OVERDUE: { name: '已逾期', tone: 'rose' },
  SUBMITTED: { name: '已提交', tone: 'emerald' },
  LATE: { name: '逾期提交', tone: 'amber' }
};

export const ROLES = {
  ADMIN: { name: '系统管理员', tone: 'violet' },
  RESEARCH_MANAGER: { name: '科研管理员', tone: 'indigo' },
  PROJECT_MANAGER: { name: '项目经理', tone: 'cyan' },
  VIEWER: { name: '查看/展示', tone: 'slate' }
};

export const ANCHOR_LABEL = {
  STAGE_START: '节点开始',
  STAGE_END: '节点结束',
  PROJECT_START: '项目开始',
  PROJECT_END: '项目结束'
};

export const PROJECT_CATEGORIES = ['技术开发', '应用研究', '成果转化', '基础研究'];
export const PROJECT_LEVELS = ['集团级', '公司级', '部门级'];
export const PROJECT_SOURCES = ['集团科技计划', '公司自筹', '产学研合作'];
export const FUND_SOURCES = ['集团拨款', '公司自筹', '配套资金'];
export const FUND_TYPES = ['设备费', '材料费', '测试化验加工费', '差旅费', '劳务费', '委托业务费', '其他'];
export const FUND_SUBJECTS = ['研发支出-直接投入', '研发支出-人员费用', '研发支出-折旧费用', '研发支出-其他费用'];

export function meta(map, code, fallback = '—') {
  return map[code] || { name: fallback, tone: 'slate' };
}

export function pill(tone, text, dot = true) {
  return `<span class="pill tone-${tone}">${dot ? '<span class="pill-dot"></span>' : ''}${text}</span>`;
}

export function statusPill(kind, code) {
  const map = kind === 'material' ? MATERIAL_STATUS : kind === 'stage' ? STAGE_STATUS : kind === 'quarter' ? QUARTER_STATUS : PROJECT_STATUS;
  const item = meta(map, code);
  return pill(item.tone, item.name);
}

export function categoryPill(code) {
  const cat = CATEGORIES[code] || { name: code || '未分类', tone: 'slate' };
  return `<span class="tag tone-${cat.tone}">${cat.name}</span>`;
}

export function num(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function wan(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const v = Number(value);
  const fixed = Number.isInteger(v) ? 0 : digits;
  return num(v, fixed);
}

export function pct(value) {
  const v = Number(value || 0);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function dateText(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

export function dateTimeText(value) {
  if (!value) return '—';
  const text = String(value);
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text.slice(0, 16).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeText(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return dateTimeText(value).slice(11);
}

export function daysBetween(a, b) {
  const d1 = new Date(`${String(a).slice(0, 10)}T00:00:00Z`).getTime();
  const d2 = new Date(`${String(b).slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((d1 - d2) / 86400000);
}

export function fileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function initials(name) {
  const text = String(name || '').trim();
  if (!text) return '·';
  return text.slice(-2);
}

export function roleTone(role) {
  return (ROLES[role] || {}).tone || 'slate';
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function projectPeriod(project) {
  return `${dateText(project.startDate)} → ${dateText(project.endDate)}`;
}

export function stageToneClass(stage) {
  if (!stage) return '';
  if (stage.status === 'COMPLETED') return 'done';
  if (stage.status === 'IN_PROGRESS') return 'active';
  return '';
}

export function quarterName(year, quarter) {
  return `${year} Q${quarter}`;
}
