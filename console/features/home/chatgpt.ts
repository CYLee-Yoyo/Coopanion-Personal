/** Subscription account controls call the provider console; tokens never enter the renderer. */
import { post } from '../../base/api.ts';
import { LANGUAGE } from '../../base/language.ts';
import type { PageContext } from '../../base/page.ts';
import { personalText } from './personal-strings.ts';
import { modelPicker } from './model-picker.ts';

interface State { connected: boolean; sharing: boolean; pending: boolean; email: string | null; error: string | null; blocked: string | null; account: string | null; selectedModel: string | null }
interface Model { id: string; displayName?: string }
const AUTH_PATH = '/api/console/providers/llm%3Achatgpt-plan/panels/auth/';

export function mountChatGPT(ctx: PageContext) {
  const { ui, root, signal } = ctx;
  const text = personalText(LANGUAGE);
  const model = ui.sheet({ title: text.title });
  const stateLine = ui.h('p', 'home-note', text.disconnected);
  const note = ui.h('p', 'home-note', text.note);
  const credits = ui.h('p', 'home-note', text.credits);
  const message = ui.msgline('');
  const signIn = ui.button('Continue with ChatGPT', { variant: 'primary' });
  const cancel = ui.button(text.cancel, { size: 'sm' });
  const signOut = ui.button(text.signout, { size: 'sm' });
  const usage = ui.button(text.usage, { size: 'sm' });
  const picker = modelPicker(ui, signal, text.model, () => void saveSelection());
  const select = picker.control;
  const test = ui.button(text.test, { variant: 'primary' });
  const actions = ui.rowbar(); actions.append(signIn, cancel, signOut, usage);
  const modelField = ui.h('div', 'fieldrow'); modelField.append(ui.h('span', 'fieldlabel', text.model), picker.el);
  const models = ui.rowbar(); models.append(modelField, test);
  model.body.append(stateLine, note, actions, models, message, credits);
  root.append(model.el);
  let busy = false;
  let account: string | null = null;
  let loading: Promise<void> | null = null;
  let state: State | null = null;
  const call = <T>(method: string, args: unknown[] = []) => post<T>(`${AUTH_PATH}${method}`, { args }, { signal });
  const showError = (error: unknown) => { message.textContent = error instanceof Error ? error.message : text.failed; message.classList.add('bad'); };
  const controls = () => {
    signIn.disabled = busy || state?.pending === true;
    cancel.hidden = !state?.pending;
    signOut.hidden = !state?.connected;
    signOut.disabled = busy;
    select.disabled = busy || loading !== null || !state?.sharing;
    if (select.disabled) picker.close();
    test.disabled = busy || loading !== null || !state?.sharing || !select.value;
    models.hidden = !state?.sharing;
  };
  const loadModels = async () => {
    const rows = await call<Model[]>('models');
    const previous = select.value;
    picker.setOptions(rows);
    if (picker.has(previous)) picker.setValue(previous);
    if (state?.selectedModel && picker.has(state.selectedModel)) picker.setValue(state.selectedModel);
    if (!rows.length) throw new Error(text.noModels);
  };
  const refreshModel = async () => {
    try {
      state = await call<State>('state');
      stateLine.textContent = state.pending ? text.pending : state.sharing ? `${text.connected} ${state.email ?? ''}` : state.error ?? text.disconnected;
      if (state.blocked) { message.textContent = state.blocked; message.classList.add('bad'); }
      if (state.sharing && (state.account !== account || !picker.length) && !loading) {
        account = state.account;
        loading = loadModels().catch(showError).finally(() => { loading = null; controls(); });
        await loading;
      }
      if (!state.sharing) { account = null; picker.setOptions([]); }
      if (!busy && state.selectedModel && picker.has(state.selectedModel)) picker.setValue(state.selectedModel);
      controls();
    } catch (error) { if (!signal.aborted) showError(error); }
  };
  const action = async (method: 'signin' | 'cancel' | 'signout' | 'usage') => {
    busy = true; controls(); message.textContent = ''; message.classList.remove('bad');
    try { await call(method); await refreshModel(); }
    catch (error) { showError(error); }
    finally { busy = false; controls(); }
  };
  signIn.addEventListener('click', () => void action('signin'), { signal });
  cancel.addEventListener('click', () => void action('cancel'), { signal });
  signOut.addEventListener('click', () => void action('signout'), { signal });
  usage.addEventListener('click', () => void action('usage'), { signal });
  const saveSelection = async () => {
    const selected = select.value;
    busy = true; controls(); message.textContent = text.saving; message.classList.remove('bad');
    try {
      // A submitted setting survives page navigation; only updates to this view are cancelled.
      await post(`${AUTH_PATH}select`, { args: [selected] }, { keepalive: true });
      if (!signal.aborted) { message.textContent = text.saved; message.classList.remove('bad'); }
    } catch (error) { if (!signal.aborted) showError(error); }
    finally { busy = false; if (!signal.aborted) { await refreshModel(); controls(); } }
  };
  test.addEventListener('click', async () => {
    busy = true; controls(); message.textContent = text.testing; message.classList.remove('bad');
    try {
      await call('select', [select.value]);
      const result = await post<{ ok: boolean; error?: string; elapsedMs?: number }>('/api/providers/chatgpt-plan/test', {}, { signal });
      if (!result.ok) throw new Error(result.error ?? text.failed);
      await post('/api/providers/chatgpt-plan/activate', {}, { signal });
      await post('/api/run/resume', {}, { signal });
      message.textContent = text.success;
      message.classList.remove('bad');
    } catch (error) { showError(error); }
    finally { busy = false; await refreshModel(); controls(); }
  }, { signal });
  controls();
  return { model, refreshModel };
}
