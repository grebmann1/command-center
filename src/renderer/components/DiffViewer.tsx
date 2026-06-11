import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

/**
 * A read-only side-by-side diff view, created directly against the bundled
 * `monaco` instance instead of `@monaco-editor/react`'s `<DiffEditor>`.
 *
 * Why not the wrapper: its unmount cleanup disposes the two TextModels BEFORE
 * disposing the diff widget. Monaco guards each model with an `onWillDispose`
 * listener that throws
 *   BugIndicatingError('TextModel got disposed before DiffEditorWidget model got reset')
 * whenever a model dies while the widget still references it — so every time
 * this view unmounts (toggling diff off, switching files, leaving the
 * explorer) the wrapper trips that assertion and spams the renderer console.
 *
 * Doing it by hand lets us:
 *   1. Dispose in the correct order — detach the models from the widget
 *      (`setModel(null)`) and dispose the WIDGET first, then the models.
 *   2. Own private model URIs (`diff-orig:` / `diff-mod:` prefixes) so the
 *      diff's "modified" model never aliases the plain editor's model for the
 *      same file path — which previously let the diff editor dispose a model
 *      the main editor still used.
 */
export function DiffViewer({
  original,
  modified,
  language,
  path
}: {
  original: string;
  modified: string;
  language?: string;
  path: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{
    original: monaco.editor.ITextModel;
    modified: monaco.editor.ITextModel;
  } | null>(null);

  // Create the editor + models once per mounted path, and tear them down in
  // the right order on unmount / path change.
  useEffect(() => {
    if (!containerRef.current) return;

    // Private, diff-only URIs so these models can't collide with (or dispose)
    // the plain <Editor>'s model for the same file. createModel throws if a
    // URI is already taken, so dispose any leftover from a previous mount.
    const origUri = monaco.Uri.parse(`diff-orig://${path}`);
    const modUri = monaco.Uri.parse(`diff-mod://${path}`);
    monaco.editor.getModel(origUri)?.dispose();
    monaco.editor.getModel(modUri)?.dispose();

    const originalModel = monaco.editor.createModel(original, language, origUri);
    const modifiedModel = monaco.editor.createModel(modified, language, modUri);
    modelsRef.current = { original: originalModel, modified: modifiedModel };

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'off',
      theme: 'vs-dark'
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    editorRef.current = editor;

    return () => {
      // Order matters: detach + dispose the widget BEFORE the models so the
      // widget's onWillDispose guard never fires on a still-referenced model.
      editor.setModel(null);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = null;
      modelsRef.current = null;
    };
  }, [path, language]);

  // Cheap content updates without recreating the editor (e.g. the file or
  // HEAD blob changed while staying on the same path).
  useEffect(() => {
    const models = modelsRef.current;
    if (!models) return;
    if (models.original.getValue() !== original) models.original.setValue(original);
    if (models.modified.getValue() !== modified) models.modified.setValue(modified);
  }, [original, modified]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}
