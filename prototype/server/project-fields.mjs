import { assert } from './services.mjs';

export const FIELD_TYPES = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  date: '日期',
  select: '下拉选择',
  checkbox: '是/否勾选',
  department: '部门选择',
  manager: '人员选择',
  status: '项目状态'
};

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

export const FIELD_GROUPS = {
  erp: 'ERP 基本信息',
  system: '系统信息'
};

/** 这些字段承担业务计算或权限判断，必须保留，不能停用 */
const LOCKED_KEYS = new Set(['name', 'deptId', 'managerId', 'startDate', 'endDate', 'status', 'fundTotal']);

function definition(seq, key, label, type, extras = {}) {
  const builtin = extras.builtin !== false;
  return {
    id: extras.id || `pf-${key}`,
    key,
    label,
    type,
    required: extras.required ?? false,
    enabled: extras.enabled !== false,
    builtin,
    locked: extras.locked ?? (builtin && LOCKED_KEYS.has(key)),
    full: extras.full ?? false,
    group: extras.group || 'erp',
    placeholder: extras.placeholder || '',
    hint: extras.hint || '',
    options: extras.options ? [...extras.options] : [],
    ocrKeywords: extras.ocrKeywords ? [...extras.ocrKeywords] : [],
    seq
  };
}

export function defaultProjectFields() {
  return [
    // ---- ERP 基本信息（对齐 ERP 项目基本信息的字段与顺序）----
    definition(1, 'name', '项目名称', 'text', {
      required: true, locked: true, full: true, placeholder: '请输入项目名称',
      ocrKeywords: ['项目名称', '顶目名称']
    }),
    definition(2, 'custom_short_name', '项目简称', 'text', {
      builtin: false, placeholder: '选填',
      ocrKeywords: ['项目简称']
    }),
    definition(3, 'erpCode', '项目代号', 'text', {
      placeholder: '如 研687CMY0042', hint: '来自 ERP 的项目代号',
      ocrKeywords: ['项目代号', '项目编号', '立项编号']
    }),
    definition(4, 'deptId', '承担部门', 'department', {
      required: true, locked: true,
      ocrKeywords: ['承担部门', '承担门', '所属部门']
    }),
    definition(5, 'managerId', '项目负责人', 'manager', {
      required: true, locked: true,
      ocrKeywords: ['项目负责人', '项目负人', '项目经理']
    }),
    definition(6, 'startDate', '计划开始时间', 'date', {
      required: true, locked: true,
      ocrKeywords: ['计划开始时间', '计划开始', '开始时间']
    }),
    definition(7, 'endDate', '计划完成时间', 'date', {
      required: true, locked: true,
      ocrKeywords: ['计划完成时间', '计划完成', '完成时间']
    }),
    definition(8, 'custom_contract_amount', '合同运行额（元）', 'number', {
      builtin: false, placeholder: '如 0.00',
      ocrKeywords: ['合同运行额', '合同运行']
    }),
    definition(9, 'custom_cost_control', '成本控制额（元）', 'number', {
      builtin: false, placeholder: '如 1200000.00',
      hint: '填写后按 元 ÷ 10000 自动换算批复经费（万元）',
      ocrKeywords: ['成本控制额', '控制额']
    }),
    definition(10, 'custom_tax_type', '税款类别', 'select', {
      builtin: false, options: ['增值税', '企业所得税', '个人所得税', '免税', '其他'],
      ocrKeywords: ['税款类别']
    }),
    definition(11, 'category', '代号类型', 'select', {
      options: ['技改类', '研发类', '信息化类', '其他'],
      ocrKeywords: ['代号类型', '代码类型']
    }),
    definition(12, 'custom_planned_profit', '计划利润（元）', 'number', {
      builtin: false, placeholder: '如 -1200000.00',
      ocrKeywords: ['计划利润']
    }),
    definition(13, 'custom_preliminary', '预立项', 'checkbox', {
      builtin: false, hint: 'ERP 勾选项',
      ocrKeywords: ['预立项']
    }),
    definition(14, 'custom_major_project', '是否重大立项项目', 'checkbox', {
      builtin: false,
      ocrKeywords: ['是否重大立项项目', '重大立项项目']
    }),
    definition(15, 'custom_settlement_status', '结算状态', 'select', {
      builtin: false, options: ['未结算', '已结算', '部分结算'],
      ocrKeywords: ['结算状态']
    }),
    definition(16, 'custom_approval_date', '立项时间', 'date', {
      builtin: false,
      ocrKeywords: ['立项时间']
    }),
    definition(17, 'custom_approval_no', '立项序号', 'text', {
      builtin: false, placeholder: '如 2026Y0025',
      ocrKeywords: ['立项序号']
    }),
    definition(18, 'custom_chief_engineer', '项目总工', 'text', {
      builtin: false,
      ocrKeywords: ['项目总工']
    }),
    definition(19, 'custom_safety_officer', '项目安全员', 'text', {
      builtin: false,
      ocrKeywords: ['项目安全员', '安全员']
    }),
    definition(20, 'custom_transformed', '是否转化项目', 'checkbox', {
      builtin: false,
      ocrKeywords: ['是否转化项目', '转化项目']
    }),
    definition(21, 'custom_duration', '工期', 'text', {
      builtin: false, placeholder: '如 18个月',
      ocrKeywords: ['工期']
    }),
    definition(22, 'custom_funding_note', '立项经费说明', 'textarea', {
      builtin: false, full: true,
      ocrKeywords: ['立项经费说明', '经费说明']
    }),
    definition(23, 'description', '备注', 'textarea', {
      full: true, placeholder: '项目背景、目标或其他说明',
      ocrKeywords: ['备注']
    }),

    // ---- 系统信息（不来自 ERP，可停用或调整顺序）----
    definition(24, 'code', '项目编号', 'text', {
      group: 'system', locked: false, enabled: false,
      placeholder: '留空自动生成 KY-年份-序号', hint: '系统内部编号，留空自动生成'
    }),
    definition(25, 'level', '项目级别', 'select', {
      group: 'system', enabled: false,
      options: ['集团级', '公司级', '部门级']
    }),
    definition(26, 'source', '项目来源', 'select', {
      group: 'system', enabled: false,
      options: ['集团科技计划', '公司自筹', '产学研合作']
    }),
    definition(27, 'fundSource', '经费来源', 'select', {
      group: 'system', enabled: false,
      options: ['集团拨款', '公司自筹', '配套资金']
    }),
    definition(28, 'status', '项目状态', 'status', {
      group: 'system', required: true, locked: true
    }),
    definition(29, 'progress', '整体进度（%）', 'number', {
      group: 'system', placeholder: '0—100'
    }),
    definition(30, 'fundTotal', '批复经费（万元）', 'number', {
      group: 'system', required: true, locked: true,
      hint: '可由成本控制额自动换算，也可直接修改'
    }),
    definition(31, 'erpPurchaseCode', 'ERP 采购申请编号', 'text', {
      group: 'system', enabled: false, placeholder: '选填'
    }),
    definition(32, 'inquiryCode', '采购询比系统编号', 'text', {
      group: 'system', enabled: false, placeholder: '选填'
    })
  ];
}

function normalizeOptions(value, fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const cleaned = source
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 50);
  if (!cleaned.length) return [...fallback];
  return [...new Set(cleaned)];
}

function normalizeKeywords(value) {
  const source = Array.isArray(value) ? value : [];
  const cleaned = source
    .map((item) => String(item ?? '').replace(/\s+/g, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  return [...new Set(cleaned)];
}

function cleanLabel(value, fallback) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 40) : fallback;
}

/** 校验并标准化字段配置；内置字段不可删除，锁定字段不可停用 */
export function normalizeProjectFields(input) {
  assert(Array.isArray(input) && input.length > 0, 400, '字段配置不能为空');
  const builtinDefaults = new Map(defaultProjectFields().filter((field) => field.builtin).map((field) => [field.key, field]));
  const seen = new Set();
  const fields = [];

  input.forEach((raw, index) => {
    const rawKey = String(raw.key || '').trim();
    assert(rawKey, 400, `第 ${index + 1} 个字段缺少标识`);
    const builtin = builtinDefaults.get(rawKey);
    const group = raw.group === 'system' ? 'system' : 'erp';

    if (builtin) {
      assert(!seen.has(rawKey), 400, `字段标识 ${rawKey} 重复`);
      seen.add(rawKey);
      const locked = LOCKED_KEYS.has(rawKey);
      fields.push({
        ...builtin,
        label: cleanLabel(raw.label, builtin.label),
        required: locked ? builtin.required : !!raw.required,
        enabled: locked ? true : raw.enabled !== false,
        full: raw.full === undefined ? builtin.full : !!raw.full,
        group,
        placeholder: String(raw.placeholder ?? builtin.placeholder).slice(0, 120),
        hint: String(raw.hint ?? builtin.hint).slice(0, 240),
        options: builtin.type === 'select' ? normalizeOptions(raw.options, builtin.options) : [],
        ocrKeywords: normalizeKeywords(raw.ocrKeywords ?? builtin.ocrKeywords),
        seq: index + 1
      });
      return;
    }

    const bareKey = rawKey.startsWith('custom_') ? rawKey.slice(7) : rawKey;
    assert(/^[a-zA-Z][a-zA-Z0-9_]{1,30}$/.test(bareKey), 400, `自定义字段标识「${rawKey}」不合法，请使用字母、数字和下划线`);
    const key = `custom_${bareKey.toLowerCase()}`;
    assert(!builtinDefaults.has(key), 400, `字段标识 ${key} 与内置字段冲突`);
    assert(!seen.has(key), 400, `字段标识 ${key} 重复`);
    seen.add(key);

    const type = String(raw.type || 'text');
    assert(CUSTOM_FIELD_TYPES.includes(type), 400, `自定义字段类型 ${type} 不支持`);
    const options = type === 'select' ? normalizeOptions(raw.options) : [];
    if (type === 'select') assert(options.length > 0, 400, `下拉字段「${cleanLabel(raw.label, key)}」至少需要一个选项`);

    fields.push({
      id: raw.id || `pf-${key}`,
      key,
      label: cleanLabel(raw.label, '未命名字段'),
      type,
      required: !!raw.required,
      enabled: raw.enabled !== false,
      builtin: false,
      locked: false,
      full: !!raw.full,
      group,
      placeholder: String(raw.placeholder ?? '').slice(0, 120),
      hint: String(raw.hint ?? '').slice(0, 240),
      options,
      ocrKeywords: normalizeKeywords(raw.ocrKeywords),
      seq: index + 1
    });
  });

  for (const key of builtinDefaults.keys()) {
    assert(seen.has(key), 400, `内置字段 ${builtinDefaults.get(key).label} 不能删除，只能停用`);
  }

  return fields;
}

/** 只接收已启用自定义字段的值；清空时写入空字符串以便编辑时能真正清除 */
export function normalizeCustomValues(input, fields, { requireAll = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const values = {};
  for (const field of fields) {
    if (field.builtin || !field.enabled) continue;
    const raw = source[field.key];
    if (field.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === '1' || raw === 1 || raw === '是';
      if (checked) values[field.key] = true;
      else if (requireAll && field.required) assert(false, 400, `请勾选${field.label}`);
      else if (raw !== undefined) values[field.key] = false;
      continue;
    }
    if (raw === undefined || raw === null) {
      if (requireAll && field.required) assert(false, 400, `请填写${field.label}`);
      continue;
    }
    const text = String(raw).trim();
    if (!text) {
      if (requireAll && field.required) assert(false, 400, `请填写${field.label}`);
      values[field.key] = '';
      continue;
    }
    if (field.type === 'number') {
      const number = Number(text);
      assert(Number.isFinite(number), 400, `${field.label}必须是数字`);
      values[field.key] = Math.round(number * 100) / 100;
    } else {
      values[field.key] = text.slice(0, 2000);
    }
  }
  return values;
}
