const APP_VERSION = '2.1.1';
const STORAGE_KEY = 'eisenhower_tasks_v1';
const WORKLOGS_KEY = 'eisenhower_worklogs_v1';
const PROJECTS_KEY = 'eisenhower_projects_v1';
const PROJECT_MEMBERS_KEY = 'eisenhower_project_members_v1';
const PROMISES_KEY = 'eisenhower_promises_v1';
const DECISIONS_KEY = 'eisenhower_decisions_v1';
const TEMPLATES_KEY = 'eisenhower_templates_v1';
const SETTINGS_KEY = 'eisenhower_tasks_settings_v1';

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
let tasks = loadTasks();
let workLogs = loadWorkLogs();
let currentView = 'commander';
let deferredPrompt = null;
let autoSyncTimer = null;
let syncInProgress = false;
let selectedQuickProjectId = '';
let syncState = { text: 'синхронизация не запускалась', tone: 'idle' };
let syncDiagnostics = { userId: '', email: '', localTasks: 0, remoteTasks: null, lastError: '', lastCheckedAt: '' };

const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const nowISO = () => new Date().toISOString();

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
function loadWorkLogs() { return loadArray(WORKLOGS_KEY); }
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      fio: s.fio || 'Попов Максим Михайлович',
      position: s.position || 'Руководитель проекта',
      department: s.department || 'Бюро разработки проектов и сопровождения проектной деятельности в системе здравоохранения',
      institution: s.institution || 'Государственное казенное учреждение Московской области «Центр внедрения изменений и обеспечения деятельности Министерства здравоохранения Московской области»',
      defaultHours: Number(s.defaultHours || 8),
      quickProjects: Array.isArray(s.quickProjects) && s.quickProjects.length ? s.quickProjects : ['МЗМО', 'РДКБ', 'Сколтех'],
      timesheetProjectId: s.timesheetProjectId || s.timesheetProject || 'all',
      autoSync: s.autoSync !== false,
      lastBackupAt: s.lastBackupAt || '',
      autoArchiveDays: Number(s.autoArchiveDays || 90),
      supabaseUrl: s.supabaseUrl || '',
      supabaseAnonKey: s.supabaseAnonKey || '',
      email: s.email || '',
      kanbanMode: s.kanbanMode || 'compact'
    };
  } catch {
    return { fio: 'Попов Максим Михайлович', position: 'Руководитель проекта', defaultHours: 8, quickProjects: ['МЗМО', 'РДКБ', 'Сколтех'], timesheetProjectId: 'all', autoSync: true, autoArchiveDays: 90, kanbanMode: 'compact' };
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
function activeTasks() { return tasks.filter(t => !t.deletedAt); }
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
  tasks = tasks.map(t => t.id === id ? normalizeTask({ ...t, ...patch, updatedAt: nowISO() }) : t);
  saveTasks();
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
}
function deleteTask(id) { updateTask(id, { deletedAt: nowISO() }); }
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

function taskCard(t) {
  const overdue = isOverdue(t);
  const pName = projectName(t.projectId, t.project);
  return `<article class="task-card ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <p class="task-title">${escapeHtml(t.title)}</p>
    <div class="task-meta">
      <span class="badge priority-${t.priority}">${priorityLabels[t.priority] || t.priority}</span>
      <span class="badge">${statusLabels[t.status]}</span>
      <span class="badge">${escapeHtml(pName)}</span>
      ${t.planDate ? `<span class="badge">план: ${dateLabel(t.planDate)}</span>` : ''}
      ${t.dueDate ? `<span class="badge ${overdue ? 'overdue' : ''}">срок: ${dateLabel(t.dueDate)}</span>` : ''}
      ${t.dayBucket !== 'none' ? `<span class="badge">${bucketLabels[t.dayBucket]}</span>` : ''}
      ${t.archivedAt ? `<span class="badge">в автоархиве</span>` : ''}
      <span class="badge">${t.importance === 'high' ? 'значимо' : 'не значимо'} / ${t.urgency === 'high' ? 'дедлайн близко' : 'не дедлайн близко'}</span>
    </div>
    ${t.note ? `<p class="task-note">${escapeHtml(t.note)}</p>` : ''}
    <div class="task-actions">
      ${t.status !== 'done' ? `<button class="mini-btn" data-action="done" data-id="${t.id}" type="button">Готово</button>` : `<button class="mini-btn" data-action="restore" data-id="${t.id}" type="button">Вернуть</button>`}
      <button class="mini-btn" data-action="today" data-id="${t.id}" type="button">Сегодня</button>
      <button class="mini-btn" data-action="tomorrow" data-id="${t.id}" type="button">Завтра</button>
      <button class="mini-btn" data-action="doing" data-id="${t.id}" type="button">В работу</button>
      ${t.projectId ? `<button class="mini-btn" data-action="logTaskProject" data-id="${t.id}" type="button">Работал</button>` : ''}
      <button class="mini-btn" data-action="edit" data-id="${t.id}" type="button">Править</button>
    </div>
  </article>`;
}
function listHtml(list, emptyText = 'Задач нет') {
  const items = sortTasks(list);
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
  $('stats').innerHTML = `
    <span class="stat"><strong>${open}</strong> открыто</span>
    <span class="stat"><strong>${todayCount}</strong> сегодня</span>
    <span class="stat"><strong>${overdue}</strong> просрочено</span>
    <span class="stat"><strong>${inbox}</strong> на разбор</span>
    <span class="stat"><strong>${todayHours}</strong> ч сегодня</span>
    <span id="syncStatusInline" class="stat ${syncToneClass()}">${escapeHtml(syncState.text)}</span>
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
  return `<article class="dashboard-card ${projectColorClass(p)} health-${h.tone}">
    <div class="project-title-row"><h3><span class="color-dot"></span>${escapeHtml(p.name)}</h3><span class="badge">${projectStatusLabels[p.status] || p.status}</span></div>
    <div class="metric-row"><span><strong>${m.open}</strong> открыто</span><span><strong>${m.overdue}</strong> просрочено</span><span><strong>${m.doneWeek}</strong> сделано за неделю</span><span><strong>${m.hoursMonth}</strong> ч/мес</span></div>
    <p class="task-note"><strong>${h.title}:</strong> ${escapeHtml(h.text)} · ${escapeHtml(p.nextAction || p.stage || p.description || 'нет следующего действия')}</p>
    <div class="task-actions"><button class="mini-btn" data-action="filterProject" data-project-id="${p.id}" type="button">Задачи</button><button class="mini-btn" data-action="openProjects" data-project-id="${p.id}" type="button">Паспорт</button></div>
  </article>`;
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
function renderCommander() {
  const todays = activeTasks().filter(t => t.status !== 'done' && t.planDate === today());
  const overdue = activeTasks().filter(isOverdue);
  const stuck = getStuckTasks();
  const delegate = getDelegateCandidates();
  const noProject = activeTasks().filter(t => t.status !== 'done' && !t.projectId);
  const coldProjects = activeProjects().filter(p => daysSinceIso(projectLastActivity(p.id)) >= 7);
  return `<section class="section-head"><div><h2>Командный экран дня</h2><p>Короткая управленческая выжимка: что делать, где пожар, что зависло и что можно делегировать.</p></div></section>
  <div class="dashboard-hero card"><div><strong>${todays.length}</strong><span>сегодня</span></div><div><strong>${overdue.length}</strong><span>просрочено</span></div><div><strong>${stuck.length}</strong><span>зависло</span></div><div><strong>${delegate.length}</strong><span>делегировать</span></div></div>
  ${todayOverloadNotice(todays)}
  <div class="grid-2">
    <section class="column"><h3>Сегодня важно</h3>${listHtml(todays.slice(0,9), 'На сегодня задач нет')}</section>
    <section class="column"><h3>Просрочено</h3>${listHtml(overdue, 'Просрочки нет')}</section>
    <section class="column"><h3>Зависло</h3>${listHtml(stuck, 'Зависших задач нет')}</section>
    <section class="column"><h3>Без проекта</h3>${listHtml(noProject, 'Все задачи привязаны к проектам')}</section>
    <section class="column"><h3>Что делегировать</h3>${listHtml(delegate, 'Кандидатов на делегирование нет')}</section>
    <section class="column"><h3>Давно не трогал</h3>${coldProjects.length ? coldProjects.map(p => `<div class="summary-card ${projectColorClass(p)}"><h4><span class="color-dot"></span>${escapeHtml(p.name)}</h4><p>${projectHealth(p.id).text}</p><div class="task-actions"><button class="mini-btn" data-action="openProjects" data-project-id="${p.id}" type="button">Открыть проект</button></div></div>`).join('') : '<div class="empty">Нет холодных проектов</div>'}</section>
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
    return `<section class="column project-card ${p.status === 'archived' ? 'project-muted' : ''} ${projectColorClass(p)}" data-project-id-card="${p.id}">
      <div class="project-title-row"><h3><span class="color-dot"></span>${escapeHtml(p.name)}</h3><span class="badge">${projectStatusLabels[p.status] || p.status}</span></div>
      <p class="project-count">${m.open} открытых · ${m.overdue} просрочено · ${m.hoursMonth} ч за ${monthTitle(ym)} · ${m.members} участн.</p>
      ${p.description ? `<p class="task-note">${escapeHtml(p.description)}</p>` : ''}
      <div class="task-actions">
        <button class="mini-btn" data-action="quickLogProject" data-project-id="${p.id}" type="button">Отметить сегодня</button>
        <button class="mini-btn" data-action="filterProject" data-project-id="${p.id}" type="button">Показать задачи</button>
        <button class="mini-btn" data-action="archiveProject" data-project-id="${p.id}" type="button">${p.status === 'archived' ? 'Активировать' : 'В архив'}</button>
      </div>
      ${renderProjectPassport(p)}
      ${listHtml(items, 'Открытых задач нет')}
    </section>`;
  }).join('');
  return `<section class="section-head"><div><h2>Проекты</h2><p>Карточка проекта теперь содержит паспорт, цветовую метку, участников и роли.</p></div></section>
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
    <div class="grid-2">${cards || '<div class="empty">Проектов пока нет</div>'}</div>`;
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
    <div class="notice">Автосинхронизация включена: после изменений приложение само отправляет данные в Supabase, если выполнен вход.</div>
    <div class="timesheet-entry">
      <label>Дата <input id="workDate" type="date" value="${today()}" /></label>
      <label>Проект <input id="workProject" list="projectList" value="${escapeHtml(list[0]?.name || '')}" placeholder="Проект" /></label>
      <label>Часы <input id="workHours" type="number" min="0" step="0.5" value="${settings.defaultHours || 8}" /></label>
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
function renderSettings() {
  return `<section class="settings-panel card">
    <div><h2>Синхронизация, профиль и резервные копии</h2><p>Приложение работает локально и синхронизируется через твой Supabase-проект.</p></div>
    <div class="notice">Статус: ${escapeHtml(syncState.text)}. Автосинхронизация запускается после изменений и при открытии приложения.</div>
    <div class="sync-diagnostics">
      <div><strong>user_id:</strong> ${syncDiagnostics.userId ? escapeHtml(syncDiagnostics.userId) : 'не определён'}</div>
      <div><strong>email:</strong> ${syncDiagnostics.email ? escapeHtml(syncDiagnostics.email) : escapeHtml(settings.email || 'не указан')}</div>
      <div><strong>локально задач:</strong> ${activeTasks().length}</div>
      <div><strong>в облаке задач:</strong> ${syncDiagnostics.remoteTasks === null ? 'не проверено' : syncDiagnostics.remoteTasks}</div>
      <div><strong>последняя проверка:</strong> ${syncDiagnostics.lastCheckedAt || 'не было'}</div>
      ${syncDiagnostics.lastError ? `<div><strong>последняя ошибка:</strong> ${escapeHtml(syncDiagnostics.lastError)}</div>` : ''}
    </div>
    <div class="settings-grid">
      <label>Фамилия, имя, отчество <input id="profileFio" value="${escapeHtml(settings.fio || '')}" /></label>
      <label>Должность <input id="profilePosition" value="${escapeHtml(settings.position || '')}" /></label>
      <label>Учреждение <input id="profileInstitution" value="${escapeHtml(settings.institution || '')}" /></label>
      <label>Подразделение <input id="profileDepartment" value="${escapeHtml(settings.department || '')}" /></label>
      <label>Часы по умолчанию <input id="profileDefaultHours" type="number" min="0" step="0.5" value="${settings.defaultHours || 8}" /></label>
      <label>Быстрые проекты / теги <input id="profileQuickProjects" value="${escapeHtml(favoriteProjects().join(', '))}" placeholder="МЗМО, РДКБ, Сколтех" /></label>
      <label>Автоархив выполненных задач, дней <input id="profileAutoArchiveDays" type="number" min="1" step="1" value="${settings.autoArchiveDays || 90}" /><small>По умолчанию 90 дней — один квартал. При изменении срока приложение выгружает резервную копию.</small></label>
      <label class="checkline"><input id="profileAutoSync" type="checkbox" ${settings.autoSync ? 'checked' : ''}/> Автосинхронизация</label>
      <div class="task-actions" style="align-items:end"><button class="primary" id="saveProfile" type="button">Сохранить профиль</button></div>
    </div>
    <div class="settings-grid">
      <label>Supabase Project URL <input id="syncUrl" value="${escapeHtml(normalizeSupabaseUrl(settings.supabaseUrl || ''))}" placeholder="https://xxxx.supabase.co" /></label>
      <label>Supabase publishable key <input id="syncKey" value="${escapeHtml(settings.supabaseAnonKey || '')}" placeholder="sb_publishable_..." /></label>
    </div>
    <div class="settings-grid">
      <label>Email для входа <input id="syncEmail" value="${escapeHtml(settings.email || '')}" placeholder="name@example.com" /></label>
      <div class="task-actions" style="align-items:end"><button class="primary" id="saveSyncSettings" type="button">Сохранить настройки</button><button class="ghost" id="sendMagicLink" type="button">Отправить ссылку входа</button><button class="ghost" id="syncNow" type="button">Синхронизировать</button><button class="ghost" id="signOut" type="button">Выйти</button></div>
    </div>
    <div class="settings-grid">
      <button class="ghost" id="exportBackup" type="button">Резервная копия всех данных</button>
      <label class="ghost" style="text-align:center; cursor:pointer">Восстановить из JSON<input id="importJson" type="file" accept="application/json" style="display:none" /></label>
    </div>
    <div><h3>SQL для Supabase</h3><p>Для версии 1.5 выполни SQL из файла <code>supabase.sql</code> или вставь текст ниже в Supabase → SQL Editor → Run.</p><pre class="sql-box">${escapeHtml(SQL_TEMPLATE)}</pre></div>
  </section>`;
}
function renderAbout() {
  return `<section class="settings-panel card about-page">
    <div><h2>О приложении</h2><p>«Квадрат задач» — личный диспетчер задач, проектов и табеля. Логика: быстрый ввод → разбор → план дня → контроль → отметка работы по проекту.</p></div>
    <div class="about-grid">
      <div class="summary-card"><h4>1. Быстрый ввод</h4><p>Напиши задачу одной строкой. Быстрый тег #МЗМО / #РДКБ / #Сколтех сразу назначает проект.</p></div>
      <div class="summary-card"><h4>2. План дня</h4><p>Экран «Сегодня» работает по Айви Ли и 1–3–5: одна главная, три важные, пять мелких.</p></div>
      <div class="summary-card"><h4>3. Проекты</h4><p>Создай проект в разделе «Проекты». Дальше задачи и табель привязываются к нему как к отдельной сущности.</p></div>
      <div class="summary-card"><h4>4. Канбан</h4><p>Канбан показывает не хаос карточек, а статус → проект → задачи-ссылки. Нажатие открывает задачу.</p></div>
      <div class="summary-card"><h4>5. Табель</h4><p>Отмечай часы по проектам. Табель можно вывести по всем проектам или по конкретному проекту.</p></div>
      <div class="summary-card"><h4>6. Синхронизация</h4><p>После входа через Supabase данные синхронизируются автоматически и вручную кнопкой «Синхронизировать».</p></div>
    </div>
    <div class="notice">Резервная копия: вкладка «Синхронизация» → «Резервная копия всех данных». В версии 1.6 также есть дашборд проектов, паспорта проектов, роли участников, недельный отчёт и автоархив выполненных задач.</div>
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
  tasks.unshift(normalizeTask({ title: t.title || t.name, projectId: t.projectId, project: projectName(t.projectId), status: t.status, priority: t.priority, importance: t.importance, urgency: t.urgency, dayBucket: t.dayBucket, note: t.note }));
  currentView = 'inbox';
  saveTasks();
}
function deleteTemplate(id) {
  taskTemplates = taskTemplates.map(t => t.id === id ? normalizeTaskTemplate({ ...t, deletedAt: nowISO(), updatedAt: nowISO() }) : t);
  persistAll({ renderNow: true, sync: true });
}
function renderGlobalSearch() {
  const q = ($('searchInput')?.value || '').trim().toLowerCase();
  const match = (arr) => !q ? [] : arr.filter(x => JSON.stringify(x).toLowerCase().includes(q));
  const rt = match(activeTasks());
  const rp = match(activeProjects({ includeArchived:true }));
  const rm = match(activeProjectMembers());
  const rd = match(activeDecisions());
  const rpr = match(activePromises());
  return `<section class="section-head"><div><h2>Поиск по всему</h2><p>Ищет по задачам, проектам, участникам, решениям и обещаниям. Введи запрос в поле поиска сверху.</p></div></section>
  ${!q ? '<div class="empty">Введите запрос в поле поиска</div>' : `<div class="grid-2"><section class="column"><h3>Задачи</h3>${listHtml(rt, 'Нет совпадений')}</section><section class="column"><h3>Проекты</h3>${rp.map(p => projectMiniCard(p)).join('') || '<div class="empty">Нет совпадений</div>'}</section><section class="column"><h3>Участники</h3>${rm.map(m => `<div class="summary-card"><h4>${escapeHtml(m.name)}</h4><p>${escapeHtml(m.role)} · ${escapeHtml(projectName(m.projectId))}</p></div>`).join('') || '<div class="empty">Нет совпадений</div>'}</section><section class="column"><h3>Решения / обещания</h3>${[...rd.map(d => `<div class="summary-card"><h4>${escapeHtml(d.title)}</h4><p>${escapeHtml(projectName(d.projectId))}</p></div>`), ...rpr.map(p => `<div class="summary-card"><h4>${escapeHtml(p.text)}</h4><p>${escapeHtml(p.who)} · ${escapeHtml(projectName(p.projectId))}</p></div>`)].join('') || '<div class="empty">Нет совпадений</div>'}</section></div>`}`;
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
  persistAll({ renderNow: true, sync: true });
}

function render() {
  renderProjectOptions();
  renderStats();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  const root = $('viewRoot');
  root.innerHTML = currentView === 'today' || currentView === 'tomorrow' ? renderToday()
    : currentView === 'week' ? renderWeek()
    : currentView === 'dashboard' ? renderDashboard()
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
function bindDynamicActions() {
  document.querySelectorAll('[data-action]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'clearQuickProject') { selectedQuickProjectId = ''; renderQuickTagBars(); }
    if (action === 'setKanbanMode') { settings.kanbanMode = btn.dataset.mode || 'compact'; saveSettings({ renderNow:false }); render(); }
    if (action === 'donePromise') donePromise(id);
    if (action === 'useTemplate') useTemplate(id);
    if (action === 'deleteTemplate') deleteTemplate(id);
    if (action === 'done') completeTask(id);
    if (action === 'restore') restoreTask(id);
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
  document.querySelectorAll('[data-quick-project]').forEach(btn => btn.onclick = () => {
    const target = btn.closest('#editForm') ? 'edit' : 'quick';
    applyQuickProject(btn.dataset.quickProject || '', target);
  });
  if ($('createProjectBtn')) $('createProjectBtn').onclick = createProjectFromForm;
  if ($('addPromiseBtn')) $('addPromiseBtn').onclick = addPromiseFromForm;
  if ($('addDecisionBtn')) $('addDecisionBtn').onclick = addDecisionFromForm;
  if ($('addTemplateBtn')) $('addTemplateBtn').onclick = addTemplateFromForm;
  if ($('moveUnfinishedTomorrow')) $('moveUnfinishedTomorrow').onclick = moveUnfinishedToTomorrow;
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
    settings.defaultHours = Number($('profileDefaultHours').value || 8);
    settings.quickProjects = $('profileQuickProjects').value.split(',').map(x => x.trim()).filter(Boolean);
    settings.autoSync = $('profileAutoSync').checked;
    settings.autoArchiveDays = newArchiveDays;
    runAutoArchiveCompleted({ persist: false });
    favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
    persistAll({ renderNow: true, sync: false });
    alert('Профиль сохранён. Если менялся срок автоархива, резервная копия уже выгружена.');
  };
  if ($('saveSyncSettings')) $('saveSyncSettings').onclick = () => { settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl').value.trim()); settings.supabaseAnonKey = $('syncKey').value.trim(); settings.email = $('syncEmail').value.trim(); saveSettings({ renderNow: false }); alert('Настройки сохранены.'); scheduleAutoSync(500); };
  if ($('sendMagicLink')) $('sendMagicLink').onclick = sendMagicLink;
  if ($('syncNow')) $('syncNow').onclick = () => performSync({ silent: false });
  if ($('checkCloud')) $('checkCloud').onclick = checkCloudConnection;
  if ($('pullCloud')) $('pullCloud').onclick = pullFromCloud;
  if ($('pushCloud')) $('pushCloud').onclick = pushToCloud;
  if ($('signOut')) $('signOut').onclick = signOut;
  if ($('copyWeeklyReport')) $('copyWeeklyReport').onclick = async () => { await navigator.clipboard.writeText(weeklyReportText()); alert('Отчёт скопирован.'); };
  if ($('downloadWeeklyReport')) $('downloadWeeklyReport').onclick = () => downloadText(`weekly-report-${today()}.txt`, weeklyReportText(), 'text/plain;charset=utf-8');
  if ($('exportBackup')) $('exportBackup').onclick = exportBackup;
  if ($('importJson')) $('importJson').onchange = importJson;
}
function downloadText(filename, text, type='text/plain;charset=utf-8') { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
function exportBackup(reason='backup') {
  settings.lastBackupAt = nowISO();
  persistAll({ renderNow: false, sync: false });
  const data = { kind: 'kvadrat-zadach-backup', reason, version: APP_VERSION, exportedAt: nowISO(), projects, projectMembers, promises, decisions, taskTemplates, tasks, workLogs, settings };
  downloadText(`kvadrat-zadach-${reason}-${today()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}
async function importJson(e) {
  const file = e.target.files[0]; if (!file) return;
  const parsed = JSON.parse(await file.text());
  const incomingProjects = parsed.projects || [];
  const incomingMembers = parsed.projectMembers || parsed.members || [];
  const incomingPromises = parsed.promises || [];
  const incomingDecisions = parsed.decisions || [];
  const incomingTemplates = parsed.taskTemplates || parsed.templates || [];
  const incomingTasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
  const incomingLogs = parsed.workLogs || [];
  if (!Array.isArray(incomingTasks)) return alert('Не нашёл массив задач в файле.');
  mergeProjects(incomingProjects.map(normalizeProject));
  if (Array.isArray(incomingMembers)) mergeProjectMembers(incomingMembers.map(normalizeProjectMember));
  if (Array.isArray(incomingPromises)) mergePromises(incomingPromises.map(normalizePromise));
  if (Array.isArray(incomingDecisions)) mergeDecisions(incomingDecisions.map(normalizeDecision));
  if (Array.isArray(incomingTemplates)) mergeTaskTemplates(incomingTemplates.map(normalizeTaskTemplate));
  mergeTasks(incomingTasks.map(normalizeTask));
  mergeWorkLogs(incomingLogs.map(normalizeWorkLog));
  persistAll({ renderNow: true, sync: true });
}
function mergeProjects(incoming) { const byId = new Map(projects.map(p => [p.id, p])); for (const p of incoming) { const old = byId.get(p.id); if (!old || new Date(p.updatedAt) >= new Date(old.updatedAt)) byId.set(p.id, normalizeProject(p)); } projects = [...byId.values()]; }
function mergeProjectMembers(incoming) { const byId = new Map(projectMembers.map(m => [m.id, m])); for (const m of incoming) { const old = byId.get(m.id); if (!old || new Date(m.updatedAt) >= new Date(old.updatedAt)) byId.set(m.id, normalizeProjectMember(m)); } projectMembers = [...byId.values()]; }
function mergePromises(incoming) { const byId = new Map(promises.map(p => [p.id, p])); for (const p of incoming) { const old = byId.get(p.id); if (!old || new Date(p.updatedAt) >= new Date(old.updatedAt)) byId.set(p.id, normalizePromise(p)); } promises = [...byId.values()]; }
function mergeDecisions(incoming) { const byId = new Map(decisions.map(d => [d.id, d])); for (const d of incoming) { const old = byId.get(d.id); if (!old || new Date(d.updatedAt) >= new Date(old.updatedAt)) byId.set(d.id, normalizeDecision(d)); } decisions = [...byId.values()]; }
function mergeTaskTemplates(incoming) { const byId = new Map(taskTemplates.map(t => [t.id, t])); for (const t of incoming) { const old = byId.get(t.id); if (!old || new Date(t.updatedAt) >= new Date(old.updatedAt)) byId.set(t.id, normalizeTaskTemplate(t)); } taskTemplates = [...byId.values()]; }
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
function getSupabaseClient() {
  settings.supabaseUrl = normalizeSupabaseUrl(settings.supabaseUrl);
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !window.supabase) return null;
  return window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
}
async function requireSupabaseUser(client) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error(error?.message || 'Нужен вход по email');
  syncDiagnostics.userId = user.id || '';
  syncDiagnostics.email = user.email || settings.email || '';
  return user;
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
async function checkCloudConnection() {
  const client = getSupabaseClient();
  if (!client) return alert('Сначала укажи Supabase URL и publishable key.');
  setSyncState('проверка облака...', 'warn');
  try {
    const user = await requireSupabaseUser(client);
    const { count, error } = await client.from('tasks').select('id', { count: 'exact', head: true });
    if (error) throw error;
    syncDiagnostics.remoteTasks = count ?? 0;
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    syncDiagnostics.lastError = '';
    setSyncState(`облако доступно · user ${user.id.slice(0,8)} · задач в облаке: ${syncDiagnostics.remoteTasks}`, 'ok');
    render();
  } catch (e) {
    syncDiagnostics.lastError = e.message;
    setSyncState('ошибка проверки: ' + e.message, 'bad');
    render();
  }
}
async function pullFromCloud() {
  const client = getSupabaseClient();
  if (!client) return alert('Сначала укажи Supabase URL и publishable key.');
  setSyncState('загрузка из облака...', 'warn');
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
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    setSyncState(`загружено из облака · локально задач: ${syncDiagnostics.localTasks}`, syncDiagnostics.lastError ? 'warn' : 'ok');
    render();
  } catch (e) {
    syncDiagnostics.lastError = e.message;
    setSyncState('ошибка загрузки: ' + e.message, 'bad');
    render();
  }
}
async function pushToCloud() {
  return performSync({ silent:false, mode:'push' });
}
function scheduleAutoSync(delay = 1600) {
  if (!settings.autoSync || !settings.supabaseUrl || !settings.supabaseAnonKey) return;
  clearTimeout(autoSyncTimer);
  setSyncState('ожидает автосинхронизации', 'warn');
  autoSyncTimer = setTimeout(() => performSync({ silent: true }), delay);
}
async function sendMagicLink() {
  settings.supabaseUrl = normalizeSupabaseUrl($('syncUrl').value.trim()); settings.supabaseAnonKey = $('syncKey').value.trim(); settings.email = $('syncEmail').value.trim(); saveSettings();
  const client = getSupabaseClient(); if (!client) return alert('Сначала укажи Supabase URL и publishable key.'); if (!settings.email) return alert('Укажи email.');
  const { error } = await client.auth.signInWithOtp({ email: settings.email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return alert(error.message);
  alert('Ссылка входа отправлена на email. Открой её на этом устройстве.');
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
  if (!client) { if (!silent) alert('Сначала укажи Supabase URL и publishable key.'); return false; }
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
    await safeUpsert(client, 'tasks', tasks.map(t => taskToRow(normalizeTask(t), user.id)));
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
    const { count } = await client.from('tasks').select('id', { count: 'exact', head: true });
    syncDiagnostics.remoteTasks = count ?? null;
    syncDiagnostics.localTasks = activeTasks().length;
    syncDiagnostics.lastCheckedAt = new Date().toLocaleString('ru-RU');
    const warning = syncDiagnostics.lastError ? ` · предупреждение: ${syncDiagnostics.lastError}` : '';
    setSyncState(`${mode === 'push' ? 'выгружено' : 'синхронизировано'} ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}${warning}`, syncDiagnostics.lastError ? 'warn' : 'ok');
    render();
    return true;
  } catch (e) {
    console.error(e);
    syncDiagnostics.lastError = e.message;
    setSyncState('ошибка: ' + e.message, 'bad');
    if (!silent) alert(e.message);
    render();
    return false;
  } finally {
    syncInProgress = false;
  }
}
async function signOut() { const client = getSupabaseClient(); if (client) await client.auth.signOut(); setSyncState('выход выполнен', 'idle'); alert('Выход выполнен. Локальные данные остаются на устройстве.'); }
const SQL_TEMPLATE = `create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active','paused','archived')),
  owner text,
  customer text,
  stage text,
  start_date date,
  due_date date,
  result text,
  next_action text,
  description text,
  note text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.projects add column if not exists customer text;
alter table public.projects add column if not exists stage text;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists due_date date;
alter table public.projects add column if not exists result text;
alter table public.projects add column if not exists next_action text;
alter table public.projects add column if not exists color text;

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  project_id uuid references public.projects(id) on delete set null,
  project text,
  due_date date,
  plan_date date,
  status text not null default 'inbox' check (status in ('inbox','planned','doing','delegated','deferred','done')),
  priority text not null default 'C' check (priority in ('A','B','C','D','E')),
  importance text not null default 'low' check (importance in ('high','low')),
  urgency text not null default 'low' check (urgency in ('high','low')),
  note text,
  day_bucket text not null default 'none' check (day_bucket in ('none','one','three','five')),
  order_index bigint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.work_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  work_date date not null,
  project_id uuid references public.projects(id) on delete set null,
  project text,
  hours numeric(5,2) not null default 8,
  mark text not null default 'Я' check (mark in ('Я','В','Б','ОТ','НН')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.project_members (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  role text not null default 'Участник',
  email text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.promises (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  direction text not null default 'to_me' check (direction in ('to_me','me_to')),
  who text,
  text text not null,
  promised_date date,
  check_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.decisions (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  decision_date date,
  title text not null,
  text text,
  owner text,
  impact text,
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_templates (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  title text,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'inbox',
  priority text not null default 'C',
  importance text not null default 'low',
  urgency text not null default 'low',
  day_bucket text not null default 'none',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Migrations for existing installations
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists archived_at timestamptz;
alter table public.work_logs add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks alter column order_index type bigint using order_index::bigint;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.promises enable row level security;
alter table public.decisions enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;

drop policy if exists "Users can select own projects" on public.projects;
drop policy if exists "Users can insert own projects" on public.projects;
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Users can delete own projects" on public.projects;
drop policy if exists "Users can select own project members" on public.project_members;
drop policy if exists "Users can insert own project members" on public.project_members;
drop policy if exists "Users can update own project members" on public.project_members;
drop policy if exists "Users can delete own project members" on public.project_members;
drop policy if exists "Users can select own promises" on public.promises;
drop policy if exists "Users can insert own promises" on public.promises;
drop policy if exists "Users can update own promises" on public.promises;
drop policy if exists "Users can delete own promises" on public.promises;
drop policy if exists "Users can select own decisions" on public.decisions;
drop policy if exists "Users can insert own decisions" on public.decisions;
drop policy if exists "Users can update own decisions" on public.decisions;
drop policy if exists "Users can delete own decisions" on public.decisions;
drop policy if exists "Users can select own task templates" on public.task_templates;
drop policy if exists "Users can insert own task templates" on public.task_templates;
drop policy if exists "Users can update own task templates" on public.task_templates;
drop policy if exists "Users can delete own task templates" on public.task_templates;
drop policy if exists "Users can select own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
drop policy if exists "Users can select own work logs" on public.work_logs;
drop policy if exists "Users can insert own work logs" on public.work_logs;
drop policy if exists "Users can update own work logs" on public.work_logs;
drop policy if exists "Users can delete own work logs" on public.work_logs;

create policy "Users can select own projects" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own projects" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own projects" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own projects" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own project members" on public.project_members for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own project members" on public.project_members for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own project members" on public.project_members for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own project members" on public.project_members for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own promises" on public.promises for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own promises" on public.promises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own promises" on public.promises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own promises" on public.promises for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own decisions" on public.decisions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own decisions" on public.decisions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own decisions" on public.decisions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own decisions" on public.decisions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own task templates" on public.task_templates for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own task templates" on public.task_templates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own task templates" on public.task_templates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own task templates" on public.task_templates for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own work logs" on public.work_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own work logs" on public.work_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own work logs" on public.work_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own work logs" on public.work_logs for delete to authenticated using ((select auth.uid()) = user_id);

NOTIFY pgrst, 'reload schema';
`;
function migrateLocalData() {
  projects = projects.map(normalizeProject);
  projectMembers = projectMembers.map(normalizeProjectMember);
  promises = promises.map(normalizePromise);
  decisions = decisions.map(normalizeDecision);
  taskTemplates = taskTemplates.map(normalizeTaskTemplate);
  favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
  [...tasks, ...workLogs].forEach(x => { if (x.project) ensureProject(x.project, { persist: false }); });
  tasks = tasks.map(normalizeTask);
  workLogs = workLogs.map(normalizeWorkLog);
  runAutoArchiveCompleted({ persist: false });
  persistAll({ renderNow: false, sync: false });
}
function boot() {
  migrateLocalData();
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) performSync({ silent: true }); });
  setInterval(() => performSync({ silent: true }), 120000);
  render();
  setTimeout(() => performSync({ silent: true }), 2000);
}
boot();
