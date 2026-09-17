// Planner tab: a plan for every day (the full 24 hours, top priorities and how to improve), a
// weekly review with goals for the week after, and a month coloured by how each day went, with
// goals for the month and a copyable summary of any day. Goals can be broken down into steps with a
// rough day (weekly goals) or week or date (monthly goals). Weeks run Monday to Sunday.
const Planner = (() => {
  const KEY = 'todo-widget.planner';
  const MODE_KEY = 'todo-widget.plannerMode';
  const MAX_ITEMS = 10;
  const MAX_STEPS = 15;
  const RATINGS = [
    ['bad', 'Rough', 'Not much got done'],
    ['ok', 'Average', 'An average day'],
    ['good', 'Good', 'A good day'],
  ];
  const RATING_LABEL = Object.fromEntries(RATINGS.map(([id, label]) => [id, label]));
  const VERDICT = { good: 'W · good day', ok: 'Average day', bad: 'L · rough day' };
  // Whether a day moved the week's or month's goals forward; coloured like the ratings.
  const ALIGN = [
    ['yes', 'Yes', 'good'],
    ['partly', 'Partly', 'ok'],
    ['no', 'No', 'bad'],
  ];
  const ALIGN_LABEL = Object.fromEntries(ALIGN.map(([id, label]) => [id, label]));
  const ALIGN_RATE = Object.fromEntries(ALIGN.map(([id, , rate]) => [id, rate]));
  const REVIEW_FIELDS = [
    ['accomplished', 'Did I accomplish this week’s goals?', 'What went to plan, and what didn’t?'],
    ['improve', 'What is the main thing I need to improve?', 'Pick one thing.'],
    ['how', 'How can I improve that?', 'What will you do differently?'],
  ];

  let data = mergeDefaults({ days: {}, weeks: {}, months: {} }, Store.get(KEY, {}));
  for (const part of ['days', 'weeks', 'months']) {
    if (!data[part] || typeof data[part] !== 'object') data[part] = {};
  }

  const MODES = ['day', 'week', 'month'];
  let mode = MODES.includes(Storage.getItem(MODE_KEY)) ? Storage.getItem(MODE_KEY) : 'day';
  let dayKey = Dates.key();
  let weekKey = mondayOf(dayKey);
  let monthKey = firstOfMonth(dayKey);
  let summaryKey = dayKey; // the day summarised under the month calendar
  let scrollToNow = true;
  let resetScroll = false; // switching view starts at the top rather than where the last one was
  let saveTimer = null;
  const folded = new Set(); // goals whose steps are hidden

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

  const named = (items) => (items || []).filter((item) => item.text.trim());
  const hasGoals = (goals) => (goals || []).some((g) => g.text.trim() || named(g.steps).length);

  // Days, weeks and months you opened but never wrote anything in are dropped again. The ones on
  // screen are left alone: a line you have just added is still empty, and clearing it away would
  // delete the row under the cursor.
  function prune() {
    const openWeeks = [weekKey, Dates.offsetKey(7, Dates.parse(weekKey))];
    const openMonths = [monthKey, nextMonthOf(monthKey)];
    for (const [key, day] of Object.entries(data.days)) {
      if (key === dayKey) continue;
      const hasPlan = Object.values(day.plan || {}).some((v) => String(v).trim());
      const hasAligned = Object.values(day.aligned || {}).some(Boolean);
      if (!hasPlan && !named(day.priorities).length && !day.improve?.trim() && !day.rating && !hasAligned) delete data.days[key];
    }
    for (const [key, week] of Object.entries(data.weeks)) {
      if (openWeeks.includes(key)) continue;
      const hasReview = Object.values(week.review || {}).some((v) => String(v).trim());
      if (!hasGoals(week.goals) && !hasReview && !week.steps?.trim()) delete data.weeks[key];
    }
    for (const [key, month] of Object.entries(data.months)) {
      if (openMonths.includes(key)) continue;
      if (!hasGoals(month.goals)) delete data.months[key];
    }
  }

  // ---------- records ----------
  const EMPTY_DAY = { plan: {}, priorities: [], improve: '', rating: '', aligned: {} };
  const EMPTY_WEEK = { goals: [], steps: '', review: {} };
  const EMPTY_MONTH = { goals: [] };

  function ensureDay(key) {
    const day = (data.days[key] ??= { plan: {}, priorities: [], improve: '', rating: '', aligned: {} });
    day.plan ??= {};
    day.priorities ??= [];
    day.aligned ??= {};
    return day;
  }

  function ensureWeek(key) {
    const week = (data.weeks[key] ??= { goals: [], steps: '', review: {} });
    week.goals ??= [];
    week.review ??= {};
    return week;
  }

  function ensureMonth(key) {
    const month = (data.months[key] ??= { goals: [] });
    month.goals ??= [];
    return month;
  }

  const dayOf = (key) => data.days[key] || EMPTY_DAY;
  const weekOf = (key) => data.weeks[key] || EMPTY_WEEK;
  const monthOf = (key) => data.months[key] || EMPTY_MONTH;
  const newItem = () => ({ id: uid(), text: '', done: false });

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

  function nextMonthOf(key) {
    const d = Dates.parse(key);
    return Dates.key(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function monthDays(key) {
    const d = Dates.parse(key);
    const last = Dates.daysInMonth(d.getFullYear(), d.getMonth());
    return Dates.range(key, Dates.key(new Date(d.getFullYear(), d.getMonth(), last)));
  }

  // The Mondays of every week that has at least one day in the month.
  function monthWeeks(key) {
    const days = monthDays(key);
    const out = [];
    for (let m = mondayOf(days[0]); m <= days[days.length - 1]; m = Dates.offsetKey(7, Dates.parse(m))) out.push(m);
    return out;
  }

  const weekDays = (key) => Dates.range(key, Dates.offsetKey(6, Dates.parse(key)));
  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
  const shortDay = (key) => Dates.parse(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const dateRange = (from, to) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).formatRange(Dates.parse(from), Dates.parse(to));

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

  function checkButton(item, onChange) {
    return el('button', {
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
    });
  }

  function removeButton(items, index, onChange) {
    return el('button', {
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
    });
  }

  // The text of one line in a list. Enter starts a new line under it.
  function lineInput(items, index, { placeholder, max, onChange, className = '' }) {
    const item = items[index];
    const text = el('input', {
      class: `plan-item-text ${className}`.trim(),
      'data-id': item.id,
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
        if (items.length >= max) return;
        const next = newItem();
        items.splice(index + 1, 0, next);
        onChange(next.id);
      },
    });
    text.value = item.text;
    return text;
  }

  function addButton(items, max, label, onChange, className = '') {
    return el('button', {
      type: 'button',
      class: `plan-add ${className}`.trim(),
      disabled: items.length >= max,
      onclick: () => {
        const next = newItem();
        items.push(next);
        onChange(next.id);
      },
    }, el('span', { html: Icons.plus }), label);
  }

  // A checkbox list of short lines: today's priorities.
  function itemList(items, { placeholder, addLabel, onChange }) {
    const list = el('ul', { class: 'plan-items' }, items.map((item, index) => el('li', { class: `plan-item${item.done ? ' done' : ''}` },
      checkButton(item, onChange),
      lineInput(items, index, { placeholder, max: MAX_ITEMS, onChange }),
      removeButton(items, index, onChange))));
    return [list, addButton(items, MAX_ITEMS, addLabel, onChange)];
  }

  // A list of goals, each of which can be broken down into steps. `when` builds the control that
  // says roughly when a step happens.
  function goalList(goals, { placeholder, addLabel, when, onChange }) {
    const list = el('ul', { class: 'plan-items goal-items' }, goals.map((goal, index) => {
      goal.steps ??= [];
      const steps = goal.steps;
      const stepsNamed = named(steps);
      const open = steps.length > 0 && !folded.has(goal.id);
      const toggle = el('button', {
        type: 'button',
        class: `step-toggle${open ? ' open' : ''}`,
        title: steps.length ? (open ? 'Hide the steps' : 'Show the steps') : 'Break this goal down into steps (optional)',
        text: steps.length ? `${stepsNamed.filter((s) => s.done).length}/${stepsNamed.length} steps` : 'Break down',
        onclick: () => {
          if (!steps.length) {
            const first = newItem();
            steps.push(first);
            folded.delete(goal.id);
            onChange(first.id);
            return;
          }
          if (open) folded.add(goal.id);
          else folded.delete(goal.id);
          onChange();
        },
      });

      const stepList = open
        ? el('div', { class: 'goal-steps' },
          el('ul', { class: 'plan-items' }, steps.map((step, si) => el('li', { class: `plan-item step${step.done ? ' done' : ''}` },
            checkButton(step, onChange),
            lineInput(steps, si, { placeholder: 'A step towards it', max: MAX_STEPS, onChange }),
            el('span', { class: 'step-when-wrap' }, when(step, onChange)),
            removeButton(steps, si, onChange)))),
          addButton(steps, MAX_STEPS, 'Add step', onChange, 'sm'))
        : null;

      return el('li', { class: 'goal-entry' },
        el('div', { class: `plan-item${goal.done ? ' done' : ''}` },
          checkButton(goal, onChange),
          lineInput(goals, index, { placeholder, max: MAX_ITEMS, onChange }),
          toggle,
          removeButton(goals, index, onChange)),
        stepList);
    }));
    return [list, addButton(goals, MAX_ITEMS, addLabel, onChange)];
  }

  // A weekly goal's step: which day of that week, if any.
  const weekWhen = (week) => (step) => {
    const select = el('select', {
      class: 'step-when',
      title: 'Which day',
      'aria-label': 'Which day',
      onchange: () => {
        step.day = select.value;
        saveNow();
      },
    },
    el('option', { value: '', text: 'Any day' }),
    weekDays(week).map((key) => el('option', {
      value: key,
      text: Dates.parse(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
    })));
    select.value = step.day || '';
    return select;
  };

  // A monthly goal's step: which week of the month, or a date if you want to be exact.
  const monthWhen = (month) => (step, onChange) => {
    const days = monthDays(month);
    const first = days[0];
    const last = days[days.length - 1];
    const select = el('select', {
      class: 'step-when',
      title: 'Which week',
      'aria-label': 'Which week',
      onchange: () => {
        if (select.value === 'date') {
          const today = Dates.key();
          step.week = '';
          step.day = step.day || (today >= first && today <= last ? today : first);
        } else {
          step.week = select.value;
          step.day = '';
        }
        saveNow();
        onChange();
      },
    },
    el('option', { value: '', text: 'Any week' }),
    monthWeeks(month).map((monday, i) => {
      const from = monday < first ? first : monday;
      const sunday = Dates.offsetKey(6, Dates.parse(monday));
      return el('option', { value: monday, title: `Week ${i + 1}`, text: dateRange(from, sunday > last ? last : sunday) });
    }),
    el('option', { value: 'date', text: 'Exact date…' }));
    select.value = step.day ? 'date' : step.week || '';
    if (!step.day) return select;

    const date = el('input', {
      type: 'date',
      class: 'step-date',
      min: first,
      max: last,
      'aria-label': 'Date',
      onchange: () => {
        if (!date.value) return;
        step.day = date.value;
        saveNow();
      },
    });
    date.value = step.day;
    return [select, date];
  };

  function choiceRow(options, selected, onPick, className = '') {
    return el('div', { class: `plan-rate ${className}`.trim() }, options.map(([id, label, rate, title]) => el('button', {
      type: 'button',
      class: `rate-btn rate-${rate}${selected === id ? ' selected' : ''}`,
      title: title || label,
      'aria-pressed': selected === id ? 'true' : 'false',
      text: label,
      onclick: () => onPick(selected === id ? '' : id),
    })));
  }

  function ratingRow(day) {
    return choiceRow(RATINGS.map(([id, label, title]) => [id, label, id, title]), day.rating, (value) => {
      ensureDay(dayKey).rating = value;
      saveNow();
      render();
    });
  }

  // Steps given a date: from that week's goals and from that month's goals.
  function stepsOn(key) {
    const out = [];
    const collect = (goals, kind) => {
      for (const goal of goals || []) {
        for (const step of named(goal.steps)) {
          if (step.day === key) out.push({ step, goal, note: goalNote(goal, kind) });
        }
      }
    };
    collect(weekOf(mondayOf(key)).goals, 'weekly');
    collect(monthOf(firstOfMonth(key)).goals, 'monthly');
    return out;
  }

  // Monthly goal steps planned for a week, from whichever months the week touches.
  function monthStepsIn(week) {
    const days = weekDays(week);
    const out = [];
    for (const month of new Set(days.map(firstOfMonth))) {
      for (const goal of monthOf(month).goals || []) {
        for (const step of named(goal.steps)) {
          if (step.week === week) out.push({ step, goal, note: goalNote(goal, 'monthly') });
          else if (days.includes(step.day)) out.push({ step, goal, note: `${shortDay(step.day)} · ${goalNote(goal, 'monthly')}` });
        }
      }
    }
    return out;
  }

  // Monthly and weekly goals set under core goals in the Goals tab, shown alongside the ones here.
  const coreMonthGoals = (key) => (Settings.data.tabs.goals ? Goals.monthGoalsFor(key) : []);
  const coreWeekGoals = (keys) => (Settings.data.tabs.goals ? Goals.weekGoalsFor(keys) : []);

  const goalNote = (goal, kind) => (goal.text.trim() ? `For “${goal.text.trim()}”` : `For a ${kind} goal`);

  // Steps from goals shown where they are due, to tick off there.
  function stepsCard(title, entries) {
    if (!entries.length) return null;
    const done = entries.filter((e) => e.step.done).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: title }),
        el('span', { class: 'card-sub', text: `${done} of ${entries.length} done` })),
      el('ul', { class: 'plan-items' }, entries.map(({ step, note }) => el('li', { class: `plan-item linked-step${step.done ? ' done' : ''}` },
        checkButton(step, () => render()),
        el('div', { class: 'linked-text' },
          el('span', { class: 'plan-item-label', text: step.text }),
          el('span', { class: 'linked-goal', text: note }))))));
  }

  // ---------- day summary ----------
  function summarize(key) {
    const day = dayOf(key);
    const onDay = (ms) => !!ms && Dates.key(new Date(ms)) === key;
    const tasks = Tasks.list();
    const endOfDay = Dates.parse(Dates.offsetKey(1, Dates.parse(key))).getTime();
    const habitList = Habits.list();
    const habits = habitList.length
      ? Habits.statsFor([key]).filter((h) => {
        const created = habitList.find((x) => x.id === h.id)?.createdAt;
        return !created || created < endOfDay;
      })
      : [];
    const deen = Settings.get('tabs.deen') !== false;
    const prayers = deen ? Prayer.prayedCount(key) : 0;
    return {
      key,
      rating: day.rating || '',
      improve: day.improve?.trim() || '',
      aligned: day.aligned || {},
      priorities: named(day.priorities),
      steps: stepsOn(key),
      done: tasks.filter((t) => t.done && onDay(t.completedAt)),
      missed: key <= Dates.key() ? tasks.filter((t) => !t.done && t.date === key) : [],
      plan: Object.entries(day.plan || {})
        .filter(([, v]) => String(v).trim())
        .map(([h, v]) => ({ hour: Number(h), text: String(v).trim() }))
        .sort((a, b) => a.hour - b.hour),
      habits,
      prayers: deen && (prayers || Settings.data.prayer.location) ? prayers : null,
      quran: deen ? Deen.pagesIn([key]) : 0,
      dhikr: deen ? Deen.dhikrIn([key]) : 0,
      journal: Journal.list().filter((n) => onDay(n.createdAt)).length,
      weekGoals: [...named(weekOf(mondayOf(key)).goals), ...coreWeekGoals([key])],
      monthGoals: [...named(monthOf(firstOfMonth(key)).goals), ...coreMonthGoals(firstOfMonth(key))],
    };
  }

  const hasAnything = (s) => s.rating || s.improve || Object.values(s.aligned).some(Boolean) || s.priorities.length
    || s.steps.length || s.done.length || s.plan.length;

  const mark = (done) => (done ? '✓' : '✗');
  const goalMark = (done) => (done ? '✓' : '•'); // a goal not done yet is still going, not missed
  const count = (items) => `${items.filter((i) => i.done).length}/${items.length}`;
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

  // The summary as sections of lines; lines starting with two spaces sit under the line above.
  // Both the card and the copied text are made from this, so they always say the same thing.
  function summarySections(s) {
    const did = [];
    if (s.priorities.length) {
      did.push(`Top priorities (${count(s.priorities)} done)`);
      for (const p of s.priorities) did.push(`  ${mark(p.done)} ${p.text.trim()}`);
    }
    if (s.steps.length) {
      did.push(`Goal steps (${count(s.steps.map((e) => e.step))} done)`);
      for (const { step, goal } of s.steps) did.push(`  ${mark(step.done)} ${step.text.trim()}${goal.text.trim() ? ` (towards “${goal.text.trim()}”)` : ''}`);
    }
    if (s.done.length) {
      did.push(`Tasks completed (${s.done.length})`);
      for (const t of s.done) did.push(`  ✓ ${t.title}`);
    }
    if (s.plan.length) {
      did.push('Day plan');
      for (const p of s.plan) did.push(`  ${hourLabel(p.hour)}: ${p.text}`);
    }
    if (s.habits.length) {
      const met = s.habits.filter((h) => h.met).length;
      did.push(`Habits (${met}/${s.habits.length}): ${s.habits.map((h) => `${h.name} ${mark(h.met)}`).join(', ')}`);
    }
    const extras = [];
    if (s.prayers != null) extras.push(`Prayers ${s.prayers}/5`);
    if (s.quran) extras.push(`Quran ${plural(Math.round(s.quran * 10) / 10, 'page')}`);
    if (s.dhikr) extras.push(`Dhikr ${s.dhikr}`);
    if (s.journal) extras.push(`Journal ${plural(s.journal, 'entry', 'entries')}`);
    if (extras.length) did.push(extras.join(' · '));
    if (!did.length) did.push('Nothing recorded.');

    const goals = (label, answer, items, none) => [
      `${label}: ${ALIGN_LABEL[answer] || 'not answered'}`,
      ...(items.length ? items.map((g) => `  ${goalMark(g.done)} ${g.text.trim()}${g.goal ? ` (core goal: ${g.goal})` : ''}`) : [`  (${none})`]),
    ];

    const sections = [{ title: 'What I did', lines: did }];
    if (s.missed.length) sections.push({ title: 'Not done', lines: s.missed.map((t) => `✗ ${t.title}`) });
    sections.push({ title: 'What I could do better', lines: [s.improve || 'Nothing written.'] });
    sections.push({
      title: 'Goals',
      lines: [
        ...goals('In line with this week’s goals', s.aligned.week, s.weekGoals, 'no weekly goals set'),
        ...goals('In line with this month’s goals', s.aligned.month, s.monthGoals, 'no monthly goals set'),
      ],
    });
    return sections;
  }

  const verdictText = (rating) => VERDICT[rating] || 'Not rated';

  function summaryText(key) {
    const s = summarize(key);
    const date = Dates.parse(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const out = [`${date}: ${verdictText(s.rating)}`];
    for (const section of summarySections(s)) out.push('', section.title.toUpperCase(), ...section.lines);
    return out.join('\n');
  }

  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el('textarea', { style: { position: 'fixed', opacity: 0 } });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    Toast.show(`${what} copied`);
  }

  const copyDay = (key) => copyText(summaryText(key), 'Summary');

  // Every day of the month so far that has anything in it, after the month's goals.
  function copyMonth(key) {
    const today = Dates.key();
    const days = monthDays(key).filter((k) => k <= today && hasAnything(summarize(k)));
    const goals = named(monthOf(key).goals);
    const head = [`${Dates.parse(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`];
    if (goals.length) head.push('', 'GOALS FOR THE MONTH', ...goals.map((g) => `${goalMark(g.done)} ${g.text.trim()}`));
    if (!days.length) {
      Toast.show('Nothing recorded this month yet');
      return;
    }
    copyText([head.join('\n'), ...days.map(summaryText)].join('\n\n----------\n\n'), `${plural(days.length, 'day')}`);
  }

  function summaryCard(key) {
    const s = summarize(key);
    const tag = (text, rate) => el('span', { class: `sum-tag rate-${rate || 'none'}`, text });
    return el('section', { class: 'card plan-card day-summary' },
      el('div', { class: 'card-head' },
        el('h3', { text: dayTitle(key) }),
        el('span', { class: 'card-actions' },
          el('button', { type: 'button', class: 'link', text: 'Copy summary', onclick: () => copyDay(key) }),
          el('button', { type: 'button', class: 'link', text: 'Open day', onclick: () => openDay(key) }))),
      el('div', { class: 'sum-tags' },
        tag(verdictText(s.rating), s.rating),
        tag(`Weekly goals: ${ALIGN_LABEL[s.aligned.week] || '–'}`, ALIGN_RATE[s.aligned.week]),
        tag(`Monthly goals: ${ALIGN_LABEL[s.aligned.month] || '–'}`, ALIGN_RATE[s.aligned.month])),
      key > Dates.key() && !hasAnything(s)
        ? el('p', { class: 'stats-empty', text: 'This day hasn’t happened yet.' })
        : summarySections(s).map((section) => el('div', { class: 'sum-section' },
          el('h4', { text: section.title }),
          section.lines.map((line) => el('div', { class: `sum-line${line.startsWith('  ') ? ' sub' : ''}`, text: line.trim() })))));
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
        onChange: (id) => { saveNow(); render(id ? { id } : null); },
      }));
  }

  function alignQuestion(field, question, goals, none) {
    const day = dayOf(dayKey);
    const list = named(goals);
    return [
      el('label', { class: 'plan-label', text: question }),
      el('p', { class: 'goal-hint', text: list.length ? list.map((g) => g.text.trim()).join(' · ') : none }),
      choiceRow(ALIGN, day.aligned?.[field], (value) => {
        ensureDay(dayKey).aligned[field] = value;
        saveNow();
        render();
      }, 'align'),
    ];
  }

  function improveCard() {
    const day = dayOf(dayKey);
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'How did the day go?' }),
        el('span', { class: 'card-actions' },
          day.rating ? el('span', { class: `card-sub rate-text rate-${day.rating}`, text: RATING_LABEL[day.rating] }) : null,
          el('button', { type: 'button', class: 'link', text: 'Copy summary', onclick: () => { flush(); copyDay(dayKey); } }))),
      ratingRow(day),
      el('label', { class: 'plan-label', text: 'How could I improve?' }),
      growingArea(day.improve, 'One thing to do better next time…', (v) => { ensureDay(dayKey).improve = v; }),
      alignQuestion('week', 'Did today move this week’s goals forward?', [...weekOf(mondayOf(dayKey)).goals, ...coreWeekGoals([dayKey])], 'No goals set for this week yet.'),
      alignQuestion('month', 'And this month’s goals?', [...monthOf(firstOfMonth(dayKey)).goals, ...coreMonthGoals(firstOfMonth(dayKey))], 'No goals set for this month yet.'));
  }

  function renderDay(focus) {
    $('#planner-body').replaceChildren(...[
      timelineCard(),
      prioritiesCard(),
      stepsCard('Goal steps for today', stepsOn(dayKey)),
      improveCard(),
    ].filter(Boolean));
    takeScrollTop();
    for (const area of $$('#planner-body .plan-area')) autoGrow(area);

    if (focusOn(focus)) {
      scrollToNow = false;
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

  function focusOn(focus) {
    if (!focus?.id) return false;
    const node = $(`#planner-body [data-id="${focus.id}"]`);
    node?.focus();
    return !!node;
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

  function weekSummaryCard() {
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

  function goalsCard(record, { title, sub, empty, when, notes, core = [] }) {
    const items = record.goals;
    const list = named(items);
    const done = list.filter((g) => g.done).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: title }),
        el('span', { class: 'card-sub', text: list.length ? `${done} of ${list.length} done` : sub })),
      core.length
        ? el('ul', { class: 'core-links' }, core.map((g) => el('li', {},
          el('button', { type: 'button', title: 'Open in Goals', onclick: () => App.show('goals') },
            el('span', { class: 'core-link-icon', text: '🎯' }),
            el('span', { class: 'linked-text' },
              el('span', { class: 'plan-item-label', text: g.text }),
              el('span', { class: 'linked-goal', text: g.label ? `${g.label} · ${g.goal || 'core goal'}` : `From ${g.goal ? `“${g.goal}”` : 'a core goal'}` }))))))
        : null,
      items.length || core.length ? null : el('p', { class: 'stats-empty', text: empty }),
      goalList(items, {
        placeholder: 'What do you want to get done?',
        addLabel: 'Add goal',
        when,
        onChange: (id) => { saveNow(); render(id ? { id } : null); },
      }),
      notes);
  }

  function weekGoalsCard(key, text) {
    const week = ensureWeek(key);
    // Before goals had steps, a week had one box for its daily steps. It stays while it has text in it.
    const notes = week.steps?.trim()
      ? [el('label', { class: 'plan-label', text: 'Daily steps to get there' }),
        growingArea(week.steps, 'Break it down into what you do each day…', (v) => { ensureWeek(key).steps = v; })]
      : null;
    return goalsCard(week, { ...text, when: weekWhen(key), notes });
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
    $('#planner-body').replaceChildren(...[
      strip(),
      weekSummaryCard(),
      weekGoalsCard(weekKey, {
        title: 'Goals for this week',
        sub: 'Set at the end of last week',
        empty: 'Nothing set for this week. Add them here, or set them a week ahead under "Goals for next week". Break a goal down to plan which day each step happens.',
        core: coreWeekGoals(weekDays(weekKey)),
      }),
      stepsCard('From this month’s goals', monthStepsIn(weekKey)),
      reviewCard(),
      weekGoalsCard(nextKey, {
        title: 'Goals for next week',
        sub: 'What next week is for',
        empty: 'What are the two or three things next week is for?',
        core: coreWeekGoals(weekDays(nextKey)),
      }),
    ].filter(Boolean));
    takeScrollTop();
    for (const area of $$('#planner-body .plan-area')) autoGrow(area);
    focusOn(focus);
  }

  function openDay(key) {
    flush();
    dayKey = key;
    weekKey = mondayOf(key);
    monthKey = firstOfMonth(key);
    summaryKey = key;
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
        class: `month-cell rate-${rating || 'none'}${key === today ? ' today' : ''}${key > today ? ' future' : ''}${key === summaryKey ? ' selected' : ''}`,
        title: key === summaryKey ? `${parts.join(' · ')}. Click to open this day` : `${parts.join(' · ')}. Click for its summary`,
        'aria-pressed': key === summaryKey ? 'true' : 'false',
        // The first click shows the day's summary; clicking the chosen day again opens it.
        onclick: () => {
          if (key === summaryKey) {
            openDay(key);
            return;
          }
          summaryKey = key;
          render();
        },
      },
        el('span', { class: 'month-num', text: String(Dates.parse(key).getDate()) }),
        el('span', { class: `month-dot${planned ? ' on' : ''}` })));
    }

    const rated = keys.filter((k) => dayOf(k).rating).length;
    return el('section', { class: 'card plan-card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Day by day' }),
        el('span', { class: 'card-sub', text: rated ? `${rated} day${rated === 1 ? '' : 's'} rated` : 'Click a day for its summary' })),
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
        el('span', { class: 'card-actions' },
          el('span', { class: 'card-sub', text: `${keys.length} day${keys.length === 1 ? '' : 's'} so far` }),
          keys.length
            ? el('button', { type: 'button', class: 'link', text: 'Copy all days', title: 'Copy the summary of every day this month that has something in it', onclick: () => copyMonth(monthKey) })
            : null)),
      el('div', { class: 'plan-stats' }, tiles.map(([label, value]) => el('div', { class: 'plan-stat' },
        el('span', { class: 'stat-label', text: label }),
        el('b', { class: 'stat-value', text: value })))));
  }

  function renderMonth(focus) {
    // The summary follows the month: today in this month, otherwise its first day.
    if (firstOfMonth(summaryKey) !== monthKey) summaryKey = monthKey === firstOfMonth(Dates.key()) ? Dates.key() : monthKey;
    $('#planner-body').replaceChildren(
      monthCard(),
      summaryCard(summaryKey),
      goalsCard(ensureMonth(monthKey), {
        title: 'Goals for this month',
        sub: monthRelative(monthKey),
        empty: 'What is this month for? Break a goal down to plan which week, or which day, each step happens.',
        when: monthWhen(monthKey),
        core: coreMonthGoals(monthKey),
      }),
      monthSummaryCard(),
      goalsCard(ensureMonth(nextMonthOf(monthKey)), {
        title: 'Goals for next month',
        sub: monthTitle(nextMonthOf(monthKey)),
        empty: 'Set them ahead of time, and they’ll be this month’s goals when it arrives.',
        when: monthWhen(nextMonthOf(monthKey)),
        core: coreMonthGoals(nextMonthOf(monthKey)),
      }));
    takeScrollTop();
    focusOn(focus);
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
    summaryKey = dayKey;
    scrollToNow = true;
    resetScroll = true;
    render();
  }

  // What each view calls the thing it shows, so one set of arrows and one button serve all three.
  const VIEW = {
    day: { title: () => dayTitle(dayKey), sub: () => dayRelative(dayKey), here: () => dayKey === Dates.key(), back: 'Today', step: 'day', add: 'Add priority' },
    week: { title: () => weekTitle(weekKey), sub: () => weekRelative(weekKey), here: () => weekKey === mondayOf(Dates.key()), back: 'This week', step: 'week', add: 'Add goal for next week' },
    month: { title: () => monthTitle(monthKey), sub: () => monthRelative(monthKey), here: () => monthKey === firstOfMonth(Dates.key()), back: 'This month', step: 'month', add: 'Add goal for this month' },
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
    else renderMonth(focus);
  }

  // The + button adds a priority for the day, a goal for next week, or a goal for the month.
  function add() {
    const items = mode === 'day'
      ? ensureDay(dayKey).priorities
      : mode === 'week'
        ? ensureWeek(Dates.offsetKey(7, Dates.parse(weekKey))).goals
        : ensureMonth(monthKey).goals;
    if (items.length >= MAX_ITEMS) return;
    const item = newItem();
    items.push(item);
    saveNow();
    render({ id: item.id });
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
    if (summaryKey === Dates.offsetKey(-1)) summaryKey = Dates.key();
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
