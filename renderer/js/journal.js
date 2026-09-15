// Journal / notes, like the iPhone Notes app. A note without a title is named by the date it was written.
// Notes can have a category, and the journal can optionally be locked with a PIN.
const Journal = (() => {
  const KEY = 'todo-widget.notes';
  const DAY_MS = 86400000;
  const DEFAULT_CATEGORIES = ['Personal', 'Ideas', 'Gratitude', 'Goals', 'Study'];

  let notes = Store.get(KEY, []);
  if (!Array.isArray(notes)) notes = [];
  let query = '';
  let categoryFilter = 'all';
  let openId = null;
  let saveTimer = null;
  let forgotArmed = false;

  const save = () => Store.set(KEY, notes);
  const find = (id) => notes.find((n) => n.id === id);

  const dateName = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const displayTitle = (n) => n.title.trim() || dateName(n.createdAt);

  function preview(n) {
    const line = n.body.split('\n').map((s) => s.trim()).find(Boolean);
    return line || 'No additional text';
  }

  function daysAgo(ts) {
    const start = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return Math.round((start(Date.now()) - start(ts)) / DAY_MS);
  }

  function groupName(n) {
    if (n.pinned) return 'Pinned';
    const days = daysAgo(n.updatedAt);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return 'Previous 7 Days';
    if (days < 30) return 'Previous 30 Days';
    return new Date(n.updatedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function shortWhen(ts) {
    const days = daysAgo(ts);
    const d = new Date(ts);
    if (days <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  }

  // ---------- PIN lock (optional) ----------
  const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  const lock = {
    unlocked: false,
    get enabled() {
      return !!Settings.data.journalLock.enabled;
    },
    async hash(pin, salt) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
      return toHex(new Uint8Array(digest));
    },
    async verify(pin) {
      const saved = Settings.data.journalLock;
      return saved.enabled && (await this.hash(pin, saved.salt)) === saved.hash;
    },
    async setPin(pin) {
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      Settings.data.journalLock = { enabled: true, salt, hash: await this.hash(pin, salt) };
      this.unlocked = true;
      Settings.save();
    },
    disable() {
      Settings.data.journalLock = { enabled: false, salt: '', hash: '' };
      this.unlocked = false;
      Settings.save();
    },
  };

  function lockNow() {
    if (!lock.enabled || !lock.unlocked) return;
    if (openId !== null) close();
    lock.unlocked = false;
    $('#lock-pin').value = '';
    $('#lock-error').hidden = true;
    forgotArmed = false;
  }

  // ---------- categories ----------
  const usedCategories = () =>
    [...new Set(notes.map((n) => n.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  function allCategories() {
    const all = [...DEFAULT_CATEGORIES, ...usedCategories()];
    return all.filter((c, i) => all.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
  }

  function renderCategoryBar() {
    const used = usedCategories();
    if (categoryFilter !== 'all' && !used.includes(categoryFilter)) categoryFilter = 'all';
    const bar = $('#note-cats');
    bar.hidden = used.length === 0;
    const chip = (value, label, count) => el('button', {
      type: 'button',
      class: `chip${categoryFilter === value ? ' selected' : ''}`,
      role: 'tab',
      'aria-selected': String(categoryFilter === value),
      onclick: () => {
        categoryFilter = value;
        renderList();
      },
    }, label, el('span', { class: 'chip-count', text: String(count) }));
    bar.replaceChildren(
      chip('all', 'All', notes.length),
      ...used.map((c) => chip(c, c, notes.filter((n) => n.category === c).length)),
    );
  }

  // ---------- list ----------
  function renderList() {
    renderCategoryBar();
    const q = query.trim().toLowerCase();
    const visible = notes
      .filter((n) => categoryFilter === 'all' || n.category === categoryFilter)
      .filter((n) => !q || `${displayTitle(n)}\n${n.body}\n${n.category || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

    const groups = new Map();
    for (const n of visible) {
      const name = groupName(n);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(n);
    }

    $('#note-groups').replaceChildren(...[...groups].map(([name, items]) => el('section', { class: 'note-section' },
      el('h3', { class: 'note-group', text: name }),
      el('ul', { class: 'note-list' }, items.map(noteItem)))));

    $('#note-empty').hidden = visible.length > 0;
    let emptyText = 'No notes yet.\nPress + to write your first one.';
    if (q) emptyText = `No notes match "${query.trim()}".`;
    else if (categoryFilter !== 'all') emptyText = `No notes in "${categoryFilter}" yet.`;
    $('#note-empty-text').textContent = emptyText;
    $('#note-stats').textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
  }

  const noteItem = (n) => el('li', {
    class: 'note-item',
    tabindex: '0',
    onclick: () => open(n.id),
    onkeydown: (e) => { if (e.key === 'Enter') open(n.id); },
  },
  el('div', { class: 'note-title' }, n.pinned ? el('span', { class: 'note-pin', html: Icons.pin }) : null, displayTitle(n)),
  el('div', { class: 'note-meta' },
    el('span', { class: 'note-when', text: shortWhen(n.updatedAt) }),
    // The tag is redundant while filtering by that same category, so it only shows under "All".
    n.category && categoryFilter === 'all'
      ? el('span', { class: 'cat', style: { '--h': hueFor(n.category) }, text: n.category })
      : null,
    el('span', { class: 'note-preview', text: preview(n) })));

  // ---------- editor ----------
  function create() {
    const now = Date.now();
    const note = {
      id: uid(),
      title: '',
      body: '',
      category: categoryFilter !== 'all' ? categoryFilter : '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    notes.push(note);
    save();
    open(note.id, true);
  }

  function open(id, isNew = false) {
    const n = find(id);
    if (!n) return;
    openId = id;
    $('#note-title').value = n.title;
    $('#note-title').placeholder = dateName(n.createdAt);
    $('#note-body').value = n.body;
    renderEditorMeta(n);
    App.show('journal');
    (isNew ? $('#note-title') : $('#note-body')).focus();
  }

  function renderEditorMeta(n) {
    const created = new Date(n.createdAt).toLocaleString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const edited = n.updatedAt - n.createdAt > 60000 ? ` · Edited ${shortWhen(n.updatedAt)}` : '';
    $('#note-meta').textContent = `${created}${edited}`;
    $('#note-pin').classList.toggle('active', !!n.pinned);
    $('#note-pin').title = n.pinned ? 'Unpin note' : 'Pin note';

    const catBtn = $('#note-cat');
    catBtn.replaceChildren(el('span', { html: Icons.tag }), n.category || 'Category');
    catBtn.classList.toggle('has-cat', !!n.category);
    catBtn.style.setProperty('--h', n.category ? hueFor(n.category) : 0);
    catBtn.title = n.category ? `Category: ${n.category} (click to change)` : 'Add a category';
  }

  function openCategoryPicker() {
    const n = find(openId);
    if (!n) return;
    $('#note-cat-new').value = '';
    $('#note-cat-none').hidden = !n.category;
    const current = (n.category || '').toLowerCase();
    $('#note-cat-options').replaceChildren(...allCategories().map((c) => el('button', {
      type: 'button',
      class: `chip${c.toLowerCase() === current ? ' selected' : ''}`,
      text: c,
      onclick: () => setCategory(c),
    })));
    Sheet.open($('#note-cat-form'));
  }

  function setCategory(value) {
    const n = find(openId);
    if (!n) return;
    const raw = value.trim();
    // Match an existing category case-insensitively so "ideas" and "Ideas" don't split.
    n.category = raw ? (allCategories().find((c) => c.toLowerCase() === raw.toLowerCase()) || raw) : '';
    save();
    renderEditorMeta(n);
    Sheet.close();
    $('#note-body').focus();
  }

  function onEdit() {
    const n = find(openId);
    if (!n) return;
    n.title = $('#note-title').value;
    n.body = $('#note-body').value;
    n.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  function close() {
    if (openId === null) return;
    clearTimeout(saveTimer);
    const n = find(openId);
    // Like iPhone Notes: a note you didn't write anything in isn't kept.
    if (n && !n.title.trim() && !n.body.trim()) notes = notes.filter((x) => x.id !== n.id);
    save();
    openId = null;
    App.show('journal');
    renderList();
  }

  function removeOpen() {
    const n = find(openId);
    if (!n) return;
    clearTimeout(saveTimer);
    notes = notes.filter((x) => x.id !== n.id);
    save();
    openId = null;
    App.show('journal');
    renderList();
    if (n.title.trim() || n.body.trim()) {
      Toast.show(`Deleted "${displayTitle(n).slice(0, 30)}"`, () => {
        notes.push(n);
        save();
        renderList();
      });
    }
  }

  // ---------- wiring ----------
  function init() {
    $('#note-search').addEventListener('input', (e) => {
      query = e.target.value;
      renderList();
    });
    $('#note-title').addEventListener('input', onEdit);
    $('#note-body').addEventListener('input', onEdit);
    $('#note-title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#note-body').focus();
      }
    });
    $('#note-back').addEventListener('click', close);
    $('#note-pin').addEventListener('click', () => {
      const n = find(openId);
      if (!n) return;
      n.pinned = !n.pinned;
      save();
      renderEditorMeta(n);
    });
    $('#note-delete').addEventListener('click', removeOpen);

    $('#note-cat').addEventListener('click', openCategoryPicker);
    $('#note-cat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const typed = $('#note-cat-new').value.trim();
      if (typed) setCategory(typed);
      else Sheet.close();
    });
    $('#note-cat-none').addEventListener('click', () => setCategory(''));
    $('#note-cat-cancel').addEventListener('click', () => Sheet.close());

    $('#lock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await lock.verify($('#lock-pin').value)) {
        lock.unlocked = true;
        $('#lock-pin').value = '';
        $('#lock-error').hidden = true;
        forgotArmed = false;
        App.show('journal');
      } else {
        $('#lock-error').textContent = 'Wrong PIN. Try again.';
        $('#lock-error').hidden = false;
        $('#lock-pin').select();
      }
    });
    $('#lock-forgot').addEventListener('click', () => {
      if (!forgotArmed) {
        forgotArmed = true;
        $('#lock-error').textContent = 'Without the PIN, the only way in is to delete all journal notes and remove the lock. Click "Forgot PIN?" again to do that.';
        $('#lock-error').hidden = false;
        return;
      }
      notes = [];
      save();
      lock.disable();
      forgotArmed = false;
      $('#lock-error').hidden = true;
      renderList();
      App.show('journal');
      Toast.show('Lock removed and journal notes deleted');
    });
  }

  return {
    init,
    renderList,
    create,
    close,
    lock,
    lockNow,
    list: () => notes,
    get isEditing() {
      return openId !== null;
    },
    get isLocked() {
      return lock.enabled && !lock.unlocked;
    },
  };
})();
