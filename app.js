const APP_VERSION = '1.5.0';
const STORAGE_KEY = 'eisenhower_tasks_v1';
const WORKLOGS_KEY = 'eisenhower_worklogs_v1';
const PROJECTS_KEY = 'eisenhower_projects_v1';
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
let tasks = loadTasks();
let workLogs = loadWorkLogs();
let currentView = 'today';
let deferredPrompt = null;
let autoSyncTimer = null;
let syncInProgress = false;
let syncState = { text: 'синхронизация не запускалась', tone: 'idle' };

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
      supabaseUrl: s.supabaseUrl || '',
      supabaseAnonKey: s.supabaseAnonKey || '',
      email: s.email || ''
    };
  } catch {
    return { fio: 'Попов Максим Михайлович', position: 'Руководитель проекта', defaultHours: 8, quickProjects: ['МЗМО', 'РДКБ', 'Сколтех'], timesheetProjectId: 'all', autoSync: true };
  }
}
function persistAll({ renderNow = true, sync = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(WORKLOGS_KEY, JSON.stringify(workLogs));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
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
    description: p.description || '',
    note: p.note || '',
    color: p.color || '',
    createdAt: p.createdAt || nowISO(),
    updatedAt: p.updatedAt || nowISO(),
    deletedAt: p.deletedAt || null
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
    description: $('newProjectDescription')?.value.trim() || '',
    note: $('newProjectNote')?.value.trim() || ''
  });
  projects.unshift(p);
  if (!favoriteProjects().includes(name)) settings.quickProjects = [...favoriteProjects(), name];
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
  const projectId = advancedOpen ? projectValueFromInput($('fieldProject').value) : '';
  const t = normalizeTask({
    title,
    projectId,
    project: projectName(projectId, ''),
    planDate: advancedOpen ? $('fieldPlanDate').value : today(),
    dueDate: advancedOpen ? $('fieldDueDate').value : '',
    status: advancedOpen ? $('fieldStatus').value : 'inbox',
    priority: advancedOpen ? $('fieldPriority').value : 'C',
    importance: advancedOpen ? $('fieldImportance').value : 'low',
    urgency: advancedOpen ? $('fieldUrgency').value : 'low',
    dayBucket: advancedOpen ? $('fieldDayBucket').value : 'none',
    note: advancedOpen ? $('fieldNote').value : ''
  });
  tasks.unshift(t);
  $('quickTitle').value = '';
  $('fieldNote').value = '';
  saveTasks();
}
function deleteTask(id) { updateTask(id, { deletedAt: nowISO() }); }
function completeTask(id) { updateTask(id, { status: 'done', doneAt: nowISO(), dayBucket: 'none' }); }
function restoreTask(id) { updateTask(id, { status: 'planned', doneAt: null }); }
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
      <span class="badge">${t.importance === 'high' ? 'важно' : 'не важно'} / ${t.urgency === 'high' ? 'срочно' : 'не срочно'}</span>
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
    return `<button class="tag-chip" data-quick-project="${escapeHtml(name)}" data-project-id="${escapeHtml(id)}" type="button">#${escapeHtml(name)}</button>`;
  }).join('');
  const addHint = `<span class="tag-hint">Быстрые теги подставляют проект. Список меняется в профиле.</span>`;
  if ($('quickTagBar')) $('quickTagBar').innerHTML = chipHtml + addHint;
  if ($('editTagBar')) $('editTagBar').innerHTML = chipHtml;
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
  if (target === 'edit') $('editProject').value = value;
  else {
    $('advancedDetails').open = true;
    $('fieldProject').value = value;
    if (!$('fieldPlanDate').value) $('fieldPlanDate').value = today();
    if ($('fieldStatus').value === 'inbox') $('fieldStatus').value = 'planned';
  }
}
function renderToday() {
  const d = currentView === 'tomorrow' ? addDays(1) : today();
  const title = currentView === 'tomorrow' ? 'Завтра' : 'Сегодня';
  const list = visibleTasks().filter(t => t.status !== 'done' && t.planDate === d);
  return `<section class="section-head"><div><h2>${title}</h2><p>План дня по Айви Ли + 1–3–5: сначала главное, потом важное, потом мелкое.</p></div></section>
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
  return `<section class="section-head"><div><h2>Разбор входящих</h2><p>Сюда попадает всё, что записано одной строкой. Потом назначаешь проект, дату и приоритет.</p></div></section>${listHtml(list, 'Входящие разобраны')}`;
}
function renderMatrix() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const q = (importance, urgency) => list.filter(t => t.importance === importance && t.urgency === urgency);
  return `<section class="section-head"><div><h2>Матрица Эйзенхауэра</h2><p>Важно/срочно — сделать. Важно/не срочно — запланировать. Срочно/не важно — делегировать. Остальное — убрать.</p></div></section>
  <div class="matrix-grid">
    <section class="column"><h3>Важно и срочно</h3><p class="column-sub">Сделать сейчас</p>${listHtml(q('high','high'), 'Пусто')}</section>
    <section class="column"><h3>Важно, не срочно</h3><p class="column-sub">Запланировать</p>${listHtml(q('high','low'), 'Пусто')}</section>
    <section class="column"><h3>Срочно, не важно</h3><p class="column-sub">Делегировать / ограничить</p>${listHtml(q('low','high'), 'Пусто')}</section>
    <section class="column"><h3>Не важно, не срочно</h3><p class="column-sub">Убрать</p>${listHtml(q('low','low'), 'Пусто')}</section>
  </div>`;
}
function renderKanban() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const statuses = ['inbox','planned','doing','delegated','deferred'];
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
      return `<div class="kanban-project">
        <button class="kanban-project-title" data-action="filterProject" data-project-id="${escapeHtml(pid === 'no-project' ? 'all' : pid)}" type="button">${escapeHtml(pName)} <span>${tasks.length}</span></button>
        <div class="kanban-task-list">${tasks.map(t => `<button class="kanban-task-link ${isOverdue(t) ? 'overdue-link' : ''}" data-action="edit" data-id="${t.id}" type="button"><strong>${priorityLabels[t.priority]}</strong> ${escapeHtml(t.title)}${t.dueDate ? `<em>${dateLabel(t.dueDate)}</em>` : ''}</button>`).join('')}</div>
      </div>`;
    }).join('');
    return `<section class="column kanban-column"><h3>${statusLabels[s]}</h3><p class="column-sub">${items.length} задач · ${groups.size} проектов</p>${body || '<div class="empty">Пусто</div>'}</section>`;
  };
  return `<section class="section-head"><div><h2>Канбан</h2><p>Компактно: статус → проект → задачи-ссылки. Нажми на задачу, чтобы открыть карточку.</p></div></section><div class="kanban-grid">${statuses.map(renderColumn).join('')}</div>`;
}
function renderProjects() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const ym = currentMonth();
  const cards = activeProjects({ includeArchived: true }).map(p => {
    const items = list.filter(t => t.projectId === p.id);
    const month = activeWorkLogs().filter(l => l.projectId === p.id && l.date.slice(0,7) === ym && l.mark === 'Я');
    const hours = month.reduce((s,l) => s + Number(l.hours || 0), 0);
    return `<section class="column project-card ${p.status === 'archived' ? 'project-muted' : ''}">
      <div class="project-title-row"><h3>${escapeHtml(p.name)}</h3><span class="badge">${projectStatusLabels[p.status] || p.status}</span></div>
      <p class="project-count">${items.length} открытых задач · ${hours} ч за ${monthTitle(ym)}</p>
      ${p.description ? `<p class="task-note">${escapeHtml(p.description)}</p>` : ''}
      <div class="task-actions">
        <button class="mini-btn" data-action="quickLogProject" data-project-id="${p.id}" type="button">Отметить сегодня</button>
        <button class="mini-btn" data-action="filterProject" data-project-id="${p.id}" type="button">Показать задачи</button>
        <button class="mini-btn" data-action="archiveProject" data-project-id="${p.id}" type="button">${p.status === 'archived' ? 'Активировать' : 'В архив'}</button>
      </div>
      ${listHtml(items, 'Открытых задач нет')}
    </section>`;
  }).join('');
  return `<section class="section-head"><div><h2>Проекты</h2><p>Проект теперь отдельная сущность. Задачи и табель привязываются к проекту, а не просто к текстовой метке.</p></div></section>
    <section class="card project-form-card">
      <h3>Создать проект</h3>
      <div class="project-form-grid">
        <label>Название проекта *<input id="newProjectName" placeholder="Например: МЗМО, РДКБ, Сколтех" /></label>
        <label>Код / быстрый тег<input id="newProjectCode" placeholder="Например: МЗМО" /></label>
        <label>Статус<select id="newProjectStatus"><option value="active">Активный</option><option value="paused">Пауза</option><option value="archived">Архив</option></select></label>
        <label>Ответственный / заказчик<input id="newProjectOwner" placeholder="Кто ведёт / для кого" /></label>
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
    <div class="settings-grid">
      <label>Фамилия, имя, отчество <input id="profileFio" value="${escapeHtml(settings.fio || '')}" /></label>
      <label>Должность <input id="profilePosition" value="${escapeHtml(settings.position || '')}" /></label>
      <label>Учреждение <input id="profileInstitution" value="${escapeHtml(settings.institution || '')}" /></label>
      <label>Подразделение <input id="profileDepartment" value="${escapeHtml(settings.department || '')}" /></label>
      <label>Часы по умолчанию <input id="profileDefaultHours" type="number" min="0" step="0.5" value="${settings.defaultHours || 8}" /></label>
      <label>Быстрые проекты / теги <input id="profileQuickProjects" value="${escapeHtml(favoriteProjects().join(', '))}" placeholder="МЗМО, РДКБ, Сколтех" /></label>
      <label class="checkline"><input id="profileAutoSync" type="checkbox" ${settings.autoSync ? 'checked' : ''}/> Автосинхронизация</label>
      <div class="task-actions" style="align-items:end"><button class="primary" id="saveProfile" type="button">Сохранить профиль</button></div>
    </div>
    <div class="settings-grid">
      <label>Supabase Project URL <input id="syncUrl" value="${escapeHtml(settings.supabaseUrl || '')}" placeholder="https://xxxx.supabase.co" /></label>
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
    <div class="notice">Резервная копия: вкладка «Синхронизация» → «Резервная копия всех данных». Файл JSON можно хранить отдельно и восстановить через импорт.</div>
  </section>`;
}
function render() {
  renderProjectOptions();
  renderStats();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  const root = $('viewRoot');
  root.innerHTML = currentView === 'today' || currentView === 'tomorrow' ? renderToday()
    : currentView === 'week' ? renderWeek()
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
  });
  document.querySelectorAll('[data-quick-project]').forEach(btn => btn.onclick = () => {
    const target = btn.closest('#editForm') ? 'edit' : 'quick';
    applyQuickProject(btn.dataset.quickProject || '', target);
  });
  if ($('createProjectBtn')) $('createProjectBtn').onclick = createProjectFromForm;
  if ($('addWorkLog')) $('addWorkLog').onclick = () => addWorkLog({ date: $('workDate').value, project: $('workProject').value, hours: $('workHours').value, mark: $('workMark').value, comment: $('workComment').value });
  if ($('saveTimesheetMonth')) $('saveTimesheetMonth').onclick = () => { settings.timesheetMonth = $('timesheetMonth').value || currentMonth(); settings.timesheetProjectId = $('timesheetProject') ? $('timesheetProject').value : 'all'; saveSettings(); render(); };
  if ($('exportTimesheet')) $('exportTimesheet').onclick = () => exportTimesheetXml(settings.timesheetMonth || currentMonth(), settings.timesheetProjectId || 'all');
  if ($('exportLogsCsv')) $('exportLogsCsv').onclick = () => exportLogsCsv(settings.timesheetMonth || currentMonth(), settings.timesheetProjectId || 'all');
  if ($('saveProfile')) $('saveProfile').onclick = () => {
    settings.fio = $('profileFio').value.trim();
    settings.position = $('profilePosition').value.trim();
    settings.institution = $('profileInstitution').value.trim();
    settings.department = $('profileDepartment').value.trim();
    settings.defaultHours = Number($('profileDefaultHours').value || 8);
    settings.quickProjects = $('profileQuickProjects').value.split(',').map(x => x.trim()).filter(Boolean);
    settings.autoSync = $('profileAutoSync').checked;
    favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
    persistAll({ renderNow: true, sync: false });
    alert('Профиль сохранён.');
  };
  if ($('saveSyncSettings')) $('saveSyncSettings').onclick = () => { settings.supabaseUrl = $('syncUrl').value.trim(); settings.supabaseAnonKey = $('syncKey').value.trim(); settings.email = $('syncEmail').value.trim(); saveSettings({ renderNow: false }); alert('Настройки сохранены.'); scheduleAutoSync(500); };
  if ($('sendMagicLink')) $('sendMagicLink').onclick = sendMagicLink;
  if ($('syncNow')) $('syncNow').onclick = () => performSync({ silent: false });
  if ($('signOut')) $('signOut').onclick = signOut;
  if ($('exportBackup')) $('exportBackup').onclick = exportBackup;
  if ($('importJson')) $('importJson').onchange = importJson;
}
function downloadText(filename, text, type='text/plain;charset=utf-8') { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
function exportBackup() {
  settings.lastBackupAt = nowISO();
  persistAll({ renderNow: false, sync: false });
  const data = { kind: 'kvadrat-zadach-backup', version: APP_VERSION, exportedAt: nowISO(), projects, tasks, workLogs, settings };
  downloadText(`kvadrat-zadach-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}
async function importJson(e) {
  const file = e.target.files[0]; if (!file) return;
  const parsed = JSON.parse(await file.text());
  const incomingProjects = parsed.projects || [];
  const incomingTasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
  const incomingLogs = parsed.workLogs || [];
  if (!Array.isArray(incomingTasks)) return alert('Не нашёл массив задач в файле.');
  mergeProjects(incomingProjects.map(normalizeProject));
  mergeTasks(incomingTasks.map(normalizeTask));
  mergeWorkLogs(incomingLogs.map(normalizeWorkLog));
  persistAll({ renderNow: true, sync: true });
}
function mergeProjects(incoming) { const byId = new Map(projects.map(p => [p.id, p])); for (const p of incoming) { const old = byId.get(p.id); if (!old || new Date(p.updatedAt) >= new Date(old.updatedAt)) byId.set(p.id, normalizeProject(p)); } projects = [...byId.values()]; }
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
function getSupabaseClient() { if (!settings.supabaseUrl || !settings.supabaseAnonKey || !window.supabase) return null; return window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey); }
function scheduleAutoSync(delay = 1600) {
  if (!settings.autoSync || !settings.supabaseUrl || !settings.supabaseAnonKey) return;
  clearTimeout(autoSyncTimer);
  setSyncState('ожидает автосинхронизации', 'warn');
  autoSyncTimer = setTimeout(() => performSync({ silent: true }), delay);
}
async function sendMagicLink() {
  settings.supabaseUrl = $('syncUrl').value.trim(); settings.supabaseAnonKey = $('syncKey').value.trim(); settings.email = $('syncEmail').value.trim(); saveSettings();
  const client = getSupabaseClient(); if (!client) return alert('Сначала укажи Supabase URL и publishable key.'); if (!settings.email) return alert('Укажи email.');
  const { error } = await client.auth.signInWithOtp({ email: settings.email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return alert(error.message);
  alert('Ссылка входа отправлена на email. Открой её на этом устройстве.');
}
function projectToRow(p, userId) { return { id: p.id, user_id: userId, name: p.name, code: p.code || null, status: p.status || 'active', owner: p.owner || null, description: p.description || null, note: p.note || null, color: p.color || null, created_at: p.createdAt, updated_at: p.updatedAt, deleted_at: p.deletedAt }; }
function rowToProject(r) { return normalizeProject({ id: r.id, name: r.name, code: r.code || '', status: r.status || 'active', owner: r.owner || '', description: r.description || '', note: r.note || '', color: r.color || '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at }); }
function taskToRow(t, userId) { const n = normalizeTask(t); return { id: n.id, user_id: userId, title: n.title, project_id: n.projectId || null, project: projectName(n.projectId, n.project) === 'Без проекта' ? null : projectName(n.projectId, n.project), due_date: n.dueDate || null, plan_date: n.planDate || null, status: n.status, priority: n.priority, importance: n.importance, urgency: n.urgency, note: n.note || null, day_bucket: n.dayBucket || 'none', order_index: n.orderIndex || 0, created_at: n.createdAt, updated_at: n.updatedAt, done_at: n.doneAt, deleted_at: n.deletedAt }; }
function rowToTask(r) { return normalizeTask({ id: r.id, title: r.title, projectId: r.project_id || '', project: r.project || '', dueDate: r.due_date || '', planDate: r.plan_date || '', status: r.status, priority: r.priority, importance: r.importance, urgency: r.urgency, note: r.note || '', dayBucket: r.day_bucket || 'none', orderIndex: r.order_index || 0, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at, deletedAt: r.deleted_at }); }
function workLogToRow(l, userId) { const n = normalizeWorkLog(l); return { id: n.id, user_id: userId, work_date: n.date, project_id: n.projectId || null, project: projectName(n.projectId, n.project), hours: n.hours, mark: n.mark, comment: n.comment || null, created_at: n.createdAt, updated_at: n.updatedAt, deleted_at: n.deletedAt }; }
function rowToWorkLog(r) { return normalizeWorkLog({ id: r.id, date: r.work_date, projectId: r.project_id || '', project: r.project || '', hours: r.hours, mark: r.mark, comment: r.comment || '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at }); }
async function performSync({ silent = false } = {}) {
  if (syncInProgress) return false;
  const client = getSupabaseClient();
  if (!client) { if (!silent) alert('Сначала укажи Supabase URL и publishable key.'); return false; }
  syncInProgress = true; setSyncState('синхронизация...', 'warn');
  try {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) { setSyncState('нужен вход по email', 'bad'); if (!silent) alert('Сначала войди по ссылке из email.'); return false; }
    const localProjects = projects.map(p => projectToRow(normalizeProject(p), user.id));
    if (localProjects.length) { const { error } = await client.from('projects').upsert(localProjects, { onConflict: 'id' }); if (error) throw error; }
    const localTasks = tasks.map(t => taskToRow(normalizeTask(t), user.id));
    if (localTasks.length) { const { error } = await client.from('tasks').upsert(localTasks, { onConflict: 'id' }); if (error) throw error; }
    const localLogs = workLogs.map(l => workLogToRow(normalizeWorkLog(l), user.id));
    if (localLogs.length) { const { error } = await client.from('work_logs').upsert(localLogs, { onConflict: 'id' }); if (error) throw error; }
    const { data: remoteProjects, error: pErr } = await client.from('projects').select('*').order('updated_at', { ascending: false }); if (pErr) throw pErr;
    const { data: remoteTasks, error: tErr } = await client.from('tasks').select('*').order('updated_at', { ascending: false }); if (tErr) throw tErr;
    const { data: remoteLogs, error: lErr } = await client.from('work_logs').select('*').order('updated_at', { ascending: false }); if (lErr) throw lErr;
    mergeProjects((remoteProjects || []).map(rowToProject));
    mergeTasks((remoteTasks || []).map(rowToTask));
    mergeWorkLogs((remoteLogs || []).map(rowToWorkLog));
    hardResetDeleted();
    setSyncState('синхронизировано ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'ok');
    if (!silent) alert('Синхронизация выполнена.');
    return true;
  } catch (error) {
    const msg = error?.message || String(error);
    setSyncState('ошибка синхронизации', 'bad');
    if (!silent) {
      if (msg.includes('projects') && msg.includes('does not exist')) alert('В Supabase нет таблицы projects. Открой SQL Editor и выполни обновлённый supabase.sql из версии 1.5.');
      else if (msg.includes('project_id')) alert('В Supabase нет поля project_id. Открой SQL Editor и выполни обновлённый supabase.sql из версии 1.5.');
      else alert(msg);
    }
    return false;
  } finally { syncInProgress = false; }
}
async function signOut() { const client = getSupabaseClient(); if (client) await client.auth.signOut(); setSyncState('выход выполнен', 'idle'); alert('Выход выполнен. Локальные данные остаются на устройстве.'); }
const SQL_TEMPLATE = `create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active','paused','archived')),
  owner text,
  description text,
  note text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.work_logs add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks alter column order_index type bigint using order_index::bigint;

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;

drop policy if exists "Users can select own projects" on public.projects;
drop policy if exists "Users can insert own projects" on public.projects;
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Users can delete own projects" on public.projects;

create policy "Users can select own projects" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own projects" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own projects" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own projects" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can select own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
drop policy if exists "Users can select own work logs" on public.work_logs;
drop policy if exists "Users can insert own work logs" on public.work_logs;
drop policy if exists "Users can update own work logs" on public.work_logs;
drop policy if exists "Users can delete own work logs" on public.work_logs;

create policy "Users can select own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own work logs" on public.work_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own work logs" on public.work_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own work logs" on public.work_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own work logs" on public.work_logs for delete to authenticated using ((select auth.uid()) = user_id);`;
function migrateLocalData() {
  projects = projects.map(normalizeProject);
  favoriteProjects().forEach(name => ensureProject(name, { persist: false }));
  [...tasks, ...workLogs].forEach(x => { if (x.project) ensureProject(x.project, { persist: false }); });
  tasks = tasks.map(normalizeTask);
  workLogs = workLogs.map(normalizeWorkLog);
  persistAll({ renderNow: false, sync: false });
}
function boot() {
  migrateLocalData();
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
