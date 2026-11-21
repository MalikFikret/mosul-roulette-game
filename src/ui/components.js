// Pieces shared by several screens: icons, the screen frame, the header with its back button,
// form fields and the error line.

import { NAME_MAX } from '../rooms/index.js';
import { h, svg } from './dom.js';

export const ICONS = Object.freeze({
  back: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['path', { d: 'M11 3 L5 9 L11 15', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  book: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['path', { d: 'M3 3.5 H8 C8.6 3.5 9 3.9 9 4.5 V15 C9 14.2 8.4 13.6 7.6 13.6 H3 Z M15 3.5 H10 C9.4 3.5 9 3.9 9 4.5 V15 C9 14.2 9.6 13.6 10.4 13.6 H15 Z', fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }]],
  gear: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['circle', { cx: 9, cy: 9, r: 2.6, fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5 }],
    ['path', { d: 'M9 1.8 V4 M9 14 V16.2 M1.8 9 H4 M14 9 H16.2 M3.9 3.9 L5.5 5.5 M12.5 12.5 L14.1 14.1 M3.9 14.1 L5.5 12.5 M12.5 5.5 L14.1 3.9', stroke: '#3FB5AC', 'stroke-width': 1.5, 'stroke-linecap': 'round' }]],
  info: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true', class: 'notice-icon' },
    ['circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5 }],
    ['path', { d: 'M9 8 V13 M9 5 V5.5', stroke: '#3FB5AC', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]],
  glass: ['svg', { role: 'img', 'aria-label': 'Çay bardağı', width: 70, height: 104, viewBox: '0 0 70 104' },
    ['ellipse', { cx: 35, cy: 98, rx: 30, ry: 5, fill: 'none', stroke: '#2F8F88', 'stroke-width': 2 }],
    ['path', { d: 'M6 6 H64 L50 44 L58 94 H12 L20 44 Z', fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.8, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }],
    ['path', { d: 'M14 74 H56 L58 92 H12 Z', fill: '#B4532A' }],
    ['path', { d: 'M27 14 C26 24 30 28 34 30', fill: 'none', stroke: '#F2ECDD', 'stroke-opacity': 0.5, 'stroke-width': 2, 'stroke-linecap': 'round' }]],
});

export const icon = (name) => svg(ICONS[name]);

/** The full-height column every screen lives in. */
export function screen(className, ...children) {
  return h('div', { class: `screen ${className}` }, ...children);
}

/** Header with the back button, a title (Rakkas) and a small subtitle. */
export function header({ title, subtitle, onBack }) {
  const subtitleEl = h('span', { class: 'header-sub', text: subtitle ?? '' });
  const el = h('header', { class: 'header' },
    h('button', { type: 'button', class: 'back', 'aria-label': 'Geri', on: { click: onBack } }, icon('back')),
    h('div', { class: 'header-text' },
      h('h1', { class: 'header-title', text: title }),
      subtitleEl));
  return { el, setSubtitle: (text) => { subtitleEl.textContent = text; } };
}

/** An error line under a field (role=alert so screen readers announce it). */
export function errorLine(id) {
  const el = h('p', { class: 'field-error', id, role: 'alert', hidden: true });
  return {
    el,
    show(text) {
      el.textContent = text;
      el.hidden = false;
    },
    clear() {
      el.textContent = '';
      el.hidden = true;
    },
  };
}

/** The "Adın" field. */
export function nameField(id) {
  const input = h('input', {
    id, type: 'text', class: 'input input-name', maxlength: NAME_MAX, autocomplete: 'nickname',
    autocapitalize: 'words', spellcheck: 'false',
  });
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id, text: 'Adın' }),
    input,
    h('span', { class: 'hint', text: 'Masadaki herkes bu adı görür.' }));
  return { el, input };
}

/**
 * The "Şifren" field: 4 digits, masked, never stored. Non-digits are dropped as they are typed.
 * @param {string} id
 * @param {string | null} hint
 */
export function pinField(id, hint, describedBy) {
  const input = h('input', {
    id, type: 'password', class: 'input input-pin', inputmode: 'numeric', maxlength: 4,
    autocomplete: 'off', pattern: '[0-9]{4}', 'aria-describedby': describedBy,
  });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (digits !== input.value) input.value = digits;
  });
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id, text: 'Şifren' }),
    input,
    hint ? h('span', { class: 'hint', text: hint }) : null);
  return { el, input };
}

/** Marks a field as wrong (red border) until it is typed in again. */
export function markInvalid(input, invalid) {
  input.classList.toggle('is-invalid', invalid);
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** A primary button that shows `busyText` while `task` runs. Returns the task's result. */
export async function whileBusy(button, busyText, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await task();
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

/** A short centered "loading" placeholder for screens that read before they can draw. */
export function loading(text = 'Yükleniyor…') {
  return h('p', { class: 'loading', role: 'status', text });
}

export const MODE_LABELS = Object.freeze({ classic: 'Klasik', custom: 'Özel' });

export function modeLabel(mode) {
  return Object.prototype.hasOwnProperty.call(MODE_LABELS, mode) ? MODE_LABELS[mode] : '';
}
