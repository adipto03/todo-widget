// Pins a window to the desktop (Windows only). While pinned it sits behind every other
// app window, and only comes to the front while the desktop itself is in the foreground
// (clicking the wallpaper, Win+D, "Show desktop") — like a desktop gadget, not a floating window.
let user32 = null;
try {
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    user32 = {
      GetForegroundWindow: lib.func('intptr_t GetForegroundWindow()'),
      GetClassNameW: lib.func('int GetClassNameW(intptr_t hWnd, void *lpClassName, int nMaxCount)'),
      SetWindowPos: lib.func('bool SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
    };
  }
} catch (err) {
  console.warn('Desktop pinning is unavailable:', err.message);
}

const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const HWND_BOTTOM = 1;
const SWP_NOSIZE_NOMOVE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010;

// Foreground window classes that mean "the desktop is showing".
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

// Shell surfaces that briefly take focus (taskbar, Start, tray overflow, Alt+Tab); they shouldn't change anything.
const SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'Windows.UI.Core.CoreWindow',
  'XamlExplorerHostIslandWindow',
  'ForegroundStaging',
  'MultitaskingViewFrame',
]);

function createDesktopPin(win) {
  if (!user32) return { available: false, enable() {}, disable() {}, raise() {} };

  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  const classBuf = Buffer.alloc(512);
  let timer = null;
  let raised = false; // true while it's allowed above other windows (desktop showing, or opened from the tray)

  const setPos = (insertAfter) => user32.SetWindowPos(hwnd, insertAfter, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE);

  function toFront() {
    raised = true;
    setPos(HWND_TOPMOST);
  }

  function toBack() {
    raised = false;
    setPos(HWND_NOTOPMOST);
    setPos(HWND_BOTTOM);
  }

  function className(h) {
    const n = user32.GetClassNameW(h, classBuf, classBuf.length / 2);
    return classBuf.toString('utf16le', 0, n * 2);
  }

  function tick() {
    const fg = user32.GetForegroundWindow();
    if (!fg || fg === hwnd) return;
    const cls = className(fg);
    if (DESKTOP_CLASSES.has(cls)) {
      if (!raised) toFront();
    } else if (!SHELL_CLASSES.has(cls)) {
      if (raised) toBack();
    }
  }

  // Clicking the widget would normally bring it forward; keep it behind other windows instead.
  const onFocus = () => {
    if (!raised) setPos(HWND_BOTTOM);
  };
  // Win+M and similar shouldn't minimize a desktop widget. Restoring brings it forward, so re-place it.
  const onMinimize = () => {
    win.showInactive();
    if (raised) toFront();
    else toBack();
  };

  return {
    available: true,
    enable() {
      if (timer) return;
      win.setMinimizable(false);
      win.on('focus', onFocus);
      win.on('minimize', onMinimize);
      toBack();
      timer = setInterval(tick, 250);
    },
    disable() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      win.off('focus', onFocus);
      win.off('minimize', onMinimize);
      win.setMinimizable(true);
      raised = false;
      setPos(HWND_NOTOPMOST);
    },
    // Bring it forward on purpose (tray "Show widget", notification click) until another app takes focus.
    raise() {
      if (timer) toFront();
    },
  };
}

// Windows 11 only rounds a frameless window's corners when asked. The widget is framed like a
// viewfinder with a 12px inner border, so square outer corners would fight that shape.
let dwmSetWindowAttribute = null;
try {
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    dwmSetWindowAttribute = koffi.load('dwmapi.dll')
      .func('long DwmSetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, void *pvAttribute, uint32_t cbAttribute)');
  }
} catch {}

function roundCorners(win) {
  if (!dwmSetWindowAttribute) return;
  const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
  const DWMWCP_ROUND = 2;
  const value = Buffer.alloc(4);
  value.writeInt32LE(DWMWCP_ROUND);
  // Returns an error code on Windows 10, where the attribute doesn't exist; square corners are fine there.
  dwmSetWindowAttribute(Number(win.getNativeWindowHandle().readBigUInt64LE(0)), DWMWA_WINDOW_CORNER_PREFERENCE, value, 4);
}

module.exports = { createDesktopPin, roundCorners };
