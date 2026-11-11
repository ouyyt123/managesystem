import { clearSession, session } from './session.js';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function handleUnauthorized() {
  clearSession();
  if (location.pathname !== '/login') {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login?next=${next}`);
  }
}

export async function api(path, options = {}) {
  const { method = 'GET', body, signal, timeout = 30000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort());
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session.token) headers.Authorization = `Bearer ${session.token}`;
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = { message: `接口返回异常（HTTP ${response.status}）` };
    }
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      handleUnauthorized();
      throw new ApiError(payload?.message || '登录状态已失效，请重新登录', 401, 'UNAUTHORIZED');
    }
    if (!response.ok) {
      throw new ApiError(payload?.message || `请求失败（HTTP ${response.status}）`, response.status, payload?.code);
    }
    return payload?.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('请求超时，请检查服务是否正常运行', 0, 'TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function attachmentUrl(id, { inline = false } = {}) {
  const params = new URLSearchParams();
  if (inline) params.set('inline', '1');
  if (session.token) params.set('token', session.token);
  return `/api/attachments/${id}/download?${params.toString()}`;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(new ApiError('读取文件失败，请重试', 0, 'FILE_READ'));
    reader.readAsDataURL(file);
  });
}

export async function uploadFile(path, file, extra = {}) {
  const dataBase64 = await fileToBase64(file);
  return api(path, {
    method: 'POST',
    timeout: 120000,
    body: {
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      dataBase64,
      ...extra
    }
  });
}
