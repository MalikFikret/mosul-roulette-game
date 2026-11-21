// A screen for when a table cannot be shown (no table with this code, no connection): the
// message and one way out.

import { h } from '../dom.js';
import { header, icon, screen } from '../components.js';

/**
 * @param {{ title: string, subtitle?: string, message: string, actionText: string,
 *   onAction: () => void, onBack: () => void }} params
 */
export function problemScreen({ title, subtitle, message, actionText, onAction, onBack }) {
  const top = header({ title, subtitle, onBack });
  return screen('screen-problem', top.el,
    h('div', { class: 'stack' },
      h('div', { class: 'notice notice-error', role: 'alert' }, icon('info'), h('span', { text: message }))),
    h('div', { class: 'bottom' },
      h('button', { type: 'button', class: 'btn btn-primary', text: actionText, on: { click: onAction } })));
}
