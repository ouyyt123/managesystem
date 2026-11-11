import { api } from './api.js';
import { session } from './session.js';

export async function loadOptions(force = false) {
  if (!session.options || force) {
    session.options = await api('/options');
    if (session.options.displayKey) session.displayKey = session.options.displayKey;
  }
  return session.options;
}

export async function loadAlerts(force = false) {
  const now = Date.now();
  if (!force && session.alerts && now - session.alertsAt < 20000) return session.alerts;
  const data = await api('/alerts');
  session.alerts = data;
  session.alertsAt = now;
  return data;
}

export function invalidateAlerts() {
  session.alerts = null;
  session.alertsAt = 0;
}

export function deptName(deptId) {
  const found = (session.options?.departments || []).find((d) => d.id === deptId);
  return found ? found.name : '—';
}

export function userName(id) {
  const found = (session.options?.users || []).find((u) => u.id === id);
  return found ? found.name : '—';
}

export function displayLink() {
  const key = session.displayKey || session.options?.displayKey || '';
  return key ? `/display?key=${encodeURIComponent(key)}` : '/display';
}
