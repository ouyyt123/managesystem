import {
  addDaysISO, diffDays, materialDue, parseDate, quarterEnd, quarterLabel, quarterRange,
  stageDates, today, iso
} from './dates.mjs';

export const DONE_STATUSES = new Set(['SUBMITTED', 'LATE', 'WAIVED']);

export function attachmentCounts(db) {
  const map = new Map();
  for (const file of db.attachments) {
    if (file.deleted) continue;
    const key = file.materialId || file.quarterlyId;
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

export function attachmentsOf(db, { materialId, quarterlyId }) {
  return db.attachments
    .filter((f) => !f.deleted && (materialId ? f.materialId === materialId : f.quarterlyId === quarterlyId))
    .sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
}

export function effectiveMaterialStatus(db, material) {
  if (material.status === 'WAIVED') return 'WAIVED';
  const files = db.attachments.filter((f) => !f.deleted && f.materialId === material.id);
  if (!files.length) {
    // 兼容历史/演示数据：已记录首次提交时间但附件被逻辑删除前，仍保留提交结论
    if (material.firstSubmitAt && (material.status === 'SUBMITTED' || material.status === 'LATE')) return material.status;
    return 'PENDING';
  }
  const first = material.firstSubmitAt || files.map((f) => f.uploadedAt).sort()[0];
  return String(first).slice(0, 10) > material.dueDate ? 'LATE' : 'SUBMITTED';
}

export function quarterStatus(row, todayStr = today()) {
  if (row.status === 'SUBMITTED') return String(row.submitAt || '').slice(0, 10) > row.dueDate ? 'LATE' : 'SUBMITTED';
  return row.dueDate < todayStr ? 'OVERDUE' : 'PENDING';
}

export function buildProjectInstances(store, project) {
  const db = store.data;
  const nodes = db.templates.nodes.filter((n) => n.enabled).sort((a, b) => a.seq - b.seq);
  const created = { stages: [], materials: [], quarterly: [] };

  for (const node of nodes) {
    const range = stageDates(project, node);
    const stage = {
      id: store.nextId('st'),
      projectId: project.id,
      nodeId: node.id,
      code: node.code,
      name: node.name,
      seq: node.seq,
      startDate: range.startDate,
      endDate: range.endDate
    };
    db.stages.push(stage);
    created.stages.push(stage);

    const templates = db.templates.materials
      .filter((m) => m.nodeId === node.id && m.enabled)
      .sort((a, b) => a.seq - b.seq);
    templates.forEach((template, index) => {
      const material = {
        id: store.nextId('m'),
        projectId: project.id,
        stageId: stage.id,
        templateId: template.id,
        code: template.code,
        name: template.name,
        category: template.category,
        required: !!template.required,
        anchor: template.anchor,
        offsetDays: Number(template.offsetDays || 0),
        dueDate: materialDue(project, stage, template),
        allowLate: template.allowLate !== false,
        note: template.note || '',
        seq: index + 1,
        status: 'PENDING',
        firstSubmitAt: null,
        submitterId: null,
        waiveReason: null
      };
      db.materials.push(material);
      created.materials.push(material);
    });
  }

  const offset = Number(db.meta.quarterDueOffsetDays ?? 15);
  for (const range of quarterRange(project.startDate, project.endDate)) {
    const row = {
      id: store.nextId('q'),
      projectId: project.id,
      year: range.year,
      quarter: range.quarter,
      dueDate: addDaysISO(range.end, offset),
      exec: '',
      achievement: '',
      issue: '',
      nextPlan: '',
      spend: 0,
      cumSpend: 0,
      status: 'PENDING',
      submitAt: null,
      submitterId: null,
      updatedAt: new Date().toISOString()
    };
    db.quarterly.push(row);
    created.quarterly.push(row);
  }
  return created;
}

/** 修改项目起止日期后：重算节点计划、未提交材料截止日期，补齐新增季度 */
export function recalculateProject(store, project) {
  const db = store.data;
  const stages = db.stages.filter((s) => s.projectId === project.id);
  for (const stage of stages) {
    const node = db.templates.nodes.find((n) => n.id === stage.nodeId) || stage;
    const range = stageDates(project, node);
    stage.startDate = range.startDate;
    stage.endDate = range.endDate;
    for (const material of db.materials.filter((m) => m.stageId === stage.id)) {
      if (effectiveMaterialStatus(db, material) !== 'PENDING') continue;
      material.dueDate = materialDue(project, stage, material);
    }
  }

  const existing = new Set(db.quarterly.filter((q) => q.projectId === project.id).map((q) => `${q.year}-${q.quarter}`));
  const offset = Number(db.meta.quarterDueOffsetDays ?? 15);
  for (const range of quarterRange(project.startDate, project.endDate)) {
    if (existing.has(`${range.year}-${range.quarter}`)) continue;
    db.quarterly.push({
      id: store.nextId('q'),
      projectId: project.id,
      year: range.year,
      quarter: range.quarter,
      dueDate: addDaysISO(range.end, offset),
      exec: '',
      achievement: '',
      issue: '',
      nextPlan: '',
      spend: 0,
      cumSpend: 0,
      status: 'PENDING',
      submitAt: null,
      submitterId: null,
      updatedAt: new Date().toISOString()
    });
  }
}

export function stageStatus(db, stage, materialStatusMap) {
  const required = db.materials.filter((m) => m.stageId === stage.id && m.required);
  const allDone = required.every((m) => DONE_STATUSES.has(materialStatusMap.get(m.id) || effectiveMaterialStatus(db, m)));
  if (allDone) return 'COMPLETED';
  return stage.startDate <= today() ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export function projectSpent(db, projectId) {
  return db.funding
    .filter((f) => f.projectId === projectId)
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);
}

export function projectStats(db, project) {
  const statuses = new Map();
  for (const material of db.materials.filter((m) => m.projectId === project.id)) {
    statuses.set(material.id, effectiveMaterialStatus(db, material));
  }
  const required = db.materials.filter((m) => m.projectId === project.id && m.required);
  const completed = required.filter((m) => DONE_STATUSES.has(statuses.get(m.id))).length;
  const overdue = required.filter((m) => statuses.get(m.id) === 'PENDING' && m.dueDate < today()).length;
  const quarters = db.quarterly.filter((q) => q.projectId === project.id);
  const submittedQuarters = quarters.filter((q) => q.status === 'SUBMITTED').length;
  const spent = projectSpent(db, project.id);
  return {
    materialTotal: db.materials.filter((m) => m.projectId === project.id).length,
    requiredTotal: required.length,
    requiredDone: completed,
    requiredOverdue: overdue,
    materialProgress: required.length ? Math.round((completed / required.length) * 100) : 0,
    quarterTotal: quarters.length,
    quarterDone: submittedQuarters,
    quarterOverdue: quarters.filter((q) => quarterStatus(q) === 'OVERDUE').length,
    spent: Math.round(spent * 100) / 100,
    balance: Math.round((Number(project.fundTotal || 0) - spent) * 100) / 100,
    rate: Number(project.fundTotal) > 0 ? Math.round((spent / Number(project.fundTotal)) * 1000) / 10 : 0
  };
}

export function decorateProject(db, project, extra = {}) {
  const dept = db.departments.find((d) => d.id === project.deptId);
  const manager = db.users.find((u) => u.id === project.managerId);
  return {
    ...project,
    deptName: dept ? dept.name : '—',
    managerName: manager ? manager.name : '—',
    ...projectStats(db, project),
    ...extra
  };
}

export function visibleProjects(db, user) {
  return db.projects.filter((p) => {
    if (p.deleted) return false;
    if (user.role === 'PROJECT_MANAGER') return p.managerId === user.id;
    return true;
  });
}

export function scopeProjectIds(db, user) {
  return new Set(visibleProjects(db, user).map((p) => p.id));
}

export function alerts(db, user) {
  const projects = new Map(visibleProjects(db, user).map((p) => [p.id, p]));
  const deptMap = new Map(db.departments.map((d) => [d.id, d.name]));
  const todayStr = today();
  const items = [];

  for (const material of db.materials) {
    const project = projects.get(material.projectId);
    if (!project) continue;
    if (!material.required) continue;
    const status = effectiveMaterialStatus(db, material);
    if (status === 'WAIVED') continue;
    const overdue = status === 'PENDING' && material.dueDate < todayStr;
    const days = diffDays(material.dueDate, todayStr);
    if (!overdue && !(status === 'PENDING' && days >= 0 && days <= 30)) continue;
    items.push({
      type: 'MATERIAL',
      id: material.id,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      deptName: deptMap.get(project.deptId) || '—',
      title: material.name,
      category: material.category,
      dueDate: material.dueDate,
      overdueDays: overdue ? -days : 0,
      daysLeft: overdue ? 0 : days,
      status: overdue ? 'OVERDUE' : 'UPCOMING',
      stageName: (db.stages.find((s) => s.id === material.stageId) || {}).name || ''
    });
  }

  for (const row of db.quarterly) {
    const project = projects.get(row.projectId);
    if (!project) continue;
    if (row.status === 'SUBMITTED') continue;
    const overdue = row.dueDate < todayStr;
    const days = diffDays(row.dueDate, todayStr);
    if (!overdue && !(days >= 0 && days <= 30)) continue;
    items.push({
      type: 'QUARTERLY',
      id: row.id,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      deptName: deptMap.get(project.deptId) || '—',
      title: `${quarterLabel(row.year, row.quarter)} 季度执行情况表`,
      category: 'QUARTERLY',
      dueDate: row.dueDate,
      overdueDays: overdue ? -days : 0,
      daysLeft: overdue ? 0 : days,
      status: overdue ? 'OVERDUE' : 'UPCOMING',
      stageName: '过程执行'
    });
  }

  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'OVERDUE' ? -1 : 1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const summary = {
    overdueMaterials: items.filter((i) => i.type === 'MATERIAL' && i.status === 'OVERDUE').length,
    overdueQuarterly: items.filter((i) => i.type === 'QUARTERLY' && i.status === 'OVERDUE').length,
    upcoming: items.filter((i) => i.status === 'UPCOMING').length,
    total: items.filter((i) => i.status === 'OVERDUE').length
  };
  return { summary, items };
}

export function dashboard(db, user) {
  const projects = visibleProjects(db, user);
  const projectIds = new Set(projects.map((p) => p.id));
  const todayStr = today();

  const completed = projects.filter((p) => p.status === 'COMPLETED').length;
  const approved = projects.reduce((sum, p) => sum + Number(p.fundTotal || 0), 0);
  const spent = db.funding.filter((f) => projectIds.has(f.projectId)).reduce((sum, f) => sum + Number(f.amount || 0), 0);

  const materials = db.materials.filter((m) => projectIds.has(m.projectId));
  const dueRequired = materials.filter((m) => m.required && m.dueDate <= todayStr && effectiveMaterialStatus(db, m) !== 'WAIVED');
  const onTime = dueRequired.filter((m) => {
    const status = effectiveMaterialStatus(db, m);
    return status === 'SUBMITTED' && m.firstSubmitAt && String(m.firstSubmitAt).slice(0, 10) <= m.dueDate;
  }).length;

  const quarters = db.quarterly.filter((q) => projectIds.has(q.projectId) && q.dueDate <= todayStr);
  const quarterSubmitted = quarters.filter((q) => q.status === 'SUBMITTED').length;

  const byStatus = {};
  const byCategory = {};
  const byDept = {};
  for (const project of projects) {
    byStatus[project.status] = (byStatus[project.status] || 0) + 1;
    byCategory[project.category || '未分类'] = (byCategory[project.category || '未分类'] || 0) + 1;
    const dept = db.departments.find((d) => d.id === project.deptId);
    const key = dept ? dept.name : '未分配';
    byDept[key] = byDept[key] || { name: key, count: 0, fund: 0, spent: 0 };
    byDept[key].count += 1;
    byDept[key].fund += Number(project.fundTotal || 0);
    byDept[key].spent += projectSpent(db, project.id);
  }

  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${d.getUTCMonth() + 1}月`, amount: 0 });
  }
  for (const entry of db.funding) {
    if (!projectIds.has(entry.projectId)) continue;
    const key = String(entry.date).slice(0, 7);
    const month = months.find((m) => m.key === key);
    if (month) month.amount += Number(entry.amount || 0);
  }

  const alertData = alerts(db, user);
  const working = projects.filter((p) => ['ACTIVE', 'MID_TERM', 'FINAL', 'PLANNING'].includes(p.status));

  return {
    kpi: {
      projects: projects.length,
      active: projects.filter((p) => ['ACTIVE', 'MID_TERM', 'FINAL'].includes(p.status)).length,
      completed,
      completionRate: projects.length ? Math.round((completed / projects.length) * 1000) / 10 : 0,
      approved: Math.round(approved * 100) / 100,
      spent: Math.round(spent * 100) / 100,
      fundRate: approved ? Math.round((spent / approved) * 1000) / 10 : 0,
      onTimeRate: dueRequired.length ? Math.round((onTime / dueRequired.length) * 1000) / 10 : 0,
      dueMaterials: dueRequired.length,
      onTimeMaterials: onTime,
      quarterDue: quarters.length,
      quarterSubmitted,
      quarterRate: quarters.length ? Math.round((quarterSubmitted / quarters.length) * 1000) / 10 : 0,
      overdue: alertData.summary.total
    },
    byStatus: Object.entries(byStatus).map(([code, value]) => ({ code, value })),
    byCategory: Object.entries(byCategory).map(([name, value]) => ({ name, value })),
    byDept: Object.values(byDept).sort((a, b) => b.fund - a.fund),
    monthly: months,
    alerts: alertData.items.slice(0, 8),
    alertSummary: alertData.summary,
    projects: working
      .sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0))
      .slice(0, 6)
      .map((p) => decorateProject(db, p))
  };
}

export function categoryLedger(db, code, user) {
  const projects = visibleProjects(db, user);
  const rows = projects.map((project) => {
    const materials = db.materials
      .filter((m) => m.projectId === project.id && m.category === code)
      .sort((a, b) => a.seq - b.seq);
    if (!materials.length) return null;
    const view = materials.map((m) => {
      const status = effectiveMaterialStatus(db, m);
      const overdue = status === 'PENDING' && m.dueDate < today();
      return {
        id: m.id,
        name: m.name,
        required: m.required,
        dueDate: m.dueDate,
        status: overdue ? 'OVERDUE' : status,
        stageName: (db.stages.find((s) => s.id === m.stageId) || {}).name || '',
        attachmentCount: db.attachments.filter((a) => !a.deleted && a.materialId === m.id).length
      };
    });
    return {
      projectId: project.id,
      code: project.code,
      name: project.name,
      deptName: (db.departments.find((d) => d.id === project.deptId) || {}).name || '—',
      managerName: (db.users.find((u) => u.id === project.managerId) || {}).name || '—',
      status: project.status,
      erpCode: project.erpCode || '',
      erpPurchaseCode: project.erpPurchaseCode || '',
      inquiryCode: project.inquiryCode || '',
      materials: view,
      done: view.filter((m) => DONE_STATUSES.has(m.status)).length,
      total: view.length,
      overdue: view.filter((m) => m.status === 'OVERDUE').length
    };
  }).filter(Boolean);

  const all = rows.flatMap((r) => r.materials);
  return {
    rows,
    summary: {
      projects: rows.length,
      materials: all.length,
      done: all.filter((m) => DONE_STATUSES.has(m.status)).length,
      overdue: all.filter((m) => m.status === 'OVERDUE').length
    }
  };
}

export function quarterlyRows(db, user, filters = {}) {
  const allowed = scopeProjectIds(db, user);
  const rows = db.quarterly
    .filter((q) => allowed.has(q.projectId))
    .filter((q) => !filters.year || Number(q.year) === Number(filters.year))
    .filter((q) => !filters.quarter || Number(q.quarter) === Number(filters.quarter))
    .map((q) => {
      const project = db.projects.find((p) => p.id === q.projectId) || {};
      const status = quarterStatus(q);
      return {
        ...q,
        projectCode: project.code,
        projectName: project.name,
        deptName: (db.departments.find((d) => d.id === project.deptId) || {}).name || '—',
        managerName: (db.users.find((u) => u.id === project.managerId) || {}).name || '—',
        displayStatus: status,
        attachmentCount: db.attachments.filter((a) => !a.deleted && a.quarterlyId === q.id).length
      };
    })
    .filter((q) => !filters.status || q.displayStatus === filters.status)
    .filter((q) => {
      if (!filters.keyword) return true;
      const k = String(filters.keyword).toLowerCase();
      return `${q.projectCode} ${q.projectName}`.toLowerCase().includes(k);
    })
    .sort((a, b) => {
      const priority = { OVERDUE: 0, PENDING: 1, LATE: 2, SUBMITTED: 3 };
      const pa = priority[a.displayStatus] ?? 4;
      const pb = priority[b.displayStatus] ?? 4;
      if (pa !== pb) return pa - pb;
      if (pa <= 1) return a.dueDate.localeCompare(b.dueDate);
      return String(b.submitAt || '').localeCompare(String(a.submitAt || ''));
    });

  return rows;
}

export function quarterSummary(rows) {
  return {
    total: rows.length,
    submitted: rows.filter((r) => r.status === 'SUBMITTED').length,
    overdue: rows.filter((r) => r.displayStatus === 'OVERDUE').length,
    late: rows.filter((r) => r.displayStatus === 'LATE').length,
    pending: rows.filter((r) => r.displayStatus === 'PENDING').length
  };
}

export function displayPayload(db, nowISO = iso(new Date())) {
  const projects = db.projects.filter((p) => !p.deleted);
  const projectIds = new Set(projects.map((p) => p.id));
  const approved = projects.reduce((sum, p) => sum + Number(p.fundTotal || 0), 0);
  const spent = db.funding.filter((f) => projectIds.has(f.projectId)).reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const todayStr = today();

  const materials = db.materials.filter((m) => projectIds.has(m.projectId));
  const due = materials.filter((m) => m.required && m.dueDate <= todayStr && effectiveMaterialStatus(db, m) !== 'WAIVED');
  const onTime = due.filter((m) => {
    const status = effectiveMaterialStatus(db, m);
    return status === 'SUBMITTED' && String(m.firstSubmitAt || '').slice(0, 10) <= m.dueDate;
  }).length;

  const acceptanceProjects = projects.map((p) => {
    const list = materials.filter((m) => m.projectId === p.id && m.category === 'ACCEPTANCE');
    const done = list.filter((m) => DONE_STATUSES.has(effectiveMaterialStatus(db, m))).length;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      done,
      total: list.length,
      status: p.status,
      statusName: (list.length && done >= list.length) ? '材料齐全' : done ? '部分完成' : '待提交'
    };
  }).sort((a, b) => b.endDate.localeCompare(a.endDate)).slice(0, 6);

  const categoryDist = {};
  for (const material of materials) {
    categoryDist[material.category] = categoryDist[material.category] || { total: 0, done: 0 };
    categoryDist[material.category].total += 1;
    if (DONE_STATUSES.has(effectiveMaterialStatus(db, material))) categoryDist[material.category].done += 1;
  }

  const stages = db.templates.nodes.filter((n) => n.enabled).sort((a, b) => a.seq - b.seq).map((node) => {
    const sample = projects[0];
    const range = sample ? stageDates(sample, node) : { startDate: '', endDate: '' };
    return { id: node.id, name: node.name, seq: node.seq, ratio: `${Math.round(node.startRatio * 100)}% — ${Math.round(node.endRatio * 100)}%`, sampleStart: range.startDate, sampleEnd: range.endDate, count: db.templates.materials.filter((m) => m.nodeId === node.id).length };
  });

  const alertData = alerts(db, { role: 'VIEWER' });
  return {
    generatedAt: new Date().toISOString(),
    kpi: {
      projects: projects.length,
      active: projects.filter((p) => ['ACTIVE', 'MID_TERM', 'FINAL'].includes(p.status)).length,
      completed: projects.filter((p) => p.status === 'COMPLETED').length,
      acceptanceTodo: acceptanceProjects.filter((p) => p.done < p.total).length,
      spent,
      fundRate: approved ? Math.round((spent / approved) * 1000) / 10 : 0,
      onTimeRate: due.length ? Math.round((onTime / due.length) * 1000) / 10 : 0,
      ipProjects: new Set(materials.filter((m) => m.category === 'IP' && DONE_STATUSES.has(effectiveMaterialStatus(db, m))).map((m) => m.projectId)).size
    },
    monthly: monthsOfFunding(db, projectIds),
    categoryDist: Object.entries(categoryDist).map(([code, value]) => ({ code, ...value, rate: value.total ? Math.round((value.done / value.total) * 100) : 0 })),
    stages,
    acceptanceProjects,
    alerts: alertData.items.slice(0, 7),
    alertSummary: alertData.summary
  };
}

function monthsOfFunding(db, projectIds) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${d.getUTCMonth() + 1}月`, amount: 0 });
  }
  for (const entry of db.funding) {
    if (!projectIds.has(entry.projectId)) continue;
    const month = months.find((m) => m.key === String(entry.date).slice(0, 7));
    if (month) month.amount += Number(entry.amount || 0);
  }
  let cumulative = 0;
  return months.map((m) => {
    cumulative += m.amount;
    return { ...m, cumulative: Math.round(cumulative * 100) / 100, amount: Math.round(m.amount * 100) / 100 };
  });
}

export function quarterProgress(db, projectId) {
  const rows = db.quarterly.filter((q) => q.projectId === projectId).sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  return rows.map((row) => ({ ...row, displayStatus: quarterStatus(row) }));
}

export function assert(condition, status, message) {
  if (condition) return;
  const error = new Error(message);
  error.status = status;
  throw error;
}

export { today, iso, quarterRange, quarterEnd, quarterLabel, parseDate };
