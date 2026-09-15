// Stats tab: a look back over the last 7 days or this month.
const Stats = (() => {
  let range = 'week';

  function rangeKeys() {
    const today = Dates.key();
    if (range === 'week') return [6, 5, 4, 3, 2, 1, 0].map((n) => Dates.offsetKey(-n));
    const now = new Date();
    return Dates.range(Dates.key(new Date(now.getFullYear(), now.getMonth(), 1)), today);
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  const tile = (label, value, sub) => el('div', { class: 'stat-tile' },
    el('span', { class: 'stat-label', text: label }),
    el('b', { class: 'stat-value', text: value }),
    sub ? el('span', { class: 'stat-sub', text: sub }) : null);

  const barRow = (label, fraction, valueText, hue) => el('li', { class: 'bar-row', style: hue != null ? { '--h': hue } : null },
    el('span', { class: 'bar-label', text: label }),
    el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: { '--w': `${Math.round(Math.min(1, fraction) * 100)}%` } })),
    el('span', { class: 'bar-value', text: valueText }));

  const card = (title, ...children) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: title })), ...children);

  const empty = (text) => el('p', { class: 'stats-empty', text });

  function render() {
    const keys = rangeKeys();
    const inRange = new Set(keys);
    const today = Dates.key();
    const showDeen = Settings.data.tabs.deen;

    const tasks = Tasks.list();
    const doneTasks = tasks.filter((t) => t.done && t.completedAt && inRange.has(Dates.key(new Date(t.completedAt))));
    const habits = Habits.statsFor(keys);
    const habitMet = habits.reduce((s, h) => s + h.met, 0);
    const habitPossible = habits.reduce((s, h) => s + h.days, 0);
    const prayed = keys.reduce((s, k) => s + Prayer.prayedCount(k), 0);
    const notesWritten = Journal.list().filter((n) => inRange.has(Dates.key(new Date(n.createdAt)))).length;

    const tiles = el('div', { class: 'stat-tiles' },
      tile('Tasks done', String(doneTasks.length), `${tasks.filter((t) => !t.done).length} still open`),
      tile('Habits', habits.length ? `${pct(habitMet, habitPossible)}%` : '–', habits.length ? `${habitMet} of ${habitPossible} goals met` : 'No habits yet'),
      showDeen ? tile('Prayers', `${prayed}/${keys.length * 5}`, `${pct(prayed, keys.length * 5)}% marked prayed`) : null,
      tile('Journal', String(notesWritten), `note${notesWritten === 1 ? '' : 's'} written`),
      showDeen ? tile('Quran', String(Deen.pagesIn(keys)), 'pages read') : null,
      showDeen ? tile('Dhikr', String(Deen.dhikrIn(keys)), 'counted') : null);

    // Activity chart: tasks finished and share of habits met, per day.
    const perDay = keys.map((k) => ({
      k,
      tasks: doneTasks.filter((t) => Dates.key(new Date(t.completedAt)) === k).length,
      habits: Habits.metCountOn(k),
    }));
    const maxTasks = Math.max(1, ...perDay.map((d) => d.tasks));
    const chart = el('div', { class: `chart${range === 'month' ? ' dense' : ''}` }, perDay.map((d, i) => {
      const date = Dates.parse(d.k);
      let label = '';
      if (range === 'week') label = date.toLocaleDateString(undefined, { weekday: 'narrow' });
      else if (i === 0 || date.getDate() % 5 === 0 || d.k === today) label = String(date.getDate());
      return el('div', {
        class: 'chart-col',
        title: `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.tasks} task${d.tasks === 1 ? '' : 's'} done, ${d.habits}/${habits.length} habits`,
      },
      el('div', { class: 'chart-bars' },
        el('span', { class: 'bar tasks', style: { '--v': d.tasks / maxTasks } }),
        el('span', { class: 'bar habits', style: { '--v': habits.length ? d.habits / habits.length : 0 } })),
      el('span', { class: 'chart-label', text: label }));
    }));
    const legend = el('div', { class: 'legend' },
      el('span', {}, el('i', { class: 'bar tasks' }), 'Tasks done'),
      el('span', {}, el('i', { class: 'bar habits' }), 'Habits met'));

    const habitCard = card('Habits',
      habits.length
        ? el('ul', { class: 'bar-rows' }, habits.map((h) => barRow(
          `${h.emoji ? `${h.emoji} ` : ''}${h.name}`,
          h.days ? h.met / h.days : 0,
          h.type === 'count' ? `${Math.round(h.total * 100) / 100}${h.unit ? ` ${h.unit}` : ''}` : `${h.met}/${h.days}`,
          h.hue,
        )))
        : empty('Add habits to see how you are doing.'));

    const prayerCard = showDeen ? card('Prayers marked',
      el('ul', { class: 'bar-rows' }, Prayer.FIVE.map((p) => {
        const count = keys.filter((k) => Prayer.isPrayed(k, p.key)).length;
        return barRow(p.label, count / keys.length, `${count}/${keys.length}`, 150);
      }))) : null;

    const byCategory = new Map();
    for (const t of doneTasks) byCategory.set(t.category || 'No category', (byCategory.get(t.category || 'No category') || 0) + 1);
    const categories = [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const categoryCard = card('Tasks done by category',
      categories.length
        ? el('ul', { class: 'bar-rows' }, categories.map(([name, count]) => barRow(name, count / categories[0][1], String(count), name === 'No category' ? 240 : hueFor(name))))
        : empty(range === 'week' ? 'No tasks finished in the last 7 days.' : 'No tasks finished this month yet.'));

    $('#stats-body').replaceChildren(tiles, card(range === 'week' ? 'Last 7 days' : 'This month', chart, legend), habitCard, prayerCard, categoryCard);
  }

  function init() {
    for (const chip of $$('#stats-range .chip')) {
      chip.addEventListener('click', () => {
        range = chip.dataset.range;
        $$('#stats-range .chip').forEach((c) => c.classList.toggle('selected', c === chip));
        render();
      });
    }
  }

  return { init, render };
})();
