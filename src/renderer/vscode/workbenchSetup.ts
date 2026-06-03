// Boot the monaco-vscode-api workbench against a container DIV.
// Lifecycle: call `bootWorkbench` once per app session — the underlying
// services are global-singleton and re-initializing breaks them. Subsequent
// project switches swap the FS provider via `mountProject`.

import { initialize as initializeMonacoService } from '@codingame/monaco-vscode-api';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import {
  registerFileSystemOverlay,
  type IFileSystemProviderWithFileReadWriteCapability
} from '@codingame/monaco-vscode-files-service-override';
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getHostServiceOverride from '@codingame/monaco-vscode-host-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getEditorServiceOverride from '@codingame/monaco-vscode-editor-service-override';
import { buildProjectFileProvider, type ProjectMapping } from './ccFileSystemProvider';
import 'vscode/localExtensionHost';

// Worker map for MonacoEnvironment.getWorkerUrl. Vite's `?worker` import
// gives us a constructor; the workbench wants URLs, so we expose blob URLs.
const workers: Record<string, Worker> = {};

// Stash the boot promise on `globalThis` so HMR module reloads (which create
// fresh module instances with fresh local state) don't re-run `initialize()`
// — the underlying VSCode services are global singletons and a second boot
// throws "There is already an extension with this id" from RegistryImpl.
type BootGlobal = { __ccWorkbenchBooted__?: Promise<void> };
const bootGlobal = globalThis as unknown as BootGlobal;

async function ensureMonacoEnvironment() {
  if ((self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment)
    return;

  const envEditor = (
    await import('monaco-editor/esm/vs/editor/editor.worker?worker')
  ).default;
  const envExtHost = (
    await import('@codingame/monaco-vscode-api/workers/extensionHost.worker?worker')
  ).default;
  const envTextmate = (
    await import('@codingame/monaco-vscode-textmate-service-override/worker?worker')
  ).default;

  workers.editorWorkerService = new envEditor();
  workers.extensionHostWorkerMain = new envExtHost();
  workers.TextMateWorker = new envTextmate();

  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      switch (label) {
        case 'editorWorkerService':
          return new envEditor();
        case 'extensionHostWorkerMain':
          return new envExtHost();
        case 'TextMateWorker':
          return new envTextmate();
        default:
          return new envEditor();
      }
    }
  };
}

export async function bootWorkbench(container: HTMLElement): Promise<void> {
  if (bootGlobal.__ccWorkbenchBooted__) return bootGlobal.__ccWorkbenchBooted__;
  const promise = (async () => {
    await ensureMonacoEnvironment();

    await initializeMonacoService(
      {
        ...getLogServiceOverride(),
        ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
        ...getModelServiceOverride(),
        ...getNotificationsServiceOverride(),
        ...getDialogsServiceOverride(),
        ...getConfigurationServiceOverride(),
        ...getKeybindingsServiceOverride(),
        ...getTextmateServiceOverride(),
        ...getThemeServiceOverride(),
        ...getLanguagesServiceOverride(),
        ...getStorageServiceOverride(),
        ...getLifecycleServiceOverride(),
        ...getEnvironmentServiceOverride(),
        ...getHostServiceOverride(),
        ...getExplorerServiceOverride(),
        ...getEditorServiceOverride(async (model, _options, sideBySide) => {
          // Default fallthrough: workbench's own editor service handles the open.
          // Returning undefined lets the platform pick a sensible target.
          void model;
          void sideBySide;
          return undefined;
        }),
        ...getViewsServiceOverride(),
        ...getWorkbenchServiceOverride(),
        ...getQuickAccessServiceOverride({})
      },
      container,
      {
        productConfiguration: {
          nameShort: 'cc-workbench',
          nameLong: 'Claude Code Workbench'
        }
      }
    );

    await registerExtension(
      {
        name: 'cc-workbench',
        publisher: 'cc',
        version: '1.0.0',
        engines: { vscode: '*' }
      },
      ExtensionHostKind.LocalProcess
    ).setAsDefaultApi();
  })().catch((err) => {
    // Keep retries possible: a failed boot should not poison future attempts.
    bootGlobal.__ccWorkbenchBooted__ = undefined;
    throw err;
  });
  bootGlobal.__ccWorkbenchBooted__ = promise;
  return promise;
}

let activeProvider: { dispose: () => void } | null = null;

export async function mountProject(mapping: ProjectMapping): Promise<void> {
  if (activeProvider) {
    activeProvider.dispose();
    activeProvider = null;
  }
  const provider = await buildProjectFileProvider(mapping);
  const overlay = registerFileSystemOverlay(
    1,
    provider as unknown as IFileSystemProviderWithFileReadWriteCapability
  );
  activeProvider = overlay;
}
