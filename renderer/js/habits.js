// Monthly habit tracker, laid out as a grid: habits down the side, the month's days across the top.
// Habits are either ticked off, or counted towards a daily goal (e.g. 12/20 pages).
const Habits = (() => {
  const KEY = 'todo-widget.habits';
  const HUES = [250, 205, 165, 135, 42, 18, 340, 290];
  const EMOJI_GROUPS = [
    ['Faith', ['🕌', '📿', '🤲', '🕋', '☪️', '📖', '🌙', '⭐', '🕯️', '💚', '🧎', '🙏', '🌄', '🍽️', '💝', '📜']],
    ['Health', ['💧', '🥗', '🍎', '🥦', '🥕', '🍌', '💊', '🩺', '😴', '🛌', '🦷', '🧴', '🚭', '🚫', '☀️', '⚖️']],
    ['Fitness', ['🏃', '🚶', '🏋️', '🧘', '🚴', '🏊', '⚽', '🏀', '🏐', '🎾', '🏸', '🥊', '🤸', '🧗', '⛹️', '🏓']],
    ['Mind', ['🧠', '📝', '✍️', '📓', '🎯', '🧩', '💭', '😌', '🌿', '🎧', '📵', '🤔', '🪷', '♟️', '🔕', '⏸️']],
    ['Study & work', ['📚', '🎓', '💻', '🧮', '🔬', '🧪', '🗂️', '📅', '⏰', '📈', '💼', '🖊️', '🗣️', '🌐', '📊', '⌨️']],
    ['Home', ['🧹', '🧺', '🍳', '🪴', '🛏️', '🧽', '🗑️', '🐶', '🐱', '🛒', '🔧', '🏠', '🚿', '👕', '🧼', '📦']],
    ['Money', ['💰', '💵', '🏦', '💳', '🪙', '📉', '🧾', '🐖', '💸', '📋']],
    ['People', ['📞', '💬', '👨‍👩‍👧', '🤝', '💌', '🎁', '😊', '❤️', '👋', '🫂', '👵', '👶']],
    ['Hobbies', ['🎨', '🎸', '🎹', '🥁', '📷', '🎮', '🧶', '🎬', '📺', '✈️', '🌍', '🧳', '🎤', '🪡', '🎲', '🏕️']],
    ['Nature', ['🌅', '🌳', '🌸', '🌧️', '🌊', '⛰️', '🍃', '🌻', '🐦', '🌱', '🔥', '❄️']],
    ['Symbols', ['✅', '✨', '💯', '⚡', '🏆', '🎉', '🌈', '💎', '🚀', '⏳', '🔔', '📌', '🟢', '🔵', '🟣', '🟠']],
  ];

  let data = Store.get(KEY, null);
  if (!data || !Array.isArray(data.habits)) data = { habits: [], logs: {} };
  data.logs ??= {};

  let viewMonth = startOfMonth(new Date());
  let editingId = null;
  let dayTarget = null;
  let formHue = HUES[0];
  let emojiGroup = 0;
  let scrollToToday = true; // only jump the grid to today on open or month change, not on every tick

  const form = $('#habit-form');
  const dayForm = $('#habit-day-form');

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  const save = () => Store.set(KEY, data);
  const find = (id) => data.habits.find((h) => h.id === id);
  const valueOf = (h, key) => data.logs[h.id]?.[key] ?? 0;
  const goalOf = (h) => (h.type === 'count' ? h.goal : 1);
  const isMet = (h, key) => valueOf(h, key) >= goalOf(h);
  const fractionOf = (h, key) => Math.min(1, valueOf(h, key) / goalOf(h));
  const formatNum = (n) => String(Math.round(n * 100) / 100);
  const dayLabel = (key) => Dates.parse(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function setValue(h, key, value) {
    const logs = (data.logs[h.id] ??= {});
    if (!value || value <= 0) delete logs[key];
    else logs[key] = value;
    save();
    render();
  }

  function streak(h) {
    const d = new Date();
    if (!isMet(h, Dates.key(d))) d.setDate(d.getDate() - 1);
    let count = 0;
    while (count < 3660 && isMet(h, Dates.key(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }

  // For the viewed month, up to today: days the goal was met, days gone by so far, and the running total.
  function monthProgress(h) {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const todayKey = Dates.key();
    let met = 0;
    let elapsed = 0;
    let total = 0;
    for (let d = 1; d <= Dates.daysInMonth(y, m); d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      if (key > todayKey) break;
      elapsed++;
      total += valueOf(h, key);
      if (isMet(h, key)) met++;
    }
    return { met, elapsed, total };
  }

  // ---------- grid ----------
  function render() {
    const today = new Date();
    const isCurrentMonth = viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth();
    $('#habit-month').textContent = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#habit-next').disabled = isCurrentMonth;

    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const days = Dates.daysInMonth(y, m);
    const todayKey = Dates.key();
    const keys = Array.from({ length: days }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);

    let met = 0;
    let elapsed = 0;
    for (const h of data.habits) {
      const p = monthProgress(h);
      met += p.met;
      elapsed += p.elapsed;
    }
    $('#habit-stats').textContent = elapsed ? `${Math.round((met / elapsed) * 100)}% done` : '';

    const head = el('thead', {}, el('tr', {},
      el('th', { class: 'corner', scope: 'col' }, viewMonth.toLocaleDateString(undefined, { month: 'short' })),
      keys.map((key) => {
        const date = Dates.parse(key);
        const weekend = date.getDay() === 0 || date.getDay() === 6;
        return el('th', { scope: 'col', class: [key === todayKey && 'today', weekend && 'weekend'].filter(Boolean).join(' ') },
          el('span', { class: 'dow', text: date.toLocaleDateString(undefined, { weekday: 'narrow' }) }),
          el('span', { class: 'dnum', text: String(date.getDate()) }));
      })));

    const body = el('tbody', {}, data.habits.map((h) => habitRow(h, keys, todayKey)));

    const wrap = $('#habit-table-wrap');
    const previousScroll = wrap.scrollLeft;
    $('#habit-table').replaceChildren(head, body);
    wrap.hidden = data.habits.length === 0;
    $('#habit-hint').hidden = data.habits.length === 0;
    $('#habit-empty').hidden = data.habits.length > 0;

    // Wait until the grid is actually on screen: while the Habits tab is hidden it has no width to scroll.
    if (scrollToToday && wrap.clientWidth > 0) {
      scrollToToday = false;
      const todayTh = $('#habit-table thead th.today');
      const nameWidth = $('#habit-table .corner').offsetWidth;
      wrap.scrollLeft = todayTh
        ? Math.max(0, todayTh.offsetLeft + todayTh.offsetWidth / 2 - (wrap.clientWidth + nameWidth) / 2)
        : 0;
    } else {
      wrap.scrollLeft = previousScroll;
    }
  }

  function habitRow(h, keys, todayKey) {
    const s = streak(h);
    const progress = monthProgress(h);
    // Tick habits: ticks / days so far this month. Number habits: the month's running total.
    const detail = h.type === 'count'
      ? `${formatNum(progress.total)} ${h.unit || 'total'}`
      : `${progress.met}/${progress.elapsed}`;
    const detailTitle = h.type === 'count'
      ? `Total this month: ${formatNum(progress.total)}${h.unit ? ` ${h.unit}` : ''}`
      : `Ticked ${progress.met} of ${progress.elapsed} days so far this month`;

    const nameCell = el('th', { scope: 'row', class: 'h-name' },
      el('button', { type: 'button', class: 'h-name-btn', title: 'Edit habit', onclick: () => openForm(h) },
        el('span', { class: 'h-emoji', text: h.emoji || h.name.slice(0, 1).toUpperCase() }),
        el('span', { class: 'h-text' },
          el('span', { class: 'h-title', text: h.name }),
          el('span', { class: 'h-sub' },
            s ? el('span', { class: 'streak', html: Icons.flame, title: `${s}-day streak` }, `${s}`) : null,
            el('span', { text: detail, title: detailTitle })))));

    const cells = keys.map((key) => {
      const future = key > todayKey;
      const v = valueOf(h, key);
      const f = fractionOf(h, key);
      const met = f >= 1;
      const status = h.type === 'count'
        ? `${formatNum(v)}/${formatNum(h.goal)}${h.unit ? ` ${h.unit}` : ''}`
        : met ? 'done' : 'not done';
      const label = `${h.name}, ${dayLabel(key)}${future ? '' : `: ${status}`}`;
      const button = el('button', {
        type: 'button',
        class: ['cell', met && 'met', !met && f > 0 && 'partial', future && 'future'].filter(Boolean).join(' '),
        style: { '--f': f },
        disabled: future,
        title: label,
        'aria-label': label,
        html: h.type !== 'count' && met ? Icons.check : null,
        onclick: () => (h.type === 'count' ? openDay(h, key) : setValue(h, key, v ? 0 : 1)),
      }, h.type === 'count' && v ? formatNum(v) : null);
      return el('td', { class: key === todayKey ? 'today' : null }, button);
    });

    return el('tr', { style: { '--h': h.hue ?? HUES[0] } }, nameCell, cells);
  }

  // ---------- exact amount for a day ----------
  function openDay(h, key) {
    dayTarget = { id: h.id, key };
    $('#hd-title').textContent = `${h.emoji ? `${h.emoji} ` : ''}${h.name} · ${dayLabel(key)}`;
    $('#hd-value').value = valueOf(h, key) || '';
    $('#hd-goal').textContent = `/ ${formatNum(h.goal)}${h.unit ? ` ${h.unit}` : ''}`;
    Sheet.open(dayForm, () => { dayTarget = null; });
    $('#hd-value').focus();
    $('#hd-value').select();
  }

  // ---------- add / edit ----------
  function openForm(h = null) {
    editingId = h?.id ?? null;
    $('#habit-form-title').textContent = h ? 'Edit habit' : 'New habit';
    $('#h-submit').textContent = h ? 'Save' : 'Add habit';
    $('#h-delete').hidden = !h;
    $('#h-name').value = h?.name ?? '';
    $('#h-emoji').value = h?.emoji ?? '';
    form.htype.value = h?.type ?? 'check';
    $('#h-goal').value = h?.type === 'count' ? h.goal : 20;
    $('#h-unit').value = h?.unit ?? '';
    formHue = h?.hue ?? HUES[data.habits.length % HUES.length];
    const groupWithEmoji = EMOJI_GROUPS.findIndex(([, list]) => list.includes(h?.emoji));
    emojiGroup = groupWithEmoji >= 0 ? groupWithEmoji : 0;
    syncType();
    renderColors();
    renderEmojiPicker();
    Sheet.open(form, () => { editingId = null; });
    $('#h-name').focus();
  }

  function syncType() {
    $('#h-count-fields').hidden = form.htype.value !== 'count';
  }

  function renderColors() {
    $('#h-colors').replaceChildren(...HUES.map((hue) => el('button', {
      type: 'button',
      class: `swatch${hue === formHue ? ' selected' : ''}`,
      style: { '--h': hue },
      'aria-label': `Color ${hue}`,
      onclick: () => { formHue = hue; renderColors(); },
    })));
  }

  function renderEmojiPicker() {
    const current = $('#h-emoji').value.trim();
    $('#h-emoji-tabs').replaceChildren(...EMOJI_GROUPS.map(([name], i) => el('button', {
      type: 'button',
      class: `chip${i === emojiGroup ? ' selected' : ''}`,
      text: name,
      onclick: () => { emojiGroup = i; renderEmojiPicker(); },
    })));
    $('#h-emoji-grid').replaceChildren(...EMOJI_GROUPS[emojiGroup][1].map((emoji) => el('button', {
      type: 'button',
      class: `emoji-opt${emoji === current ? ' selected' : ''}`,
      text: emoji,
      'aria-label': `Use ${emoji}`,
      onclick: () => { $('#h-emoji').value = emoji; renderEmojiPicker(); },
    })));
  }

  function remove(id) {
    const index = data.habits.findIndex((h) => h.id === id);
    if (index < 0) return;
    const [habit] = data.habits.splice(index, 1);
    const logs = data.logs[id];
    delete data.logs[id];
    save();
    render();
    Toast.show(`Deleted "${habit.name}"`, () => {
      data.habits.splice(Math.min(index, data.habits.length), 0, habit);
      if (logs) data.logs[id] = logs;
      save();
      render();
    });
  }

  // ---------- used by other tabs ----------
  // Prayers marked in the prayer card / Deen tab can keep a chosen habit in sync.
  function setFromPrayers(id, key, count) {
    const h = find(id);
    if (!h) return;
    setValue(h, key, h.type === 'count' ? count : count >= 5 ? 1 : 0);
  }

  function statsFor(keys) {
    return data.habits.map((h) => {
      let met = 0;
      let total = 0;
      for (const k of keys) {
        total += valueOf(h, k);
        if (isMet(h, k)) met++;
      }
      return { id: h.id, name: h.name, emoji: h.emoji, type: h.type, unit: h.unit, hue: h.hue ?? HUES[0], met, days: keys.length, total, streak: streak(h) };
    });
  }

  const metCountOn = (key) => data.habits.filter((h) => isMet(h, key)).length;

  // ---------- notifications ----------
  function checkin() {
    const key = Dates.key();
    const left = data.habits.filter((h) => !isMet(h, key));
    if (!left.length) return null;
    const names = left.slice(0, 3).map((h) => (h.type === 'count'
      ? `${h.name} (${formatNum(valueOf(h, key))}/${formatNum(h.goal)}${h.unit ? ` ${h.unit}` : ''})`
      : h.name));
    return {
      title: `${left.length} habit${left.length === 1 ? '' : 's'} left today`,
      body: names.join(', ') + (left.length > 3 ? ` and ${left.length - 3} more` : ''),
      view: 'habits',
    };
  }

  // ---------- wiring ----------
  function changeMonth(step) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + step, 1);
    scrollToToday = true;
    render();
  }

  function init() {
    $('#habit-prev').addEventListener('click', () => changeMonth(-1));
    $('#habit-next').addEventListener('click', () => changeMonth(1));
    $('#h-emoji').addEventListener('input', renderEmojiPicker);
    for (const radio of form.htype) radio.addEventListener('change', syncType);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#h-name').value.trim();
      if (!name) return;
      const type = form.htype.value;
      const fields = {
        name,
        emoji: $('#h-emoji').value.trim(),
        type,
        goal: type === 'count' ? Math.max(1, parseFloat($('#h-goal').value) || 1) : 1,
        unit: type === 'count' ? $('#h-unit').value.trim() : '',
        hue: formHue,
      };
      if (editingId) Object.assign(find(editingId), fields);
      else data.habits.push({ id: uid(), ...fields, createdAt: Date.now() });
      save();
      Sheet.close();
      render();
    });
    $('#h-cancel').addEventListener('click', () => Sheet.close());
    $('#h-delete').addEventListener('click', () => {
      const id = editingId;
      Sheet.close();
      remove(id);
    });

    dayForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = dayTarget;
      const h = target && find(target.id);
      Sheet.close();
      if (h) setValue(h, target.key, parseFloat($('#hd-value').value) || 0);
    });
    $('#hd-clear').addEventListener('click', () => {
      const target = dayTarget;
      const h = target && find(target.id);
      Sheet.close();
      if (h) setValue(h, target.key, 0);
    });
    $('#hd-cancel').addEventListener('click', () => Sheet.close());
  }

  return {
    init,
    render,
    openForm,
    checkin,
    setFromPrayers,
    statsFor,
    metCountOn,
    list: () => data.habits.map((h) => ({ id: h.id, name: h.name, emoji: h.emoji, type: h.type })),
    goToToday: () => { viewMonth = startOfMonth(new Date()); scrollToToday = true; render(); },
  };
})();
