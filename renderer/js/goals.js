// Goals tab: goals for the week or month that fill in from what you already track (tasks, habits,
// prayers, Quran, dhikr, journal), whether you're on pace, what needs attention, and this week vs last.
const Goals = (() => {
  const KEY = 'todo-widget.goals';
  const DAY_MS = 86400000;
  const TYPES = ['tasks', 'habit', 'prayers', 'quran', 'dhikr', 'journal'];

  let data = mergeDefaults({ goals: [], plans: [], celebrated: {} }, Store.get(KEY, {}));
  if (!Array.isArray(data.goals)) data.goals = [];
  if (!Array.isArray(data.plans)) data.plans = [];
  let editingId = null;
  const form = $('#goal-form');
  const save = () => Store.set(KEY, data);
  const fmt = (n) => String(Math.round(n * 10) / 10);
  const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

  // ---------- periods ----------
  function weekStartsOn() {
    try {
      const locale = new Intl.Locale(navigator.language);
      const info = locale.getWeekInfo?.() ?? locale.weekInfo;
      if (info?.firstDay) return info.firstDay % 7; // 1 = Monday … 7 = Sunday
    } catch {}
    return 1;
  }

  // The days of this week or month (offset -1 for the one before), and how many are left including today.
  function period(kind, offset = 0) {
    const today = Dates.parse(Dates.key());
    let start;
    let end;
    if (kind === 'week') {
      start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() - weekStartsOn() + 7) % 7) + offset * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    } else {
      start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    }
    const keys = Dates.range(Dates.key(start), Dates.key(end));
    const todayKey = Dates.key();
    const soFar = keys.filter((k) => k <= todayKey);
    return { kind, start: keys[0], keys, soFar, daysLeft: offset === 0 ? keys.length - soFar.length + 1 : 0 };
  }

  // ---------- what a goal measures ----------
  function describe(goal) {
    switch (goal.type) {
      case 'habit': {
        const h = Habits.list().find((x) => x.id === goal.habitId);
        if (!h) return { icon: '❔', title: 'Deleted habit', unit: 'days', dayBased: true, missing: true };
        const total = goal.habitMetric === 'total' && h.type === 'count';
        return { icon: h.emoji || '✅', title: h.name, unit: total ? h.unit || 'total' : 'days', dayBased: !total };
      }
      case 'tasks':
        return { icon: '☑️', title: goal.category ? `${goal.category} tasks done` : 'Tasks done', unit: 'tasks' };
      case 'prayers':
        return goal.prayerMetric === 'count'
          ? { icon: '🕌', title: 'Prayers marked', unit: 'prayers' }
          : { icon: '🕌', title: 'All 5 prayers', unit: 'days', dayBased: true };
      case 'quran':
        return { icon: '📖', title: 'Quran reading', unit: 'pages' };
      case 'dhikr':
        return { icon: '📿', title: 'Dhikr', unit: 'count' };
      case 'journal':
        return { icon: '📝', title: 'Journal entries', unit: 'entries' };
      default:
        return { icon: '🎯', title: 'Goal', unit: '' };
    }
  }

  function measure(goal, keys) {
    const inRange = new Set(keys);
    switch (goal.type) {
      case 'habit': {
        const s = Habits.statsFor(keys).find((h) => h.id === goal.habitId);
        if (!s) return 0;
        return goal.habitMetric === 'total' && s.type === 'count' ? s.total : s.met;
      }
      case 'tasks':
        return Tasks.list().filter((t) => t.done && t.completedAt && inRange.has(Dates.key(new Date(t.completedAt)))
          && (!goal.category || t.category === goal.category)).length;
      case 'prayers':
        return goal.prayerMetric === 'count'
          ? keys.reduce((n, k) => n + Prayer.prayedCount(k), 0)
          : keys.filter((k) => Prayer.prayedCount(k) >= 5).length;
      case 'quran':
        return Deen.pagesIn(keys);
      case 'dhikr':
        return Deen.dhikrIn(keys);
      case 'journal':
        return Journal.list().filter((n) => inRange.has(Dates.key(new Date(n.createdAt)))).length;
      default:
        return 0;
    }
  }

  const unitText = (n, unit) => (unit === 'days' ? plural(n, 'day') : `${fmt(n)} ${unit}`);

  function progress(goal) {
    const p = period(goal.period);
    const info = describe(goal);
    const value = measure(goal, p.soFar);
    const target = goal.target;
    const remaining = Math.max(0, target - value);
    const passed = p.soFar.length - 1; // whole days before today
    const expected = (target * passed) / p.keys.length;
    let state;
    let text;
    if (value >= target) {
      state = 'done';
      text = 'Done. Nice work!';
    } else if (info.dayBased && remaining > p.daysLeft) {
      state = 'missed';
      text = `Out of reach this ${goal.period}: ${plural(remaining, 'more day')} needed, ${p.daysLeft} left`;
    } else if (value >= expected) {
      state = 'on';
      text = `On track · ${unitText(remaining, info.unit)} to go`;
    } else {
      state = 'behind';
      text = info.dayBased
        ? `Behind · needs ${remaining} of the ${plural(p.daysLeft, 'day')} left`
        : `Behind · about ${fmt(Math.ceil(remaining / p.daysLeft))} ${info.unit} a day to catch up`;
    }
    const last = period(goal.period, -1);
    const lastValue = measure(goal, last.keys);
    return {
      ...info, value, target, state, text, period: p,
      pace: Math.min(1, passed / p.keys.length),
      lastValue, lastMet: lastValue >= target,
    };
  }

  // ---------- goals list ----------
  function goalItem(goal) {
    const g = progress(goal);
    const fraction = Math.min(1, g.target ? g.value / g.target : 0);
    const showLast = (goal.createdAt || 0) < Dates.parse(g.period.start).getTime();
    return el('li', {},
      el('button', { type: 'button', class: `goal ${g.state}`, title: 'Edit goal', onclick: () => openForm(goal) },
        el('span', { class: 'goal-top' },
          el('span', { class: 'goal-icon', text: g.icon }),
          el('span', { class: 'goal-title', text: g.title }),
          el('span', { class: 'goal-value' }, el('b', { text: fmt(g.value) }), ` / ${unitText(g.target, g.unit)}`)),
        el('span', { class: 'goal-bar' },
          el('span', { class: 'bar-fill', style: { '--w': `${Math.round(fraction * 100)}%` } }),
          g.state === 'done' ? null : el('i', { class: 'goal-pace', title: 'Where you’d be at an even pace', style: { '--x': `${Math.round(g.pace * 100)}%` } })),
        el('span', { class: 'goal-bottom' },
          el('span', { class: 'goal-status', text: g.text }),
          showLast ? el('span', { class: 'goal-last', text: `Last ${goal.period}: ${fmt(g.lastValue)}${g.lastMet ? ' ✓' : ''}` }) : null)));
  }

  function suggestions() {
    const out = [{ label: 'Finish 10 tasks a week', goal: { type: 'tasks', period: 'week', target: 10 } }];
    const h = Habits.list()[0];
    if (h?.type === 'count') {
      out.push({ label: `${h.name}: ${fmt(h.goal * 20)} ${h.unit || ''} a month`.trim(), goal: { type: 'habit', habitId: h.id, habitMetric: 'total', period: 'month', target: h.goal * 20 } });
    } else if (h) {
      out.push({ label: `${h.name} on 20 days a month`, goal: { type: 'habit', habitId: h.id, habitMetric: 'days', period: 'month', target: 20 } });
    }
    if (Settings.data.tabs.deen) {
      out.push(
        { label: 'Pray all 5 on 25 days a month', goal: { type: 'prayers', prayerMetric: 'days', period: 'month', target: 25 } },
        { label: 'Read 100 pages of Quran a month', goal: { type: 'quran', period: 'month', target: 100 } },
      );
    }
    return out;
  }

  function emptyCard() {
    return el('section', { class: 'card goal-empty' },
      el('h3', { text: 'Targets' }),
      el('p', { class: 'card-sub', text: 'Numbers to hit each week or month. They fill in by themselves from your tasks, habits, prayers and Quran reading, and tell you if you’re on pace.' }),
      el('div', { class: 'quick goal-suggestions' }, suggestions().map((s) => el('button', {
        type: 'button', class: 'chip', text: s.label, onclick: () => openForm(null, s.goal),
      }))),
      el('button', { type: 'button', class: 'btn ghost small', text: 'Make my own', onclick: () => openForm() }));
  }

  // ---------- needs attention ----------
  const daysBetween = (fromKey, toKey) => Math.round((Dates.parse(toKey) - Dates.parse(fromKey)) / DAY_MS);

  function attention() {
    const items = [];
    const today = Dates.key();

    const overdue = Tasks.list().filter(Tasks.isOverdue);
    if (overdue.length) {
      items.push({ icon: '⏰', text: `${plural(overdue.length, 'overdue task')}`, sub: overdue.slice(0, 2).map((t) => t.title).join(', '), view: 'tasks' });
    }

    const slipping = [];
    for (const h of Habits.list()) {
      const last = Habits.lastMet(h.id);
      const since = last ? daysBetween(last, today) : Math.floor((Date.now() - (h.createdAt || Date.now())) / DAY_MS);
      if (since >= 3) slipping.push({ h, since, last });
    }
    slipping.sort((a, b) => b.since - a.since).slice(0, 3).forEach(({ h, since, last }) => items.push({
      icon: h.emoji || '🔁',
      text: last ? `No “${h.name}” for ${since} days` : `“${h.name}” hasn’t been done yet`,
      sub: last ? `Last done ${Dates.parse(last).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : '',
      view: 'habits',
    }));

    if (new Date().getHours() >= 17) {
      for (const s of Habits.statsFor([today])) {
        if (!s.met && s.streak >= 3) items.push({ icon: '🔥', text: `Your ${s.streak}-day “${s.name}” streak ends tonight`, view: 'habits' });
      }
    }

    if (Settings.data.tabs.deen) {
      const prayerToday = Prayer.todayKey();
      const days = Array.from({ length: 14 }, (_, i) => Prayer.shiftKey(prayerToday, -(i + 1)));
      const tracked = days.filter((k) => Prayer.prayedCount(k) > 0);
      if (tracked.length >= 3) {
        const most = Prayer.FIVE
          .map((p) => ({ p, missed: tracked.filter((k) => !Prayer.isPrayed(k, p.key)).length }))
          .sort((a, b) => b.missed - a.missed)[0];
        if (most.missed >= 2) {
          items.push({ icon: '🕌', text: `${most.p.label} is your most missed prayer lately`, sub: `Not marked on ${most.missed} of the ${tracked.length} days you tracked`, view: 'deen' });
        }
      }
      const lastRead = Deen.lastReadDay();
      if (lastRead && daysBetween(lastRead, today) >= 4) {
        items.push({ icon: '📖', text: `No Quran reading logged for ${daysBetween(lastRead, today)} days`, view: 'deen' });
      }
    }
    return items;
  }

  function attentionCard() {
    const items = attention();
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', { text: 'Needs attention' }), items.length ? el('span', { class: 'card-sub', text: String(items.length) }) : null),
      items.length
        ? el('ul', { class: 'attention-list' }, items.map((item) => el('li', {},
          el('button', { type: 'button', class: 'attention-item', title: 'Open', onclick: () => App.show(item.view) },
            el('span', { class: 'attention-icon', text: item.icon }),
            el('span', { class: 'attention-text' }, item.text, item.sub ? el('small', { text: item.sub }) : null),
            el('span', { class: 'attention-go', html: Icons.chevronRight })))))
        : el('p', { class: 'stats-empty', text: 'Nothing needs attention right now. Keep it up.' }));
  }

  // ---------- this week vs last ----------
  function compareCard() {
    const now = period('week');
    const before = period('week', -1);
    const a = now.soFar;
    const b = before.keys.slice(0, a.length);
    const tasksDone = (keys) => {
      const set = new Set(keys);
      return Tasks.list().filter((t) => t.done && t.completedAt && set.has(Dates.key(new Date(t.completedAt)))).length;
    };
    const habitRate = (keys) => {
      const stats = Habits.statsFor(keys);
      const possible = stats.reduce((n, h) => n + h.days, 0);
      return possible ? Math.round((stats.reduce((n, h) => n + h.met, 0) / possible) * 100) : null;
    };
    const prayed = (keys) => keys.reduce((n, k) => n + Prayer.prayedCount(k), 0);
    const rows = [
      ['Tasks done', tasksDone(a), tasksDone(b), ''],
      Habits.list().length ? ['Habits met', habitRate(a), habitRate(b), '%'] : null,
      Settings.data.tabs.deen ? ['Prayers marked', prayed(a), prayed(b), ''] : null,
      Settings.data.tabs.deen ? ['Quran pages', Deen.pagesIn(a), Deen.pagesIn(b), ''] : null,
    ].filter(Boolean);

    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'This week vs last' }),
        el('span', { class: 'card-sub', text: a.length < 7 ? `First ${plural(a.length, 'day')} of each` : 'Whole weeks' })),
      el('div', { class: 'compare' }, rows.map(([label, current, previous, suffix]) => {
        const diff = (current ?? 0) - (previous ?? 0);
        // A change in a percentage is in points: 60% -> 70% is "10 pts", not "10%".
        const change = `${fmt(Math.abs(diff))}${suffix === '%' ? ' pts' : ''}`;
        return el('div', { class: 'compare-tile' },
          el('span', { class: 'stat-label', text: label }),
          el('b', { class: 'stat-value', text: current == null ? '–' : `${fmt(current)}${suffix}` }),
          el('span', { class: `compare-delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`, text: diff === 0 ? 'Same as last week' : `${diff > 0 ? '▲' : '▼'} ${change} vs last week` }));
      })));
  }

  // ---------- core goals ----------
  // A big goal, with a date to reach it by if you want one. It splits into a goal for each month,
  // each month into four weeks (1–7, 8–14, 15–21 and 22 to the end), and each week into tasks.
  // The tasks are ordinary tasks: they show in Tasks with their due date and tick off in either place.
  const MAX_MONTHS = 36;
  let openPlanId = null;
  let planFocus = null;
  let planTimer = null;
  const toggledMonths = new Set(); // months opened or closed by hand, against the default

  function savePlansSoon() {
    clearTimeout(planTimer);
    planTimer = setTimeout(flushPlans, 600);
  }

  function flushPlans() {
    if (!planTimer) return;
    clearTimeout(planTimer);
    planTimer = null;
    save();
  }

  const monthOfKey = (key) => `${key.slice(0, 8)}01`;
  const monthName = (key, opts = {}) => Dates.parse(key).toLocaleDateString(undefined, { month: 'long', ...opts });
  const weekOfKey = (key) => Math.min(3, Math.floor((Dates.parse(key).getDate() - 1) / 7));

  function addMonths(key, n) {
    const d = Dates.parse(key);
    return Dates.key(new Date(d.getFullYear(), d.getMonth() + n, 1));
  }

  // The first and last day of week 1–4 of a month; week 4 runs to the end of the month.
  function weekSpan(monthKey, index) {
    const d = Dates.parse(monthKey);
    const last = Dates.daysInMonth(d.getFullYear(), d.getMonth());
    const day = (n) => Dates.key(new Date(d.getFullYear(), d.getMonth(), n));
    return [day(1 + 7 * index), day(index === 3 ? last : 7 * (index + 1))];
  }

  const spanText = ([from, to]) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).formatRange(Dates.parse(from), Dates.parse(to));
  const findPlan = (id) => data.plans.find((p) => p.id === id);
  const linkedTasks = (plan) => Tasks.list().filter((t) => t.goalLink?.plan === plan.id);

  function weekTasks(plan, monthKey, index) {
    return linkedTasks(plan)
      .filter((t) => t.goalLink.month === monthKey && t.goalLink.week === index)
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.createdAt - b.createdAt);
  }

  function monthRecord(plan, key) {
    plan.months ??= {};
    const month = (plan.months[key] ??= { text: '', weeks: ['', '', '', ''] });
    month.weeks ??= ['', '', '', ''];
    return month;
  }

  const monthHasPlan = (plan, key) => {
    const month = plan.months?.[key];
    return !!(month?.text?.trim() || (month?.weeks || []).some((w) => w?.trim()) || linkedTasks(plan).some((t) => t.goalLink.month === key));
  };

  // From the month the goal was set (or the earliest month planned) to the month it's due. With no
  // date, up to next month, plus any months added by hand.
  function planMonths(plan) {
    const current = monthOfKey(Dates.key());
    const planned = [...new Set([...Object.keys(plan.months || {}), ...linkedTasks(plan).map((t) => t.goalLink.month)])]
      .filter((k) => monthHasPlan(plan, k)).sort();
    let start = monthOfKey(Dates.key(new Date(plan.createdAt || Date.now())));
    if (planned[0] && planned[0] < start) start = planned[0];
    let end = plan.by ? monthOfKey(plan.by) : addMonths(current > start ? current : start, 1 + (plan.extraMonths || 0));
    if (planned.length && planned[planned.length - 1] > end) end = planned[planned.length - 1];
    if (end < start) end = start;
    const out = [];
    for (let k = start; k <= end && out.length < MAX_MONTHS; k = addMonths(k, 1)) out.push(k);
    return out;
  }

  function dueText(plan) {
    if (plan.done) return 'Achieved';
    if (!plan.by) return 'No date set';
    const days = daysBetween(Dates.key(), plan.by);
    if (days < 0) return 'Date has passed';
    if (days === 0) return 'Due today';
    if (days < 60) return `${plural(days, 'day')} left`;
    return `${Math.round(days / 30.4)} months left`;
  }

  function newPlan() {
    const plan = { id: uid(), title: '', by: '', why: '', done: false, months: {}, createdAt: Date.now() };
    data.plans.push(plan);
    save();
    openPlan(plan.id, { id: plan.id });
  }

  function openPlan(id, focus = null) {
    flushPlans();
    openPlanId = id;
    planFocus = focus;
    $('#goals-body').scrollTop = 0;
    render();
  }

  function closePlan() {
    flushPlans();
    const plan = findPlan(openPlanId);
    openPlanId = null;
    // A goal opened and left without anything in it isn't kept.
    if (plan && !plan.title.trim() && !plan.why?.trim() && !plan.by && !Object.keys(plan.months || {}).some((k) => monthHasPlan(plan, k))) {
      data.plans = data.plans.filter((p) => p !== plan);
      save();
    }
    $('#goals-body').scrollTop = 0;
    render();
  }

  function removePlan(plan) {
    const index = data.plans.indexOf(plan);
    // Its tasks still to do go with it; ones already done stay in Tasks as a record.
    const open = linkedTasks(plan).filter((t) => !t.done);
    data.plans.splice(index, 1);
    save();
    for (const t of open) Tasks.remove(t.id);
    openPlanId = null;
    render();
    Toast.show(`Deleted “${plan.title.trim().slice(0, 30) || 'goal'}”${open.length ? ` and ${plural(open.length, 'task')}` : ''}`, () => {
      data.plans.splice(Math.min(index, data.plans.length), 0, plan);
      save();
      for (const t of open) Tasks.add(t);
      render();
    });
  }

  // One line you type into that saves as you go.
  function planInput(value, { placeholder, className = 'plan-item-text', id, onInput, onCommit }) {
    const input = el('input', {
      class: className,
      maxlength: 200,
      placeholder,
      'data-id': id,
      oninput: () => {
        onInput(input.value);
        savePlansSoon();
      },
      onchange: () => {
        flushPlans();
        onCommit?.(input.value);
      },
    });
    input.value = value || '';
    return input;
  }

  function planCard(plan) {
    const tasks = linkedTasks(plan);
    const done = tasks.filter((t) => t.done).length;
    const today = Dates.key();
    const monthKey = monthOfKey(today);
    const week = weekOfKey(today);
    const month = plan.months?.[monthKey];
    const leftThisWeek = weekTasks(plan, monthKey, week).filter((t) => !t.done).length;
    return el('li', {},
      el('button', { type: 'button', class: `goal core-goal${plan.done ? ' done' : ''}`, title: 'Open this goal', onclick: () => openPlan(plan.id) },
        el('span', { class: 'goal-top' },
          el('span', { class: 'goal-icon', text: plan.done ? '🏆' : '🎯' }),
          el('span', { class: 'goal-title', text: plan.title.trim() || 'Untitled goal' }),
          el('span', { class: 'goal-value', text: dueText(plan) })),
        el('span', { class: 'goal-bar' },
          el('span', { class: 'bar-fill', style: { '--w': `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%` } })),
        plan.done ? null : el('span', { class: 'core-line' },
          el('b', { text: monthName(monthKey) }),
          el('span', { text: month?.text?.trim() || 'No goal for this month yet' })),
        plan.done ? null : el('span', { class: 'core-line' },
          el('b', { text: `Week ${week + 1}` }),
          el('span', { text: month?.weeks?.[week]?.trim() || 'No goal for this week yet' })),
        el('span', { class: 'goal-bottom' },
          el('span', { class: 'goal-status', text: tasks.length ? `${done} of ${plural(tasks.length, 'task')} done` : 'No tasks yet' }),
          leftThisWeek ? el('span', { class: 'goal-last', text: `${leftThisWeek} left this week` }) : null)));
  }

  function coreCards() {
    const active = data.plans.filter((p) => !p.done);
    const achieved = data.plans.filter((p) => p.done);
    if (!data.plans.length) {
      return [el('section', { class: 'card goal-empty' },
        el('span', { class: 'goal-empty-icon', html: Icons.target }),
        el('h3', { text: 'Set a core goal' }),
        el('p', { class: 'card-sub', text: 'Pick the big thing you want to achieve and, if you like, a date to reach it by. Then break it down into:' }),
        el('ol', { class: 'core-steps' },
          el('li', { text: 'A goal for each month' }),
          el('li', { text: 'A goal for each of the month’s 4 weeks' }),
          el('li', { text: 'Tasks for each week, which show up in Tasks with their due date' })),
        el('button', { type: 'button', class: 'btn primary small', text: 'Set a core goal', onclick: newPlan }))];
    }
    const cards = [el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', { text: 'Core goals' }),
        el('button', { type: 'button', class: 'link', text: 'New core goal', onclick: newPlan })),
      active.length
        ? el('ul', { class: 'goal-list' }, active.map(planCard))
        : el('p', { class: 'stats-empty', text: 'Every goal here is achieved. Time to set the next one.' }))];
    if (achieved.length) {
      cards.push(el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', { text: 'Achieved' }), el('span', { class: 'card-sub', text: String(achieved.length) })),
        el('ul', { class: 'goal-list' }, achieved.map(planCard))));
    }
    return cards;
  }

  function taskRow(task, [from, to]) {
    const title = el('input', {
      class: 'plan-item-text',
      maxlength: 200,
      'aria-label': 'Task',
      onchange: () => {
        const value = title.value.trim();
        if (value && value !== task.title) Tasks.update(task.id, { title: value });
        else title.value = task.title;
      },
    });
    title.value = task.title;
    const date = el('input', {
      type: 'date',
      class: 'step-date',
      min: from,
      max: to,
      title: 'Due date (optional)',
      'aria-label': 'Due date',
      onchange: () => {
        Tasks.update(task.id, { date: date.value, time: date.value ? task.time : '' });
        render();
      },
    });
    date.value = task.date || '';
    return el('li', { class: `plan-item step${task.done ? ' done' : ''}` },
      el('button', {
        type: 'button',
        class: 'check',
        title: task.done ? 'Mark as not done' : 'Mark as done',
        'aria-pressed': task.done ? 'true' : 'false',
        html: task.done ? Icons.check : '',
        onclick: () => {
          Tasks.toggle(task.id);
          render();
        },
      }),
      title,
      el('span', { class: 'step-when-wrap' }, date),
      el('button', {
        type: 'button',
        class: 'icon-btn sm del',
        title: 'Delete task',
        'aria-label': 'Delete task',
        html: Icons.trash,
        onclick: () => {
          Tasks.remove(task.id);
          render();
        },
      }));
  }

  function weekBlock(plan, monthKey, index) {
    const span = weekSpan(monthKey, index);
    const today = Dates.key();
    const tasks = weekTasks(plan, monthKey, index);
    const draftId = `${plan.id}:${monthKey}:${index}`;
    const draft = el('input', {
      class: 'plan-item-text core-draft',
      maxlength: 200,
      placeholder: '+ Add a task',
      'data-draft': draftId,
    });
    const addTask = (refocus) => {
      const value = draft.value.trim();
      if (!value) return;
      draft.value = '';
      Tasks.add({
        title: value,
        category: plan.title.trim().slice(0, 40),
        goalLink: { plan: plan.id, month: monthKey, week: index },
      });
      planFocus = refocus ? { draft: draftId } : null;
      render();
    };
    draft.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addTask(true);
    });
    draft.addEventListener('change', () => addTask(false));

    const done = tasks.filter((t) => t.done).length;
    return el('div', { class: `core-week${today >= span[0] && today <= span[1] ? ' now' : ''}` },
      el('div', { class: 'core-week-head' },
        el('b', { text: `Week ${index + 1}` }),
        el('span', { class: 'card-sub', text: spanText(span) }),
        tasks.length ? el('span', { class: 'card-sub core-count', text: `${done}/${tasks.length} done` }) : null),
      planInput(plan.months?.[monthKey]?.weeks?.[index], {
        placeholder: 'Goal for this week',
        className: 'plan-item-text core-week-goal',
        onInput: (v) => { monthRecord(plan, monthKey).weeks[index] = v; },
      }),
      el('ul', { class: 'plan-items' }, tasks.map((t) => taskRow(t, span))),
      draft);
  }

  function monthSection(plan, monthKey, months) {
    const current = monthOfKey(Dates.key());
    const openByDefault = monthKey === current || (months[0] > current && monthKey === months[0]);
    const id = `${plan.id}:${monthKey}`;
    const open = openByDefault !== toggledMonths.has(id);
    const tasks = linkedTasks(plan).filter((t) => t.goalLink.month === monthKey);
    const goal = plan.months?.[monthKey]?.text?.trim();
    const label = monthName(monthKey, Dates.parse(monthKey).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {});
    return el('section', { class: `card core-month${monthKey < current ? ' past' : ''}${monthKey === current ? ' now' : ''}` },
      el('button', {
        type: 'button',
        class: 'core-month-head',
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => {
          flushPlans();
          if (toggledMonths.has(id)) toggledMonths.delete(id);
          else toggledMonths.add(id);
          render();
        },
      },
        el('span', { class: `core-chevron${open ? ' open' : ''}`, html: Icons.chevronRight }),
        el('span', { class: 'core-month-text' },
          el('b', { text: label }),
          el('span', { class: 'card-sub', text: goal || (monthKey === current ? 'This month · no goal yet' : 'No goal yet') })),
        tasks.length ? el('span', { class: 'card-sub', text: `${tasks.filter((t) => t.done).length}/${tasks.length} tasks` }) : null),
      open
        ? el('div', { class: 'core-month-body' },
          el('label', { class: 'plan-label', text: `Goal for ${monthName(monthKey)}` }),
          planInput(plan.months?.[monthKey]?.text, {
            placeholder: `What does ${monthName(monthKey)} need to get done?`,
            className: 'plan-item-text core-month-goal',
            onInput: (v) => { monthRecord(plan, monthKey).text = v; },
          }),
          [0, 1, 2, 3].map((i) => weekBlock(plan, monthKey, i)))
        : null);
  }

  function planDetail(plan) {
    const months = planMonths(plan);
    const byInput = el('input', {
      type: 'date',
      class: 'step-date core-by',
      'aria-label': 'Achieve it by',
      onchange: () => {
        plan.by = byInput.value;
        save();
        render();
      },
    });
    byInput.value = plan.by || '';
    const why = el('textarea', {
      class: 'plan-area',
      rows: 2,
      placeholder: 'Why it matters, so you remember on the hard days (optional)',
      oninput: () => {
        plan.why = why.value;
        savePlansSoon();
      },
      onchange: flushPlans,
    });
    why.value = plan.why || '';

    return [
      el('div', { class: 'core-nav' },
        el('button', { type: 'button', class: 'link', text: '‹ All goals', onclick: closePlan }),
        el('span', { class: 'card-actions' },
          el('button', {
            type: 'button',
            class: 'link',
            text: plan.done ? 'Not achieved yet' : 'Mark achieved',
            onclick: () => {
              plan.done = !plan.done;
              save();
              if (plan.done) Toast.show(`Achieved: ${plan.title.trim() || 'goal'} 🏆`);
              render();
            },
          }),
          el('button', { type: 'button', class: 'icon-btn sm del', title: 'Delete this goal', 'aria-label': 'Delete this goal', html: Icons.trash, onclick: () => removePlan(plan) }))),
      el('section', { class: 'card core-head' },
        el('label', { class: 'plan-label first', text: 'Core goal' }),
        planInput(plan.title, {
          placeholder: 'The big thing you want to achieve',
          className: 'core-title',
          id: plan.id,
          onInput: (v) => { plan.title = v; },
          // Its tasks are filed under the goal's name in Tasks, so they follow a new name.
          onCommit: (v) => {
            const category = v.trim().slice(0, 40);
            for (const t of linkedTasks(plan)) if (t.category !== category) Tasks.update(t.id, { category });
          },
        }),
        el('div', { class: 'core-by-row' },
          el('span', { class: 'plan-label', text: 'Achieve it by' }),
          byInput,
          plan.by ? el('button', { type: 'button', class: 'link', text: 'Clear', onclick: () => { plan.by = ''; save(); render(); } }) : null,
          el('span', { class: 'card-sub', text: plan.by ? dueText(plan) : 'Optional' })),
        why),
      el('p', { class: 'core-hint', text: 'Give each month a goal, split it across its 4 weeks, and add tasks to each week. Tasks show up in Tasks, with their due date if you pick one.' }),
      ...months.map((k) => monthSection(plan, k, months)),
      plan.by
        ? null
        : el('button', {
          type: 'button',
          class: 'plan-add core-more',
          onclick: () => {
            plan.extraMonths = (plan.extraMonths || 0) + 1;
            save();
            render();
          },
        }, el('span', { html: Icons.plus }), 'Plan another month'),
    ];
  }

  // ---------- used by the Planner ----------
  // This month's goal from every core goal still going.
  function monthGoalsFor(monthKey) {
    return data.plans
      .filter((p) => !p.done && p.months?.[monthKey]?.text?.trim())
      .map((p) => ({ text: p.months[monthKey].text.trim(), goal: p.title.trim() }));
  }

  // The weekly goals, from every core goal still going, of the weeks these days fall in.
  function weekGoalsFor(keys) {
    const weeks = [...new Set(keys.map((k) => `${monthOfKey(k)}|${weekOfKey(k)}`))];
    const out = [];
    for (const p of data.plans) {
      if (p.done) continue;
      for (const w of weeks) {
        const [monthKey, index] = w.split('|');
        const text = p.months?.[monthKey]?.weeks?.[index]?.trim();
        if (text) out.push({ text, goal: p.title.trim(), label: `Week ${Number(index) + 1} of ${monthName(monthKey)}` });
      }
    }
    return out;
  }

  // ---------- render ----------
  function render() {
    const plan = openPlanId && findPlan(openPlanId);
    if (plan) {
      $('#goals-body').replaceChildren(...planDetail(plan).filter(Boolean));
      $('#goals-stats').textContent = dueText(plan);
      const focus = planFocus;
      planFocus = null;
      if (focus?.id) $(`#goals-body [data-id="${focus.id}"]`)?.focus();
      if (focus?.draft) $(`#goals-body [data-draft="${focus.draft}"]`)?.focus();
      return;
    }
    openPlanId = null;
    const sections = [...coreCards()];
    if (!data.goals.length) sections.push(emptyCard());
    let done = 0;
    for (const kind of ['week', 'month']) {
      const goals = data.goals.filter((g) => g.period === kind);
      if (!goals.length) continue;
      const p = period(kind);
      done += goals.filter((g) => progress(g).state === 'done').length;
      const label = kind === 'week' ? 'Targets this week' : `Targets for ${Dates.parse(p.start).toLocaleDateString(undefined, { month: 'long' })}`;
      sections.push(el('section', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', { text: label }),
          el('span', { class: 'card-actions' },
            el('span', { class: 'card-sub', text: `${plural(p.daysLeft, 'day')} left` }),
            el('button', { type: 'button', class: 'link', text: 'Add target', onclick: () => openForm() }))),
        el('ul', { class: 'goal-list' }, goals.map(goalItem))));
    }
    sections.push(attentionCard(), compareCard());
    $('#goals-body').replaceChildren(...sections);
    const active = data.plans.filter((p) => !p.done).length;
    $('#goals-stats').textContent = [
      active ? plural(active, 'core goal') : '',
      data.goals.length ? `${done} of ${plural(data.goals.length, 'target')} reached` : '',
    ].filter(Boolean).join(' · ');
  }

  // The periodic refresh leaves the view alone while you're typing in it.
  function refresh() {
    const active = document.activeElement;
    if (active && $('#goals-body').contains(active) && active.matches('input, textarea, select')) return;
    render();
  }

  // ---------- form ----------
  function populateForm() {
    const habits = Habits.list();
    $('#g-habit').replaceChildren(...habits.map((h) => new Option(`${h.emoji ? `${h.emoji} ` : ''}${h.name}`, h.id)));
    const habitOption = $('#g-type option[value="habit"]');
    habitOption.disabled = !habits.length;
    habitOption.textContent = habits.length ? 'A habit' : 'A habit (add one in Habits first)';
    for (const option of $$('#g-type option[data-deen]')) {
      option.hidden = !Settings.data.tabs.deen;
      option.disabled = !Settings.data.tabs.deen;
    }
    const categories = [...new Set(Tasks.list().map((t) => t.category).filter(Boolean))].sort();
    $('#g-cat').replaceChildren(new Option('Any category', ''), ...categories.map((c) => new Option(c, c)));
  }

  function readForm() {
    const type = $('#g-type').value;
    const habit = Habits.list().find((h) => h.id === $('#g-habit').value);
    return {
      type,
      period: $('#g-period').value === 'month' ? 'month' : 'week',
      target: Math.max(1, Math.round((parseFloat($('#g-target').value) || 1) * 10) / 10),
      habitId: type === 'habit' ? $('#g-habit').value : '',
      habitMetric: type === 'habit' && habit?.type === 'count' ? $('#g-habit-metric').value : 'days',
      category: type === 'tasks' ? $('#g-cat').value : '',
      prayerMetric: type === 'prayers' ? $('#g-prayer-metric').value : 'days',
    };
  }

  function syncForm() {
    const draft = readForm();
    const habit = Habits.list().find((h) => h.id === draft.habitId);
    $('#g-habit-field').hidden = draft.type !== 'habit';
    $('#g-habit-metric-field').hidden = draft.type !== 'habit' || habit?.type !== 'count';
    $('#g-cat-field').hidden = draft.type !== 'tasks';
    $('#g-prayer-field').hidden = draft.type !== 'prayers';
    const info = describe(draft);
    const p = period(draft.period);
    const soFar = measure(draft, p.soFar);
    $('#g-hint').textContent = draft.type === 'habit' && !habit
      ? ''
      : `Goal: ${unitText(draft.target, info.unit)} every ${draft.period}. So far this ${draft.period}: ${unitText(soFar, info.unit)}.`;
  }

  function openForm(goal = null, preset = null) {
    editingId = goal?.id ?? null;
    const g = goal || preset || { type: 'tasks', period: 'week', target: 10 };
    populateForm();
    $('#goal-form-title').textContent = goal ? 'Edit target' : 'New target';
    $('#g-submit').textContent = goal ? 'Save' : 'Add target';
    $('#g-delete').hidden = !goal;
    $('#g-type').value = TYPES.includes(g.type) ? g.type : 'tasks';
    if ($('#g-type').selectedOptions[0]?.disabled) $('#g-type').value = 'tasks';
    if (g.habitId) $('#g-habit').value = g.habitId;
    $('#g-habit-metric').value = g.habitMetric === 'total' ? 'total' : 'days';
    $('#g-cat').value = g.category || '';
    $('#g-prayer-metric').value = g.prayerMetric === 'count' ? 'count' : 'days';
    $('#g-period').value = g.period === 'month' ? 'month' : 'week';
    $('#g-target').value = g.target ?? 10;
    syncForm();
    Sheet.open(form, () => { editingId = null; });
    $('#g-target').focus();
    $('#g-target').select();
  }

  function remove(id) {
    const index = data.goals.findIndex((g) => g.id === id);
    if (index < 0) return;
    const [goal] = data.goals.splice(index, 1);
    save();
    render();
    Toast.show('Target deleted', () => {
      data.goals.splice(Math.min(index, data.goals.length), 0, goal);
      save();
      render();
    });
  }

  // A toast (or a notification while the widget is hidden) the first time a goal is reached each week or month.
  function checkReached() {
    let changed = false;
    for (const goal of data.goals) {
      const g = progress(goal);
      const mark = `${goal.period}:${g.period.start}`;
      if (g.state !== 'done' || data.celebrated[goal.id] === mark) continue;
      data.celebrated[goal.id] = mark;
      changed = true;
      const message = { title: 'Goal reached 🎉', body: `${g.title}: ${fmt(g.value)} / ${unitText(g.target, g.unit)} this ${goal.period}`, view: 'goals' };
      if (document.hidden) Notifier.announce(message);
      else Toast.show(`Goal reached: ${g.title} 🎉`);
    }
    for (const id of Object.keys(data.celebrated)) {
      if (!data.goals.some((g) => g.id === id)) {
        delete data.celebrated[id];
        changed = true;
      }
    }
    if (changed) save();
  }

  function init() {
    for (const id of ['#g-type', '#g-habit', '#g-habit-metric', '#g-cat', '#g-prayer-metric', '#g-period']) {
      $(id).addEventListener('change', syncForm);
    }
    $('#g-target').addEventListener('input', syncForm);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = readForm();
      if (fields.type === 'habit' && !Habits.list().some((h) => h.id === fields.habitId)) return;
      if (editingId) {
        const goal = data.goals.find((g) => g.id === editingId);
        if (goal) {
          Object.assign(goal, fields);
          delete data.celebrated[goal.id];
        }
      } else {
        data.goals.push({ id: uid(), ...fields, createdAt: Date.now() });
      }
      save();
      Sheet.close();
      render();
      checkReached();
    });
    $('#g-cancel').addEventListener('click', () => Sheet.close());
    $('#g-delete').addEventListener('click', () => {
      const id = editingId;
      Sheet.close();
      remove(id);
    });
  }

  return { init, render, refresh, openForm, newPlan, checkReached, progress, attention, monthGoalsFor, weekGoalsFor, list: () => data.goals };
})();
