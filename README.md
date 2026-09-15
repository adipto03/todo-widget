# To-Do Widget

A small desktop widget for Windows that sits on your desktop and keeps your day in one place.

- **Tasks**: due dates and times, importance, categories, reminders and repeating tasks (daily, weekdays, weekly, monthly or custom days)
- **Habits**: a monthly grid, with habits you tick off or count towards a daily goal (like 20 pages)
- **Prayer times**: calculated on your computer for your city, with notifications. Tap a prayer to mark it as prayed.
- **Deen**: a daily Quran verse or hadith with lessons from it (browse more by category and save favourites), prayers marked this week, Quran reading progress, a tasbih counter, upcoming Islamic dates and the Qibla direction
- **Journal**: notes like the iPhone Notes app, with categories, pinning, search and an optional PIN lock
- **Goals**: weekly or monthly goals that fill in by themselves from your tasks, habits, prayers and Quran reading, whether you're on pace, what needs attention, and this week compared with last
- **Linked calendars**: events and deadlines from Google Calendar, Outlook, Apple iCloud or Canvas show up in Tasks
- Light and dark mode, pin to desktop, drag to move, a shortcut to open it (Ctrl + Alt + T) and backups

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
- The Deen and Goals tabs and the prayer card can be turned off in **Settings → Appearance**. Cards in the Deen tab fold away if you don't use them.
- **Settings → Linked calendars** takes a calendar's sharing link (iCal / .ics). The settings explain where to find it for Google, Outlook, iCloud and Canvas.
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
- Linked calendars (off unless you add a link) only download the calendars you link.

## Credits

- Quran Arabic text: [Tanzil Project](https://tanzil.net) (CC BY 3.0), regenerated with `node scripts/fetch-quran-arabic.js`. English meanings and lessons are written for this app; hadith references link to [sunnah.com](https://sunnah.com).
- Prayer times: [adhan](https://github.com/batoulapps/adhan-js).

## License

MIT
