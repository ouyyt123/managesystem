import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(rootDir) {
    this.root = rootDir;
    this.dataDir = path.join(rootDir, 'data');
    this.uploadDir = path.join(rootDir, 'uploads');
    this.file = path.join(this.dataDir, 'db.json');
    this.data = null;
    this.timer = null;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.uploadDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return false;
    }
    return true;
  }

  saveNow() {
    if (!this.data) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.saveNow(); } catch (error) { console.error('[store] 保存失败', error); }
    }, 200);
  }

  nextId(prefix) {
    this.data.meta.counters[prefix] = (this.data.meta.counters[prefix] || 0) + 1;
    return `${prefix}${this.data.meta.counters[prefix]}`;
  }

  log(entry) {
    const record = {
      id: this.nextId('lg'),
      at: new Date().toISOString(),
      ...entry
    };
    this.data.logs.unshift(record);
    if (this.data.logs.length > 3000) this.data.logs.length = 3000;
    return record;
  }
}

/** 生成一个可被阅读器打开的最小 PDF，用于演示附件下载 */
export function minimalPdf(lines) {
  const safe = (text) => String(text).replace(/[\\()]/g, (m) => `\\${m}`);
  const body = lines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 56 ${760 - index * 26} Td (${safe(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(body, 'utf8')} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function writeUpload(store, relativeDir, filename) {
  const dir = path.join(store.uploadDir, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, absolute: path.join(dir, filename), relative: path.posix.join(relativeDir.split(path.sep).join('/'), filename) };
}
