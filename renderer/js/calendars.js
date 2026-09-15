// Linked calendars: reads calendar links (.ics or webcal://) from Google Calendar, Outlook, Apple iCloud,
// Canvas or anything else that publishes one, and adds upcoming events and deadlines to Tasks.
// Nothing happens unless a link is added in Settings.
const Calendars = (() => {
  const KEY = 'todo-widget.calendars';
  const LEGACY_CANVAS_KEY = 'todo-widget.canvas';
  const SYNC_EVERY_MS = 3 * 60 * 60 * 1000;
  const DAY_MS = 86400000;
  const MIN_EVENT_MS = 30 * 60 * 1000;
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const PROVIDERS = {
    canvas: { name: 'Canvas', kind: 'todo' },
    google: { name: 'Google Calendar', kind: 'event' },
    outlook: { name: 'Outlook', kind: 'event' },
    apple: { name: 'iCloud Calendar', kind: 'event' },
    other: { name: 'Calendar', kind: 'event' },
  };
  // Outlook feeds often name time zones the Windows way.
  const WINDOWS_ZONES = {
    'Hawaiian Standard Time': 'Pacific/Honolulu',
    'Alaskan Standard Time': 'America/Anchorage',
    'Pacific Standard Time': 'America/Los_Angeles',
    'US Mountain Standard Time': 'America/Phoenix',
    'Mountain Standard Time': 'America/Denver',
    'Central Standard Time': 'America/Chicago',
    'Canada Central Standard Time': 'America/Regina',
    'Eastern Standard Time': 'America/New_York',
    'Atlantic Standard Time': 'America/Halifax',
    'E. South America Standard Time': 'America/Sao_Paulo',
    'UTC': 'UTC',
    'GMT Standard Time': 'Europe/London',
    'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris',
    'Central Europe Standard Time': 'Europe/Budapest',
    'Central European Standard Time': 'Europe/Warsaw',
    'GTB Standard Time': 'Europe/Bucharest',
    'FLE Standard Time': 'Europe/Kiev',
    'Turkey Standard Time': 'Europe/Istanbul',
    'Israel Standard Time': 'Asia/Jerusalem',
    'Egypt Standard Time': 'Africa/Cairo',
    'South Africa Standard Time': 'Africa/Johannesburg',
    'Morocco Standard Time': 'Africa/Casablanca',
    'Jordan Standard Time': 'Asia/Amman',
    'Arab Standard Time': 'Asia/Riyadh',
    'Arabian Standard Time': 'Asia/Dubai',
    'Russian Standard Time': 'Europe/Moscow',
    'Iran Standard Time': 'Asia/Tehran',
    'Afghanistan Standard Time': 'Asia/Kabul',
    'Pakistan Standard Time': 'Asia/Karachi',
    'India Standard Time': 'Asia/Kolkata',
    'Sri Lanka Standard Time': 'Asia/Colombo',
    'Nepal Standard Time': 'Asia/Kathmandu',
    'Bangladesh Standard Time': 'Asia/Dhaka',
    'SE Asia Standard Time': 'Asia/Bangkok',
    'Singapore Standard Time': 'Asia/Singapore',
    'China Standard Time': 'Asia/Shanghai',
    'W. Australia Standard Time': 'Australia/Perth',
    'Korea Standard Time': 'Asia/Seoul',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'AUS Eastern Standard Time': 'Australia/Sydney',
    'New Zealand Standard Time': 'Pacific/Auckland',
  };

  let data = mergeDefaults({ auto: true, daysAhead: 30, list: [] }, Store.get(KEY, {}));
  if (!Array.isArray(data.list)) data.list = [];
  const syncing = new Set();
  let confirmingId = null;
  let nameEdited = false;
  let kindEdited = false;
  const save = () => Store.set(KEY, data);
  const find = (id) => data.list.find((c) => c.id === id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------- reading .ics files ----------
  const unescapeText = (value) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

  const DATE_PROPS = new Set(['DTSTART', 'DTEND', 'DUE', 'EXDATE', 'RDATE', 'RECURRENCE-ID']);

  // One content line, e.g.  DTSTART;TZID=America/Phoenix:20260915T090000
  function parseLine(line) {
    let quoted = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ':' && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) return null;
    // Dates never contain a colon, so an unquoted zone name like "(UTC-07:00) Arizona" can't cut them short.
    if (DATE_PROPS.has(line.slice(0, colon).split(';')[0].toUpperCase())) colon = line.lastIndexOf(':');
    const [name, ...paramParts] = line.slice(0, colon).split(';');
    const params = {};
    for (const part of paramParts) {
      const eq = part.indexOf('=');
      if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
  }

  function parseIcs(text) {
    // Long lines are "folded" onto the next line starting with a space.
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let name = '';
    let current = null;
    let nested = 0; // depth inside blocks within an event, like reminders (VALARM)
    for (const line of lines) {
      if (/^BEGIN:/i.test(line)) {
        if (/^BEGIN:VEVENT$/i.test(line)) {
          current = {};
          nested = 0;
        } else if (current) nested++;
        continue;
      }
      if (/^END:/i.test(line)) {
        if (/^END:VEVENT$/i.test(line)) {
          if (current) events.push(current);
          current = null;
        } else if (current) nested = Math.max(0, nested - 1);
        continue;
      }
      const prop = parseLine(line);
      if (!prop) continue;
      if (!current) {
        if (prop.name === 'X-WR-CALNAME' && !name) name = unescapeText(prop.value).trim();
      } else if (!nested) {
        (current[prop.name] ??= []).push(prop);
      }
    }
    return { events, name };
  }

  const first = (ev, name) => ev[name]?.[0] ?? null;
  const value = (ev, name) => ev[name]?.[0]?.value ?? '';

  // ---------- dates and time zones ----------
  const zoneCache = new Map();
  function resolveZone(tzid) {
    if (!tzid) return null;
    if (zoneCache.has(tzid)) return zoneCache.get(tzid);
    const clean = tzid.replace(/^\/+/, '').trim();
    let zone = null;
    for (const candidate of [clean, WINDOWS_ZONES[clean]]) {
      if (!candidate) continue;
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        zone = candidate;
        break;
      } catch {}
    }
    // Names like "(UTC-07:00) Arizona": use the fixed offset.
    const fixed = !zone && /(?:UTC|GMT)\s*([+-])(\d{1,2}):?(\d{2})?/i.exec(clean);
    if (fixed) zone = (fixed[1] === '-' ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3] || 0));
    zoneCache.set(tzid, zone);
    return zone;
  }

  const formatters = new Map();
  function zoneOffsetMs(ms, zone) {
    let f = formatters.get(zone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      formatters.set(zone, f);
    }
    const p = {};
    for (const part of f.formatToParts(new Date(ms))) p[part.type] = Number(part.value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  // A clock time in a calendar's zone -> a moment. `zone` is an IANA name, a fixed offset in minutes,
  // or null for this computer's own zone.
  function wallToMs(w, zone) {
    if (zone == null) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    if (typeof zone === 'number') return asUtc - zone * 60000;
    return asUtc - zoneOffsetMs(asUtc - zoneOffsetMs(asUtc, zone), zone);
  }

  function parseWhen(prop) {
    if (!prop) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(prop.value).trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, s, utc] = m;
    if (!h || prop.params?.VALUE === 'DATE') {
      return { allDay: true, wall: { y: +y, mo: +mo, d: +d, h: 0, mi: 0, s: 0 }, zone: null, ms: new Date(+y, +mo - 1, +d).getTime() };
    }
    const wall = { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +(s || 0) };
    const zone = utc ? 'UTC' : resolveZone(prop.params?.TZID);
    return { allDay: false, wall, zone, ms: wallToMs(wall, zone) };
  }

  function parseDuration(text) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(text).trim());
    if (!m) return 0;
    const [, sign, w, d, h, mi, s] = m;
    const ms = (((+w || 0) * 7 + (+d || 0)) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
    return sign === '-' ? -ms : ms;
  }

  // ---------- repeating events ----------
  // Calendar days are counted as UTC midnights so daylight saving never shifts a date.
  const utcDay = (y, mo, d) => Date.UTC(y, mo - 1, d);
  const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

  function parseRule(text) {
    const rule = {};
    for (const part of text.split(';')) {
      const [k, v] = part.split('=');
      if (k && v) rule[k.trim().toUpperCase()] = v.trim().toUpperCase();
    }
    return rule;
  }

  // The days of one month matched by BYMONTHDAY / BYDAY (e.g. 2TU, -1FR) / BYSETPOS, or the start's day.
  function monthDays(y, mo, rule, startDay) {
    const total = daysInMonth(y, mo);
    let days;
    if (rule.BYMONTHDAY) {
      days = rule.BYMONTHDAY.split(',').map(Number).map((n) => (n < 0 ? total + n + 1 : n)).filter((n) => n >= 1 && n <= total);
    } else if (rule.BYDAY) {
      days = [];
      for (const code of rule.BYDAY.split(',')) {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(code);
        if (!m) continue;
        const weekday = DAY_CODES.indexOf(m[2]);
        const matches = [];
        for (let n = 1; n <= total; n++) if (new Date(utcDay(y, mo, n)).getUTCDay() === weekday) matches.push(n);
        const nth = Number(m[1] || 0);
        if (!nth) days.push(...matches);
        else {
          const pick = nth > 0 ? matches[nth - 1] : matches[matches.length + nth];
          if (pick) days.push(pick);
        }
      }
    } else {
      days = startDay <= total ? [startDay] : [];
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    if (rule.BYSETPOS) {
      days = rule.BYSETPOS.split(',').map(Number).map((pos) => (pos > 0 ? days[pos - 1] : days[days.length + pos])).filter(Boolean);
    }
    return days.map((n) => utcDay(y, mo, n));
  }

  // Start times of a repeating event up to the end of the import window.
  function expand(start, rule, windowStartMs, windowEndMs) {
    const freq = rule.FREQ;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [start.ms];
    const interval = Math.max(1, Number(rule.INTERVAL) || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    const until = rule.UNTIL ? parseWhen({ value: rule.UNTIL, params: {} }) : null;
    const untilMs = until ? (until.allDay ? until.ms + DAY_MS - 1 : until.ms) : Infinity;
    const byMonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
    const byWeekday = rule.BYDAY ? rule.BYDAY.split(',').map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((d) => d >= 0) : null;
    const wkst = Math.max(0, DAY_CODES.indexOf(rule.WKST || 'MO'));
    const s = start.wall;
    const base = utcDay(s.y, s.mo, s.d);
    const toMs = (day) => {
      const d = new Date(day);
      const wall = { ...s, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
      return start.allDay ? new Date(wall.y, wall.mo - 1, wall.d).getTime() : wallToMs(wall, start.zone);
    };

    let period = 0;
    // Without a COUNT, jump close to the window instead of walking through years of old repeats.
    if (count === Infinity && (freq === 'DAILY' || freq === 'WEEKLY')) {
      const step = (freq === 'DAILY' ? 1 : 7) * interval * DAY_MS;
      period = Math.max(0, Math.floor((windowStartMs - 8 * DAY_MS - base) / step));
    }

    const out = [];
    let produced = 0;
    for (let guard = 0; guard < 5000; guard++, period++) {
      let days;
      if (freq === 'DAILY') {
        days = [base + period * interval * DAY_MS];
        if (byWeekday) days = days.filter((d) => byWeekday.includes(new Date(d).getUTCDay()));
      } else if (freq === 'WEEKLY') {
        const firstWeekStart = base - ((new Date(base).getUTCDay() - wkst + 7) % 7) * DAY_MS;
        const weekStart = firstWeekStart + period * interval * 7 * DAY_MS;
        const weekdays = byWeekday?.length ? byWeekday : [new Date(base).getUTCDay()];
        days = weekdays.map((wd) => weekStart + ((wd - wkst + 7) % 7) * DAY_MS).sort((a, b) => a - b);
      } else if (freq === 'MONTHLY') {
        const monthIndex = s.mo - 1 + period * interval;
        days = monthDays(s.y + Math.floor(monthIndex / 12), (monthIndex % 12) + 1, rule, s.d);
      } else {
        const y = s.y + period * interval;
        days = (byMonth || [s.mo]).flatMap((mo) => monthDays(y, mo, rule, s.d));
      }
      if (byMonth && freq !== 'YEARLY') days = days.filter((d) => byMonth.includes(new Date(d).getUTCMonth() + 1));

      let stop = false;
      for (const day of days) {
        if (day < base) continue;
        if (day > windowEndMs + DAY_MS) {
          stop = true;
          break;
        }
        produced++;
        if (produced > count) {
          stop = true;
          break;
        }
        if (untilMs === Infinity && day + 2 * DAY_MS < windowStartMs) continue; // long before the window
        const ms = toMs(day);
        if (ms > untilMs || ms > windowEndMs) {
          stop = true;
          break;
        }
        out.push(ms);
      }
      if (stop) break;
    }
    return out;
  }

  // Every event that overlaps the import window, with repeats expanded and one-off edits applied.
  function occurrences(events, windowStartMs, windowEndMs) {
    const edited = new Map(); // UID -> start times of repeats that were changed or cancelled individually
    for (const ev of events) {
      const rid = parseWhen(first(ev, 'RECURRENCE-ID'));
      if (!rid) continue;
      const uid = value(ev, 'UID').trim();
      if (!edited.has(uid)) edited.set(uid, new Set());
      edited.get(uid).add(rid.ms);
    }

    const out = [];
    for (const ev of events) {
      const uid = value(ev, 'UID').trim();
      const start = parseWhen(first(ev, 'DTSTART'));
      if (!uid || !start) continue;
      const end = parseWhen(first(ev, 'DTEND'));
      let duration = start.allDay ? DAY_MS : 0;
      if (end) duration = end.ms - start.ms;
      else if (ev.DURATION) duration = parseDuration(value(ev, 'DURATION'));
      duration = Math.max(0, duration);
      const cancelled = /^CANCELLED$/i.test(value(ev, 'STATUS').trim());
      const add = (startMs, key) => {
        if (!cancelled && startMs + duration > windowStartMs && startMs <= windowEndMs) {
          out.push({ key, ev, startMs, duration, allDay: start.allDay });
        }
      };

      const rid = parseWhen(first(ev, 'RECURRENCE-ID'));
      if (rid) {
        add(start.ms, `${uid}@${rid.ms}`);
        continue;
      }
      const rrule = value(ev, 'RRULE');
      if (!rrule) {
        add(start.ms, uid);
        continue;
      }
      const skip = new Set(edited.get(uid));
      for (const ex of ev.EXDATE || []) {
        for (const part of ex.value.split(',')) {
          const when = parseWhen({ value: part, params: ex.params });
          if (when) skip.add(when.ms);
        }
      }
      for (const ms of expand(start, parseRule(rrule), windowStartMs - duration, windowEndMs)) {
        if (!skip.has(ms)) add(ms, `${uid}@${ms}`);
      }
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  // ---------- turning events into tasks ----------
  // Canvas titles look like "Lab 3 Report [CHM 113 (2026 Fall)]"; the course code becomes the category.
  function splitSummary(summary) {
    const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
    if (!m) return { title: summary.trim(), course: '' };
    return { title: m[1].trim() || summary.trim(), course: m[2].replace(/\s*\(.*\)\s*$/, '').trim() };
  }

  function toTask(cal, o, today) {
    const summary = unescapeText(value(o.ev, 'SUMMARY')).trim() || (cal.kind === 'todo' ? 'Assignment' : 'Event');
    let title = summary;
    let category = cal.name;
    if (cal.provider === 'canvas') {
      const parts = splitSummary(summary);
      title = parts.title;
      category = parts.course || cal.name;
    }
    const start = new Date(o.startMs);
    let date = Dates.key(start);
    let time = o.allDay ? '' : `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    // An event that began before today and is still going (a trip, exam week) shows under today.
    if (cal.kind === 'event' && date < today) {
      date = today;
      time = '';
    }
    const url = value(o.ev, 'URL').trim();
    return {
      source: 'calendar',
      calendarId: cal.id,
      title: title.slice(0, 200),
      date,
      time,
      category: category.slice(0, 30),
      link: /^https:\/\//i.test(url) ? url : '',
      endAt: cal.kind === 'event' ? o.startMs + (o.allDay ? o.duration : Math.max(o.duration, MIN_EVENT_MS)) : null,
    };
  }

  async function sync(cal) {
    if (!bridge || syncing.has(cal.id)) return { ok: false };
    syncing.add(cal.id);
    renderList();
    try {
      const text = await bridge.fetchCalendar(cal.url);
      const { events, name } = parseIcs(text);
      // If no name was typed, use the calendar's own (e.g. "Holidays in United States").
      if (cal.autoName && name) cal.name = name.slice(0, 30);
      delete cal.autoName;
      const now = Date.now();
      const today = Dates.key();
      const todayStart = Dates.parse(today).getTime();
      // To-dos are kept from yesterday on, so recent overdue ones still show. Events only while they're on.
      const windowStart = cal.kind === 'todo' ? todayStart - DAY_MS : now;
      const windowEnd = Dates.parse(Dates.offsetKey(data.daysAhead + 1)).getTime() - 1;
      const relevant = cal.provider === 'canvas' ? events.filter((ev) => /assignment/i.test(value(ev, 'UID'))) : events;
      const found = occurrences(relevant, windowStart, windowEnd);

      const seen = new Set();
      let added = 0;
      let updated = 0;
      for (const o of found) {
        if (cal.deleted[o.key]) continue;
        const externalId = `${cal.id}:${o.key}`;
        seen.add(externalId);
        const result = Tasks.upsertExternal({ ...toTask(cal, o, today), externalId });
        if (result.created) added++;
        else if (result.changed) updated++;
      }
      // Items still to come that are no longer in the calendar (cancelled or moved) come off the list.
      const fromKey = Dates.key(new Date(windowStart));
      const removed = Tasks.removeWhere((t) => t.calendarId === cal.id && !t.done && !seen.has(t.externalId) && t.date >= fromKey);
      Tasks.commit();

      for (const [key, at] of Object.entries(cal.deleted)) {
        const startMs = Number(key.split('@')[1]);
        if ((startMs && startMs < now - 7 * DAY_MS) || at < now - 365 * DAY_MS) delete cal.deleted[key];
      }
      Object.assign(cal, { lastSync: now, lastError: '', count: found.length });
      save();
      return { ok: true, added, updated, removed };
    } catch (err) {
      cal.lastError = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      cal.lastSync = Date.now(); // don't retry every few seconds while it's failing
      save();
      return { ok: false, error: cal.lastError };
    } finally {
      syncing.delete(cal.id);
      renderList();
    }
  }

  function autoSync() {
    if (!data.auto) return;
    for (const cal of data.list) {
      if (Date.now() - cal.lastSync > SYNC_EVERY_MS) sync(cal);
    }
  }

  // Events that are over come off the task list on their own (to-dos stay until ticked).
  function cleanup() {
    const now = Date.now();
    Tasks.removeWhere((t) => t.source === 'calendar' && t.endAt && !t.done && t.endAt < now);
  }

  // Remember that an imported item was deleted, so the next sync doesn't bring it back.
  function forget(task, deleted) {
    const cal = find(task.calendarId);
    if (!cal || !task.externalId?.startsWith(`${cal.id}:`)) return;
    const key = task.externalId.slice(cal.id.length + 1);
    if (deleted) cal.deleted[key] = Date.now();
    else delete cal.deleted[key];
    save();
  }

  const nameOf = (id) => find(id)?.name || '';

  // The first version only had Canvas; carry its link and imported assignments over.
  function migrateCanvas() {
    const old = Store.get(LEGACY_CANVAS_KEY, null);
    if (!old) return;
    if (old.url && !find('canvas')) {
      const deleted = {};
      for (const [uidKey, info] of Object.entries(old.known || {})) if (info?.deleted) deleted[uidKey] = Date.now();
      data.list.push({
        id: 'canvas', name: 'Canvas', url: old.url, provider: 'canvas', kind: 'todo',
        lastSync: old.lastSync || 0, lastError: '', count: old.count || 0, deleted,
      });
      if (old.auto === false) data.auto = false;
      for (const t of Tasks.list()) {
        if (t.source === 'canvas' && t.externalId && !t.calendarId) {
          Object.assign(t, { source: 'calendar', calendarId: 'canvas', externalId: `canvas:${t.externalId}` });
        }
      }
      Tasks.commit();
    }
    save();
    Storage.removeItem(LEGACY_CANVAS_KEY);
  }

  // ---------- settings ----------
  function normalizeUrl(raw) {
    const url = String(raw).trim().replace(/^webcals?:\/\//i, 'https://');
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function providerOf(url) {
    const u = url.toLowerCase();
    if (/\/feeds\/calendars\//.test(u)) return 'canvas';
    if (u.includes('calendar.google.com') || u.includes('googleusercontent.com')) return 'google';
    if (/outlook\.|office365\.com|live\.com|hotmail\.com/.test(u)) return 'outlook';
    if (u.includes('icloud.com')) return 'apple';
    return 'other';
  }

  function ago(ms) {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${plural(Math.round(hours / 24), 'day')} ago`;
  }

  function statusOf(cal) {
    if (syncing.has(cal.id)) return { text: 'Syncing…' };
    if (cal.lastError) return { text: `Couldn’t sync: ${cal.lastError}`, warn: true };
    const kind = cal.kind === 'todo' ? 'To-dos' : 'Events';
    if (!cal.lastSync) return { text: kind };
    return { text: `${kind} · ${cal.count} coming up · synced ${ago(cal.lastSync)}` };
  }

  function unlink(cal, removeItems) {
    data.list = data.list.filter((c) => c.id !== cal.id);
    confirmingId = null;
    save();
    if (removeItems) {
      Tasks.removeWhere((t) => t.calendarId === cal.id && !t.done);
    }
    // Whatever stays behind becomes an ordinary task.
    for (const t of Tasks.list()) {
      if (t.calendarId !== cal.id) continue;
      delete t.calendarId;
      delete t.externalId;
      delete t.endAt;
      t.source = '';
    }
    Tasks.commit();
    renderList();
    Toast.show(`Unlinked ${cal.name}`);
  }

  function renderList() {
    const list = $('#cal-list');
    if (!list) return;
    list.replaceChildren(...data.list.map((cal) => {
      if (confirmingId === cal.id) {
        const open = Tasks.list().filter((t) => t.calendarId === cal.id && !t.done).length;
        return el('li', { class: 'cal-item confirm' },
          el('p', { class: 'restore-text', text: `Unlink “${cal.name}”?${open ? ` It has ${plural(open, 'open item')} in Tasks.` : ''}` }),
          el('div', { class: 'actions' },
            el('button', { type: 'button', class: 'btn ghost small', text: 'Cancel', onclick: () => { confirmingId = null; renderList(); } }),
            el('span', { class: 'spacer' }),
            open ? el('button', { type: 'button', class: 'btn ghost small', text: 'Keep them', onclick: () => unlink(cal, false) }) : null,
            el('button', { type: 'button', class: 'btn danger-solid small', text: open ? 'Remove them too' : 'Unlink', onclick: () => unlink(cal, true) })));
      }
      const status = statusOf(cal);
      return el('li', { class: 'cal-item' },
        el('span', { class: 'cal-icon', style: { '--h': hueFor(cal.name) }, html: Icons.calendar }),
        el('div', { class: 'cal-info' },
          el('b', { text: cal.name }),
          el('span', { class: `cal-status${status.warn ? ' warn' : ''}`, text: status.text })),
        el('button', {
          type: 'button', class: 'icon-btn sm', html: Icons.repeat, title: 'Sync now', 'aria-label': `Sync ${cal.name} now`,
          disabled: syncing.has(cal.id), onclick: () => sync(cal),
        }),
        el('button', {
          type: 'button', class: 'icon-btn sm del-cal', html: Icons.trash, title: 'Unlink', 'aria-label': `Unlink ${cal.name}`,
          onclick: () => { confirmingId = cal.id; renderList(); },
        }));
    }));
    list.hidden = data.list.length === 0;
  }

  function setMessage(text, warn = false) {
    $('#cal-msg').textContent = text;
    $('#cal-msg').hidden = !text;
    $('#cal-msg').classList.toggle('warn', warn);
  }

  function openForm() {
    $('#cal-form').hidden = false;
    $('#cal-add').hidden = true;
    $('#cal-url').value = '';
    $('#cal-name').value = '';
    $('#cal-kind').value = 'event';
    nameEdited = false;
    kindEdited = false;
    setMessage('');
    $('#cal-url').focus();
  }

  function closeForm() {
    $('#cal-form').hidden = true;
    $('#cal-add').hidden = false;
  }

  function onUrlInput() {
    const url = normalizeUrl($('#cal-url').value);
    const provider = url ? providerOf(url) : 'other';
    if (!nameEdited) $('#cal-name').value = url ? PROVIDERS[provider].name : '';
    if (!kindEdited) $('#cal-kind').value = PROVIDERS[provider].kind;
  }

  async function addCalendar() {
    const url = normalizeUrl($('#cal-url').value);
    if (!url) return setMessage('Paste a calendar link that starts with https:// or webcal://', true);
    if (data.list.some((c) => c.url === url)) return setMessage('That calendar is already linked.', true);
    const provider = providerOf(url);
    const cal = {
      id: uid().slice(0, 8),
      name: $('#cal-name').value.trim().slice(0, 30) || PROVIDERS[provider].name,
      autoName: provider !== 'canvas' && (!nameEdited || !$('#cal-name').value.trim()),
      url,
      provider,
      kind: $('#cal-kind').value === 'todo' ? 'todo' : 'event',
      lastSync: 0,
      lastError: '',
      count: 0,
      deleted: {},
    };
    $('#cal-save').disabled = true;
    setMessage('Reading the calendar…');
    data.list.push(cal);
    const result = await sync(cal);
    $('#cal-save').disabled = false;
    if (!result.ok) {
      data.list = data.list.filter((c) => c !== cal);
      save();
      renderList();
      return setMessage(`Couldn’t read that calendar. ${result.error || ''}`.trim(), true);
    }
    closeForm();
    Toast.show(`Linked ${cal.name}: ${plural(result.added, 'item')} added to Tasks`);
  }

  function syncUi() {
    if (!$('#cal-list')) return;
    $('#cal-auto').checked = !!data.auto;
    $('#cal-days').value = String(data.daysAhead);
    confirmingId = null;
    closeForm();
    renderList();
  }

  function init() {
    migrateCanvas();
    if (!bridge) {
      $('#set-calendars').hidden = true;
      return;
    }
    $('#cal-add').addEventListener('click', openForm);
    $('#cal-cancel').addEventListener('click', closeForm);
    $('#cal-save').addEventListener('click', addCalendar);
    $('#cal-url').addEventListener('input', onUrlInput);
    $('#cal-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCalendar();
      }
    });
    $('#cal-name').addEventListener('input', () => { nameEdited = true; });
    $('#cal-kind').addEventListener('change', () => { kindEdited = true; });
    $('#cal-auto').addEventListener('change', (e) => {
      data.auto = e.target.checked;
      save();
    });
    $('#cal-days').addEventListener('change', (e) => {
      data.daysAhead = Number(e.target.value) || 30;
      save();
      for (const cal of data.list) sync(cal);
    });
  }

  return {
    init, syncUi, sync, autoSync, cleanup, forget, nameOf,
    parseIcs, parseWhen, occurrences, splitSummary, normalizeUrl, providerOf,
    list: () => data.list,
  };
})();
