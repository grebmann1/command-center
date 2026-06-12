/**
 * Auto-update wiring around electron-updater's `autoUpdater`.
 *
 * Behavior (decided): auto-download in the background, install on quit. No
 * forced relaunch — a downloaded update applies on the next normal quit
 * (`autoInstallOnAppQuit`), so a running terminal / scheduled agent is never
 * interrupted mid-session. The renderer can still trigger an immediate
 * `quitAndInstall` from the About section if the user wants it now.
 *
 * macOS specifics: electron-updater uses Squirrel.Mac, which REQUIRES the app
 * to be code-signed and the new build to share the same signing identity as the
 * running one. We sign with a self-signed cert (see electron-builder.yml). An
 * unsigned dev/build can't auto-update — and electron-updater throws if asked to
 * in development — so every entry point here is guarded by `app.isPackaged` and
 * no-ops (reporting `disabled`) otherwise.
 *
 * Only core code can push to the renderer (app modules can't), so this lives in
 * the main process and emits via the injected `safeSend`, mirroring the
 * inbox/terminal push channels.
 */

import { app } from 'electron';
// electron-updater is CommonJS; default-import then destructure so it resolves
// under this package's ESM ("type": "module") build.
import electronUpdater from 'electron-updater';
import { IPC } from '../shared/ipc.js';
import type { UpdateProgress, UpdateStatus } from '../shared/types.js';

const { autoUpdater } = electronUpdater;

export interface UpdaterDeps {
  /** Same core push used by terminals/inbox; no-ops if the window is gone. */
  safeSend: (channel: string, ...args: unknown[]) => void;
  log: (context: string, err: unknown) => void;
}

export interface Updater {
  /** Best-effort check on boot / from the About button. No-op in dev. */
  checkForUpdates(): Promise<void>;
  /** Relaunch into a downloaded update now. No-op if nothing is staged. */
  quitAndInstall(): void;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { safeSend, log } = deps;

  const emitStatus = (status: UpdateStatus) => safeSend(IPC.updates.onStatus, status);

  // Target version, captured on `update-available` so the `downloading` status
  // can report it (autoUpdater.currentVersion is the *installed* version, not
  // the one being fetched).
  let pendingVersion: string | undefined;

  // In dev (or any unpackaged run) electron-updater can't function and throws
  // if invoked. Return a no-op updater that reports `disabled` so the UI can
  // show "not available in dev" instead of an error.
  if (!app.isPackaged) {
    return {
      async checkForUpdates() {
        emitStatus({ kind: 'disabled' });
      },
      quitAndInstall() {
        /* no-op in dev */
      }
    };
  }

  // Background download + apply-on-quit are electron-updater's defaults, but set
  // them explicitly so the intent is local to this file.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => console.log(`[updater] ${String(m)}`),
    warn: (m: unknown) => console.warn(`[updater] ${String(m)}`),
    error: (m: unknown) => log('autoUpdater', m),
    debug: () => {}
  };

  autoUpdater.on('checking-for-update', () => emitStatus({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info?.version;
    emitStatus({ kind: 'available', version: pendingVersion });
  });
  autoUpdater.on('update-not-available', () => emitStatus({ kind: 'not-available' }));
  autoUpdater.on('download-progress', (p) => {
    const progress: UpdateProgress = {
      percent: p?.percent ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
      bytesPerSecond: p?.bytesPerSecond ?? 0
    };
    safeSend(IPC.updates.onProgress, progress);
    emitStatus({ kind: 'downloading', version: pendingVersion });
  });
  autoUpdater.on('update-downloaded', (info) =>
    emitStatus({ kind: 'downloaded', version: info?.version ?? pendingVersion })
  );
  autoUpdater.on('error', (err) => {
    log('autoUpdater.error', err);
    emitStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  });

  return {
    async checkForUpdates() {
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        // checkForUpdates can reject (offline, no release yet); the 'error'
        // event usually fires too, but guard so a boot-time check never rejects
        // into the unhandledRejection path.
        log('checkForUpdates', err);
        emitStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    },
    quitAndInstall() {
      // `isSilent=false`, `isForceRunAfter=true`: show the installer's normal
      // progress and relaunch the app afterward.
      autoUpdater.quitAndInstall(false, true);
    }
  };
}
