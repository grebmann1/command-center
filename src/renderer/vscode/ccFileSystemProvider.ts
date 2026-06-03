// Custom IFileSystemProvider that proxies project files through window.cc.fs IPC.
// Mounts under the `cc:` URI scheme; URI shape is `cc://<projectId>/<rel-path>`,
// and we translate to absolute paths via the projectRoots map populated by the
// caller. v1 is read-only and matches the existing ExplorerView surface.

import {
  RegisteredFileSystemProvider,
  RegisteredReadOnlyFile,
  RegisteredFile
} from '@codingame/monaco-vscode-files-service-override';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';

export interface ProjectMapping {
  projectId: string;
  absRoot: string;
}

// Build a fresh provider for one project. Caller is responsible for disposing
// it (and registering a new one) when the active project changes.
export async function buildProjectFileProvider(
  mapping: ProjectMapping
): Promise<RegisteredFileSystemProvider> {
  const provider = new RegisteredFileSystemProvider(true /* readonly */);
  const list = await window.cc.fs.walkFiles(mapping.absRoot);

  for (const f of list) {
    const uri = URI.from({
      scheme: 'cc',
      authority: mapping.projectId,
      path: '/' + f.rel
    });
    const file: RegisteredFile = new RegisteredReadOnlyFile(
      uri,
      async () => {
        const r = await window.cc.fs.readFile(f.path);
        if (!r.ok || !r.content) return new Uint8Array(0);
        return new TextEncoder().encode(r.content);
      },
      // Size is unknown until read; the workbench tolerates lazy size.
      0
    );
    provider.registerFile(file);
  }
  return provider;
}
