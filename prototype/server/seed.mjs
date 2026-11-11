import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, sha256, uuid } from './auth.mjs';
import { minimalPdf, writeUpload } from './store.mjs';
import { addDaysISO, iso, today, quarterEnd } from './dates.mjs';
import { buildProjectInstances } from './services.mjs';
import { defaultProjectFields } from './project-fields.mjs';
import { defaultMenus } from './menus.mjs';

const CATS = ['技术开发', '应用研究', '成果转化', '基础研究'];
const LEVELS = ['集团级', '公司级', '部门级'];
const SOURCES = ['集团科技计划', '公司自筹', '产学研合作'];
const FUND_SOURCES = ['集团拨款', '公司自筹', '配套资金'];
const FUND_TYPES = ['设备费', '材料费', '测试化验加工费', '差旅费', '劳务费', '委托业务费'];
const SUBJECTS = ['研发支出-直接投入', '研发支出-人员费用', '研发支出-折旧费用', '研发支出-其他费用'];

function at(dateISO, hour = 9, minute = 30) {
  return `${dateISO}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

export function seedDatabase(store) {
  const db = {
    meta: {
      version: 1,
      seededAt: new Date().toISOString(),
      quarterDueOffsetDays: 15,
      displayKey: process.env.DISPLAY_KEY || 'research2026',
      counters: {}
    },
    departments: [],
    users: [],
    templates: { nodes: [], materials: [] },
    projectFields: defaultProjectFields(),
    menus: defaultMenus(),
    projects: [],
    stages: [],
    materials: [],
    quarterly: [],
    funding: [],
    attachments: [],
    logs: []
  };
  store.data = db;

  const depts = [
    ['d1', '智能装备部', 'ZNZB', '刘建国'],
    ['d2', '数字化部', 'SZHB', '陈晓东'],
    ['d3', '工艺研究院', 'GYYJY', '周敏'],
    ['d4', '检测中心', 'JCZX', '孙立'],
    ['d5', '科技管理部', 'KJGLB', '赵文'],
    ['d6', '数智研发中心', 'SZRDC', '邓建平']
  ].map(([id, name, code, leader]) => ({ id, name, code, leader, enabled: true }));
  db.departments = depts;

  const password = hashPassword('123456');
  db.users = [
    { id: 'u1', username: 'admin', name: '系统管理员', role: 'ADMIN', deptId: 'd5', title: '信息化主管', phone: '13800000001', email: 'admin@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u2', username: 'keyan', name: '赵文', role: 'RESEARCH_MANAGER', deptId: 'd5', title: '科研管理专员', phone: '13800000002', email: 'keyan@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u3', username: 'zhangwei', name: '张伟', role: 'PROJECT_MANAGER', deptId: 'd1', title: '高级工程师', phone: '13800000003', email: 'zhangwei@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u4', username: 'lina', name: '李娜', role: 'PROJECT_MANAGER', deptId: 'd2', title: '项目经理', phone: '13800000004', email: 'lina@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u5', username: 'wangqiang', name: '王强', role: 'PROJECT_MANAGER', deptId: 'd3', title: '主任工程师', phone: '13800000005', email: 'wangqiang@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u6', username: 'viewer', name: '孙立', role: 'VIEWER', deptId: 'd4', title: '检测中心主任', phone: '13800000006', email: 'viewer@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null },
    { id: 'u7', username: 'dengjianping', name: '邓建平', role: 'PROJECT_MANAGER', deptId: 'd6', title: '项目负责人', phone: '13800000007', email: 'dengjianping@example.com', enabled: true, passwordHash: password, createdAt: new Date().toISOString(), lastLoginAt: null }
  ];

  const nodeSeeds = [
    { code: 'INITIATION', name: '立项准备', startRatio: 0, endRatio: 0.1, startOffset: 0, endOffset: 0, description: '提出科研建议、可行性研究、立项报告并通过总办会评审。' },
    { code: 'EXECUTION', name: '执行过程', startRatio: 0.1, endRatio: 0.9, startOffset: 0, endOffset: 0, description: '采购询比、变更、检测、知识产权等过程材料归集。' },
    { code: 'ACCEPTANCE', name: '验收管理', startRatio: 0.9, endRatio: 1, startOffset: 0, endOffset: 0, description: '组织验收、编制总结报告与财务决算报告。' },
    { code: 'ARCHIVE', name: '成果归档', startRatio: 1, endRatio: 1, startOffset: 30, endOffset: 30, description: '项目结束后 30 天内完成档案移交与成果登记。' }
  ];

  db.templates.nodes = nodeSeeds.map((node, index) => ({
    id: `n${index + 1}`,
    code: node.code,
    name: node.name,
    seq: index + 1,
    startRatio: node.startRatio,
    endRatio: node.endRatio,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
    description: node.description,
    enabled: true
  }));

  const materialSeeds = [
    ['M-INIT-01', '科研建议书（附件1）', 'INITIATION', 'INITIATION', true, 'STAGE_END', 0, '项目提出阶段的科研建议书，对应制度附件1。'],
    ['M-INIT-02', '可行性研究报告（附件2）', 'INITIATION', 'INITIATION', true, 'STAGE_END', 0, '可行性研究报告，对应制度附件2。'],
    ['M-INIT-03', '立项报告（附件3）', 'INITIATION', 'INITIATION', true, 'STAGE_END', 0, '立项报告，对应制度附件3。'],
    ['M-INIT-04', '总办会评审会议纪要（附件4）', 'INITIATION', 'INITIATION', true, 'STAGE_END', 0, '总办会评审后形成的会议纪要，对应制度附件4；ERP 立项编号在项目信息中回填。'],
    ['M-EXE-01', '采购申请及 ERP 流程材料', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '数智采购系统采购申请及 ERP 流程材料，选交。'],
    ['M-EXE-02', '调研公告', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '采购询比调研公告，选交。'],
    ['M-EXE-03', '三家单位响应文件', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '不少于三家供应商的响应文件，选交。'],
    ['M-EXE-04', '调研评审报表', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '调研评审过程记录与评审报表，选交。'],
    ['M-EXE-05', '询价公告', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '询价公告及发布记录，选交。'],
    ['M-EXE-06', '三家单位报价文件', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '三家单位报价文件，选交。'],
    ['M-EXE-07', '最低价确认及 ERP 录入材料', 'EXECUTION', 'PROCUREMENT', false, 'STAGE_END', 0, '最低价确认单及 ERP 录入截图，选交。'],
    ['M-EXE-08', '项目变更情况表（附件5.3）', 'EXECUTION', 'CHANGE', false, 'STAGE_END', 0, '发生项目变更时填报，对应附件5.3。'],
    ['M-EXE-09', '检测报告（附件5.4）', 'EXECUTION', 'TESTING', false, 'STAGE_END', 0, '按实际检测情况归集，对应附件5.4。'],
    ['M-EXE-10', '知识产权证明（附件5.5）', 'EXECUTION', 'IP', false, 'STAGE_END', 0, '软著、专利、论文等知识产权证明，对应附件5.5。'],
    ['M-ACC-01', '验收申请表（附件6）', 'ACCEPTANCE', 'ACCEPTANCE', true, 'STAGE_END', 0, '项目验收申请表，对应附件6。'],
    ['M-ACC-02', '项目总结报告（附件7）', 'ACCEPTANCE', 'ACCEPTANCE', true, 'STAGE_END', 0, '项目总结报告，对应附件7。'],
    ['M-ACC-03', '项目技术总结报告（附件8）', 'ACCEPTANCE', 'ACCEPTANCE', true, 'STAGE_END', 0, '项目技术总结报告，对应附件8。'],
    ['M-ACC-04', '项目财务决算报告（附件9）', 'ACCEPTANCE', 'ACCEPTANCE', true, 'STAGE_END', 0, '项目财务决算报告，对应附件9。'],
    ['M-ARC-01', '科研档案移交清单', 'ARCHIVE', 'ARCHIVE', true, 'PROJECT_END', 30, '项目结束后 30 天内移交科研档案。'],
    ['M-ARC-02', '成果归档登记表', 'ARCHIVE', 'ARCHIVE', true, 'PROJECT_END', 30, '成果归档登记表，含知识产权与转化情况。']
  ];

  db.templates.materials = materialSeeds.map(([code, name, nodeCode, category, required, anchor, offsetDays, note], index) => ({
    id: `t${index + 1}`,
    code,
    name,
    nodeId: db.templates.nodes.find((n) => n.code === nodeCode).id,
    category,
    required,
    anchor,
    offsetDays,
    allowLate: true,
    note,
    seq: index + 1,
    enabled: true
  }));

  const todayISO = today();
  const projectSeeds = [
    {
      code: `KY-${Number(todayISO.slice(0, 4)) - 2}-001`, name: '智能巡检机器人关键技术研究', category: CATS[0], level: LEVELS[0], source: SOURCES[0],
      deptId: 'd1', managerId: 'u3', startDate: addDaysISO(todayISO, -700), endDate: addDaysISO(todayISO, -120),
      fundTotal: 320, fundSource: FUND_SOURCES[0], status: 'COMPLETED', progress: 100, erpCode: 'ERP-LX-2024-0081', erpPurchaseCode: 'ERP-CG-2024-0212', inquiryCode: 'XB-2024-0037',
      customFields: { custom_cost_control: 3200000, custom_contract_amount: 3200000, custom_planned_profit: -3200000, custom_settlement_status: '已结算', custom_approval_date: '2024-12-01', custom_approval_no: '2024Y001', custom_chief_engineer: '张伟', custom_safety_officer: '李娜', custom_duration: '30个月', custom_funding_note: '预计项目成本320万元' },
      description: '面向变电站、管廊场景的自主巡检机器人，完成底盘、云台、缺陷识别算法与后台管理平台研制。'
    },
    {
      code: `KY-${Number(todayISO.slice(0, 4)) - 1}-002`, name: '工业设备预测性维护平台', category: CATS[1], level: LEVELS[1], source: SOURCES[1],
      deptId: 'd2', managerId: 'u4', startDate: addDaysISO(todayISO, -260), endDate: addDaysISO(todayISO, 300),
      fundTotal: 180, fundSource: FUND_SOURCES[1], status: 'ACTIVE', progress: 45, erpCode: 'ERP-LX-2025-0136', erpPurchaseCode: 'ERP-CG-2025-0288', inquiryCode: 'XB-2025-0061',
      customFields: { custom_cost_control: 1800000, custom_contract_amount: 1800000, custom_planned_profit: -1800000, custom_settlement_status: '未结算', custom_approval_date: '2025-08-20', custom_approval_no: '2025Y002', custom_chief_engineer: '李娜', custom_safety_officer: '张伟', custom_duration: '24个月', custom_funding_note: '预计项目成本180万元' },
      description: '基于振动、温度、电流多源数据的设备健康度评估与剩余寿命预测平台，覆盖 3 条产线试点。'
    },
    {
      code: `KY-${Number(todayISO.slice(0, 4))}-001`, name: '高精度视觉检测算法研究', category: CATS[2], level: LEVELS[1], source: SOURCES[2],
      deptId: 'd1', managerId: 'u3', startDate: addDaysISO(todayISO, -200), endDate: addDaysISO(todayISO, 160),
      fundTotal: 150, fundSource: FUND_SOURCES[0], status: 'MID_TERM', progress: 58, erpCode: 'ERP-LX-2026-0018', erpPurchaseCode: '', inquiryCode: 'XB-2026-0009',
      customFields: { custom_cost_control: 1500000, custom_contract_amount: 1500000, custom_planned_profit: -1500000, custom_settlement_status: '未结算', custom_approval_date: '2026-01-05', custom_approval_no: '2026Y003', custom_chief_engineer: '张伟', custom_safety_officer: '王强', custom_duration: '18个月', custom_funding_note: '预计项目成本150万元' },
      description: '面向精密结构件的亚像素级缺陷检测，重点突破小样本训练与高速成像标定。'
    },
    {
      code: `KY-${Number(todayISO.slice(0, 4))}-002`, name: '数字孪生产线仿真平台', category: CATS[0], level: LEVELS[2], source: SOURCES[1],
      deptId: 'd3', managerId: 'u5', startDate: addDaysISO(todayISO, -420), endDate: addDaysISO(todayISO, -20),
      fundTotal: 240, fundSource: FUND_SOURCES[2], status: 'FINAL', progress: 92, erpCode: 'ERP-LX-2025-0044', erpPurchaseCode: 'ERP-CG-2025-0102', inquiryCode: 'XB-2025-0021',
      customFields: { custom_cost_control: 2400000, custom_contract_amount: 2400000, custom_planned_profit: -2400000, custom_settlement_status: '未结算', custom_approval_date: '2025-08-15', custom_approval_no: '2025Y004', custom_chief_engineer: '王强', custom_safety_officer: '李娜', custom_duration: '12个月', custom_funding_note: '预计项目成本240万元' },
      description: '面向总装车间的数字孪生仿真与节拍优化平台，已完成验收材料初稿，等待验收会。'
    },
    {
      code: `KY-${Number(todayISO.slice(0, 4))}-003`, name: '面向柔性产线的工艺知识图谱构建', category: CATS[3], level: LEVELS[2], source: SOURCES[0],
      deptId: 'd3', managerId: 'u4', startDate: addDaysISO(todayISO, 30), endDate: addDaysISO(todayISO, 430),
      fundTotal: 90, fundSource: FUND_SOURCES[0], status: 'PLANNING', progress: 5, erpCode: '', erpPurchaseCode: '', inquiryCode: '',
      customFields: { custom_cost_control: 900000, custom_contract_amount: 0, custom_planned_profit: -900000, custom_settlement_status: '未结算', custom_approval_date: '2026-09-20', custom_approval_no: '2026Y005', custom_chief_engineer: '李娜', custom_safety_officer: '张伟', custom_duration: '24个月', custom_funding_note: '预计项目成本90万元' },
      description: '梳理柔性产线工艺知识，构建可检索、可推理的工艺知识图谱，尚在立项准备阶段。'
    }
  ];

  const RNG = mulberry32(20261105);

  projectSeeds.forEach((seed, index) => {
    const project = {
      id: `p${index + 1}`,
      ...seed,
      members: ['u3', 'u4', 'u5'].filter((id) => id !== seed.managerId).slice(0, 2),
      deleted: false,
      createdBy: 'u2',
      createdAt: at(addDaysISO(todayISO, -720 + index * 5)),
      updatedAt: new Date().toISOString()
    };
    db.projects.push(project);
    buildProjectInstances(store, project);
  });

  const byProject = (id) => db.projects.find((p) => p.id === id);
  const materialsOf = (id) => db.materials.filter((m) => m.projectId === id);
  const materialByCode = (id, code) => materialsOf(id).find((m) => m.code === code);
  const userFor = (project) => project.managerId;

  let fileIndex = 0;
  const attach = (material, project, title) => {
    const buffer = minimalPdf([
      title,
      '',
      `项目编号：${project.code}`,
      `项目名称：${project.name}`,
      `材料名称：${material.name}`,
      `截止日期：${material.dueDate}`,
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '本文件为原型演示附件，用于验证材料归集、下载与预览流程。'
    ]);
    const date = material.firstSubmitAt ? material.firstSubmitAt.slice(0, 10) : today();
    const relativeDir = `${date.slice(0, 4)}/${date.slice(5, 7)}`;
    const storedName = `${uuid()}.pdf`;
    const target = writeUpload(store, relativeDir, storedName);
    fs.writeFileSync(target.absolute, buffer);
    db.attachments.push({
      id: `a${++fileIndex}`,
      materialId: material.id,
      quarterlyId: null,
      filename: `${title}.pdf`,
      storedName,
      relativePath: target.relative,
      size: buffer.length,
      mime: 'application/pdf',
      sha256: sha256(buffer),
      uploaderId: userFor(project),
      uploadedAt: material.firstSubmitAt || at(today()),
      deleted: false
    });
  };

  const submit = (material, project, daysBefore = 2, withFile = true) => {
    const submitDate = addDaysISO(material.dueDate, -daysBefore);
    const safeDate = submitDate > today() ? today() : submitDate;
    material.status = safeDate > material.dueDate ? 'LATE' : 'SUBMITTED';
    material.firstSubmitAt = at(safeDate);
    material.submitterId = userFor(project);
    if (withFile) attach(material, project, material.name.replace(/（.*?）/g, '').trim());
    return material;
  };

  // 项目1：已完成，全部材料齐备
  const p1 = byProject('p1');
  for (const material of materialsOf('p1')) {
    submit(material, p1, 1 + Math.floor(RNG() * 6), true);
  }

  // 项目2：在研，立项齐备，采购部分归集
  const p2 = byProject('p2');
  ['M-INIT-01', 'M-INIT-02', 'M-INIT-03', 'M-INIT-04', 'M-EXE-01', 'M-EXE-02', 'M-EXE-03', 'M-EXE-10'].forEach((code, i) => {
    const material = materialByCode('p2', code);
    if (material) submit(material, p2, i + 1, true);
  });

  // 项目3：中期，立项与部分采购、知识产权已归集
  const p3 = byProject('p3');
  ['M-INIT-01', 'M-INIT-02', 'M-INIT-03', 'M-INIT-04', 'M-EXE-01', 'M-EXE-02', 'M-EXE-09'].forEach((code, i) => {
    const material = materialByCode('p3', code);
    if (material) submit(material, p3, i + 1, i % 2 === 0);
  });

  // 项目4：结题验收中，验收材料逾期未交，用于演示逾期补传
  const p4 = byProject('p4');
  ['M-INIT-01', 'M-INIT-02', 'M-INIT-03', 'M-INIT-04', 'M-EXE-01', 'M-EXE-02', 'M-EXE-03', 'M-EXE-04', 'M-EXE-05', 'M-EXE-06', 'M-EXE-07', 'M-EXE-08', 'M-EXE-09'].forEach((code, i) => {
    const material = materialByCode('p4', code);
    if (material) submit(material, p4, 1 + (i % 4), true);
  });
  // 验收材料：早于截止日期未提交 → 逾期；其中一项标记无需提交以演示
  const waive = materialByCode('p4', 'M-ACC-03');
  if (waive) {
    waive.status = 'WAIVED';
    waive.waiveReason = '技术总结报告合并至项目总结报告，经科研管理员确认无需单独提交。';
  }
  // 项目5：立项准备，全部待提交

  // 季度报表：按项目填写部分季度
  const quarterText = [
    '本季度完成总体方案评审，进入详细设计阶段，累计投入研发人员 12 人月。',
    '完成核心模块开发与联调，关键指标达到阶段目标，形成中期检查材料。',
    '完成现场试点部署，采集运行数据并完成算法调优，进入验收准备阶段。',
    '开展验收测试与资料整理，财务决算报告正在编制中。',
    '立项材料准备完成，等待总办会评审。'
  ];
  db.quarterly.forEach((row) => {
    const project = byProject(row.projectId);
    if (project.status === 'COMPLETED') {
      row.exec = '按季度完成计划任务，形成阶段性技术文档与试验记录，累计投入研发人员 12 人月。';
      row.achievement = '完成节点任务，关键指标达到阶段目标。';
      row.issue = '部分外协件到货周期偏长，已通过提前备料缓解。';
      row.nextPlan = '进入下一阶段研制，开展可靠性验证。';
      row.spend = Math.round(project.fundTotal / 8 * 100) / 100;
      row.status = 'SUBMITTED';
      row.submitAt = at(addDaysISO(row.dueDate, -2));
      row.submitterId = project.managerId;
    }
  });

  // 未完成项目：历史季度全部补齐，仅保留最近一个到期季度未提交，用于演示逾期补报
  for (const project of db.projects) {
    if (project.status === 'COMPLETED' || project.status === 'PLANNING') continue;
    const rows = db.quarterly
      .filter((q) => q.projectId === project.id)
      .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
    const overdue = rows.filter((row) => row.dueDate < todayISO);
    const stayPending = overdue[overdue.length - 1];
    rows.forEach((row, index) => {
      if (row.dueDate >= todayISO || row === stayPending) return;
      row.status = 'SUBMITTED';
      row.exec = quarterText[index % quarterText.length];
      row.achievement = '完成季度计划任务，形成阶段成果并通过内部评审。';
      row.issue = '研发资源阶段性紧张，已协调补充人员。';
      row.nextPlan = '按计划推进下一季度任务，重点关注关键指标验证。';
      row.spend = Math.round(project.fundTotal / 10 * 100) / 100;
      row.submitAt = at(addDaysISO(row.dueDate, -3));
      row.submitterId = project.managerId;
    });
  }

  // 经费台账
  const plans = [
    ['p1', [['设备费', 96, 0.15], ['材料费', 58, 0.3], ['测试化验加工费', 42, 0.45], ['劳务费', 64, 0.62], ['差旅费', 18, 0.75], ['委托业务费', 30, 0.9]]],
    ['p2', [['设备费', 42, 0.2], ['材料费', 18, 0.35], ['测试化验加工费', 16, 0.5], ['劳务费', 10, 0.7], ['差旅费', 6, 0.85]]],
    ['p3', [['设备费', 28, 0.2], ['材料费', 12, 0.4], ['测试化验加工费', 9, 0.6], ['劳务费', 8, 0.75], ['差旅费', 4, 0.9]]],
    ['p4', [['设备费', 88, 0.12], ['材料费', 46, 0.32], ['测试化验加工费', 34, 0.55], ['劳务费', 40, 0.7], ['委托业务费', 16, 0.88]]],
    ['p5', [['设备费', 8, 0.1], ['材料费', 2, 0.2]]]
  ];
  let fundingIndex = 0;
  for (const [projectId, rows] of plans) {
    const project = byProject(projectId);
    for (const [type, amount, ratio] of rows) {
      const start = parseDay(project.startDate);
      const end = parseDay(project.endDate);
      const when = new Date(start.getTime() + (end.getTime() - start.getTime()) * ratio);
      const capped = when > new Date() ? new Date() : when;
      db.funding.push({
        id: `f${++fundingIndex}`,
        projectId,
        date: iso(capped),
        amount,
        type,
        subject: SUBJECTS[fundingIndex % SUBJECTS.length],
        note: `${type}支出（演示数据）`,
        createdBy: project.managerId,
        createdAt: at(iso(capped))
      });
    }
  }

  // 演示操作日志
  const logSeeds = [
    ['u2', 'RESEARCH_MANAGER', '项目', '新建', 'KY-2026-003', '创建项目并生成 4 个节点、20 项材料、季度报表'],
    ['u3', 'PROJECT_MANAGER', '材料', '上传', '科研建议书（附件1）', '上传 1 个附件，状态变为已提交'],
    ['u4', 'PROJECT_MANAGER', '季度报表', '提交', `${new Date().getUTCFullYear()} Q2 季度执行情况表`, '提交季度执行报表'],
    ['u2', 'RESEARCH_MANAGER', '流程模板', '修改', '流程节点模板', '调整“执行过程”节点周期比例 10%—85%'],
    ['u5', 'PROJECT_MANAGER', '经费', '新增', '设备费 88 万元', '登记经费支出'],
    ['u1', 'ADMIN', '用户', '修改', 'u4', '重置密码'],
    ['u2', 'RESEARCH_MANAGER', '材料', '标记无需提交', '项目技术总结报告', '技术总结合并至项目总结报告']
  ];
  logSeeds.forEach(([userId, role, module, action, target, detail], index) => {
    db.logs.push({
      id: `lg${index + 1}`,
      at: at(addDaysISO(todayISO, -(index + 1)), 9 + (index % 6), 12),
      userId,
      username: (db.users.find((u) => u.id === userId) || {}).name || userId,
      role,
      module,
      action,
      target,
      detail,
      ip: '127.0.0.1'
    });
  });
  db.meta.counters = {
    p: db.projects.length,
    u: db.users.length,
    d: db.departments.length,
    n: db.templates.nodes.length,
    t: db.templates.materials.length,
    st: db.stages.length,
    m: db.materials.length,
    q: db.quarterly.length,
    f: fundingIndex,
    a: fileIndex,
    lg: logSeeds.length
  };

  store.saveNow();
  return db;
}

function parseDay(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { quarterEnd };
