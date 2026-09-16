// Ties the widget together: header, tab switching, window controls, dragging, keyboard shortcuts and the clock.
const App = (() => {
  const VIEW_KEY = 'todo-widget.view';
  const ALL_VIEWS = ['planner', 'tasks', 'habits', 'deen', 'journal', 'goals'];
  const ADD_LABEL = { planner: 'Add priority', tasks: 'Add task', habits: 'Add habit', journal: 'New note', goals: 'Add goal' };

  let view = Storage.getItem(VIEW_KEY) || 'tasks';
  if (view === 'stats') view = 'goals';
  let lastDay = Dates.key();

  const enabledViews = () => ALL_VIEWS.filter((v) => {
    if (v === 'planner') return Settings.data.tabs.planner;
    if (v === 'deen') return Settings.data.tabs.deen;
    if (v === 'goals') return Settings.data.tabs.goals;
    return true;
  });

  function show(name) {
    const views = enabledViews();
    if (!views.includes(name)) name = 'tasks';
    if (name !== 'journal') {
      if (Journal.isEditing) Journal.close();
      Journal.lockNow();
    }
    view = name;
    Storage.setItem(VIEW_KEY, name);

    const locked = name === 'journal' && Journal.isLocked;
    const editing = name === 'journal' && !locked && Journal.isEditing;
    $('#view-planner').hidden = name !== 'planner';
    $('#view-tasks').hidden = name !== 'tasks';
    $('#view-habits').hidden = name !== 'habits';
    $('#view-deen').hidden = name !== 'deen';
    $('#view-journal').hidden = name !== 'journal' || editing || locked;
    $('#note-editor').hidden = !editing;
    $('#journal-lock').hidden = !locked;
    $('#view-goals').hidden = name !== 'goals';

    for (const btn of $$('.nav-btn')) {
      btn.hidden = !views.includes(btn.dataset.view);
      btn.classList.toggle('active', btn.dataset.view === name);
    }
    $('#bottom-nav').style.setProperty('--tabs', views.length);

    const addLabel = ADD_LABEL[name];
    $('#fab').hidden = !addLabel || editing || locked;
    if (addLabel) {
      $('#fab').title = `${addLabel} (Ctrl+N)`;
      $('#fab').setAttribute('aria-label', addLabel);
    }

    if (name !== 'planner') Planner.flush();
    if (name === 'planner') Planner.render();
    if (name === 'habits') Habits.render();
    if (name === 'deen') Deen.render();
    if (name === 'goals') Goals.render();
    if (locked) $('#lock-pin').focus();
  }

  function add() {
    if (view === 'planner') Planner.add();
    else if (view === 'tasks') Tasks.openForm();
    else if (view === 'habits') Habits.openForm();
    else if (view === 'goals') Goals.openForm();
    else if (view === 'journal' && !Journal.isLocked) Journal.create();
  }

  function renderHeader() {
    $('#greg-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#hijri-date').textContent = Prayer.hijriDate();
  }

  function applyWindowSettings(s) {
    $('#pin-btn').classList.toggle('active', !!s.pinned);
    $('#pin-btn').title = s.pinned
      ? 'Pinned to desktop: stays behind other windows (click to unpin)'
      : 'Pin to desktop (stays behind other windows)';
  }

  // Move the widget by dragging its header or a section heading. The main process moves the window
  // while the mouse is held; this is more reliable than the built-in drag region, which could get
  // cancelled when pin-to-desktop pushed the window to the back on click.
  function initDrag() {
    if (!bridge) return;
    const app = $('#app');
    app.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (e.button !== 0 || !(target instanceof Element)) return;
      if (!target.closest('.titlebar, .view-head, .editor-bar')) return;
      if (target.closest('button, input, textarea, select, a, label')) return;

      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      app.classList.add('dragging');
      bridge.startDrag();
      let finished = false;
      const end = () => {
        if (finished) return;
        finished = true;
        bridge.endDrag();
        app.classList.remove('dragging');
      };
      target.addEventListener('pointerup', end, { once: true });
      target.addEventListener('pointercancel', end, { once: true });
      target.addEventListener('lostpointercapture', end, { once: true });
    });
  }

  function tick() {
    const today = Dates.key();
    if (today !== lastDay) {
      lastDay = today;
      Planner.newDay();
      Habits.goToToday();
      Journal.renderList();
    }
    renderHeader();
    Prayer.render();
    if (!Sheet.isOpen) Tasks.render();
    if (view === 'planner') Planner.tick();
    if (view === 'deen') Deen.render();
    if (view === 'goals' && !Sheet.isOpen) Goals.render();
    Notifier.tick();
    Backup.autoDaily();
    Calendars.cleanup();
    Calendars.autoSync();
    Goals.checkReached();
  }

  function init() {
    fillIcons();
    Tasks.init();
    Planner.init();
    Calendars.init();
    Habits.init();
    Deen.init();
    Journal.init();
    Prayer.init();
    Goals.init();
    SettingsPanel.init();
    initDrag();

    for (const btn of $$('.nav-btn')) {
      btn.addEventListener('click', () => {
        if (btn.dataset.view === 'journal' && view === 'journal' && Journal.isEditing) Journal.close();
        else show(btn.dataset.view);
      });
    }
    $('#fab').addEventListener('click', add);
    $('#theme-btn').addEventListener('click', Theme.toggle);
    $('#settings-btn').addEventListener('click', () => SettingsPanel.open());

    if (bridge) {
      bridge.getSettings().then(applyWindowSettings);
      bridge.onSettingsChanged((s) => {
        applyWindowSettings(s);
        SettingsPanel.syncStartup(s);
      });
      bridge.onNavigate((name) => {
        Sheet.close();
        show(name);
      });
      $('#pin-btn').addEventListener('click', () => bridge.togglePin());
      $('#close-btn').addEventListener('click', () => bridge.hide());
    } else {
      $('#pin-btn').hidden = true;
      $('#close-btn').hidden = true;
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (Sheet.isOpen) Sheet.close();
        else if (Journal.isEditing) Journal.close();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (!Sheet.isOpen) add();
      }
    });

    // Lock the journal again whenever the widget is hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && Journal.lock.enabled) {
        Journal.lockNow();
        if (view === 'journal') show('journal');
      }
    });

    document.addEventListener('settings-changed', () => {
      renderHeader();
      Prayer.render();
      Tasks.render();
      show(view);
    });
    document.addEventListener('prayers-changed', () => {
      Prayer.render();
      if (view === 'deen') Deen.render();
      if (view === 'goals') Goals.render();
    });

    show(view);
    renderHeader();
    Tasks.render();
    Habits.render();
    Journal.renderList();
    Prayer.render();
    Notifier.tick();
    Backup.autoDaily();
    Calendars.cleanup();
    Calendars.autoSync();
    Goals.checkReached();
    setInterval(tick, 15000);
  }

  return { init, show };
})();

App.init();
