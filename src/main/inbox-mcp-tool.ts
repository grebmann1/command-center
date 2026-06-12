/**
 * inbox_push — project-scoped outbound channel to the user's inbox.
 *
 * This is a **project-scoped tool factory**. The agent inside a project
 * sees only `{ docs?, comments? }` in the schema; the projectId is filled
 * by the MCP router from the URL path (`/mcp/:projectId`) and closed over
 * by the factory's `register()` at request time. Hiding projectId from the
 * schema is deliberate: it makes forgery impossible (agent can't push to
 * a different project's inbox) and removes a projectId parameter the agent
 * would otherwise have to manage.
 *
 * Modeled after OpenAlice's `src/tool/inbox-push.ts`.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IInboxStore } from './inbox-store.js';
import type { InboxNotifyLevel } from '../shared/types.js';

/**
 * Description shown to the LLM. Taken near-verbatim from
 * `/tmp/OpenAlice/src/tool/inbox-push.ts:25-43`, retargeted to "project".
 */
export const INBOX_PUSH_DESCRIPTION = [
  "Push an update to the user's inbox from this project.",
  'Use this when you have something the user should see —',
  'a finished analysis (point to the report file via `docs`),',
  'a question back to the user (write it as `comments`),',
  'a blocked task that needs input, or a status check-in.',
  '',
  '`docs` are paths relative to this project root. Each one',
  'is rendered live in the inbox UI when the user opens the',
  'entry — no snapshot is taken, so later edits to the file',
  'will be reflected on subsequent reads.',
  '',
  '`comments` is markdown — your voice to the user about what',
  'you did or want to ask. Keep it short and direct; if more',
  'detail is needed put it in a doc and reference it.',
  '',
  'At least one of `docs` or `comments` must be present.'
].join(' ');

/**
 * Tool input schema as a `ZodRawShape` (the SDK wraps it in `z.object`
 * itself). Note the absence of `projectId`: the agent cannot supply or
 * forge one — the router closes over it from the URL path.
 */
export const inboxPushInputSchema = {
  docs: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Relative path to a file inside this project, e.g. 'docs/report.md'."
          )
      })
    )
    .optional()
    .describe(
      'Project files to surface in the inbox entry. Rendered live, not snapshotted.'
    ),
  comments: z
    .string()
    .optional()
    .describe(
      "Your message to the user (markdown). Renders below docs in the inbox detail pane."
    )
};

export interface RegisterInboxPushOpts {
  projectId: string;
  /** Display label snapshot. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /**
   * Originating terminal session, when the MCP route is session-scoped
   * (`/mcp/:projectId/:sessionId`). Stamped onto the inbox entry so the
   * UI can route the "Open" click back to that exact tab. Absent when
   * the agent connects on the project-scoped legacy route.
   */
  sessionId?: string;
  /** True when the originating session is a scheduled (background) run. */
  scheduled?: boolean;
  /**
   * Scheduled loudness for this session's pushes. `silent` drops the push
   * (recorded as success to the agent, but nothing written); `quiet`/`loud`
   * are stamped onto the entry. Absent for non-scheduled sessions, whose
   * pushes are always written and treated as loud.
   */
  notify?: InboxNotifyLevel;
  inboxStore: IInboxStore;
}

/**
 * Register the `inbox_push` tool on the given `McpServer`. The handler
 * closes over `projectId` (from the URL match) and `projectLabel` (from
 * the project registry) at register-time. Re-built per-request so a
 * deleted-then-recreated project doesn't bleed identity across requests.
 */
export function registerInboxPushTool(server: McpServer, opts: RegisterInboxPushOpts): void {
  const { projectId, projectLabel, sessionId, scheduled, notify, inboxStore } = opts;

  server.registerTool(
    'inbox_push',
    {
      description: INBOX_PUSH_DESCRIPTION,
      inputSchema: inboxPushInputSchema
    },
    async ({ docs, comments }) => {
      try {
        // A `silent` schedule suppresses inbox entirely. Report success so the
        // agent doesn't retry or treat its check-in as failed — the schedule
        // simply opted out of surfacing.
        if (notify === 'silent') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Suppressed: this scheduled run has inbox notifications set to silent.'
              }
            ]
          };
        }
        const entry = await inboxStore.append({
          projectId,
          projectLabel,
          docs,
          comments,
          sessionId,
          scheduled,
          notify
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Pushed to inbox. id=${entry.id} ts=${entry.ts}`
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `inbox_push failed: ${message}`
            }
          ]
        };
      }
    }
  );
}
