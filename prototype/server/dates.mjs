// 日期与周期计算规则（与需求文档 6.1 / 6.2 / 6.3 保持一致）
// 全部使用 UTC 零点，避免时区导致的跨天偏差；对外统一输出 YYYY-MM-DD。

export function parseDate(value) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const text = String(value || '').slice(0, 10);
  const [y, m, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function iso(date) {
  return date.toISOString().slice(0, 10);
}

export function today() {
  const now = new Date();
  return iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function todayDate() {
  return parseDate(today());
}

export function addDays(value, days) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

export function addDaysISO(value, days) {
  return iso(addDays(value, days));
}

export function diffDays(a, b) {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);
}

export function quarterOf(value) {
  const date = parseDate(value);
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

export function quarterStart(year, quarter) {
  return new Date(Date.UTC(year, (quarter - 1) * 3, 1));
}

export function quarterEnd(year, quarter) {
  return new Date(Date.UTC(year, quarter * 3, 0));
}

export function quarterLabel(year, quarter) {
  return `${year} Q${quarter}`;
}

/** 项目周期内覆盖的所有自然季度 */
export function quarterRange(startISO, endISO) {
  const start = parseDate(startISO);
  const end = parseDate(endISO);
  const list = [];
  let year = start.getUTCFullYear();
  let quarter = quarterOf(start);
  while (true) {
    const qStart = quarterStart(year, quarter);
    if (qStart.getTime() > end.getTime()) break;
    list.push({ year, quarter, start: iso(qStart), end: iso(quarterEnd(year, quarter)) });
    quarter += 1;
    if (quarter > 4) { quarter = 1; year += 1; }
    if (list.length > 120) break;
  }
  return list;
}

/** 节点计划起止：项目开始 + round(周期 × 比例) + 偏移 */
export function stageDates(project, node) {
  const start = parseDate(project.startDate);
  const end = parseDate(project.endDate);
  const totalDays = Math.max(1, diffDays(project.endDate, project.startDate));
  const startShift = Math.round(totalDays * Number(node.startRatio || 0)) + Number(node.startOffset || 0);
  const endShift = Math.round(totalDays * Number(node.endRatio || 0)) + Number(node.endOffset || 0);
  const stageStart = iso(addDays(start, startShift));
  let stageEnd = iso(addDays(start, endShift));
  if (diffDays(stageEnd, stageStart) < 0) stageEnd = stageStart;
  return { startDate: stageStart, endDate: stageEnd, totalDays };
}

/** 材料截止日期：锚点 + 偏移 */
export function materialDue(project, stage, material) {
  const anchor = material.anchor || inferAnchor(material);
  let base;
  switch (anchor) {
    case 'PROJECT_START': base = project.startDate; break;
    case 'PROJECT_END': base = project.endDate; break;
    case 'STAGE_START': base = stage.startDate; break;
    case 'STAGE_END':
    default: base = stage.endDate; break;
  }
  return addDaysISO(base, material.offsetDays || 0);
}

/** 兼容旧数据的锚点推断：归档类节点默认项目结束 */
export function inferAnchor(material) {
  return material.archiveAnchor === 'PROJECT_END' ? 'PROJECT_END' : 'STAGE_END';
}

export const ANCHORS = [
  { code: 'STAGE_START', label: '节点开始' },
  { code: 'STAGE_END', label: '节点结束' },
  { code: 'PROJECT_START', label: '项目开始' },
  { code: 'PROJECT_END', label: '项目结束' }
];

export const MATERIAL_CATEGORIES = [
  { code: 'INITIATION', name: '立项材料', color: 'indigo', remind: true, doc: '附件1—4', icon: 'flag' },
  { code: 'PROCUREMENT', name: '采购材料', color: 'cyan', remind: false, doc: '5.2-1—5.2-7', icon: 'cart' },
  { code: 'CHANGE', name: '变更材料', color: 'amber', remind: false, doc: '5.3', icon: 'branch' },
  { code: 'TESTING', name: '检测报告', color: 'violet', remind: false, doc: '5.4', icon: 'flask' },
  { code: 'IP', name: '知识产权', color: 'rose', remind: false, doc: '5.5', icon: 'patent' },
  { code: 'ACCEPTANCE', name: '验收材料', color: 'emerald', remind: true, doc: '附件6—9', icon: 'check' },
  { code: 'ARCHIVE', name: '归档材料', color: 'slate', remind: true, doc: '档案管理要求', icon: 'archive' }
];

export const PROJECT_STATUSES = [
  { code: 'PLANNING', name: '立项准备', tone: 'slate' },
  { code: 'ACTIVE', name: '在研', tone: 'indigo' },
  { code: 'MID_TERM', name: '中期检查', tone: 'violet' },
  { code: 'FINAL', name: '结题验收', tone: 'amber' },
  { code: 'COMPLETED', name: '已完成', tone: 'emerald' },
  { code: 'TERMINATED', name: '已终止', tone: 'rose' }
];

export function projectStatusName(code) {
  return (PROJECT_STATUSES.find((s) => s.code === code) || {}).name || code;
}
