// Decides when to send Windows notifications for tasks, prayers, the morning summary and habit check-ins.
const Notifier = (() => {
  const KEY = 'todo-widget.notified';
  const GRACE_MS = 10 * 60 * 1000; // still send if we're up to 10 minutes late (e.g. after waking from sleep)
  const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

  let sent = Store.get(KEY, {});

  function send({ title, body, view }) {
    const silent = !Settings.data.notifications.sound;
    if (bridge) bridge.notify({ title, body, silent, view });
    else if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, silent });
  }

  function candidates() {
    const n = Settings.data.notifications;
    const today = Dates.key();
    const list = [...Tasks.reminders(), ...Prayer.reminders()];
    if (n.summary) list.push({ key: `summary:${today}`, at: Dates.at(today, n.summaryTime).getTime(), build: Tasks.summary });
    if (n.habitCheckin) list.push({ key: `habits:${today}`, at: Dates.at(today, n.habitTime).getTime(), build: Habits.checkin });
    return list;
  }

  function tick() {
    if (!Settings.data.notifications.enabled) return;
    const now = Date.now();
    let changed = false;

    for (const c of candidates()) {
      if (!Number.isFinite(c.at) || sent[c.key] || c.at > now || now - c.at > GRACE_MS) continue;
      sent[c.key] = now;
      changed = true;
      const message = c.build ? c.build() : c;
      if (message) send(message);
    }

    for (const [key, ts] of Object.entries(sent)) {
      if (now - ts > KEEP_MS) {
        delete sent[key];
        changed = true;
      }
    }
    if (changed) Store.set(KEY, sent);
  }

  function test() {
    send({ title: 'Notifications are working', body: "You'll get reminders like this for tasks, habits and prayers." });
  }

  // One-off messages from other parts of the widget, like a goal being reached.
  function announce(message) {
    if (Settings.data.notifications.enabled) send(message);
  }

  return { tick, test, announce };
})();
