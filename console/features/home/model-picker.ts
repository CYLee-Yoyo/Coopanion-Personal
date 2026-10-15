import type { PageContext } from '../../base/page.ts';

let pickerId = 0;

/** An in-document list keeps the expanded options on the console palette in Electron. */
export function modelPicker(ui: PageContext['ui'], signal: AbortSignal, label: string, onChange: () => void) {
  const el = ui.h('div', 'home-model-picker');
  const control = ui.h('button', 'field home-chatgpt-model');
  control.type = 'button';
  control.setAttribute('role', 'combobox');
  control.setAttribute('aria-label', label);
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute('aria-expanded', 'false');
  const list = ui.h('ul', 'home-model-options');
  list.id = `home-model-options-${++pickerId}`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  list.hidden = true;
  control.setAttribute('aria-controls', list.id);
  el.append(control, list);
  let rows: { id: string; displayName?: string }[] = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    control.setAttribute('aria-expanded', 'false');
    control.removeAttribute('aria-activedescendant');
  };
  const highlight = (index: number) => {
    active = index;
    Array.from(list.children).forEach((option, i) => option.classList.toggle('active', i === index));
    const option = list.children[index] as HTMLElement | undefined;
    if (option) {
      control.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView?.({ block: 'nearest' });
    }
  };
  const open = () => {
    if (control.disabled || !rows.length) return;
    list.hidden = false;
    control.setAttribute('aria-expanded', 'true');
    highlight(Math.max(0, rows.findIndex(row => row.id === control.value)));
  };
  const setValue = (value: string) => {
    const row = rows.find(row => row.id === value);
    control.value = row?.id ?? '';
    control.textContent = row ? row.displayName ?? row.id : '—';
    Array.from(list.children).forEach((option, i) => option.setAttribute('aria-selected', String(rows[i].id === control.value)));
  };
  const choose = (index: number) => {
    if (control.disabled || !rows[index]) return;
    const changed = control.value !== rows[index].id;
    setValue(rows[index].id);
    close();
    if (changed) onChange();
  };
  control.addEventListener('click', () => list.hidden ? open() : close(), { signal });
  control.addEventListener('keydown', event => {
    if (control.disabled || event.isComposing || !rows.length) return;
    const wasOpen = !list.hidden;
    switch (event.key) {
      case 'ArrowDown': case 'ArrowUp':
        event.preventDefault();
        if (!wasOpen) open();
        else highlight(Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
        break;
      case 'Home': case 'End':
        event.preventDefault();
        if (!wasOpen) open();
        highlight(event.key === 'Home' ? 0 : rows.length - 1);
        break;
      case 'Enter': case ' ':
        event.preventDefault();
        if (wasOpen) choose(active); else open();
        break;
      case 'Escape':
        if (wasOpen) { event.preventDefault(); close(); }
        break;
      case 'Tab': close(); break;
    }
  }, { signal });
  list.addEventListener('pointerdown', event => event.preventDefault(), { signal });
  el.ownerDocument.addEventListener('pointerdown', event => { if (!el.contains(event.target as Node)) close(); }, { signal });
  el.addEventListener('focusout', event => { if (!el.contains(event.relatedTarget as Node | null)) close(); }, { signal });
  signal.addEventListener('abort', close, { once: true });
  return {
    el, control, close, setValue,
    get length() { return rows.length; },
    has: (value: string) => rows.some(row => row.id === value),
    setOptions(next: typeof rows) {
      close();
      rows = next;
      list.replaceChildren(...rows.map((row, index) => {
        const option = ui.h('li', 'home-model-option', row.displayName ?? row.id);
        option.id = `${list.id}-${index}`;
        option.setAttribute('role', 'option');
        option.addEventListener('pointermove', () => highlight(index), { signal });
        option.addEventListener('click', () => choose(index), { signal });
        return option;
      }));
      setValue(rows.some(row => row.id === control.value) ? control.value : rows[0]?.id ?? '');
    },
  };
}
