// Goals tab: goals for the week or month that fill in from what you already track (tasks, habits,
// prayers, Quran, dhikr, journal), whether you're on pace, what needs attention, and this week vs last.
const Goals = (() => {
  const KEY = 'todo-widget.goals';
  const DAY_MS = 86400000;
  const TYPES = ['tasks', 'habit', 'prayers', 'quran', 'dhikr', 'journal'];

  let data = mergeDefaults({ goals: [], celebrated: {} }, Store.get(KEY, {}));
  if (!Array.isArray(data.goals)) data.goals = [];
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
      el('span', { class: 'goal-empty-icon', html: Icons.target }),
      el('h3', { text: 'Set your first goal' }),
      el('p', { class: 'card-sub', text: 'Goals fill in by themselves from your tasks, habits, prayers and Quran reading, and tell you if you’re on pace.' }),
      el('div', { class: 'quick goal-suggestions' }, suggestions().map((s) => el('button', {
        type: 'button', class: 'chip', text: s.label, onclick: () => openForm(null, s.goal),
      }))),
      el('button', { type: 'button', class: 'btn primary small', text: 'Make my own', onclick: () => openForm() }));
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

  // ---------- render ----------
  function render() {
    const sections = [];
    if (!data.goals.length) sections.push(emptyCard());
    let done = 0;
    for (const kind of ['week', 'month']) {
      const goals = data.goals.filter((g) => g.period === kind);
      if (!goals.length) continue;
      const p = period(kind);
      done += goals.filter((g) => progress(g).state === 'done').length;
      const label = kind === 'week' ? 'This week' : Dates.parse(p.start).toLocaleDateString(undefined, { month: 'long' });
      sections.push(el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', { text: label }), el('span', { class: 'card-sub', text: `${plural(p.daysLeft, 'day')} left` })),
        el('ul', { class: 'goal-list' }, goals.map(goalItem))));
    }
    sections.push(attentionCard(), compareCard());
    $('#goals-body').replaceChildren(...sections);
    $('#goals-stats').textContent = data.goals.length ? `${done} of ${data.goals.length} reached` : '';
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
    $('#goal-form-title').textContent = goal ? 'Edit goal' : 'New goal';
    $('#g-submit').textContent = goal ? 'Save' : 'Add goal';
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
    Toast.show('Goal deleted', () => {
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

  return { init, render, openForm, checkReached, progress, attention, list: () => data.goals };
})();
