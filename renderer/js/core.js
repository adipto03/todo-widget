// Shared helpers used by every part of the widget.
const bridge = window.widget; // Electron API from preload.js; undefined in a plain browser

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const uid = () => crypto.randomUUID();

// ---------- saved data ----------
// In the desktop app everything is saved in widget-data.json by the main process, which writes each
// change to disk straight away. (Chromium's localStorage, used before, could lose changes on quit.)
// In a plain browser this falls back to localStorage.
const Storage = (() => {
  const PREFIX = 'todo-widget.';
  const IGNORE = new Set(['todo-widget.persist-check']);

  if (!bridge) {
    const keys = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    return {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, String(v)),
      removeItem: (k) => localStorage.removeItem(k),
      keys,
      replaceAll(data) {
        keys().forEach((k) => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
      },
    };
  }

  const loaded = bridge.storageLoad();
  let map = { ...loaded.data };

  if (!loaded.exists) {
    // First start with the data file: bring over what was saved in localStorage. If that came up
    // empty, start from the newest automatic backup instead so nothing is lost.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(PREFIX) && !IGNORE.has(key)) map[key] = localStorage.getItem(key);
    }
    // localStorage could come up partly empty, so fill anything missing (or an empty task, habit or
    // note list) from the newest automatic backup.
    const hasContent = (data, key) => {
      try {
        const value = JSON.parse(data[key] ?? 'null');
        return Array.isArray(value) ? value.length > 0 : value?.habits?.length > 0;
      } catch {
        return false;
      }
    };
    const backup = bridge.storageLatestBackup();
    if (backup) {
      for (const [key, value] of Object.entries(backup.data)) {
        const isList = ['todo-widget.tasks', 'todo-widget.habits', 'todo-widget.notes'].includes(key);
        if (!Object.hasOwn(map, key) || (isList && !hasContent(map, key) && hasContent(backup.data, key))) map[key] = value;
      }
    }
    bridge.storageReplace(map);
  }

  return {
    getItem: (k) => (Object.hasOwn(map, k) ? map[k] : null),
    setItem(k, v) {
      const value = String(v);
      if (map[k] === value) return;
      map[k] = value;
      bridge.storageSet(k, value);
    },
    removeItem(k) {
      if (!Object.hasOwn(map, k)) return;
      delete map[k];
      bridge.storageSet(k, null);
    },
    keys: () => Object.keys(map).filter((k) => k.startsWith(PREFIX)),
    replaceAll(data) {
      map = { ...data };
      bridge.storageReplace(map);
    },
  };
})();

const Store = {
  get(key, fallback) {
    try {
      const value = JSON.parse(Storage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    Storage.setItem(key, JSON.stringify(value));
  },
};

// Small DOM builder: el('div', { class: 'x', onclick: fn }, child, 'text')
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, String(v));
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const Icons = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 14v6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  habits: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8.5 14.8l1.8 1.8 3.6-3.8"/></svg>',
  deen: '<svg viewBox="0 0 24 24"><path d="M14.5 3.5a8.5 8.5 0 1 0 6 14.5A7 7 0 0 1 14.5 3.5z"/><path d="M18.5 5.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/></svg>',
  journal: '<svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M10 8h5M10 12h5"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M3 21h18M6.5 17v-5M12 17V6M17.5 17v-8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/></svg>',
  location: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5.3 3.6-7.6.4 1.8 1.4 3 2.6 3.6C12 7.6 13.3 5 15.6 3c.2 3.1 2.9 5.4 2.9 9.6 0 5-2.8 8.4-6.5 8.4z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  needle: '<svg viewBox="0 0 24 24"><path d="M12 2l4 10h-8z" fill="currentColor"/><path d="M8 12l4 10 4-10"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/></svg>',
  bookmark:'<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
};

// A stable colour for a category name, so the same category always gets the same tint.
function hueFor(name) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function fillIcons(root = document) {
  for (const node of $$('[data-icon]', root)) node.innerHTML = Icons[node.dataset.icon] || '';
}

const Dates = {
  key(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  offsetKey(days, from = new Date()) {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    return Dates.key(d);
  },
  parse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  at(key, hhmm) {
    const d = Dates.parse(key);
    const [h, m] = String(hhmm).split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  },
  formatTime(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  },
  daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  },
  // Every date key from one day to another, inclusive.
  range(fromKey, toKey) {
    const out = [];
    const d = Dates.parse(fromKey);
    const end = Dates.parse(toKey);
    while (d <= end) {
      out.push(Dates.key(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  },
};

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  notifications: {
    enabled: true,
    sound: true,
    taskDefault: 0,
    dateOnlyTime: '09:00',
    summary: true,
    summaryTime: '08:00',
    habitCheckin: true,
    habitTime: '21:00',
    prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
    prayerBefore: 0,
  },
  prayer: {
    location: null,
    method: 'MuslimWorldLeague',
    madhab: 'shafi',
    showSunrise: true,
    collapsed: false,
    showCard: true,
    linkedHabit: '',
  },
  tabs: { deen: true, goals: true },
  journalLock: { enabled: false, salt: '', hash: '' },
  backup: { auto: true },
};

function mergeDefaults(defaults, saved) {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(saved || {})) {
    const def = defaults[key];
    const bothObjects = def && typeof def === 'object' && !Array.isArray(def) && value && typeof value === 'object';
    out[key] = bothObjects ? mergeDefaults(def, value) : value;
  }
  return out;
}

const Settings = {
  KEY: 'todo-widget.settings',
  data: null,
  load() {
    const saved = Store.get(this.KEY, {});
    // The Stats tab became Goals; keep it hidden for anyone who had turned Stats off.
    if (saved.tabs && 'stats' in saved.tabs) {
      saved.tabs.goals ??= saved.tabs.stats;
      delete saved.tabs.stats;
    }
    this.data = mergeDefaults(DEFAULT_SETTINGS, saved);
  },
  save() {
    Store.set(this.KEY, this.data);
    document.dispatchEvent(new CustomEvent('settings-changed'));
  },
  get(path) {
    return path.split('.').reduce((obj, k) => obj?.[k], this.data);
  },
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((obj, k) => (obj[k] ??= {}), this.data)[last] = value;
    this.save();
  },
};
Settings.load();

// ---------- theme ----------
const Theme = (() => {
  const KEY = 'todo-widget.theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const mode = () => {
    const saved = Storage.getItem(KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  };
  const resolved = () => (mode() === 'system' ? (media.matches ? 'dark' : 'light') : mode());

  function apply() {
    const theme = resolved();
    document.documentElement.dataset.theme = theme;
    bridge?.setTheme(theme);
    const btn = $('#theme-btn');
    btn.innerHTML = theme === 'dark' ? Icons.sun : Icons.moon;
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function set(value) {
    if (value === 'system') Storage.removeItem(KEY);
    else Storage.setItem(KEY, value);
    apply();
  }

  media.addEventListener('change', apply);
  return { apply, set, mode, toggle: () => set(resolved() === 'dark' ? 'light' : 'dark') };
})();
Theme.apply();

// ---------- toast with optional undo ----------
const Toast = (() => {
  let timer = null;
  let undoFn = null;

  function hide() {
    $('#toast').hidden = true;
    undoFn = null;
    clearTimeout(timer);
  }

  function show(text, onUndo) {
    $('#toast-text').textContent = text;
    undoFn = onUndo || null;
    $('#toast-undo').hidden = !onUndo;
    $('#toast').hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, onUndo ? 5000 : 3000);
  }

  $('#toast-undo').addEventListener('click', () => {
    const fn = undoFn;
    hide();
    fn?.();
  });

  return { show, hide };
})();

// ---------- bottom sheets (forms and settings) ----------
const Sheet = (() => {
  let current = null;
  let onClose = null;

  function open(node, closeCb) {
    if (current && current !== node) close();
    current = node;
    onClose = closeCb || null;
    $('#backdrop').hidden = false;
    node.hidden = false;
    node.scrollTop = 0;
  }

  function close() {
    if (!current) return;
    current.hidden = true;
    $('#backdrop').hidden = true;
    const cb = onClose;
    current = null;
    onClose = null;
    cb?.();
  }

  $('#backdrop').addEventListener('click', close);
  return {
    open,
    close,
    get isOpen() {
      return !!current;
    },
  };
})();
