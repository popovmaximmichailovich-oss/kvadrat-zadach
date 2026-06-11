const APP_VERSION = '1.4.0';
const STORAGE_KEY = 'eisenhower_tasks_v1';
const WORKLOGS_KEY = 'eisenhower_worklogs_v1';
const SETTINGS_KEY = 'eisenhower_tasks_settings_v1';

const statusLabels = {
  inbox: 'Входящие', planned: 'Запланировано', doing: 'В работе', delegated: 'Делегировано', deferred: 'Отложено', done: 'Выполнено'
};
const priorityLabels = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
const bucketLabels = { none: 'Без 1–3–5', one: '1 главная', three: '3 важные', five: '5 мелких' };
const workMarkLabels = { 'Я': 'Явка', 'В': 'Выходной', 'Б': 'Больничный', 'ОТ': 'Отпуск', 'НН': 'Неявка' };

let tasks = loadTasks();
let workLogs = loadWorkLogs();
let settings = loadSettings();
let currentView = 'today';
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const nowISO = () => new Date().toISOString();

function loadTasks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  render();
}
function loadWorkLogs() {
  try { return JSON.parse(localStorage.getItem(WORKLOGS_KEY) || '[]'); }
  catch { return []; }
}
function saveWorkLogs() {
  localStorage.setItem(WORKLOGS_KEY, JSON.stringify(workLogs));
  render();
}
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
      timesheetProject: s.timesheetProject || 'all',
      supabaseUrl: s.supabaseUrl || '',
      supabaseAnonKey: s.supabaseAnonKey || '',
      email: s.email || ''
    };
  } catch {
    return { fio: 'Попов Максим Михайлович', position: 'Руководитель проекта', defaultHours: 8, quickProjects: ['МЗМО', 'РДКБ', 'Сколтех'], timesheetProject: 'all' };
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function normalizeTask(t) {
  return {
    id: t.id || uid(),
    title: (t.title || '').trim(),
    project: (t.project || '').trim(),
    dueDate: t.dueDate || '',
    planDate: t.planDate || '',
    status: t.status || 'inbox',
    priority: t.priority || 'C',
    importance: t.importance || 'low',
    urgency: t.urgency || 'low',
    note: t.note || '',
    dayBucket: t.dayBucket || 'none',
    orderIndex: Number.isFinite(t.orderIndex) ? t.orderIndex : Date.now(),
    createdAt: t.createdAt || nowISO(),
    updatedAt: t.updatedAt || nowISO(),
    doneAt: t.doneAt || null,
    deletedAt: t.deletedAt || null
  };
}
function normalizeWorkLog(l) {
  const hours = Number(l.hours ?? settings.defaultHours ?? 8);
  return {
    id: l.id || uid(),
    date: l.date || today(),
    project: (l.project || '').trim() || 'Без проекта',
    hours: Number.isFinite(hours) ? Math.max(0, hours) : 8,
    mark: l.mark || 'Я',
    comment: l.comment || '',
    createdAt: l.createdAt || nowISO(),
    updatedAt: l.updatedAt || nowISO(),
    deletedAt: l.deletedAt || null
  };
}
function activeTasks() { return tasks.filter(t => !t.deletedAt); }
function activeWorkLogs() { return workLogs.filter(l => !l.deletedAt); }
function visibleTasks() {
  const q = $('searchInput').value.trim().toLowerCase();
  const p = $('projectFilter').value;
  return activeTasks().filter(t => {
    const hay = [t.title, t.project, t.note, t.status, t.priority].join(' ').toLowerCase();
    const okSearch = !q || hay.includes(q);
    const okProject = p === 'all' || (t.project || 'Без проекта') === p;
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
  const t = normalizeTask({
    title,
    project: advancedOpen ? $('fieldProject').value : '',
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
function deleteTask(id) {
  updateTask(id, { deletedAt: nowISO() });
}
function hardResetDeleted() {
  tasks = tasks.filter(t => !t.deletedAt);
  workLogs = workLogs.filter(l => !l.deletedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(WORKLOGS_KEY, JSON.stringify(workLogs));
  render();
}
function completeTask(id) {
  updateTask(id, { status: 'done', doneAt: nowISO(), dayBucket: 'none' });
}
function restoreTask(id) {
  updateTask(id, { status: 'planned', doneAt: null });
}
function addWorkLog(input) {
  const log = normalizeWorkLog(input);
  workLogs.unshift(log);
  saveWorkLogs();
}
function deleteWorkLog(id) {
  workLogs = workLogs.map(l => l.id === id ? normalizeWorkLog({ ...l, deletedAt: nowISO(), updatedAt: nowISO() }) : l);
  saveWorkLogs();
}
function quickLogProject(project, comment='') {
  addWorkLog({ date: today(), project: project || 'Без проекта', hours: settings.defaultHours || 8, mark: 'Я', comment });
}
function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function isOverdue(t) { return t.status !== 'done' && t.dueDate && t.dueDate < today(); }
function dateLabel(iso) {
  if (!iso) return '';
  if (iso === today()) return 'сегодня';
  if (iso === addDays(1)) return 'завтра';
  return iso.split('-').reverse().join('.');
}
function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function currentMonth() { return today().slice(0, 7); }
function favoriteProjects() {
  return [...new Set((settings.quickProjects || []).map(x => String(x || '').trim()).filter(Boolean))];
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function taskCard(t) {
  const overdue = isOverdue(t);
  return `<article class="task-card ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <p class="task-title">${escapeHtml(t.title)}</p>
    <div class="task-meta">
      <span class="badge priority-${t.priority}">${priorityLabels[t.priority] || t.priority}</span>
      <span class="badge">${statusLabels[t.status]}</span>
      ${t.project ? `<span class="badge">${escapeHtml(t.project)}</span>` : `<span class="badge">Без проекта</span>`}
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
      ${t.project ? `<button class="mini-btn" data-action="logTaskProject" data-id="${t.id}" type="button">Работал</button>` : ''}
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
    <span class="stat"><strong>${todayHours}</strong> ч сегодня в табеле</span>
  `;
}
function allProjects() {
  return [...new Set([
    ...favoriteProjects(),
    ...activeTasks().map(t => t.project || 'Без проекта'),
    ...activeWorkLogs().map(l => l.project || 'Без проекта')
  ])].filter(Boolean).sort((a,b) => a.localeCompare(b, 'ru'));
}
function renderQuickTagBars() {
  const projects = favoriteProjects();
  const chipHtml = projects.map(p => `<button class="tag-chip" data-quick-project="${escapeHtml(p)}" type="button">#${escapeHtml(p)}</button>`).join('');
  const addHint = `<span class="tag-hint">Быстрые теги автоматически подставляют проект. Список можно менять в профиле.</span>`;
  if ($('quickTagBar')) $('quickTagBar').innerHTML = chipHtml + addHint;
  if ($('editTagBar')) $('editTagBar').innerHTML = chipHtml;
}
function renderProjectOptions() {
  const projects = allProjects();
  const current = $('projectFilter').value || 'all';
  $('projectFilter').innerHTML = '<option value="all">Все проекты</option>' + projects.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if ([...$('projectFilter').options].some(o => o.value === current)) $('projectFilter').value = current;
  $('projectList').innerHTML = projects.filter(p => p !== 'Без проекта').map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
  renderQuickTagBars();
}
function applyQuickProject(project, target='quick') {
  const value = String(project || '').trim();
  if (!value) return;
  if (target === 'edit') {
    $('editProject').value = value;
  } else {
    $('advancedDetails').open = true;
    $('fieldProject').value = value;
    if (!$('fieldPlanDate').value) $('fieldPlanDate').value = today();
    if ($('fieldStatus').value === 'inbox') $('fieldStatus').value = 'planned';
  }
  document.querySelectorAll('[data-quick-project]').forEach(btn => btn.classList.toggle('active', btn.dataset.quickProject === value));
}
function renderToday() {
  const d = currentView === 'tomorrow' ? addDays(1) : today();
  const title = currentView === 'tomorrow' ? 'Завтра' : 'Сегодня';
  const list = visibleTasks().filter(t => t.status !== 'done' && t.planDate === d);
  return `<section class="section-head"><div><h2>${title}</h2><p>План дня по Айви Ли + 1–3–5: сначала главное, потом важное, потом мелкое.</p></div></section>
  <div class="grid-135">
    <section class="column"><h3>1 главная</h3><p class="column-sub">Одна задача, которая двигает день.</p>${listHtml(list.filter(t => t.dayBucket === 'one'), 'Главная задача не выбрана')}</section>
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
  const list = visibleTasks().filter(t => t.status === 'inbox' && t.status !== 'done');
  return `<section class="section-head"><div><h2>Разбор входящих</h2><p>Сюда попадает всё, что ты записал одной строкой. Потом назначаешь проект, дату и приоритет.</p></div></section>
  ${listHtml(list, 'Входящие разобраны')}`;
}
function renderMatrix() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const q = (importance, urgency) => list.filter(t => t.importance === importance && t.urgency === urgency);
  return `<section class="section-head"><div><h2>Матрица Эйзенхауэра</h2><p>Важное защищаем. Срочное контролируем. Лишнее убираем.</p></div></section>
  <div class="matrix-grid">
    <section class="column"><h3>Важно и срочно</h3><p class="column-sub">Сделать сейчас</p>${listHtml(q('high','high'), 'Пожаров нет')}</section>
    <section class="column"><h3>Важно, не срочно</h3><p class="column-sub">Запланировать</p>${listHtml(q('high','low'), 'Стратегические задачи не назначены')}</section>
    <section class="column"><h3>Срочно, не важно</h3><p class="column-sub">Делегировать / ограничить</p>${listHtml(q('low','high'), 'Чужой срочности нет')}</section>
    <section class="column"><h3>Не важно и не срочно</h3><p class="column-sub">Удалить / отложить</p>${listHtml(q('low','low'), 'Шума нет')}</section>
  </div>`;
}
function kanbanCompactHtml(list) {
  const items = sortTasks(list);
  if (!items.length) return `<div class="empty">Пусто</div>`;
  const grouped = new Map();
  items.forEach(t => {
    const project = t.project || 'Без проекта';
    if (!grouped.has(project)) grouped.set(project, []);
    grouped.get(project).push(t);
  });
  return `<div class="kanban-project-list">${[...grouped.entries()].map(([project, tasks]) => `
    <section class="kanban-project">
      <button class="kanban-project-title" data-action="setProjectFilter" data-project="${escapeHtml(project)}" type="button">
        <span>${escapeHtml(project)}</span>
        <strong>${tasks.length}</strong>
      </button>
      <div class="kanban-task-links">
        ${tasks.map(t => {
          const overdue = isOverdue(t);
          const date = t.dueDate || t.planDate || '';
          return `<button class="kanban-task-link ${overdue ? 'overdue-link' : ''}" data-action="edit" data-id="${t.id}" type="button" title="Открыть задачу">
            <span class="kanban-task-title">${escapeHtml(t.title)}</span>
            <span class="kanban-task-meta"><b>${escapeHtml(t.priority)}</b>${date ? ` · ${escapeHtml(dateLabel(date))}` : ''}</span>
          </button>`;
        }).join('')}
      </div>
    </section>`).join('')}</div>`;
}
function renderKanban() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const statuses = ['inbox','planned','doing','delegated','deferred'];
  return `<section class="section-head"><div><h2>Канбан</h2><p>По колонкам видны проекты. Задачи внутри проекта показаны короткими ссылками: нажал — открыл карточку и прочитал детали.</p></div></section>
  <div class="kanban-grid">${statuses.map(s => {
    const statusTasks = list.filter(t => t.status === s);
    const projectCount = new Set(statusTasks.map(t => t.project || 'Без проекта')).size;
    return `<section class="column kanban-column"><h3>${statusLabels[s]}</h3><p class="column-sub">${statusTasks.length} задач · ${projectCount} проектов</p>${kanbanCompactHtml(statusTasks)}</section>`;
  }).join('')}</div>`;
}
function renderProjects() {
  const list = visibleTasks().filter(t => t.status !== 'done');
  const projects = allProjects();
  return `<section class="section-head"><div><h2>Проекты</h2><p>Проект — это метка. Здесь можно быстро отметить, что сегодня ты занимался конкретным проектом.</p></div></section>
  <div class="grid-2">${projects.map(p => {
    const items = list.filter(t => (t.project || 'Без проекта') === p);
    const month = activeWorkLogs().filter(l => l.project === p && l.date.slice(0,7) === currentMonth() && l.mark === 'Я');
    const hours = month.reduce((s,l) => s + Number(l.hours || 0), 0);
    return `<section class="column project-card"><h3>${escapeHtml(p)}</h3><p class="project-count">${items.length} открытых задач · ${hours} ч за ${monthTitle(currentMonth())}</p><div class="task-actions"><button class="mini-btn" data-action="quickLogProject" data-project="${escapeHtml(p)}" type="button">Отметить сегодня</button></div>${listHtml(items)}</section>`;
  }).join('') || '<div class="empty">Проектов пока нет</div>'}</div>`;
}
function renderArchive() {
  const list = visibleTasks().filter(t => t.status === 'done');
  return `<section class="section-head"><div><h2>Архив</h2><p>Выполненные задачи. Можно вернуть обратно в работу.</p></div></section>${listHtml(list, 'Архив пуст')}`;
}
function buildTimesheet(ym, projectFilter='all') {
  const totalDays = daysInMonth(ym);
  const logs = activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectFilter === 'all' || l.project === projectFilter));
  const byDay = new Map();
  for (let d = 1; d <= totalDays; d++) byDay.set(d, { hours: 0, marks: [], projects: new Set(), comments: [] });
  logs.forEach(l => {
    const day = Number(l.date.slice(8,10));
    const cell = byDay.get(day);
    if (!cell) return;
    if (l.mark === 'Я') cell.hours += Number(l.hours || 0);
    cell.marks.push(l.mark);
    cell.projects.add(l.project || 'Без проекта');
    if (l.comment) cell.comments.push(l.comment);
  });
  const dayData = [];
  for (let d = 1; d <= 31; d++) {
    const cell = byDay.get(d) || { hours: '', marks: [], projects: new Set(), comments: [] };
    const hasWork = cell.hours > 0;
    const nonWork = cell.marks.find(m => m !== 'Я');
    dayData.push({
      day: d,
      hours: d <= totalDays && hasWork ? cell.hours : '',
      code: d <= totalDays ? (hasWork ? 'Я' : (nonWork || '')) : '',
      projects: [...cell.projects],
      comments: cell.comments
    });
  }
  const totals = (from, to) => {
    const slice = dayData.filter(x => x.day >= from && x.day <= to);
    return {
      hours: slice.reduce((s,x) => s + (Number(x.hours) || 0), 0),
      workDays: slice.filter(x => x.code === 'Я').length,
      absenceDays: slice.filter(x => x.code && x.code !== 'Я').length
    };
  };
  return { ym, totalDays, dayData, firstHalf: totals(1, 15), monthTotal: totals(1, totalDays), logs, projectFilter };
}
function buildProjectBreakdown(ym) {
  return allProjects().filter(p => p !== 'Без проекта').map(project => {
    const ts = buildTimesheet(ym, project);
    const entries = activeWorkLogs().filter(l => l.date.startsWith(ym) && l.project === project).length;
    return { project, firstHalfHours: ts.firstHalf.hours, firstHalfDays: ts.firstHalf.workDays, monthHours: ts.monthTotal.hours, monthDays: ts.monthTotal.workDays, entries };
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
  const scopeLabel = ts.projectFilter === 'all' ? 'Все проекты' : ts.projectFilter;
  return `<div class="table-wrap"><table class="timesheet-table"><caption style="caption-side:top; text-align:left; padding:10px 12px; color:var(--muted)">Табель: ${escapeHtml(scopeLabel)}</caption>
    <thead>
      <tr><th>Фамилия, имя, отчество</th><th>Должность</th>${firstDays.map(x => `<th>${x.day}</th>`).join('')}<th>Итого дней (часов) явок (неявок) с 1 по 15</th>${secondDays.map(x => `<th>${x.day}</th>`).join('')}<th>Всего дней (часов) явок (неявок) за месяц</th></tr>
    </thead>
    <tbody>
      <tr><td rowspan="2">${escapeHtml(settings.fio || '')}</td><td rowspan="2">${escapeHtml(settings.position || '')}</td>${firstDays.map(x => `<td title="${escapeHtml(x.projects.join(', '))}">${x.hours}</td>`).join('')}<td>${ts.firstHalf.hours}</td>${secondDays.map(x => `<td title="${escapeHtml(x.projects.join(', '))}">${x.hours}</td>`).join('')}<td>${ts.monthTotal.hours}</td></tr>
      <tr>${firstDays.map(x => `<td>${x.code}</td>`).join('')}<td>${ts.firstHalf.workDays}${ts.firstHalf.absenceDays ? ` / Н:${ts.firstHalf.absenceDays}` : ''}</td>${secondDays.map(x => `<td>${x.code}</td>`).join('')}<td>${ts.monthTotal.workDays}${ts.monthTotal.absenceDays ? ` / Н:${ts.monthTotal.absenceDays}` : ''}</td></tr>
      <tr><td colspan="35" style="text-align:left">Проекты по датам: ${escapeHtml(comments || 'нет отметок')}</td></tr>
    </tbody>
  </table></div>`;
}
function renderWorkLogs(ym) {
  const projectFilter = settings.timesheetProject || 'all';
  const logs = activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectFilter === 'all' || l.project === projectFilter)).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!logs.length) return `<div class="empty">Отметок за выбранный месяц пока нет</div>`;
  return `<div class="log-list">${logs.map(l => `<div class="log-row"><span>${dateLabel(l.date)}</span><strong>${escapeHtml(l.project)}</strong><span>${l.hours} ч</span><span>${escapeHtml(l.mark)}</span><span>${escapeHtml(l.comment || '')}</span><button class="mini-btn" data-action="deleteWorkLog" data-id="${l.id}" type="button">Удалить</button></div>`).join('')}</div>`;
}
function renderTimesheet() {
  const ym = settings.timesheetMonth || currentMonth();
  const currentProject = settings.timesheetProject || 'all';
  const ts = buildTimesheet(ym, currentProject);
  const projects = allProjects().filter(p => p !== 'Без проекта');
  return `<section class="timesheet-panel card">
    <div><h2>Табель и отметки по проектам</h2><p>Здесь можно отметить часы по проектам и отдельно смотреть свод по каждому проекту: МЗМО, РДКБ, Сколтех и любым другим.</p></div>
    <div class="notice">Для быстрой отметки нажми «Отметить сегодня» в карточке проекта или «Работал» в задаче с указанным проектом.</div>
    <div class="timesheet-entry">
      <label>Дата <input id="workDate" type="date" value="${today()}" /></label>
      <label>Проект <input id="workProject" list="projectList" value="${escapeHtml(projects[0] || '')}" placeholder="Проект" /></label>
      <label>Часы <input id="workHours" type="number" min="0" step="0.5" value="${settings.defaultHours || 8}" /></label>
      <label>Код <select id="workMark">${Object.entries(workMarkLabels).map(([k,v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></label>
      <label>Комментарий <input id="workComment" placeholder="Что делал / уточнение" /></label>
      <button class="primary" id="addWorkLog" type="button">Отметить</button>
    </div>
    <div class="timesheet-grid">
      <label>Месяц табеля <input id="timesheetMonth" type="month" value="${ym}" /></label>
      <label>Проект табеля
        <select id="timesheetProject">
          <option value="all">Все проекты</option>
          ${projects.map(p => `<option value="${escapeHtml(p)}" ${p === currentProject ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
        </select>
      </label>
      <div class="task-actions" style="align-items:end">
        <button class="ghost" id="saveTimesheetMonth" type="button">Показать</button>
        <button class="ghost" id="exportTimesheet" type="button">Экспорт табеля Excel</button>
        <button class="ghost" id="exportLogsCsv" type="button">Экспорт журнала CSV</button>
      </div>
    </div>
    <section><h3>Свод по проектам за ${monthTitle(ym)}</h3>${renderProjectSummaryCards(ym)}</section>
    ${timesheetTableHtml(ts)}
    <section><h3>Разделение по проектам</h3>${projectBreakdownTableHtml(ym)}</section>
    <section><h3>Журнал отметок за ${monthTitle(ym)}</h3>${renderWorkLogs(ym)}</section>
  </section>`;
}
function getSupabaseClient() {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !window.supabase) return null;
  return window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
}
function renderSettings() {
  return `<section class="settings-panel card">
    <div><h2>Синхронизация и профиль</h2><p>Приложение работает локально сразу. Для обмена между iPhone и ноутбуком подключи бесплатный Supabase-проект и войди по email magic link.</p></div>
    <div class="notice">GitHub Pages хранит только код приложения. Твои задачи и табель хранятся локально и, при включении синхронизации, в твоём Supabase-проекте.</div>
    <div class="settings-grid">
      <label>Фамилия, имя, отчество <input id="profileFio" value="${escapeHtml(settings.fio || '')}" /></label>
      <label>Должность <input id="profilePosition" value="${escapeHtml(settings.position || '')}" /></label>
      <label>Учреждение <input id="profileInstitution" value="${escapeHtml(settings.institution || '')}" /></label>
      <label>Подразделение <input id="profileDepartment" value="${escapeHtml(settings.department || '')}" /></label>
      <label>Часы по умолчанию <input id="profileDefaultHours" type="number" min="0" step="0.5" value="${settings.defaultHours || 8}" /></label>
      <label>Быстрые проекты / теги <input id="profileQuickProjects" value="${escapeHtml((settings.quickProjects || []).join(', '))}" placeholder="МЗМО, РДКБ, Сколтех" /></label>
      <div class="task-actions" style="align-items:end"><button class="primary" id="saveProfile" type="button">Сохранить профиль</button></div>
    </div>
    <div class="settings-grid">
      <label>Supabase Project URL <input id="syncUrl" value="${escapeHtml(settings.supabaseUrl || '')}" placeholder="https://xxxx.supabase.co" /></label>
      <label>Supabase anon public key <input id="syncKey" value="${escapeHtml(settings.supabaseAnonKey || '')}" placeholder="eyJ..." /></label>
    </div>
    <div class="settings-grid">
      <label>Email для входа <input id="syncEmail" value="${escapeHtml(settings.email || '')}" placeholder="name@example.com" /></label>
      <div class="task-actions" style="align-items:end">
        <button class="primary" id="saveSyncSettings" type="button">Сохранить настройки</button>
        <button class="ghost" id="sendMagicLink" type="button">Отправить ссылку входа</button>
        <button class="ghost" id="syncNow" type="button">Синхронизировать</button>
        <button class="ghost" id="signOut" type="button">Выйти</button>
      </div>
    </div>
    <div class="settings-grid">
      <button class="ghost" id="exportJson" type="button">Экспорт JSON</button>
      <label class="ghost" style="text-align:center; cursor:pointer">Импорт JSON<input id="importJson" type="file" accept="application/json" style="display:none" /></label>
    </div>
    <div><h3>SQL для Supabase</h3><p>Вставь один раз в Supabase → SQL Editor → Run.</p><pre class="sql-box">${escapeHtml(SQL_TEMPLATE)}</pre></div>
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
    : renderSettings();
  bindDynamicActions();
}
function openEdit(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  $('editId').value = t.id;
  $('editTitle').value = t.title;
  $('editProject').value = t.project;
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
  updateTask(id, {
    title: $('editTitle').value,
    project: $('editProject').value,
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
    if (action === 'logTaskProject') {
      const t = tasks.find(x => x.id === id);
      if (t) quickLogProject(t.project, t.title);
    }
    if (action === 'quickLogProject') quickLogProject(btn.dataset.project || 'Без проекта');
    if (action === 'setProjectFilter') {
      const project = btn.dataset.project || 'all';
      $('projectFilter').value = project;
      render();
    }
    if (action === 'deleteWorkLog') deleteWorkLog(id);
  });
  document.querySelectorAll('[data-quick-project]').forEach(btn => btn.onclick = () => {
    const target = btn.closest('#editForm') ? 'edit' : 'quick';
    applyQuickProject(btn.dataset.quickProject || '', target);
  });
  if ($('addWorkLog')) $('addWorkLog').onclick = () => addWorkLog({
    date: $('workDate').value,
    project: $('workProject').value,
    hours: $('workHours').value,
    mark: $('workMark').value,
    comment: $('workComment').value
  });
  if ($('saveTimesheetMonth')) $('saveTimesheetMonth').onclick = () => {
    settings.timesheetMonth = $('timesheetMonth').value || currentMonth();
    settings.timesheetProject = $('timesheetProject') ? $('timesheetProject').value : 'all';
    saveSettings();
    render();
  };
  if ($('exportTimesheet')) $('exportTimesheet').onclick = () => exportTimesheetXml(settings.timesheetMonth || currentMonth(), settings.timesheetProject || 'all');
  if ($('exportLogsCsv')) $('exportLogsCsv').onclick = () => exportLogsCsv(settings.timesheetMonth || currentMonth(), settings.timesheetProject || 'all');
  if ($('saveProfile')) $('saveProfile').onclick = () => {
    settings.fio = $('profileFio').value.trim();
    settings.position = $('profilePosition').value.trim();
    settings.institution = $('profileInstitution').value.trim();
    settings.department = $('profileDepartment').value.trim();
    settings.defaultHours = Number($('profileDefaultHours').value || 8);
    settings.quickProjects = $('profileQuickProjects').value.split(',').map(x => x.trim()).filter(Boolean);
    saveSettings();
    alert('Профиль сохранён.');
  };
  if ($('saveSyncSettings')) $('saveSyncSettings').onclick = () => {
    settings.supabaseUrl = $('syncUrl').value.trim();
    settings.supabaseAnonKey = $('syncKey').value.trim();
    settings.email = $('syncEmail').value.trim();
    saveSettings();
    alert('Настройки сохранены.');
  };
  if ($('sendMagicLink')) $('sendMagicLink').onclick = sendMagicLink;
  if ($('syncNow')) $('syncNow').onclick = syncNow;
  if ($('signOut')) $('signOut').onclick = signOut;
  if ($('exportJson')) $('exportJson').onclick = exportJson;
  if ($('importJson')) $('importJson').onchange = importJson;
}
function downloadText(filename, text, type='text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportJson() {
  downloadText(`kvadrat-zadach-${today()}.json`, JSON.stringify({ version: APP_VERSION, exportedAt: nowISO(), tasks, workLogs, settings }, null, 2), 'application/json;charset=utf-8');
}
async function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  const incomingTasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  const incomingLogs = parsed.workLogs || [];
  if (!Array.isArray(incomingTasks)) return alert('Не нашёл массив задач в файле.');
  mergeTasks(incomingTasks.map(normalizeTask));
  if (Array.isArray(incomingLogs)) mergeWorkLogs(incomingLogs.map(normalizeWorkLog));
  saveTasks();
  saveWorkLogs();
}
function mergeTasks(incoming) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const t of incoming) {
    const old = byId.get(t.id);
    if (!old || new Date(t.updatedAt) >= new Date(old.updatedAt)) byId.set(t.id, normalizeTask(t));
  }
  tasks = [...byId.values()];
}
function mergeWorkLogs(incoming) {
  const byId = new Map(workLogs.map(l => [l.id, l]));
  for (const l of incoming) {
    const old = byId.get(l.id);
    if (!old || new Date(l.updatedAt) >= new Date(old.updatedAt)) byId.set(l.id, normalizeWorkLog(l));
  }
  workLogs = [...byId.values()];
}
function csvEscape(s) {
  const v = String(s ?? '');
  return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function exportLogsCsv(ym, projectFilter='all') {
  const rows = [['Дата','Проект','Часы','Код','Комментарий']];
  activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectFilter === 'all' || l.project === projectFilter)).sort((a,b) => a.date.localeCompare(b.date)).forEach(l => rows.push([l.date, l.project, l.hours, l.mark, l.comment]));
  const suffix = projectFilter === 'all' ? 'all' : projectFilter.replace(/\s+/g, '-');
  downloadText(`zhurnal-proektov-${ym}-${suffix}.csv`, rows.map(r => r.map(csvEscape).join(';')).join('\n'), 'text/csv;charset=utf-8');
}
function xmlCell(value, type='String', style='sBody') {
  const v = value === null || value === undefined ? '' : String(value);
  if (v === '') return `<Cell ss:StyleID="${style}"/>`;
  const dataType = type === 'Number' && !Number.isNaN(Number(v)) ? 'Number' : 'String';
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${dataType}">${escapeXml(v)}</Data></Cell>`;
}
function escapeXml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function exportTimesheetXml(ym, projectFilter='all') {
  const ts = buildTimesheet(ym, projectFilter);
  const [year, month] = ym.split('-').map(Number);
  const firstDays = ts.dayData.slice(0, 15);
  const secondDays = ts.dayData.slice(15, 31);
  const rows = [];
  rows.push(`<Row>${xmlCell('', 'String', 'sTitle')}${xmlCell('', 'String', 'sTitle')}${xmlCell('Т а б е л ь №', 'String', 'sTitle')}${xmlCell('0000-000019', 'String', 'sTitle')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sHeader')}${xmlCell('', 'String', 'sHeader')}${xmlCell('учета использования рабочего времени', 'String', 'sHeader')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sBody')}${xmlCell('', 'String', 'sBody')}${xmlCell(`за ${monthTitle(ym)}`, 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Учреждение', 'String', 'sBody')}${xmlCell(settings.institution || '', 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Структурное подразделение', 'String', 'sBody')}${xmlCell(settings.department || '', 'String', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('Вид табеля', 'String', 'sBody')}${xmlCell('первичный', 'String', 'sBody')}${xmlCell('Дата формирования', 'String', 'sBody')}${xmlCell(new Date().toLocaleDateString('ru-RU'), 'String', 'sBody')}</Row>`);
  rows.push(`<Row></Row>`);
  rows.push(`<Row>${xmlCell('Фамилия, имя, отчество', 'String', 'sHeader')}${xmlCell('Должность', 'String', 'sHeader')}${firstDays.map(x => xmlCell(x.day, 'Number', 'sHeader')).join('')}${xmlCell('Итого дней (часов) явок (неявок) с 1 по 15', 'String', 'sHeader')}${secondDays.map(x => xmlCell(x.day, 'Number', 'sHeader')).join('')}${xmlCell('Всего дней (часов) явок (неявок) за месяц', 'String', 'sHeader')}</Row>`);
  rows.push(`<Row>${xmlCell(settings.fio || '', 'String', 'sBody')}${xmlCell(settings.position || '', 'String', 'sBody')}${firstDays.map(x => xmlCell(x.hours, 'Number', 'sBody')).join('')}${xmlCell(ts.firstHalf.hours, 'Number', 'sBody')}${secondDays.map(x => xmlCell(x.hours, 'Number', 'sBody')).join('')}${xmlCell(ts.monthTotal.hours, 'Number', 'sBody')}</Row>`);
  rows.push(`<Row>${xmlCell('', 'String', 'sBody')}${xmlCell('', 'String', 'sBody')}${firstDays.map(x => xmlCell(x.code, 'String', 'sBody')).join('')}${xmlCell(`${ts.firstHalf.workDays}${ts.firstHalf.absenceDays ? ' / Н:' + ts.firstHalf.absenceDays : ''}`, 'String', 'sBody')}${secondDays.map(x => xmlCell(x.code, 'String', 'sBody')).join('')}${xmlCell(`${ts.monthTotal.workDays}${ts.monthTotal.absenceDays ? ' / Н:' + ts.monthTotal.absenceDays : ''}`, 'String', 'sBody')}</Row>`);
  rows.push(`<Row></Row>`);
  rows.push(`<Row>${xmlCell(projectFilter === 'all' ? 'Журнал отметок по проектам' : 'Журнал отметок по проекту: ' + projectFilter, 'String', 'sHeader')}</Row>`);
  rows.push(`<Row>${['Дата','Проект','Часы','Код','Комментарий'].map(h => xmlCell(h, 'String', 'sHeader')).join('')}</Row>`);
  activeWorkLogs().filter(l => l.date.startsWith(ym) && (projectFilter === 'all' || l.project === projectFilter)).sort((a,b) => a.date.localeCompare(b.date)).forEach(l => {
    rows.push(`<Row>${xmlCell(l.date, 'String', 'sBody')}${xmlCell(l.project, 'String', 'sBody')}${xmlCell(l.hours, 'Number', 'sBody')}${xmlCell(l.mark, 'String', 'sBody')}${xmlCell(l.comment, 'String', 'sBody')}</Row>`);
  });
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="14"/><Alignment ss:Horizontal="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="sBody"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
 </Styles>
 <Worksheet ss:Name="Табель">
  <Table>
   <Column ss:Width="190"/><Column ss:Width="140"/>${Array.from({length:33}, () => '<Column ss:Width="38"/>').join('')}
   ${rows.join('\n')}
  </Table>
 </Worksheet>${projectFilter === 'all' ? `
 <Worksheet ss:Name="По проектам">
  <Table>
   <Column ss:Width="180"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="70"/>
   <Row>${xmlCell('Проект', 'String', 'sHeader')}${xmlCell('1–15 дней', 'String', 'sHeader')}${xmlCell('1–15 часов', 'String', 'sHeader')}${xmlCell('Месяц дней', 'String', 'sHeader')}${xmlCell('Месяц часов', 'String', 'sHeader')}${xmlCell('Отметок', 'String', 'sHeader')}</Row>
   ${buildProjectBreakdown(ym).map(r => `<Row>${xmlCell(r.project,'String','sBody')}${xmlCell(r.firstHalfDays,'Number','sBody')}${xmlCell(r.firstHalfHours,'Number','sBody')}${xmlCell(r.monthDays,'Number','sBody')}${xmlCell(r.monthHours,'Number','sBody')}${xmlCell(r.entries,'Number','sBody')}</Row>`).join('')}
  </Table>
 </Worksheet>` : ''}
</Workbook>`;
  const suffix = projectFilter === 'all' ? 'all' : projectFilter.replace(/\s+/g, '-');
  downloadText(`tabel-${settings.fio || 'user'}-${ym}-${suffix}.xls`, xml, 'application/vnd.ms-excel;charset=utf-8');
}
async function sendMagicLink() {
  settings.supabaseUrl = $('syncUrl').value.trim();
  settings.supabaseAnonKey = $('syncKey').value.trim();
  settings.email = $('syncEmail').value.trim();
  saveSettings();
  const client = getSupabaseClient();
  if (!client) return alert('Сначала укажи Supabase URL и anon key.');
  if (!settings.email) return alert('Укажи email.');
  const { error } = await client.auth.signInWithOtp({
    email: settings.email,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if (error) return alert(error.message);
  alert('Ссылка входа отправлена на email. Открой её на этом устройстве.');
}
function taskToRow(t, userId) {
  return {
    id: t.id,
    user_id: userId,
    title: t.title,
    project: t.project || null,
    due_date: t.dueDate || null,
    plan_date: t.planDate || null,
    status: t.status,
    priority: t.priority,
    importance: t.importance,
    urgency: t.urgency,
    note: t.note || null,
    day_bucket: t.dayBucket || 'none',
    order_index: t.orderIndex || 0,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    done_at: t.doneAt,
    deleted_at: t.deletedAt
  };
}
function rowToTask(r) {
  return normalizeTask({
    id: r.id,
    title: r.title,
    project: r.project || '',
    dueDate: r.due_date || '',
    planDate: r.plan_date || '',
    status: r.status,
    priority: r.priority,
    importance: r.importance,
    urgency: r.urgency,
    note: r.note || '',
    dayBucket: r.day_bucket || 'none',
    orderIndex: r.order_index || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    doneAt: r.done_at,
    deletedAt: r.deleted_at
  });
}
function workLogToRow(l, userId) {
  return {
    id: l.id,
    user_id: userId,
    work_date: l.date,
    project: l.project,
    hours: l.hours,
    mark: l.mark,
    comment: l.comment || null,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
    deleted_at: l.deletedAt
  };
}
function rowToWorkLog(r) {
  return normalizeWorkLog({
    id: r.id,
    date: r.work_date,
    project: r.project || 'Без проекта',
    hours: r.hours,
    mark: r.mark,
    comment: r.comment || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  });
}
async function syncNow() {
  const client = getSupabaseClient();
  if (!client) return alert('Сначала укажи Supabase URL и anon key.');
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return alert('Сначала войди по ссылке из email.');
  const localTasks = tasks.map(t => taskToRow(normalizeTask(t), user.id));
  if (localTasks.length) {
    const { error: upsertError } = await client.from('tasks').upsert(localTasks, { onConflict: 'id' });
    if (upsertError) {
      const msg = upsertError.message || '';
      if (msg.includes('out of range for type integer')) {
        return alert('Ошибка синхронизации: поле order_index в Supabase создано как integer. Открой Supabase → SQL Editor и выполни: alter table public.tasks alter column order_index type bigint using order_index::bigint; Потом нажми «Синхронизировать» снова.');
      }
      return alert(upsertError.message);
    }
  }
  const localLogs = workLogs.map(l => workLogToRow(normalizeWorkLog(l), user.id));
  if (localLogs.length) {
    const { error: logError } = await client.from('work_logs').upsert(localLogs, { onConflict: 'id' });
    if (logError) return alert(logError.message);
  }
  const { data, error } = await client.from('tasks').select('*').order('updated_at', { ascending: false });
  if (error) return alert(error.message);
  const { data: logData, error: logSelectError } = await client.from('work_logs').select('*').order('updated_at', { ascending: false });
  if (logSelectError) return alert(logSelectError.message);
  mergeTasks((data || []).map(rowToTask));
  mergeWorkLogs((logData || []).map(rowToWorkLog));
  hardResetDeleted();
  alert('Синхронизация выполнена.');
}
async function signOut() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  alert('Выход выполнен. Локальные задачи и табель остаются на устройстве.');
}
const SQL_TEMPLATE = `create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
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
  deleted_at timestamptz
);

create table if not exists public.work_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  work_date date not null,
  project text not null,
  hours numeric(5,2) not null default 8,
  mark text not null default 'Я' check (mark in ('Я','В','Б','ОТ','НН')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;

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

function boot() {
  tasks = tasks.map(normalizeTask);
  workLogs = workLogs.map(normalizeWorkLog);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(WORKLOGS_KEY, JSON.stringify(workLogs));
  $('quickAddBtn').onclick = addTask;
  $('quickTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  $('fieldPlanDate').value = today();
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => { currentView = btn.dataset.view; render(); });
  $('searchInput').oninput = render;
  $('projectFilter').onchange = render;
  $('editForm').onsubmit = saveEdit;
  $('closeDialogBtn').onclick = () => $('taskDialog').close();
  $('deleteTaskBtn').onclick = () => { const id = $('editId').value; deleteTask(id); $('taskDialog').close(); };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBtn').classList.add('hidden');
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  render();
}
boot();
