import { useEffect } from 'react';
import { Clock, MessagesSquare } from 'lucide-react';
import { useData } from '../store';
import type { ClaudeSessionSummary } from '@shared/types';

interface Props {
  projectId: string;
  onResume: (s: ClaudeSessionSummary) => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ClaudeSessionsList({ projectId, onResume }: Props) {
  const sessions = useData((s) => s.claudeSessions[projectId]);
  const load = useData((s) => s.loadClaudeSessions);

  useEffect(() => {
    load(projectId);
  }, [projectId, load]);

  if (!sessions) return null;
  if (sessions.length === 0) {
    return <div className="sessions-empty">No previous Claude sessions in this folder.</div>;
  }

  return (
    <div className="sessions">
      <div className="sessions-title">Resume a previous session</div>
      <div className="sessions-list">
        {sessions.slice(0, 8).map((s) => (
          <button key={s.id} className="session-card" onClick={() => onResume(s)}>
            <div className="session-prompt">
              {s.firstUserPrompt ?? <em className="dim">empty session</em>}
            </div>
            <div className="session-meta">
              <span title={new Date(s.lastActiveAt).toLocaleString()}>
                <Clock size={11} /> {timeAgo(s.lastActiveAt)}
              </span>
              <span>
                <MessagesSquare size={11} /> {s.messageCount}
              </span>
              <span className="session-id">{s.id.slice(0, 7)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
