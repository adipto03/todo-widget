# To-Do Widget

A small desktop widget for Windows that sits on your desktop and keeps your day in one place.

- **Tasks**: due dates and times, importance, categories, reminders and repeating tasks (daily, weekdays, weekly, monthly or custom days)
- **Habits**: a monthly grid, with habits you tick off or count towards a daily goal (like 20 pages)
- **Prayer times**: calculated on your computer for your city, with notifications. Tap a prayer to mark it as prayed.
- **Deen**: prayers marked this week, Quran reading progress, a tasbih counter, Qibla direction and upcoming Islamic dates
- **Journal**: notes like the iPhone Notes app, with categories, pinning, search and an optional PIN lock
- **Stats**: the last 7 days or this month at a glance
- Light and dark mode, pin to desktop, drag to move, a shortcut to open it (Ctrl + Alt + T), backups, and optional Canvas assignment import for students

Everything is saved on your own computer. There's no account and nothing is uploaded.

## Install

1. Go to the [Releases page](https://github.com/adipto03/todo-widget/releases) and download `To-Do-Widget-Setup-x.y.z.exe`.
2. Run it. Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info**, then **Run anyway**.
3. The widget opens straight away, and you get a desktop icon and a Start menu entry.

Every new install starts empty. Works on Windows 10 and 11 (64-bit).

### Tips

- Drag the widget by its header to move it. Resize it from the edges.
- **Pin to desktop** (pin icon) keeps it behind your other windows, like a desktop gadget.
- Closing it hides it to the tray (bottom-right, near the clock) so reminders keep working. Right-click the tray icon to quit.
- The Deen and Stats tabs and the prayer card can be turned off in **Settings → Appearance**.
- **Settings → Backup** saves everything to a file, and automatic daily backups are on by default. Use a backup to move your data to another computer.

## Run from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Build the Windows installer into `dist/`:

```bash
npm run dist
```

## Privacy

- Your data stays in `%APPDATA%\todo-widget` on your computer.
- City search for prayer times sends only the city name you type to [Open-Meteo](https://open-meteo.com/)'s geocoding service.
- Canvas import (off unless you paste a feed link) only downloads your own Canvas calendar feed.

## License

MIT
