import { assert } from './services.mjs';

export const DEFAULT_MENUS = [
  { key: '/', label: '运行总览', group: '概览', enabled: true, locked: true },
  { key: '/projects', label: '项目台账', group: '项目', enabled: true, locked: true },
  { key: '/categories/INITIATION', label: '立项管理', group: '项目', enabled: true },
  { key: '/quarterly', label: '季度执行', group: '过程执行', enabled: true },
  { key: '/categories/PROCUREMENT', label: '采购管理', group: '过程执行', enabled: true },
  { key: '/categories/CHANGE', label: '变更管理', group: '过程执行', enabled: true },
  { key: '/categories/TESTING', label: '检测报告', group: '过程执行', enabled: true },
  { key: '/categories/IP', label: '知识产权', group: '过程执行', enabled: true },
  { key: '/categories/ACCEPTANCE', label: '验收管理', group: '验收归档', enabled: true },
  { key: '/categories/ARCHIVE', label: '成果归档', group: '验收归档', enabled: true },
  { key: '/alerts', label: '逾期提醒', group: '协同', enabled: true },
  { key: '/templates', label: '流程模板', group: '配置', enabled: true },
  { key: '/system', label: '系统管理', group: '配置', enabled: true, locked: true },
  { key: '/display', label: '展示大屏', group: '展示', enabled: true }
];

export function defaultMenus() {
  return DEFAULT_MENUS.map((menu, index) => ({ ...menu, seq: index + 1 }));
}

export function normalizeMenus(input) {
  assert(Array.isArray(input), 400, '菜单配置格式不正确');
  const byKey = new Map(input.map((item) => [String(item.key || ''), item]));
  const missing = DEFAULT_MENUS.filter((menu) => !byKey.has(menu.key));
  assert(missing.length === 0, 400, `菜单配置缺少：${missing.map((item) => item.label).join('、')}`);
  return DEFAULT_MENUS.map((defaults, index) => {
    const current = byKey.get(defaults.key);
    return {
      ...defaults,
      label: String(current.label || defaults.label).slice(0, 20),
      enabled: defaults.locked ? true : current.enabled !== false,
      seq: index + 1
    };
  });
}

export function menuMap(menus) {
  const map = new Map();
  for (const menu of menus || []) map.set(menu.key, menu);
  return map;
}
