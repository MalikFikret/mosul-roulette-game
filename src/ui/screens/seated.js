// TEMPORARY screen shown after a successful create / join / recover, until the real lobby
// (bekleme salonu) is built: the table code, my name, the invite link with a copy button and,
// for a seat taken during a match, that I play from the next match.

import { h } from '../dom.js';
import { errorLine, header, icon, screen } from '../components.js';
import { FORM_MESSAGES } from '../messages.js';
import { hashFor, inviteLink } from '../routes.js';

/**
 * @param {{ code: string, mine: { name: string, waiting: boolean, status: string } }} params
 */
export function seatedScreen(ctx, view, { code, mine }) {
  const link = inviteLink(location.href, code);
  const linkInput = h('input', { id: 'invite', class: 'input input-link', type: 'text', readonly: true, value: link, 'aria-describedby': 'copy-status' });
  const copyStatus = errorLine('copy-status');
  copyStatus.el.classList.add('status-line');
  copyStatus.el.setAttribute('role', 'status');
  let resetTimer = null;
  view.onLeave(() => clearTimeout(resetTimer));

  const copyButton = h('button', { type: 'button', class: 'btn btn-primary btn-copy', text: 'Kopyala', on: { click: copy } });

  async function copy() {
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      // Clipboard API refused (old browser, no permission): select the text and try the older
      // copy command; if that fails too, the text stays selected for a manual copy.
      linkInput.focus();
      linkInput.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
    }
    if (!view.active()) return;
    if (copied) {
      copyStatus.el.classList.remove('is-error');
      copyStatus.show('Bağlantı kopyalandı.');
      copyButton.textContent = 'Kopyalandı';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { copyButton.textContent = 'Kopyala'; }, 2000);
    } else {
      copyStatus.el.classList.add('is-error');
      copyStatus.show(FORM_MESSAGES.COPY_FAILED);
    }
  }

  linkInput.addEventListener('focus', () => linkInput.select());

  const top = header({ title: `Masa ${code}`, subtitle: 'Masadasın', onBack: () => ctx.go(hashFor.home()) });
  const body = h('div', { class: 'stack' },
    h('div', { class: 'seated-code' },
      h('span', { class: 'label', text: 'Masa kodu' }),
      h('span', { class: 'big-code', text: code })),
    h('dl', { class: 'facts' },
      h('dt', { text: 'Adın' }), h('dd', { class: 'strong', text: mine.name })),
    mine.waiting
      ? h('div', { class: 'notice', role: 'note' }, icon('info'),
        h('span', { text: mine.status === 'playing'
          ? 'Şu an bir oyun sürüyor. Bu oyunu izleyeceksin, sonraki oyunda oynarsın.'
          : 'Sonraki oyunda oynayacaksın.' }))
      : null,
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'invite', text: 'Davet bağlantısı' }),
      h('div', { class: 'link-row' }, linkInput, copyButton),
      copyStatus.el,
      h('span', { class: 'hint', text: 'Bu bağlantıyı arkadaşlarına gönder; açtıklarında kod hazır olur.' })),
    h('p', { class: 'small-note', text: 'Bekleme salonu yakında burada olacak.' }));
  return screen('screen-seated', top.el, body);
}
