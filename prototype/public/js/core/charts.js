import { escapeHtml } from './format.js';

export const PALETTE = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];

function niceMax(value) {
  const v = Math.max(1, Number(value) || 1);
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const factor = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return factor * pow;
}

export function donutHTML(data, { size = 168, thickness = 18, centerValue = '', centerLabel = '', dark = false } = {}) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.map((item, index) => {
    const value = Number(item.value || 0);
    const length = total > 0 ? (value / total) * circumference : 0;
    const color = item.color || PALETTE[index % PALETTE.length];
    const seg = length > 0
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${thickness}"
          stroke-dasharray="${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}"
          stroke-dashoffset="${-offset}" stroke-linecap="round">
          <title>${escapeHtml(item.label)}：${value}</title>
        </circle>`
      : '';
    offset += length;
    return seg;
  }).join('');
  return `
    <div class="chart-wrap" style="width:${size}px;max-width:100%">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="max-width:100%">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${dark ? 'rgba(255,255,255,.07)' : '#f1f5fb'}" stroke-width="${thickness}"/>
        <g transform="rotate(-90 ${size / 2} ${size / 2})">${segments}</g>
      </svg>
      <div class="donut-center">
        <div class="donut-value" style="${dark ? 'color:#f1f5f9' : ''}">${centerValue}</div>
        <div class="donut-label">${escapeHtml(centerLabel)}</div>
      </div>
    </div>`;
}

export function legendHTML(items, { dark = false } = {}) {
  return `<div class="chart-legend">${items.map((item, index) => `
    <span class="legend-item"><span class="legend-dot" style="background:${item.color || PALETTE[index % PALETTE.length]}"></span>${escapeHtml(item.label)}</span>
  `).join('')}</div>`;
}

function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

export function areaChartHTML(data, options = {}) {
  const {
    height = 210, color = '#6366f1', dark = false, valueKey = 'amount',
    labelKey = 'label', unit = '万元', showDots = true, maxTicks = 4
  } = options;
  const width = 780;
  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const values = data.map((d) => Number(d[valueKey] || 0));
  const max = niceMax(Math.max(...values, 1));
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (index) => padL + index * step;
  const y = (value) => padT + innerH * (1 - value / max);
  const points = data.map((d, index) => [x(index), y(Number(d[valueKey] || 0))]);
  const line = smoothPath(points);
  const area = `${line} L ${x(data.length - 1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`;

  const gridColor = dark ? 'rgba(255,255,255,.07)' : '#eef2f8';
  const textColor = dark ? 'rgba(148,163,184,.72)' : '#94a1b5';
  const ticks = Array.from({ length: maxTicks + 1 }, (_, i) => (max / maxTicks) * i);
  const labelEvery = data.length > 8 ? 2 : 1;
  const gradientId = `grad-${Math.random().toString(36).slice(2, 8)}`;

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="趋势图">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="${dark ? '.32' : '.22'}"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${ticks.map((tick) => `
        <line x1="${padL}" y1="${y(tick)}" x2="${width - padR}" y2="${y(tick)}" stroke="${gridColor}" stroke-dasharray="3 4"/>
        <text x="${padL - 9}" y="${y(tick) + 3.5}" text-anchor="end" font-size="9.5" fill="${textColor}">${Math.round(tick)}</text>
      `).join('')}
      <path d="${area}" fill="url(#${gradientId})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map(([px, py], index) => (showDots && (index % labelEvery === 0 || index === points.length - 1)
        ? `<circle cx="${px}" cy="${py}" r="3.4" fill="${dark ? '#0b1224' : '#fff'}" stroke="${color}" stroke-width="2"><title>${escapeHtml(String(data[index][labelKey]))}：${data[index][valueKey]} ${unit}</title></circle>`
        : '')).join('')}
      ${data.map((d, index) => (index % labelEvery === 0 || index === data.length - 1
        ? `<text x="${x(index)}" y="${height - 8}" text-anchor="middle" font-size="9.5" fill="${textColor}">${escapeHtml(String(d[labelKey]))}</text>`
        : '')).join('')}
    </svg>`;
}

export function sparklineHTML(values, { width = 96, height = 30, color = '#6366f1', fill = true } = {}) {
  const nums = values.map((v) => Number(v || 0));
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const step = nums.length > 1 ? width / (nums.length - 1) : width;
  const points = nums.map((v, i) => [i * step, height - 3 - ((v - min) / (max - min || 1)) * (height - 8)]);
  const line = smoothPath(points);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const id = `sp-${Math.random().toString(36).slice(2, 8)}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".22"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${fill ? `<path d="${area}" fill="url(#${id})"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

export function barRowsHTML(rows, { max, valueFormat = (v) => v, color = 'linear-gradient(90deg,#818cf8,#a78bfa)' } = {}) {
  const peak = max || Math.max(...rows.map((r) => Number(r.value || 0)), 1);
  return rows.map((row) => `
    <div class="hbar-row">
      <div class="hbar-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(4, (Number(row.value || 0) / peak) * 100)}%;background:${row.color || color}"></div></div>
      <div class="hbar-value">${valueFormat(row.value)}</div>
    </div>`).join('');
}
