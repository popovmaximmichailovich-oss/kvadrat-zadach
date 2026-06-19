const APP_VERSION = '2.12.3';
const STORAGE_KEY = 'eisenhower_tasks_v1';
const WORKLOGS_KEY = 'eisenhower_worklogs_v1';
const PROJECTS_KEY = 'eisenhower_projects_v1';
const PROJECT_MEMBERS_KEY = 'eisenhower_project_members_v1';
const PROMISES_KEY = 'eisenhower_promises_v1';
const DECISIONS_KEY = 'eisenhower_decisions_v1';
const TEMPLATES_KEY = 'eisenhower_templates_v1';
const DOCS_KEY = 'eisenhower_project_docs_v1';
const ADMIN_USERS_KEY = 'eisenhower_admin_users_v1';
const SETTINGS_KEY = 'eisenhower_tasks_settings_v1';
const DIRTY_TASKS_KEY = 'kvadrat_zadach_dirty_tasks_v1';
const APP_ERROR_LOG_KEY = 'kvadrat_zadach_app_errors_v1';
const OTP_LAST_REQUEST_KEY = 'kvadrat_zadach_otp_last_request_at';
const SYNC_AUDIT_KEY = 'kvadrat_zadach_sync_audit_v1';
const DEFAULT_SUPABASE_URL = 'https://bgoplepnfzprnagandsw.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_96Juj1RHnPzgZS_ZF1OxWA_0LCjE61o';
const PERSONAL_MODE_TEXT = 'Личное пространство: другие пользователи не видят ваши проекты и задачи.';

const statusLabels = {
  inbox: 'Входящие', planned: 'Запланировано', doing: 'В работе', delegated: 'Делегировано', deferred: 'Отложено', done: 'Выполнено'
};
const priorityLabels = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
const bucketLabels = { none: 'Без 1–3–5', one: '1 главная', three: '3 важные', five: '5 мелких' };
const workMarkLabels = { 'Я': 'Явка', 'В': 'Выходной', 'Б': 'Больничный', 'ОТ': 'Отпуск', 'НН': 'Неявка' };
const projectStatusLabels = { active: 'Активный', paused: 'Пауза', archived: 'Архив' };

let settings = loadSettings();
let projects = loadProjects();
let projectMembers = loadProjectMembers();
let promises = loadPromises();
let decisions = loadDecisions();
let taskTemplates = loadTaskTemplates();
let projectDocs = loadProjectDocs();
let adminUsers = loadAdminUsers();
let tasks = loadTasks();
let workLogs = loadWorkLogs();
let currentView = 'commander';
let deferredPrompt = null;
let autoSyncTimer = null;
let syncInProgress = false;
let autoTaskSyncTimer = null;
let autoPullTimer = null;
let lastAutoSyncReason = '';
let dirtyTaskIds = loadDirtyTaskIds();
let autoSyncRetryCount = 0;
let taskCloudBusy = false;
let otpRequestInProgress = false;
let queuedTaskSync = null;
let lastSyncStartedAt = 0;
let supabaseClientInstance = null;
let supabaseClientKey = '';
let selectedQuickProjectId = '';
let syncState = { text: 'синхронизация не запускалась', tone: 'idle' };
let syncDiagnostics = { userId: '', email: '', localTasks: 0, remoteTasks: null, remoteProjects: null, lastError: '', lastCheckedAt: '', lastPushAt: '', lastPullAt: '', lastLocalTask: '', lastCloudTask: '', lastCloudTaskAt: '' };

const SYNC_LAB_PREFIX = 'SYNC LAB /';
let syncLabState = {
  rows: [],
  activeRows: [],
  deletedRows: [],
  selectedId: '',
  message: 'Тест ещё не запускался.',
  tone: 'warn',
  lastActionAt: ''
};

let syncLabDebug = {
  appVersion: '',
  email: '',
  userId: '',
  sessionUserId: '',
  authError: '',
  lastPayload: null,
  lastResponse: null,
  lastError: '',
  lastStatus: '',
  lastAnyRows: [],
  readByIdInput: '',
  readByIdResult: null,
  readByIdError: '',
  readByIdStatus: '',
  lastAt: ''
};



const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const nowISO = () => new Date().toISOString();



function recordAppError(source, error) {
  const msg = String(error?.message || error || 'Неизвестная ошибка');
  const item = { at: new Date().toISOString(), source: String(source || 'app'), message: msg };
  try {
    const list = JSON.parse(localStorage.getItem(APP_ERROR_LOG_KEY) || '[]');
    const next = [item, ...(Array.isArray(list) ? list : [])].slice(0, 20);
    localStorage.setItem(APP_ERROR_LOG_KEY, JSON.stringify(next));
  } catch {}
  syncDiagnostics.lastError = `${item.source}: ${item.message}`;
}
function lastAppErrorText() {
  try {
    const list = JSON.parse(localStorage.getItem(APP_ERROR_LOG_KEY) || '[]');
    const item = Array.isArray(list) ? list[0] : null;
    if (!item) return '';
    return `${new Date(item.at).toLocaleString('ru-RU')} · ${item.source}: ${item.message}`;
  } catch { return ''; }
}
function clearAppErrors() {
  localStorage.removeItem(APP_ERROR_LOG_KEY);
  syncDiagnostics.lastError = '';
  render();
}
function installGlobalErrorHandlers() {
  if (window.__kvadratErrorHandlersInstalled) return;
  window.__kvadratErrorHandlersInstalled = true;
  window.addEventListener('error', (event) => {
    recordAppError('ошибка приложения', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordAppError('ошибка фоновой операции', event.reason || 'Promise rejected');
  });
}
function otpCooldownSeconds() {
  const last = Number(localStorage.getItem(OTP_LAST_REQUEST_KEY) || 0);
  if (!last) return 0;
  const left = 60 - Math.floor((Date.now() - last) / 1000);
  return Math.max(0, left);
}
function markOtpRequestedNow() {
  localStorage.setItem(OTP_LAST_REQUEST_KEY, String(Date.now()));
}
function setButtonBusy(id, busy, textBusy='Подождите…') {
  const btn = $(id);
  if (!btn) return;
  if (busy) {
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.disabled = true;
    btn.textContent = textBusy;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}
function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
function newCloudId() {
  return crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2,14).padEnd(12,'0');
}
function projectIdExistsLocally(id) {
  return Boolean(id && projects.some(p => p.id === id && !p.deletedAt));
}
function ensureTaskCloudReady(taskId) {
  const index = tasks.findIndex(t => t.id === taskId);
  if (index < 0) return '';
  let t = normalizeTask(tasks[index]);
  let changed = false;
  if (!isUuidLike(t.id)) {
    const oldId = t.id;
    t = normalizeTask({ ...t, id: newCloudId(), updatedAt: nowISO() });
    dirtyTaskIds.delete(oldId);
    dirtyTaskIds.add(t.id);
    changed = true;
  }
  if (t.projectId && (!isUuidLike(t.projectId) || !projectIdExistsLocally(t.projectId))) {
    t = normalizeTask({ ...t, project: projectName(t.projectId, t.project), projectId: '', updatedAt: nowISO() });
    changed = true;
  }
  if (changed) {
    tasks[index] = t;
    saveDirtyTaskIds();
    persistAll({ renderNow:false, sync:false });
  }
  return t.id;
}
function taskToSafeRow(t, userId) {
  const n = normalizeTask(t);
  const row = taskToRow(n, userId);
  if (row.project_id && (!isUuidLike(row.project_id) || !projectIdExistsLocally(row.project_id))) row.project_id = null;
  if (!isUuidLike(row.id)) row.id = newCloudId();
  return row;
}
async function upsertProjectDependencies(client, userId) {
  const ids = new Set(tasks.map(t => t.projectId).filter(id => id && isUuidLike(id)));
  const related = projects.filter(p => ids.has(p.id) && !p.deletedAt && isUuidLike(p.id)).map(p => projectToRow(normalizeProject(p), userId));
  if (!related.length) return true;
  const { error } = await client.from('projects').upsert(related, { onConflict:'id' });
  if (error) throw error;
  return true;
}
function queueTaskSync(fn) {
  queuedTaskSync = (queuedTaskSync || Promise.resolve()).then(fn, fn);
  return queuedTaskSync.finally(() => {
    if (queuedTaskSync) queuedTaskSync = null;
  });
}

function loadDirtyTaskIds() {
  try {
    const arr = JSON.parse(localStorage.getItem(DIRTY_TASKS_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
  } catch { return new Set(); }
}
function saveDirtyTaskIds() {
  localStorage.setItem(DIRTY_TASKS_KEY, JSON.stringify([...dirtyTaskIds]));
}
function markTaskDirty(id) {
  if (!id) return;
  dirtyTaskIds.add(id);
  saveDirtyTaskIds();
  updateAutoSyncUi(`ожидает отправки задач: ${dirtyTaskIds.size}`, 'warn');
}
function markAllTasksDirty() {
  activeTasks().forEach(t => dirtyTaskIds.add(t.id));
  saveDirtyTaskIds();
}
function clearDirtyTasks() {
  dirtyTaskIds.clear();
  saveDirtyTaskIds();
}
function dirtyTaskCount() {
  return dirtyTaskIds.size;
}
function localTaskById(id) {
  return tasks.find(t => t.id === id);
}
async function cloudHasTask(client, id) {
  if (!id) return false;
  const { data, error } = await client.from('tasks').select('id,updated_at,title').eq('id', id).maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

function loadArray(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function loadTasks() { return loadArray(STORAGE_KEY); }
function loadProjects() { return loadArray(PROJECTS_KEY); }
function loadProjectMembers() { return loadArray(PROJECT_MEMBERS_KEY); }
function loadPromises() { return loadArray(PROMISES_KEY); }
function loadDecisions() { return loadArray(DECISIONS_KEY); }
function loadTaskTemplates() { return loadArray(TEMPLATES_KEY); }
function loadProjectDocs() { return loadArray(DOCS_KEY); }
function loadAdminUsers() { return loadArray(ADMIN_USERS_KEY); }
function loadWorkLogs() { return loadArray(WORKLOGS_KEY); }

function defaultVisibleViews() {
  return ['commander','today','pmcontrol','tomorrow','week','projects','kanban','inbox','stuck','delegate','noproject','promises','decisions','evening','searchall','timesheet','archive','settings','about'];
}
function defaultDashboardWidgets() {
  return ['health','timeline','alerts','progress','workload','documents','calendar','team'];
}
const viewLabels = {
  commander:'День', today:'Сегодня', tomorrow:'Завтра', week:'Неделя', pmcontrol:'Управление', dashboard:'Дашборд', report:'Отчёт недели', inbox:'Разбор', stuck:'Зависло', delegate:'Делегировать', noproject:'Без проекта', matrix:'Эйзенхауэр', kanban:'Канбан', projects:'Проекты', promises:'Обещания', decisions:'Решения', templates:'Шаблоны', evening:'Вечер', searchall:'Поиск', timesheet:'Табель', archive:'Архив', settings:'Синхронизация', admin:'Панель администратора', about:'О приложении'
};
const widgetLabels = {
  health:'Здоровье проектов', timeline:'Сроки / Гант', alerts:'Маркеры риска', progress:'Динамика выполнения', workload:'Загрузка', documents:'Документы', calendar:'Календарь iPhone', team:'3 пользователя'
};
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      fio: s.fio || '',
      position: s.position || '',
      department: s.department || '',
      institution: s.institution || '',
      defaultHours: (s.defaultHours === '' || s.defaultHours === undefined || s.defaultHours === null) ? '' : Number(s.defaultHours),
      quickProjects: Array.isArray(s.quickProjects) ? s.quickProjects : [],
      timesheetProjectId: s.timesheetProjectId || s.timesheetProject || 'all',
      autoSync: s.autoSync !== false,
      lastBackupAt: s.lastBackupAt || '',
      autoArchiveDays: Number(s.autoArchiveDays || 90),
      supabaseUrl: s.supabaseUrl || DEFAULT_SUPABASE_URL,
      supabaseAnonKey: s.supabaseAnonKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
      email: s.email || '',
      kanbanMode: s.kanbanMode || 'compact',
      visibleViews: Array.isArray(s.visibleViews) && s.visibleViews.length ? s.visibleViews : defaultVisibleViews(),
      dashboardWidgets: Array.isArray(s.dashboardWidgets) && s.dashboardWidgets.length ? s.dashboardWidgets : defaultDashboardWidgets(),
      alertDays: Number(s.alertDays || 3),
      projectOverloadLimit: Number(s.projectOverloadLimit || 20),
      calendarHorizonDays: Number(s.calendarHorizonDays || 90),
      adminMode: s.adminMode === true
    };
  } catch {
    return { fio: '', position: '', institution: '', department: '', defaultHours: '', quickProjects: [], timesheetProjectId: 'all', autoSync: true, autoArchiveDays: 90, kanbanMode: 'compact', visibleViews: defaultVisibleViews(), dashboardWidgets: defaultDashboardWidgets(), alertDays: 3, projectOverloadLimit: 20, calendarHorizonDays: 90, adminMode: false, supabaseUrl: DEFAULT_SUPABASE_URL, supabaseAnonKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY };
  }
}
function persistAll({ renderNow = true, sync = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(WORKLOGS_KEY, JSON.stringify(workLogs));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  localStorage.setItem(PROJECT_MEMBERS_KEY, JSON.stringify(projectMembers));
  localStorage.setItem(PROMISES_KEY, JSON.stringify(promises));
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions));
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(taskTemplates));
  localStorage.setItem(DOCS_KEY, JSON.stringify(projectDocs));
  localStorage.setItem(ADMIN_USERS_KEY, JSON.stringify(adminUsers));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (renderNow) render();
  if (sync) scheduleAutoSync();
}
function saveSettings({ renderNow = false } = {}) { persistAll({ renderNow, sync: false }); }
function saveTasks() { persistAll({ renderNow: true, sync: true }); }
function saveProjects() { persistAll({ renderNow: true, sync: true }); }
function saveWorkLogs() { persistAll({ renderNow: true, sync: true }); }

function normalizeProject(p) {
  const name = String(p.name || p.project || '').trim();
  return {
    id: p.id || uid(),
    name: name || 'Без названия',
    code: (p.code || '').trim(),
    status: p.status || 'active',
    owner: (p.owner || '').trim(),
    customer: (p.customer || '').trim(),
    stage: (p.stage || '').trim(),
    startDate: p.startDate || p.start_date || '',
    dueDate: p.dueDate || p.due_date || '',
    result: p.result || '',
    nextAction: p.nextAction || p.next_action || '',
    description: p.description || '',
    note: p.note || '',
    color: p.color || 'orange',
    createdAt: p.createdAt || p.created_at || nowISO(),
    updatedAt: p.updatedAt || p.updated_at || nowISO(),
    deletedAt: p.deletedAt || p.deleted_at || null
  };
}
function normalizeProjectMember(m) {
  return {
    id: m.id || uid(),
    projectId: m.projectId || m.project_id || '',
    name: String(m.name || '').trim() || 'Без имени',
    role: String(m.role || 'Участник').trim(),
    email: String(m.email || '').trim(),
    note: m.note || '',
    createdAt: m.createdAt || m.created_at || nowISO(),
    updatedAt: m.updatedAt || m.updated_at || nowISO(),
    deletedAt: m.deletedAt || m.deleted_at || null
  };
}
function normalizePromise(p) {
  return {
    id: p.id || uid(),
    projectId: p.projectId || p.project_id || '',
    direction: p.direction || 'to_me',
    who: String(p.who || '').trim(),
    text: String(p.text || '').trim(),
    promisedDate: p.promisedDate || p.promised_date || today(),
    checkDate: p.checkDate || p.check_date || '',
    status: p.status || 'open',
    note: p.note || '',
    createdAt: p.createdAt || p.created_at || nowISO(),
    updatedAt: p.updatedAt || p.updated_at || nowISO(),
    deletedAt: p.deletedAt || p.deleted_at || null
  };
}
function normalizeDecision(d) {
  return {
    id: d.id || uid(),
    projectId: d.projectId || d.project_id || '',
    date: d.date || d.decision_date || today(),
    title: String(d.title || '').trim() || 'Решение',
    text: d.text || '',
    owner: d.owner || '',
    impact: d.impact || '',
    nextAction: d.nextAction || d.next_action || '',
    createdAt: d.createdAt || d.created_at || nowISO(),
    updatedAt: d.updatedAt || d.updated_at || nowISO(),
    deletedAt: d.deletedAt || d.deleted_at || null
  };
}
function normalizeTaskTemplate(t) {
  return {
    id: t.id || uid(),
    name: String(t.name || '').trim() || 'Шаблон',
    title: t.title || '',
    projectId: t.projectId || t.project_id || '',
    status: t.status || 'inbox',
    priority: t.priority || 'C',
    importance: t.importance || 'low',
    urgency: t.urgency || 'low',
    dayBucket: t.dayBucket || t.day_bucket || 'none',
    note: t.note || '',
    createdAt: t.createdAt || t.created_at || nowISO(),
    updatedAt: t.updatedAt || t.updated_at || nowISO(),
    deletedAt: t.deletedAt || t.deleted_at || null
  };
}
function normalizeProjectDoc(d) {
  return {
    id: d.id || uid(),
    projectId: d.projectId || d.project_id || '',
    title: String(d.title || '').trim() || 'Документ',
    url: String(d.url || '').trim(),
    type: d.type || 'link',
    note: d.note || '',
    createdAt: d.createdAt || d.created_at || nowISO(),
    updatedAt: d.updatedAt || d.updated_at || nowISO(),
    deletedAt: d.deletedAt || d.deleted_at || null
  };
}
function normalizeAdminUser(u) {
  return {
    id: u.id || uid(),
    name: String(u.name || '').trim() || 'Пользователь',
    email: String(u.email || '').trim(),
    role: u.role || 'Исполнитель',
    mode: u.mode || 'Личное пространство',
    note: u.note || '',
    createdAt: u.createdAt || u.created_at || nowISO(),
    updatedAt: u.updatedAt || u.updated_at || nowISO(),
    deletedAt: u.deletedAt || u.deleted_at || null
  };
}
function normalizeTask(t) {
  const legacyName = (t.project || '').trim();
  let projectId = t.projectId || t.project_id || '';
  if (!projectId && legacyName) projectId = ensureProject(legacyName, { persist: false });
  const pName = projectName(projectId, legacyName);
  return {
    id: t.id || uid(),
    title: (t.title || '').trim(),
    projectId,
    project: pName === 'Без проекта' ? '' : pName,
    dueDate: t.dueDate || t.due_date || '',
    planDate: t.planDate || t.plan_date || '',
    status: t.status || 'inbox',
    priority: t.priority || 'C',
    importance: t.importance || 'low',
    urgency: t.urgency || 'low',
    note: t.note || '',
    dayBucket: t.dayBucket || t.day_bucket || 'none',
    orderIndex: Number.isFinite(Number(t.orderIndex ?? t.order_index)) ? Number(t.orderIndex ?? t.order_index) : Date.now(),
    createdAt: t.createdAt || t.created_at || nowISO(),
    updatedAt: t.updatedAt || t.updated_at || nowISO(),
    doneAt: t.doneAt || t.done_at || null,
    archivedAt: t.archivedAt || t.archived_at || null,
    deletedAt: t.deletedAt || t.deleted_at || null
  };
}
function normalizeWorkLog(l) {
  const legacyName = (l.project || '').trim();
  let projectId = l.projectId || l.project_id || '';
  if (!projectId && legacyName) projectId = ensureProject(legacyName, { persist: false });
  const hours = Number(l.hours ?? settings.defaultHours ?? 8);
  const pName = projectName(projectId, legacyName);
  return {
    id: l.id || uid(),
    date: l.date || l.work_date || today(),
    projectId,
    project: pName === 'Без проекта' ? '' : pName,
    hours: Number.isFinite(hours) ? Math.max(0, hours) : 8,
    mark: l.mark || 'Я',
    comment: l.comment || '',
    createdAt: l.createdAt || l.created_at || nowISO(),
    updatedAt: l.updatedAt || l.updated_at || nowISO(),
    deletedAt: l.deletedAt || l.deleted_at || null
  };
}
function activeProjects({ includeArchived = false } = {}) {
  return projects.filter(p => !p.deletedAt && (includeArchived || p.status !== 'archived')).sort((a,b) => a.name.localeCompare(b.name, 'ru'));
}
function activeProjectMembers(projectId='') { return projectMembers.filter(m => !m.deletedAt && (!projectId || m.projectId === projectId)).sort((a,b) => a.name.localeCompare(b.name, 'ru')); }
function activePromises(projectId='') { return promises.filter(p => !p.deletedAt && (!projectId || p.projectId === projectId)).sort((a,b) => (a.checkDate || '9999-12-31').localeCompare(b.checkDate || '9999-12-31')); }
function activeDecisions(projectId='') { return decisions.filter(d => !d.deletedAt && (!projectId || d.projectId === projectId)).sort((a,b) => (b.date || '').localeCompare(a.date || '')); }
function activeTaskTemplates() { return taskTemplates.filter(t => !t.deletedAt).sort((a,b) => a.name.localeCompare(b.name, 'ru')); }
function activeProjectDocs(projectId='') { return projectDocs.filter(d => !d.deletedAt && (!projectId || d.projectId === projectId)).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); }
function activeAdminUsers() { return adminUsers.filter(u => !u.deletedAt).sort((a,b) => a.name.localeCompare(b.name, 'ru')); }

function taskIsDeleted(t) {
  if (!t) return false;
  const v = t.deletedAt ?? t.deleted_at ?? null;
  return Boolean(v && v !== 'null' && v !== 'undefined' && v !== '0');
}

function activeTasks() {
  return tasks.map(normalizeTask).filter(t => !taskIsDeleted(t));
}
function activeWorkLogs() { return workLogs.filter(l => !l.deletedAt); }
function projectById(id) { return id ? projects.find(p => p.id === id && !p.deletedAt) : null; }
function projectName(id, fallback = '') {
  const p = projectById(id);
  if (p) return p.name;
  return fallback || 'Без проекта';
}
function projectIdByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || n === 'без проекта') return '';
  const p = activeProjects({ includeArchived: true }).find(x => x.name.toLowerCase() === n || (x.code && x.code.toLowerCase() === n));
  return p ? p.id : '';
}
function ensureProject(name, { persist = true } = {}) {
  const clean = String(name || '').trim();
  if (!clean || clean === 'Без проекта') return '';
  const existing = projectIdByName(clean);
  if (existing) return existing;
  const p = normalizeProject({ name: clean, code: clean.length <= 12 ? clean : '', status: 'active' });
  projects.unshift(p);
  if (persist) saveProjects();
  return p.id;
}
function projectValueFromInput(inputValue) {
  const name = String(inputValue || '').trim();
  return name ? ensureProject(name) : '';
}
function favoriteProjects() {
  return [...new Set((settings.quickProjects || []).map(x => String(x || '').trim()).filter(Boolean))];
}
function updateProject(id, patch) {
  projects = projects.map(p => p.id === id ? normalizeProject({ ...p, ...patch, updatedAt: nowISO() }) : p);
  tasks = tasks.map(t => t.projectId === id ? normalizeTask({ ...t, project: projectName(id) }) : t);
  workLogs = workLogs.map(l => l.projectId === id ? normalizeWorkLog({ ...l, project: projectName(id) }) : l);
  saveProjects();
}
function createProjectFromForm() {
  const name = $('newProjectName')?.value.trim();
  if (!name) return alert('Укажи название проекта.');
  const existing = projectIdByName(name);
  if (existing) return alert('Такой проект уже есть.');
  const p = normalizeProject({
    name,
    code: $('newProjectCode')?.value.trim() || '',
    status: $('newProjectStatus')?.value || 'active',
    owner: $('newProjectOwner')?.value.trim() || '',
    customer: $('newProjectCustomer')?.value.trim() || '',
    stage: $('newProjectStage')?.value.trim() || '',
    dueDate: $('newProjectDueDate')?.value || '',
    color: $('newProjectColor')?.value || 'orange',
    description: $('newProjectDescription')?.value.trim() || '',
    note: $('newProjectNote')?.value.trim() || ''
  });
  projects.unshift(p);
  if (!favoriteProjects().includes(name)) settings.quickProjects = [...favoriteProjects(), name];
  persistAll({ renderNow: true, sync: true });
}
function saveProjectPassport(projectId) {
  const p = projectById(projectId);
  if (!p) return;
  updateProject(projectId, {
    name: $(`projectName_${projectId}`)?.value.trim() || p.name,
    code: $(`projectCode_${projectId}`)?.value.trim() || '',
    status: $(`projectStatus_${projectId}`)?.value || 'active',
    owner: $(`projectOwner_${projectId}`)?.value.trim() || '',
    customer: $(`projectCustomer_${projectId}`)?.value.trim() || '',
    stage: $(`projectStage_${projectId}`)?.value.trim() || '',
    startDate: $(`projectStart_${projectId}`)?.value || '',
    dueDate: $(`projectDue_${projectId}`)?.value || '',
    result: $(`projectResult_${projectId}`)?.value.trim() || '',
    nextAction: $(`projectNext_${projectId}`)?.value.trim() || '',
    color: $(`projectColor_${projectId}`)?.value || 'orange',
    description: $(`projectDescription_${projectId}`)?.value.trim() || '',
    note: $(`projectNote_${projectId}`)?.value.trim() || ''
  });
}
function addProjectMemberFromForm(projectId) {
  const name = $(`memberName_${projectId}`)?.value.trim();
  if (!name) return alert('Укажи ФИО или имя участника.');
  projectMembers.unshift(normalizeProjectMember({
    projectId,
    name,
    role: $(`memberRole_${projectId}`)?.value.trim() || 'Участник',
    email: $(`memberEmail_${projectId}`)?.value.trim() || '',
    note: $(`memberNote_${projectId}`)?.value.trim() || ''
  }));
  persistAll({ renderNow: true, sync: true });
}
function deleteProjectMember(id) {
  projectMembers = projectMembers.map(m => m.id === id ? normalizeProjectMember({ ...m, deletedAt: nowISO(), updatedAt: nowISO() }) : m);
  persistAll({ renderNow: true, sync: true });
}
function visibleTasks() {
  const q = $('searchInput')?.value.trim().toLowerCase() || '';
  const p = $('projectFilter')?.value || 'all';
  return activeTasks().filter(t => {
    if (taskIsDeleted(t)) return false;
    const pName = projectName(t.projectId, t.project);
    const hay = [t.title, pName, t.note, t.status, t.priority].join(' ').toLowerCase();
    const okSearch = !q || hay.includes(q);
    const okProject = p === 'all' || t.projectId === p;
    return okSearch && okProject;
  });
}
function sortTasks(list) {
  const rank = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  return [...list].sort((a,b) => {
    const dateA = a.planDate || a.dueDate || '9999-12-31';
    const dateB = b.planDate || b.dueDate || '9999-12-31';
    return dateA.localeCompare(dateB) || (rank[a.priority] - rank[b.priority]) || (a.orderIndex - b.orderIndex);
  });
}
function updateTask(id, patch) {
  tasks = tasks.map(t => t.id === id ? normalizeTask({ ...t, ...patch, updatedAt: syncEngineNow() }) : t);
  markTaskDirty(id);
  saveTasks();
  syncEngineUpsertTask(id, { silent:true, reason: patch.deletedAt ? 'удаление задачи' : 'изменение задачи' });
}
function addTask() {
  const title = $('quickTitle').value.trim();
  if (!title) return;
  const advancedOpen = $('advancedDetails').open;
  const isQuickInbox = !advancedOpen;
  const quickAnalysis = advancedOpen ? {} : analyzeQuickTaskText(title);
  const projectId = advancedOpen ? projectValueFromInput($('fieldProject').value) : (quickAnalysis.projectId || selectedQuickProjectId || '');
  const t = normalizeTask({
    title,
    projectId,
    project: projectName(projectId, ''),
    // Быстрый ввод одной строкой — это входящая задача на разбор.
    // Она не получает дату плана автоматически, чтобы не смешиваться с планом дня.
    planDate: advancedOpen ? $('fieldPlanDate').value : (quickAnalysis.planDate || ''),
    dueDate: advancedOpen ? $('fieldDueDate').value : '',
    status: advancedOpen ? $('fieldStatus').value : 'inbox',
    priority: advancedOpen ? $('fieldPriority').value : (quickAnalysis.priority || 'C'),
    importance: advancedOpen ? $('fieldImportance').value : (quickAnalysis.importance || 'low'),
    urgency: advancedOpen ? $('fieldUrgency').value : (quickAnalysis.urgency || 'low'),
    dayBucket: advancedOpen ? $('fieldDayBucket').value : 'none',
    note: advancedOpen ? $('fieldNote').value : (quickAnalysis.note || '')
  });
  tasks.unshift(t);
  markTaskDirty(t.id);
  $('quickTitle').value = '';
  $('fieldNote').value = '';

  // Чтобы новая входящая задача была сразу видна в «Разборе»,
  // сбрасываем фильтры, которые могли скрывать задачи без проекта.
  if (isQuickInbox) {
    if ($('searchInput')) $('searchInput').value = '';
    if ($('projectFilter')) $('projectFilter').value = 'all';
    currentView = 'inbox';
  }

  saveTasks();
  syncDiagnostics.localTasks = activeTasks().length;
  syncDiagnostics.lastLocalTask = latestLocalTaskTitle();
  syncDiagnostics.lastError = '';
  setSyncState('задача создана · сохраняем в облако', 'warn');
  addSyncAudit('быстрая задача', `создана: ${t.title}`);
  syncEngineUpsertTask(t.id, { silent:true, reason:'создание задачи' });
}

function deleteTask(id) {
  const task = tasks.find(t => t.id === id);
  updateTask(id, { deletedAt: syncEngineNow() });
  syncDiagnostics.localTasks = activeTasks().length;
  syncDiagnostics.lastLocalTask = latestLocalTaskTitle();
  setSyncState('задача удалена · сохраняем в облако', 'warn');
  addSyncAudit('удаление задачи', task ? `удалена: ${task.title}` : id);
  render();
}
function completeTask(id) { updateTask(id, { status: 'done', doneAt: nowISO(), dayBucket: 'none' }); }
function restoreTask(id) { updateTask(id, { status: 'planned', doneAt: null, archivedAt: null }); }
function runAutoArchiveCompleted({ persist = false } = {}) {
  const days = Math.max(1, Number(settings.autoArchiveDays || 90));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let changed = false;
  tasks = tasks.map(t => {
    if (t.status === 'done' && t.doneAt && !t.archivedAt && new Date(t.doneAt).getTime() <= cutoff) {
      changed = true;
      return normalizeTask({ ...t, archivedAt: nowISO(), updatedAt: nowISO() });
    }
    return t;
  });
  if (changed && persist) persistAll({ renderNow: true, sync: true });
  return changed;
}
function addWorkLog(input) {
  const projectId = input.projectId || projectValueFromInput(input.project);
  const log = normalizeWorkLog({ ...input, projectId, project: projectName(projectId, input.project) });
  workLogs.unshift(log);
  saveWorkLogs();
}
function deleteWorkLog(id) {
  workLogs = workLogs.map(l => l.id === id ? normalizeWorkLog({ ...l, deletedAt: nowISO(), updatedAt: nowISO() }) : l);
  saveWorkLogs();
}
function quickLogProject(projectIdOrName, comment='') {
  const projectId = projectById(projectIdOrName) ? projectIdOrName : ensureProject(projectIdOrName);
  addWorkLog({ date: today(), projectId, project: projectName(projectId), hours: settings.defaultHours || 8, mark: 'Я', comment });
}
function hardResetDeleted() {
  projects = projects.filter(p => !p.deletedAt);
  projectMembers = projectMembers.filter(m => !m.deletedAt);
  promises = promises.filter(p => !p.deletedAt);
  decisions = decisions.filter(d => !d.deletedAt);
  taskTemplates = taskTemplates.filter(t => !t.deletedAt);
  projectDocs = projectDocs.filter(d => !d.deletedAt);
  adminUsers = adminUsers.filter(u => !u.deletedAt);
  tasks = tasks.filter(t => !t.deletedAt);
  workLogs = workLogs.filter(l => !l.deletedAt);
  persistAll({ renderNow: true, sync: false });
}

function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeXml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function isOverdue(t) { return t.status !== 'done' && t.dueDate && t.dueDate < today(); }
function dateLabel(iso) {
  if (!iso) return '';
  if (iso === today()) return 'сегодня';
  if (iso === addDays(1)) return 'завтра';
  return iso.split('-').reverse().join('.');
}
function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function currentMonth() { return today().slice(0, 7); }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function syncToneClass() { return syncState.tone === 'ok' ? 'sync-ok' : syncState.tone === 'warn' ? 'sync-warn' : syncState.tone === 'bad' ? 'sync-bad' : ''; }
function setSyncState(text, tone='idle') {
  syncState = { text, tone };
  const el = $('syncStatusInline');
  if (el) { el.textContent = text; el.className = `stat ${syncToneClass()}`; }
}

function taskToneClass(t) {
  if (t.status === 'done') return 'task-tone-done';
  if (isOverdue(t)) return 'task-tone-red';
  if (t.dueDate && t.dueDate <= addDays(3)) return 'task-tone-yellow';
  if (!t.projectId) return 'task-tone-blue';
  return 'task-tone-normal';
}
function taskCard(t) {
  t = normalizeTask(t);
  if (taskIsDeleted(t)) return '';
  const overdue = isOverdue(t);
  const pName = projectName(t.projectId, t.project);
  const statusText = statusLabels[t.status] || t.status;
  const priorityText = priorityLabels[t.priority] || t.priority;
  const mainAction = t.status !== 'done'
    ? `<button class="mini-btn primary-mini" data-action="done" data-id="${t.id}" type="button">Готово</button>`
    : `<button class="mini-btn" data-action="restore" data-id="${t.id}" type="button">Вернуть</button>`;
  return `<article class="task-card ux-card ux-task-card ${taskToneClass(t)} ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <div class="ux-card-head">
      <div class="ux-title-wrap">
        <span class="task-state-dot ux-dot"></span>
        <div><p class="task-title ux-card-title">${escapeHtml(t.title)}</p><small>${escapeHtml(pName)}</small></div>
      </div>
      <span class="ux-status ${overdue ? 'ux-status-danger' : t.status === 'doing' ? 'ux-status-work' : ''}">${escapeHtml(statusText)}</span>
    </div>
    <div class="ux-card-meta">
      <span class="badge priority-${t.priority}">${escapeHtml(priorityText)}</span>
      ${t.dueDate ? `<span class="badge ${overdue ? 'overdue' : ''}">срок: ${dateLabel(t.dueDate)}</span>` : '<span class="badge muted-badge">без срока</span>'}
      ${t.planDate ? `<span class="badge">план: ${dateLabel(t.planDate)}</span>` : ''}
      ${t.dayBucket !== 'none' ? `<span class="badge">${bucketLabels[t.dayBucket]}</span>` : ''}
    </div>
    ${t.note ? `<p class="task-note ux-card-note">${escapeHtml(t.note)}</p>` : ''}
    <div class="task-actions task-actions-compact ux-card-actions">
      ${mainAction}
      <button class="mini-btn" data-action="edit" data-id="${t.id}" type="button">Открыть</button>
      ${t.status !== 'doing' && t.status !== 'done' ? `<button class="mini-btn" data-action="doing" data-id="${t.id}" type="button">В работу</button>` : ''}
      ${t.planDate !== today() && t.status !== 'done' ? `<button class="mini-btn" data-action="today" data-id="${t.id}" type="button">Сегодня</button>` : ''}
      ${t.projectId ? `<button class="mini-btn ghost-mini" data-action="logTaskProject" data-id="${t.id}" type="button">Работал</button>` : ''}
      <button class="mini-btn danger-mini" data-action="deleteTaskQuick" data-id="${t.id}" type="button">Удалить</button>
    </div>
  </article>`;
}
function listHtml(list, emptyText = 'Задач нет') {
  const items = sortTasks((list || []).map(normalizeTask).filter(t => !taskIsDeleted(t)));
  if (!items.length) return `<div class="empty">${emptyText}</div>`;
  return `<div class="task-list">${items.map(taskCard).join('')}</div>`;
}
function renderStats() {
  const a = activeTasks();
  const logs = activeWorkLogs();
  const open = a.filter(t => t.status !== 'done').length;
  const overdue = a.filter(isOverdue).length;
  const todayCount = a.filter(t => t.status !== 'done' && t.planDate === today()).length;
  const inbox = a.filter(t => t.status === 'inbox').length;
  const todayHours = logs.filter(l => l.date === today() && l.mark === 'Я').reduce((s,l) => s + Number(l.hours || 0), 0);
  const syncLabel = syncState.tone === 'bad' ? 'Требуется вход' : syncState.tone === 'ok' ? 'Синхронизировано' : syncState.tone === 'warn' ? 'Синхронизация' : 'Локально';
  $('stats').innerHTML = `
    <button class="stat stat-click" data-action="showOpenTasks" type="button"><strong>${open}</strong><span>открыто</span></button>
    <button class="stat stat-click" data-action="filterTodayFromStats" type="button"><strong>${todayCount}</strong><span>сегодня</span></button>
    <button class="stat stat-click ${overdue ? 'stat-danger' : ''}" data-action="showRiskSummary" type="button"><strong>${overdue}</strong><span>просрочено</span></button>
    <button class="stat stat-click" data-action="openInboxFromStats" type="button"><strong>${inbox}</strong><span>на разбор</span></button>
    <span class="stat"><strong>${todayHours}</strong><span>ч сегодня</span></span>
    <button id="syncStatusInline" class="stat stat-sync ${syncToneClass()}" data-action="openSyncFromStats" type="button"><strong>${escapeHtml(syncLabel)}</strong><span>${escapeHtml(syncState.text)}</span></button>
  `;
}
function renderQuickTagBars() {
  const chipHtml = favoriteProjects().map(name => {
    const id = ensureProject(name, { persist: false });
    const active = selectedQuickProjectId && selectedQuickProjectId === id ? ' active' : '';
    return `<button class="tag-chip${active}" data-quick-project="${escapeHtml(name)}" data-project-id="${escapeHtml(id)}" type="button">#${escapeHtml(name)}</button>`;
  }).join('');
  const clearBtn = selectedQuickProjectId ? `<button class="tag-chip tag-chip--clear" data-action="clearQuickProject" type="button">Без тега</button>` : '';
  const addForm = `<span class="quick-tag-add"><input id="quickTagName" placeholder="Новый тег / проект" /><button class="mini-btn" id="addQuickTagBtn" type="button">+ тег</button></span>`;
  const addHint = `<span class="tag-hint">Выбери тег перед быстрым вводом — задача сразу получит проект и попадёт в «Разбор».</span>`;
  if ($('quickTagBar')) $('quickTagBar').innerHTML = chipHtml + clearBtn + addForm + addHint;
  if ($('editTagBar')) $('editTagBar').innerHTML = chipHtml + addForm;
}
function renderProjectOptions() {
  const list = activeProjects();
  const current = $('projectFilter')?.value || 'all';
  $('projectFilter').innerHTML = '<option value="all">Все проекты</option>' + list.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  if ([...$('projectFilter').options].some(o => o.value === current)) $('projectFilter').value = current;
  $('projectList').innerHTML = list.map(p => `<option value="${escapeHtml(p.name)}"></option>`).join('');
  renderQuickTagBars();
}
function applyQuickProject(name, target='quick') {
  const projectId = ensureProject(name);
  const value = projectName(projectId);
  if (target === 'edit') {
    $('editProject').value = value;
  } else {
    selectedQuickProjectId = projectId;
    if ($('fieldProject')) $('fieldProject').value = value;
    renderQuickTagBars();
  }
}
function createQuickTagFromInput() {
  const input = $('quickTagName');
  const name = input?.value.trim();
  if (!name) return alert('Укажи название тега / проекта.');
  const projectId = ensureProject(name);
  selectedQuickProjectId = projectId;
  if (!favoriteProjects().includes(name)) settings.quickProjects = [...favoriteProjects(), name];
  if (input) input.value = '';
  persistAll({ renderNow: true, sync: true });
}
function renderToday() {
  const d = currentView === 'tomorrow' ? addDays(1) : today();
  const title = currentView === 'tomorrow' ? 'Завтра' : 'Сегодня';
  const list = visibleTasks().filter(t => t.status !== 'done' && t.planDate === d);
  return `<section class="section-head"><div><h2>${title}</h2><p>План дня по Айви Ли и методу Криса Гильбо «1–3–5»: сначала главное, потом значимое, потом мелкое.</p></div></section>
  <div class="grid-135">
    <section class="column accent-column"><h3>1 главная</h3><p class="column-sub">Одна задача, которая двигает день.</p>${listHtml(list.filter(t => t.dayBucket === 'one'), 'Главная задача не выбрана')}</section>
    <section class="column"><h3>3 важные</h3><p class="column-sub">То, что нужно закрыть без героизма.</p>${listHtml(list.filter(t => t.dayBucket === 'three'), 'Важные задачи не выбраны')}</section>
    <section class="column"><h3>5 мелких</h3><p class="column-sub">Короткие действия, звонки, проверки.</p>${listHtml(list.filter(t => t.dayBucket === 'five' || t.dayBucket === 'none'), 'Мелких задач нет')}</section>
  </div>`;
}
function renderWeek() {
  const days = Array.from({length: 7}, (_, i) => addDays(i));
  const list = visibleTasks().filter(t => t.status !== 'done');
  return `<section class="section-head"><div><h2>Неделя</h2><p>Ближайшие 7 дней. Просрочку лучше сразу переносить или закрывать.</p></div></section>
  <div class="grid-2">${days.map(d => `<section class="column"><h3>${dateLabel(d)}</h3><p class="column-sub">${d}</p>${listHtml(list.filter(t => t.planDate === d || t.dueDate === d), 'Пусто')}</section>`).join('')}</div>`;
}
function renderInbox() {
  const list = visibleTasks().filter(t => t.status === 'inbox');
  return `<section class="section-head"><div><h2>Разбор входящих</h2><p>Сюда попадает быстрый ввод одной строкой. Потом назначаешь проект, дату, приоритет и переводишь задачу в план.</p></div></section>${listHtml(list, 'Входящие разобраны')}`;
}
function renderMatrix() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const q = (importance, urgency) => list.filter(t => t.importance === importance && t.urgency === urgency);
  return `<section class="section-head"><div><h2>Матрица Эйзенхауэра</h2><p>Высокая значимость + близкий дедлайн — сделать. Высокая значимость без дедлайна — запланировать. Низкая значимость с дедлайном — делегировать. Остальное — убрать.</p></div></section>
  <div class="matrix-grid">
    <section class="column"><h3>Важно и дедлайн близко</h3><p class="column-sub">Сделать сейчас</p>${listHtml(q('high','high'), 'Пусто')}</section>
    <section class="column"><h3>Важно, не дедлайн близко</h3><p class="column-sub">Запланировать</p>${listHtml(q('high','low'), 'Пусто')}</section>
    <section class="column"><h3>Срочно, не значимо</h3><p class="column-sub">Делегировать / ограничить</p>${listHtml(q('low','high'), 'Пусто')}</section>
    <section class="column"><h3>Не значимо, не дедлайн близко</h3><p class="column-sub">Убрать</p>${listHtml(q('low','low'), 'Пусто')}</section>
  </div>`;
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - day + 1);
  return d;
}
function isoDate(d) { return d.toISOString().slice(0,10); }
function projectColorClass(p) { return 'project-color-' + (p?.color || 'orange'); }
function projectMetrics(projectId) {
  const all = activeTasks().filter(t => t.projectId === projectId);
  const open = all.filter(t => t.status !== 'done').length;
  const overdue = all.filter(isOverdue).length;
  const doing = all.filter(t => t.status === 'doing').length;
  const deferred = all.filter(t => t.status === 'deferred').length;
  const done = all.filter(t => t.status === 'done').length;
  const weekStart = startOfWeek();
  const doneWeek = all.filter(t => t.status === 'done' && t.doneAt && new Date(t.doneAt) >= weekStart).length;
  const month = currentMonth();
  const hoursMonth = activeWorkLogs().filter(l => l.projectId === projectId && l.date.slice(0,7) === month && l.mark === 'Я').reduce((s,l) => s + Number(l.hours || 0), 0);
  const members = activeProjectMembers(projectId).length;
  return { all: all.length, open, overdue, doing, deferred, done, doneWeek, hoursMonth, members };
}
function projectMiniCard(p, index=0) {
  const m = projectMetrics(p.id);
  const h = projectHealth(p.id);
  const progress = projectProgress(p);
  return `<article class="dashboard-card ux-card ux-project-card ${projectColorClass(p)} health-${h.tone}">
    <div class="ux-card-head">
      <div class="ux-title-wrap"><span class="color-dot"></span><div><h3 class="ux-card-title">${escapeHtml(p.name)}</h3><small>${escapeHtml(p.stage || p.owner || 'проект')}</small></div></div>
      <span class="ux-status">${projectStatusLabels[p.status] || p.status}</span>
    </div>
    <div class="ux-progress"><i style="width:${progress}%"></i></div>
    <div class="metric-row ux-metrics"><span><strong>${m.open}</strong> открыто</span><span><strong>${m.overdue}</strong> просрочено</span><span><strong>${m.doneWeek}</strong> за неделю</span><span><strong>${m.hoursMonth}</strong> ч/мес</span></div>
    <p class="task-note ux-card-note"><strong>${h.title}:</strong> ${escapeHtml(h.text)} · ${escapeHtml(p.nextAction || p.stage || p.description || 'нет следующего действия')}</p>
    <div class="task-actions ux-card-actions"><button class="mini-btn" data-action="filterProject" data-project-id="${p.id}" type="button">Задачи</button><button class="mini-btn" data-action="openProjects" data-project-id="${p.id}" type="button">Паспорт</button></div>
  </article>`;
}
function projectProgress(p) {
  const m = projectMetrics(p.id);
  const total = m.open + m.done;
  return total ? Math.round((m.done / total) * 100) : 0;
}
function deadlineDistance(date) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - new Date(today()).getTime()) / (24*60*60*1000));
}
function projectAlerts() {
  const alertDays = Number(settings.alertDays || 3);
  const alerts = [];
  activeProjects().forEach(p => {
    const m = projectMetrics(p.id);
    const dueLeft = deadlineDistance(p.dueDate);
    if (m.overdue > 0) alerts.push({ level:'red', project:p, text:`${m.overdue} просроченных задач` });
    if (dueLeft !== null && dueLeft >= 0 && dueLeft <= alertDays) alerts.push({ level:'yellow', project:p, text:`контрольный срок через ${dueLeft} дн.` });
    if (!(p.nextAction || '').trim()) alerts.push({ level:'orange', project:p, text:'нет следующего действия' });
    if (m.open >= Number(settings.projectOverloadLimit || 20)) alerts.push({ level:'yellow', project:p, text:`перегруз: ${m.open} открытых задач` });
  });
  activeTasks().filter(t => t.status !== 'done' && t.dueDate).forEach(t => {
    const left = deadlineDistance(t.dueDate);
    if (left !== null && left >= 0 && left <= alertDays) alerts.push({ level:'yellow', task:t, project:projectById(t.projectId), text:`задача «${t.title}» — дедлайн через ${left} дн.` });
  });
  return alerts;
}

function showAnalyticsDetail(kind, key='') {
  const label = String(key || '');
  if (kind === 'progress') return showDoneDay(label);
  if (kind === 'risk') {
    const alerts = projectAlerts();
    const items = alerts.filter(a => !label || a.level === label);
    const lines = items.slice(0,8).map((a,i) => `${i+1}. ${a.project?.name || 'Без проекта'} — ${a.text}`);
    return alert(`Риски: ${label || 'все'} · ${items.length}${lines.length ? '\n\n' + lines.join('\n') : ''}`);
  }
  if (kind === 'status') {
    const items = activeTasks().filter(t => t.status === label);
    const lines = items.slice(0,8).map((t,i) => `${i+1}. ${t.title} — ${projectName(t.projectId,t.project)}`);
    return alert(`${statusLabels[label] || label} · задач: ${items.length}${lines.length ? '\n\n' + lines.join('\n') : ''}`);
  }
  if (kind === 'workload') {
    const p = projectById(label);
    if (p) { currentView = 'projects'; render(); setTimeout(() => { const el = document.querySelector(`[data-project-id-card="${p.id}"]`); if (el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }, 60); }
  }
}
function renderUxBarChart({ title, subtitle, items, action, maxValue }) {
  const max = Math.max(1, Number(maxValue || 0), ...items.map(x => Number(x.value || 0)));
  return `<section class="column ux-chart-card"><div class="column-title-row"><div><h3>${escapeHtml(title)}</h3><p class="column-sub">${escapeHtml(subtitle || '')}</p></div><span class="metric-pill">${items.reduce((s,x)=>s+Number(x.value||0),0)}</span></div>
    <div class="ux-chart-list">${items.map(x => `<button class="ux-chart-row" data-action="showAnalyticsDetail" data-kind="${escapeHtml(action)}" data-key="${escapeHtml(x.key || x.label || '')}" type="button"><span>${escapeHtml(x.label)}</span><b>${Number(x.value || 0)}</b><i style="width:${Math.max(4, Math.round(Number(x.value || 0)/max*100))}%"></i></button>`).join('') || '<div class="empty">Данных пока нет</div>'}</div>
  </section>`;
}
function renderInteractiveAnalytics() {
  const all = activeTasks();
  const open = all.filter(t => t.status !== 'done');
  const statusItems = ['inbox','planned','doing','delegated','deferred'].map(s => ({ key:s, label:statusLabels[s] || s, value:open.filter(t => t.status === s).length })).filter(x => x.value > 0);
  const riskItems = ['red','orange','yellow'].map(level => ({ key:level, label:level === 'red' ? 'Критично' : level === 'orange' ? 'Внимание' : 'Скоро срок', value:projectAlerts().filter(a => a.level === level).length })).filter(x => x.value > 0);
  const workload = activeProjects().map(p => ({ key:p.id, label:p.name, value:projectMetrics(p.id).open })).filter(x => x.value > 0).sort((a,b)=>b.value-a.value).slice(0,8);
  const days = Array.from({length:10}, (_,i) => addDays(i-9));
  const progressItems = days.map(d => ({ key:d, label:d.slice(5), value:activeTasks().filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) === d).length }));
  return `<section class="section-head analytics-head"><div><span class="view-kicker">интерактивная аналитика</span><h2>Графики управления</h2><p>Сроки, прогресс, риски, динамика и нагрузка. Нажатие на строку открывает детализацию.</p></div></section>
  <div class="analytics-grid">
    ${renderUxBarChart({ title:'Статусы задач', subtitle:'Открытые задачи по состояниям', items:statusItems, action:'status' })}
    ${renderUxBarChart({ title:'Риски', subtitle:'Активные маркеры риска', items:riskItems, action:'risk' })}
    ${renderUxBarChart({ title:'Нагрузка', subtitle:'Открытые задачи по проектам', items:workload, action:'workload' })}
    ${renderUxBarChart({ title:'Динамика', subtitle:'Закрытые задачи за последние 10 дней', items:progressItems, action:'progress' })}
  </div>`;
}

function renderMiniChart(values, labels=[], dates=[]) {
  const max = Math.max(1, ...values);
  return `<div class="mini-bars chart-bars">${values.map((v,i) => `<button class="mini-bar-wrap chart-click" data-action="showDoneDay" data-date="${escapeHtml(dates[i] || '')}" type="button" title="Показать закрытые задачи за ${escapeHtml(labels[i] || '')}"><span>${escapeHtml(labels[i] || '')}</span><div class="mini-bar" style="height:${Math.max(8, Math.round(v/max*92))}px"></div><strong>${v}</strong></button>`).join('')}</div>`;
}
function showDoneDay(date) {
  if (!date) return;
  const items = activeTasks().filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) === date);
  const lines = items.slice(0, 8).map((t, i) => `${i+1}. ${t.title} — ${projectName(t.projectId, t.project)}`);
  alert(`${dateLabel(date)} · закрыто задач: ${items.length}${lines.length ? '\n\n' + lines.join('\n') : ''}`);
}
function renderProgressDynamics() {
  const days = Array.from({length:14}, (_,i) => addDays(i-13));
  const vals = days.map(d => activeTasks().filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) === d).length);
  const total = vals.reduce((s,v) => s+v, 0);
  return `<section class="column chart-card"><div class="column-title-row"><div><h3>Динамика закрытия задач</h3><p class="column-sub">Закрыто по дням за 14 дней. Нажми на столбец для деталей.</p></div><span class="metric-pill">${total} всего</span></div>${renderMiniChart(vals, days.map(d => d.slice(5)), days)}</section>`;
}
function renderGanttTimeline() {
  const ps = activeProjects().slice(0, 12);
  const now = new Date(today()).getTime();
  const dates = ps.flatMap(p => [p.startDate, p.dueDate]).filter(Boolean).map(d => new Date(d).getTime());
  const min = dates.length ? Math.min(...dates, now) : now - 7*86400000;
  const max = dates.length ? Math.max(...dates, now + 30*86400000) : now + 30*86400000;
  const span = Math.max(1, max-min);
  return `<section class="column control-wide gantt-card"><div class="column-title-row"><div><h3>График выполнения / вехи</h3><p class="column-sub">Сроки проектов и прогресс. Нажми на строку, чтобы открыть проект.</p></div><span class="metric-pill">${ps.length} проектов</span></div><div class="gantt">${ps.map(p => {
    const s = p.startDate ? new Date(p.startDate).getTime() : min;
    const e = p.dueDate ? new Date(p.dueDate).getTime() : max;
    const left = Math.max(0, Math.min(95, Math.round((s-min)/span*100)));
    const width = Math.max(4, Math.min(100-left, Math.round((e-s)/span*100)));
    const progress = projectProgress(p);
    const dueLeft = deadlineDistance(p.dueDate);
    const tone = dueLeft !== null && dueLeft < 0 ? 'gantt-red' : dueLeft !== null && dueLeft <= Number(settings.alertDays || 3) ? 'gantt-yellow' : 'gantt-ok';
    return `<button class="gantt-row ${tone} ${projectColorClass(p)}" data-action="openProjects" data-project-id="${p.id}" type="button" title="Открыть проект ${escapeHtml(p.name)}"><span class="gantt-name">${escapeHtml(p.name)}</span><div class="gantt-track"><div class="gantt-bar" style="left:${left}%;width:${width}%"><i style="width:${progress}%"></i></div></div><em>${progress}%</em><small>${p.dueDate ? dateLabel(p.dueDate) : 'без срока'}</small></button>`;
  }).join('') || '<div class="empty">Проекты со сроками не заданы</div>'}</div></section>`;
}
function renderAlertsPanel() {
  const alerts = projectAlerts();
  return `<section class="column alert-card"><div class="column-title-row"><div><h3>Маркеры и уведомления</h3><p class="column-sub">Что выпадает из контроля. Нажми строку, чтобы перейти к задаче или проекту.</p></div><span class="metric-pill">${alerts.length}</span></div>${alerts.slice(0,12).map(a => {
    const action = a.task ? 'edit' : 'openProjects';
    const attr = a.task ? `data-id="${a.task.id}"` : `data-project-id="${a.project?.id || ''}"`;
    return `<button class="alert-line ux-risk-card alert-${a.level}" data-action="${action}" ${attr} type="button"><strong>${escapeHtml(a.project?.name || 'Без проекта')}</strong><span>${escapeHtml(a.text)}</span></button>`;
  }).join('') || '<div class="empty">Критичных маркеров нет</div>'}</section>`;
}
function renderDocumentsPanel(projectId='') {
  const docs = activeProjectDocs(projectId);
  return `<section class="column documents-panel ux-doc-panel"><div class="column-title-row"><div><h3>Документы / хранилище</h3><p class="column-sub">Ссылки на Я.Диск, Google Drive, папки проекта, ТЗ, письма.</p></div><span class="metric-pill">${docs.length}</span></div>
    <div class="doc-list ux-doc-list">${docs.slice(0,10).map(d => `<a class="doc-link doc-link-rich ux-card ux-doc-card" href="${escapeHtml(d.url)}" target="_blank" rel="noopener"><div class="ux-card-head"><div class="ux-title-wrap"><span class="doc-icon">↗</span><div><strong class="ux-card-title">${escapeHtml(d.title)}</strong><small>${escapeHtml(projectName(d.projectId))}</small></div></div><span class="ux-status">${escapeHtml(d.type || 'ссылка')}</span></div>${d.note ? `<p class="ux-card-note">${escapeHtml(d.note)}</p>` : ''}</a>`).join('') || '<div class="empty">Документы не добавлены. Добавить ссылки можно в административном режиме.</div>'}</div>
  </section>`;
}
function renderCalendarPanel() {
  const horizon = Number(settings.calendarHorizonDays || 90);
  const until = addDays(horizon);
  const events = [
    ...activeTasks().filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= until).map(t => ({ title:t.title, dueDate:t.dueDate, projectId:t.projectId, kind:'задача' })),
    ...activeProjects().filter(p => p.dueDate && p.dueDate <= until).map(p => ({ title:`Веха: ${p.name}`, dueDate:p.dueDate, projectId:p.id, kind:'проект' }))
  ].sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return `<section class="column calendar-card"><div class="column-title-row"><div><h3>Календарь iPhone</h3><p class="column-sub">Контрольные сроки и вехи на горизонте ${horizon} дней.</p></div><span class="metric-pill">${events.length}</span></div>
    <div class="calendar-metric"><strong>${events.length}</strong><span>событий попадёт в календарь</span></div>
    <div class="event-list">${events.slice(0,6).map(e => `<button class="event-row" data-action="openProjects" data-project-id="${e.projectId || ''}" type="button"><strong>${dateLabel(e.dueDate)}</strong><span>${escapeHtml(e.title)}</span><small>${escapeHtml(e.kind)} · ${escapeHtml(projectName(e.projectId))}</small></button>`).join('') || '<div class="empty">Событий на горизонте нет</div>'}</div>
    <div class="task-actions"><button class="primary compact-primary" id="exportIcsBtn" type="button">Скачать календарь .ics</button></div>
  </section>`;
}

function renderWorkloadPanel() {
  const byProject = activeProjects().map(p => {
    const m = projectMetrics(p.id);
    return { p, m };
  }).filter(x => x.m.open > 0).sort((a,b) => b.m.open - a.m.open).slice(0,8);
  const max = Math.max(1, ...byProject.map(x => x.m.open));
  return `<section class="column workload-panel"><div class="column-title-row"><div><h3>Загрузка по проектам</h3><p class="column-sub">Где накопилось больше всего открытых задач.</p></div></div>
    <div class="workload-list">${byProject.map(x => `<button class="workload-row ${projectColorClass(x.p)}" data-action="openProjects" data-project-id="${x.p.id}" type="button"><span>${escapeHtml(x.p.name)}</span><b>${x.m.open}</b><i style="width:${Math.max(6, Math.round(x.m.open/max*100))}%"></i></button>`).join('') || '<div class="empty">Нет открытых задач</div>'}</div>
  </section>`;
}

function renderPmControl() {
  const widgets = settings.dashboardWidgets || defaultDashboardWidgets();
  const openTasks = activeTasks().filter(t=>t.status!=='done').length;
  const doneWeek = activeTasks().filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) >= addDays(-7)).length;
  const alertsCount = projectAlerts().length;
  const overdueCount = activeTasks().filter(isOverdue).length;
  const docsCount = activeProjectDocs().length;
  const blocks = [];
  blocks.push(`<section class="section-head view-hero"><div><span class="view-kicker">управление проектами</span><h2>Управление</h2><p>Сроки, риски, динамика, документы и календарь. Всё кликабельно: цифры ведут к действиям.</p></div></section>`);
  blocks.push(`<div class="dashboard-hero executive-hero card">
    <button data-action="openProjectsQuick" type="button"><strong>${activeProjects().length}</strong><span>проектов</span></button>
    <button data-action="showOpenTasks" type="button"><strong>${openTasks}</strong><span>открытых задач</span></button>
    <button data-action="showRiskSummary" type="button" class="${alertsCount ? 'metric-risk' : 'metric-ok'}"><strong>${alertsCount}</strong><span>маркеров риска</span></button>
    <button data-action="filterArchiveWeek" type="button"><strong>${doneWeek}</strong><span>закрыто за 7 дней</span></button>
    <button data-action="openAdminDocs" type="button"><strong>${docsCount}</strong><span>документов</span></button>
    <button data-action="exportCalendarQuick" type="button"><strong>${Number(settings.calendarHorizonDays || 90)}</strong><span>дней в календарь</span></button>
  </div>`);
  blocks.push(renderInteractiveAnalytics());
  blocks.push('<div class="control-grid">');
  if (widgets.includes('timeline')) blocks.push(renderGanttTimeline());
  if (widgets.includes('alerts')) blocks.push(renderAlertsPanel());
  if (widgets.includes('progress')) blocks.push(renderProgressDynamics());
  if (widgets.includes('health')) blocks.push(`<section class="column"><div class="column-title-row"><div><h3>Здоровье проектов</h3><p class="column-sub">Состояние по просрочке, движению и следующему действию.</p></div></div><div class="health-list">${activeProjects().map(p => { const h=projectHealth(p.id); return `<button class="summary-card health-${h.tone}" data-action="openProjects" data-project-id="${p.id}" type="button"><h4>${escapeHtml(p.name)}</h4><p>${escapeHtml(h.title)} · ${escapeHtml(h.text)}</p></button>`; }).join('') || '<div class="empty">Проектов нет</div>'}</div></section>`);
  if (widgets.includes('workload')) blocks.push(renderWorkloadPanel());
  if (widgets.includes('documents')) blocks.push(renderDocumentsPanel());
  if (widgets.includes('calendar')) blocks.push(renderCalendarPanel());
  if (widgets.includes('team')) blocks.push(`<section class="column"><h3>Пользователи</h3><p class="column-sub">Каждый email работает в отдельной экосистеме под своим user_id.</p>${activeAdminUsers().map(u=>`<div class="summary-card"><h4>${escapeHtml(u.name)}</h4><p>${escapeHtml(u.role)} · ${escapeHtml(u.email)}</p></div>`).join('') || '<div class="empty">Пользователи не добавлены</div>'}</section>`);
  blocks.push('</div>');
  return blocks.join('');
}

function icsDate(d) { return String(d || '').replace(/-/g,''); }
function exportCalendarIcs() {
  const horizon = Number(settings.calendarHorizonDays || 90);
  const until = addDays(horizon);
  const items = [
    ...activeTasks().filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= until).map(t => ({ title:`Задача: ${t.title}`, date:t.dueDate, desc:`Проект: ${projectName(t.projectId,t.project)}\\n${t.note || ''}` })),
    ...activeProjects().filter(p => p.dueDate && p.dueDate <= until).map(p => ({ title:`Веха проекта: ${p.name}`, date:p.dueDate, desc:`Следующее действие: ${p.nextAction || ''}\\n${p.result || ''}` }))
  ];
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kvadrat Zadach//PM Calendar//RU','CALSCALE:GREGORIAN', ...items.flatMap((it,idx) => ['BEGIN:VEVENT',`UID:${uid()}@kvadrat-zadach`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${icsDate(it.date)}`,`SUMMARY:${it.title.replace(/\n/g,' ')}`,`DESCRIPTION:${(it.desc || '').replace(/\n/g,'\\n')}`,'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  downloadText(`kvadrat-zadach-calendar-${today()}.ics`, body, 'text/calendar;charset=utf-8');
}
function renderDashboard() {
  const list = activeProjects().slice(0, 12);
  const totalOpen = activeTasks().filter(t => t.status !== 'done').length;
  const totalOverdue = activeTasks().filter(isOverdue).length;
  const totalHours = activeWorkLogs().filter(l => l.date.slice(0,7) === currentMonth() && l.mark === 'Я').reduce((s,l) => s + Number(l.hours || 0), 0);
  return `<section class="section-head"><div><h2>Дашборд проектов</h2><p>Сводная управленческая панель: открытые задачи, просрочка, сделано за неделю и часы за месяц.</p></div></section>
    <div class="dashboard-hero card"><div><strong>${list.length}</strong><span>активных проектов</span></div><div><strong>${totalOpen}</strong><span>открытых задач</span></div><div><strong>${totalOverdue}</strong><span>просрочено</span></div><div><strong>${totalHours}</strong><span>часов за месяц</span></div></div>
    <div class="dashboard-grid">${list.map(projectMiniCard).join('') || '<div class="empty">Создай проекты во вкладке «Проекты»</div>'}</div>`;
}
function buildWeeklyReport() {
  const start = startOfWeek();
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const startIso = isoDate(start); const endIso = isoDate(end);
  const all = activeTasks();
  const done = all.filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) >= startIso && t.doneAt.slice(0,10) <= endIso);
  const overdue = all.filter(isOverdue);
  const stuck = all.filter(t => t.status !== 'done' && (['doing','deferred','delegated'].includes(t.status) || (t.updatedAt && new Date(t.updatedAt) < new Date(Date.now() - 7*24*60*60*1000))));
  const byProject = (items) => {
    const map = new Map();
    items.forEach(t => { const n = projectName(t.projectId, t.project); if (!map.has(n)) map.set(n, []); map.get(n).push(t); });
    return [...map.entries()];
  };
  return { startIso, endIso, done, overdue, stuck, byProject };
}
function renderWeeklyList(title, items, emptyText) {
  const report = buildWeeklyReport();
  if (!items.length) return `<section class="column"><h3>${title}</h3><div class="empty">${emptyText}</div></section>`;
  return `<section class="column"><h3>${title}</h3>${report.byProject(items).map(([project, arr]) => `<div class="weekly-group"><strong>${escapeHtml(project)}</strong>${arr.map(t => `<button class="kanban-task-link ${isOverdue(t) ? 'overdue-link' : ''}" data-action="edit" data-id="${t.id}" type="button">${escapeHtml(t.title)}${t.dueDate ? `<em>${dateLabel(t.dueDate)}</em>` : ''}</button>`).join('')}</div>`).join('')}</section>`;
}
function weeklyReportText() {
  const r = buildWeeklyReport();
  const block = (title, items) => {
    const groups = r.byProject(items);
    if (!groups.length) return `${title}\n— нет\n`;
    return `${title}\n` + groups.map(([p, arr]) => `${p}:\n${arr.map(t => `— ${t.title}${t.dueDate ? ` (срок: ${dateLabel(t.dueDate)})` : ''}`).join('\n')}`).join('\n') + '\n';
  };
  return `Недельный отчёт ${r.startIso} — ${r.endIso}\n\n${block('Сделано', r.done)}\n${block('Зависло / требует решения', r.stuck)}\n${block('Просрочено', r.overdue)}`;
}
function renderWeeklyReport() {
  const r = buildWeeklyReport();
  return `<section class="section-head"><div><h2>Недельный отчёт</h2><p>Автоматическая выжимка: что сделано, что зависло и что просрочено за неделю.</p></div><div class="task-actions"><button class="ghost" id="copyWeeklyReport" type="button">Скопировать текст</button><button class="ghost" id="downloadWeeklyReport" type="button">Скачать TXT</button></div></section>
    <div class="grid-2 weekly-report">${renderWeeklyList('Сделано', r.done, 'За неделю выполненных задач нет')}${renderWeeklyList('Зависло', r.stuck, 'Зависших задач нет')}${renderWeeklyList('Просрочено', r.overdue, 'Просрочки нет')}</div>
    <section class="settings-panel card"><h3>Текст отчёта</h3><pre class="sql-box">${escapeHtml(weeklyReportText())}</pre></section>`;
}


function daysSinceIso(iso) {
  if (!iso) return 999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24*60*60*1000));
}
function getStuckTasks() {
  return activeTasks().filter(t => t.status !== 'done' && (['doing','deferred','delegated'].includes(t.status) || daysSinceIso(t.updatedAt) >= 7));
}
function getDelegateCandidates() {
  return activeTasks().filter(t => t.status !== 'done' && (t.priority === 'D' || (t.importance === 'low' && (t.dueDate || t.urgency === 'high'))));
}
function projectLastActivity(projectId) {
  const dates = [
    ...activeTasks().filter(t => t.projectId === projectId).map(t => t.updatedAt || t.createdAt),
    ...activeWorkLogs().filter(l => l.projectId === projectId).map(l => l.updatedAt || l.createdAt),
    ...activeDecisions(projectId).map(d => d.updatedAt || d.createdAt),
    ...activePromises(projectId).map(p => p.updatedAt || p.createdAt)
  ].filter(Boolean).sort().reverse();
  return dates[0] || '';
}
function projectHealth(projectId) {
  const p = projectById(projectId);
  const metrics = projectMetrics(projectId);
  const last = projectLastActivity(projectId);
  const cold = daysSinceIso(last);
  const noNext = !(p?.nextAction || '').trim();
  if (metrics.overdue > 0) return { tone:'red', title:'Красный', text:`${metrics.overdue} просрочено` };
  if (noNext) return { tone:'orange', title:'Жёлтый', text:'нет следующего действия' };
  if (metrics.deferred > 0 || metrics.doing > 3 || cold >= 7) return { tone:'yellow', title:'Жёлтый', text: cold >= 7 ? `нет движения ${cold} дн.` : 'есть зависание' };
  if (cold >= 14) return { tone:'gray', title:'Серый', text:`не трогался ${cold} дн.` };
  return { tone:'green', title:'Зелёный', text:'в норме' };
}
function analyzeQuickTaskText(title) {
  const s = title.toLowerCase();
  let projectId = selectedQuickProjectId || '';
  if (!projectId) {
    for (const p of activeProjects({ includeArchived:true })) {
      const code = (p.code || '').toLowerCase();
      if ((code && s.includes(code)) || s.includes(p.name.toLowerCase())) { projectId = p.id; break; }
    }
  }
  const urgent = /(срочно|сегодня|до конца дня|горит|дедлайн|завтра)/i.test(title);
  const delegate = /(делег|поруч|пусть|передать|запросить)/i.test(title);
  const tomorrow = /(завтра)/i.test(title);
  return {
    projectId,
    priority: urgent ? 'A' : delegate ? 'D' : 'C',
    importance: urgent ? 'high' : 'low',
    urgency: urgent ? 'high' : 'low',
    planDate: tomorrow ? addDays(1) : '',
    note: projectId ? 'Проект определён быстрым тегом / текстом задачи.' : ''
  };
}
function todayOverloadNotice(list) {
  if (list.length <= 9) return '';
  return `<div class="notice">На сегодня ${list.length} задач. Это перегруз. Лучше оставить 1 главную, 3 важные и до 5 мелких, остальное перенести.</div>`;
}

function attentionProjects(limit=6) {
  return activeProjects().map(p => {
    const m = projectMetrics(p.id);
    const h = projectHealth(p.id);
    const dueLeft = deadlineDistance(p.dueDate);
    const score = (m.overdue * 10) + (h.tone === 'red' ? 8 : h.tone === 'orange' ? 6 : h.tone === 'yellow' ? 4 : 0) + (dueLeft !== null && dueLeft <= Number(settings.alertDays || 3) ? 5 : 0);
    return { p, m, h, dueLeft, score };
  }).filter(x => x.score > 0 || x.m.open > 0).sort((a,b) => b.score - a.score || b.m.open - a.m.open).slice(0, limit);
}
function executiveProjectCard(x) {
  const { p, m, h, dueLeft } = x;
  const dueText = p.dueDate ? (dueLeft < 0 ? `просрочен на ${Math.abs(dueLeft)} дн.` : `срок через ${dueLeft} дн.`) : 'без срока';
  return `<button class="executive-project-card health-${h.tone} ${projectColorClass(p)}" data-action="openProjects" data-project-id="${p.id}" type="button">
    <div><span class="color-dot"></span><strong>${escapeHtml(p.name)}</strong></div>
    <p>${escapeHtml(h.title)} · ${escapeHtml(h.text)} · ${escapeHtml(dueText)}</p>
    <small>${m.open} открытых · ${m.overdue} просрочено · ${m.doing} в работе</small>
  </button>`;
}
function riskTaskLine(t) {
  return `<button class="risk-task-line ${isOverdue(t) ? 'risk-red' : 'risk-yellow'}" data-action="edit" data-id="${t.id}" type="button">
    <strong>${escapeHtml(t.title)}</strong>
    <span>${escapeHtml(projectName(t.projectId, t.project))}${t.dueDate ? ' · срок: ' + dateLabel(t.dueDate) : ''}</span>
  </button>`;
}
function renderFocusStrip(todays, overdue, stuck, delegate, noProject) {
  return `<section class="executive-focus-strip card">
    <button data-action="filterTodayFromStats" type="button"><strong>${todays.length}</strong><span>на сегодня</span></button>
    <button data-action="showRiskSummary" type="button" class="${overdue.length ? 'danger-metric' : ''}"><strong>${overdue.length}</strong><span>просрочено</span></button>
    <button data-action="setViewStuck" type="button"><strong>${stuck.length}</strong><span>зависло</span></button>
    <button data-action="setViewDelegate" type="button"><strong>${delegate.length}</strong><span>делегировать</span></button>
    <button data-action="setViewNoProject" type="button"><strong>${noProject.length}</strong><span>без проекта</span></button>
  </section>`;
}



function safeSyncBadgeStatus() {
  const signed = Boolean(syncDiagnostics.userId);
  const localCount = activeTasks().length;
  const remote = syncDiagnostics.remoteTasks;
  const dirty = dirtyTaskCount();
  if (!signed) return { tone:'warn', title:'Локальный режим', text:`На этом устройстве ${localCount} задач. Для общего пространства нужен вход по email-коду.` };
  if (dirty > 0) return { tone:'warn', title:'Ожидает отправки', text:`${dirty} задач ещё отправляются в облако. Приложение будет повторять отправку автоматически.` };
  if (remote === null || remote === undefined) return { tone:'warn', title:'Вход выполнен', text:'Облако ещё не проверено. Нажмите «Проверить облако».' };
  return { tone:'ok', title:'Облако активно', text:`Локально ${localCount} задач · в облаке ${remote} задач.` };
}
function renderSafeSyncStatusCard() {
  const s = safeSyncBadgeStatus();
  return `<section class="safe-sync-card card sync-${s.tone}">
    <div>
      <span class="view-kicker">синхронизация</span>
      <h3>${escapeHtml(s.title)}</h3>
      <p>${escapeHtml(s.text)}</p>
      <p class="auto-sync-note">Задачи сохраняются в облако автоматически. Кнопка «Синхронизировать» обновляет кэш вручную.</p>
    </div>
    <div class="task-actions">
      <button class="primary compact-primary" id="forceAutoSyncNow" type="button">${syncDiagnostics.userId ? 'Синхронизировать' : 'Войти и синхронизировать'}</button>
    </div>
  </section>`;
}
function renderHomeAuthStatusCard() {
  const signedIn = Boolean(syncDiagnostics.userId);
  const status = safeSyncBadgeStatus();
  const cloudText = syncDiagnostics.remoteTasks === null || syncDiagnostics.remoteTasks === undefined
    ? 'облако не проверено'
    : `${syncDiagnostics.remoteTasks} задач в облаке`;
  const lastText = syncDiagnostics.lastCheckedAt ? `проверка: ${escapeHtml(syncDiagnostics.lastCheckedAt)}` : 'проверки ещё не было';
  return `<section class="home-auth-card card auth-${status.tone}">
    <div class="home-auth-main">
      <span class="auth-dot"></span>
      <div>
        <strong>${escapeHtml(status.title)}</strong>
        <p>${signedIn ? `${escapeHtml(syncDiagnostics.email || settings.email || 'email не указан')} · user ${escapeHtml(syncDiagnostics.userId.slice(0,8))}` : `${escapeHtml(settings.email || 'email не указан')} · вход на этом устройстве не выполнен`}</p>
      </div>
    </div>
    <div class="home-auth-meta">
      <span>${escapeHtml(cloudText)}</span>
      <span>${escapeHtml(lastText)}</span>
    </div>
    <div class="home-auth-actions">
      <button class="${signedIn ? 'ghost' : 'primary'} compact-primary" data-action="openSyncFromStats" type="button">${signedIn ? 'Открыть синхронизацию' : 'Войти / синхронизировать'}</button>
      <button class="ghost compact-primary" data-action="checkCloudFromHome" type="button">Проверить облако</button>
    </div>
  </section>`;
}
function renderCommander() {
  const todays = activeTasks().filter(t => t.status !== 'done' && t.planDate === today());
  const overdue = activeTasks().filter(isOverdue);
  const stuck = getStuckTasks();
  const delegate = getDelegateCandidates();
  const noProject = activeTasks().filter(t => t.status !== 'done' && !t.projectId);
  const soon = activeTasks().filter(t => t.status !== 'done' && t.dueDate && !isOverdue(t) && deadlineDistance(t.dueDate) <= Number(settings.alertDays || 3));
  const attention = attentionProjects(6);
  const next = todays.find(t => t.dayBucket === 'one') || todays.find(t => t.priority === 'A') || overdue[0] || stuck[0] || todays[0];
  return `<section class="section-head executive-day-head"><div><span class="view-kicker">операционный центр</span><h2>День</h2><p>Главный экран руководителя: фокус, риски, задачи на сегодня и проекты, которые требуют внимания.</p></div></section>
  ${renderHomeAuthStatusCard()}
  ${renderFocusStrip(todays, overdue, stuck, delegate, noProject)}
  ${todayOverloadNotice(todays)}
  <section class="day-focus-card card">
    <div class="day-focus-main">
      <span class="view-kicker">фокус дня</span>
      <h3>${next ? escapeHtml(next.title) : 'Главная задача не выбрана'}</h3>
      <p>${next ? `${escapeHtml(projectName(next.projectId,next.project))}${next.dueDate ? ' · срок: ' + dateLabel(next.dueDate) : ''}` : 'Выберите одну главную задачу на сегодня или добавьте её через командный ввод.'}</p>
    </div>
    <div class="task-actions">
      ${next ? `<button class="primary compact-primary" data-action="edit" data-id="${next.id}" type="button">Открыть задачу</button>` : '<button class="primary compact-primary" data-action="openInboxFromStats" type="button">Открыть разбор</button>'}
      <button class="ghost compact-primary" data-action="filterTodayFromStats" type="button">План дня</button>
    </div>
  </section>

  <div class="executive-day-grid">
    <section class="column day-column day-column-large"><div class="column-title-row"><div><h3>Сегодня важно</h3><p class="column-sub">Задачи на день: главное, важное и короткие действия.</p></div><span class="metric-pill">${todays.length}</span></div>${listHtml(todays.slice(0,10), 'На сегодня задач нет')}</section>
    <section class="column day-column"><div class="column-title-row"><div><h3>Риски и просрочка</h3><p class="column-sub">То, что требует реакции.</p></div><span class="metric-pill">${overdue.length + soon.length}</span></div>${[...overdue.slice(0,5), ...soon.slice(0,5)].slice(0,8).map(riskTaskLine).join('') || '<div class="empty">Критичных рисков нет</div>'}</section>
    <section class="column day-column"><div class="column-title-row"><div><h3>Проекты внимания</h3><p class="column-sub">Проекты с рисками, сроками или отсутствием движения.</p></div><span class="metric-pill">${attention.length}</span></div><div class="executive-project-list">${attention.map(executiveProjectCard).join('') || '<div class="empty">Проекты в норме</div>'}</div></section>
    <section class="column day-column"><div class="column-title-row"><div><h3>Делегировать / разобрать</h3><p class="column-sub">Снять лишнее с личного контура.</p></div></div>
      <div class="split-actions">
        <button data-action="setViewDelegate" type="button"><strong>${delegate.length}</strong><span>кандидатов на делегирование</span></button>
        <button data-action="openInboxFromStats" type="button"><strong>${activeTasks().filter(t=>t.status==='inbox').length}</strong><span>задач на разбор</span></button>
        <button data-action="setViewNoProject" type="button"><strong>${noProject.length}</strong><span>без проекта</span></button>
      </div>
    </section>
  </div>`;
}

function renderStuckTasks() {
  return `<section class="section-head"><div><h2>Зависшие задачи</h2><p>Задачи в работе, отложенные, делегированные или давно не обновлявшиеся.</p></div></section>${listHtml(getStuckTasks(), 'Зависших задач нет')}`;
}
function renderDelegateMode() {
  return `<section class="section-head"><div><h2>Что делегировать</h2><p>Кандидаты: приоритет D или низкая значимость при наличии дедлайна.</p></div></section>${listHtml(getDelegateCandidates(), 'Кандидатов на делегирование нет')}`;
}
function renderNoProject() {
  const list = activeTasks().filter(t => t.status !== 'done' && !t.projectId);
  return `<section class="section-head"><div><h2>Без проекта</h2><p>Задачи без проекта — это зона потери контроля. Разбери и привяжи к проектам.</p></div></section>${listHtml(list, 'Задач без проекта нет')}`;
}

function renderKanban() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const statuses = ['inbox','planned','doing','delegated','deferred'];
  const mode = settings.kanbanMode || 'compact';
  const renderColumn = (s) => {
    const items = sortTasks(list.filter(t => t.status === s));
    const groups = new Map();
    for (const t of items) {
      const key = t.projectId || 'no-project';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const body = [...groups.entries()].map(([pid, tasks]) => {
      const pName = pid === 'no-project' ? 'Без проекта' : projectName(pid);
      if (mode === 'detailed') {
        return `<div class="kanban-project">
          <button class="kanban-project-title" data-action="filterProject" data-project-id="${escapeHtml(pid === 'no-project' ? 'all' : pid)}" type="button">${escapeHtml(pName)} <span>${tasks.length}</span></button>
          <div class="task-list">${tasks.map(taskCard).join('')}</div>
        </div>`;
      }
      return `<div class="kanban-project">
        <button class="kanban-project-title" data-action="filterProject" data-project-id="${escapeHtml(pid === 'no-project' ? 'all' : pid)}" type="button">${escapeHtml(pName)} <span>${tasks.length}</span></button>
        <div class="kanban-task-list">${tasks.map(t => `<button class="kanban-task-link ${isOverdue(t) ? 'overdue-link' : ''}" data-action="edit" data-id="${t.id}" type="button"><strong>${priorityLabels[t.priority]}</strong> ${escapeHtml(t.title)}${t.dueDate ? `<em>${dateLabel(t.dueDate)}</em>` : ''}</button>`).join('')}</div>
      </div>`;
    }).join('');
    return `<section class="column kanban-column"><h3>${statusLabels[s]}</h3><p class="column-sub">${items.length} задач · ${groups.size} проектов</p>${body || '<div class="empty">Пусто</div>'}</section>`;
  };
  return `<section class="section-head"><div><h2>Канбан</h2><p>${mode === 'compact' ? 'Компактно: статус → проект → задачи-ссылки.' : 'Подробно: полные карточки задач по статусам и проектам.'}</p></div><div class="task-actions"><button class="ghost ${mode === 'compact' ? 'active-toggle' : ''}" data-action="setKanbanMode" data-mode="compact" type="button">Компактно</button><button class="ghost ${mode === 'detailed' ? 'active-toggle' : ''}" data-action="setKanbanMode" data-mode="detailed" type="button">Подробно</button></div></section><div class="kanban-grid kanban-${mode}">${statuses.map(renderColumn).join('')}</div>`;
}

function renderProjectMembers(projectId) {
  const members = activeProjectMembers(projectId);
  if (!members.length) return '<div class="empty">Участники не добавлены</div>';
  return `<div class="member-list">${members.map(m => `<div class="member-row"><span><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.role)}${m.email ? ` · ${escapeHtml(m.email)}` : ''}</small></span><button class="mini-btn" data-action="deleteProjectMember" data-member-id="${m.id}" type="button">Удалить</button></div>`).join('')}</div>`;
}
function renderProjectPassport(p) {
  const statusOptions = Object.entries(projectStatusLabels).map(([k,v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('');
  const colors = [['orange','Оранжевый'],['amber','Янтарный'],['yellow','Жёлтый'],['lime','Лайм'],['green','Зелёный'],['emerald','Изумрудный'],['teal','Бирюзовый'],['cyan','Голубой'],['blue','Синий'],['indigo','Индиго'],['violet','Фиолетовый'],['purple','Пурпурный'],['pink','Розовый'],['rose','Роза'],['red','Красный'],['gray','Серый']];
  const colorOptions = colors.map(([k,v]) => `<option value="${k}" ${p.color === k ? 'selected' : ''}>${v}</option>`).join('');
  return `<details class="project-passport">
    <summary>Паспорт проекта</summary>
    <div class="project-form-grid">
      <label>Название<input id="projectName_${p.id}" value="${escapeHtml(p.name)}" /></label>
      <label>Код / тег<input id="projectCode_${p.id}" value="${escapeHtml(p.code || '')}" /></label>
      <label>Статус<select id="projectStatus_${p.id}">${statusOptions}</select></label>
      <label>Цвет<select id="projectColor_${p.id}">${colorOptions}</select></label>
      <label>Ответственный<input id="projectOwner_${p.id}" value="${escapeHtml(p.owner || '')}" /></label>
      <label>Заказчик / направление<input id="projectCustomer_${p.id}" value="${escapeHtml(p.customer || '')}" /></label>
      <label>Стадия<input id="projectStage_${p.id}" value="${escapeHtml(p.stage || '')}" placeholder="АПР, МТЗ, стройка, эксплуатация" /></label>
      <label>Дата старта<input id="projectStart_${p.id}" type="date" value="${escapeHtml(p.startDate || '')}" /></label>
      <label>Контрольный срок<input id="projectDue_${p.id}" type="date" value="${escapeHtml(p.dueDate || '')}" /></label>
      <label>Ожидаемый результат<input id="projectResult_${p.id}" value="${escapeHtml(p.result || '')}" /></label>
      <label>Следующее действие<input id="projectNext_${p.id}" value="${escapeHtml(p.nextAction || '')}" placeholder="один конкретный следующий шаг" /></label>
    </div>
    <label class="full-label">Описание<textarea id="projectDescription_${p.id}" rows="2">${escapeHtml(p.description || '')}</textarea></label>
    <label class="full-label">Риски / комментарий<textarea id="projectNote_${p.id}" rows="2">${escapeHtml(p.note || '')}</textarea></label>
    <div class="task-actions"><button class="primary" data-action="saveProjectPassport" data-project-id="${p.id}" type="button">Сохранить паспорт</button></div>
    <h4>Роли и участники</h4>
    ${renderProjectMembers(p.id)}
    <div class="member-form">
      <input id="memberName_${p.id}" placeholder="ФИО / имя" />
      <select id="memberRole_${p.id}"><option>Владелец</option><option>Руководитель</option><option>Исполнитель</option><option>Эксперт</option><option>Наблюдатель</option></select>
      <input id="memberEmail_${p.id}" placeholder="email" />
      <input id="memberNote_${p.id}" placeholder="комментарий" />
      <button class="mini-btn" data-action="addProjectMember" data-project-id="${p.id}" type="button">Добавить участника</button>
    </div>
  </details>`;
}
function renderProjects() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const ym = currentMonth();
  const cards = activeProjects({ includeArchived: true }).map(p => {
    const items = list.filter(t => t.projectId === p.id);
    const m = projectMetrics(p.id);
    const h = projectHealth(p.id);
    const progress = projectProgress(p);
    return `<section class="column project-card ux-card ux-project-card ${p.status === 'archived' ? 'project-muted' : ''} ${projectColorClass(p)} health-${h.tone}" data-project-id-card="${p.id}">
      <div class="ux-card-head">
        <div class="ux-title-wrap"><span class="color-dot"></span><div><h3 class="ux-card-title">${escapeHtml(p.name)}</h3><small>${escapeHtml(p.stage || p.owner || 'проект')}</small></div></div>
        <span class="ux-status">${projectStatusLabels[p.status] || p.status}</span>
      </div>
      <div class="ux-progress"><i style="width:${progress}%"></i></div>
      <div class="metric-row ux-metrics"><span><strong>${m.open}</strong> открыто</span><span><strong>${m.overdue}</strong> просрочено</span><span><strong>${m.hoursMonth}</strong> ч за ${monthTitle(ym)}</span><span><strong>${m.members}</strong> участн.</span></div>
      <p class="task-note ux-card-note"><strong>${h.title}:</strong> ${escapeHtml(h.text)}${p.description ? ' · ' + escapeHtml(p.description) : ''}</p>
      <div class="task-actions ux-card-actions">
        <button class="mini-btn primary-mini" data-action="quickLogProject" data-project-id="${p.id}" type="button">Отметить сегодня</button>
        <button class="mini-btn" data-action="filterProject" data-project-id="${p.id}" type="button">Задачи</button>
        <button class="mini-btn" data-action="archiveProject" data-project-id="${p.id}" type="button">${p.status === 'archived' ? 'Активировать' : 'В архив'}</button>
      </div>
      ${renderProjectPassport(p)}
      <div class="ux-card-list">${listHtml(items, 'Открытых задач нет')}</div>
    </section>`;
  }).join('');
  return `<section class="section-head"><div><h2>Проекты</h2><p>Единая карточка проекта: статус, прогресс, риски, задачи, паспорт и быстрые действия.</p></div></section>
    <section class="card project-form-card">
      <h3>Создать проект</h3>
      <div class="project-form-grid">
        <label>Название проекта *<input id="newProjectName" placeholder="Например: МЗМО, РДКБ, Сколтех" /></label>
        <label>Код / быстрый тег<input id="newProjectCode" placeholder="Например: МЗМО" /></label>
        <label>Статус<select id="newProjectStatus"><option value="active">Активный</option><option value="paused">Пауза</option><option value="archived">Архив</option></select></label>
        <label>Цвет<select id="newProjectColor">
          <option value="orange">Оранжевый</option><option value="amber">Янтарный</option><option value="yellow">Жёлтый</option><option value="lime">Лайм</option><option value="green">Зелёный</option><option value="emerald">Изумрудный</option><option value="teal">Бирюзовый</option><option value="cyan">Голубой</option><option value="blue">Синий</option><option value="indigo">Индиго</option><option value="violet">Фиолетовый</option><option value="purple">Пурпурный</option><option value="pink">Розовый</option><option value="rose">Роза</option><option value="red">Красный</option><option value="gray">Серый</option>
        </select></label>
        <label>Ответственный<input id="newProjectOwner" placeholder="Кто ведёт" /></label>
        <label>Заказчик / направление<input id="newProjectCustomer" placeholder="Для кого / направление" /></label>
        <label>Стадия<input id="newProjectStage" placeholder="МТЗ, АПР, проектирование..." /></label>
        <label>Контрольный срок<input id="newProjectDueDate" type="date" /></label>
      </div>
      <label class="full-label">Краткое описание<textarea id="newProjectDescription" rows="2" placeholder="Что входит в проект, зачем он нужен"></textarea></label>
      <label class="full-label">Комментарий<textarea id="newProjectNote" rows="2" placeholder="Риски, вводные, особенности"></textarea></label>
      <div class="task-actions"><button class="primary" id="createProjectBtn" type="button">Создать проект</button></div>
    </section>
    <div class="grid-2 ux-card-grid">${cards || '<div class="empty">Проектов пока нет</div>'}</div>`;
}
function renderArchive() {
  const list = visibleTasks().filter(t => t.status === 'done');
  return `<section class="section-head"><div><h2>Архив</h2><p>Выполненные задачи. Можно вернуть обратно в работу.</p></div></section>${listHtml(list, 'Архив пуст')}`;
}
function buildTimesheet(ym, projectId='all') {
  const totalDays = daysInMonth(ym);
  const logs = activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectId === 'all' || l.projectId === projectId));
  const byDay = new Map();
  for (let d = 1; d <= totalDays; d++) byDay.set(d, { hours: 0, marks: [], projects: new Set(), comments: [] });
  logs.forEach(l => {
    const day = Number(l.date.slice(8,10));
    const cell = byDay.get(day);
    if (!cell) return;
    if (l.mark === 'Я') cell.hours += Number(l.hours || 0);
    cell.marks.push(l.mark);
    cell.projects.add(projectName(l.projectId, l.project));
    if (l.comment) cell.comments.push(l.comment);
  });
  const dayData = [];
  for (let d = 1; d <= 31; d++) {
    const cell = byDay.get(d) || { hours: '', marks: [], projects: new Set(), comments: [] };
    const hasWork = cell.hours > 0;
    const nonWork = cell.marks.find(m => m !== 'Я');
    dayData.push({ day: d, hours: d <= totalDays && hasWork ? cell.hours : '', code: d <= totalDays ? (hasWork ? 'Я' : (nonWork || '')) : '', projects: [...cell.projects], comments: cell.comments });
  }
  const totals = (from, to) => {
    const slice = dayData.filter(x => x.day >= from && x.day <= to);
    return { hours: slice.reduce((s,x) => s + (Number(x.hours) || 0), 0), workDays: slice.filter(x => x.code === 'Я').length, absenceDays: slice.filter(x => x.code && x.code !== 'Я').length };
  };
  return { ym, totalDays, dayData, firstHalf: totals(1, 15), monthTotal: totals(1, totalDays), logs, projectId };
}
function buildProjectBreakdown(ym) {
  return activeProjects({ includeArchived: true }).map(p => {
    const ts = buildTimesheet(ym, p.id);
    const entries = activeWorkLogs().filter(l => l.date.startsWith(ym) && l.projectId === p.id).length;
    return { project: p.name, projectId: p.id, firstHalfHours: ts.firstHalf.hours, firstHalfDays: ts.firstHalf.workDays, monthHours: ts.monthTotal.hours, monthDays: ts.monthTotal.workDays, entries };
  }).filter(x => x.entries || x.monthHours || x.firstHalfHours);
}
function renderProjectSummaryCards(ym) {
  const rows = buildProjectBreakdown(ym);
  if (!rows.length) return '<div class="empty">По проектам пока нет отметок</div>';
  return `<div class="project-summary-grid">${rows.map(r => `<div class="summary-card"><h4>${escapeHtml(r.project)}</h4><p>1–15: ${r.firstHalfDays} дн. / ${r.firstHalfHours} ч</p><p>Месяц: ${r.monthDays} дн. / ${r.monthHours} ч</p><p>Отметок: ${r.entries}</p></div>`).join('')}</div>`;
}
function projectBreakdownTableHtml(ym) {
  const rows = buildProjectBreakdown(ym);
  if (!rows.length) return '<div class="empty">Разделение по проектам пока пустое</div>';
  return `<div class="table-wrap"><table class="split-table"><thead><tr><th>Проект</th><th class="num">1–15 дней</th><th class="num">1–15 часов</th><th class="num">Месяц дней</th><th class="num">Месяц часов</th><th class="num">Отметок</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.project)}</td><td class="num">${r.firstHalfDays}</td><td class="num">${r.firstHalfHours}</td><td class="num">${r.monthDays}</td><td class="num">${r.monthHours}</td><td class="num">${r.entries}</td></tr>`).join('')}</tbody></table></div>`;
}
function timesheetTableHtml(ts) {
  const firstDays = ts.dayData.slice(0, 15);
  const secondDays = ts.dayData.slice(15, 31);
  const comments = ts.dayData.filter(x => x.projects.length).map(x => `${x.day}: ${x.projects.join(', ')}`).join('; ');
  const scopeLabel = ts.projectId === 'all' ? 'Все проекты' : projectName(ts.projectId);
  return `<div class="table-wrap"><table class="timesheet-table"><caption style="caption-side:top; text-align:left; padding:10px 12px; color:var(--muted)">Табель: ${escapeHtml(scopeLabel)}</caption>
    <thead><tr><th>Фамилия, имя, отчество</th><th>Должность</th>${firstDays.map(x => `<th>${x.day}</th>`).join('')}<th>Итого дней (часов) явок (неявок) с 1 по 15</th>${secondDays.map(x => `<th>${x.day}</th>`).join('')}<th>Всего дней (часов) явок (неявок) за месяц</th></tr></thead>
    <tbody>
      <tr><td rowspan="2">${escapeHtml(settings.fio || '')}</td><td rowspan="2">${escapeHtml(settings.position || '')}</td>${firstDays.map(x => `<td title="${escapeHtml(x.projects.join(', '))}">${x.hours}</td>`).join('')}<td>${ts.firstHalf.hours}</td>${secondDays.map(x => `<td title="${escapeHtml(x.projects.join(', '))}">${x.hours}</td>`).join('')}<td>${ts.monthTotal.hours}</td></tr>
      <tr>${firstDays.map(x => `<td>${x.code}</td>`).join('')}<td>${ts.firstHalf.workDays}${ts.firstHalf.absenceDays ? ` / Н:${ts.firstHalf.absenceDays}` : ''}</td>${secondDays.map(x => `<td>${x.code}</td>`).join('')}<td>${ts.monthTotal.workDays}${ts.monthTotal.absenceDays ? ` / Н:${ts.monthTotal.absenceDays}` : ''}</td></tr>
      <tr><td colspan="35" style="text-align:left">Проекты по датам: ${escapeHtml(comments || 'нет отметок')}</td></tr>
    </tbody></table></div>`;
}
function renderWorkLogs(ym) {
  const projectId = settings.timesheetProjectId || 'all';
  const logs = activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectId === 'all' || l.projectId === projectId)).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!logs.length) return `<div class="empty">Отметок за выбранный месяц пока нет</div>`;
  return `<div class="log-list">${logs.map(l => `<div class="log-row"><span>${dateLabel(l.date)}</span><strong>${escapeHtml(projectName(l.projectId, l.project))}</strong><span>${l.hours} ч</span><span>${escapeHtml(l.mark)}</span><span>${escapeHtml(l.comment || '')}</span><button class="mini-btn" data-action="deleteWorkLog" data-id="${l.id}" type="button">Удалить</button></div>`).join('')}</div>`;
}
function renderTimesheet() {
  const ym = settings.timesheetMonth || currentMonth();
  const currentProjectId = settings.timesheetProjectId || 'all';
  const ts = buildTimesheet(ym, currentProjectId);
  const list = activeProjects();
  return `<section class="timesheet-panel card">
    <div><h2>Табель и отметки по проектам</h2><p>Отмечаешь часы по проекту. Приложение собирает табель и свод по каждому проекту.</p></div>
    <div class="notice">Автосинхронизация включена: после изменений приложение само отправляет данные в облако, если выполнен вход.</div>
    <div class="timesheet-entry">
      <label>Дата <input id="workDate" type="date" value="${today()}" /></label>
      <label>Проект <input id="workProject" list="projectList" value="${escapeHtml(list[0]?.name || '')}" placeholder="Проект" /></label>
      <label>Часы <input id="workHours" type="number" min="0" step="0.5" value="${settings.defaultHours === undefined || settings.defaultHours === null ? '' : settings.defaultHours}" /></label>
      <label>Код <select id="workMark">${Object.entries(workMarkLabels).map(([k,v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></label>
      <label>Комментарий <input id="workComment" placeholder="Что делал / уточнение" /></label>
      <button class="primary" id="addWorkLog" type="button">Отметить</button>
    </div>
    <div class="timesheet-grid">
      <label>Месяц табеля <input id="timesheetMonth" type="month" value="${ym}" /></label>
      <label>Проект табеля<select id="timesheetProject"><option value="all">Все проекты</option>${list.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === currentProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
      <div class="task-actions" style="align-items:end"><button class="ghost" id="saveTimesheetMonth" type="button">Показать</button><button class="ghost" id="exportTimesheet" type="button">Экспорт табеля Excel</button><button class="ghost" id="exportLogsCsv" type="button">Экспорт журнала CSV</button></div>
    </div>
    <section><h3>Свод по проектам за ${monthTitle(ym)}</h3>${renderProjectSummaryCards(ym)}</section>
    ${timesheetTableHtml(ts)}
    <section><h3>Разделение по проектам</h3>${projectBreakdownTableHtml(ym)}</section>
    <section><h3>Журнал отметок за ${monthTitle(ym)}</h3>${renderWorkLogs(ym)}</section>
  </section>`;
}

function syncLabDeviceLabel() {
  try {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  } catch {}
  return 'Устройство';
}
function syncLabSet(message, tone = 'warn') {
  syncLabState.message = message;
  syncLabState.tone = tone;
  syncLabState.lastActionAt = new Date().toLocaleString('ru-RU');
  if (currentView === 'settings') render();
}
function syncLabRowHtml(row) {
  const deleted = Boolean(row.deleted_at || row.deletedAt);
  const created = String(row.created_at || row.createdAt || '').replace('T', ' ').slice(0, 19);
  const updated = String(row.updated_at || row.updatedAt || '').replace('T', ' ').slice(0, 19);
  return `<div class="sync-lab-row ${deleted ? 'is-deleted' : ''}">
    <div>
      <strong>${escapeHtml(row.title || 'Без названия')}</strong>
      <span>${escapeHtml(deleted ? 'удалена' : 'активна')} · создана: ${escapeHtml(created || '—')} · обновлена: ${escapeHtml(updated || '—')}</span>
      <small>ID: ${escapeHtml(row.id || '')}</small>
    </div>
    <button class="ghost compact-primary" data-action="syncLabPick" data-id="${escapeHtml(row.id || '')}" type="button">${syncLabState.selectedId === row.id ? 'Выбрана' : 'Выбрать'}</button>
  </div>`;
}

function syncLabSafeJson(value) {
  try {
    if (value === undefined) return 'undefined';
    return JSON.stringify(value, null, 2);
  } catch (e) { return String(value); }
}
function syncLabDebugSet(patch = {}) {
  syncLabDebug = {
    ...syncLabDebug,
    ...patch,
    appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    lastAt: new Date().toLocaleString('ru-RU')
  };
}
function syncLabDebugHtml() {
  const payload = syncLabDebug.lastPayload ? syncLabSafeJson(syncLabDebug.lastPayload) : '—';
  const response = syncLabDebug.lastResponse ? syncLabSafeJson(syncLabDebug.lastResponse) : '—';
  const anyRows = syncLabDebug.lastAnyRows && syncLabDebug.lastAnyRows.length ? syncLabSafeJson(syncLabDebug.lastAnyRows) : '—';
  return `<div class="sync-lab-debug">
    <h4>Диагностика записи и чтения</h4>
    <div class="sync-lab-debug-grid">
      <div><strong>Версия:</strong> ${escapeHtml(syncLabDebug.appVersion || APP_VERSION || '—')}</div>
      <div><strong>Email:</strong> ${escapeHtml(syncLabDebug.email || settings.email || syncDiagnostics.email || '—')}</div>
      <div><strong>user_id приложения:</strong> ${escapeHtml(syncLabDebug.userId || syncDiagnostics.userId || '—')}</div>
      <div><strong>user_id сессии:</strong> ${escapeHtml(syncLabDebug.sessionUserId || '—')}</div>
      <div><strong>Последний статус:</strong> ${escapeHtml(syncLabDebug.lastStatus || '—')}</div>
      <div><strong>Последняя проверка:</strong> ${escapeHtml(syncLabDebug.lastAt || '—')}</div>
    </div>
    <div class="sync-lab-debug-error ${syncLabDebug.lastError ? 'has-error' : ''}"><strong>Ошибка:</strong> ${escapeHtml(syncLabDebug.lastError || 'нет')}</div>
    <details><summary>Что приложение пыталось отправить</summary><pre>${escapeHtml(payload)}</pre></details>
    <details><summary>Ответ Supabase на последнюю запись</summary><pre>${escapeHtml(response)}</pre></details>
    <details><summary>Последние 10 задач пользователя без фильтра SYNC LAB</summary><pre>${escapeHtml(anyRows)}</pre></details>

    <div class="sync-lab-any-table">
      <h4>Последние строки пользователя, которые реально вернуло устройство</h4>
      ${(syncLabDebug.lastAnyRows || []).length ? (syncLabDebug.lastAnyRows || []).slice(0, 10).map(r => `<div class="sync-lab-row ${r.deleted_at ? 'is-deleted' : ''}">
        <div>
          <strong>${escapeHtml(r.title || 'Без названия')}</strong>
          <span>ID: ${escapeHtml(r.id || '')}</span>
          <small>created: ${escapeHtml(String(r.created_at || '').replace('T',' ').slice(0,19))} · updated: ${escapeHtml(String(r.updated_at || '').replace('T',' ').slice(0,19))} · deleted: ${escapeHtml(r.deleted_at || 'null')}</small>
        </div>
      </div>`).join('') : '<div class="empty">Пока нет прочитанных строк. Нажмите «Прочитать последние 10 задач» или «Прочитать 50 по updated_at».</div>'}
    </div>

  </div>`;
}
async function syncLabRefreshAuthDiagnostic({ silent = false } = {}) {
  const client = getSupabaseClient();
  if (!client) {
    syncLabDebugSet({ lastStatus: 'нет клиента Supabase', lastError: 'getSupabaseClient() вернул пусто' });
    syncLabSet('нет облачного подключения', 'bad');
    if (!silent) alert('Облачное подключение недоступно.');
    return null;
  }
  try {
    const sessionResult = await client.auth.getSession();
    const userResult = await client.auth.getUser();
    const sessionUser = sessionResult?.data?.session?.user || null;
    const authUser = userResult?.data?.user || null;
    const authError = sessionResult?.error?.message || userResult?.error?.message || '';
    const user = authUser || sessionUser;
    syncLabDebugSet({
      email: user?.email || settings.email || syncDiagnostics.email || '',
      userId: syncDiagnostics.userId || user?.id || '',
      sessionUserId: user?.id || '',
      authError,
      lastStatus: user?.id ? 'сессия найдена' : 'сессия не найдена',
      lastError: authError || ''
    });
    if (!user?.id) { syncLabSet('сессия не найдена', 'bad'); return null; }
    syncDiagnostics.userId = user.id;
    syncDiagnostics.email = user.email || syncDiagnostics.email || settings.email || '';
    syncLabSet('вход проверен', 'ok');
    return user;
  } catch (e) {
    const msg = e?.message || String(e);
    syncLabDebugSet({ lastStatus: 'ошибка проверки входа', lastError: msg });
    syncLabSet('ошибка проверки входа: ' + msg, 'bad');
    if (!silent) alert(msg);
    return null;
  }
}
async function syncLabReadAnyCloud({ silent = false } = {}) {
  const client = getSupabaseClient();
  if (!client) { syncLabSet('нет облачного подключения', 'bad'); return false; }
  try {
    const user = await syncLabRefreshAuthDiagnostic({ silent:true });
    if (!user?.id) return false;
    const { data, error, status, statusText } = await client.from('tasks')
      .select('id,user_id,title,status,created_at,updated_at,deleted_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending:false })
      .limit(10);
    if (error) throw error;
    syncLabDebugSet({
      email: user.email || settings.email || '',
      userId: user.id,
      sessionUserId: user.id,
      lastAnyRows: data || [],
      lastStatus: `прочитано без фильтра: ${status || ''} ${statusText || ''}`,
      lastError: ''
    });
    syncLabSet(`без фильтра прочитано строк: ${(data || []).length}`, 'ok');
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab read any', msg);
    syncLabDebugSet({ lastStatus: 'ошибка чтения без фильтра', lastError: msg });
    syncLabSet('ошибка чтения без фильтра: ' + msg, 'bad');
    if (!silent) alert(msg);
    return false;
  }
}
async function syncLabWriteDiagnostic() {
  const client = getSupabaseClient();
  if (!client) {
    syncLabDebugSet({ lastStatus: 'нет клиента Supabase', lastError: 'getSupabaseClient() вернул пусто' });
    syncLabSet('нет облачного подключения', 'bad');
    alert('Облачное подключение недоступно.');
    return false;
  }
  try {
    const user = await syncLabRefreshAuthDiagnostic({ silent:true });
    if (!user?.id) { syncLabSet('нет активной сессии для записи', 'bad'); return false; }
    const ts = new Date().toLocaleString('ru-RU');
    const id = (typeof newCloudId === 'function') ? newCloudId() : (crypto.randomUUID ? crypto.randomUUID() : uid());
    const now = nowISO();
    const row = {
      id, user_id: user.id,
      title: `${SYNC_LAB_PREFIX} WRITE TEST / ${syncLabDeviceLabel()} / ${ts}`,
      project_id: null, project: null, due_date: null, plan_date: null,
      status: 'inbox', priority: 'C', importance: 'low', urgency: 'low',
      note: 'Диагностическая запись Sync Lab Diagnostic.', day_bucket: 'none',
      order_index: Date.now(), created_at: now, updated_at: now,
      done_at: null, archived_at: null, deleted_at: null
    };
    syncLabDebugSet({
      email: user.email || settings.email || '', userId: user.id, sessionUserId: user.id,
      lastPayload: row, lastResponse: null, lastError: '',
      lastStatus: 'отправляем insert().select().single()'
    });
    const { data, error, status, statusText } = await client.from('tasks').insert(row).select('id,user_id,title,created_at,updated_at,deleted_at').single();
    syncLabDebugSet({
      lastResponse: { data, error, status, statusText },
      lastError: error ? (error.message || syncLabSafeJson(error)) : '',
      lastStatus: `ответ записи: ${status || ''} ${statusText || ''}`
    });
    if (error) throw error;
    syncLabState.selectedId = data?.id || id;
    syncLabSet('диагностическая запись создана', 'ok');
    await syncLabReadCloud({ silent:true });
    await syncLabReadAnyCloud({ silent:true });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab write diagnostic', msg);
    syncLabDebugSet({ lastError: msg, lastStatus: 'ошибка диагностической записи' });
    syncLabSet('ошибка диагностической записи: ' + msg, 'bad');
    alert(msg);
    return false;
  }
}

function syncLabSetReadIdValue(value) {
  if (typeof syncLabDebug === 'undefined') return;
  syncLabDebug.readByIdInput = String(value || '').trim();
}
async function syncLabFindById() {
  const input = document.getElementById('syncLabIdInput');
  const id = String(input?.value || syncLabDebug.readByIdInput || '').trim();
  syncLabDebugSet({ readByIdInput: id, readByIdResult: null, readByIdError: '', readByIdStatus: 'поиск по id...' });
  if (!id) {
    syncLabDebugSet({ readByIdError: 'Введите id строки из Supabase', readByIdStatus: 'id не указан' });
    syncLabSet('введите id задачи', 'warn');
    return false;
  }
  const client = getSupabaseClient();
  if (!client) {
    syncLabDebugSet({ readByIdError: 'getSupabaseClient() вернул пусто', readByIdStatus: 'нет клиента Supabase' });
    syncLabSet('нет облачного подключения', 'bad');
    return false;
  }
  try {
    const user = await syncLabRefreshAuthDiagnostic({ silent:true });
    if (!user?.id) {
      syncLabDebugSet({ readByIdError: 'нет активной сессии', readByIdStatus: 'сессия не найдена' });
      syncLabSet('сессия не найдена', 'bad');
      return false;
    }
    const { data, error, status, statusText } = await client.from('tasks')
      .select('id,user_id,title,status,created_at,updated_at,deleted_at,note,priority,importance,urgency')
      .eq('id', id)
      .maybeSingle();

    syncLabDebugSet({
      readByIdResult: { data, error, status, statusText },
      readByIdError: error ? (error.message || syncLabSafeJson(error)) : '',
      readByIdStatus: data ? `найдено: ${status || ''} ${statusText || ''}` : `не найдено: ${status || ''} ${statusText || ''}`,
      lastResponse: { findById: { data, error, status, statusText } },
      lastError: error ? (error.message || syncLabSafeJson(error)) : '',
      lastStatus: data ? 'поиск по id: найдено' : 'поиск по id: не найдено'
    });

    if (error) throw error;
    if (data) {
      syncLabState.selectedId = data.id;
      syncLabSet('задача по ID найдена', 'ok');
    } else {
      syncLabSet('задача по ID не найдена', 'warn');
    }
    render();
    return Boolean(data);
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab find by id', msg);
    syncLabDebugSet({ readByIdError: msg, readByIdStatus: 'ошибка поиска по id', lastError: msg });
    syncLabSet('ошибка поиска по ID: ' + msg, 'bad');
    alert(msg);
    render();
    return false;
  }
}
async function syncLabRead50Updated() {
  const client = getSupabaseClient();
  if (!client) {
    syncLabSet('нет облачного подключения', 'bad');
    return false;
  }
  try {
    const user = await syncLabRefreshAuthDiagnostic({ silent:true });
    if (!user?.id) return false;
    const { data, error, status, statusText } = await client.from('tasks')
      .select('id,user_id,title,status,created_at,updated_at,deleted_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending:false })
      .limit(50);
    if (error) throw error;
    syncLabDebugSet({
      lastAnyRows: data || [],
      lastResponse: { read50Updated: { count: (data || []).length, status, statusText } },
      lastError: '',
      lastStatus: `прочитано 50 по updated_at: ${status || ''} ${statusText || ''}`
    });
    syncLabSet(`прочитано по updated_at: ${(data || []).length}`, 'ok');
    render();
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab read 50 updated', msg);
    syncLabDebugSet({ lastError: msg, lastStatus: 'ошибка чтения 50 по updated_at' });
    syncLabSet('ошибка чтения 50: ' + msg, 'bad');
    alert(msg);
    render();
    return false;
  }
}
function syncLabReadInspectorHtml() {
  const idValue = escapeHtml(syncLabDebug.readByIdInput || '');
  const result = syncLabDebug.readByIdResult ? syncLabSafeJson(syncLabDebug.readByIdResult) : '—';
  const error = syncLabDebug.readByIdError || 'нет';
  return `<div class="sync-lab-inspector">
    <h4>Read Inspector: найти конкретную строку по ID</h4>
    <p>Вставьте значение из колонки <strong>id</strong> строки Supabase. Это прямой тест чтения без фильтра по названию, сортировки и лимита 10.</p>
    <div class="sync-lab-id-row">
      <input id="syncLabIdInput" value="${idValue}" placeholder="id из Supabase, например xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      <button class="primary" id="syncLabFindById" type="button">Найти задачу по ID</button>
    </div>
    <div class="sync-lab-debug-error ${syncLabDebug.readByIdError ? 'has-error' : ''}">
      <strong>Статус поиска:</strong> ${escapeHtml(syncLabDebug.readByIdStatus || 'не запускался')}<br>
      <strong>Ошибка поиска:</strong> ${escapeHtml(error)}
    </div>
    <details open>
      <summary>Ответ Supabase по ID</summary>
      <pre>${escapeHtml(result)}</pre>
    </details>
  </div>`;
}

function renderSyncLab() {
  const active = syncLabState.activeRows || [];
  const deleted = syncLabState.deletedRows || [];
  const selected = syncLabState.selectedId ? (syncLabState.rows || []).find(r => r.id === syncLabState.selectedId) : null;
  return `<section class="card sync-lab-card">
    <div class="sync-lab-head">
      <div>
        <span class="view-kicker">диагностика</span>
        <h3>Sync Lab: проверка Supabase на таблице tasks</h3>
        <p>Проверяем iPhone: вход, user_id, insert, ответ Supabase, чтение с фильтром и без фильтра.</p>
      </div>
      <span class="device-login-status ${syncLabState.tone || 'warn'}">${escapeHtml(syncLabState.message || 'не запускалось')}</span>
    </div>
    <div class="sync-lab-actions">
      <button class="primary simple-sync-main" id="syncLabDiagWrite" type="button">0. Проверить вход и запись</button>
      <button class="primary simple-sync-main" id="syncLabCreate" type="button">1. Создать тест в облаке</button>
      <button class="primary simple-sync-main" id="syncLabRead" type="button">2. Прочитать SYNC LAB</button>
      <button class="primary simple-sync-main" id="syncLabReadAny" type="button">Прочитать последние 10 задач</button>
      <button class="danger simple-sync-main" id="syncLabDelete" type="button" ${syncLabState.selectedId ? '' : 'disabled'}>3. Удалить выбранную</button>
      <button class="ghost simple-sync-main" id="syncLabAuth" type="button">Проверить вход</button>
      <button class="ghost simple-sync-main" id="syncLabClear" type="button">Очистить экран теста</button>
    </div>
    <div class="sync-lab-status">
      <div><strong>Выбранная задача:</strong> ${selected ? escapeHtml(selected.title || selected.id) : 'не выбрана'}</div>
      <div><strong>Последнее действие:</strong> ${escapeHtml(syncLabState.lastActionAt || 'не было')}</div>
      <div><strong>Активных SYNC LAB:</strong> ${active.length}</div>
      <div><strong>Удалённых SYNC LAB:</strong> ${deleted.length}</div>
    </div>
    ${syncLabDebugHtml()}
    ${syncLabReadInspectorHtml()}
    <div class="sync-lab-list">
      <h4>Активные тестовые задачи SYNC LAB</h4>
      ${active.length ? active.map(syncLabRowHtml).join('') : '<div class="empty">Активных тестовых задач нет. Нажмите «0. Проверить вход и запись» или «1. Создать тест в облаке».</div>'}
      <h4>Удалённые тестовые задачи SYNC LAB</h4>
      ${deleted.length ? deleted.slice(0, 5).map(syncLabRowHtml).join('') : '<div class="empty">Удалённых тестовых задач пока нет.</div>'}
    </div>
    <div class="auth-help-box">
      <strong>Как читать результат:</strong> если на iPhone запись не попадает в Supabase, нажмите «0. Проверить вход и запись» и смотрите блок «Ошибка» и «Ответ Supabase».
    </div>
  </section>`;
}
async function syncLabReadCloud({ silent = false } = {}) {
  const client = getSupabaseClient();
  if (!client) {
    syncLabSet('нет облачного подключения', 'bad');
    if (!silent) alert('Облачное подключение недоступно.');
    return false;
  }
  try {
    const user = await getActiveCloudUser(client);
    const { data, error } = await client.from('tasks')
      .select('id,user_id,title,status,created_at,updated_at,deleted_at')
      .eq('user_id', user.id)
      .like('title', `${SYNC_LAB_PREFIX}%`)
      .order('created_at', { ascending:false })
      .limit(20);
    if (error) throw error;
    const rows = data || [];
    syncLabState.rows = rows;
    syncLabState.activeRows = rows.filter(r => !r.deleted_at);
    syncLabState.deletedRows = rows.filter(r => r.deleted_at);
    if (syncLabState.selectedId && !rows.some(r => r.id === syncLabState.selectedId)) syncLabState.selectedId = '';
    syncLabSet(`прочитано: активных ${syncLabState.activeRows.length}, удалённых ${syncLabState.deletedRows.length}`, 'ok');
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab read', msg);
    syncLabSet('ошибка чтения: ' + msg, 'bad');
    if (!silent) alert(msg);
    return false;
  }
}
async function syncLabCreateCloud() {
  const client = getSupabaseClient();
  if (!client) {
    syncLabSet('нет облачного подключения', 'bad');
    alert('Облачное подключение недоступно.');
    return false;
  }
  try {
    const user = await getActiveCloudUser(client);
    const ts = new Date().toLocaleString('ru-RU');
    const id = (typeof newCloudId === 'function') ? newCloudId() : (crypto.randomUUID ? crypto.randomUUID() : uid());
    const now = nowISO();
    const row = {
      id,
      user_id: user.id,
      title: `${SYNC_LAB_PREFIX} ${syncLabDeviceLabel()} / ${ts}`,
      project_id: null,
      project: null,
      due_date: null,
      plan_date: null,
      status: 'inbox',
      priority: 'C',
      importance: 'low',
      urgency: 'low',
      note: 'Тестовая задача Sync Lab. Можно удалять.',
      day_bucket: 'none',
      order_index: Date.now(),
      created_at: now,
      updated_at: now,
      done_at: null,
      archived_at: null,
      deleted_at: null
    };
    syncLabDebugSet({
      email: user.email || settings.email || '', userId: user.id, sessionUserId: user.id,
      lastPayload: row, lastResponse: null, lastError: '',
      lastStatus: 'отправляем обычный тест insert().select().single()'
    });
    const { data, error, status, statusText } = await client.from('tasks').insert(row).select('id,user_id,title,created_at,updated_at,deleted_at').single();
    syncLabDebugSet({
      lastResponse: { data, error, status, statusText },
      lastError: error ? (error.message || syncLabSafeJson(error)) : '',
      lastStatus: `ответ обычной записи: ${status || ''} ${statusText || ''}`
    });
    if (error) throw error;
    syncLabState.selectedId = data?.id || id;
    syncLabSet('создано в облаке', 'ok');
    await syncLabReadCloud({ silent:true });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab create', msg);
    syncLabSet('ошибка создания: ' + msg, 'bad');
    alert(msg);
    return false;
  }
}
async function syncLabDeleteCloud() {
  const id = syncLabState.selectedId;
  if (!id) {
    syncLabSet('сначала выберите тестовую задачу', 'warn');
    return false;
  }
  const client = getSupabaseClient();
  if (!client) {
    syncLabSet('нет облачного подключения', 'bad');
    alert('Облачное подключение недоступно.');
    return false;
  }
  try {
    const user = await getActiveCloudUser(client);
    const now = nowISO();
    const { error } = await client.from('tasks')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;
    syncLabSet('deleted_at записан', 'ok');
    await syncLabReadCloud({ silent:true });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Sync Lab delete', msg);
    syncLabSet('ошибка удаления: ' + msg, 'bad');
    alert(msg);
    return false;
  }
}
function syncLabClearScreen() {
  syncLabState.rows = [];
  syncLabState.activeRows = [];
  syncLabState.deletedRows = [];
  syncLabState.selectedId = '';
  syncLabSet('экран теста очищен', 'warn');
}
function syncLabPick(id) {
  syncLabState.selectedId = id || '';
  syncLabSet(syncLabState.selectedId ? 'тестовая задача выбрана' : 'выбор сброшен', syncLabState.selectedId ? 'ok' : 'warn');
}

function renderSettings() {
  const signedIn = Boolean(syncDiagnostics.userId);
  return `<section class="settings-panel card user-sync-screen">
    <div><h2>Синхронизация и личное пространство</h2><p>Одно личное пространство на всех устройствах. Войдите под одним email и нажимайте одну кнопку «Синхронизировать».</p></div>
    <div class="notice"><strong>Версия 2.12.3</strong> · ${PERSONAL_MODE_TEXT} · Статус: ${escapeHtml(syncState.text)}. <span id="autoSyncInline" class="stat">полуавтоматическая синхронизация</span></div>
    ${personalSpaceBadge()}
    ${renderSafeSyncStatusCard()}
    ${renderSyncLab()}

    <section class="device-login-card card">
      <div class="device-login-head">
        <div>
          <span class="view-kicker">вход на устройстве</span>
          <h3>${signedIn ? 'Это устройство подключено' : 'Подключить это устройство'}</h3>
          <p>${signedIn ? 'Сессия активна. Можно синхронизировать задачи.' : 'Введите email, получите код и войдите.'}</p>
        </div>
        <span class="device-login-status ${signedIn ? 'ok' : 'warn'}">${signedIn ? 'вход выполнен' : 'нужен вход'}</span>
      </div>

      <div class="email-code-grid">
        <label>Email личного пространства
          <input id="syncEmail" value="${escapeHtml(settings.email || '')}" placeholder="name@example.com" inputmode="email" autocomplete="email" />
        </label>
        <label>Код из письма
          <input id="emailOtpCode" value="" placeholder="6 цифр из письма" inputmode="numeric" autocomplete="one-time-code" maxlength="12" />
        </label>
      </div>

      <div class="task-actions sync-actions">
        <button class="primary" id="sendEmailCode" type="button">Получить код</button>
        <button class="primary" id="verifyEmailCode" type="button">Войти</button>
      </div>

      <div class="auth-help-box iphone-help">
        <strong>Для iPhone:</strong> откройте приложение именно там, где будете работать — Safari или иконка на экране «Домой». Получите код на email, вернитесь в это же приложение, введите код и нажмите «Войти по коду».
      </div>
    </section>

    <section class="sync-diagnostics card">
      <h3>Состояние синхронизации</h3>
      <div class="sync-diagnostics-grid">
        <div><strong>email:</strong> ${syncDiagnostics.email ? escapeHtml(syncDiagnostics.email) : escapeHtml(settings.email || 'не указан')}</div>
        <div><strong>вход:</strong> ${syncDiagnostics.userId ? 'выполнен' : 'нужен вход по email'}</div>
        <div><strong>user_id:</strong> ${syncDiagnostics.userId ? escapeHtml(syncDiagnostics.userId) : 'не определён'}</div>
        <div><strong>режим:</strong> личное пространство</div>
        <div><strong>локально задач:</strong> ${activeTasks().length}</div>
        <div><strong>ожидает отправки:</strong> ${dirtyTaskCount()}</div>
        <div><strong>активных задач в облаке:</strong> ${syncDiagnostics.remoteTasks === null ? 'не проверено' : syncDiagnostics.remoteTasks}</div>
        <div><strong>последняя проверка:</strong> ${syncDiagnostics.lastCheckedAt || 'не было'}</div>
        <div><strong>последняя локальная задача:</strong> ${escapeHtml(latestLocalTaskTitle())}</div>
        <div><strong>последняя задача в облаке:</strong> ${escapeHtml(syncDiagnostics.lastCloudTask || 'не проверено')}</div>
        <div><strong>последняя выгрузка:</strong> ${syncDiagnostics.lastPushAt || 'не было'}</div>
        <div><strong>последняя загрузка:</strong> ${syncDiagnostics.lastPullAt || 'не было'}</div>
        <div><strong>последняя операция синхронизации:</strong> ${escapeHtml(latestSyncAuditText() || 'нет')}</div>
        <div><strong>последняя ошибка приложения:</strong> ${escapeHtml(lastAppErrorText() || 'нет')}</div>
        ${syncDiagnostics.lastError ? `<div><strong>последняя ошибка:</strong> ${escapeHtml(syncDiagnostics.lastError)}</div>` : ''}
      </div>
      <div class="task-actions sync-actions">
        <button class="primary simple-sync-main" id="syncTasksBothWays" type="button">Синхронизировать</button>
        <button class="ghost" id="checkCloud" type="button">Проверить состояние</button>
        <button class="ghost" id="hardRefreshApp" type="button">Обновить приложение</button>
        <button class="danger" id="logoutCloud" type="button">Выйти</button>
      </div>
    </section>

    <input id="syncUrl" type="hidden" value="${escapeHtml(normalizeSupabaseUrl(settings.supabaseUrl || DEFAULT_SUPABASE_URL))}" />
    <input id="syncKey" type="hidden" value="${escapeHtml(settings.supabaseAnonKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY)}" />

    <div class="notice profile-empty-note"><strong>Профиль заполняется пользователем.</strong> Эти данные не подставляются заранее и хранятся в личном пространстве текущего email.</div>
<section class="admin-mode-note card">
      <h3>Административный режим</h3>
      <p>Тонкие настройки скрыты от обычных пользователей. Включайте их только для настройки приложения.</p>
      <div class="task-actions">
        ${settings.adminMode ? '<button class="danger" id="disableAdminMode" type="button">Выключить административный режим</button>' : '<button class="ghost" id="enableAdminMode" type="button">Включить административный режим</button>'}
      </div>
    </section>
    <div class="settings-grid">
      <label>Фамилия, имя, отчество <input id="profileFio" value="${escapeHtml(settings.fio || '')}" /></label>
      <label>Должность <input id="profilePosition" value="${escapeHtml(settings.position || '')}" /></label>
      <label>Учреждение <input id="profileInstitution" value="${escapeHtml(settings.institution || '')}" /></label>
      <label>Подразделение <input id="profileDepartment" value="${escapeHtml(settings.department || '')}" /></label>
      <label>Часы по умолчанию <input id="profileDefaultHours" type="number" min="0" step="0.5" value="${settings.defaultHours === undefined || settings.defaultHours === null ? '' : settings.defaultHours}" /></label>
      <label>Быстрые проекты / теги <input id="profileQuickProjects" value="${escapeHtml(favoriteProjects().join(', '))}" placeholder="Например: МЗМО, РДКБ, Сколтех" /></label>
      <label>Автоархив выполненных задач, дней <input id="profileAutoArchiveDays" type="number" min="1" step="1" value="${settings.autoArchiveDays || 90}" /><small>По умолчанию 90 дней — один квартал. При изменении срока приложение выгружает резервную копию.</small></label>
      <label class="checkline"><input id="profileAutoSync" type="checkbox" ${settings.autoSync ? 'checked' : ''}/> Автосинхронизация</label>
      <div class="task-actions" style="align-items:end"><button class="primary" id="saveProfile" type="button">Сохранить профиль</button><button class="ghost" id="resetProfileFields" type="button">Очистить профиль</button></div>
    </div>

    <div class="settings-grid">
      <button class="ghost" id="exportBackup" type="button">Резервная копия всех данных</button>
      <label class="ghost" style="text-align:center; cursor:pointer">Восстановить из JSON<input id="importJson" type="file" accept="application/json" style="display:none" /></label>
    </div>
  </section>`;
}
function renderAbout() {
  return `<section class="settings-panel card about-page">
    <div><h2>О приложении</h2><p>«Квадрат задач» — личный диспетчер задач, проектов и табеля в режиме независимого личного пространства. Логика: быстрый ввод → разбор → план дня → контроль → отметка работы по проекту.</p></div>
    <div class="about-grid">
      <div class="summary-card"><h4>1. Быстрый ввод</h4><p>Напиши задачу одной строкой. Быстрый тег #МЗМО / #РДКБ / #Сколтех сразу назначает проект.</p></div>
      <div class="summary-card"><h4>2. План дня</h4><p>Экран «Сегодня» работает по Айви Ли и 1–3–5: одна главная, три важные, пять мелких.</p></div>
      <div class="summary-card"><h4>3. Проекты</h4><p>Создай проект в разделе «Проекты». Дальше задачи и табель привязываются к нему как к отдельной сущности.</p></div>
      <div class="summary-card"><h4>4. Канбан</h4><p>Канбан показывает не хаос карточек, а статус → проект → задачи-ссылки. Нажатие открывает задачу.</p></div>
      <div class="summary-card"><h4>5. Табель</h4><p>Отмечай часы по проектам. Табель можно вывести по всем проектам или по конкретному проекту.</p></div>
      <div class="summary-card"><h4>6. Синхронизация</h4><p>После входа данные синхронизируются автоматически. Каждый пользователь видит только своё личное пространство.</p></div>
    </div>
    <div class="notice">Резервная копия: вкладка «Синхронизация» → «Резервная копия всех данных». В версии 2.2.1 есть личное пространство пользователя, управленческая панель, админ-настройка вкладок, календарь .ics, документы-ссылки, дашборд проектов, паспорта проектов, недельный отчёт и автоархив.</div>
  </section>`;
}

function renderPromises() {
  const open = activePromises().filter(p => p.status !== 'done');
  return `<section class="section-head"><div><h2>Контроль обещаний</h2><p>Что ты обещал и что обещали тебе. Это отдельный контрольный контур.</p></div></section>
  <section class="card project-form-card"><h3>Добавить обещание</h3><div class="project-form-grid">
    <label>Проект<input id="promiseProject" list="projectList" placeholder="Проект" /></label>
    <label>Кто<input id="promiseWho" placeholder="ФИО / организация" /></label>
    <label>Направление<select id="promiseDirection"><option value="to_me">Мне обещали</option><option value="me_to">Я обещал</option></select></label>
    <label>Дата проверки<input id="promiseCheck" type="date" /></label>
  </div><label class="full-label">Что обещано<textarea id="promiseText" rows="2"></textarea></label><div class="task-actions"><button class="primary" id="addPromiseBtn" type="button">Добавить</button></div></section>
  <div class="task-list">${open.map(p => `<article class="task-card"><p class="task-title">${escapeHtml(p.text)}</p><div class="task-meta"><span class="badge">${escapeHtml(projectName(p.projectId))}</span><span class="badge">${p.direction === 'me_to' ? 'я обещал' : 'мне обещали'}</span>${p.checkDate ? `<span class="badge ${p.checkDate < today() ? 'overdue' : ''}">проверить: ${dateLabel(p.checkDate)}</span>` : ''}</div><p class="task-note">${escapeHtml(p.who || '')}</p><div class="task-actions"><button class="mini-btn" data-action="donePromise" data-id="${p.id}" type="button">Выполнено</button></div></article>`).join('') || '<div class="empty">Открытых обещаний нет</div>'}</div>`;
}
function addPromiseFromForm() {
  const text = $('promiseText')?.value.trim();
  if (!text) return alert('Заполни обещание.');
  const projectId = projectValueFromInput($('promiseProject')?.value || '');
  promises.unshift(normalizePromise({ projectId, text, who: $('promiseWho')?.value.trim() || '', direction: $('promiseDirection')?.value || 'to_me', checkDate: $('promiseCheck')?.value || '' }));
  persistAll({ renderNow: true, sync: true });
}
function donePromise(id) {
  promises = promises.map(p => p.id === id ? normalizePromise({ ...p, status:'done', updatedAt: nowISO() }) : p);
  persistAll({ renderNow: true, sync: true });
}
function renderDecisions() {
  const list = activeDecisions();
  return `<section class="section-head"><div><h2>Журнал решений</h2><p>Фиксация решений по проектам: дата, суть, влияние и следующее действие.</p></div></section>
  <section class="card project-form-card"><h3>Добавить решение</h3><div class="project-form-grid">
    <label>Проект<input id="decisionProject" list="projectList" placeholder="Проект" /></label>
    <label>Дата<input id="decisionDate" type="date" value="${today()}" /></label>
    <label>Кто принял / владелец<input id="decisionOwner" placeholder="ФИО / орган / команда" /></label>
    <label>Заголовок<input id="decisionTitle" placeholder="Коротко" /></label>
  </div><label class="full-label">Решение<textarea id="decisionText" rows="2"></textarea></label><label class="full-label">Что меняет / следующее действие<textarea id="decisionImpact" rows="2"></textarea></label><div class="task-actions"><button class="primary" id="addDecisionBtn" type="button">Добавить решение</button></div></section>
  <div class="task-list">${list.map(d => `<article class="task-card"><p class="task-title">${escapeHtml(d.title)}</p><div class="task-meta"><span class="badge">${escapeHtml(projectName(d.projectId))}</span><span class="badge">${dateLabel(d.date)}</span></div><p class="task-note">${escapeHtml(d.text)}${d.impact ? '\\n' + escapeHtml(d.impact) : ''}</p></article>`).join('') || '<div class="empty">Решений пока нет</div>'}</div>`;
}
function addDecisionFromForm() {
  const title = $('decisionTitle')?.value.trim() || 'Решение';
  const text = $('decisionText')?.value.trim();
  if (!text) return alert('Заполни текст решения.');
  const projectId = projectValueFromInput($('decisionProject')?.value || '');
  decisions.unshift(normalizeDecision({ projectId, title, text, date: $('decisionDate')?.value || today(), owner: $('decisionOwner')?.value.trim() || '', impact: $('decisionImpact')?.value.trim() || '' }));
  persistAll({ renderNow: true, sync: true });
}
function renderTemplates() {
  const list = activeTaskTemplates();
  return `<section class="section-head"><div><h2>Шаблоны задач</h2><p>Быстро создавай типовые задачи: АПР, МТЗ, письмо, протокол, проверка ТХ.</p></div></section>
  <section class="card project-form-card"><h3>Создать шаблон</h3><div class="project-form-grid">
    <label>Название шаблона<input id="templateName" placeholder="Проверить АПР" /></label>
    <label>Заголовок задачи<input id="templateTitle" placeholder="Проверить АПР по объекту..." /></label>
    <label>Проект<input id="templateProject" list="projectList" placeholder="опционально" /></label>
    <label>Приоритет<select id="templatePriority"><option>A</option><option>B</option><option selected>C</option><option>D</option><option>E</option></select></label>
  </div><label class="full-label">Комментарий<textarea id="templateNote" rows="2" placeholder="чек-лист, что проверить"></textarea></label><div class="task-actions"><button class="primary" id="addTemplateBtn" type="button">Сохранить шаблон</button></div></section>
  <div class="grid-2">${list.map(t => `<section class="column"><h3>${escapeHtml(t.name)}</h3><p class="task-note">${escapeHtml(t.title || t.note || '')}</p><div class="task-actions"><button class="mini-btn" data-action="useTemplate" data-id="${t.id}" type="button">Создать задачу</button><button class="mini-btn" data-action="deleteTemplate" data-id="${t.id}" type="button">Удалить</button></div></section>`).join('') || '<div class="empty">Шаблонов пока нет</div>'}</div>`;
}
function addTemplateFromForm() {
  const name = $('templateName')?.value.trim();
  if (!name) return alert('Укажи название шаблона.');
  const projectId = projectValueFromInput($('templateProject')?.value || '');
  taskTemplates.unshift(normalizeTaskTemplate({ name, title: $('templateTitle')?.value.trim() || name, projectId, priority: $('templatePriority')?.value || 'C', note: $('templateNote')?.value.trim() || '' }));
  persistAll({ renderNow: true, sync: true });
}
function useTemplate(id) {
  const t = taskTemplates.find(x => x.id === id);
  if (!t) return;
  const created = normalizeTask({ title: t.title || t.name, projectId: t.projectId, project: projectName(t.projectId), status: t.status, priority: t.priority, importance: t.importance, urgency: t.urgency, dayBucket: t.dayBucket, note: t.note });
  tasks.unshift(created);
  markTaskDirty(created.id);
  currentView = 'inbox';
  saveTasks();
}
function deleteTemplate(id) {
  taskTemplates = taskTemplates.map(t => t.id === id ? normalizeTaskTemplate({ ...t, deletedAt: nowISO(), updatedAt: nowISO() }) : t);
  persistAll({ renderNow: true, sync: true });
}
function renderGlobalSearch() {
  const q = (($('globalSearchInput')?.value || $('searchInput')?.value || '')).trim().toLowerCase();
  const match = (arr) => !q ? [] : arr.filter(x => JSON.stringify(x).toLowerCase().includes(q));
  const rt = match(activeTasks());
  const rp = match(activeProjects({ includeArchived:true }));
  const rm = match(activeProjectMembers());
  const rd = match(activeDecisions());
  const rpr = match(activePromises());
  return `<section class="section-head"><div><span class="view-kicker">быстрый доступ</span><h2>Поиск</h2><p>Ищет по задачам, проектам, участникам, решениям и обещаниям.</p></div></section>
  <section class="search-command card"><input id="globalSearchInput" placeholder="Введите запрос: объект, человек, решение, задача…" value="${escapeHtml(q)}" /><button class="primary compact-primary" id="runGlobalSearchBtn" type="button">Искать</button></section>
  ${!q ? '<div class="empty">Введите запрос для поиска</div>' : `<div class="grid-2 search-results-grid"><section class="column"><h3>Задачи <span class="muted-count">${rt.length}</span></h3>${listHtml(rt, 'Нет совпадений')}</section><section class="column"><h3>Проекты <span class="muted-count">${rp.length}</span></h3>${rp.map(p => projectMiniCard(p)).join('') || '<div class="empty">Нет совпадений</div>'}</section><section class="column"><h3>Участники <span class="muted-count">${rm.length}</span></h3>${rm.map(m => `<div class="summary-card"><h4>${escapeHtml(m.name)}</h4><p>${escapeHtml(m.role)} · ${escapeHtml(projectName(m.projectId))}</p></div>`).join('') || '<div class="empty">Нет совпадений</div>'}</section><section class="column"><h3>Решения / обещания <span class="muted-count">${rd.length + rpr.length}</span></h3>${[...rd.map(d => `<div class="summary-card"><h4>${escapeHtml(d.title)}</h4><p>${escapeHtml(projectName(d.projectId))}</p></div>`), ...rpr.map(p => `<div class="summary-card"><h4>${escapeHtml(p.text)}</h4><p>${escapeHtml(p.who)} · ${escapeHtml(projectName(p.projectId))}</p></div>`)].join('') || '<div class="empty">Нет совпадений</div>'}</section></div>`}`;
}

function renderEveningReview() {
  const done = activeTasks().filter(t => t.status === 'done' && t.doneAt && t.doneAt.slice(0,10) === today());
  const unfinished = activeTasks().filter(t => t.status !== 'done' && t.planDate === today());
  const logs = activeWorkLogs().filter(l => l.date === today());
  return `<section class="section-head"><div><h2>Вечерний разбор</h2><p>Что закрыто, что перенести и над чем реально работал по табелю.</p></div><div class="task-actions"><button class="ghost" id="moveUnfinishedTomorrow" type="button">Перенести незакрытое на завтра</button></div></section>
  <div class="grid-2"><section class="column"><h3>Закрыто сегодня</h3>${listHtml(done, 'Сегодня закрытых задач нет')}</section><section class="column"><h3>Перенести / решить</h3>${listHtml(unfinished, 'На сегодня незакрытых задач нет')}</section><section class="column"><h3>Табель сегодня</h3>${logs.map(l => `<div class="summary-card"><h4>${escapeHtml(projectName(l.projectId,l.project))}</h4><p>${l.hours} ч · ${escapeHtml(l.comment || '')}</p></div>`).join('') || '<div class="empty">Отметок нет</div>'}</section></div>`;
}
function moveUnfinishedToTomorrow() {
  const ids = activeTasks().filter(t => t.status !== 'done' && t.planDate === today()).map(t => t.id);
  tasks = tasks.map(t => ids.includes(t.id) ? normalizeTask({ ...t, planDate: addDays(1), updatedAt: nowISO() }) : t);
  ids.forEach(markTaskDirty);
  persistAll({ renderNow: true, sync: true });
}



function renderAdminLocked() {
  return `<section class="settings-panel card admin-locked-panel">
    <div><h2>Панель администратора скрыта</h2><p>Обычным пользователям не показываются тонкие настройки интерфейса, виджетов, порогов и системных параметров.</p></div>
    <div class="notice">Для ежедневной работы используйте разделы «День», «Сегодня», «Управление», «Проекты», «Канбан», «Поиск», «Табель» и «Синхронизация».</div>
    <div class="task-actions"><button class="ghost" id="backToDayFromAdmin" type="button">Вернуться в День</button></div>
  </section>`;
}
function enableAdminMode() {
  settings.adminMode = true;
  saveSettings({ renderNow:false });
  currentView = 'admin';
  render();
}
function disableAdminMode() {
  settings.adminMode = false;
  settings.visibleViews = (settings.visibleViews || defaultVisibleViews()).filter(v => v !== 'admin');
  saveSettings({ renderNow:false });
  currentView = 'commander';
  render();
}

function renderAdminPanel() {
  const views = defaultVisibleViews();
  const widgets = defaultDashboardWidgets();
  const currentViews = settings.visibleViews || defaultVisibleViews();
  const currentWidgets = settings.dashboardWidgets || defaultDashboardWidgets();
  const users = activeAdminUsers();
  const docs = activeProjectDocs();
  const presetInfo = [
    ['leader','Руководитель','Управление, риски, проекты, решения, табель.'],
    ['executor','Исполнитель','Сегодня, разбор, Канбан, проекты, вечер.'],
    ['iphone','iPhone','Минимальное меню для телефона.'],
    ['full','Полный','Все разделы приложения.']
  ];
  const viewGroups = [
    ['Ежедневная работа', ['commander','today','tomorrow','week','inbox','evening']],
    ['Управление', ['pmcontrol','dashboard','stuck','delegate','noproject','projects','kanban']],
    ['Контроль', ['promises','decisions','templates','searchall','timesheet','archive']],
    ['Система', ['settings','admin','about']]
  ];
  return `<section class="section-head view-hero admin-clean-title"><div><span class="view-kicker">настройки системы</span><h2>Панель администратора</h2><p>Настройка интерфейса без общей доски. Каждый пользователь работает в своём личном пространстве.</p></div></section>

    <section class="admin-clean-hero card">
      <div class="admin-clean-status"><span>Режим</span><strong>Личное пространство</strong><small>общих проектов нет</small></div>
      <div><span>Меню</span><strong>${currentViews.length}</strong><small>вкладок включено</small></div>
      <div><span>Панель</span><strong>${currentWidgets.length}</strong><small>виджетов активно</small></div>
      <div><span>Пользователи</span><strong>${users.length}</strong><small>в справочнике</small></div>
      <div><span>Документы</span><strong>${docs.length}</strong><small>ссылок сохранено</small></div>
    </section>

    <section class="admin-clean-grid">
      <div class="card admin-clean-card admin-clean-card--wide">
        <div class="admin-card-head"><div><h3>Быстрый режим интерфейса</h3><p>Выбери сценарий меню. Это не удаляет данные, а только меняет видимость разделов.</p></div></div>
        <div class="admin-preset-row">${presetInfo.map(([key,title,desc]) => `<button class="admin-preset-compact" data-action="adminPreset" data-preset="${key}" type="button"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div>
      </div>

      <div class="card admin-clean-card admin-clean-card--wide">
        <div class="admin-card-head"><div><h3>Вкладки верхнего меню</h3><p>Оставь только те разделы, которые реально нужны в работе.</p></div><b>${currentViews.length}</b></div>
        <div class="admin-group-list">${viewGroups.map(([title, groupViews]) => `<div class="admin-toggle-group"><h4>${title}</h4><div class="admin-toggle-list">${groupViews.filter(v => views.includes(v)).map(v => `<label class="admin-switch"><input type="checkbox" class="admin-view-check" value="${v}" ${currentViews.includes(v) ? 'checked' : ''}/><span class="switch-ui"></span><span class="switch-text">${escapeHtml(viewLabels[v] || v)}</span></label>`).join('')}</div></div>`).join('')}</div>
        <div class="admin-button-row"><button class="primary compact-primary" id="saveAdminViews" type="button">Сохранить меню</button><button class="ghost compact-primary" id="resetAdminViews" type="button">Показать всё</button></div>
      </div>

      <div class="card admin-clean-card">
        <div class="admin-card-head"><div><h3>Руководительская панель</h3><p>Какие блоки показывать во вкладке «Управление».</p></div><b>${currentWidgets.length}</b></div>
        <div class="admin-widget-list">${widgets.map(w => `<label class="admin-widget-switch"><input type="checkbox" class="admin-widget-check" value="${w}" ${currentWidgets.includes(w) ? 'checked' : ''}/><span><strong>${escapeHtml(widgetLabels[w] || w)}</strong><small>${adminWidgetHint(w)}</small></span></label>`).join('')}</div>
      </div>

      <div class="card admin-clean-card">
        <div class="admin-card-head"><div><h3>Пороги контроля</h3><p>Настройки риска и календаря.</p></div></div>
        <div class="admin-number-grid">
          <label>Предупреждать о сроке за, дней<input id="adminAlertDays" type="number" min="1" value="${settings.alertDays || 3}" /></label>
          <label>Перегруз проекта, задач<input id="adminOverloadLimit" type="number" min="1" value="${settings.projectOverloadLimit || 20}" /></label>
          <label>Горизонт календаря, дней<input id="adminCalendarHorizon" type="number" min="7" value="${settings.calendarHorizonDays || 90}" /></label>
        </div>
        <div class="admin-button-row"><button class="primary compact-primary" id="saveAdminWidgets" type="button">Сохранить панель</button></div>
      </div>

      <div class="card admin-clean-card">
        <div class="admin-card-head"><div><h3>Пользователи</h3><p>Справочник независимых пользователей. Доступы не объединяются.</p></div></div>
        <div class="admin-invite-compact"><span>Новый пользователь входит по своему email и видит только свои данные.</span><button class="ghost compact-primary" id="copyAdminInvite" type="button">Скопировать инструкцию</button></div>
        <div class="admin-form-stack">
          <input id="adminUserName" placeholder="Имя пользователя" />
          <input id="adminUserEmail" placeholder="email" />
          <select id="adminUserRole"><option>Руководитель</option><option>Исполнитель</option><option>Эксперт</option><option>Наблюдатель</option></select>
          <textarea id="adminUserNote" rows="2" placeholder="Комментарий"></textarea>
          <button class="primary compact-primary" id="addAdminUser" type="button">Добавить пользователя</button>
        </div>
        <div class="admin-list compact-list">${users.map(u => `<article class="admin-list-item"><div><strong>${escapeHtml(u.name)}</strong><span>${escapeHtml(u.role)} · ${escapeHtml(u.email || 'email не указан')}</span><small>${escapeHtml(u.note || 'Личное пространство')}</small></div><button class="mini-btn" data-action="deleteAdminUser" data-id="${u.id}" type="button">Удалить</button></article>`).join('') || '<div class="empty">Пользователи не добавлены</div>'}</div>
      </div>

      <div class="card admin-clean-card">
        <div class="admin-card-head"><div><h3>Документы</h3><p>Ссылки на Я.Диск, папки проекта и рабочие файлы.</p></div></div>
        <div class="admin-form-stack">
          <input id="docProject" list="projectList" placeholder="Проект" />
          <input id="docTitle" placeholder="Название документа или папки" />
          <input id="docUrl" placeholder="https://disk.yandex.ru/..." />
          <select id="docType"><option value="folder">Папка проекта</option><option value="doc">Документ</option><option value="link">Ссылка</option></select>
          <textarea id="docNote" rows="2" placeholder="Комментарий"></textarea>
          <button class="primary compact-primary" id="addProjectDoc" type="button">Добавить ссылку</button>
        </div>
        <div class="admin-list compact-list">${docs.map(d => `<article class="admin-list-item"><div><strong><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.title)}</a></strong><span>${escapeHtml(projectName(d.projectId))} · ${escapeHtml(d.type)}</span><small>${escapeHtml(d.note || '')}</small></div><button class="mini-btn" data-action="deleteProjectDoc" data-id="${d.id}" type="button">Удалить</button></article>`).join('') || '<div class="empty">Документы не добавлены</div>'}</div>
      </div>
    </section>`;
}
function adminWidgetHint(w) {
  const hints = {
    health:'сводный статус проектов',
    timeline:'сроки, вехи и прогресс',
    alerts:'просрочка и приближение дедлайнов',
    progress:'закрытые задачи по дням',
    workload:'загрузка и объём задач',
    documents:'ссылки на папки и файлы',
    calendar:'выгрузка .ics для iPhone',
    team:'справочник независимых пользователей'
  };
  return hints[w] || '';
}
function adminPresetViews(name) {
  const base = ['settings','admin'];
  const presets = {
    leader: ['commander','today','week','pmcontrol','dashboard','inbox','stuck','delegate','noproject','kanban','projects','promises','decisions','evening','searchall','timesheet','archive','settings','admin','about'],
    executor: ['commander','today','tomorrow','week','inbox','kanban','projects','evening','timesheet','settings','about'],
    iphone: ['commander','today','tomorrow','inbox','projects','timesheet','settings'],
    full: defaultVisibleViews()
  };
  const picked = presets[name] || presets.leader;
  return [...new Set([...picked, ...base])];
}
function applyAdminPreset(name) {
  settings.visibleViews = adminPresetViews(name);
  saveSettings({ renderNow:true });
  const label = name === 'leader' ? 'Руководитель' : name === 'executor' ? 'Исполнитель' : name === 'iphone' ? 'iPhone / минимум' : 'Полный режим';
  alert(`Применён сценарий меню: ${label}`);
}
function saveAdminViews() {
  settings.visibleViews = [...document.querySelectorAll('.admin-view-check:checked')].map(x => x.value);
  if (settings.adminMode && !settings.visibleViews.includes('admin')) settings.visibleViews.push('admin');
  if (!settings.visibleViews.includes('settings')) settings.visibleViews.push('settings');
  saveSettings({ renderNow:true });
  alert('Состав меню сохранён.');
}
function resetAdminViews() { settings.visibleViews = defaultVisibleViews(); saveSettings({ renderNow:true }); }
function saveAdminWidgets() {
  settings.dashboardWidgets = [...document.querySelectorAll('.admin-widget-check:checked')].map(x => x.value);
  settings.alertDays = Number($('adminAlertDays')?.value || 3);
  settings.projectOverloadLimit = Number($('adminOverloadLimit')?.value || 20);
  settings.calendarHorizonDays = Number($('adminCalendarHorizon')?.value || 90);
  saveSettings({ renderNow:true });
  alert('Руководительская панель сохранена.');
}
function adminInviteText() {
  return `Квадрат задач — личное пространство для управления проектами и задачами.

Ссылка: https://popovmaximmichailovich-oss.github.io/kvadrat-zadach/?v=231

Как войти:
1. Открой ссылку.
2. Перейди во вкладку «Синхр.».
3. Введи свой email.
4. Нажми «Сохранить настройки».
5. Нажми «Отправить ссылку входа».
6. Открой письмо на этом же устройстве.
7. Вернись в приложение и нажми «Синхронизировать».

Важно: каждый пользователь работает в своём личном пространстве. Другие пользователи не видят твои проекты и задачи.`;
}
async function copyAdminInvite() {
  try {
    await navigator.clipboard.writeText(adminInviteText());
    alert('Инструкция скопирована.');
  } catch {
    alert(adminInviteText());
  }
}
function addAdminUserFromForm() {
  const email = $('adminUserEmail')?.value.trim() || '';
  const name = $('adminUserName')?.value.trim() || email || 'Пользователь';
  adminUsers.unshift(normalizeAdminUser({ name, email, role:$('adminUserRole')?.value || 'Исполнитель', mode:'Личное пространство', note:$('adminUserNote')?.value || '' }));
  persistAll({ renderNow:true, sync:false });
}
function deleteAdminUser(id) { adminUsers = adminUsers.map(u => u.id === id ? normalizeAdminUser({ ...u, deletedAt: nowISO(), updatedAt: nowISO() }) : u); persistAll({ renderNow:true, sync:false }); }
function addProjectDocFromForm() {
  const title = $('docTitle')?.value.trim();
  const url = $('docUrl')?.value.trim();
  if (!title || !url) return alert('Укажи название и ссылку на документ.');
  const projectId = projectValueFromInput($('docProject')?.value || '');
  projectDocs.unshift(normalizeProjectDoc({ projectId, title, url, type:$('docType')?.value || 'link', note:$('docNote')?.value || '' }));
  persistAll({ renderNow:true, sync:false });
}
function deleteProjectDoc(id) { projectDocs = projectDocs.map(d => d.id === id ? normalizeProjectDoc({ ...d, deletedAt: nowISO(), updatedAt: nowISO() }) : d); persistAll({ renderNow:true, sync:false }); }

function userVisibleViews() {
  const allowedForUser = ['commander','today','pmcontrol','tomorrow','week','projects','kanban','inbox','stuck','delegate','noproject','promises','decisions','evening','searchall','timesheet','archive','settings','about'];
  const base = Array.isArray(settings.visibleViews) && settings.visibleViews.length ? settings.visibleViews : defaultVisibleViews();
  return settings.adminMode ? [...new Set([...base, 'admin'])] : base.filter(v => v !== 'admin' && allowedForUser.includes(v));
}
function applyVisibleViews() {
  const visible = userVisibleViews();
  document.querySelectorAll('.tab').forEach(btn => {
    const v = btn.dataset.view;
    btn.style.display = visible.includes(v) || v === 'settings' ? '' : 'none';
  });
}
function render() {
  document.body.dataset.currentView = currentView;
  renderProjectOptions();
  renderStats();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  applyVisibleViews();
  const root = $('viewRoot');
  root.innerHTML = currentView === 'today' || currentView === 'tomorrow' ? renderToday()
    : currentView === 'week' ? renderWeek()
    : currentView === 'dashboard' ? renderDashboard()
    : currentView === 'pmcontrol' ? renderPmControl()
    : currentView === 'admin' ? (settings.adminMode ? renderAdminPanel() : renderAdminLocked())
    : currentView === 'commander' ? renderCommander()
    : currentView === 'stuck' ? renderStuckTasks()
    : currentView === 'delegate' ? renderDelegateMode()
    : currentView === 'noproject' ? renderNoProject()
    : currentView === 'promises' ? renderPromises()
    : currentView === 'decisions' ? renderDecisions()
    : currentView === 'templates' ? renderTemplates()
    : currentView === 'searchall' ? renderGlobalSearch()
    : currentView === 'evening' ? renderEveningReview()
    : currentView === 'report' ? renderWeeklyReport()
    : currentView === 'inbox' ? renderInbox()
    : currentView === 'matrix' ? renderMatrix()
    : currentView === 'kanban' ? renderKanban()
    : currentView === 'projects' ? renderProjects()
    : currentView === 'timesheet' ? renderTimesheet()
    : currentView === 'archive' ? renderArchive()
    : currentView === 'about' ? renderAbout()
    : renderSettings();
  bindDynamicActions();
  bindSyncPanelButtons();
}

async function logoutCloud() {
  const client = getSupabaseClient();
  if (!client) return;
  try { await client.auth.signOut({ scope:'local' }); } catch (e) { console.warn(e); }
  syncDiagnostics.userId = '';
  syncDiagnostics.email = settings.email || '';
  syncDiagnostics.remoteTasks = null;
  syncDiagnostics.lastError = '';
  setSyncState('выход выполнен · нужен вход по email', 'warn');
  render();
}

async function signOut() {
  return logoutCloud();
}

function runAppSelfCheck() {
  const savedView = currentView;
  const errors = [];
  const checks = [];
  const mark = (name, ok, detail='') => { checks.push(`${ok ? '✓' : '✗'} ${name}${detail ? ': ' + detail : ''}`); if (!ok) errors.push(name + (detail ? ': ' + detail : '')); };
  try {
    localStorage.setItem('kvadrat-zadach-selftest', 'ok');
    mark('localStorage', localStorage.getItem('kvadrat-zadach-selftest') === 'ok');
    localStorage.removeItem('kvadrat-zadach-selftest');
  } catch (e) { mark('localStorage', false, e.message); }
  try { mark('основные данные', Array.isArray(tasks) && Array.isArray(projects) && Array.isArray(workLogs)); } catch (e) { mark('основные данные', false, e.message); }
  try { mark('профиль пользователя', settings && typeof settings === 'object'); } catch (e) { mark('профиль пользователя', false, e.message); }
  try { mark('облачное подключение', Boolean(settings.supabaseUrl && settings.supabaseAnonKey), settings.email ? settings.email : 'email может быть пустым до входа'); } catch (e) { mark('облачное подключение', false, e.message); }
  try {
    const actions = [...document.querySelectorAll('[data-action]')].map(x => x.dataset.action).filter(Boolean);
    mark('активные кнопки', actions.length >= 1, `${actions.length} обработчиков на текущем экране`);
  } catch (e) { mark('активные кнопки', false, e.message); }
  try {
    mark('мобильное нижнее меню', document.querySelectorAll('[data-mobile-view]').length >= 5, `${document.querySelectorAll('[data-mobile-view]').length} кнопок`);
  } catch (e) { mark('мобильное нижнее меню', false, e.message); }
  const views = [...new Set((typeof userVisibleViews === 'function' ? userVisibleViews() : defaultVisibleViews()).filter(v => v !== 'admin'))];
  for (const v of views) {
    try {
      currentView = v;
      render();
      const html = $('viewRoot')?.innerHTML || '';
      mark(`экран ${viewLabels[v] || v}`, html.length > 20, `${html.length} символов`);
    } catch (e) { mark(`экран ${viewLabels[v] || v}`, false, e.message); }
  }
  try { currentView = savedView; render(); } catch (e) { console.warn('restore view after self-check failed', e); }
  syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
  if (errors.length) {
    syncDiagnostics.lastError = errors.slice(0,3).join('; ');
    setSyncState(`самопроверка: есть ошибки (${errors.length})`, 'bad');
  } else {
    syncDiagnostics.lastError = '';
    setSyncState(`самопроверка: успешно · ${checks.length} проверок`, 'ok');
  }
  alert(`Самопроверка приложения\n\n${checks.join('\n')}`);
  render();
}
function bindSyncPanelButtons() {
  const checkBtn = $('checkCloud');
  const pullBtn = $('pullCloud');
  const pushBtn = $('pushCloud');
  const logoutBtn = $('logoutCloud');
  const selfCheckBtn = $('runSelfCheck');
  const legacySignOutBtn = $('signOut');
  if (checkBtn) checkBtn.onclick = (e) => { e.preventDefault(); checkCloudConnection(); };
  if (pullBtn) pullBtn.onclick = (e) => { e.preventDefault(); pullFromCloud(); };
  if (pushBtn) pushBtn.onclick = (e) => { e.preventDefault(); pushToCloud(); };
  if ($('pushTasksOnly')) $('pushTasksOnly').onclick = (e) => { e.preventDefault(); pushTasksOnly({ silent:false, onlyDirty:true }); };
  if ($('pushAllLocalTasks')) $('pushAllLocalTasks').onclick = (e) => { e.preventDefault(); syncTasksBothWays({ silent:false, forceAll:true }); };
  if ($('pullTasksOnly')) $('pullTasksOnly').onclick = (e) => { e.preventDefault(); pullTasksOnly({ silent:false }); };
  if ($('syncTasksBothWays')) $('syncTasksBothWays').onclick = (e) => { e.preventDefault(); simpleOneButtonSync(); };
  if ($('sendDirtyTasks')) $('sendDirtyTasks').onclick = (e) => { e.preventDefault(); pushTasksOnly({ silent:false, onlyDirty:true }); };
  if ($('checkLastTaskCloud')) $('checkLastTaskCloud').onclick = (e) => { e.preventDefault(); verifyLastTaskInCloud(); };
  if (logoutBtn) logoutBtn.onclick = (e) => { e.preventDefault(); logoutCloud(); };
  if (legacySignOutBtn) legacySignOutBtn.onclick = (e) => { e.preventDefault(); signOut(); };
  if ($('forceAutoSyncNow')) $('forceAutoSyncNow').onclick = (e) => { e.preventDefault(); simpleOneButtonSync(); };
  if ($('hardRefreshApp')) $('hardRefreshApp').onclick = async (e) => { e.preventDefault(); await clearAppCaches(); location.reload(); };
  if ($('clearAppErrors')) $('clearAppErrors').onclick = (e) => { e.preventDefault(); clearAppErrors(); };
  if ($('syncLabDiagWrite')) $('syncLabDiagWrite').onclick = (e) => { e.preventDefault(); syncLabWriteDiagnostic(); };
  if ($('syncLabReadAny')) $('syncLabReadAny').onclick = (e) => { e.preventDefault(); syncLabReadAnyCloud(); };
  if ($('syncLabAuth')) $('syncLabAuth').onclick = (e) => { e.preventDefault(); syncLabRefreshAuthDiagnostic(); };
  if ($('syncLabCreate')) $('syncLabCreate').onclick = (e) => { e.preventDefault(); syncLabCreateCloud(); };
  if ($('syncLabRead')) $('syncLabRead').onclick = (e) => { e.preventDefault(); syncLabReadCloud(); };
  if ($('syncLabDelete')) $('syncLabDelete').onclick = (e) => { e.preventDefault(); syncLabDeleteCloud(); };
  if ($('syncLabFindById')) $('syncLabFindById').onclick = (e) => { e.preventDefault(); syncLabSetReadIdValue($('syncLabIdInput')?.value || ''); syncLabFindById(); };
  if ($('syncLabRead50')) $('syncLabRead50').onclick = (e) => { e.preventDefault(); syncLabRead50Updated(); };
  if ($('syncLabClear')) $('syncLabClear').onclick = (e) => { e.preventDefault(); syncLabClearScreen(); };
  if (selfCheckBtn) selfCheckBtn.onclick = (e) => { e.preventDefault(); runAppSelfCheck(); };
}
function openEdit(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  $('editId').value = t.id;
  $('editTitle').value = t.title;
  $('editProject').value = projectName(t.projectId, t.project) === 'Без проекта' ? '' : projectName(t.projectId, t.project);
  $('editPlanDate').value = t.planDate;
  $('editDueDate').value = t.dueDate;
  $('editStatus').value = t.status;
  $('editPriority').value = t.priority;
  $('editImportance').value = t.importance;
  $('editUrgency').value = t.urgency;
  $('editDayBucket').value = t.dayBucket;
  $('editNote').value = t.note;
  $('taskDialog').showModal();
}
function saveEdit(e) {
  e.preventDefault();
  const id = $('editId').value;
  const status = $('editStatus').value;
  const projectId = projectValueFromInput($('editProject').value);
  updateTask(id, {
    title: $('editTitle').value,
    projectId,
    project: projectName(projectId, ''),
    planDate: $('editPlanDate').value,
    dueDate: $('editDueDate').value,
    status,
    priority: $('editPriority').value,
    importance: $('editImportance').value,
    urgency: $('editUrgency').value,
    dayBucket: $('editDayBucket').value,
    note: $('editNote').value,
    doneAt: status === 'done' ? (tasks.find(t => t.id === id)?.doneAt || nowISO()) : null
  });
  $('taskDialog').close();
}

function showOpenTasksSummary() {
  const open = activeTasks().filter(t => t.status !== 'done');
  const overdue = open.filter(isOverdue);
  alert(`Открытых задач: ${open.length}\nПросрочено: ${overdue.length}\nБез проекта: ${open.filter(t => !t.projectId).length}`);
}
function showRiskSummary() {
  const alerts = projectAlerts();
  const lines = alerts.slice(0, 8).map((a,i) => `${i+1}. ${a.project?.name || 'Без проекта'} — ${a.text}`);
  alert(`Маркеров риска: ${alerts.length}${lines.length ? '\n\n' + lines.join('\n') : ''}`);
}
function openAdminDocs() {
  currentView = 'admin';
  render();
  setTimeout(() => {
    const el = [...document.querySelectorAll('.card h3')].find(x => x.textContent.includes('Документы'));
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 60);
}

function filterTodayFromStats() {
  currentView = 'today';
  render();
}
function openInboxFromStats() {
  currentView = 'inbox';
  render();
}
function openSyncFromStats() {
  currentView = 'settings';
  try {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view === 'settings'));
    document.querySelectorAll('[data-mobile-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.mobileView === 'settings'));
  } catch {}
  render();
  setTimeout(() => {
    const panel = document.querySelector('.user-sync-screen') || document.getElementById('view');
    if (panel) panel.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 50);
}
function setViewStuck(){ currentView='stuck'; render(); }
function setViewDelegate(){ currentView='delegate'; render(); }
function setViewNoProject(){ currentView='noproject'; render(); }
function openProjectsQuick(){ currentView='projects'; render(); }
function filterArchiveWeek(){ currentView='archive'; render(); }
function exportCalendarQuick(){ exportCalendarIcs(); }
function runGlobalSearchFromInput(){
  const q = $('globalSearchInput')?.value || '';
  if ($('searchInput')) $('searchInput').value = q;
  render();
}

function bindDynamicActions() {
  document.querySelectorAll('[data-action]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'clearQuickProject') { selectedQuickProjectId = ''; renderQuickTagBars(); }
    if (action === 'setKanbanMode') { settings.kanbanMode = btn.dataset.mode || 'compact'; saveSettings({ renderNow:false }); render(); }
    if (action === 'donePromise') donePromise(id);
    if (action === 'useTemplate') useTemplate(id);
    if (action === 'deleteTemplate') deleteTemplate(id);
    if (action === 'deleteAdminUser') deleteAdminUser(id);
    if (action === 'deleteProjectDoc') deleteProjectDoc(id);
    if (action === 'adminPreset') applyAdminPreset(btn.dataset.preset || 'leader');
    if (action === 'showDoneDay') showDoneDay(btn.dataset.date || '');
    if (action === 'showAnalyticsDetail') showAnalyticsDetail(btn.dataset.kind || '', btn.dataset.key || '');
    if (action === 'showOpenTasks') showOpenTasksSummary();
    if (action === 'showRiskSummary') showRiskSummary();
    if (action === 'openAdminDocs') openAdminDocs();
    if (action === 'setViewStuck') setViewStuck();
    if (action === 'setViewDelegate') setViewDelegate();
    if (action === 'setViewNoProject') setViewNoProject();
    if (action === 'openProjectsQuick') openProjectsQuick();
    if (action === 'filterArchiveWeek') filterArchiveWeek();
    if (action === 'exportCalendarQuick') exportCalendarQuick();
    if (action === 'filterTodayFromStats') filterTodayFromStats();
    if (action === 'openInboxFromStats') openInboxFromStats();
    if (action === 'openSyncFromStats') openSyncFromStats();
    if (action === 'checkCloudFromHome') checkCloudConnection();
    if (action === 'syncLabPick') syncLabPick(id);
    if (action === 'done') completeTask(id);
    if (action === 'restore') restoreTask(id);
    if (action === 'deleteTaskQuick') { if (confirm('Удалить задачу из списка?')) deleteTask(id); }
    if (action === 'today') updateTask(id, { planDate: today(), status: 'planned' });
    if (action === 'tomorrow') updateTask(id, { planDate: addDays(1), status: 'planned' });
    if (action === 'doing') updateTask(id, { status: 'doing' });
    if (action === 'edit') openEdit(id);
    if (action === 'logTaskProject') { const t = tasks.find(x => x.id === id); if (t) quickLogProject(t.projectId, t.title); }
    if (action === 'quickLogProject') quickLogProject(btn.dataset.projectId || btn.dataset.project || 'Без проекта');
    if (action === 'deleteWorkLog') deleteWorkLog(id);
    if (action === 'filterProject') { $('projectFilter').value = btn.dataset.projectId || 'all'; render(); }
    if (action === 'archiveProject') {
      const p = projectById(btn.dataset.projectId);
      if (p) updateProject(p.id, { status: p.status === 'archived' ? 'active' : 'archived' });
    }
    if (action === 'saveProjectPassport') saveProjectPassport(btn.dataset.projectId);
    if (action === 'addProjectMember') addProjectMemberFromForm(btn.dataset.projectId);
    if (action === 'deleteProjectMember') deleteProjectMember(btn.dataset.memberId);
    if (action === 'openProjects') { currentView = 'projects'; const pid = btn.dataset.projectId; render(); setTimeout(() => { const el = document.querySelector(`[data-project-id-card="${pid}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); }
  });
    document.querySelectorAll('[data-mobile-view]').forEach(btn => btn.onclick = () => { currentView = btn.dataset.mobileView || 'commander'; render(); });
  document.querySelectorAll('[data-mobile-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.mobileView === currentView));
document.querySelectorAll('[data-quick-project]').forEach(btn => btn.onclick = () => {
    const target = btn.closest('#editForm') ? 'edit' : 'quick';
    applyQuickProject(btn.dataset.quickProject || '', target);
  });
  if ($('createProjectBtn')) $('createProjectBtn').onclick = createProjectFromForm;
  if ($('addPromiseBtn')) $('addPromiseBtn').onclick = addPromiseFromForm;
  if ($('addDecisionBtn')) $('addDecisionBtn').onclick = addDecisionFromForm;
  if ($('addTemplateBtn')) $('addTemplateBtn').onclick = addTemplateFromForm;
  if ($('moveUnfinishedTomorrow')) $('moveUnfinishedTomorrow').onclick = moveUnfinishedToTomorrow;
  if ($('saveAdminViews')) $('saveAdminViews').onclick = saveAdminViews;
  if ($('resetAdminViews')) $('resetAdminViews').onclick = resetAdminViews;
  if ($('saveAdminWidgets')) $('saveAdminWidgets').onclick = saveAdminWidgets;
  if ($('copyAdminInvite')) $('copyAdminInvite').onclick = copyAdminInvite;
  if ($('addAdminUser')) $('addAdminUser').onclick = addAdminUserFromForm;
  if ($('addProjectDoc')) $('addProjectDoc').onclick = addProjectDocFromForm;
  if ($('exportIcsBtn')) $('exportIcsBtn').onclick = exportCalendarIcs;
  if ($('runGlobalSearchBtn')) $('runGlobalSearchBtn').onclick = runGlobalSearchFromInput;
  if ($('globalSearchInput')) $('globalSearchInput').onkeydown = (e) => { if (e.key === 'Enter') runGlobalSearchFromInput(); };
  if ($('addQuickTagBtn')) $('addQuickTagBtn').onclick = createQuickTagFromInput;
  if ($('quickTagName')) $('quickTagName').addEventListener('keydown', e => { if (e.key === 'Enter') createQuickTagFromInput(); });
  if ($('addWorkLog')) $('addWorkLog').onclick = () => addWorkLog({ date: $('workDate').value, project: $('workProject').value, hours: $('workHours').value, mark: $('workMark').value, comment: $('workComment').value });
  if ($('saveTimesheetMonth')) $('saveTimesheetMonth').onclick = () => { settings.timesheetMonth = $('timesheetMonth').value || currentMonth(); settings.timesheetProjectId = $('timesheetProject') ? $('timesheetProject').value : 'all'; saveSettings(); render(); };
  if ($('exportTimesheet')) $('exportTimesheet').onclick = () => exportTimesheetXml(settings.timesheetMonth || currentMonth(), settings.timesheetProjectId || 'all');
  if ($('exportLogsCsv')) $('exportLogsCsv').onclick = () => exportLogsCsv(settings.timesheetMonth || currentMonth(), settings.timesheetProjectId || 'all');
  if ($('saveProfile')) $('saveProfile').onclick = () => {
    const oldArchiveDays = Number(settings.autoArchiveDays || 90);
    const newArchiveDays = Number($('profileAutoArchiveDays').value || 90);
    if (oldArchiveDays !== newArchiveDays) {
      exportBackup('before-autoarchive-period-change');
    }
    settings.fio = $('profileFio').value.trim();
    settings.position = $('profilePosition').value.trim();
    settings.institution = $('profileInstitution').value.trim();
    settings.department = $('profileDepartment').value.trim();
    settings.defaultHours = $('profileDefaultHours').value === '' ? '' : Number($('profileDefaultHours').value);
    settings.quickProjects = $('profileQuickProjects').value.split(',').map(x => x.trim()).filter(Boolean);
    settings.autoSync = $('profileAutoSync').checked;
    settings.seededProfileDefaultsCleaned = true;
    settings.autoArchiveDays = newArchiveDays;
    runAutoArchiveCompleted({ persist: false });
    favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
    persistAll({ renderNow: true, sync: false });
    alert('Профиль сохранён. Если менялся срок автоархива, резервная копия уже выгружена.');
  };
  if ($('resetProfileFields')) $('resetProfileFields').onclick = resetProfileFields;
  if ($('enableAdminMode')) $('enableAdminMode').onclick = enableAdminMode;
  if ($('disableAdminMode')) $('disableAdminMode').onclick = disableAdminMode;
  if ($('backToDayFromAdmin')) $('backToDayFromAdmin').onclick = () => { currentView = 'commander'; render(); };
  if ($('saveSyncSettings')) $('saveSyncSettings').onclick = () => { settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl')?.value.trim() || DEFAULT_SUPABASE_URL); settings.supabaseAnonKey = $('syncKey')?.value.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY; settings.email = $('syncEmail')?.value.trim() || settings.email; saveSettings({ renderNow: false }); alert('Настройки сохранены.'); refreshAuthState({ renderNow:true }); };
  if ($('sendEmailCode')) $('sendEmailCode').onclick = sendEmailCode;
  if ($('verifyEmailCode')) $('verifyEmailCode').onclick = verifyEmailCode;
  if ($('sendMagicLink')) $('sendMagicLink').onclick = sendMagicLink;
  if ($('applyDefaultSync')) $('applyDefaultSync').onclick = () => applyDefaultPersonalSyncSettings({ renderNow:true });
  if ($('syncNow')) $('syncNow').onclick = () => performSync({ silent: false });
  bindSyncPanelButtons();
  if ($('refreshAuthBtn')) $('refreshAuthBtn').onclick = () => refreshAuthState({ renderNow:true });
  if ($('copyWeeklyReport')) $('copyWeeklyReport').onclick = async () => { await navigator.clipboard.writeText(weeklyReportText()); alert('Отчёт скопирован.'); };
  if ($('downloadWeeklyReport')) $('downloadWeeklyReport').onclick = () => downloadText(`weekly-report-${today()}.txt`, weeklyReportText(), 'text/plain;charset=utf-8');
  if ($('exportBackup')) $('exportBackup').onclick = () => exportBackup('manual');
  if ($('importJson')) $('importJson').onchange = importJson;
}
function downloadText(filename, text, type='text/plain;charset=utf-8') { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
function exportBackup(reason='backup') {
  settings.lastBackupAt = nowISO();
  persistAll({ renderNow: false, sync: false });
  const data = { kind: 'kvadrat-zadach-backup', reason, version: APP_VERSION, exportedAt: nowISO(), projects, projectMembers, promises, decisions, taskTemplates, projectDocs, adminUsers, tasks, workLogs, settings };
  downloadText(`kvadrat-zadach-${(settings.email || 'user').replace(/[^a-zA-Z0-9а-яА-Я_-]/g,'_')}-${reason}-${today()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}
async function importJson(e) {
  const file = e.target.files[0]; if (!file) return;
  const parsed = JSON.parse(await file.text());
  const incomingProjects = parsed.projects || [];
  const incomingMembers = parsed.projectMembers || parsed.members || [];
  const incomingPromises = parsed.promises || [];
  const incomingDecisions = parsed.decisions || [];
  const incomingTemplates = parsed.taskTemplates || parsed.templates || [];
  const incomingDocs = parsed.projectDocs || parsed.docs || [];
  const incomingAdminUsers = parsed.adminUsers || [];
  const incomingTasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
  const incomingLogs = parsed.workLogs || [];
  if (!Array.isArray(incomingTasks)) return alert('Не нашёл массив задач в файле.');
  mergeProjects(incomingProjects.map(normalizeProject));
  if (Array.isArray(incomingMembers)) mergeProjectMembers(incomingMembers.map(normalizeProjectMember));
  if (Array.isArray(incomingPromises)) mergePromises(incomingPromises.map(normalizePromise));
  if (Array.isArray(incomingDecisions)) mergeDecisions(incomingDecisions.map(normalizeDecision));
  if (Array.isArray(incomingTemplates)) mergeTaskTemplates(incomingTemplates.map(normalizeTaskTemplate));
  if (Array.isArray(incomingDocs)) mergeProjectDocs(incomingDocs.map(normalizeProjectDoc));
  if (Array.isArray(incomingAdminUsers)) mergeAdminUsers(incomingAdminUsers.map(normalizeAdminUser));
  mergeTasks(incomingTasks.map(normalizeTask));
  mergeWorkLogs(incomingLogs.map(normalizeWorkLog));
  persistAll({ renderNow: true, sync: true });
}
function mergeProjects(incoming) { const byId = new Map(projects.map(p => [p.id, p])); for (const p of incoming) { const old = byId.get(p.id); if (!old || new Date(p.updatedAt) >= new Date(old.updatedAt)) byId.set(p.id, normalizeProject(p)); } projects = [...byId.values()]; }
function mergeProjectMembers(incoming) { const byId = new Map(projectMembers.map(m => [m.id, m])); for (const m of incoming) { const old = byId.get(m.id); if (!old || new Date(m.updatedAt) >= new Date(old.updatedAt)) byId.set(m.id, normalizeProjectMember(m)); } projectMembers = [...byId.values()]; }
function mergePromises(incoming) { const byId = new Map(promises.map(p => [p.id, p])); for (const p of incoming) { const old = byId.get(p.id); if (!old || new Date(p.updatedAt) >= new Date(old.updatedAt)) byId.set(p.id, normalizePromise(p)); } promises = [...byId.values()]; }
function mergeDecisions(incoming) { const byId = new Map(decisions.map(d => [d.id, d])); for (const d of incoming) { const old = byId.get(d.id); if (!old || new Date(d.updatedAt) >= new Date(old.updatedAt)) byId.set(d.id, normalizeDecision(d)); } decisions = [...byId.values()]; }
function mergeTaskTemplates(incoming) { const byId = new Map(taskTemplates.map(t => [t.id, t])); for (const t of incoming) { const old = byId.get(t.id); if (!old || new Date(t.updatedAt) >= new Date(old.updatedAt)) byId.set(t.id, normalizeTaskTemplate(t)); } taskTemplates = [...byId.values()]; }
function mergeProjectDocs(incoming) { const byId = new Map(projectDocs.map(d => [d.id, d])); for (const d of incoming) { const old = byId.get(d.id); if (!old || new Date(d.updatedAt) >= new Date(old.updatedAt)) byId.set(d.id, normalizeProjectDoc(d)); } projectDocs = [...byId.values()]; }
function mergeAdminUsers(incoming) { const byId = new Map(adminUsers.map(u => [u.id, u])); for (const u of incoming) { const old = byId.get(u.id); if (!old || new Date(u.updatedAt) >= new Date(old.updatedAt)) byId.set(u.id, normalizeAdminUser(u)); } adminUsers = [...byId.values()]; }
function mergeTasks(incoming) { const byId = new Map(tasks.map(t => [t.id, t])); for (const t of incoming) { const old = byId.get(t.id); if (!old || new Date(t.updatedAt) >= new Date(old.updatedAt)) byId.set(t.id, normalizeTask(t)); } tasks = [...byId.values()]; }
function mergeWorkLogs(incoming) { const byId = new Map(workLogs.map(l => [l.id, l])); for (const l of incoming) { const old = byId.get(l.id); if (!old || new Date(l.updatedAt) >= new Date(old.updatedAt)) byId.set(l.id, normalizeWorkLog(l)); } workLogs = [...byId.values()]; }
function csvEscape(s) { const v = String(s ?? ''); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportLogsCsv(ym, projectId='all') {
  const rows = [['Дата','Проект','Часы','Код','Комментарий']];
  activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectId === 'all' || l.projectId === projectId)).sort((a,b) => a.date.localeCompare(b.date)).forEach(l => rows.push([l.date, projectName(l.projectId, l.project), l.hours, l.mark, l.comment]));
  const suffix = projectId === 'all' ? 'all' : projectName(projectId).replace(/\s+/g, '-');
  downloadText(`zhurnal-proektov-${ym}-${suffix}.csv`, rows.map(r => r.map(csvEscape).join(';')).join('\n'), 'text/csv;charset=utf-8');
}
function xmlCell(value, type='String', style='sBody') { const v = value === null || value === undefined ? '' : String(value); if (v === '') return `<Cell ss:StyleID="${style}"/>`; const dataType = type === 'Number' && !Number.isNaN(Number(v)) ? 'Number' : 'String'; return `<Cell ss:StyleID="${style}"><Data ss:Type="${dataType}">${escapeXml(v)}</Data></Cell>`; }
function exportTimesheetXml(ym, projectId='all') {
  const ts = buildTimesheet(ym, projectId);
  const firstDays = ts.dayData.slice(0, 15); const secondDays = ts.dayData.slice(15, 31); const rows = [];
  rows.push(`<Row>${xmlCell('', 'String', 'sTitle')}${xmlCell('', 'String', 'sTitle')}${xmlCell('Т а б е л ь №', 'String', 'sTitle')}${xmlCell('0000-000019', 'String', 'sTitle')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sHeader')}${xmlCell('', 'String', 'sHeader')}${xmlCell('учета использования рабочего времени', 'String', 'sHeader')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sBody')}${xmlCell('', 'String', 'sBody')}${xmlCell(`за ${monthTitle(ym)}`, 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Учреждение', 'String', 'sBody')}${xmlCell(settings.institution || '', 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Структурное подразделение', 'String', 'sBody')}${xmlCell(settings.department || '', 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Вид табеля', 'String', 'sBody')}${xmlCell(projectId === 'all' ? 'все проекты' : projectName(projectId), 'String', 'sBody')}${xmlCell('Дата формирования', 'String', 'sBody')}${xmlCell(new Date().toLocaleDateString('ru-RU'), 'String', 'sBody')}</Row>`);
  rows.push(`<Row></Row>`);
  rows.push(`<Row>${xmlCell('Фамилия, имя, отчество', 'String', 'sHeader')}${xmlCell('Должность', 'String', 'sHeader')}${firstDays.map(x => xmlCell(x.day, 'Number', 'sHeader')).join('')}${xmlCell('Итого дней (часов) явок (неявок) с 1 по 15', 'String', 'sHeader')}${secondDays.map(x => xmlCell(x.day, 'Number', 'sHeader')).join('')}${xmlCell('Всего дней (часов) явок (неявок) за месяц', 'String', 'sHeader')}</Row>`);
  rows.push(`<Row>${xmlCell(settings.fio || '', 'String', 'sBody')}${xmlCell(settings.position || '', 'String', 'sBody')}${firstDays.map(x => xmlCell(x.hours, 'Number', 'sBody')).join('')}${xmlCell(ts.firstHalf.hours, 'Number', 'sBody')}${secondDays.map(x => xmlCell(x.hours, 'Number', 'sBody')).join('')}${xmlCell(ts.monthTotal.hours, 'Number', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sBody')}${xmlCell('', 'String', 'sBody')}${firstDays.map(x => xmlCell(x.code, 'String', 'sBody')).join('')}${xmlCell(`${ts.firstHalf.workDays}${ts.firstHalf.absenceDays ? ' / Н:' + ts.firstHalf.absenceDays : ''}`, 'String', 'sBody')}${secondDays.map(x => xmlCell(x.code, 'String', 'sBody')).join('')}${xmlCell(`${ts.monthTotal.workDays}${ts.monthTotal.absenceDays ? ' / Н:' + ts.monthTotal.absenceDays : ''}`, 'String', 'sBody')}</Row>`);
  rows.push(`<Row></Row><Row>${xmlCell('Журнал отметок по проектам', 'String', 'sHeader')}</Row><Row>${['Дата','Проект','Часы','Код','Комментарий'].map(h => xmlCell(h, 'String', 'sHeader')).join('')}</Row>`);
  activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectId === 'all' || l.projectId === projectId)).sort((a,b) => a.date.localeCompare(b.date)).forEach(l => rows.push(`<Row>${xmlCell(l.date, 'String', 'sBody')}${xmlCell(projectName(l.projectId, l.project), 'String', 'sBody')}${xmlCell(l.hours, 'Number', 'sBody')}${xmlCell(l.mark, 'String', 'sBody')}${xmlCell(l.comment, 'String', 'sBody')}</Row>`));
  const breakdownSheet = projectId === 'all' ? `\n <Worksheet ss:Name="По проектам"><Table><Column ss:Width="180"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="70"/><Row>${xmlCell('Проект','String','sHeader')}${xmlCell('1–15 дней','String','sHeader')}${xmlCell('1–15 часов','String','sHeader')}${xmlCell('Месяц дней','String','sHeader')}${xmlCell('Месяц часов','String','sHeader')}${xmlCell('Отметок','String','sHeader')}</Row>${buildProjectBreakdown(ym).map(r => `<Row>${xmlCell(r.project,'String','sBody')}${xmlCell(r.firstHalfDays,'Number','sBody')}${xmlCell(r.firstHalfHours,'Number','sBody')}${xmlCell(r.monthDays,'Number','sBody')}${xmlCell(r.monthHours,'Number','sBody')}${xmlCell(r.entries,'Number','sBody')}</Row>`).join('')}</Table></Worksheet>` : '';
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="14"/><Alignment ss:Horizontal="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style><Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style><Style ss:ID="sBody"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style></Styles><Worksheet ss:Name="Табель"><Table><Column ss:Width="190"/><Column ss:Width="140"/>${Array.from({length:33}, () => '<Column ss:Width="38"/>').join('')}${rows.join('\n')}</Table></Worksheet>${breakdownSheet}</Workbook>`;
  const suffix = projectId === 'all' ? 'all' : projectName(projectId).replace(/\s+/g, '-');
  downloadText(`tabel-${settings.fio || 'user'}-${ym}-${suffix}.xls`, xml, 'application/vnd.ms-excel;charset=utf-8');
}
function normalizeSupabaseUrl(url='') {
  return String(url || '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/,'');
}
function applyDefaultPersonalSyncSettings({ renderNow = true } = {}) {
  settings.supabaseUrl = DEFAULT_SUPABASE_URL;
  settings.supabaseAnonKey = DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  settings.autoSync = true;
  saveSettings({ renderNow: false });
  setSyncState('подключение настроено для личного пространства', 'ok');
  if (renderNow) render();
}
function personalSpaceBadge() {
  return `<div class="personal-space-badge"><strong>Личное пространство активно.</strong> Данные привязаны к вашему email и user_id. Другие пользователи работают независимо и не видят ваши проекты, задачи, табель, решения и обещания.</div>`;
}
function getAuthRedirectUrl() {
  return new URL('./', window.location.href).href.split('#')[0].split('?')[0];
}
function getSupabaseClient() {
  settings.supabaseUrl = normalizeSupabaseUrl(settings.supabaseUrl || DEFAULT_SUPABASE_URL);
  if (!settings.supabaseAnonKey) settings.supabaseAnonKey = DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !window.supabase) return null;
  const key = `${settings.supabaseUrl}|${settings.supabaseAnonKey}`;
  if (supabaseClientInstance && supabaseClientKey === key) return supabaseClientInstance;
  supabaseClientKey = key;
  supabaseClientInstance = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storage: window.localStorage,
      storageKey: 'kvadrat-zadach-auth-session'
    },
    global: {
      headers: { 'x-client-info': `kvadrat-zadach/${APP_VERSION}` }
    }
  });
  return supabaseClientInstance;
}
function isMissingAuthSessionError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('auth session missing') || msg.includes('session missing') || msg.includes('missing session') || msg.includes('invalid refresh token') || msg.includes('refresh token not found') || msg.includes('jwt expired');
}
function friendlyAuthMessage() {
  return 'Нужно войти в личное пространство на этом устройстве: откройте «Синхронизация», введите email, нажмите «Получить код на почту», затем введите код из письма в приложении.';
}
function isAuthNeededError(e) {
  const msg = String(e?.message || e || '').toLowerCase();
  return msg.includes('нужно войти') || msg.includes('нужен вход') || isMissingAuthSessionError(msg);
}
async function getCurrentAuthSession(client = getSupabaseClient()) {
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      if (isMissingAuthSessionError(error)) return null;
      console.warn('getSession warning:', error.message);
      return null;
    }
    const session = data?.session || null;
    if (session?.user) {
      syncDiagnostics.userId = session.user.id || '';
      syncDiagnostics.email = session.user.email || settings.email || '';
    }
    return session;
  } catch (e) {
    console.warn('getSession failed:', e);
    return null;
  }
}
async function refreshAuthState({ renderNow = false } = {}) {
  const client = getSupabaseClient();
  if (!client) return false;
  const session = await getCurrentAuthSession(client);
  if (session?.user) {
    syncDiagnostics.userId = session.user.id || '';
    syncDiagnostics.email = session.user.email || settings.email || '';
    syncDiagnostics.lastError = '';
    setSyncState(`вход выполнен · ${session.user.email || session.user.id.slice(0,8)}`, 'ok');
    if (renderNow) render();
    return true;
  }
  syncDiagnostics.userId = '';
  syncDiagnostics.email = settings.email || '';
  setSyncState('нужен вход по email', 'warn');
  if (renderNow) render();
  return false;
}
async function processAuthRedirectIfNeeded() {
  const hasAuthParams = /access_token|refresh_token|type=recovery|type=magiclink|code=/.test(location.hash + location.search);
  const client = getSupabaseClient();
  if (!client) return;
  try {
    const { data, error } = await client.auth.getSession();
    if (error && !isMissingAuthSessionError(error)) console.warn('Auth redirect/session warning:', error.message);
    if (data?.session?.user) {
      syncDiagnostics.userId = data.session.user.id || '';
      syncDiagnostics.email = data.session.user.email || settings.email || '';
      setSyncState(`вход выполнен · ${data.session.user.email || data.session.user.id.slice(0,8)}`, 'ok');
    }
    if (hasAuthParams) {
      history.replaceState({}, document.title, location.origin + location.pathname);
    }
  } catch (e) {
    console.warn('processAuthRedirectIfNeeded failed:', e);
  }
}
async function requireSupabaseUser(client) {
  const session = await getCurrentAuthSession(client);
  if (session?.user) return session.user;

  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    if (isMissingAuthSessionError(error)) throw new Error(friendlyAuthMessage());
    throw new Error(error?.message || friendlyAuthMessage());
  }
  syncDiagnostics.userId = user.id || '';
  syncDiagnostics.email = user.email || settings.email || '';
  return user;
}
async function countCloudTasks(client) {
  const { count, error } = await client.from('tasks').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
async function safeUpsert(client, table, rows) {
  if (!rows || !rows.length) return true;
  const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
  if (error) {
    console.warn('Sync upsert warning', table, error.message);
    syncDiagnostics.lastError = `${table}: ${error.message}`;
    return false;
  }
  return true;
}
async function safeSelect(client, table, mapper) {
  const { data, error } = await client.from(table).select('*').order('updated_at', { ascending: false });
  if (error) {
    console.warn('Sync select warning', table, error.message);
    syncDiagnostics.lastError = `${table}: ${error.message}`;
    return [];
  }
  return (data || []).map(mapper);
}

function latestLocalTaskTitle() {
  const t = activeTasks().slice().sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
  return t ? `${t.title} · ${dateLabel((t.updatedAt || t.createdAt || '').slice(0,10))}` : 'нет задач';
}
async function getLatestCloudTask(client) {
  const userId = syncDiagnostics.userId || (await requireSupabaseUser(client)).id;
  const { data, error } = await client.from('tasks').select('id,title,updated_at,created_at').eq('user_id', userId).order('updated_at', { ascending:false }).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}
async function refreshTaskSyncDiagnostics(client) {
  syncDiagnostics.localTasks = activeTasks().length;
  syncDiagnostics.lastLocalTask = latestLocalTaskTitle();
  syncDiagnostics.remoteTasks = await countCloudTasks(client);
  try {
    const latest = await getLatestCloudTask(client);
    syncDiagnostics.lastCloudTask = latest ? latest.title : 'нет задач';
    syncDiagnostics.lastCloudTaskAt = latest ? (latest.updated_at || latest.created_at || '') : '';
  } catch (e) {
    syncDiagnostics.lastCloudTask = 'не удалось проверить';
    syncDiagnostics.lastCloudTaskAt = '';
    syncDiagnostics.lastError = e.message;
  }
  syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
}

function addSyncAudit(step, detail = '') {
  const item = { at: new Date().toISOString(), step, detail: String(detail || '') };
  try {
    const list = JSON.parse(localStorage.getItem(SYNC_AUDIT_KEY) || '[]');
    localStorage.setItem(SYNC_AUDIT_KEY, JSON.stringify([item, ...(Array.isArray(list) ? list : [])].slice(0, 30)));
  } catch {}
}
function latestSyncAuditText() {
  try {
    const list = JSON.parse(localStorage.getItem(SYNC_AUDIT_KEY) || '[]');
    const item = Array.isArray(list) ? list[0] : null;
    return item ? `${new Date(item.at).toLocaleString('ru-RU')} · ${item.step}: ${item.detail}` : '';
  } catch { return ''; }
}
function cloudSafeTaskPayload(task, userId) {
  const n = normalizeTask(task);
  let id = n.id;
  if (typeof isUuidLike === 'function' && !isUuidLike(id)) id = (typeof newCloudId === 'function' ? newCloudId() : uid());
  const row = taskToRow({ ...n, id }, userId);
  if (row.project_id && ((typeof isUuidLike === 'function' && !isUuidLike(row.project_id)) || (typeof projectIdExistsLocally === 'function' && !projectIdExistsLocally(row.project_id)))) row.project_id = null;
  row.user_id = userId;
  return row;
}
async function getActiveCloudUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const user = data?.user;
  if (!user?.id) throw new Error('Нет активного входа. Войдите по email-коду.');
  syncDiagnostics.userId = user.id;
  syncDiagnostics.email = user.email || settings.email || '';
  return user;
}

function activeCloudTasksList(list) {
  return (list || []).filter(t => !t.deletedAt);
}
function latestActiveCloudTaskTitle(list) {
  const t = activeCloudTasksList(list)[0];
  return t ? t.title : 'нет активных задач';
}
function clearSyncErrorsAfterSuccess() {
  try { localStorage.removeItem(APP_ERROR_LOG_KEY); } catch {}
  syncDiagnostics.lastError = '';
}

async function fetchCloudTasksForUser(client, userId) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending:false })
      .range(from, to);
    if (error) throw error;
    const chunk = data || [];
    all = all.concat(chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 20000) throw new Error('Слишком много строк задач для одной загрузки');
  }
  return all.map(rowToTask).map(normalizeTask);
}


function taskSyncCandidateIds({ onlyDirty = false } = {}) {
  const ids = new Set();
  if (onlyDirty && typeof dirtyTaskIds !== 'undefined') {
    dirtyTaskIds.forEach(id => ids.add(id));
  } else {
    tasks.forEach(t => {
      const n = normalizeTask(t);
      if (n.id) ids.add(n.id);
    });
  }
  return [...ids].filter(id => {
    const t = tasks.find(x => normalizeTask(x).id === id);
    return Boolean(t);
  });
}
function shouldLocalOverrideCloud(local, cloud) {
  if (!local) return false;
  if (!cloud) return true;
  const l = normalizeTask(local);
  const c = normalizeTask(cloud);
  if (typeof dirtyTaskIds !== 'undefined' && dirtyTaskIds.has(l.id)) return true;
  const lt = new Date(l.updatedAt || l.deletedAt || l.createdAt || 0).getTime();
  const ct = new Date(c.updatedAt || c.deletedAt || c.createdAt || 0).getTime();
  return lt >= ct;
}

function mergeCloudIntoLocal(cloudTasks, { preserveLocal = true } = {}) {
  const byId = new Map();
  (cloudTasks || []).forEach(t => byId.set(t.id, normalizeTask(t)));
  if (preserveLocal) {
    tasks.forEach(t => {
      const n = normalizeTask(t);
      const cloud = byId.get(n.id);
      if (shouldLocalOverrideCloud(n, cloud)) byId.set(n.id, n);
    });
  }
  tasks = [...byId.values()].sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  saveTasks();
}

async function cloudRowById(client, id) {
  if (!id) return null;
  const { data, error } = await client.from('tasks')
    .select('id,user_id,title,status,updated_at,deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function pushLocalTasksLineByLine(client, userId, { onlyDirty = false } = {}) {
  const uniqueIds = taskSyncCandidateIds({ onlyDirty });
  let sent = 0;
  const failed = [];
  for (const originalId of uniqueIds) {
    try {
      const fixedId = (typeof ensureTaskCloudReady === 'function' ? (ensureTaskCloudReady(originalId) || originalId) : originalId);
      const task = (typeof localTaskById === 'function' ? localTaskById(fixedId) : tasks.find(t => t.id === fixedId));
      if (!task) {
        if (typeof dirtyTaskIds !== 'undefined') dirtyTaskIds.delete(originalId);
        continue;
      }

      // v2.12.3: cloud tombstone wins even BEFORE local dirty push.
      // A stale active local copy must never overwrite a row already deleted in Supabase.
      const serverRow = await cloudRowById(client, fixedId);
      if (serverRow && taskIsDeleted(serverRow)) {
        const idx = tasks.findIndex(t => normalizeTask(t).id === fixedId || normalizeTask(t).id === originalId);
        if (idx >= 0) {
          tasks[idx] = normalizeTask(rowToTask(serverRow));
        }
        if (typeof dirtyTaskIds !== 'undefined') {
          dirtyTaskIds.delete(fixedId);
          dirtyTaskIds.delete(originalId);
        }
        addSyncAudit('локальная копия не отправлена', `в Supabase задача уже удалена: ${serverRow.title || fixedId}`);
        continue;
      }

      const row = cloudSafeTaskPayload(task, userId);
      const { data, error } = await client.from('tasks')
        .upsert(row, { onConflict:'id' })
        .select('id,updated_at,deleted_at,title')
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error('Supabase не вернул подтверждение строки');
      sent += 1;

      if (typeof dirtyTaskIds !== 'undefined') {
        dirtyTaskIds.delete(fixedId);
        dirtyTaskIds.delete(originalId);
      }
      const idx = tasks.findIndex(t => t.id === fixedId || t.id === originalId);
      if (idx >= 0) {
        tasks[idx] = normalizeTask({
          ...tasks[idx],
          id: data.id,
          updatedAt: data.updated_at || tasks[idx].updatedAt,
          deletedAt: data.deleted_at || tasks[idx].deletedAt || null
        });
      }
    } catch (e) {
      failed.push(`${originalId}: ${e.message || e}`);
      if (typeof markTaskDirty === 'function') markTaskDirty(originalId);
    }
  }
  if (typeof saveDirtyTaskIds === 'function') saveDirtyTaskIds();
  persistAll({ renderNow:false, sync:false });
  return { sent, failed, attempted: uniqueIds.length };
}


/* ==============================
   v2.12.0 Sync Engine v1
   Supabase is the source of truth. localStorage is a cache.
   ============================== */

let syncEngineBusy = false;
let stableSyncQueue = Promise.resolve();
let stableSyncLastPullCount = 0;

function syncEngineNow() {
  return nowISO();
}


function stableSyncCompareTime(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}
function stableSyncProjectRef() {
  const url = settings.supabaseUrl || DEFAULT_SUPABASE_URL || '';
  return (url.match(/^https:\/\/([^.]+)\.supabase\.co$/) || [])[1] || '';
}
function stableSyncRunQueued(job) {
  stableSyncQueue = stableSyncQueue.then(job, job);
  return stableSyncQueue;
}
function stableSyncBuildSummary({ pulled = 0, active = 0, deleted = 0, dirty = 0, pushed = 0, failed = 0 } = {}) {
  return `облако: ${pulled} · активных ${active} · удалённых ${deleted} · отправлено ${pushed} · ошибок ${failed} · ожидает ${dirty}`;
}

async function syncEngineGetUser({ silent = false } = {}) {
  const client = getSupabaseClient();
  if (!client) {
    const msg = 'Облачное подключение недоступно';
    setSyncState(msg, 'bad');
    if (!silent) alert(msg);
    return null;
  }
  try {
    const user = await getActiveCloudUser(client);
    if (!user?.id) throw new Error('Сессия не найдена');
    syncDiagnostics.userId = user.id;
    syncDiagnostics.email = user.email || syncDiagnostics.email || settings.email || '';
    return { client, user };
  } catch (e) {
    const msg = e?.message || String(e);
    setSyncState('нужен вход: ' + msg, 'bad');
    addSyncAudit('вход', msg);
    if (!silent) alert(msg);
    return null;
  }
}

function syncEngineTaskToRow(task, userId) {
  return cloudSafeTaskPayload(normalizeTask(task), userId);
}

function syncEngineRowToTask(row) {
  return rowToTask(row);
}

async function syncEngineUpsertTask(taskId, { silent = true, reason = 'изменение задачи' } = {}) {
  return stableSyncRunQueued(async () => {
    const pair = await syncEngineGetUser({ silent });
    if (!pair) {
      markTaskDirty(taskId);
      return false;
    }
    const { client, user } = pair;
    const originalId = taskId;
    const fixedId = (typeof ensureTaskCloudReady === 'function' ? (ensureTaskCloudReady(originalId) || originalId) : originalId);
    const task = (typeof localTaskById === 'function' ? localTaskById(fixedId) : tasks.find(t => t.id === fixedId));
    if (!task) return false;
    try {
      const row = syncEngineTaskToRow(task, user.id);
      const { data, error } = await client.from('tasks')
        .upsert(row, { onConflict:'id' })
        .select('id,updated_at,deleted_at,title')
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error('Supabase не вернул подтверждение сохранения');

      const idx = tasks.findIndex(t => t.id === fixedId || t.id === originalId);
      if (idx >= 0) {
        tasks[idx] = normalizeTask({
          ...tasks[idx],
          id: data.id,
          updatedAt: data.updated_at || tasks[idx].updatedAt,
          deletedAt: data.deleted_at || tasks[idx].deletedAt || null
        });
      }

      if (typeof dirtyTaskIds !== 'undefined') {
        dirtyTaskIds.delete(originalId);
        dirtyTaskIds.delete(fixedId);
        saveDirtyTaskIds();
      }
      persistAll({ renderNow:false, sync:false });

      syncDiagnostics.lastPushAt = new Date().toLocaleString('ru-RU');
      syncDiagnostics.lastLocalTask = latestLocalTaskTitle();
      setSyncState(`${reason}: сохранено в облаке`, 'ok');
      addSyncAudit('задача сохранена', `${reason}: ${task.title || fixedId}`);
      return true;
    } catch (e) {
      const msg = e?.message || String(e);
      markTaskDirty(fixedId);
      recordAppError('Stable Sync upsert', msg);
      addSyncAudit('ожидает отправки', `${reason}: ${msg}`);
      setSyncState(`${reason}: сохранено локально, облако позже`, 'warn');
      if (!silent) alert(msg);
      return false;
    }
  });
}

async function syncEnginePushPending({ silent = true } = {}) {
  if (typeof dirtyTaskIds === 'undefined' || dirtyTaskIds.size === 0) {
    return { attempted: 0, sent: 0, failed: [] };
  }
  const pair = await syncEngineGetUser({ silent });
  if (!pair) return { attempted: dirtyTaskIds.size, sent: 0, failed: ['нет входа или облачного подключения'] };
  const { client, user } = pair;
  const result = await pushLocalTasksLineByLine(client, user.id, { onlyDirty: true });
  if (result.failed.length) {
    recordAppError('Sync Engine pending', result.failed.slice(0, 3).join('; '));
    addSyncAudit('часть ожидающих не отправлена', result.failed.slice(0, 3).join('; '));
  }
  return result;
}

async function syncEnginePullCloud({ silent = true } = {}) {
  const pair = await syncEngineGetUser({ silent });
  if (!pair) return null;
  const { client, user } = pair;
  try {
    const pageSize = 1000;
    let from = 0;
    let all = [];
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await client.from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending:false })
        .range(from, to);
      if (error) throw error;
      const chunk = data || [];
      all = all.concat(chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
      if (from > 20000) throw new Error('Слишком много строк задач для одной синхронизации');
    }
    stableSyncLastPullCount = all.length;
    return all.map(syncEngineRowToTask).map(normalizeTask);
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('Stable Sync pull', msg);
    addSyncAudit('ошибка загрузки задач', msg);
    setSyncState('ошибка загрузки задач: ' + msg, 'bad');
    if (!silent) alert(msg);
    return null;
  }
}

function syncEngineApplyCloudTasks(cloudTasks = []) {
  const cloudById = new Map();
  (cloudTasks || []).forEach(t => {
    const n = normalizeTask(t);
    if (n.id) cloudById.set(n.id, n);
  });

  const nextById = new Map();
  const cloudTombstoneIds = new Set();

  cloudById.forEach((cloudTask, id) => {
    nextById.set(id, cloudTask);
    if (taskIsDeleted(cloudTask)) {
      cloudTombstoneIds.add(id);
      if (typeof dirtyTaskIds !== 'undefined') dirtyTaskIds.delete(id);
    }
  });

  // v2.12.3: Supabase is the working list source.
  // Keep local dirty rows only if Supabase does not know them yet.
  tasks.forEach(t => {
    const local = normalizeTask(t);
    if (!local.id) return;

    if (cloudTombstoneIds.has(local.id)) {
      if (typeof dirtyTaskIds !== 'undefined') dirtyTaskIds.delete(local.id);
      nextById.set(local.id, cloudById.get(local.id));
      return;
    }

    const isDirty = typeof dirtyTaskIds !== 'undefined' && dirtyTaskIds.has(local.id);
    const existsInCloud = cloudById.has(local.id);

    if (isDirty && !existsInCloud) {
      // Offline-created local task not yet in Supabase. Preserve it until a confirmed push.
      nextById.set(local.id, local);
    }
  });

  if (typeof saveDirtyTaskIds === 'function') saveDirtyTaskIds();

  tasks = [...nextById.values()].map(normalizeTask).sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
  );

  persistAll({ renderNow:false, sync:false });

  const activeCount = tasks.filter(t => !taskIsDeleted(t)).length;
  const deletedCount = tasks.filter(t => taskIsDeleted(t)).length;
  const inboxCount = tasks.filter(t => !taskIsDeleted(t) && (t.status || 'inbox') === 'inbox').length;
  syncDiagnostics.localTasks = activeCount;
  syncDiagnostics.remoteTasks = activeCount;
  syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
  syncDiagnostics.lastPullAt = syncDiagnostics.lastCheckedAt;
  syncDiagnostics.lastLocalTask = latestLocalTaskTitle();
  return { activeCount, deletedCount, inboxCount, totalCount: tasks.length, pulledCount: cloudTasks.length };
}

async function syncEngineSyncNow({ silent = false } = {}) {
  return stableSyncRunQueued(async () => {
    if (syncEngineBusy) {
      setSyncState('синхронизация уже выполняется', 'warn');
      return false;
    }
    syncEngineBusy = true;
    setSyncState('синхронизация...', 'warn');
    addSyncAudit('Cloud Pull Wins v2.12.3', 'старт: проверка dirty → полное чтение Supabase → прямое обновление списка');
    try {
      const pending = await syncEnginePushPending({ silent:true });
      const cloudTasks = await syncEnginePullCloud({ silent:true });
      if (!cloudTasks) throw new Error('не удалось прочитать задачи из облака');

      const applied = syncEngineApplyCloudTasks(cloudTasks);
      const failedCount = pending.failed ? pending.failed.length : 0;
      const summary = stableSyncBuildSummary({
        pulled: applied.pulledCount,
        active: applied.activeCount,
        deleted: applied.deletedCount,
        dirty: dirtyTaskCount(),
        pushed: pending.sent || 0,
        failed: failedCount
      });

      // Reset visual filters after manual sync so newly pulled inbox tasks are visible immediately.
      if ($('searchInput')) $('searchInput').value = '';
      if ($('projectFilter')) $('projectFilter').value = 'all';
      if (!silent && applied.inboxCount > 0) currentView = 'inbox';

      if (failedCount) {
        setSyncState(`частично · ${summary}`, 'warn');
      } else {
        clearSyncErrorsAfterSuccess();
        setSyncState(`синхронизировано · ${summary} · входящих ${applied.inboxCount}`, 'ok');
      }

      addSyncAudit('Cloud Pull Wins v2.12.3', `${summary}; входящих ${applied.inboxCount}`);
      render();
      return true;
    } catch (e) {
      const msg = e?.message || String(e);
      recordAppError('Cloud Pull Wins sync now', msg);
      addSyncAudit('Cloud Pull Wins ошибка', msg);
      setSyncState('ошибка синхронизации: ' + msg, 'bad');
      if (!silent) alert(msg);
      render();
      return false;
    } finally {
      syncEngineBusy = false;
    }
  });
}

function syncEngineAutoPullSoon(reason = 'автообновление', delay = 800) {
  // v2.12.1: auto-pull is intentionally disabled.
  // It caused races with create/delete upserts. Use the single manual button to pull cloud state.
  if (typeof dirtyTaskCount === 'function' && dirtyTaskCount() > 0) {
    updateAutoSyncUi(`есть ожидающие изменения · нажмите «Синхронизировать»`, 'warn');
    return;
  }
  updateAutoSyncUi('обновление вручную: нажмите «Синхронизировать»', 'idle');
}

async function simpleOneButtonSync() {
  return syncEngineSyncNow({ silent:false });
}

async function hardSyncTasks({ silent = false, pushAll = false } = {}) {
  return syncEngineSyncNow({ silent });
}

async function pushTasksOnly({ silent = false, onlyDirty = true, forceAll = false } = {}) {
  return hardSyncTasks({ silent, pushAll: forceAll || !onlyDirty });
}
async function pullTasksOnly({ silent = false } = {}) {
  return syncEngineSyncNow({ silent });
}
async function syncTasksBothWays({ silent = false, forceAll = false } = {}) {
  return syncEngineSyncNow({ silent });
}
async function verifyLastTaskInCloud() {
  const client = getSupabaseClient();
  if (!client) return alert('Облачное подключение временно недоступно.');
  try {
    await syncPendingBeforeCloudRead('проверка последней задачи');
    const user = await getActiveCloudUser(client);
    const cloudTasks = await fetchCloudTasksForUser(client, user.id);
    const activeCloud = activeCloudTasksList(cloudTasks);
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.remoteTasks = activeCloud.length;
    syncDiagnostics.lastCloudTask = latestActiveCloudTaskTitle(cloudTasks);
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    clearSyncErrorsAfterSuccess();
    const text = [
      `Локально задач: ${syncDiagnostics.localTasks}`,
      `В облаке активных задач: ${syncDiagnostics.remoteTasks}`,
      `Последняя локальная: ${syncDiagnostics.lastLocalTask || latestLocalTaskTitle() || 'нет'}`,
      `Последняя в облаке: ${syncDiagnostics.lastCloudTask || 'нет'}`,
      `user_id: ${syncDiagnostics.userId || user.id || 'не определён'}`,
      `Ожидает отправки: ${typeof dirtyTaskCount === 'function' ? dirtyTaskCount() : 0}`,
      `Последняя операция: ${latestSyncAuditText() || 'нет'}`,
      `Последняя ошибка: ${lastAppErrorText() || syncDiagnostics.lastError || 'нет'}`
    ].join('\n');
    setSyncState('диагностика задач выполнена', 'ok');
    render();
    alert(text);
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('проверка последней задачи', msg);
    syncDiagnostics.lastError = msg;
    setSyncState('ошибка диагностики задач: ' + msg, 'bad');
    render();
    alert(msg);
  }
}

async function checkCloudConnection() {
  const client = getSupabaseClient();
  if (!client) return alert('Облачное подключение временно недоступно.');
  setSyncState('проверка облака...', 'warn');
  try {
    await syncPendingBeforeCloudRead('проверка облака');
    const user = await getActiveCloudUser(client);
    const cloudTasks = await fetchCloudTasksForUser(client, user.id);
    const activeCloud = activeCloudTasksList(cloudTasks);
    syncDiagnostics.remoteTasks = activeCloud.length;
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    syncDiagnostics.lastCloudTask = latestActiveCloudTaskTitle(cloudTasks);
    clearSyncErrorsAfterSuccess();
    setSyncState(`облако доступно · user ${user.id.slice(0,8)} · активных задач в облаке: ${activeCloud.length}`, 'ok');
    addSyncAudit('проверка облака', `активных в облаке ${activeCloud.length}, последняя: ${syncDiagnostics.lastCloudTask}`);
    render();
  } catch (e) {
    const msg = e?.message || String(e);
    recordAppError('проверка облака', msg);
    syncDiagnostics.lastError = msg;
    setSyncState(isAuthNeededError(e) ? 'нужен вход по email' : 'ошибка проверки: ' + msg, isAuthNeededError(e) ? 'warn' : 'bad');
    render();
  }
}
async function pullFromCloud() {
  const client = getSupabaseClient();
  if (!client) return alert('Облачное подключение временно недоступно.');
  setSyncState('загрузка из облака...', 'warn');
  syncDiagnostics.lastError = '';
  try {
    await requireSupabaseUser(client);
    mergeProjects(await safeSelect(client, 'projects', rowToProject));
    mergeProjectMembers(await safeSelect(client, 'project_members', rowToProjectMember));
    mergePromises(await safeSelect(client, 'promises', rowToPromise));
    mergeDecisions(await safeSelect(client, 'decisions', rowToDecision));
    mergeTaskTemplates(await safeSelect(client, 'task_templates', rowToTaskTemplate));
    mergeTasks(await safeSelect(client, 'tasks', rowToTask));
    mergeWorkLogs(await safeSelect(client, 'work_logs', rowToWorkLog));
    persistAll({ renderNow: false, sync: false });
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.remoteTasks = await countCloudTasks(client);
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    setSyncState(`загружено из облака · локально задач: ${syncDiagnostics.localTasks}`, syncDiagnostics.lastError ? 'warn' : 'ok');
    render();
  } catch (e) {
    syncDiagnostics.lastError = e.message;
    setSyncState(isAuthNeededError(e) ? 'нужен вход по email' : 'ошибка загрузки: ' + e.message, isAuthNeededError(e) ? 'warn' : 'bad');
    render();
  }
}
async function pushToCloud() {
  await performSync({ silent:false, mode:'push' });
}


function updateAutoSyncUi(text, tone='idle') {
  lastAutoSyncReason = text || lastAutoSyncReason || '';
  const el = $('autoSyncInline');
  if (el) {
    el.textContent = text || 'синхронизация готова';
    el.className = `stat ${tone === 'ok' ? 'good' : tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : ''}`;
  }
}
async function hasActiveCloudSession() {
  const client = getSupabaseClient();
  if (!client) return false;
  const session = await getCurrentAuthSession(client);
  if (session?.user) {
    syncDiagnostics.userId = session.user.id || syncDiagnostics.userId || '';
    syncDiagnostics.email = session.user.email || settings.email || syncDiagnostics.email || '';
    return true;
  }
  return false;
}
function enqueueAutoTaskSync(reason='изменение задач', delay=700) {
  // v2.12.3: disabled to avoid background races. Writes are immediate; cross-device pull is manual.
  updateAutoSyncUi(`изменение сохранено · на другом устройстве нажмите «Синхронизировать»`, 'idle');
}
function scheduleReliableRetry(reason='ожидает повторной синхронизации', delay=3000) {
  // v2.12.3: disabled to avoid hidden retries overwriting cloud state.
  if (typeof dirtyTaskCount === 'function' && dirtyTaskCount() > 0) {
    updateAutoSyncUi(`ожидает отправки: ${dirtyTaskCount()} · нажмите «Синхронизировать»`, 'warn');
  }
}


function enqueueAutoPull(reason='проверка обновлений', delay=500) {
  // v2.12.3: disabled to avoid background races.
  updateAutoSyncUi('обновление между устройствами — кнопкой «Синхронизировать»', 'idle');
}
async function forceAutoSyncNow() {
  const signed = await hasActiveCloudSession();
  if (!signed) {
    setSyncState('нужен вход по email', 'warn');
    alert('Сначала войдите по коду на этом устройстве.');
    render();
    return false;
  }
  return syncTasksBothWays({ silent:false, forceAll:true });
}

function scheduleAutoSync(delay = 900) {
  // v2.12.1: automatic background pull is disabled. Writes are immediate; pull is manual.
  if (typeof dirtyTaskCount === 'function' && dirtyTaskCount() > 0) {
    updateAutoSyncUi(`ожидает отправки задач: ${dirtyTaskCount()} · нажмите «Синхронизировать»`, 'warn');
  } else {
    updateAutoSyncUi('изменения сохранены · для обновления другого устройства нажмите «Синхронизировать»', 'idle');
  }
}

async function sendMagicLink() {
  settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl')?.value.trim() || DEFAULT_SUPABASE_URL);
  settings.supabaseAnonKey = $('syncKey')?.value.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  settings.email = $('syncEmail')?.value.trim() || settings.email;
  saveSettings({ renderNow:false });
  const client = getSupabaseClient();
  if (!client) return alert('Облачное подключение временно недоступно.');
  if (!settings.email) return alert('Укажи email.');
  const redirectTo = getAuthRedirectUrl();
  const { error } = await client.auth.signInWithOtp({
    email: settings.email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true }
  });
  if (error) return alert(error.message);
  setSyncState('письмо для входа отправлено', 'warn');
  render();
  alert('Письмо отправлено. На iPhone удобнее использовать код из письма: введите его в поле «Код из письма» и нажмите «Войти по коду».');
}
async function sendEmailCode() {
  if (otpRequestInProgress) return;
  const wait = otpCooldownSeconds();
  if (wait > 0) {
    setSyncState(`код уже запрошен · подождите ${wait} сек.`, 'warn');
    alert(`Код уже запрошен. Подождите ${wait} сек. и проверьте почту/спам.`);
    render();
    return;
  }
  settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl')?.value.trim() || DEFAULT_SUPABASE_URL);
  settings.supabaseAnonKey = $('syncKey')?.value.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  settings.email = $('syncEmail')?.value.trim() || settings.email;
  saveSettings({ renderNow:false });
  const client = getSupabaseClient();
  if (!client) {
    setSyncState('облачный модуль не загрузился', 'bad');
    alert('Облачный модуль не загрузился. Проверьте интернет и обновите приложение.');
    render();
    return;
  }
  if (!settings.email) return alert('Укажите email личного пространства.');
  otpRequestInProgress = true;
  setButtonBusy('sendEmailCode', true, 'Отправляем код…');
  setSyncState('запрашиваем код на email...', 'warn');
  render();
  try {
    const { error } = await client.auth.signInWithOtp({
      email: settings.email,
      options: { shouldCreateUser: true, emailRedirectTo: getAuthRedirectUrl() }
    });
    if (error) throw error;
    markOtpRequestedNow();
    setSyncState('код запрошен · проверьте почту', 'ok');
    alert('Запрос кода отправлен. Проверьте входящие и спам. Повторный запрос — не раньше чем через 60 секунд.');
  } catch (e) {
    recordAppError('получение кода', e);
    const msg = String(e?.message || e || 'Неизвестная ошибка');
    if (/rate|limit|seconds|too many/i.test(msg)) markOtpRequestedNow();
    setSyncState('ошибка отправки кода: ' + msg, 'bad');
    alert('Код не отправлен: ' + msg + '\n\nЕсли Supabase пишет про лимит — подождите 60 секунд. Если ошибки нет, но письма нет — проверьте Resend → Logs и SMTP в Supabase.');
  } finally {
    otpRequestInProgress = false;
    setButtonBusy('sendEmailCode', false);
    render();
  }
}
async function verifyEmailCode() {
  settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl')?.value.trim() || DEFAULT_SUPABASE_URL);
  settings.supabaseAnonKey = $('syncKey')?.value.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  settings.email = $('syncEmail')?.value.trim() || settings.email;
  const token = ($('emailOtpCode')?.value || '').trim().replace(/\s+/g, '');
  saveSettings({ renderNow:false });
  const client = getSupabaseClient();
  if (!client) return alert('Облачное подключение временно недоступно.');
  if (!settings.email) return alert('Укажите email личного пространства.');
  if (!token) return alert('Введите код из письма.');
  const { data, error } = await client.auth.verifyOtp({ email: settings.email, token, type: 'email' });
  if (error) { recordAppError('вход по коду', error); setSyncState('ошибка входа по коду: ' + error.message, 'bad'); render(); return alert(error.message); }
  const user = data?.user || data?.session?.user;
  if (user) {
    syncDiagnostics.userId = user.id || '';
    syncDiagnostics.email = user.email || settings.email || '';
  }
  syncDiagnostics.lastError = '';
  setSyncState(`вход выполнен · ${syncDiagnostics.email || settings.email}`, 'ok');
  await refreshAuthState({ renderNow:false });
  await syncTasksBothWays({ silent:true });
  render();
  alert('Вход выполнен. Это устройство подключено к вашему личному пространству.');
}
function projectToRow(p, userId) { return { id: p.id, user_id: userId, name: p.name, code: p.code || null, status: p.status || 'active', owner: p.owner || null, customer: p.customer || null, stage: p.stage || null, start_date: p.startDate || null, due_date: p.dueDate || null, result: p.result || null, next_action: p.nextAction || null, description: p.description || null, note: p.note || null, color: p.color || null, created_at: p.createdAt, updated_at: p.updatedAt, deleted_at: p.deletedAt }; }
function rowToProject(r) { return normalizeProject({ id: r.id, name: r.name, code: r.code || '', status: r.status || 'active', owner: r.owner || '', customer: r.customer || '', stage: r.stage || '', startDate: r.start_date || '', dueDate: r.due_date || '', result: r.result || '', nextAction: r.next_action || '', description: r.description || '', note: r.note || '', color: r.color || '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at }); }
function projectMemberToRow(m, userId) { return { id: m.id, user_id: userId, project_id: m.projectId || null, name: m.name, role: m.role || 'Участник', email: m.email || null, note: m.note || null, created_at: m.createdAt, updated_at: m.updatedAt, deleted_at: m.deletedAt }; }
function rowToProjectMember(r) { return normalizeProjectMember({ id: r.id, projectId: r.project_id || '', name: r.name, role: r.role || 'Участник', email: r.email || '', note: r.note || '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at }); }
function promiseToRow(p, userId) { const n = normalizePromise(p); return { id:n.id, user_id:userId, project_id:n.projectId || null, direction:n.direction, who:n.who || null, text:n.text, promised_date:n.promisedDate || null, check_date:n.checkDate || null, status:n.status || 'open', note:n.note || null, created_at:n.createdAt, updated_at:n.updatedAt, deleted_at:n.deletedAt }; }
function rowToPromise(r) { return normalizePromise({ id:r.id, projectId:r.project_id || '', direction:r.direction, who:r.who || '', text:r.text || '', promisedDate:r.promised_date || '', checkDate:r.check_date || '', status:r.status || 'open', note:r.note || '', createdAt:r.created_at, updatedAt:r.updated_at, deletedAt:r.deleted_at }); }
function decisionToRow(d, userId) { const n = normalizeDecision(d); return { id:n.id, user_id:userId, project_id:n.projectId || null, decision_date:n.date || null, title:n.title, text:n.text || null, owner:n.owner || null, impact:n.impact || null, next_action:n.nextAction || null, created_at:n.createdAt, updated_at:n.updatedAt, deleted_at:n.deletedAt }; }
function rowToDecision(r) { return normalizeDecision({ id:r.id, projectId:r.project_id || '', date:r.decision_date || '', title:r.title, text:r.text || '', owner:r.owner || '', impact:r.impact || '', nextAction:r.next_action || '', createdAt:r.created_at, updatedAt:r.updated_at, deletedAt:r.deleted_at }); }
function taskTemplateToRow(t, userId) { const n = normalizeTaskTemplate(t); return { id:n.id, user_id:userId, name:n.name, title:n.title || null, project_id:n.projectId || null, status:n.status, priority:n.priority, importance:n.importance, urgency:n.urgency, day_bucket:n.dayBucket, note:n.note || null, created_at:n.createdAt, updated_at:n.updatedAt, deleted_at:n.deletedAt }; }
function rowToTaskTemplate(r) { return normalizeTaskTemplate({ id:r.id, name:r.name, title:r.title || '', projectId:r.project_id || '', status:r.status, priority:r.priority, importance:r.importance, urgency:r.urgency, dayBucket:r.day_bucket, note:r.note || '', createdAt:r.created_at, updatedAt:r.updated_at, deletedAt:r.deleted_at }); }
function taskToRow(t, userId) { const n = normalizeTask(t); return { id: n.id, user_id: userId, title: n.title, project_id: n.projectId || null, project: projectName(n.projectId, n.project) === 'Без проекта' ? null : projectName(n.projectId, n.project), due_date: n.dueDate || null, plan_date: n.planDate || null, status: n.status, priority: n.priority, importance: n.importance, urgency: n.urgency, note: n.note || null, day_bucket: n.dayBucket || 'none', order_index: n.orderIndex || 0, created_at: n.createdAt, updated_at: n.updatedAt, done_at: n.doneAt, archived_at: n.archivedAt, deleted_at: n.deletedAt }; }
function rowToTask(r) { return normalizeTask({ id: r.id, title: r.title, projectId: r.project_id || '', project: r.project || '', dueDate: r.due_date || '', planDate: r.plan_date || '', status: r.status, priority: r.priority, importance: r.importance, urgency: r.urgency, note: r.note || '', dayBucket: r.day_bucket || 'none', orderIndex: r.order_index || 0, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at, archivedAt: r.archived_at, deletedAt: r.deleted_at }); }
function workLogToRow(l, userId) { const n = normalizeWorkLog(l); return { id: n.id, user_id: userId, work_date: n.date, project_id: n.projectId || null, project: projectName(n.projectId, n.project), hours: n.hours, mark: n.mark, comment: n.comment || null, created_at: n.createdAt, updated_at: n.updatedAt, deleted_at: n.deletedAt }; }
function rowToWorkLog(r) { return normalizeWorkLog({ id: r.id, date: r.work_date, projectId: r.project_id || '', project: r.project || '', hours: r.hours, mark: r.mark, comment: r.comment || '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at }); }
async function performSync({ silent = false, mode = 'full' } = {}) {
  if (syncInProgress) return false;
  const client = getSupabaseClient();
  if (!client) { if (!silent) alert('Облачное подключение временно недоступно.'); return false; }
  syncInProgress = true;
  syncDiagnostics.lastError = '';
  setSyncState(mode === 'push' ? 'выгрузка в облако...' : 'синхронизация...', 'warn');
  try {
    const user = await requireSupabaseUser(client);

    await safeUpsert(client, 'projects', projects.map(p => projectToRow(normalizeProject(p), user.id)));
    await safeUpsert(client, 'project_members', projectMembers.map(m => projectMemberToRow(normalizeProjectMember(m), user.id)));
    await safeUpsert(client, 'promises', promises.map(p => promiseToRow(normalizePromise(p), user.id)));
    await safeUpsert(client, 'decisions', decisions.map(d => decisionToRow(normalizeDecision(d), user.id)));
    await safeUpsert(client, 'task_templates', taskTemplates.map(t => taskTemplateToRow(normalizeTaskTemplate(t), user.id)));
    await safeUpsert(client, 'tasks', tasks.map(t => taskToSafeRow(normalizeTask(t), user.id)));
    await safeUpsert(client, 'work_logs', workLogs.map(l => workLogToRow(normalizeWorkLog(l), user.id)));

    if (mode !== 'push') {
      mergeProjects(await safeSelect(client, 'projects', rowToProject));
      mergeProjectMembers(await safeSelect(client, 'project_members', rowToProjectMember));
      mergePromises(await safeSelect(client, 'promises', rowToPromise));
      mergeDecisions(await safeSelect(client, 'decisions', rowToDecision));
      mergeTaskTemplates(await safeSelect(client, 'task_templates', rowToTaskTemplate));
      mergeTasks(await safeSelect(client, 'tasks', rowToTask));
      mergeWorkLogs(await safeSelect(client, 'work_logs', rowToWorkLog));
    }

    persistAll({ renderNow: false, sync: false });
    syncDiagnostics.remoteTasks = await countCloudTasks(client);
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    const warning = syncDiagnostics.lastError ? ` · предупреждение: ${syncDiagnostics.lastError}` : '';
    setSyncState(`${mode === 'push' ? 'выгружено' : 'синхронизировано'} ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}${warning}`, syncDiagnostics.lastError ? 'warn' : 'ok');
    render();
    return true;
  } catch (e) {
    console.warn(e);
    syncDiagnostics.lastError = e.message;
    if (isAuthNeededError(e)) {
      setSyncState('нужен вход по email', 'warn');
      if (!silent) alert(friendlyAuthMessage());
    } else {
      setSyncState('ошибка: ' + e.message, 'bad');
      if (!silent) alert(e.message);
    }
    render();
    return false;
  } finally {
    syncInProgress = false;
  }
}

const CLOUD_SCHEMA_READY = true;

function migrateLocalData() {
  projects = projects.map(normalizeProject);
  projectMembers = projectMembers.map(normalizeProjectMember);
  promises = promises.map(normalizePromise);
  decisions = decisions.map(normalizeDecision);
  taskTemplates = taskTemplates.map(normalizeTaskTemplate);
  projectDocs = projectDocs.map(normalizeProjectDoc);
  adminUsers = adminUsers.map(normalizeAdminUser);
  settings.visibleViews = Array.isArray(settings.visibleViews) && settings.visibleViews.length ? settings.visibleViews : defaultVisibleViews();
  settings.dashboardWidgets = Array.isArray(settings.dashboardWidgets) && settings.dashboardWidgets.length ? settings.dashboardWidgets : defaultDashboardWidgets();
  favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
  [...tasks, ...workLogs].forEach(x => { if (x.project) ensureProject(x.project, { persist: false }); });
  tasks = tasks.map(normalizeTask);
  workLogs = workLogs.map(normalizeWorkLog);
  runAutoArchiveCompleted({ persist: false });
  persistAll({ renderNow: false, sync: false });
}

let appUpdateReloading = false;

function showUpdateBanner(title='Доступна новая версия приложения', text='Нажмите «Обновить приложение». Ссылка останется постоянной.') {
  const banner = $('updateBanner');
  if (!banner) return;
  if ($('updateBannerTitle')) $('updateBannerTitle').textContent = title;
  if ($('updateBannerText')) $('updateBannerText').textContent = text;
  banner.classList.remove('hidden');
  if ($('topUpdateBtn')) $('topUpdateBtn').classList.remove('hidden');
}
function hideUpdateBanner() {
  if ($('updateBanner')) $('updateBanner').classList.add('hidden');
}
async function clearAppCaches() {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.includes('kvadrat-zadach')).map(k => caches.delete(k)));
}
async function updateAppNow() {
  const btns = [$('updateAppBtn'), $('topUpdateBtn')].filter(Boolean);
  btns.forEach(btn => { btn.disabled = true; btn.textContent = 'Обновляем…'; });
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(async reg => {
        try { await reg.update(); } catch {}
        if (reg.waiting) reg.waiting.postMessage({ type:'SKIP_WAITING' });
      }));
    }
    await clearAppCaches();
  } catch (e) {
    console.warn('Update app warning:', e);
  } finally {
    window.location.replace(window.location.origin + window.location.pathname);
  }
}
function openSyncSettings() {
  currentView = 'settings';
  render();
}
function initAppUpdateMechanism() {
  if ($('updateAppBtn')) $('updateAppBtn').onclick = updateAppNow;
  if ($('topUpdateBtn')) $('topUpdateBtn').onclick = updateAppNow;
  if ($('dismissUpdateBtn')) $('dismissUpdateBtn').onclick = hideUpdateBanner;
  if ($('topSearchBtn')) $('topSearchBtn').onclick = openGlobalSearch;
  if ($('topSyncBtn')) $('topSyncBtn').onclick = openSyncSettings;

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (appUpdateReloading) return;
    appUpdateReloading = true;
    window.location.replace(window.location.origin + window.location.pathname);
  });

  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner('Новая версия готова', 'Нажмите «Обновить приложение». Постоянная ссылка не изменится.');
        }
      });
    });
    reg.update().catch(console.warn);
    setInterval(() => reg.update().catch(console.warn), 10 * 60 * 1000);
  }).catch(console.warn);
}


const SEEDED_PROFILE_DEFAULTS = {
  fio: 'Попов Максим Михайлович',
  position: 'Руководитель проекта',
  institution: 'Государственное казенное учреждение Московской области «Центр внедрения изменений и обеспечения деятельности Министерства здравоохранения Московской области»',
  department: 'Бюро разработки проектов и сопровождения проектной деятельности в системе здравоохранения',
  defaultHours: 8,
  quickProjects: ['МЗМО', 'РДКБ', 'Сколтех', 'Саратов ПК4']
};

function sameQuickProjectsAsSeeded(list) {
  const current = (Array.isArray(list) ? list : []).map(x => String(x || '').trim()).filter(Boolean);
  const seeded = SEEDED_PROFILE_DEFAULTS.quickProjects;
  return current.length && current.every(x => seeded.includes(x)) && seeded.slice(0, current.length).every((x,i) => current[i] === x);
}

function looksLikeSeededProfileValue(value, patterns) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  return patterns.some(p => v.includes(String(p).toLowerCase()));
}

function cleanupSeededProfileDefaults({ force = false, renderNow = false } = {}) {
  let changed = false;

  const seededFio = settings.fio === SEEDED_PROFILE_DEFAULTS.fio || looksLikeSeededProfileValue(settings.fio, ['попов максим']);
  const seededPosition = settings.position === SEEDED_PROFILE_DEFAULTS.position || looksLikeSeededProfileValue(settings.position, ['руководитель проекта']);
  const seededInstitution = settings.institution === SEEDED_PROFILE_DEFAULTS.institution || looksLikeSeededProfileValue(settings.institution, ['государственное казенное учреждение московской области', 'центр внедрения изменений']);
  const seededDepartment = settings.department === SEEDED_PROFILE_DEFAULTS.department || looksLikeSeededProfileValue(settings.department, ['бюро разработки проектов', 'сопровождения проектной деятельности']);
  const seededHours = Number(settings.defaultHours) === SEEDED_PROFILE_DEFAULTS.defaultHours;
  const seededTags = sameQuickProjectsAsSeeded(settings.quickProjects);

  if (force || seededFio) { settings.fio = ''; changed = true; }
  if (force || seededPosition) { settings.position = ''; changed = true; }
  if (force || seededInstitution) { settings.institution = ''; changed = true; }
  if (force || seededDepartment) { settings.department = ''; changed = true; }
  if (force || seededHours) { settings.defaultHours = ''; changed = true; }
  if (force || seededTags) { settings.quickProjects = []; changed = true; }

  settings.seededProfileDefaultsCleaned = true;
  if (changed || force) persistAll({ renderNow, sync: false });
  return changed;
}

function resetProfileFields() {
  if (!confirm('Очистить ФИО, должность, учреждение, подразделение, часы по умолчанию и быстрые теги?')) return;
  cleanupSeededProfileDefaults({ force: true, renderNow: true });
  alert('Профиль очищен. Заполните данные вручную и нажмите «Сохранить профиль».');
}

function openGlobalSearch() {
  currentView = 'searchall';
  render();
  setTimeout(() => {
    const input = $('globalSearchInput') || $('searchInput');
    if (input) input.focus();
  }, 60);
}

function boot() {
  installGlobalErrorHandlers();
  migrateLocalData();
  processAuthRedirectIfNeeded().then(() => refreshAuthState({ renderNow:false }));
  runAutoArchiveCompleted({ persist: false });
  $('quickAddBtn').onclick = addTask;
  $('quickTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  $('fieldPlanDate').value = today();
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => { currentView = btn.dataset.view; render(); });
  $('searchInput').oninput = render;
  $('projectFilter').onchange = render;
  $('editForm').onsubmit = saveEdit;
  $('closeDialogBtn').onclick = () => $('taskDialog').close();
  $('deleteTaskBtn').onclick = () => { const id = $('editId').value; deleteTask(id); $('taskDialog').close(); };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('installBtn').classList.add('hidden'); };
  initAppUpdateMechanism();
  render();
}
boot();


// v2.12.0 auto sync hooks: gentle, no interval.
window.addEventListener('online', () => syncEngineAutoPullSoon('online', 1200));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncEngineAutoPullSoon('visibility', 1200);
});
window.addEventListener('focus', () => syncEngineAutoPullSoon('focus', 1500));
