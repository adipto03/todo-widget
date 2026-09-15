// Settings sheet: theme and tabs, prayer location and method, notifications, journal lock, backup,
// Canvas import, keyboard shortcut and start with Windows.
const SettingsPanel = (() => {
  const panel = $('#settings');

  function populateHabitSelect() {
    $('#s-prayer-habit').replaceChildren(
      new Option("Don't fill in a habit", ''),
      ...Habits.list().map((h) => new Option(`${h.emoji ? `${h.emoji} ` : ''}${h.name}${h.type === 'count' ? ' (number)' : ''}`, h.id)),
    );
  }

  function sync() {
    populateHabitSelect();
    for (const input of $$('[data-setting]', panel)) {
      const value = Settings.get(input.dataset.setting);
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value ?? '');
    }
    const themeRadio = $(`input[name="theme"][value="${Theme.mode()}"]`, panel);
    if (themeRadio) themeRadio.checked = true;
    renderLocation();
    syncLock();
    Canvas.syncUi();
  }

  function renderLocation() {
    const loc = Settings.data.prayer.location;
    $('#s-loc-name').textContent = loc ? loc.name : 'No location set';
    if (!loc) {
      $('#s-loc-sub').textContent = 'Search for your city below.';
      return;
    }
    const qibla = Prayer.qibla();
    $('#s-loc-sub').textContent = [
      [loc.region, loc.country].filter(Boolean).join(', '),
      loc.timezone,
      qibla != null ? `Qibla ${Math.round(qibla)}° from North` : '',
    ].filter(Boolean).join(' · ');
  }

  function showStatus(text) {
    $('#loc-status').textContent = text;
    $('#loc-status').hidden = !text;
  }

  function choose(place) {
    const prayer = Settings.data.prayer;
    const suggestion = Prayer.suggestMethod(place.countryCode);
    prayer.location = place;
    prayer.method = suggestion.key;
    if (suggestion.hanafi) prayer.madhab = 'hanafi';
    Settings.save();
    $('#loc-results').replaceChildren();
    $('#loc-query').value = '';
    showStatus(place.countryCode
      ? `Using ${suggestion.label}, the usual method in ${place.country}. Change it below if your mosque follows a different one.`
      : 'Location saved. Pick the calculation method your mosque uses below.');
    sync();
    Prayer.refresh().then(renderLocation);
  }

  async function search(e) {
    e.preventDefault();
    const q = $('#loc-query').value.trim();
    $('#loc-results').replaceChildren();

    const coords = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coords) {
      const lat = Number(coords[1]);
      const lon = Number(coords[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        choose({
          name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
          region: 'Custom coordinates',
          country: '',
          countryCode: '',
          lat,
          lon,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        return;
      }
    }
    if (q.length < 2) return showStatus('Type at least 2 letters.');
    if (!bridge) return showStatus('City search works in the desktop app.');

    showStatus('Searching…');
    try {
      const places = await bridge.searchPlaces(q);
      if (!places.length) {
        showStatus(`No places found for "${q}". Try a nearby city, or type coordinates like 51.5, -0.12.`);
        return;
      }
      showStatus('');
      $('#loc-results').replaceChildren(...places.map((p) => el('li', {},
        el('button', { type: 'button', class: 'loc-result', onclick: () => choose(p) },
          el('b', { text: p.name }),
          el('span', { text: [p.region, p.country].filter(Boolean).join(', ') })))));
    } catch {
      showStatus("Couldn't search right now. Check your internet connection, or type coordinates like 51.5, -0.12.");
    }
  }

  function open(sectionId) {
    sync();
    showStatus('');
    setHotkeyHint();
    closeLockCard();
    $('#s-restore-confirm').hidden = true;
    Sheet.open(panel, cancelRecording);
    if (sectionId) $(`#${sectionId}`)?.scrollIntoView({ block: 'start' });
  }

  function syncStartup(s) {
    $('#s-startup').checked = !!s.openAtLogin;
    if (!recording) showHotkey(s.hotkey);
  }

  // ---------- journal lock ----------
  let lockMode = null; // 'set' | 'change' | 'remove'

  function syncLock() {
    const on = Journal.lock.enabled;
    $('#s-lock').checked = on;
    $('#s-lock-change').hidden = !on || lockMode !== null;
  }

  function openLockCard(mode) {
    lockMode = mode;
    $('#s-lock-card').hidden = false;
    $('#s-lock-current-row').hidden = mode === 'set';
    $('#s-lock-new-row').hidden = mode === 'remove';
    $('#s-lock-confirm-row').hidden = mode === 'remove';
    $('#s-lock-save').textContent = mode === 'remove' ? 'Remove lock' : 'Save PIN';
    for (const id of ['#s-lock-current', '#s-lock-new', '#s-lock-confirm']) $(id).value = '';
    $('#s-lock-msg').hidden = true;
    syncLock();
    (mode === 'set' ? $('#s-lock-new') : $('#s-lock-current')).focus();
  }

  function closeLockCard() {
    lockMode = null;
    $('#s-lock-card').hidden = true;
    syncLock();
  }

  async function saveLock() {
    const fail = (text) => {
      $('#s-lock-msg').textContent = text;
      $('#s-lock-msg').hidden = false;
    };
    if (lockMode !== 'set' && !(await Journal.lock.verify($('#s-lock-current').value))) return fail('Current PIN is wrong.');
    if (lockMode === 'remove') {
      Journal.lock.disable();
      Toast.show('Journal lock removed');
      return closeLockCard();
    }
    const pin = $('#s-lock-new').value;
    if (!/^\d{4,8}$/.test(pin)) return fail('Use 4 to 8 digits.');
    if (pin !== $('#s-lock-confirm').value) return fail("The two PINs don't match.");
    const wasSet = lockMode === 'set';
    await Journal.lock.setPin(pin);
    Toast.show(wasSet ? 'Journal locked with your PIN' : 'PIN changed');
    closeLockCard();
  }

  // ---------- backup ----------
  let pendingRestore = null;

  function setBackupStatus(text, warn = false) {
    $('#s-backup-status').textContent = text;
    $('#s-backup-status').classList.toggle('warn', warn);
  }

  async function backupNow() {
    try {
      const result = await Backup.exportToFile();
      if (result?.ok) setBackupStatus(`Saved to ${result.path}`);
      else if (result?.error) setBackupStatus(`Couldn't save the backup: ${result.error}`, true);
    } catch (err) {
      setBackupStatus(`Couldn't save the backup: ${err.message}`, true);
    }
  }

  async function pickRestore() {
    try {
      const result = await Backup.readFromFile();
      if (result.canceled) return;
      pendingRestore = result.backup;
      const s = Backup.summary(result.backup);
      $('#s-restore-text').textContent = `Replace everything in the widget with the backup from ${s.when}? It has ${s.tasks} tasks, ${s.habits} habits and ${s.notes} notes. What's in the widget now will be overwritten.`;
      $('#s-restore-confirm').hidden = false;
    } catch (err) {
      setBackupStatus(err.message, true);
    }
  }

  // ---------- keyboard shortcut to open the widget ----------
  let recording = false;

  const prettyHotkey = (accelerator) =>
    accelerator.replace('Control', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');

  const CODE_KEYS = {
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  };

  function showHotkey(accelerator) {
    $('#s-hotkey').textContent = accelerator ? prettyHotkey(accelerator) : 'Off';
    $('#s-hotkey-clear').hidden = !accelerator;
  }

  function setHotkeyHint(text = '', warn = false) {
    $('#s-hotkey-hint').textContent = text || 'Press it anywhere in Windows to show or hide the widget.';
    $('#s-hotkey-hint').classList.toggle('warn', warn);
  }

  // Turns a key press into a shortcut like "Control+Alt+T". Uses the physical key so it behaves the
  // same on any keyboard layout.
  function toAccelerator(e) {
    const code = e.code;
    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`;
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else if (/^Arrow/.test(code)) key = code.slice(5);
    else if (CODE_KEYS[code]) key = CODE_KEYS[code];
    if (!key) return { error: "That key can't be used in a shortcut. Try a letter or number." };

    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const isFunctionKey = /^F\d{1,2}$/.test(key);
    if (!isFunctionKey && !mods.some((m) => m !== 'Shift')) {
      return { error: 'Include Ctrl or Alt, so the shortcut doesn\'t get in the way when you type.' };
    }
    return { accelerator: [...mods, key].join('+') };
  }

  function startRecording() {
    if (recording) return;
    recording = true;
    bridge.suspendHotkey(true);
    $('#s-hotkey').textContent = 'Press keys…';
    $('#s-hotkey').classList.add('recording');
    setHotkeyHint('Press the new shortcut, or Esc to cancel.');
    addEventListener('keydown', onRecordKey, true);
  }

  function stopRecording() {
    recording = false;
    $('#s-hotkey').classList.remove('recording');
    removeEventListener('keydown', onRecordKey, true);
  }

  async function cancelRecording() {
    if (!recording) return;
    stopRecording();
    bridge.suspendHotkey(false);
    const s = await bridge.getSettings();
    showHotkey(s.hotkey);
    setHotkeyHint();
  }

  async function onRecordKey(e) {
    // Capture phase + stopImmediatePropagation: while recording, keys set the shortcut instead of
    // doing their usual job (Esc closing settings, Ctrl+N adding a task, and so on).
    e.preventDefault();
    e.stopImmediatePropagation();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // wait for the actual key
    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }
    const result = toAccelerator(e);
    if (result.error) {
      setHotkeyHint(result.error, true);
      return;
    }
    stopRecording();
    const saved = await bridge.setHotkey(result.accelerator);
    showHotkey(saved.hotkey);
    if (saved.ok) setHotkeyHint(`Saved. Press ${prettyHotkey(saved.hotkey)} anywhere to show or hide the widget.`);
    else setHotkeyHint(`${prettyHotkey(result.accelerator)} is already used by another app. Try a different one.`, true);
  }

  function init() {
    $('#s-method').replaceChildren(...Prayer.METHODS.map(([key, label]) => new Option(label, key)));

    for (const input of $$('[data-setting]', panel)) {
      input.addEventListener('change', () => {
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.dataset.type === 'number') value = Number(value);
        Settings.set(input.dataset.setting, value);
      });
    }
    for (const radio of $$('input[name="theme"]', panel)) {
      radio.addEventListener('change', () => Theme.set(radio.value));
    }

    $('#loc-form').addEventListener('submit', search);
    $('#s-test-notify').addEventListener('click', () => {
      Notifier.test();
      Toast.show(Settings.data.notifications.enabled ? 'Test notification sent' : 'Sent. Notifications are off for reminders though.');
    });
    $('#settings-close').addEventListener('click', () => Sheet.close());

    // Journal lock
    $('#s-lock').addEventListener('change', (e) => {
      e.target.checked = Journal.lock.enabled; // only changes once the PIN step is finished
      openLockCard(Journal.lock.enabled ? 'remove' : 'set');
    });
    $('#s-lock-change').addEventListener('click', () => openLockCard('change'));
    $('#s-lock-cancel').addEventListener('click', closeLockCard);
    $('#s-lock-save').addEventListener('click', saveLock);
    for (const id of ['#s-lock-current', '#s-lock-new', '#s-lock-confirm']) {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveLock();
        }
      });
    }

    Canvas.init();

    if (bridge) {
      // Backup
      $('#s-backup').addEventListener('click', backupNow);
      $('#s-restore').addEventListener('click', pickRestore);
      $('#s-restore-cancel').addEventListener('click', () => {
        pendingRestore = null;
        $('#s-restore-confirm').hidden = true;
      });
      $('#s-restore-apply').addEventListener('click', () => {
        if (pendingRestore) Backup.apply(pendingRestore);
      });
      $('#s-backup-folder').addEventListener('click', () => bridge.openBackupsFolder());
      setBackupStatus('Daily backups are kept for 7 days.');

      // Window
      bridge.getSettings().then(syncStartup);
      $('#s-startup').addEventListener('change', (e) => bridge.setOpenAtLogin(e.target.checked));
      $('#s-hotkey').addEventListener('click', startRecording);
      $('#s-hotkey-clear').addEventListener('click', async () => {
        const saved = await bridge.setHotkey('');
        showHotkey(saved.hotkey);
        setHotkeyHint('Shortcut turned off. Click the box to set a new one.');
      });
      // Switching to another app mid-recording shouldn't leave the shortcut switched off.
      addEventListener('blur', cancelRecording);
    } else {
      $('#set-backup').hidden = true;
      $('#s-startup-row').hidden = true;
      $('#s-hotkey-row').hidden = true;
      $('#s-hotkey-hint').hidden = true;
    }
  }

  return { init, open, syncStartup };
})();
