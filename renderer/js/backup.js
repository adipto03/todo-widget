// Backup and restore: everything the widget stores, saved to or loaded from a JSON file.
const Backup = (() => {
  const PREFIX = 'todo-widget.';
  const LAST_AUTO_KEY = 'todo-widget.lastAutoBackup';
  // Bookkeeping that shouldn't travel with a backup.
  const SKIP = new Set(['todo-widget.notified', LAST_AUTO_KEY]);

  function snapshot() {
    const data = {};
    for (const key of Storage.keys()) {
      if (key.startsWith(PREFIX) && !SKIP.has(key)) data[key] = Storage.getItem(key);
    }
    return { app: 'todo-widget', version: 1, exportedAt: new Date().toISOString(), data };
  }

  const serialize = () => JSON.stringify(snapshot(), null, 2);

  function parse(text) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error("That file isn't an A Widget for Life backup.");
    }
    if (!backup || backup.app !== 'todo-widget' || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
      throw new Error("That file isn't an A Widget for Life backup.");
    }
    for (const [key, value] of Object.entries(backup.data)) {
      if (!key.startsWith(PREFIX) || typeof value !== 'string') throw new Error('That backup file looks damaged.');
    }
    return backup;
  }

  function summary(backup) {
    const read = (key, fallback) => {
      try {
        return JSON.parse(backup.data[key]) ?? fallback;
      } catch {
        return fallback;
      }
    };
    const tasks = read('todo-widget.tasks', []);
    const habits = read('todo-widget.habits', {});
    const notes = read('todo-widget.notes', []);
    const when = new Date(backup.exportedAt);
    return {
      when: Number.isNaN(when.getTime()) ? 'an unknown date' : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      tasks: Array.isArray(tasks) ? tasks.length : 0,
      habits: Array.isArray(habits.habits) ? habits.habits.length : 0,
      notes: Array.isArray(notes) ? notes.length : 0,
    };
  }

  const exportToFile = () => bridge.saveBackup(serialize(), `a-widget-for-life-backup-${Dates.key()}.json`);

  async function readFromFile() {
    const result = await bridge.openBackup();
    if (!result || result.canceled) return { canceled: true };
    if (!result.ok) throw new Error(result.error || "Couldn't read that file.");
    return { backup: parse(result.text) };
  }

  function apply(backup) {
    // Written to disk before the reload, so the restored data is what loads.
    Storage.replaceAll(backup.data);
    location.reload();
  }

  // One automatic backup per day, kept for a week, in the app's own backups folder.
  function autoDaily() {
    if (!bridge || !Settings.data.backup.auto) return;
    const today = Dates.key();
    if (Storage.getItem(LAST_AUTO_KEY) === today) return;
    Storage.setItem(LAST_AUTO_KEY, today); // mark first, so a failing disk doesn't retry every few seconds
    bridge.autoBackup(serialize(), today).catch(() => {});
  }

  return { exportToFile, readFromFile, summary, apply, autoDaily, parse, snapshot };
})();
