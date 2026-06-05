import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BookOpen,
  FolderOpen,
  Layers,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type {
  SkillBundle,
  SkillBundleApplyMode,
  SkillEntry,
  SkillSource
} from '@shared/types';
import { useData, useUi } from '../store';

const SOURCE_FILTERS: Array<{ id: 'all' | SkillSource; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'project', label: 'Project' }
];

const SOURCE_LABEL: Record<SkillSource, string> = {
  user: 'User',
  plugin: 'Plugin',
  project: 'Project'
};

export function SkillsPanel() {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [bundles, setBundles] = useState<SkillBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | SkillSource>('all');
  const [query, setQuery] = useState('');
  const [editingBundle, setEditingBundle] = useState<SkillBundle | 'new' | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, bundleList] = await Promise.all([
        window.cc.skills.list(selectedProject?.path),
        window.cc.skills.bundles.list()
      ]);
      setSkills(list);
      setBundles(bundleList);
    } catch {
      /* swallow — onChanged will retry */
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.path]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const offSkills = window.cc.skills.onChanged(() => {
      reload();
    });
    const offBundles = window.cc.skills.bundles.onChanged((next) => {
      setBundles(next);
    });
    return () => {
      offSkills();
      offBundles();
    };
  }, [reload]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const t = window.setTimeout(() => setSavedFlash(false), 1400);
    return () => window.clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (filter !== 'all' && s.source !== filter) return false;
      if (!q) return true;
      const haystack = `${s.name} ${s.description ?? ''} ${s.pluginName ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [skills, filter, query]);

  const counts = useMemo(() => {
    const c = { all: skills.length, user: 0, plugin: 0, project: 0 };
    for (const s of skills) c[s.source] += 1;
    return c;
  }, [skills]);

  const toggleSkill = async (skill: SkillEntry, enabled: boolean) => {
    setSkills((prev) =>
      prev.map((s) => (s.name === skill.name ? { ...s, enabled } : s))
    );
    try {
      await window.cc.skills.setEnabled(skill.name, enabled);
      flashSaved();
    } catch {
      // revert on failure
      setSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? { ...s, enabled: !enabled } : s))
      );
    }
  };

  const reveal = (skill: SkillEntry) => {
    window.cc.skills.reveal(skill.id, selectedProject?.path).catch(() => {});
  };

  const applyBundle = async (bundle: SkillBundle, mode: SkillBundleApplyMode) => {
    const result = await window.cc.skills.bundles.apply(
      bundle.id,
      mode,
      selectedProject?.path
    );
    if (result.ok) {
      await reload();
      flashSaved();
    }
  };

  const deleteBundle = async (bundle: SkillBundle) => {
    if (!confirm(`Delete bundle "${bundle.name}"?`)) return;
    await window.cc.skills.bundles.delete(bundle.id);
    setBundles((prev) => prev.filter((b) => b.id !== bundle.id));
  };

  return (
    <main className="settings-panel skills-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Skills</h2>
            <p className="settings-help scheduler-subtitle">
              Discover skills from <code>~/.claude/skills</code>,{' '}
              <code>~/.claude/plugins</code>, and the active project's{' '}
              <code>.claude/skills</code>. Toggling a skill writes to{' '}
              <code>disabledSkills</code> in <code>~/.claude/settings.json</code>.
              Group skills into bundles to enable/disable them in batches.
            </p>
          </div>
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
                  placeholder="Search skills…"
                  aria-label="Search skills"
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
                    <span className="skills-filter-count">
                      {f.id === 'all' ? counts.all : counts[f.id]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="scheduler-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <BookOpen size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {skills.length === 0 ? 'No skills found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {filter === 'project' && !selectedProject
                    ? 'Select a project in the sidebar to see project-scoped skills.'
                    : skills.length === 0
                      ? 'Drop a skill in ~/.claude/skills, or install a plugin that ships skills.'
                      : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    onToggle={(enabled) => toggleSkill(skill, enabled)}
                    onReveal={() => reveal(skill)}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="skills-right">
            <div className="skills-bundles-header">
              <h3>
                <Layers size={14} /> Bundles
              </h3>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => setEditingBundle('new')}
              >
                <Plus size={12} /> New
              </button>
            </div>
            <p className="settings-help">
              A bundle is a saved set of skills you can enable in one click.
              Apply additively to layer it on, or exclusively to enable only the
              bundle's skills.
            </p>
            {bundles.length === 0 ? (
              <div className="skills-bundles-empty">
                No bundles yet. Click <strong>New</strong> to create one.
              </div>
            ) : (
              <ul className="skills-bundles-list">
                {bundles.map((bundle) => (
                  <BundleRow
                    key={bundle.id}
                    bundle={bundle}
                    skills={skills}
                    onApply={(mode) => applyBundle(bundle, mode)}
                    onEdit={() => setEditingBundle(bundle)}
                    onDelete={() => deleteBundle(bundle)}
                  />
                ))}
              </ul>
            )}
          </aside>
        </div>

        {savedFlash && <div className="settings-saved">Saved</div>}
      </div>

      {editingBundle && (
        <BundleEditorModal
          bundle={editingBundle === 'new' ? null : editingBundle}
          allSkills={skills}
          onClose={() => setEditingBundle(null)}
          onSaved={() => {
            setEditingBundle(null);
            flashSaved();
          }}
        />
      )}
    </main>
  );
}

function SkillRow({
  skill,
  onToggle,
  onReveal
}: {
  skill: SkillEntry;
  onToggle: (enabled: boolean) => void;
  onReveal: () => void;
}) {
  const subtitle = (() => {
    if (skill.source === 'plugin' && skill.pluginName) {
      return `Plugin · ${skill.pluginName}`;
    }
    if (skill.source === 'project') return 'Project';
    return 'User';
  })();

  return (
    <li className={`skills-row ${skill.enabled ? '' : 'is-disabled'}`}>
      <label className="skills-row-toggle" title={skill.enabled ? 'Disable' : 'Enable'}>
        <input
          type="checkbox"
          checked={skill.enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span aria-hidden />
      </label>
      <div className="skills-row-body">
        <div className="skills-row-head">
          <span className="skills-row-name">{skill.name}</span>
          <span className={`scheduler-pill scheduler-pill--source skills-source-${skill.source}`}>
            {subtitle}
          </span>
        </div>
        {skill.description && (
          <p className="skills-row-desc">{skill.description}</p>
        )}
      </div>
      <button
        type="button"
        className="scheduler-icon-btn"
        onClick={onReveal}
        title="Reveal in Finder"
        aria-label="Reveal in Finder"
      >
        <FolderOpen size={14} />
      </button>
    </li>
  );
}

function BundleRow({
  bundle,
  skills,
  onApply,
  onEdit,
  onDelete
}: {
  bundle: SkillBundle;
  skills: SkillEntry[];
  onApply: (mode: SkillBundleApplyMode) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const known = useMemo(() => {
    const ids = new Set(skills.map((s) => s.id));
    let resolved = 0;
    for (const id of bundle.skillIds) if (ids.has(id)) resolved += 1;
    return { resolved, total: bundle.skillIds.length };
  }, [bundle.skillIds, skills]);

  return (
    <li className="skills-bundle-card">
      <div className="skills-bundle-head">
        <button
          type="button"
          className="skills-bundle-name"
          onClick={onEdit}
          title="Edit bundle"
        >
          {bundle.name}
        </button>
        <button
          type="button"
          className="scheduler-icon-btn scheduler-icon-btn--danger"
          onClick={onDelete}
          title="Delete bundle"
          aria-label="Delete bundle"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {bundle.description && (
        <p className="skills-bundle-desc">{bundle.description}</p>
      )}
      <div className="skills-bundle-meta">
        <span className="scheduler-pill">
          {known.resolved} / {known.total} skills
        </span>
      </div>
      <div className="skills-bundle-actions">
        <button
          type="button"
          className="settings-btn"
          onClick={() => onApply('additive')}
          title="Enable bundle's skills; leave others alone"
        >
          Apply (additive)
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={() => onApply('exclusive')}
          title="Enable bundle's skills; disable everything else"
        >
          Apply (exclusive)
        </button>
      </div>
    </li>
  );
}

function BundleEditorModal({
  bundle,
  allSkills,
  onClose,
  onSaved
}: {
  bundle: SkillBundle | null;
  allSkills: SkillEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = bundle === null;
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(bundle?.skillIds ?? [])
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter((s) =>
      `${s.name} ${s.description ?? ''} ${s.pluginName ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [allSkills, query]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        skillIds: [...selectedIds]
      };
      if (isNew) {
        await window.cc.skills.bundles.create(input);
      } else {
        await window.cc.skills.bundles.update(bundle!.id, input);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal skills-bundle-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'New bundle' : 'Edit bundle'}
      >
        <header className="modal-header">
          <h3>{isNew ? 'New bundle' : `Edit bundle · ${bundle?.name}`}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="scheduler-form-field">
            <label htmlFor="bundle-name">Name</label>
            <input
              id="bundle-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Frontend skills"
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="bundle-desc">
              Description <span className="scheduler-form-optional">(optional)</span>
            </label>
            <input
              id="bundle-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="scheduler-form-field">
            <label>
              Skills{' '}
              <span className="scheduler-form-optional">
                ({selectedIds.size} selected)
              </span>
            </label>
            <div className="skills-search skills-search--modal">
              <Search size={14} aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
              />
            </div>
            <ul className="skills-bundle-picker">
              {filtered.map((s) => (
                <li key={s.id} className="skills-bundle-picker-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="skills-bundle-picker-name">{s.name}</span>
                    <span className="scheduler-pill scheduler-pill--source">
                      {SOURCE_LABEL[s.source]}
                      {s.pluginName ? ` · ${s.pluginName}` : ''}
                    </span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="skills-bundle-picker-empty">No skills match.</li>
              )}
            </ul>
          </div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={save}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : isNew ? 'Create bundle' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}
