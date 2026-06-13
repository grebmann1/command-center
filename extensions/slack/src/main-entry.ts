/**
 * Main-process entry for the slack DISK extension.
 *
 * The host spawns a per-extension utilityProcess and `import()`s this module
 * there; its `default` export must be a {@link MainModule}. We re-export the
 * existing `slackMainModule` (uses only `ctx.fetch` + `ctx.storage`, no raw Node),
 * so in the isolated child its `ctx.fetch()` calls forward over the broker port
 * and are permission-gated against the manifest's `net` grant +
 * `egressAllowlist: ['slack.com', 'hooks.slack.com', 'api.slack.com']`.
 */
import { slackMainModule } from '../../../plugins/slack/main/slack-main.js';

export default slackMainModule;
