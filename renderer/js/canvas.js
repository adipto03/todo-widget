// Optional Canvas import: reads a student's Canvas calendar feed and adds upcoming assignments to Tasks.
// Nothing happens unless a feed link is pasted in Settings, so it stays out of the way for everyone else.
const Canvas = (() => {
  const KEY = 'todo-widget.canvas';
  const SYNC_EVERY_MS = 3 * 60 * 60 * 1000;
  const blank = () => ({ url: '', auto: true, lastSync: 0, lastError: '', count: 0, known: {} });

  let data = { ...blank(), ...(Store.get(KEY, {}) || {}) };
  let syncing = false;
  const save = () => Store.set(KEY, data);

  const unescapeText = (value) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

  function parseIcs(text) {
    // Long lines in .ics files are "folded" onto the next line starting with a space.
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let current = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') current = {};
      else if (line === 'END:VEVENT') {
        if (current) events.push(current);
        current = null;
      } else if (current) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        current[line.slice(0, colon).split(';')[0].toUpperCase()] = line.slice(colon + 1);
      }
    }
    return events;
  }

  function parseWhen(value) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
    if (!m) return null;
    const [, y, mo, d, hh, mi, ss, utc] = m;
    if (!hh) return { date: `${y}-${mo}-${d}`, time: '' };
    const when = utc ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss)) : new Date(+y, +mo - 1, +d, +hh, +mi, +ss);
    return { date: Dates.key(when), time: `${pad(when.getHours())}:${pad(when.getMinutes())}` };
  }

  // Canvas titles look like "Lab 3 Report [CHM 113 (2026 Fall)]"; the course code becomes the category.
  function splitSummary(summary) {
    const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
    if (!m) return { title: summary.trim(), course: '' };
    return { title: m[1].trim() || summary.trim(), course: m[2].replace(/\s*\(.*\)\s*$/, '').trim() };
  }

  const looksLikeFeed = (url) => /^https:\/\/\S+\/feeds\/calendars\/\S+\.ics$/i.test(url);

  function renderStatus(message, warn = false) {
    const status = $('#canvas-status');
    let text = message || '';
    let isWarn = warn;
    if (!text && data.lastError) {
      text = `Last import failed: ${data.lastError}`;
      isWarn = true;
    } else if (!text && data.lastSync) {
      const when = new Date(data.lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      text = `Last imported ${when} · ${data.count} assignment${data.count === 1 ? '' : 's'} in your feed.`;
    }
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('warn', isWarn);
    $('#canvas-disconnect').hidden = !data.url;
    $('#canvas-auto').checked = !!data.auto;
  }

  async function sync() {
    if (!data.url || !bridge || syncing) return { ok: false };
    syncing = true;
    try {
      const text = await bridge.fetchCalendar(data.url);
      const events = parseIcs(text).filter((e) => e.UID && e.DTSTART && /assignment/i.test(e.UID));
      const earliest = Dates.offsetKey(-1);
      let added = 0;
      let updated = 0;
      for (const ev of events) {
        if (data.known[ev.UID]?.deleted) continue;
        const when = parseWhen(ev.DTSTART);
        if (!when || when.date < earliest) continue;
        const { title, course } = splitSummary(unescapeText(ev.SUMMARY || 'Assignment'));
        const link = /^https:\/\//i.test(ev.URL || '') ? ev.URL.trim() : '';
        const result = Tasks.upsertExternal({
          externalId: ev.UID, source: 'canvas', title, date: when.date, time: when.time, category: course || 'Canvas', link,
        });
        data.known[ev.UID] = { taskId: result.id };
        if (result.created) added++;
        else if (result.changed) updated++;
      }
      Tasks.commit();
      Object.assign(data, { lastSync: Date.now(), lastError: '', count: events.length });
      save();
      return { ok: true, added, updated };
    } catch (err) {
      data.lastError = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      data.lastSync = Date.now(); // don't retry every tick while it's failing
      save();
      return { ok: false, error: data.lastError };
    } finally {
      syncing = false;
    }
  }

  function autoSync() {
    if (data.url && data.auto && Date.now() - data.lastSync > SYNC_EVERY_MS) sync().then(() => renderStatus());
  }

  // Remember that an imported assignment was deleted, so the next sync doesn't bring it back.
  function forget(externalId, deleted) {
    if (!externalId) return;
    if (deleted) data.known[externalId] = { deleted: true };
    else delete data.known[externalId];
    save();
  }

  function syncUi() {
    $('#canvas-url').value = data.url;
    if (data.url) $('#canvas-details').open = true;
    renderStatus();
  }

  function init() {
    if (!bridge) {
      $('#set-canvas').hidden = true;
      return;
    }
    $('#canvas-sync').addEventListener('click', async () => {
      const url = $('#canvas-url').value.trim();
      if (!looksLikeFeed(url)) {
        renderStatus("That doesn't look like a Canvas calendar feed link. It should start with https:// and end with .ics.", true);
        return;
      }
      if (url !== data.url) {
        data.url = url;
        data.lastError = '';
        save();
      }
      $('#canvas-sync').disabled = true;
      renderStatus('Importing…');
      const result = await sync();
      $('#canvas-sync').disabled = false;
      if (result.ok) {
        renderStatus(`Done: ${result.added} new, ${result.updated} updated.${data.auto ? ' It checks again every 3 hours.' : ''}`);
      } else {
        renderStatus();
      }
    });
    $('#canvas-auto').addEventListener('change', (e) => {
      data.auto = e.target.checked;
      save();
    });
    $('#canvas-disconnect').addEventListener('click', () => {
      data = blank();
      save();
      $('#canvas-url').value = '';
      renderStatus('Disconnected. Assignments already imported stay in your tasks.');
    });
  }

  return { init, sync, autoSync, forget, syncUi, parseIcs, parseWhen, splitSummary };
})();
