import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const PY_SCRIPT = path.join(TOOLS, 'ocr.py');
const PS_SCRIPT = path.join(TOOLS, 'ocr.ps1');

let cachedPython = null;

function pythonCandidates() {
  const home = process.env.USERPROFILE || os.homedir();
  const local = process.env.LOCALAPPDATA || '';
  return [
    process.env.OCR_PYTHON,
    path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
    local ? path.join(local, 'Programs', 'Python', 'Python312', 'python.exe') : null,
    local ? path.join(local, 'Programs', 'Python', 'Python311', 'python.exe') : null,
    'python',
    'py'
  ].filter(Boolean);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: ROOT,
      windowsHide: true,
      timeout: options.timeout || 120000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message || '').toString().trim().slice(0, 500) || error.message));
        return;
      }
      resolve({ stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' });
    });
  });
}

async function recognizeWithRapidOcr(imagePath, workDir) {
  const outputPath = path.join(workDir, `${path.basename(imagePath)}.ocr.json`);
  const candidates = cachedPython ? [cachedPython] : pythonCandidates();
  let lastError = null;
  for (const candidate of candidates) {
    if (candidate !== 'python' && candidate !== 'py' && !fs.existsSync(candidate)) continue;
    try {
      await run(candidate, [PY_SCRIPT, imagePath, outputPath]);
      const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (!payload.ok) throw new Error(payload.error || 'RapidOCR 识别失败');
      cachedPython = candidate;
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('未找到可用的 Python / RapidOCR 环境');
}

async function recognizeWithWindows(imagePath) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-ImagePath', imagePath], { timeout: 90000 });
  const cleaned = stdout.replace(/^\uFEFF/, '').trim();
  const payload = JSON.parse(cleaned);
  if (!payload.ok) throw new Error(payload.error || 'Windows OCR 识别失败');
  const items = [];
  for (const line of payload.lines || []) {
    const words = line.words || [];
    if (!words.length) continue;
    const xs = words.map((word) => Number(word.x) || 0);
    const ys = words.map((word) => Number(word.y) || 0);
    const rights = words.map((word) => (Number(word.x) || 0) + (Number(word.w) || 0));
    const bottoms = words.map((word) => (Number(word.y) || 0) + (Number(word.h) || 0));
    items.push({
      text: line.text,
      score: 0.6,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...rights) - Math.min(...xs),
      h: Math.max(...bottoms) - Math.min(...ys)
    });
  }
  return {
    ok: true,
    engine: 'windows-ocr',
    width: payload.width,
    height: payload.height,
    items,
    elapsed: 0
  };
}

export async function recognizeImage(imagePath, workDir) {
  let rapidError = null;
  try {
    const result = await recognizeWithRapidOcr(imagePath, workDir);
    return result;
  } catch (error) {
    rapidError = error;
  }
  try {
    const result = await recognizeWithWindows(imagePath);
    result.fallbackReason = `RapidOCR 不可用，已回退到 Windows OCR：${rapidError?.message || '未知原因'}`;
    return result;
  } catch (windowsError) {
    const message = `OCR 识别失败。RapidOCR：${rapidError?.message || '不可用'}；Windows OCR：${windowsError.message}`;
    throw new Error(message);
  }
}

/* ---------------- 文本与字段解析 ---------------- */

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .replace(/[（(]\s*元\s*[)）]/g, '元')
    .replace(/[，,]/g, ',')
    .trim();
}

function normalizeKeyword(value) {
  return normalizeText(value).replace(/[，,]/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let last = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      last = temp;
    }
  }
  return previous[b.length];
}

function prefixMatch(text, keyword) {
  if (!text || !keyword) return null;
  if (text.startsWith(keyword)) return { score: 1, length: keyword.length };
  const threshold = keyword.length >= 6 ? 2 : 1;
  const minLength = Math.max(2, keyword.length - 2);
  const maxLength = Math.min(text.length, keyword.length + 2);
  let best = null;
  for (let length = minLength; length <= maxLength; length += 1) {
    const candidate = text.slice(0, length);
    const distance = levenshtein(candidate, keyword);
    if (distance <= threshold) {
      const score = 0.92 - distance * 0.12 - Math.abs(length - keyword.length) * 0.04;
      if (!best || score > best.score) best = { score, length };
    }
  }
  return best;
}

function bestFieldLabel(text, fields) {
  let best = null;
  for (const field of fields) {
    if (!field.enabled || !field.ocrKeywords?.length) continue;
    for (const keyword of field.ocrKeywords) {
      const normalizedKeyword = normalizeKeyword(keyword);
      const match = prefixMatch(text, normalizedKeyword);
      if (!match) continue;
      if (!best || match.score > best.score || (match.score === best.score && normalizedKeyword.length > best.keyword.length)) {
        best = { field, keyword: normalizedKeyword, score: match.score, length: match.length };
      }
    }
  }
  return best;
}

function groupRows(items) {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const item of sorted) {
    const center = item.y + item.h / 2;
    let row = rows.find((candidate) => Math.abs(candidate.center - center) <= Math.max(9, Math.min(item.h, candidate.h) * 0.55));
    if (!row) {
      row = { center, h: item.h, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.center = row.items.reduce((sum, current) => sum + current.y + current.h / 2, 0) / row.items.length;
    row.h = Math.max(row.h, item.h);
  }
  rows.forEach((row) => row.items.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => a.center - b.center);
}

function cleanRawValue(value) {
  return String(value ?? '')
    .replace(/^[\s:：=|]+/, '')
    .replace(/[\s|]+$/, '')
    .trim();
}

function parseDateValue(raw) {
  if (!raw) return null;
  const text = String(raw)
    .replace(/[年月]/g, '-')
    .replace(/[．。·]/g, '.')
    .replace(/\//g, '-');
  let match = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (!match) {
    const compact = text.replace(/[^\d]/g, '');
    if (compact.length === 8) {
      match = [compact, compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8)];
    }
  }
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumberValue(raw) {
  if (!raw) return null;
  const text = String(raw)
    .replace(/[（(]\s*元\s*[)）]/g, '')
    .replace(/元/g, '')
    .replace(/[，,\s]/g, '')
    .replace(/[．。]/g, '.')
    .replace(/[^\d.\-]/g, '');
  if (!/\d/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function matchOption(raw, options) {
  if (!raw) return null;
  const target = normalizeText(raw);
  const normalized = (options || []).map((option) => ({ option, text: normalizeText(option) }));
  const exact = normalized.find((item) => item.text === target);
  if (exact) return exact.option;
  const contained = normalized.find((item) => target.includes(item.text) || item.text.includes(target));
  if (contained) return contained.option;
  const fuzzy = normalized.find((item) => Math.abs(item.text.length - target.length) <= 2 && levenshtein(item.text, target) <= 1);
  return fuzzy ? fuzzy.option : null;
}

function matchByName(raw, list, getName) {
  if (!raw) return null;
  const target = normalizeText(raw);
  const normalized = list.map((item) => ({ item, text: normalizeText(getName(item)) })).filter((entry) => entry.text);
  const exact = normalized.find((entry) => entry.text === target);
  if (exact) return exact.item;
  const contained = normalized.find((entry) => target.includes(entry.text) || entry.text.includes(target));
  if (contained) return contained.item;
  const fuzzy = normalized.find((entry) => Math.abs(entry.text.length - target.length) <= 2 && levenshtein(entry.text, target) <= 1);
  return fuzzy ? fuzzy.item : null;
}

function checkboxValue(raw) {
  const text = String(raw || '');
  if (/[√☑✓是已勾]/.test(text)) return true;
  return false;
}

function normalizeFieldValue(field, raw, context) {
  const cleaned = cleanRawValue(raw);
  const label = field.label;
  if (field.type === 'checkbox') {
    return { value: checkboxValue(cleaned), raw: cleaned, matched: true, label };
  }
  if (!cleaned) return null;

  if (field.type === 'date') {
    const value = parseDateValue(cleaned);
    if (!value) return { value: '', raw: cleaned, matched: false, label, warning: `${label} 的日期无法解析` };
    return { value, raw: cleaned, matched: true, label };
  }
  if (field.type === 'number') {
    const value = parseNumberValue(cleaned);
    if (value === null) return { value: '', raw: cleaned, matched: false, label, warning: `${label} 的数字无法解析` };
    return { value, raw: cleaned, matched: true, label };
  }
  if (field.type === 'select') {
    const value = matchOption(cleaned, field.options);
    if (!value) {
      return { value: '', raw: cleaned, matched: false, label, warning: `${label}「${cleaned}」不在可选范围内` };
    }
    return { value, raw: cleaned, matched: true, label };
  }
  if (field.type === 'department') {
    const department = matchByName(cleaned, context.departments, (item) => item.name);
    if (!department) return { value: '', raw: cleaned, matched: false, label, warning: `${label}「${cleaned}」未匹配到部门` };
    return { value: department.id, raw: cleaned, matched: true, label, display: department.name };
  }
  if (field.type === 'manager') {
    const user = matchByName(cleaned, context.users, (item) => item.name);
    if (!user) return { value: '', raw: cleaned, matched: false, label, warning: `${label}「${cleaned}」未匹配到人员` };
    return { value: user.id, raw: cleaned, matched: true, label, display: user.name };
  }
  if (field.type === 'status') {
    const map = { 立项准备: 'PLANNING', 在研: 'ACTIVE', 中期: 'MID_TERM', 结题: 'FINAL', 完成: 'COMPLETED', 终止: 'TERMINATED' };
    const key = Object.keys(map).find((item) => cleaned.includes(item));
    return key ? { value: map[key], raw: cleaned, matched: true, label } : { value: '', raw: cleaned, matched: false, label, warning: `${label}「${cleaned}」无法识别` };
  }

  let value = cleaned.replace(/\s+/g, '');
  if (field.key === 'erpCode') value = value.replace(/[\/\\]/g, '');
  return { value, raw: cleaned, matched: true, label };
}

export function extractProjectFields(ocr, { fields, departments = [], users = [] }) {
  const items = (ocr.items || [])
    .map((item) => ({
      text: String(item.text || ''),
      norm: normalizeText(item.text),
      score: Number(item.score) || 0,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      w: Number(item.w) || 0,
      h: Number(item.h) || 0
    }))
    .filter((item) => item.norm);
  const rows = groupRows(items);
  const results = {};
  const warnings = [];
  const rawLines = [];

  for (const row of rows) {
    const labels = [];
    for (const item of row.items) {
      const match = bestFieldLabel(item.norm, fields);
      if (match) labels.push({ ...match, item, remainder: item.norm.slice(match.length) });
    }
    if (!labels.length) continue;
    const labelItems = new Set(labels.map((label) => label.item));
    const claimed = new Set();
    labels.sort((a, b) => a.item.x - b.item.x);
    for (const label of labels) {
      let raw = cleanRawValue(label.remainder);
      // 标签单元格可能只剩单位“元”，视为空，继续找右侧单元格
      if (/^[（(]?元[)）]?$/.test(raw)) raw = '';
      if (!raw) {
        const next = row.items.find((candidate) => (
          !labelItems.has(candidate)
          && !claimed.has(candidate)
          && candidate.x > label.item.x + 3
          && candidate.x - (label.item.x + label.item.w) <= 180
        ));
        if (next) {
          raw = cleanRawValue(next.norm);
          claimed.add(next);
        }
      }
      if (!raw && label.field.type !== 'checkbox') continue;
      const normalized = normalizeFieldValue(label.field, raw, { departments, users });
      if (!normalized) continue;
      if (normalized.warning) {
        warnings.push({ key: label.field.key, label: label.field.label, raw: normalized.raw, message: normalized.warning });
      }
      if (normalized.value !== '' && normalized.value !== undefined) {
        results[label.field.key] = { ...normalized, score: Number(label.score.toFixed(2)) };
      }
      rawLines.push(`${label.field.label}: ${raw || '(空)'}`);
    }
  }

  // 成本控制额自动换算批复经费（万元）
  const cost = results.custom_cost_control;
  if (cost && typeof cost.value === 'number' && cost.value > 0 && !results.fundTotal) {
    results.fundTotal = {
      value: Math.round((cost.value / 10000) * 100) / 100,
      raw: `成本控制额 ${cost.value} 元`,
      matched: true,
      label: '批复经费（万元）',
      derived: true,
      score: cost.score
    };
  }

  return {
    fields: results,
    warnings,
    matchedCount: Object.keys(results).length,
    rawText: items.map((item) => item.text).join('\n')
  };
}

export function summarizeOcr(ocr) {
  return {
    engine: ocr.engine,
    fallbackReason: ocr.fallbackReason || '',
    width: ocr.width,
    height: ocr.height,
    elapsed: ocr.elapsed || 0,
    itemCount: (ocr.items || []).length
  };
}
