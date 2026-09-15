// Islamic prayer times card. Times are calculated in the main process with the adhan library.
// Prayers can be marked as prayed here (tap a prayer) or in the Deen tab.
const Prayer = (() => {
  const PRAYERS = [
    { key: 'fajr', label: 'Fajr' },
    { key: 'sunrise', label: 'Sunrise', notPrayer: true },
    { key: 'dhuhr', label: 'Dhuhr' },
    { key: 'asr', label: 'Asr' },
    { key: 'maghrib', label: 'Maghrib' },
    { key: 'isha', label: 'Isha' },
  ];
  const FIVE = PRAYERS.filter((p) => !p.notPrayer);
  const PRAYED_KEY = 'todo-widget.prayed';

  const METHODS = [
    ['MuslimWorldLeague', 'Muslim World League'],
    ['NorthAmerica', 'ISNA (North America)'],
    ['MoonsightingCommittee', 'Moonsighting Committee'],
    ['Egyptian', 'Egyptian General Authority'],
    ['UmmAlQura', 'Umm al-Qura (Makkah)'],
    ['Karachi', 'University of Islamic Sciences, Karachi'],
    ['Dubai', 'Dubai'],
    ['Kuwait', 'Kuwait'],
    ['Qatar', 'Qatar'],
    ['Singapore', 'Singapore, Malaysia, Indonesia'],
    ['Turkey', 'Diyanet (Turkey)'],
    ['Tehran', 'Institute of Geophysics, Tehran'],
  ];

  const COUNTRY_METHOD = {
    US: 'NorthAmerica', CA: 'NorthAmerica',
    GB: 'MoonsightingCommittee', IE: 'MoonsightingCommittee',
    SA: 'UmmAlQura', YE: 'UmmAlQura',
    EG: 'Egyptian', SD: 'Egyptian', LY: 'Egyptian', DZ: 'Egyptian', MA: 'Egyptian', TN: 'Egyptian', SY: 'Egyptian', LB: 'Egyptian', JO: 'Egyptian', IQ: 'Egyptian',
    PK: 'Karachi', IN: 'Karachi', BD: 'Karachi', AF: 'Karachi',
    AE: 'Dubai', OM: 'Dubai', BH: 'Dubai',
    KW: 'Kuwait', QA: 'Qatar',
    SG: 'Singapore', MY: 'Singapore', ID: 'Singapore', BN: 'Singapore',
    TR: 'Turkey', IR: 'Tehran',
  };
  const HANAFI_COUNTRIES = new Set(['PK', 'IN', 'BD', 'AF', 'TR']);

  let cache = { sig: null, days: {}, qibla: null };
  let pending = null;
  let prayed = Store.get(PRAYED_KEY, {});
  if (!prayed || typeof prayed !== 'object' || Array.isArray(prayed)) prayed = {};

  const location = () => Settings.data.prayer.location;
  const timeZone = () => location()?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const dateKeyIn = (tz, date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

  const todayKey = () => dateKeyIn(timeZone());

  function shiftKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }

  function signature() {
    const p = Settings.data.prayer;
    return p.location ? `${p.location.lat},${p.location.lon},${p.method},${p.madhab}` : null;
  }

  const timesFor = (day) => (cache.sig === signature() ? cache.days[day] || null : null);

  async function loadDays() {
    const sig = signature();
    if (!sig || !bridge) return;
    if (cache.sig !== sig) cache = { sig, days: {}, qibla: null };

    const today = todayKey();
    const needed = [shiftKey(today, -1), today, shiftKey(today, 1)];
    const missing = needed.filter((k) => !cache.days[k]);
    if (!missing.length) return;

    const { location: loc, method, madhab } = Settings.data.prayer;
    const results = await Promise.all(
      missing.map((date) => bridge.prayerTimes({ lat: loc.lat, lon: loc.lon, method, madhab, date })),
    );
    if (cache.sig !== sig) return; // settings changed while loading
    missing.forEach((k, i) => {
      cache.days[k] = results[i];
      cache.qibla = results[i].qibla;
    });
    for (const k of Object.keys(cache.days)) if (!needed.includes(k)) delete cache.days[k];
  }

  function refresh() {
    if (!pending) {
      pending = loadDays()
        .catch((err) => console.error('Prayer times failed:', err))
        .finally(() => { pending = null; });
    }
    return pending;
  }

  const formatTime = (ms) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone() });

  // "3:42" without AM/PM, for the compact row of times.
  const shortTime = (ms) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone() })
      .formatToParts(new Date(ms))
      .filter((p) => p.type !== 'dayPeriod')
      .map((p) => p.value)
      .join('')
      .trim();

  // Real prayers from yesterday through tomorrow, in order.
  function schedule() {
    const today = todayKey();
    const list = [];
    for (const day of [shiftKey(today, -1), today, shiftKey(today, 1)]) {
      const times = cache.days[day];
      if (!times) continue;
      for (const p of FIVE) list.push({ ...p, at: times[p.key], day });
    }
    return list;
  }

  function countdown(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }

  // ---------- prayed ----------
  const isPrayed = (day, key) => !!prayed[day]?.[key];
  const prayedCount = (day) => FIVE.filter((p) => prayed[day]?.[p.key]).length;

  function setPrayed(day, key, value) {
    const entry = (prayed[day] ??= {});
    if (value) entry[key] = 1;
    else delete entry[key];
    if (!Object.keys(entry).length) delete prayed[day];
    Store.set(PRAYED_KEY, prayed);
    const habitId = Settings.data.prayer.linkedHabit;
    if (habitId) Habits.setFromPrayers(habitId, day, prayedCount(day));
    document.dispatchEvent(new CustomEvent('prayers-changed'));
  }

  // ---------- card ----------
  function showSetup(text) {
    $('#prayer-setup').hidden = false;
    $('#prayer-body').hidden = true;
    $('#prayer-setup-text').textContent = text;
    $('#prayer-setup-btn').hidden = !bridge;
  }

  function render() {
    $('#prayer').hidden = !Settings.data.prayer.showCard;
    const loc = location();
    if (!bridge) return showSetup('Prayer times are calculated in the desktop app.');
    if (!loc) return showSetup("Set your location to see today's prayer times.");

    const today = todayKey();
    const times = timesFor(today);
    if (!times || !cache.days[shiftKey(today, 1)]) {
      refresh().then(() => {
        if (cache.days[todayKey()]) render();
      });
      if (!times) return showSetup('Loading prayer times…');
    }

    $('#prayer-setup').hidden = true;
    $('#prayer-body').hidden = false;

    const now = Date.now();
    const list = schedule();
    const nextIndex = list.findIndex((p) => p.at > now);
    const next = list[nextIndex];
    let current = nextIndex > 0 ? list[nextIndex - 1] : null;
    // Fajr's time ends at sunrise; there's no current prayer between sunrise and Dhuhr.
    if (current?.key === 'fajr' && cache.days[current.day] && now >= cache.days[current.day].sunrise) current = null;

    $('#next-name').textContent = next ? next.label : '';
    $('#next-time').textContent = next ? formatTime(next.at) : '';
    $('#next-countdown').textContent = next ? countdown(next.at - now) : '';

    const shown = PRAYERS.filter((p) => Settings.data.prayer.showSunrise || !p.notPrayer);
    const row = $('#prayer-list');
    row.style.setProperty('--count', shown.length);
    row.replaceChildren(...shown.map((p) => {
      const at = times[p.key];
      const isNext = next && next.day === today && next.key === p.key;
      const isCurrent = current && current.day === today && current.key === p.key;
      const cls = [at <= now && !isCurrent ? 'passed' : '', isNext ? 'next' : '', isCurrent ? 'current' : ''].filter(Boolean).join(' ');
      if (p.notPrayer) {
        return el('li', { class: cls, title: `${p.label} ${formatTime(at)}` }, el('span', { text: p.label }), el('b', { text: shortTime(at) }));
      }
      const done = isPrayed(today, p.key);
      const canMark = done || at <= now;
      let title = `${p.label} at ${formatTime(at)}`;
      if (done) title = `${p.label}: prayed (click to undo)`;
      else if (canMark) title = `Mark ${p.label} as prayed`;
      return el('li', { class: `${cls}${done ? ' prayed' : ''}` },
        el('button', {
          type: 'button',
          class: 'prayer-btn',
          disabled: !canMark,
          'aria-pressed': String(done),
          title,
          onclick: () => setPrayed(today, p.key, !done),
        },
        el('span', { text: p.label }),
        el('b', { text: shortTime(at) }),
        el('i', { class: 'prayed-mark', html: done ? Icons.check : '' })));
    }));

    const methodLabel = METHODS.find(([k]) => k === Settings.data.prayer.method)?.[1] ?? '';
    const place = [loc.name, loc.country].filter(Boolean).join(', ');
    $('#prayer-loc').replaceChildren(el('span', { class: 'inline-icon', html: Icons.location }), place);
    $('#prayer-loc').title = `${place} · ${methodLabel}`;

    const collapsed = !!Settings.data.prayer.collapsed;
    $('#prayer').classList.toggle('collapsed', collapsed);
    $('#prayer-head').setAttribute('aria-expanded', String(!collapsed));
  }

  function reminders() {
    const loc = location();
    if (!loc) return [];
    const n = Settings.data.notifications;
    const before = n.prayerBefore || 0;
    return schedule()
      .filter((p) => n.prayers[p.key] && !isPrayed(p.day, p.key))
      .map((p) => ({
        key: `prayer:${p.day}:${p.key}:${before}`,
        at: p.at - before * 60000,
        title: before ? `${p.label} in ${before} minutes` : `It's time for ${p.label}`,
        body: `${p.label} at ${formatTime(p.at)} · ${loc.name}`,
      }));
  }

  function hijriDate() {
    try {
      return new Intl.DateTimeFormat('en-GB-u-ca-islamic-umalqura', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone(),
      }).format(new Date());
    } catch {
      return '';
    }
  }

  function suggestMethod(countryCode) {
    const key = COUNTRY_METHOD[countryCode] || 'MuslimWorldLeague';
    return { key, label: METHODS.find(([k]) => k === key)[1], hanafi: HANAFI_COUNTRIES.has(countryCode) };
  }

  function init() {
    $('#prayer-head').addEventListener('click', () => Settings.set('prayer.collapsed', !Settings.data.prayer.collapsed));
    $('#prayer-setup-btn').addEventListener('click', () => SettingsPanel.open('set-prayer'));
    $('#prayer-change').addEventListener('click', () => SettingsPanel.open('set-prayer'));
  }

  return {
    init,
    render,
    refresh,
    reminders,
    hijriDate,
    suggestMethod,
    METHODS,
    FIVE,
    qibla: () => cache.qibla,
    todayKey,
    timesFor,
    shiftKey,
    timeZone,
    formatTime,
    isPrayed,
    prayedCount,
    setPrayed,
  };
})();
