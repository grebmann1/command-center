/**
 * Renderer entry for the slack DISK extension.
 *
 * Default-exports a {@link RendererEntry}. The host loader blob-imports this
 * bundle and calls `activate({ React, host })`; we capture the host React into
 * the in-bundle holder (see ./host-react) BEFORE returning anything, so every
 * hook/JSX call the panel makes at render resolves against the host's single
 * React instance. Then we return the panel component.
 */
import type { RendererEntry, ActivateResult } from '@cctc/extension-sdk/renderer';
import { setHostReact } from './host-react.js';
import SlackPanel from '../../../plugins/slack/renderer/SlackPanel.js';

const entry: RendererEntry = {
  activate({ React }): ActivateResult {
    // MUST run before the panel renders — primes the react / jsx-runtime shims.
    setHostReact(React);

    return {
      panel: SlackPanel
      // No commands or navBadge in v1.
    };
  }
};

export default entry;
