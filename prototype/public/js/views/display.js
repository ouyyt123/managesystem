import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { escapeHtml, num, wan, pct, CATEGORIES } from '../core/format.js';
import { areaChartHTML } from '../core/charts.js';

const KEY_STORAGE = 'rms.displayKey';

function kpi(label, value, unit = '', foot = '') {
  return `
    <div class="display-kpi">
      <div class="lbl">${label}</div>
      <div class="val">${value}${unit ? `<small>${unit}</small>` : ''}</div>
      <div class="foot">${foot}</div>
    </div>`;
}

function dateLine(date) {
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${week}`;
}

export async function render({ query, navigate }) {
  const root = document.createElement('div');
  const state = {
    key: query.key || localStorage.getItem(KEY_STORAGE) || '',
    data: null,
    seconds: 60,
    timer: null,
    clockTimer: null
  };

  async function fetchData() {
    if (!state.key) throw Object.assign(new Error('请输入展示访问码'), { status: 401 });
    return api(`/display?key=${encodeURIComponent(state.key)}`);
  }

  function stopTimers() {
    clearInterval(state.timer);
    clearInterval(state.clockTimer);
    state.timer = null;
    state.clockTimer = null;
  }

  function gate(message = '') {
    stopTimers();
    root.innerHTML = `
      <div class="key-gate">
        <form class="key-card" id="key-form">
          <div class="row gap-8" style="margin-bottom:12px">
            <div class="brand-mark">${icon('monitor', 'ic-lg')}</div>
            <div>
              <div style="font-size:10.5px;letter-spacing:.18em;color:rgba(148,163,184,.7);font-weight:600">DISPLAY ACCESS</div>
              <div style="font-size:12px;color:#e2e8f0">科研项目展示大屏</div>
            </div>
          </div>
          <h2>输入访问码</h2>
          <p>大屏为只读页面，用于办公室门口展示项目数量、经费投入、材料归集与验收进展。访问码由系统管理员配置。</p>
          <input class="input" type="password" id="key-input" placeholder="请输入展示访问码" value="${escapeHtml(state.key)}" autocomplete="off" />
          <button class="btn btn-primary" type="submit" id="key-submit">进入大屏 ${icon('arrowRight')}</button>
          ${message ? `<div class="key-error">${escapeHtml(message)}</div>` : ''}
          <div class="hint" style="margin-top:14px;color:rgba(148,163,184,.55)">演示访问码：research2026</div>
        </form>
      </div>`;
    const form = root.querySelector('#key-form');
    const input = root.querySelector('#key-input');
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      const button = root.querySelector('#key-submit');
      button.disabled = true;
      button.innerHTML = '<span class="spinner light" style="width:14px;height:14px"></span>校验中…';
      state.key = value;
      try {
        state.data = await fetchData();
        localStorage.setItem(KEY_STORAGE, value);
        const url = new URL(location.href);
        url.searchParams.set('key', value);
        history.replaceState({}, '', url.pathname + url.search);
        paint();
      } catch (error) {
        state.key = '';
        gate(error.message || '访问码不正确');
      }
    });
  }

  function paint() {
    const data = state.data;
    if (!data) return;
    const k = data.kpi;
    root.innerHTML = `
      <div class="display">
        <header class="display-header">
          <div class="brand-mark">${icon('layers', 'ic-lg')}</div>
          <div>
            <div class="display-title">科研项目材料管理 · 运行大屏</div>
            <div class="display-sub">RESEARCH PROJECT MATERIAL HUB</div>
          </div>
          <span class="display-live"><span class="dot"></span>实时数据 · ${state.seconds} 秒后刷新</span>
          <div class="display-clock">
            <div class="time" id="display-clock-time">--:--:--</div>
            <div class="date" id="display-clock-date"></div>
          </div>
          <div class="display-tools">
            <button class="display-tool" type="button" title="全屏" data-fullscreen>${icon('maximize')}</button>
            <button class="display-tool" type="button" title="立即刷新" data-refresh>${icon('refresh')}</button>
            <button class="display-tool" type="button" title="返回工作台" data-exit>${icon('minimize')}</button>
          </div>
        </header>

        <div class="display-kpis">
          ${kpi('项目总数', k.projects, '项', '全部未删除项目')}
          ${kpi('在研项目', k.active, '项', '含中期与结题验收')}
          ${kpi('已完成', k.completed, '项', `完成率 ${pct(k.projects ? (k.completed / k.projects) * 100 : 0)}`)}
          ${kpi('验收待办', k.acceptanceTodo, '项', '验收材料未齐')}
          ${kpi('累计研发投入', wan(k.spent), '万元', '按经费台账累计')}
          ${kpi('经费执行率', pct(k.fundRate), '', '累计支出 / 批复经费')}
          ${kpi('材料按时率', pct(k.onTimeRate), '', '已到期必备材料')}
          ${kpi('知识产权归集', k.ipProjects, '项', '已有知识产权证明')}
        </div>

        <div class="display-grid">
          <div class="display-col">
            <div class="display-card" style="flex:1.15">
              <div class="display-card-title">
                <span class="row gap-8">${icon('trendingUp')}本年度研发投入趋势</span>
                <span class="tag">月度投入 / 累计投入（万元）</span>
              </div>
              <div style="flex:1;min-height:0">
                ${areaChartHTML(data.monthly, { valueKey: 'amount', dark: true, color: '#818cf8', height: 236 })}
              </div>
            </div>

            <div class="display-card">
              <div class="display-card-title"><span class="row gap-8">${icon('layers')}项目节点</span><span class="tag">按模板周期比例</span></div>
              <div class="display-stages">
                ${data.stages.map((stage, index) => `
                  ${index ? `<span class="display-arrow">${icon('chevronRight')}</span>` : ''}
                  <div class="display-stage">
                    <div class="n">${escapeHtml(stage.name)}</div>
                    <div class="r">${escapeHtml(stage.ratio)}</div>
                    <div class="d">${escapeHtml(stage.sampleEnd || '')}</div>
                  </div>`).join('')}
              </div>
            </div>

            <div class="display-card" style="flex:1">
              <div class="display-card-title"><span class="row gap-8">${icon('checkSquare')}项目验收结果</span><span class="tag">验收材料完成度</span></div>
              <div class="display-scroll">
                <table class="display-table">
                  <thead><tr><th>项目编号</th><th>项目名称</th><th>周期</th><th>验收材料</th><th>状态</th></tr></thead>
                  <tbody>
                    ${data.acceptanceProjects.map((item) => `
                      <tr>
                        <td class="mono">${escapeHtml(item.code)}</td>
                        <td class="pname">${escapeHtml(item.name)}</td>
                        <td>${item.startDate.slice(2, 7)} → ${item.endDate.slice(2, 7)}</td>
                        <td>${item.done}/${item.total}</td>
                        <td><span class="display-badge ${item.done >= item.total ? '' : item.done ? 'warn' : 'bad'}">${escapeHtml(item.statusName)}</span></td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="display-col">
            <div class="display-card">
              <div class="display-card-title"><span class="row gap-8">${icon('pie')}材料归集分布</span><span class="tag">已归集 / 应归集</span></div>
              <div style="display:flex;flex-direction:column;gap:11px;margin-top:2px">
                ${data.categoryDist.map((item) => {
                  const cat = CATEGORIES[item.code] || { name: item.code };
                  return `
                    <div>
                      <div style="display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:4px">
                        <span style="color:#cbd5e1">${escapeHtml(cat.name)}</span>
                        <span style="color:rgba(148,163,184,.8)">${item.done}/${item.total} · ${item.rate}%</span>
                      </div>
                      <div style="height:6px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden">
                        <div style="height:100%;width:${item.rate}%;border-radius:99px;background:linear-gradient(90deg,#6366f1,#22d3ee)"></div>
                      </div>
                    </div>`;
                }).join('')}
              </div>
            </div>

            <div class="display-card" style="flex:1">
              <div class="display-card-title">
                <span class="row gap-8">${icon('bell')}逾期待办</span>
                <span class="tag">${data.alertSummary.total} 项逾期 · ${data.alertSummary.upcoming} 项临期</span>
              </div>
              <div class="display-scroll">
                ${data.alerts.length ? data.alerts.map((item) => `
                  <div class="display-alert">
                    <span style="color:${item.status === 'OVERDUE' ? '#fda4af' : '#fcd34d'};margin-top:1px">${icon(item.status === 'OVERDUE' ? 'alertTriangle' : 'clock', 'ic-sm')}</span>
                    <div>
                      <div class="t">${escapeHtml(item.title)}</div>
                      <div class="s">${escapeHtml(item.projectCode)} · ${escapeHtml(item.projectName)} · 截止 ${item.dueDate.slice(5)}</div>
                    </div>
                    <span class="d">${item.status === 'OVERDUE' ? `逾期 ${item.overdueDays} 天` : `${item.daysLeft} 天`}</span>
                  </div>`).join('') : '<div class="empty-text" style="padding:20px 0;text-align:center;color:rgba(148,163,184,.6)">当前没有逾期事项</div>'}
              </div>
            </div>
          </div>
        </div>

        <footer class="display-footer">
          <span>数据更新时间 ${new Date(data.generatedAt).toLocaleString('zh-CN')}</span>
          <span>·</span>
          <span>60 秒自动刷新 · 只读页面</span>
          <span class="display-tools">
            <span class="tag">访问码已校验</span>
          </span>
        </footer>
      </div>`;

    root.querySelector('[data-fullscreen]')?.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => null);
    });
    root.querySelector('[data-refresh]')?.addEventListener('click', () => refresh(true));
    root.querySelector('[data-exit]')?.addEventListener('click', () => navigate('/'));

    if (root.isConnected) startClock();
    else setTimeout(() => { if (root.isConnected) startClock(); }, 30);
  }

  function startClock() {
    const tick = () => {
      if (!root.isConnected) { clearInterval(state.clockTimer); return; }
      const timeEl = root.querySelector('#display-clock-time');
      const dateEl = root.querySelector('#display-clock-date');
      if (timeEl) {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
        dateEl.textContent = dateLine(now);
      }
      const live = root.querySelector('.display-live');
      if (live) live.innerHTML = `<span class="dot"></span>实时数据 · ${Math.max(0, state.seconds)} 秒后刷新`;
      state.seconds -= 1;
      if (state.seconds <= 0) refresh(false);
    };
    stopTimers();
    state.clockTimer = setInterval(tick, 1000);
    tick();
  }

  async function refresh(manual) {
    if (!state.key) return;
    try {
      const next = await fetchData();
      const changed = JSON.stringify(next) !== JSON.stringify(state.data);
      state.data = next;
      state.seconds = 60;
      if (changed) paint();
      else if (manual) {
        const live = root.querySelector('.display-live');
        if (live) live.innerHTML = '<span class="dot"></span>实时数据 · 60 秒后刷新';
      }
    } catch (error) {
      if (error.status === 403) gate(error.message || '访问码不正确');
      else state.seconds = 60;
    }
  }

  try {
    if (!state.key) {
      gate();
    } else {
      state.data = await fetchData();
      localStorage.setItem(KEY_STORAGE, state.key);
      paint();
    }
  } catch (error) {
    state.key = error.status === 403 ? '' : state.key;
    gate(error.status === 403 ? (error.message || '访问码不正确，无法打开展示大屏') : `大屏加载失败：${error.message}`);
  }

  return root;
}
