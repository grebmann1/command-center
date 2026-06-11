import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { InboxPdfExport, InboxPdfExportResult } from '../shared/types.js';

/**
 * Render a self-contained HTML document to PDF.
 *
 * The renderer already paints the inbox detail (mermaid → inline SVG,
 * code → highlighted spans), then serializes that subtree plus the page CSS
 * into a standalone document. We load it into a hidden, offscreen
 * BrowserWindow and use Chromium's `printToPDF` — so the PDF matches what the
 * user sees, with no second markdown pipeline to keep in sync.
 *
 * The window is sandboxed: no node integration, no preload, and the HTML
 * arrives as a data: URL so it never touches disk. We prompt for a save
 * location first; a cancelled dialog resolves `{ ok: false }` with no message
 * (the caller treats a message-less failure as "cancelled, stay quiet").
 */
export async function exportInboxPdf(
  parent: BrowserWindow | null,
  input: InboxPdfExport
): Promise<InboxPdfExportResult> {
  const safeName = sanitizeFilename(input.suggestedName) || 'inbox-entry';

  const save = await dialog.showSaveDialog(parent ?? undefined!, {
    title: 'Export inbox entry as PDF',
    defaultPath: `${safeName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (save.canceled || !save.filePath) return { ok: false };

  let offscreen: BrowserWindow | null = null;
  try {
    offscreen = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // No app preload — this window only renders trusted, self-generated
        // HTML and must not expose any cc.* bridge.
        preload: undefined
      }
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`;
    await offscreen.loadURL(dataUrl);
    // Let late layout settle (fonts, SVG sizing) before snapshotting.
    await offscreen.webContents.executeJavaScript(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
    );

    const pdf = await offscreen.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      pageSize: 'A4'
    });

    await writeFile(save.filePath, pdf);
    return { ok: true, path: save.filePath };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    offscreen?.destroy();
  }
}

/** Strip path separators / illegal filename chars; collapse whitespace. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
