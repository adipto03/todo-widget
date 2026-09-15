// To-do list: tasks with date, time, importance, category, reminders and repeats.
const Tasks = (() => {
  const KEY = 'todo-widget.tasks';
  const DEFAULT_CATEGORIES = ['Work', 'Personal', 'Study', 'Health', 'Shopping'];
  const RANK = { high: 0, medium: 1, low: 2 };
  const LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const EMPTY_TEXT = {
    all: 'No tasks yet.\nPress + to add your first one.',
    today: 'Nothing due today.',
    upcoming: 'No upcoming tasks.',
    done: 'No completed tasks yet.',
  };

  const GROUPS_KEY = 'todo-widget.taskGroups';

  let tasks = Store.get(KEY, []);
  if (!Array.isArray(tasks)) tasks = [];
  // Tasks sharing a category fold into one row; `open` remembers which groups are expanded.
  const groups = mergeDefaults({ enabled: true, open: {} }, Store.get(GROUPS_KEY, {}));
  const saveGroups = () => Store.set(GROUPS_KEY, groups);
  let filter = 'all';
  let categoryFilter = 'all';
  let editingId = null;
  let formRepeatDays = [];
  const form = $('#task-form');

  const save = () => Store.set(KEY, tasks);

  const dueDate = (t) => (t.date ? Dates.at(t.date, t.time || '23:59') : null);
  const isOverdue = (t) => !t.done && !!t.date && dueDate(t) < new Date();

  function formatDue(t) {
    if (!t.date) return t.time ? Dates.formatTime(t.time) : '';
    let label;
    if (t.date === Dates.key()) label = 'Today';
    else if (t.date === Dates.offsetKey(1)) label = 'Tomorrow';
    else if (t.date === Dates.offsetKey(-1)) label = 'Yesterday';
    else {
      const d = Dates.parse(t.date);
      const opts = { weekday: 'short', month: 'short', day: 'numeric' };
      if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
      label = d.toLocaleDateString(undefined, opts);
    }
    return t.time ? `${label}, ${Dates.formatTime(t.time)}` : label;
  }

  const categoryHue = hueFor;

  function matchesFilter(t) {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    const today = Dates.key();
    switch (filter) {
      case 'today': return !t.done && (t.date === today || isOverdue(t));
      case 'upcoming': return !t.done && !!t.date && t.date > today;
      case 'done': return t.done;
      default: return true;
    }
  }

  function compareTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = dueDate(a), db = dueDate(b);
    if (da && db && da - db !== 0) return da - db;
    if (!!da !== !!db) return da ? -1 : 1;
    return RANK[a.importance] - RANK[b.importance] || a.createdAt - b.createdAt;
  }

  function allCategories() {
    const used = tasks.map((t) => t.category).filter(Boolean);
    return [...new Set([...DEFAULT_CATEGORIES, ...used])];
  }

  // ---------- repeating tasks ----------
  function repeatLabel(t) {
    switch (t.repeat) {
      case 'daily': return 'Daily';
      case 'weekdays': return 'Weekdays';
      case 'weekly': return 'Weekly';
      case 'monthly': return 'Monthly';
      case 'custom': return [...(t.repeatDays || [])].sort().map((d) => DAY_SHORT[d]).join(', ') || 'Custom';
      default: return '';
    }
  }

  // The next due date after `fromKey` for a repeating task.
  function nextOccurrence(t, fromKey) {
    const from = Dates.parse(fromKey);
    if (t.repeat === 'monthly') {
      const day = t.repeatDay || from.getDate();
      const y = from.getFullYear();
      const m = from.getMonth() + 1;
      return Dates.key(new Date(y, m, Math.min(day, Dates.daysInMonth(y, m))));
    }
    const weekday = Dates.parse(t.date).getDay();
    const d = new Date(from);
    for (let i = 0; i < 14; i++) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (t.repeat === 'daily'
        || (t.repeat === 'weekdays' && wd >= 1 && wd <= 5)
        || (t.repeat === 'weekly' && wd === weekday)
        || (t.repeat === 'custom' && (t.repeatDays || []).includes(wd))) {
        return Dates.key(d);
      }
    }
    return null;
  }

  // Ticking a repeating task keeps a "done" copy for history and moves the task on to its next date.
  function completeRepeating(t) {
    const today = Dates.key();
    let next = nextOccurrence(t, t.date);
    while (next && next < today) next = nextOccurrence(t, next);
    if (!next) {
      t.done = true;
      t.completedAt = Date.now();
      save();
      render();
      return;
    }
    const record = { ...t, id: uid(), repeat: '', repeatDays: [], done: true, completedAt: Date.now(), repeatOf: t.id };
    delete record.externalId;
    const previousDate = t.date;
    tasks.push(record);
    t.date = next;
    save();
    render();
    Toast.show(`Done. Next one: ${formatDue({ date: next, time: t.time })}`, () => {
      tasks = tasks.filter((x) => x.id !== record.id);
      t.date = previousDate;
      save();
      render();
    });
  }

  // ---------- list ----------
  function render() {
    const visible = tasks.filter(matchesFilter).sort(compareTasks);
    $('#task-list').replaceChildren(...listItems(visible));
    const toggle = $('#group-toggle');
    toggle.classList.toggle('active', groups.enabled);
    toggle.title = groups.enabled ? 'Grouped by category (click to show every task)' : 'Group tasks by category';
    toggle.setAttribute('aria-pressed', String(groups.enabled));
    $('#task-empty').hidden = visible.length > 0;
    $('#task-empty-text').innerText = categoryFilter !== 'all' ? `No tasks in "${categoryFilter}" here.` : EMPTY_TEXT[filter];

    const active = tasks.filter((t) => !t.done);
    const overdue = active.filter(isOverdue).length;
    const stats = $('#task-stats');
    stats.textContent = active.length ? `${active.length} to do` : 'All clear';
    if (overdue) stats.append(el('span', { class: 'warn', text: ` · ${overdue} overdue` }));

    renderCategoryFilter();
  }

  // With grouping on, any category with 2+ tasks in view becomes one collapsible row, placed where
  // its most urgent task would be.
  function listItems(visible) {
    if (!groups.enabled || categoryFilter !== 'all') return visible.map(taskElement);
    const byCategory = new Map();
    for (const t of visible) {
      if (t.category) byCategory.set(t.category, [...(byCategory.get(t.category) || []), t]);
    }
    const items = [];
    const placed = new Set();
    for (const t of visible) {
      const members = t.category ? byCategory.get(t.category) : null;
      if (!members || members.length < 2) items.push(taskElement(t));
      else if (!placed.has(t.category)) {
        placed.add(t.category);
        items.push(groupElement(t.category, members));
      }
    }
    return items;
  }

  function groupElement(category, members) {
    const open = !!groups.open[category];
    const todo = members.filter((t) => !t.done);
    const overdue = todo.filter(isOverdue).length;
    const next = todo.find((t) => t.date);
    const counts = [todo.length ? `${todo.length} to do` : '', members.length > todo.length ? `${members.length - todo.length} done` : ''].filter(Boolean).join(' · ');
    const dueText = overdue ? `${overdue} overdue` : next ? formatDue({ date: next.date }) : '';
    return el('li', { class: `task-group${open ? ' open' : ''}` },
      el('button', {
        type: 'button',
        class: 'group-head',
        'aria-expanded': String(open),
        title: open ? 'Fold these tasks away' : `Show ${members.length} tasks`,
        onclick: () => {
          groups.open[category] = !open;
          if (!groups.open[category]) delete groups.open[category];
          saveGroups();
          render();
        },
      },
      el('span', { class: 'group-chev', html: Icons.chevronRight }),
      el('span', { class: 'cat', style: { '--h': categoryHue(category) }, text: category }),
      el('span', { class: 'group-count', text: counts }),
      dueText ? el('span', { class: `group-due${overdue ? ' warn' : ''}`, text: dueText }) : null),
      open ? el('ul', { class: 'list group-items' }, members.map(taskElement)) : null);
  }

  function taskElement(t) {
    const overdue = isOverdue(t);
    const due = formatDue(t);
    const remind = t.remind ?? Settings.data.notifications.taskDefault;
    return el('li', { class: `task imp-${t.importance}${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}` },
      el('button', {
        class: 'check', type: 'button', html: Icons.check,
        title: t.done ? 'Mark as not done' : 'Mark as done',
        onclick: () => toggleDone(t),
      }),
      el('div', { class: 'body', title: 'Click to edit', onclick: () => openForm(t) },
        el('div', { class: 'title', text: t.title }),
        el('div', { class: 'meta' },
          due ? el('span', { class: 'due', html: Icons.clock }, overdue ? `${due} · overdue` : due) : null,
          t.category ? el('span', { class: 'cat', style: { '--h': categoryHue(t.category) }, text: t.category }) : null,
          t.calendarId ? el('span', { class: 'from-cal', html: Icons.calendar, title: `From ${Calendars.nameOf(t.calendarId) || 'a linked calendar'}` }) : null,
          el('span', { class: 'imp-label', text: LABEL[t.importance] }),
          t.repeat && !t.done ? el('span', { class: 'repeat', html: Icons.repeat, title: `Repeats: ${repeatLabel(t)}` }, repeatLabel(t)) : null,
          !t.done && t.date && remind >= 0 ? el('span', { class: 'bell', html: Icons.bell, title: 'Reminder on' }) : null)),
      t.link ? el('button', {
        class: 'icon-btn link-btn', type: 'button', html: Icons.external, title: 'Open link',
        onclick: () => bridge?.openExternal(t.link),
      }) : null,
      el('button', { class: 'icon-btn del', type: 'button', title: 'Delete', html: Icons.trash, onclick: () => remove(t.id) }));
  }

  function renderCategoryFilter() {
    const select = $('#cat-filter');
    const cats = [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort();
    if (categoryFilter !== 'all' && !cats.includes(categoryFilter)) categoryFilter = 'all';
    select.replaceChildren(new Option('All categories', 'all'), ...cats.map((c) => new Option(c, c)));
    select.value = categoryFilter;
    select.hidden = cats.length === 0;
  }

  function toggleDone(t) {
    if (!t.done && t.repeat && t.date) return completeRepeating(t);
    t.done = !t.done;
    t.completedAt = t.done ? Date.now() : null;
    save();
    render();
  }

  function remove(id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [task] = tasks.splice(index, 1);
    // An imported event the user deleted shouldn't come back on the next calendar sync.
    if (task.calendarId) Calendars.forget(task, true);
    save();
    render();
    Toast.show(`Deleted "${task.title.slice(0, 30)}"`, () => {
      tasks.splice(Math.min(index, tasks.length), 0, task);
      if (task.calendarId) Calendars.forget(task, false);
      save();
      render();
    });
  }

  // ---------- form ----------
  function openForm(task = null) {
    editingId = task?.id ?? null;
    $('#task-form-title').textContent = task ? 'Edit task' : 'New task';
    $('#t-submit').textContent = task ? 'Save' : 'Add task';
    $('#t-delete').hidden = !task;
    $('#t-title').value = task?.title ?? '';
    $('#t-date').value = task ? task.date : filter === 'today' ? Dates.key() : '';
    $('#t-time').value = task?.time ?? '';
    form.importance.value = task?.importance ?? 'medium';
    $('#t-cat').value = task?.category ?? (categoryFilter !== 'all' ? categoryFilter : '');
    $('#t-remind').value = String(task?.remind ?? Settings.data.notifications.taskDefault);
    $('#t-repeat').value = task?.repeat || '';
    formRepeatDays = [...(task?.repeatDays || [])];
    renderCategoryChips();
    syncDateChips();
    renderRepeatDays();
    updateRemindHint();
    Sheet.open(form, () => { editingId = null; });
    $('#t-title').focus();
  }

  function renderCategoryChips() {
    const current = $('#t-cat').value.trim().toLowerCase();
    $('#t-cat-chips').replaceChildren(...allCategories().map((c) => el('button', {
      type: 'button',
      class: `chip${c.toLowerCase() === current ? ' selected' : ''}`,
      text: c,
      onclick: () => {
        $('#t-cat').value = $('#t-cat').value === c ? '' : c;
        renderCategoryChips();
      },
    })));
  }

  function renderRepeatDays() {
    const custom = $('#t-repeat').value === 'custom';
    $('#t-repeat-days').hidden = !custom;
    if (!custom) return;
    $('#t-repeat-days').replaceChildren(...DAY_LETTER.map((letter, day) => el('button', {
      type: 'button',
      class: `chip${formRepeatDays.includes(day) ? ' selected' : ''}`,
      text: letter,
      title: DAY_SHORT[day],
      'aria-pressed': String(formRepeatDays.includes(day)),
      onclick: () => {
        formRepeatDays = formRepeatDays.includes(day) ? formRepeatDays.filter((d) => d !== day) : [...formRepeatDays, day];
        renderRepeatDays();
      },
    })));
  }

  function chipDate(which) {
    if (which === 'today') return Dates.key();
    if (which === 'tomorrow') return Dates.offsetKey(1);
    return '';
  }

  function syncDateChips() {
    const value = $('#t-date').value;
    for (const chip of $$('[data-date]', form)) chip.classList.toggle('selected', chipDate(chip.dataset.date) === value);
  }

  function updateRemindHint() {
    const n = Settings.data.notifications;
    const remind = Number($('#t-remind').value);
    const repeat = $('#t-repeat').value;
    let text = '';
    if (repeat && !$('#t-date').value) text = 'Repeating tasks need a start date, so today will be used.';
    else if (remind >= 0 && !n.enabled) text = 'Notifications are turned off in Settings.';
    else if (remind >= 0 && !$('#t-date').value) text = 'Add a date to get a reminder.';
    else if (remind >= 0 && !$('#t-time').value) {
      text = `No time set, so you'll be reminded at ${Dates.formatTime(n.dateOnlyTime || '09:00')}${remind >= 1440 ? ' the day before' : ' on the day'}.`;
    }
    $('#t-remind-hint').textContent = text;
    $('#t-remind-hint').hidden = !text;
  }

  // ---------- notifications ----------
  const offsetLabel = (m) => (m >= 1440 ? '1 day' : m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);
  const describe = (t) => [t.title, t.category, t.importance === 'high' ? 'High priority' : ''].filter(Boolean).join(' · ');

  function reminders() {
    const n = Settings.data.notifications;
    const out = [];
    for (const t of tasks) {
      if (t.done || !t.date) continue;
      const offset = t.remind ?? n.taskDefault;
      if (offset < 0) continue;
      let at;
      let title;
      if (t.time) {
        at = dueDate(t).getTime() - offset * 60000;
        title = offset === 0 ? 'Task due now' : `Due in ${offsetLabel(offset)}`;
      } else {
        at = Dates.at(t.date, n.dateOnlyTime || '09:00').getTime() - (offset >= 1440 ? 86400000 : 0);
        title = offset >= 1440 ? 'Due tomorrow' : 'Due today';
      }
      out.push({ key: `task:${t.id}:${at}`, at, title, body: describe(t), view: 'tasks' });
    }
    return out;
  }

  function summary() {
    const today = Dates.key();
    const active = tasks.filter((t) => !t.done);
    const dueToday = active.filter((t) => t.date === today).sort(compareTasks);
    const overdue = active.filter((t) => t.date && t.date < today).length;
    if (!dueToday.length && !overdue) return null;
    const high = dueToday.filter((t) => t.importance === 'high').length;
    const parts = [];
    if (dueToday.length) parts.push(`${dueToday.length} due today${high ? ` (${high} high priority)` : ''}`);
    if (overdue) parts.push(`${overdue} overdue`);
    const names = dueToday.slice(0, 3).map((t) => t.title).join(', ');
    return { title: 'Your tasks today', body: parts.join(' · ') + (names ? `\n${names}` : ''), view: 'tasks' };
  }

  // ---------- imports (linked calendars) ----------
  // Adds or updates a task that comes from outside the widget. Call commit() after a batch.
  function upsertExternal(item) {
    const existing = tasks.find((t) => t.externalId === item.externalId);
    if (existing) {
      if (existing.done) return { id: existing.id, created: false, changed: false };
      let changed = false;
      for (const k of ['title', 'date', 'time', 'link', 'endAt']) {
        if (existing[k] !== item[k]) {
          existing[k] = item[k];
          changed = true;
        }
      }
      return { id: existing.id, created: false, changed };
    }
    const task = {
      id: uid(),
      title: item.title,
      date: item.date,
      time: item.time,
      importance: 'medium',
      category: item.category,
      remind: Settings.data.notifications.taskDefault,
      done: false,
      createdAt: Date.now(),
      source: item.source,
      calendarId: item.calendarId,
      externalId: item.externalId,
      link: item.link,
      endAt: item.endAt,
    };
    tasks.push(task);
    return { id: task.id, created: true, changed: true };
  }

  function commit() {
    save();
    render();
  }

  // Removes matching tasks without asking, e.g. calendar events that are over or were cancelled.
  function removeWhere(test) {
    const before = tasks.length;
    tasks = tasks.filter((t) => !test(t));
    const removed = before - tasks.length;
    if (removed) commit();
    return removed;
  }

  // ---------- wiring ----------
  function init() {
    for (const tab of $$('#task-tabs .tab')) {
      tab.addEventListener('click', () => {
        filter = tab.dataset.filter;
        $$('#task-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
        render();
      });
    }

    $('#cat-filter').addEventListener('change', (e) => {
      categoryFilter = e.target.value;
      render();
    });
    $('#group-toggle').addEventListener('click', () => {
      groups.enabled = !groups.enabled;
      saveGroups();
      render();
    });

    for (const chip of $$('[data-date]', form)) {
      chip.addEventListener('click', () => {
        $('#t-date').value = chipDate(chip.dataset.date);
        if (!chip.dataset.date) $('#t-time').value = '';
        syncDateChips();
        updateRemindHint();
      });
    }
    $('#t-date').addEventListener('input', () => { syncDateChips(); updateRemindHint(); });
    $('#t-time').addEventListener('input', updateRemindHint);
    $('#t-remind').addEventListener('change', updateRemindHint);
    $('#t-repeat').addEventListener('change', () => {
      if ($('#t-repeat').value === 'custom' && !formRepeatDays.length) {
        const base = $('#t-date').value ? Dates.parse($('#t-date').value) : new Date();
        formRepeatDays = [base.getDay()];
      }
      renderRepeatDays();
      updateRemindHint();
    });
    $('#t-cat').addEventListener('input', renderCategoryChips);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('#t-title').value.trim();
      if (!title) return;
      // Match an existing category case-insensitively so "work" and "Work" don't split.
      const rawCat = $('#t-cat').value.trim();
      const category = allCategories().find((c) => c.toLowerCase() === rawCat.toLowerCase()) || rawCat;
      const repeat = $('#t-repeat').value;
      let date = $('#t-date').value;
      if (repeat && !date) date = Dates.key();
      const fields = {
        title,
        date,
        time: date ? $('#t-time').value : '',
        importance: form.importance.value,
        category,
        remind: Number($('#t-remind').value),
        repeat,
        repeatDays: repeat === 'custom' ? [...formRepeatDays].sort() : [],
        repeatDay: repeat === 'monthly' ? Dates.parse(date).getDate() : null,
      };
      if (repeat === 'custom' && !fields.repeatDays.length) fields.repeat = '';
      if (editingId) {
        const t = tasks.find((x) => x.id === editingId);
        if (t) Object.assign(t, fields);
      } else {
        tasks.push({ id: uid(), ...fields, done: false, createdAt: Date.now() });
      }
      save();
      Sheet.close();
      render();
    });

    $('#t-cancel').addEventListener('click', () => Sheet.close());
    $('#t-delete').addEventListener('click', () => {
      const id = editingId;
      Sheet.close();
      remove(id);
    });
  }

  return {
    init,
    render,
    openForm,
    reminders,
    summary,
    upsertExternal,
    commit,
    removeWhere,
    isOverdue,
    list: () => tasks,
    nextOccurrence,
  };
})();
