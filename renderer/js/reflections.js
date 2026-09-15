// Daily reminder at the top of the Deen tab: a Quran verse or hadith for today, with lessons from it.
// Browse the others with the arrows (or a sideways swipe on a touchpad) and narrow them down by category.
const Reflections = (() => {
  const KEY = 'todo-widget.reflections';
  const DAY_MS = 86400000;
  const CATEGORY_NAME = Object.fromEntries(REFLECTION_CATEGORIES);
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  let data = mergeDefaults({ saved: [], cat: 'all' }, Store.get(KEY, {}));
  if (!Array.isArray(data.saved)) data.saved = [];
  const save = () => Store.set(KEY, data);

  // A fixed shuffled order that alternates verses and hadith, so every day brings something different.
  const ORDER = (() => {
    const shuffle = (list, seed) => {
      const a = [...list];
      let s = seed;
      for (let i = a.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const quran = shuffle(REFLECTIONS.filter((r) => r.type === 'quran'), 17);
    const hadith = shuffle(REFLECTIONS.filter((r) => r.type === 'hadith'), 29);
    const out = [];
    for (let i = 0; i < Math.max(quran.length, hadith.length); i++) {
      if (quran[i]) out.push(quran[i]);
      if (hadith[i]) out.push(hadith[i]);
    }
    return out;
  })();

  let items = [];
  let index = 0;
  let shownDay = null;
  let direction = 0;

  function todays() {
    const d = Dates.parse(Dates.key());
    const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
    return ORDER[day % ORDER.length];
  }

  function listFor(cat) {
    if (cat === 'saved') return ORDER.filter((r) => data.saved.includes(r.id));
    if (!CATEGORY_NAME[cat]) return ORDER;
    return ORDER.filter((r) => r.cats.includes(cat));
  }

  // Opens a category on the given reminder if it's in there, otherwise on today's, otherwise on the
  // next one after today's in the rotation.
  function openCategory(cat, keepId = null) {
    data.cat = cat === 'saved' || CATEGORY_NAME[cat] ? cat : 'all';
    save();
    items = listFor(data.cat);
    const todayPos = ORDER.indexOf(todays());
    const at = [keepId, todays().id].map((id) => items.findIndex((r) => r.id === id)).find((i) => i >= 0);
    if (at != null) index = at;
    else {
      const next = items.findIndex((r) => ORDER.indexOf(r) >= todayPos);
      index = next >= 0 ? next : 0;
    }
    direction = 0;
    renderChips();
    renderItem();
  }

  function go(step) {
    if (items.length < 2) return;
    index = (index + step + items.length) % items.length;
    direction = step;
    renderItem();
  }

  function toggleSave() {
    const r = items[index];
    if (!r) return;
    const saved = data.saved.includes(r.id);
    data.saved = saved ? data.saved.filter((id) => id !== r.id) : [...data.saved, r.id];
    save();
    if (data.cat === 'saved') {
      items = listFor('saved');
      index = Math.max(0, Math.min(index, items.length - 1));
    }
    renderChips();
    renderItem();
    Toast.show(saved ? 'Removed from saved' : 'Saved. Find it under Saved.');
  }

  // ---------- text ----------
  function verseKeys(range) {
    const [surah, ayat] = range.split(':');
    const [from, to = from] = ayat.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => `${surah}:${from + i}`);
  }

  const arabicNumber = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);

  function arabicFor(r) {
    if (typeof QURAN_ARABIC === 'undefined') return '';
    return verseKeys(r.verses)
      .filter((key) => QURAN_ARABIC[key])
      .map((key) => `${QURAN_ARABIC[key]} ﴿${arabicNumber(key.split(':')[1])}﴾`)
      .join(' ');
  }

  const refLabel = (r) => (r.type === 'quran' ? `Surah ${r.surah} ${r.verses.replace('-', '–')}` : r.source);
  const sourceUrl = (r) => (r.type === 'quran' ? `https://quran.com/${r.verses.replace(':', '/')}` : `https://sunnah.com/${r.link}`);

  // ---------- rendering ----------
  function renderChips() {
    const chip = (key, label) => el('button', {
      type: 'button',
      class: `chip${data.cat === key ? ' selected' : ''}`,
      role: 'tab',
      'aria-selected': String(data.cat === key),
      onclick: () => openCategory(key, items[index]?.id),
    }, label);
    $('#reflection-cats').replaceChildren(
      chip('all', 'All'),
      chip('saved', el('span', { class: 'chip-with-icon', html: Icons.bookmark }, `Saved${data.saved.length ? ` ${data.saved.length}` : ''}`)),
      ...REFLECTION_CATEGORIES.map(([key, label]) => chip(key, label)),
    );
    $('#reflection-cats .chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderItem() {
    const r = items[index];
    const body = $('#reflection-body');
    const isToday = !!r && r.id === todays().id;
    $('#reflection-today').hidden = isToday;
    $('#reflection-save').hidden = !r;
    $('#reflection-nav').hidden = items.length < 2;
    $('#reflection-count').textContent = r ? `${index + 1} of ${items.length}` : '';
    $('#reflection-source').hidden = !r || !bridge;

    if (!r) {
      body.replaceChildren(el('p', { class: 'reflection-empty', text: 'Nothing saved yet. Tap the bookmark on a reminder to keep it here.' }));
      return;
    }

    const saved = data.saved.includes(r.id);
    const saveBtn = $('#reflection-save');
    saveBtn.classList.toggle('active', saved);
    saveBtn.title = saved ? 'Remove from saved' : 'Save this reminder';
    saveBtn.setAttribute('aria-pressed', String(saved));
    $('#reflection-source-label').textContent = r.type === 'quran' ? 'Quran.com' : 'Sunnah.com';

    const arabic = r.type === 'quran' ? arabicFor(r) : '';
    body.replaceChildren(...[
      el('div', { class: 'reflection-meta' },
        el('span', { class: `reflection-type ${r.type}`, text: r.type === 'quran' ? 'Quran' : 'Hadith' }),
        el('span', { class: 'reflection-ref', text: refLabel(r) }),
        isToday ? el('span', { class: 'reflection-badge', text: 'Today' }) : null),
      arabic ? el('p', { class: 'reflection-ar', lang: 'ar', dir: 'rtl', text: arabic }) : null,
      el('p', { class: 'reflection-text', text: r.text }),
      r.narrator ? el('p', { class: 'reflection-narrator', text: `Narrated by ${r.narrator}` }) : null,
      el('h4', { class: 'reflection-lessons-title', text: 'Lessons' }),
      el('ul', { class: 'reflection-lessons' }, r.lessons.map((lesson) => el('li', { text: lesson }))),
    ].filter(Boolean));

    body.classList.remove('slide-next', 'slide-prev');
    if (direction) {
      void body.offsetWidth; // restart the animation
      body.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
      direction = 0;
    }
  }

  // Only a new day changes the card on its own; everything else happens through its buttons.
  function render() {
    const today = Dates.key();
    if (shownDay === today) return;
    shownDay = today;
    openCategory(data.cat);
  }

  function init() {
    $('#reflection-prev').addEventListener('click', () => go(-1));
    $('#reflection-next').addEventListener('click', () => go(1));
    $('#reflection-save').addEventListener('click', toggleSave);
    $('#reflection-today').addEventListener('click', () => openCategory(data.cat === 'saved' ? 'all' : data.cat, todays().id));
    $('#reflection-source').addEventListener('click', () => {
      const r = items[index];
      if (r) bridge?.openExternal(sourceUrl(r));
    });

    const card = $('#reflection-card');
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    // Two-finger sideways swipe on a touchpad moves between reminders.
    let swipe = 0;
    let lockedUntil = 0;
    $('#reflection-body').addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < lockedUntil) return;
      swipe += e.deltaX;
      if (Math.abs(swipe) > 60) {
        go(swipe > 0 ? 1 : -1);
        swipe = 0;
        lockedUntil = Date.now() + 450;
      }
    }, { passive: false });
  }

  return { init, render, todays, count: () => ORDER.length };
})();
