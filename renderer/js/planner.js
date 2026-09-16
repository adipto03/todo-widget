// Planner tab: a plan for every day (the full 24 hours, top priorities and how to improve), a
// weekly review with goals for the week after, and a month coloured by how each day went.
// Weeks run Monday to Sunday.
const Planner = (() => {
  const KEY = 'todo-widget.planner';
  const MODE_KEY = 'todo-widget.plannerMode';
  const MAX_ITEMS = 10;
  const RATINGS = [
    ['bad', 'Rough', 'Not much got done'],
    ['ok', 'Average', 'An average day'],
    ['good', 'Good', 'A good day'],
  ];
  const RATING_LABEL = Object.fromEntries(RATINGS.map(([id, label]) => [id, label]));
  const REVIEW_FIELDS = [
    ['accomplished', 'Did I accomplish this week’s goals?', 'What went to plan, and what didn’t?'],
    ['improve', 'What is the main thing I need to improve?', 'Pick one thing.'],
    ['how', 'How can I improve that?', 'What will you do differently?'],
  ];

  let data = mergeDefaults({ days: {}, weeks: {} }, Store.get(KEY, {}));
  if (!data.days || typeof data.days !== 'object') data.days = {};
  if (!data.weeks || typeof data.weeks !== 'object') data.weeks = {};

  const MODES = ['day', 'week', 'month'];
  let mode = MODES.includes(Storage.getItem(MODE_KEY)) ? Storage.getItem(MODE_KEY) : 'day';
  let dayKey = Dates.key();
  let weekKey = mondayOf(dayKey);
  let monthKey = firstOfMonth(dayKey);
  let scrollToNow = true;
  let resetScroll = false; // switching view starts at the top rather than where the last one was
  let saveTimer = null;

  // ---------- saving ----------
  // Typing saves a moment after you stop, so a long note isn't written to disk on every keystroke.
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    prune();
    Store.set(KEY, data);
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = -1; // so flush() writes even if nothing was queued
    flush();
  }

  // Days and weeks you opened but never wrote anything in are dropped again. The ones on screen are
  // left alone: a line you have just added is still empty, and clearing it away would delete the row
  // under the cursor.
  function prune() {
    const openWeeks = [weekKey, Dates.offsetKey(7, Dates.parse(weekKey))];
    for (const [key, day] of Object.entries(data.days)) {
      if (key === dayKey) continue;
      const hasPlan = Object.values(day.plan || {}).some((v) => String(v).trim());
      const hasItems = (day.priorities || []).some((p) => p.text.trim());
      if (!hasPlan && !hasItems && !day.improve?.trim() && !day.rating) delete data.days[key];
    }
    for (const [key, week] of Object.entries(data.weeks)) {
      if (openWeeks.includes(key)) continue;
      const hasGoals = (week.goals || []).some((g) => g.text.trim());
      const hasReview = Object.values(week.review || {}).some((v) => String(v).trim());
      if (!hasGoals && !hasReview && !week.steps?.trim()) delete data.weeks[key];
    }
  }

  // ---------- records ----------
  const EMPTY_DAY = { plan: {}, priorities: [], improve: '', rating: '' };
  const EMPTY_WEEK = { goals: [], steps: '', review: {} };

  function ensureDay(key) {
    const day = (data.days[key] ??= { plan: {}, priorities: [], improve: '', rating: '' });
    day.plan ??= {};
    day.priorities ??= [];
    return day;
  }

  function ensureWeek(key) {
    const week = (data.weeks[key] ??= { goals: [], steps: '', review: {} });
    week.goals ??= [];
    week.review ??= {};
    return week;
  }

  const dayOf = (key) => data.days[key] || EMPTY_DAY;
  const weekOf = (key) => data.weeks[key] || EMPTY_WEEK;

  // ---------- dates ----------
  function mondayOf(key) {
    const d = Dates.parse(key);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return Dates.key(d);
  }

  function firstOfMonth(key) {
    const d = Dates.parse(key);
    return Dates.key(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function monthDays(key) {
    const d = Dates.parse(key);
    const last = Dates.daysInMonth(d.getFullYear(), d.getMonth());
    return Dates.range(key, Dates.key(new Date(d.getFullYear(), d.getMonth(), last)));
  }

  const weekDays = (key) => Dates.range(key, Dates.offsetKey(6, Dates.parse(key)));
  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

  function dayTitle(key) {
    const d = Dates.parse(key);
    const opts = { weekday: 'long', day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function dayRelative(key) {
    if (key === Dates.key()) return 'Today';
    if (key === Dates.offsetKey(1)) return 'Tomorrow';
    if (key === Dates.offsetKey(-1)) return 'Yesterday';
    const days = Math.round((Dates.parse(key) - Dates.parse(Dates.key())) / 86400000);
    return days < 0 ? `${-days} days ago` : `In ${days} days`;
  }

  function weekTitle(key) {
    const start = Dates.parse(key);
    const end = Dates.parse(Dates.offsetKey(6, start));
    const opts = { day: 'numeric', month: 'short' };
    if (start.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    // formatRange writes the shared month once ("Sep 14 – 20") and in the right order for the locale.
    return new Intl.DateTimeFormat(undefined, opts).formatRange(start, end);
  }

  function monthTitle(key) {
    const d = Dates.parse(key);
    const opts = { month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function monthRelative(key) {
    const now = new Date();
    const d = Dates.parse(key);
    const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
    if (months === 0) return 'This month';
    if (months === -1) return 'Last month';
    if (months === 1) return 'Next month';
    return months < 0 ? `${-months} months ago` : `In ${months} months`;
  }

  function weekRelative(key) {
    const weeks = Math.round((Dates.parse(key) - Dates.parse(mondayOf(Dates.key()))) / (7 * 86400000));
    if (weeks === 0) return 'This week';
    if (weeks === -1) return 'Last week';
    if (weeks === 1) return 'Next week';
    return weeks < 0 ? `${-weeks} weeks ago` : `In ${weeks} weeks`;
  }

  // ---------- small building blocks ----------
  function autoGrow(node) {
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }

  function growingArea(value, placeholder, onInput) {
    const node = el('textarea', {
      class: 'plan-area',
      rows: 2,
      placeholder,
      oninput: () => {
        onInput(node.value);
        autoGrow(node);
        queueSave();
      },
      onchange: flush,
    });
    node.value = value || '';
    return node;
  }

  // A checkbox list of short lines: today's priorities, or a week's goals.
  function itemList(items, { placeholder, addLabel, onChange }) {
    const list = el('ul', { class: 'plan-items' }, items.map((item, index) => {
      const text = el('input', {
        class: 'plan-item-text',
        maxlength: 200,
        placeholder,
        oninput: () => {
          item.text = text.value;
          queueSave();
        },
        onchange: flush,
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          flush();
          if (items.length >= MAX_ITEMS) return;
          items.splice(index + 1, 0, { id: uid(), text: '', done: false });
          onChange(index + 1);
        },
      });
      text.value = item.text;
      return el('li', { class: `plan-item${item.done ? ' done' : ''}` },
        el('button', {
          type: 'button',
          class: 'check',
          title: item.done ? 'Mark as not done' : 'Mark as done',
          'aria-pressed': item.done ? 'true' : 'false',
          html: item.done ? Icons.check : '',
          onclick: () => {
            item.done = !item.done;
            saveNow();
            onChange();
          },
        }),
        text,
        el('button', {
          type: 'button',
          class: 'icon-btn sm del',
          title: 'Remove',
          'aria-label': 'Remove',
          html: Icons.trash,
          onclick: () => {
            items.splice(index, 1);
            saveNow();
            onChange();
          },
        }));
    }));

    const add = el('button', {
      type: 'button',
      class: 'plan-add',
      disabled: items.length >= MAX_ITEMS,
      onclick: () => {
        items.push({ id: uid(), text: '', done: false });
        onChange(items.length - 1);
      },
    }, el('span', { html: Icons.plus }), addLabel);

    return [list, add];
  }

  function ratingRow(day) {
    return el('div', { class: 'plan-rate' }, RATINGS.map(([id, label, title]) => el('button', {
      type: 'button',
      class: `rate-btn rate-${id}${day.rating === id ? ' selected' : ''}`,
      title,
      'aria-pressed': day.rating === id ? 'true' : 'false',
      text: label,
      onclick: () => {
        const record = ensureDay(dayKey);
        record.rating = record.rating === id ? '' : id;
        saveNow();
        render();
      },
    })));
  }

  // ---------- day view ----------
  function timelineCard() {
    const day = dayOf(dayKey);
    const today = Dates.key();
    const nowHour = new Date().getHours();
    const dayTasks = Tasks.list().filter((t) => t.date === dayKey && !t.done);
    const byHour = new Map();
    for (const task of dayTasks) {
      if (!task.time) continue;
      const hour = Number(String(task.time).split(':')[0]);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour).push(task);
    }

    const rows = [];
    for (let h = 0; h < 24; h++) {
      const isNow = dayKey === today && h === nowHour;
      const input = el('input', {
        class: 'hour-input',
        maxlength: 200,
        'aria-label': `Plan for ${hourLabel(h)}`,
        oninput: () => {
          ensureDay(dayKey).plan[h] = input.value;
          queueSave();
        },
        onchange: flush,
      });
      input.value = day.plan?.[h] || '';
      rows.push(el('div', { class: `hour-row${isNow ? ' now' : ''}`, 'data-hour': String(h) },
        el('span', { class: 'hour-label', text: hourLabel(h) }),
        el('div', { class: 'hour-body' },
          input,
          (byHour.get(h) || []).slice(0, 2).map((task) => el('button', {
            type: 'button',
            class: 'hour-task',
            title: 'Open this task',
            onclick: () => Tasks.openForm(task),
          }, el('span', { html: Icons.clock }), `${Dates.formatTime(task.time)} ${task.title}`)),
          // A busy hour (a pile of deadlines at once) stays one line rather than filling the day.
          (byHour.get(h) || []).length > 2
            ? el('button', {
              type: 'button',
              class: 'hour-more',
              text: `+${byHour.get(h).length - 2} more`,
              title: 'See them in Tasks',
              onclick: () => App.show('tasks'),
            })
            : null)));
    }

    const untimed = dayTasks.filter((t) => !t.time).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Plan the day' }),
        el('span', { class: 'card-actions' },
          untimed ? el('span', { class: 'card-sub', text: `${untimed} task${untimed === 1 ? '' : 's'} with no time` }) : null,
          dayKey === today
            ? el('button', { type: 'button', class: 'link', text: 'Jump to now', onclick: () => { scrollToNow = true; render(); } })
            : null)),
      el('div', { class: 'timeline' }, rows));
  }

  function prioritiesCard() {
    const items = dayOf(dayKey).priorities || [];
    const done = items.filter((p) => p.done && p.text.trim()).length;
    const total = items.filter((p) => p.text.trim()).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Top priority tasks' }),
        el('span', { class: 'card-sub', text: total ? `${done} of ${total} done` : 'The few things that matter most' })),
      itemList(ensureDay(dayKey).priorities, {
        placeholder: 'Something that has to get done',
        addLabel: 'Add priority',
        onChange: (focus) => { saveNow(); render(focus == null ? null : { priority: focus }); },
      }));
  }

  function improveCard() {
    const day = dayOf(dayKey);
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'How did the day go?' }),
        day.rating ? el('span', { class: `card-sub rate-text rate-${day.rating}`, text: RATING_LABEL[day.rating] }) : null),
      ratingRow(day),
      el('label', { class: 'plan-label', text: 'How could I improve?' }),
      growingArea(day.improve, 'One thing to do better next time…', (v) => { ensureDay(dayKey).improve = v; }));
  }

  function renderDay(focus) {
    $('#planner-body').replaceChildren(timelineCard(), prioritiesCard(), improveCard());
    takeScrollTop();
    for (const area of $$('#planner-body .plan-area')) autoGrow(area);

    if (focus?.priority != null) {
      scrollToNow = false;
      $$('#planner-body .plan-item-text')[focus.priority]?.focus();
      return;
    }
    if (!scrollToNow) return;
    // Open the day at the hour it is now, so you don't start at midnight every time.
    const wrap = $('#planner-body');
    const row = $('#planner-body .hour-row.now') || $('#planner-body .hour-row[data-hour="7"]');
    if (!row) return;
    if ($('#view-planner').hidden) return; // the tab isn't showing yet; scroll when it is
    scrollToNow = false;
    wrap.scrollTop += row.getBoundingClientRect().top - wrap.getBoundingClientRect().top - wrap.clientHeight / 3;
  }

  // ---------- week view ----------
  function strip() {
    const today = Dates.key();
    return el('div', { class: 'week-strip' }, weekDays(weekKey).map((key) => {
      const day = dayOf(key);
      const planned = Object.values(day.plan || {}).some((v) => String(v).trim()) || (day.priorities || []).some((p) => p.text.trim());
      const d = Dates.parse(key);
      return el('button', {
        type: 'button',
        class: `week-day rate-${day.rating || 'none'}${key === today ? ' today' : ''}`,
        title: `${dayTitle(key)}${day.rating ? ` · ${RATING_LABEL[day.rating]}` : ''}`,
        onclick: () => openDay(key),
      },
        el('span', { class: 'week-dow', text: d.toLocaleDateString(undefined, { weekday: 'narrow' }) }),
        el('span', { class: 'week-num', text: String(d.getDate()) }),
        el('span', { class: `week-dot${planned ? ' on' : ''}` }));
    }));
  }

  function summaryCard() {
    const keys = weekDays(weekKey).filter((k) => k <= Dates.key());
    const set = new Set(keys);
    const tasksDone = Tasks.list().filter((t) => t.done && t.completedAt && set.has(Dates.key(new Date(t.completedAt)))).length;
    const priorities = keys.reduce((acc, key) => {
      for (const p of dayOf(key).priorities || []) {
        if (!p.text.trim()) continue;
        acc.total++;
        if (p.done) acc.done++;
      }
      return acc;
    }, { done: 0, total: 0 });
    const habitStats = Habits.list().length ? Habits.statsFor(keys) : [];
    const possible = habitStats.reduce((n, h) => n + h.days, 0);
    const habitRate = possible ? Math.round((habitStats.reduce((n, h) => n + h.met, 0) / possible) * 100) : null;
    const rated = keys.filter((k) => dayOf(k).rating);

    const tiles = [
      ['Priorities done', priorities.total ? `${priorities.done}/${priorities.total}` : '–'],
      ['Tasks done', String(tasksDone)],
      habitRate == null ? null : ['Habits met', `${habitRate}%`],
    ].filter(Boolean);

    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'How the week went' }),
        el('span', { class: 'card-sub', text: keys.length ? `${keys.length} day${keys.length === 1 ? '' : 's'} so far` : 'Not started yet' })),
      el('div', { class: 'plan-stats' }, tiles.map(([label, value]) => el('div', { class: 'plan-stat' },
        el('span', { class: 'stat-label', text: label }),
        el('b', { class: 'stat-value', text: value })))),
      rated.length
        // One block per day of the week, so a single good day doesn't colour the whole bar.
        ? el('div', { class: 'rate-bar' }, weekDays(weekKey).map((key) => el('i', {
          class: `rate-${dayOf(key).rating || 'none'}`,
          title: `${dayTitle(key)}${dayOf(key).rating ? `: ${RATING_LABEL[dayOf(key).rating]}` : ''}`,
        })))
        : el('p', { class: 'stats-empty', text: 'Rate your days in the Day view to see the week at a glance.' }));
  }

  function goalsCard(key, { title, sub, empty, slot }) {
    const week = weekOf(key);
    const items = week.goals || [];
    const done = items.filter((g) => g.done && g.text.trim()).length;
    const total = items.filter((g) => g.text.trim()).length;
    return el('section', { class: 'card plan-card', 'data-goals': slot },
      el('div', { class: 'card-head' },
        el('h3', { text: title }),
        el('span', { class: 'card-sub', text: total ? `${done} of ${total} done` : sub })),
      items.length ? null : el('p', { class: 'stats-empty', text: empty }),
      itemList(ensureWeek(key).goals, {
        placeholder: 'What do you want to get done?',
        addLabel: 'Add goal',
        onChange: (focus) => { saveNow(); render(focus == null ? null : { goal: slot, index: focus }); },
      }),
      el('label', { class: 'plan-label', text: 'Daily steps to get there' }),
      growingArea(week.steps, 'Break it down into what you do each day…', (v) => { ensureWeek(key).steps = v; }));
  }

  function reviewCard() {
    const week = weekOf(weekKey);
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Review of the week' }),
        el('span', { class: 'card-sub', text: weekRelative(weekKey) })),
      REVIEW_FIELDS.flatMap(([field, label, placeholder]) => [
        el('label', { class: 'plan-label', text: label }),
        growingArea(week.review?.[field], placeholder, (v) => { ensureWeek(weekKey).review[field] = v; }),
      ]));
  }

  function renderWeek(focus) {
    const nextKey = Dates.offsetKey(7, Dates.parse(weekKey));
    $('#planner-body').replaceChildren(
      strip(),
      summaryCard(),
      goalsCard(weekKey, {
        slot: 'this',
        title: 'Goals for this week',
        sub: 'Set at the end of last week',
        empty: 'Nothing set for this week. Add them here, or set them a week ahead under "Goals for next week".',
      }),
      reviewCard(),
      goalsCard(nextKey, {
        slot: 'next',
        title: 'Goals for next week',
        sub: 'What next week is for',
        empty: 'What are the two or three things next week is for?',
      }));
    takeScrollTop();
    for (const area of $$('#planner-body .plan-area')) autoGrow(area);
    if (focus?.goal) {
      const card = $(`#planner-body [data-goals="${focus.goal}"]`);
      $$('.plan-item-text', card)[focus.index]?.focus();
    }
  }

  function openDay(key) {
    flush();
    dayKey = key;
    weekKey = mondayOf(key);
    monthKey = firstOfMonth(key);
    scrollToNow = key === Dates.key();
    setMode('day');
  }

  // ---------- month view ----------
  const hasPlan = (key) => {
    const day = dayOf(key);
    return Object.values(day.plan || {}).some((v) => String(v).trim())
      || (day.priorities || []).some((p) => p.text.trim())
      || !!day.improve?.trim();
  };

  function monthCard() {
    const keys = monthDays(monthKey);
    const today = Dates.key();
    const first = Dates.parse(monthKey);
    const lead = (first.getDay() + 6) % 7; // Monday first, so Monday leaves no gap

    const monday = Dates.parse(mondayOf(today));
    const heads = weekDays(Dates.key(monday)).map((key) => el('span', {
      class: 'month-dow',
      text: Dates.parse(key).toLocaleDateString(undefined, { weekday: 'narrow' }),
    }));

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'month-cell blank' }));
    for (const key of keys) {
      const rating = dayOf(key).rating;
      const planned = hasPlan(key);
      const parts = [dayTitle(key)];
      if (rating) parts.push(RATING_LABEL[rating]);
      else if (planned) parts.push('planned');
      cells.push(el('button', {
        type: 'button',
        class: `month-cell rate-${rating || 'none'}${key === today ? ' today' : ''}${key > today ? ' future' : ''}`,
        title: `${parts.join(' · ')} — click to open`,
        onclick: () => openDay(key),
      },
        el('span', { class: 'month-num', text: String(Dates.parse(key).getDate()) }),
        el('span', { class: `month-dot${planned ? ' on' : ''}` })));
    }

    const rated = keys.filter((k) => dayOf(k).rating).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Day by day' }),
        el('span', { class: 'card-sub', text: rated ? `${rated} day${rated === 1 ? '' : 's'} rated` : 'Click a day to open it' })),
      el('div', { class: 'month-grid' }, heads, cells),
      el('div', { class: 'month-legend' },
        RATINGS.map(([id, label]) => el('span', { class: `month-key rate-${id}`, text: label })),
        el('span', { class: 'month-key planned', text: 'Planned' })));
  }

  function monthSummaryCard() {
    const keys = monthDays(monthKey).filter((k) => k <= Dates.key());
    const set = new Set(keys);
    const counts = { good: 0, ok: 0, bad: 0 };
    let planned = 0;
    const priorities = { done: 0, total: 0 };
    for (const key of keys) {
      const day = dayOf(key);
      if (day.rating) counts[day.rating]++;
      if (hasPlan(key)) planned++;
      for (const p of day.priorities || []) {
        if (!p.text.trim()) continue;
        priorities.total++;
        if (p.done) priorities.done++;
      }
    }
    const tasksDone = Tasks.list().filter((t) => t.done && t.completedAt && set.has(Dates.key(new Date(t.completedAt)))).length;
    const tiles = [
      ['Good days', String(counts.good)],
      ['Average', String(counts.ok)],
      ['Rough', String(counts.bad)],
      ['Days planned', String(planned)],
      ['Priorities done', priorities.total ? `${priorities.done}/${priorities.total}` : '–'],
      ['Tasks done', String(tasksDone)],
    ];
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'How the month went' }),
        el('span', { class: 'card-sub', text: `${keys.length} day${keys.length === 1 ? '' : 's'} so far` })),
      el('div', { class: 'plan-stats' }, tiles.map(([label, value]) => el('div', { class: 'plan-stat' },
        el('span', { class: 'stat-label', text: label }),
        el('b', { class: 'stat-value', text: value })))));
  }

  function renderMonth() {
    $('#planner-body').replaceChildren(monthCard(), monthSummaryCard());
    takeScrollTop();
  }

  // ---------- head and rendering ----------
  function takeScrollTop() {
    if (!resetScroll) return;
    resetScroll = false;
    $('#planner-body').scrollTop = 0;
  }

  function setMode(next) {
    mode = MODES.includes(next) ? next : 'day';
    Storage.setItem(MODE_KEY, mode);
    resetScroll = true;
    // Coming back to today's plan opens it at the hour it is now, as it does on the first look.
    if (mode === 'day') scrollToNow = dayKey === Dates.key();
    render();
  }

  function step(direction) {
    flush();
    if (mode === 'day') {
      dayKey = Dates.offsetKey(direction, Dates.parse(dayKey));
      weekKey = mondayOf(dayKey);
      monthKey = firstOfMonth(dayKey);
      scrollToNow = dayKey === Dates.key();
    } else if (mode === 'week') {
      weekKey = Dates.offsetKey(direction * 7, Dates.parse(weekKey));
      monthKey = firstOfMonth(weekKey);
    } else {
      const d = Dates.parse(monthKey);
      monthKey = Dates.key(new Date(d.getFullYear(), d.getMonth() + direction, 1));
    }
    // Stepping through days keeps you at the same hour; a new week or month starts at the top.
    resetScroll = mode !== 'day';
    render();
  }

  function goToToday() {
    flush();
    dayKey = Dates.key();
    weekKey = mondayOf(dayKey);
    monthKey = firstOfMonth(dayKey);
    scrollToNow = true;
    resetScroll = true;
    render();
  }

  // What each view calls the thing it shows, so one set of arrows and one button serve all three.
  const VIEW = {
    day: { title: () => dayTitle(dayKey), sub: () => dayRelative(dayKey), here: () => dayKey === Dates.key(), back: 'Today', step: 'day', add: 'Add priority' },
    week: { title: () => weekTitle(weekKey), sub: () => weekRelative(weekKey), here: () => weekKey === mondayOf(Dates.key()), back: 'This week', step: 'week', add: 'Add goal for next week' },
    month: { title: () => monthTitle(monthKey), sub: () => monthRelative(monthKey), here: () => monthKey === firstOfMonth(Dates.key()), back: 'This month', step: 'month', add: 'Add priority for today' },
  };

  function render(focus = null) {
    const view = VIEW[mode];
    $('#planner-title').textContent = view.title();
    $('#planner-sub').textContent = view.sub();
    $('#planner-today').hidden = view.here();
    $('#planner-today').textContent = view.back;
    $('#planner-prev').title = `Previous ${view.step}`;
    $('#planner-next').title = `Next ${view.step}`;
    for (const tab of $$('#planner-tabs .tab')) tab.classList.toggle('active', tab.dataset.mode === mode);
    if (!$('#view-planner').hidden) {
      // The + button adds whatever the view in front of you is made of.
      $('#fab').title = `${view.add} (Ctrl+N)`;
      $('#fab').setAttribute('aria-label', view.add);
    }
    if (mode === 'day') renderDay(focus);
    else if (mode === 'week') renderWeek(focus);
    else renderMonth();
  }

  // The + button adds a priority for the day, or a goal for next week.
  function add() {
    if (mode === 'month') {
      openDay(Dates.key());
      add();
      return;
    }
    if (mode === 'day') {
      const items = ensureDay(dayKey).priorities;
      if (items.length >= MAX_ITEMS) return;
      items.push({ id: uid(), text: '', done: false });
      saveNow();
      render({ priority: items.length - 1 });
    } else {
      const items = ensureWeek(Dates.offsetKey(7, Dates.parse(weekKey))).goals;
      if (items.length >= MAX_ITEMS) return;
      items.push({ id: uid(), text: '', done: false });
      saveNow();
      render({ goal: 'next', index: items.length - 1 });
    }
  }

  // Called every so often: move the "now" line without rebuilding the view, so anything being
  // typed keeps its place and its focus.
  function tick() {
    if (mode !== 'day') return;
    const hour = dayKey === Dates.key() ? String(new Date().getHours()) : null;
    for (const row of $$('#planner-body .hour-row')) row.classList.toggle('now', row.dataset.hour === hour);
  }

  // If the widget is left open overnight, move on to the new day.
  function newDay() {
    if (dayKey === Dates.offsetKey(-1)) dayKey = Dates.key();
    weekKey = mondayOf(dayKey);
    monthKey = firstOfMonth(dayKey);
    scrollToNow = true;
  }

  function init() {
    $('#planner-prev').addEventListener('click', () => step(-1));
    $('#planner-next').addEventListener('click', () => step(1));
    $('#planner-today').addEventListener('click', goToToday);
    for (const tab of $$('#planner-tabs .tab')) {
      tab.addEventListener('click', () => {
        flush();
        setMode(tab.dataset.mode);
      });
    }
    // Whatever is being typed gets written when the widget is hidden or closed.
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }

  return { init, render, add, flush, tick, goToToday, newDay };
})();
