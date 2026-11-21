// Hakkında: description, version (from the generated src/ui/version.js), developer, language,
// source code, contact, privacy and copyright.

import { h } from '../dom.js';
import { header, screen } from '../components.js';
import { hashFor } from '../routes.js';
import { COMMIT, VERSION } from '../version.js';

const SOURCE_URL = 'https://github.com/MalikFikret/son-cay';

const CONTACTS = [
  { label: 'GitHub', value: 'github.com/MalikFikret', href: 'https://github.com/MalikFikret' },
  { label: 'E-posta', value: 'malikfikretcontact@gmail.com', href: 'mailto:malikfikretcontact@gmail.com' },
  { label: 'Instagram', value: '@malikfikret', href: 'https://instagram.com/malikfikret' },
  { label: 'LinkedIn', value: 'linkedin.com/in/malikfikret', href: 'https://linkedin.com/in/malikfikret' },
];

const external = (href) => (href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' });

export function aboutScreen(ctx) {
  const version = COMMIT ? `${VERSION} (${COMMIT})` : VERSION;
  const top = header({ title: 'Hakkında', subtitle: 'Son Çay', onBack: () => ctx.go(hashFor.home()) });
  return screen('screen-about', top.el,
    h('div', { class: 'stack about' },
      h('div', { class: 'about-intro' },
        h('p', { class: 'about-title', text: 'Son Çay' }),
        h('p', { class: 'muted', text: 'Arkadaşlarınla çevrimiçi oynanan bir şans ve taktik oyunu. Tabanca masanın ortasında döner, malzemeler oyunu değiştirir, son çay kimde kalırsa o kazanır.' })),
      h('dl', { class: 'facts' },
        h('dt', { text: 'Sürüm' }), h('dd', { text: version }),
        h('dt', { text: 'Geliştirici' }), h('dd', { class: 'strong', text: 'Malik Fikret' }),
        h('dt', { text: 'Dil' }), h('dd', { text: 'Türkçe' })),
      h('a', { class: 'btn btn-outline', href: SOURCE_URL, ...external(SOURCE_URL), text: 'Kaynak kodu' }),
      h('section', { class: 'about-section' },
        h('h2', { class: 'section-title', text: 'İletişim' }),
        CONTACTS.map((c) => h('a', { class: 'contact', href: c.href, ...external(c.href) },
          h('span', { class: 'contact-label', text: c.label }),
          h('span', { class: 'contact-value', text: c.value })))),
      h('section', { class: 'about-section' },
        h('h2', { class: 'section-title', text: 'Gizlilik' }),
        h('p', { class: 'muted small', text: 'Hesap gerekmez. Her cihaz arka planda anonim bir kimlik alır. Yalnızca oyunun ihtiyaç duyduğu bilgiler saklanır: masa kodu, oyuncu adları, oyundaki hamleler ve puanlar, bir de kişisel veri içermeyen kullanım sayıları (ziyaret, masa ve oyun sayısı). Şifreleri kimse göremez.' })),
      h('div', { class: 'card' },
        h('span', { class: 'strong', text: '© 2026 Malik Fikret. Tüm hakları saklıdır.' }),
        h('span', { class: 'muted small', text: "Bu uygulamanın kodu, tasarımı ve metinleri Malik Fikret'e aittir. İzinsiz kopyalanamaz, değiştirilemez ve başka bir yerde yayımlanamaz." }))));
}
