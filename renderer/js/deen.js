// Deen tab: prayers marked today and this week, Quran reading progress, a tasbih counter,
// Qibla direction and upcoming Islamic dates.
const Deen = (() => {
  const KEY = 'todo-widget.deen';
  const TOTAL_PAGES = 604;
  const PHRASES = ['SubhanAllah', 'Alhamdulillah', 'Allahu Akbar', 'Astaghfirullah', 'La ilaha illallah', 'Salawat'];
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const EVENTS = [
    { month: 9, day: 1, name: 'Ramadan begins', icon: '🌙' },
    { month: 10, day: 1, name: 'Eid al-Fitr', icon: '🎉' },
    { month: 12, day: 9, name: 'Day of Arafah', icon: '🤲' },
    { month: 12, day: 10, name: 'Eid al-Adha', icon: '🐑' },
    { month: 1, day: 1, name: 'Islamic New Year', icon: '📅' },
    { month: 1, day: 10, name: 'Ashura', icon: '🕊️' },
  ];

  let data = mergeDefaults(
    {
      quran: { page: 0, khatams: 0, goalDate: '', log: {} },
      tasbih: { phrase: PHRASES[0], target: 33, day: '', counts: {}, totals: {} },
    },
    Store.get(KEY, {}),
  );
  let selectedDay = null; // a past prayer day picked in the week strip; null means today
  let datesCache = { day: null, tz: null, items: [] };
  const save = () => Store.set(KEY, data);
  const relative = (days) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`);

  // ---------- prayers ----------
  function renderPrayers() {
    const today = Prayer.todayKey();
    const day = selectedDay || today;
    const times = Prayer.timesFor(day);
    const now = Date.now();
    const count = Prayer.prayedCount(day);
    const dayName = day === today ? 'today' : Dates.parse(day).toLocaleDateString(undefined, { weekday: 'long' });
    $('#deen-prayed-count').textContent = `${count}/5 prayed ${dayName}`;
    $('#deen-stats').textContent = `${Prayer.prayedCount(today)}/5 prayed today`;

    $('#deen-prayers').replaceChildren(...Prayer.FIVE.map((p) => {
      const done = Prayer.isPrayed(day, p.key);
      const at = times?.[p.key];
      const upcoming = day === today && at && at > now;
      let status = 'Not marked';
      if (done) status = 'Prayed';
      else if (upcoming) status = 'Upcoming';
      else if (day === today) status = 'Not yet';
      return el('li', { class: `deen-prayer${done ? ' done' : ''}` },
        el('button', {
          type: 'button',
          class: 'deen-check',
          html: Icons.check,
          disabled: upcoming && !done,
          'aria-pressed': String(done),
          'aria-label': `${p.label}: ${status}`,
          title: done ? 'Prayed (click to undo)' : upcoming ? 'Not time yet' : 'Mark as prayed',
          onclick: () => Prayer.setPrayed(day, p.key, !done),
        }),
        el('span', { class: 'deen-prayer-name', text: p.label }),
        el('span', { class: 'deen-prayer-time', text: at ? Prayer.formatTime(at) : '' }),
        el('span', { class: 'deen-prayer-status', text: status }));
    }));

    const days = [6, 5, 4, 3, 2, 1, 0].map((n) => Prayer.shiftKey(today, -n));
    $('#deen-week').replaceChildren(...days.map((k) => {
      const c = Prayer.prayedCount(k);
      const date = Dates.parse(k);
      return el('button', {
        type: 'button',
        class: `deen-day${k === day ? ' selected' : ''}`,
        title: `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${c}/5 prayed`,
        onclick: () => {
          selectedDay = k === today ? null : k;
          renderPrayers();
        },
      },
      el('span', { text: k === today ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' }) }),
      el('span', { class: 'deen-dots' }, Prayer.FIVE.map((p) => el('i', { class: Prayer.isPrayed(k, p.key) ? 'on' : null }))));
    }));
  }

  // ---------- Quran ----------
  const juzOf = (page) => (page < 22 ? 1 : Math.min(30, Math.floor((page - 22) / 20) + 2));

  function addPages(n) {
    const q = data.quran;
    let page = q.page + n;
    let finished = false;
    while (page >= TOTAL_PAGES) {
      page -= TOTAL_PAGES;
      q.khatams++;
      finished = true;
    }
    q.page = Math.max(0, page);
    const today = Dates.key();
    q.log[today] = Math.max(0, (q.log[today] || 0) + n);
    if (!q.log[today]) delete q.log[today];
    save();
    renderQuran();
    if (finished) Toast.show('Khatam complete. Alhamdulillah!');
  }

  function renderQuran() {
    const q = data.quran;
    $('#quran-page').textContent = q.page ? `Page ${q.page} of ${TOTAL_PAGES}` : 'Not started yet';
    $('#quran-juz').textContent = q.page ? `Juz ${juzOf(q.page)}${q.khatams ? ` · ${q.khatams} khatam${q.khatams === 1 ? '' : 's'} done` : ''}` : 'Use the buttons as you read';
    $('#quran-bar').style.setProperty('--w', `${(q.page / TOTAL_PAGES) * 100}%`);

    const readToday = q.log[Dates.key()] || 0;
    let note = `${readToday} page${readToday === 1 ? '' : 's'} read today.`;
    if (q.goalDate) {
      const daysLeft = Math.round((Dates.parse(q.goalDate) - Dates.parse(Dates.key())) / 86400000) + 1;
      const remaining = TOTAL_PAGES - q.page;
      const goalLabel = Dates.parse(q.goalDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      note += daysLeft > 0
        ? ` About ${Math.ceil(remaining / daysLeft)} pages a day to finish by ${goalLabel}.`
        : ` Your goal date (${goalLabel}) has passed. Set a new one in Edit.`;
    }
    $('#quran-note').textContent = note;
  }

  function openQuranForm() {
    $('#q-page').value = data.quran.page;
    $('#q-khatams').value = data.quran.khatams;
    $('#q-goal').value = data.quran.goalDate;
    Sheet.open($('#quran-form'));
    $('#q-page').focus();
  }

  // ---------- tasbih ----------
  function tasbihToday() {
    const t = data.tasbih;
    const today = Dates.key();
    if (t.day !== today) {
      t.day = today;
      t.counts = {};
    }
    return t;
  }

  function renderTasbih() {
    const t = tasbihToday();
    const count = t.counts[t.phrase] || 0;
    $('#tasbih-phrases').replaceChildren(...PHRASES.map((phrase) => el('button', {
      type: 'button',
      class: `chip${phrase === t.phrase ? ' selected' : ''}`,
      text: phrase,
      onclick: () => {
        t.phrase = phrase;
        save();
        renderTasbih();
      },
    })));
    $('#tasbih-count').textContent = String(count);
    $('#tasbih-target').textContent = t.target ? `of ${t.target} · ${t.phrase}` : t.phrase;
    $('#tasbih-btn').style.setProperty('--p', t.target ? Math.min(1, count / t.target) : 0);
    $('#tasbih-btn').classList.toggle('complete', !!t.target && count >= t.target);
    $('#tasbih-goal').value = String(t.target);
    $('#tasbih-today').textContent = `${t.totals[t.day] || 0} today`;
  }

  function countTasbih() {
    const t = tasbihToday();
    t.counts[t.phrase] = (t.counts[t.phrase] || 0) + 1;
    t.totals[t.day] = (t.totals[t.day] || 0) + 1;
    save();
    renderTasbih();
  }

  // ---------- Qibla ----------
  function renderQibla() {
    const bearing = Prayer.qibla();
    const loc = Settings.data.prayer.location;
    if (bearing == null || !loc) {
      $('#qibla-deg').textContent = 'Location needed';
      $('#qibla-hint').textContent = 'Set your location in Settings to see the Qibla direction.';
      $('#qibla-dial').style.setProperty('--deg', '0deg');
      return;
    }
    $('#qibla-deg').textContent = `${Math.round(bearing)}° ${COMPASS[Math.round(bearing / 22.5) % 16]}`;
    $('#qibla-hint').textContent = `From ${loc.name}, measured clockwise from north. Use a phone compass to find north.`;
    $('#qibla-dial').style.setProperty('--deg', `${bearing}deg`);
  }

  // ---------- upcoming dates ----------
  function hijriParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', timeZone }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return { day: get('day'), month: get('month') };
  }

  function upcomingDates() {
    const today = Dates.key();
    const tz = Prayer.timeZone();
    if (datesCache.day === today && datesCache.tz === tz) return datesCache.items;

    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const found = new Map();
    let jumuah = null;
    let whiteDays = null;
    for (let i = 0; i < 400; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (jumuah === null && d.getDay() === 5) jumuah = i;
      let h;
      try {
        h = hijriParts(d, tz);
      } catch {
        break;
      }
      if (whiteDays === null && h.day === 13) whiteDays = i;
      for (const ev of EVENTS) {
        if (!found.has(ev.name) && h.month === ev.month && h.day === ev.day) found.set(ev.name, { ...ev, offset: i });
      }
      if (found.size === EVENTS.length && jumuah !== null && whiteDays !== null) break;
    }

    const items = [...found.values()];
    if (jumuah !== null) items.push({ name: "Jumu'ah", icon: '🕌', offset: jumuah });
    if (whiteDays !== null) items.push({ name: 'White days (13–15) fasting', icon: '🌕', offset: whiteDays });
    items.sort((a, b) => a.offset - b.offset);
    for (const item of items) {
      const d = new Date(start);
      d.setDate(start.getDate() + item.offset);
      item.dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    datesCache = { day: today, tz, items };
    return items;
  }

  function renderDates() {
    $('#deen-dates').replaceChildren(...upcomingDates().map((item) => el('li', { class: 'deen-date' },
      el('span', { class: 'deen-date-icon', text: item.icon }),
      el('span', { class: 'deen-date-name' }, item.name, el('span', { class: 'deen-date-when', text: item.dateLabel })),
      el('span', { class: 'deen-date-rel', text: relative(item.offset) }))));
  }

  // ---------- used by Stats ----------
  const pagesIn = (keys) => keys.reduce((sum, k) => sum + (data.quran.log[k] || 0), 0);
  const dhikrIn = (keys) => keys.reduce((sum, k) => sum + (data.tasbih.totals[k] || 0), 0);

  function render() {
    renderPrayers();
    renderQuran();
    renderTasbih();
    renderQibla();
    renderDates();
  }

  function init() {
    for (const btn of $$('[data-pages]')) btn.addEventListener('click', () => addPages(Number(btn.dataset.pages)));
    $('#quran-edit').addEventListener('click', openQuranForm);
    $('#q-cancel').addEventListener('click', () => Sheet.close());
    $('#quran-form').addEventListener('submit', (e) => {
      e.preventDefault();
      data.quran.page = Math.min(TOTAL_PAGES, Math.max(0, Math.round(Number($('#q-page').value) || 0)));
      data.quran.khatams = Math.max(0, Math.round(Number($('#q-khatams').value) || 0));
      data.quran.goalDate = $('#q-goal').value;
      save();
      Sheet.close();
      renderQuran();
    });

    $('#tasbih-btn').addEventListener('click', countTasbih);
    $('#tasbih-goal').addEventListener('change', (e) => {
      data.tasbih.target = Number(e.target.value);
      save();
      renderTasbih();
    });
    $('#tasbih-reset').addEventListener('click', () => {
      const t = tasbihToday();
      t.counts[t.phrase] = 0;
      save();
      renderTasbih();
    });
  }

  return { init, render, renderPrayers, pagesIn, dhikrIn };
})();
