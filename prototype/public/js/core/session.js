const TOKEN_KEY = 'rms.token';
const USER_KEY = 'rms.user';

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const session = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: readUser(),
  alerts: null,
  alertsAt: 0,
  options: null,
  displayKey: ''
};

export function setSession(token, user) {
  session.token = token || '';
  session.user = user || null;
  session.alerts = null;
  session.alertsAt = 0;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setUser(user) {
  session.user = user;
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  session.token = '';
  session.user = null;
  session.alerts = null;
  session.alertsAt = 0;
  session.options = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return Boolean(session.token);
}

export function canManageTemplates() {
  return ['ADMIN', 'RESEARCH_MANAGER'].includes(session.user?.role);
}

export function canAdmin() {
  return session.user?.role === 'ADMIN';
}

export function canManageUsers() {
  return session.user?.role === 'ADMIN';
}

export function canSeeLogs() {
  return ['ADMIN', 'RESEARCH_MANAGER'].includes(session.user?.role);
}

export function isReadOnly() {
  return session.user?.role === 'VIEWER';
}

export function canWriteProject(project) {
  if (!session.user || !project) return false;
  if (isReadOnly()) return false;
  if (['ADMIN', 'RESEARCH_MANAGER'].includes(session.user.role)) return true;
  return session.user.role === 'PROJECT_MANAGER' && project.managerId === session.user.id;
}
