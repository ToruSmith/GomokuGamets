import { t } from '../i18n/index.ts';
import type { Child, Props } from './dom.ts';
import { clear, h } from './dom.ts';
import { icon } from './icons.ts';

export function pageHeader(title: string, onBack: () => void): HTMLElement {
  return h(
    'header',
    { class: 'page-header' },
    h(
      'button',
      { class: 'icon-button', type: 'button', onClick: onBack, 'aria-label': t('common.back') },
      icon('back'),
    ),
    h('h1', { class: 'page-title', tabindex: -1 }, title),
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

export function segmented<T extends string | number>(
  label: string,
  options: Option<T>[],
  current: () => T,
  onChange: (value: T) => void,
): HTMLElement {
  return h(
    'fieldset',
    { class: 'field' },
    h('legend', { class: 'field-label' }, label),
    h(
      'div',
      { class: 'segments', role: 'radiogroup', 'aria-label': label },
      options.map((option) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'segment',
            'aria-checked': () => String(current() === option.value),
            onClick: () => onChange(option.value),
          },
          option.label,
        ),
      ),
    ),
  );
}

export function toggle(
  label: string,
  current: () => boolean,
  onChange: (value: boolean) => void,
  hint?: string,
): HTMLElement {
  return h(
    'label',
    { class: 'toggle' },
    h(
      'span',
      { class: 'toggle-text' },
      label,
      hint ? h('small', { class: 'field-hint' }, hint) : null,
    ),
    h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: current,
      onChange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
    }),
  );
}

export function button(
  iconName: string | null,
  label: string,
  onClick: () => void,
  props: Props = {},
): HTMLElement {
  return h(
    'button',
    { class: 'button', type: 'button', onClick, ...props },
    iconName ? icon(iconName) : null,
    h('span', null, label),
  );
}

export function section(title: string | null, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: 'block' },
    title ? h('h2', { class: 'block-title' }, title) : null,
    ...children,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string): void {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = text;
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2200);
}

export function confirmDialog(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const finish = (value: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.append(
      h('p', { class: 'dialog-text' }, message),
      h(
        'div',
        { class: 'button-row' },
        button(null, t('common.cancel'), () => finish(false)),
        button(null, confirmLabel, () => finish(true), { class: 'button is-primary' }),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export { clear };
