import { useUi } from '../store';
import { InboxDetail } from './InboxDetail';

/**
 * Inbox detail surface mounted in the app shell's main column when
 * nav==='inbox'. The list lives in `ListPane`'s inbox branch alongside
 * the existing Projects/Settings list panes, so the two-pane layout
 * (sidebar list + detail) reuses the existing 3-column app grid
 * (nav | list | main).
 */
export function InboxView() {
  const nav = useUi((s) => s.nav);
  return (
    <section className="inbox-view">
      <InboxDetail visible={nav === 'inbox'} />
    </section>
  );
}
