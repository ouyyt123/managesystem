import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import {
  escapeHtml, num, wan, pct, statusPill, meta, PROJECT_STATUS, CATEGORIES, dateText
} from '../core/format.js';
import { donutHTML, legendHTML, areaChartHTML, barRowsHTML } from '../core/charts.js';
import { emptyBlock } from '../core/ui.js';

const STATUS_COLORS = {
  PLANNING: '#94a3b8',
  ACTIVE: '#6366f1',
  MID_TERM: '#8b5cf6',
  FINAL: '#f59e0b',
  COMPLETED: '#10b981',
  TERMINATED: '#f43f5e'
};

function kpiCard({ label, value, unit = '', iconName, tone = '', foot = '', delta = '' }) {
  return `
    <div class="kpi">
      <div class="kpi-top">
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-icon ${tone}">${icon(iconName)}</div>
      </div>
      <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
      <div class="kpi-foot">${delta}${foot ? `<span>${foot}</span>` : ''}</div>
    </div>`;
}

function alertItem(item, navigate) {
  const overdue = item.status === 'OVERDUE';
  return `
    <div class="alert-item" data-goto-project="${item.projectId}" data-target="${item.type === 'MATERIAL' ? `material:${item.id}` : `quarterly:${item.id}`}" style="cursor:pointer">
      <span class="marker ${overdue ? '' : 'upcoming'}">${icon(overdue ? 'alertTriangle' : 'clock')}</span>
      <div class="grow">
        <div class="alert-title">${escapeHtml(item.title)}</div>
        <div class="alert-sub">${escapeHtml(item.projectCode)} · ${escapeHtml(item.projectName)} · 截止 ${dateText(item.dueDate)}</div>
      </div>
      <div class="alert-days ${overdue ? '' : 'upcoming'}">${overdue ? `逾期 ${item.overdueDays} 天` : `${item.daysLeft} 天后到期`}</div>
    </div>`;
}

export async function render({ user, navigate }) {
  const [data, categories] = await Promise.all([api('/dashboard'), api('/categories')]);
  const wrap = document.createElement('div');
  const { kpi, byStatus, byDept, monthly, alerts, alertSummary, projects } = data;

  const statusData = byStatus.map((item) => ({
    label: meta(PROJECT_STATUS, item.code).name,
    value: item.value,
    color: STATUS_COLORS[item.code] || '#94a3b8'
  }));
  const statusLegend = statusData.map((item) => ({ label: `${item.label} ${item.value}`, color: item.color }));

  const today = new Date();
  const dateText2 = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const scopeText = user.role === 'PROJECT_MANAGER'
    ? `统计范围：本人负责的 ${kpi.projects} 个项目`
    : `统计范围：全部 ${kpi.projects} 个项目`;

  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Dashboard · 运行总览</div>
        <h1 class="page-title">科研工作台</h1>
        <div class="page-sub">${dateText2} · ${escapeHtml(scopeText)} · 逾期 <strong style="color:#be123c">${kpi.overdue}</strong> 项待处理</div>
      </div>
      <div class="page-actions">
        ${user.role !== 'VIEWER' ? `<button class="btn btn-secondary" type="button" data-new-project>${icon('plus')}新建项目</button>` : ''}
        <button class="btn btn-soft" type="button" data-goto-alerts>${icon('bell')}提醒中心</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({
        label: '项目总数', value: kpi.projects, unit: '项', iconName: 'folder',
        foot: `在研 ${kpi.active} · 已完成 ${kpi.completed}`,
        delta: `<span class="kpi-delta neutral">完成率 ${pct(kpi.completionRate)}</span>`
      })}
      ${kpiCard({
        label: '经费执行率', value: pct(kpi.fundRate), iconName: 'wallet', tone: 'tone-emerald',
        foot: `已支出 ${wan(kpi.spent)} / 批复 ${wan(kpi.approved)} 万元`,
        delta: `<span class="kpi-delta">${icon('trendingUp')}${wan(kpi.spent)} 万</span>`
      })}
      ${kpiCard({
        label: '材料按时率', value: pct(kpi.onTimeRate), iconName: 'checkCircle', tone: 'tone-cyan',
        foot: `${kpi.onTimeMaterials} / ${kpi.dueMaterials} 已到期必备材料`,
        delta: `<span class="kpi-delta ${kpi.onTimeRate < 70 ? 'down' : ''}">${kpi.onTimeRate >= 80 ? '表现良好' : '需关注'}</span>`
      })}
      ${kpiCard({
        label: '逾期事项', value: kpi.overdue, unit: '项', iconName: 'bell', tone: 'tone-rose',
        foot: `材料 ${alertSummary.overdueMaterials} · 报表 ${alertSummary.overdueQuarterly} · 30天内 ${alertSummary.upcoming}`,
        delta: `<span class="kpi-delta ${kpi.overdue ? 'down' : ''}">${kpi.overdue ? '待补传补报' : '无逾期'}</span>`
      })}
    </div>

    <div class="grid split-7-5" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('trendingUp')}研发经费投入趋势</div>
            <div class="card-sub">近 12 个月经费支出（万元）</div>
          </div>
          <span class="pill tone-indigo">${icon('wallet', 'ic-sm')}累计支出 ${wan(kpi.spent)} 万元</span>
        </div>
        <div class="card-body" style="padding-top:8px">
          ${areaChartHTML(monthly, { valueKey: 'amount', height: 214 })}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('pie')}项目状态分布</div>
            <div class="card-sub">按项目当前状态统计</div>
          </div>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;align-items:center;gap:8px">
          ${donutHTML(statusData, {
            size: 168,
            centerValue: `${kpi.projects}`,
            centerLabel: '项目总数'
          })}
          ${legendHTML(statusLegend)}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('building')}部门项目与经费</div>
            <div class="card-sub">按批复经费排序，单位万元</div>
          </div>
        </div>
        <div class="card-body">
          ${byDept.length ? barRowsHTML(byDept.slice(0, 6).map((d) => ({
            label: d.name,
            value: d.fund,
            color: 'linear-gradient(90deg,#6366f1,#8b5cf6)'
          })), { valueFormat: (v) => `${wan(v)} 万` }) : emptyBlock({ title: '暂无部门数据' })}
          <div class="table-wrap" style="margin-top:14px">
            <table class="table" style="min-width:0">
              <thead><tr><th>部门</th><th class="right">项目</th><th class="right">批复</th><th class="right">支出</th><th class="right">执行率</th></tr></thead>
              <tbody>
                ${byDept.slice(0, 6).map((d) => `
                  <tr>
                    <td>${escapeHtml(d.name)}</td>
                    <td class="right num">${d.count}</td>
                    <td class="right num">${wan(d.fund)}</td>
                    <td class="right num">${wan(d.spent)}</td>
                    <td class="right num">${d.fund ? pct((d.spent / d.fund) * 100) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('layers')}材料归集进度</div>
            <div class="card-sub">按业务分类统计已归集材料占比</div>
          </div>
          <button class="link-btn" type="button" data-goto-category>分类台账 ${icon('arrowRight')}</button>
        </div>
        <div class="card-body">
          ${categories.map((cat) => `
            <div class="hbar-row" style="grid-template-columns:96px minmax(0,1fr) 74px">
              <div class="hbar-label">${escapeHtml(cat.name)}</div>
              <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(3, cat.rate)}%;background:${cat.overdue ? 'linear-gradient(90deg,#fb7185,#f43f5e)' : 'linear-gradient(90deg,#818cf8,#a78bfa)'}"></div></div>
              <div class="hbar-value">${cat.done}/${cat.total} · ${cat.rate}%</div>
            </div>`).join('')}
          <div class="hint" style="margin-top:12px">采购、变更、检测、知识产权为选交材料，按实际发生归集；立项、验收、归档为必备材料，纳入逾期提醒。</div>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('bell')}待办提醒</div>
            <div class="card-sub">逾期材料、逾期报表与 30 天内到期事项</div>
          </div>
          <button class="link-btn" type="button" data-goto-alerts>全部 ${alertSummary.total + alertSummary.upcoming} 项 ${icon('arrowRight')}</button>
        </div>
        <div class="card-body" style="padding-top:6px">
          ${alerts.length ? alerts.slice(0, 5).map((item) => alertItem(item)).join('')
            : emptyBlock({ iconName: 'checkCircle', title: '当前没有逾期或临期事项', text: '材料与季度报表均在期限内。' })}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('target')}在研项目进度</div>
            <div class="card-sub">按整体进度排序，点击进入项目详情</div>
          </div>
          <button class="link-btn" type="button" data-goto-projects>项目台账 ${icon('arrowRight')}</button>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:13px">
          ${projects.length ? projects.map((project) => `
            <div class="row" data-project="${project.id}" style="cursor:pointer;gap:12px">
              <div class="grow">
                <div class="row-between" style="gap:8px">
                  <div class="truncate strong" style="font-size:12.5px">${escapeHtml(project.name)}</div>
                  ${project.requiredOverdue ? `<span class="tag tone-rose">逾期 ${project.requiredOverdue}</span>` : statusPill('project', project.status)}
                </div>
                <div class="progress-meta"><span>${escapeHtml(project.code)} · ${escapeHtml(project.managerName)}</span><span>${project.progress}%</span></div>
                <div class="progress"><div class="progress-bar" style="width:${project.progress}%"></div></div>
              </div>
              ${icon('chevronRight', 'ic-sm')}
            </div>`).join('')
            : emptyBlock({ iconName: 'folder', title: '暂无在研项目' })}
        </div>
      </div>
    </div>`;

  wrap.querySelector('[data-goto-alerts]')?.addEventListener('click', () => navigate('/alerts'));
  wrap.querySelectorAll('[data-goto-alerts]').forEach((el) => el.addEventListener('click', () => navigate('/alerts')));
  wrap.querySelector('[data-goto-category]')?.addEventListener('click', () => navigate('/categories/INITIATION'));
  wrap.querySelector('[data-goto-projects]')?.addEventListener('click', () => navigate('/projects'));
  wrap.querySelector('[data-new-project]')?.addEventListener('click', () => navigate('/projects?new=1'));
  wrap.querySelectorAll('[data-project]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/projects/${el.getAttribute('data-project')}`));
  });
  wrap.querySelectorAll('[data-goto-project]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-target');
      navigate(`/projects/${el.getAttribute('data-goto-project')}?open=${encodeURIComponent(target)}`);
    });
  });

  return wrap;
}
