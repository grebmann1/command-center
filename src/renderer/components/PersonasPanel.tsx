import { useMemo, useState } from 'react';
import { Bot, FolderOpen, Search } from 'lucide-react';
import type { Persona } from '@shared/types';
import { usePersonas } from '../store';
import { personaIcon } from '../util/profileIcon';

/**
 * Personas management panel — a read-only catalogue of launchable personas
 * (builtin ⊕ ~/.cc-center/personas ⊕ <project>/.cc-center/personas), merged and
 * pushed by the main process. Authoring is by hand-editing the JSON files the
 * "Reveal" button opens; this panel surfaces what's discovered, grouped by
 * source. Mirrors the read-only shape of SkillsPanel.
 */

type SourceKind = 'all' | 'builtin' | 'user' | 'project';

const SOURCE_FILTERS: Array<{ id: SourceKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Builtin' },
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' }
];

/** Classify a persona's source into one of the filter buckets. */
function sourceKind(source: Persona['source']): Exclude<SourceKind, 'all'> {
  if (source === 'builtin') return 'builtin';
  if (source === 'user') return 'user';
  return 'project';
}

function sourceLabel(source: Persona['source']): string {
  if (source === 'builtin') return 'Builtin';
  if (source === 'user') return 'User';
  if (source && typeof source === 'object') {
    return source.projectName ? `Project · ${source.projectName}` : 'Project';
  }
  return 'User';
}

export function PersonasPanel() {
  const personas = usePersonas((s) => s.personas);
  const loading = usePersonas((s) => s.loading);
  const [filter, setFilter] = useState<SourceKind>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return personas.filter((p) => {
      if (filter !== 'all' && sourceKind(p.source) !== filter) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.id} ${p.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [personas, filter, query]);

  const counts = useMemo(() => {
    const c = { all: personas.length, builtin: 0, user: 0, project: 0 };
    for (const p of personas) c[sourceKind(p.source)] += 1;
    return c;
  }, [personas]);

  const revealDir = () => {
    window.cc.personas.revealDir().catch(() => {});
  };

  return (
    <main className="settings-panel skills-panel personas-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Personas</h2>
            <p className="settings-help scheduler-subtitle">
              Named, reusable launch profiles — a bundle of <code>claude</code> flags
              (system prompt, model, permission mode, allowed tools). Discovered from{' '}
              <code>~/.cc-center/personas</code> and each project's{' '}
              <code>.cc-center/personas</code>. Pick one in the “+” launcher to start a
              session as that persona. Edit the JSON files to author your own.
            </p>
          </div>
          <button
            type="button"
            className="settings-btn"
            onClick={revealDir}
            title="Open the personas directory in Finder"
          >
            <FolderOpen size={12} /> Reveal personas dir
          </button>
        </div>

        <div className="skills-layout">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-search">
                <Search size={14} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search personas…"
                  aria-label="Search personas"
                />
              </div>
              <div className="skills-filter" role="tablist" aria-label="Source filter">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`skills-filter-btn ${filter === f.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="skills-filter-count">{counts[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="scheduler-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <Bot size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {personas.length === 0 ? 'No personas found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {personas.length === 0
                    ? 'Drop a persona JSON in ~/.cc-center/personas, or use a builtin.'
                    : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((p) => (
                  <PersonaRow key={p.id} persona={p} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function PersonaRow({ persona }: { persona: Persona }) {
  const meta: string[] = [];
  if (persona.baseProfile) meta.push(persona.baseProfile);
  if (persona.model && persona.model !== 'default') meta.push(persona.model);
  if (persona.permissionMode && persona.permissionMode !== 'default') {
    meta.push(persona.permissionMode);
  }

  return (
    <li className="skills-row">
      <span className="tab-profile-icon" aria-hidden="true">
        {personaIcon(persona)}
      </span>
      <div className="skills-row-body">
        <div className="skills-row-head">
          <span className="skills-row-name">{persona.name}</span>
          <span className="scheduler-pill scheduler-pill--source">
            {sourceLabel(persona.source)}
          </span>
          {meta.map((m) => (
            <span key={m} className="scheduler-pill">
              {m}
            </span>
          ))}
        </div>
        {persona.description && <p className="skills-row-desc">{persona.description}</p>}
      </div>
    </li>
  );
}
