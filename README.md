# Claude Code Terminal Center

A desktop command center for managing Claude Code sessions across many projects from a single window.

3-column layout (OpenAlice-inspired):
1. **Sidebar** – primary navigation (Projects, Settings).
2. **List pane** – contextual list (your projects).
3. **Workspace** – tabbed terminal for the selected project. Each tab is a real PTY running `claude`, `claude --resume`, `claude -c`, or your shell.

## Stack

- Electron 33 + electron-vite
- React 18 + Zustand
- xterm.js (fit, web-links addons)
- node-pty for real PTY sessions

## Run

```bash
npm install
# node-pty needs the rebuild for Electron's ABI:
npm run rebuild
npm run dev
```

The first launch is empty — click `+` in the Projects column to add a folder.

## Data

Persisted under `~/.cc-center/`:
- `projects.json` — project registry
- `config.json` — app config (shell path, claude binary, font size)
