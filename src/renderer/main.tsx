import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// Prevent the OS from navigating to files dropped outside the terminal area.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('error', (event) => {
  const err = event.error instanceof Error ? event.error.stack || event.error.message : event.message;
  console.error('[renderer] window error:', err);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
  console.error('[renderer] unhandled rejection:', reason);
});

const root = document.getElementById('root');
if (!root) {
  console.error('[renderer] root element not found');
} else {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
