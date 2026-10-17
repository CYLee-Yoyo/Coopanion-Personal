/** Public release reports and local requests for manual integration in Codex. */
import { invokePanel } from '../../base/api.ts';
import { LANGUAGE } from '../../base/language.ts';
import type { Page, PageContext } from '../../base/page.ts';
import { intro } from '../intro.ts';
import { PERSONAL_FEATURES } from '../../../core/personal-upstream.ts';
import { upstreamText } from '../../../core/upstream-strings.ts';
import type { UpstreamState } from '../../../core/upstream-types.ts';

const S = upstreamText(LANGUAGE);
const PAGE = 'world:coopanion';

export async function mountUpdates(ctx: PageContext): Promise<void> {
  const { root, ui, signal } = ctx;
  root.classList.add('home', 'upstream-page');
  const call = <T>(method: string, args: unknown[] = [], mutation = false) => invokePanel<T>(PAGE, 'updates', method, args,
    mutation ? { keepalive: true } : { signal });
  const status = ui.msgline('');
  status.setAttribute('aria-live', 'polite');
  const failure = ui.msgline('', true);
  const reason = ui.msgline('', true);
  reason.setAttribute('aria-live', 'polite');
  const enabled = ui.checkbox(S.enabled, { onChange: on => void act('enabled', [on]) });
  const check = ui.button(S.check, { variant: 'primary', onClick: () => void act('check') });
  const retry = ui.button(S.retry, { onClick: () => void act('retry') });
  root.append(intro(ui, S.nav, { actions: [check] }));
  const settings = ui.sheet({ title: S.nav, desc: S.schedule });
  const controls = ui.rowbar();
  controls.append(enabled.el, retry);
  const meta = ui.h('dl', 'upstream-meta');
  settings.body.append(controls, status, reason, failure, meta, ui.h('p', 'home-note', S.scope));
  root.append(settings.el);
  const reportBox = ui.h('div');
  root.append(reportBox);

  let current: UpstreamState | null = null;
  let renderedKey = '';
  let decisionAt = 0;
  let busy = false;
  let loading = false;
  let dirty = false;
  let requestText = '';
  let requestPath: HTMLElement | null = null;
  let requestPreview: HTMLTextAreaElement | null = null;
  let requestCopy: HTMLButtonElement | null = null;
  let decisionStatus: HTMLElement | null = null;
  let save: HTMLButtonElement | null = null;
  let skip: HTMLButtonElement | null = null;
  const keepControls = new Map<string, ReturnType<typeof ui.checkbox>>();
  let note: HTMLTextAreaElement | null = null;
  const list = (title: string, values: string[]) => {
    const section = ui.h('section');
    section.append(ui.h('h4', '', title));
    const ul = ui.h('ul');
    for (const text of values) ul.append(ui.h('li', '', text));
    section.append(ul);
    return section;
  };
  const external = (text: string, href: string) => {
    const a = ui.h('a', '', text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };

  const renderReport = (state: UpstreamState) => {
    const report = state.report;
    const key = report?.key ?? '';
    if (key === renderedKey) return;
    renderedKey = key;
    reportBox.replaceChildren();
    keepControls.clear();
    dirty = false; decisionAt = 0; requestText = '';
    requestPath = requestPreview = requestCopy = decisionStatus = save = skip = note = null;
    if (!report) return;
    const card = ui.sheet({ title: `${report.baseline} → ${report.release.version}` });
    card.body.append(ui.h('p', '', report.analysis.summary),
      ui.h('p', 'home-note', `${S.model}: ${report.model} · ${new Date(report.analyzedAt).toLocaleString()}`),
      list(S.changes, report.analysis.changes), list(S.risks, report.analysis.risks),
      list(S.features, report.analysis.features.map(f => `${S.featureNames[f.id]}: ${f.assessment}`)),
      ui.h('h4', '', S.recommendation), ui.h('p', '', report.analysis.recommendation),
      ui.h('h4', '', S.limitations), ui.h('p', 'home-note', S.limits));
    if (report.limitations.length) card.body.append(ui.h('p', 'upstream-codes', report.limitations.join(' · ')));
    const links = ui.rowbar();
    links.append(external(S.compare, report.compareUrl), external(S.release, `https://github.com/Pal-AI-Lab/Coopanion/releases/tag/${encodeURIComponent(report.release.tag)}`));
    card.body.append(links);
    const files = ui.h('details');
    files.append(ui.h('summary', '', `${S.files} (${report.changedFiles.length})`));
    const paths = ui.h('ul', 'upstream-files');
    for (const file of report.changedFiles) paths.append(ui.h('li', '', `${file.repository}/${file.path} (+${file.additions} −${file.deletions})`));
    files.append(paths);
    const notes = ui.h('details');
    notes.append(ui.h('summary', '', S.notes), ui.h('pre', 'upstream-notes', report.release.notes));
    card.body.append(files, notes);
    reportBox.append(card.el);

    const decision = ui.sheet({ title: S.keep });
    for (const feature of PERSONAL_FEATURES) {
      const checkbox = ui.checkbox(S.featureNames[feature.id], { checked: true, onChange: () => { dirty = true; } });
      keepControls.set(feature.id, checkbox);
      const row = ui.h('div', 'upstream-keep');
      row.append(checkbox.el);
      decision.body.append(row);
    }
    note = ui.textarea({ placeholder: S.note, rows: 3 });
    note.maxLength = 4000;
    note.setAttribute('aria-label', S.note);
    note.addEventListener('input', () => { dirty = true; }, { signal });
    save = ui.button(S.save, { variant: 'primary', onClick: () => void decide('update') });
    skip = ui.button(S.skip, { onClick: () => void decide('skip') });
    const actions = ui.rowbar();
    actions.append(save, skip);
    decisionStatus = ui.msgline('');
    requestPath = ui.h('p', 'home-note');
    requestPreview = ui.textarea({ rows: 10 });
    requestPreview.readOnly = true;
    requestPreview.setAttribute('aria-label', S.copy);
    requestCopy = ui.copyButton(() => requestText, { label: S.copy });
    decision.body.append(note, actions, decisionStatus, requestPath, requestCopy, requestPreview);
    reportBox.append(decision.el);
  };

  const render = async (state: UpstreamState) => {
    if (signal.aborted) return;
    current = state;
    enabled.setChecked(state.enabled);
    check.disabled = busy || !state.enabled || state.phase === 'checking' || state.phase === 'analyzing';
    retry.hidden = state.report !== null || !['failed', 'interrupted'].includes(state.phase);
    retry.disabled = busy || !state.enabled;
    status.textContent = S.phases[state.phase];
    status.classList.toggle('bad', state.phase === 'failed' || state.phase === 'interrupted');
    const detail = ['checking', 'analyzing'].includes(state.phase) ? null : state.failure ?? (state.error === 'analysis' ? 'unknown' : state.error);
    reason.textContent = detail ? S.failures[detail] : '';
    reason.hidden = !reason.textContent;
    meta.replaceChildren();
    const date = (at: number | null) => at === null ? S.none : new Date(at).toLocaleString();
    for (const [label, value] of [[S.installed, state.installedVersion], [S.baseline, state.baseline],
      [S.latest, state.latest?.version ?? S.none], [S.last, date(state.lastCheckedAt)], [S.next, state.enabled ? date(state.nextCheckAt) : '—']]) {
      meta.append(ui.h('dt', '', label), ui.h('dd', '', value));
    }
    renderReport(state);
    if (save && skip) { save.disabled = skip.disabled = busy || state.phase === 'checking' || state.phase === 'analyzing'; }
    if (decisionStatus) decisionStatus.textContent = state.decision?.choice === 'skip' ? S.skipped : state.requestSaved ? S.saved : '';
    if (requestPath && requestPreview && requestCopy) {
      requestPath.hidden = requestPreview.hidden = requestCopy.hidden = !state.requestSaved;
      if (!state.requestSaved) requestText = '';
    }
    if (state.decision && state.decision.at !== decisionAt) {
      decisionAt = state.decision.at;
      if (!dirty) {
        for (const [id, checkbox] of keepControls) checkbox.setChecked(state.decision.keep.some(kept => kept === id));
        if (note) note.value = state.decision.note;
      }
      if (state.requestSaved) {
        let request: { path: string; text: string } | null;
        try { request = await call('request'); }
        catch (error) { decisionAt = 0; throw error; }
        if (!signal.aborted && current?.decision?.at === decisionAt && request) {
          requestText = request.text;
          if (requestPath) requestPath.textContent = request.path;
          if (requestPreview) requestPreview.value = request.text;
        }
      }
    }
  };
  async function act(method: string, args: unknown[] = []): Promise<void> {
    if (busy) return;
    busy = true; failure.textContent = '';
    try { await render(await call<UpstreamState>(method, args, true)); }
    catch { if (!signal.aborted) failure.textContent = S.failure; }
    finally { busy = false; if (current && !signal.aborted) await render(current); }
  }
  async function decide(choice: 'update' | 'skip'): Promise<void> {
    if (!current?.report) return;
    const keep = [...keepControls].filter(([, box]) => box.input.checked).map(([id]) => id);
    await act('decide', [current.report.key, choice, keep, note?.value ?? '']);
  }
  const refresh = async () => {
    if (loading || busy || signal.aborted) return;
    loading = true;
    try { const state = await call<UpstreamState>('state'); failure.textContent = ''; await render(state); }
    catch { if (!signal.aborted) failure.textContent = S.failure; }
    finally { loading = false; }
  };
  await refresh();
  ctx.lifecycle.interval(() => void refresh(), 4000);
}

export const updatesPage: Page = { route: 'updates', label: S.nav, icon: 'refresh', mount: mountUpdates };
