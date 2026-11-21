// Turkish texts for errors (pure, no DOM). The room layer and the engine only produce stable
// English codes; this is the one place that turns them into what a player reads. A raw code is
// never shown.

import { ROOM_ERR } from '../rooms/index.js';

const GENERIC = 'Bir şeyler ters gitti. Sayfayı yenileyip tekrar dene.';
const OFFLINE = 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.';

/** One message per room-layer error code (tests/ui-messages.test.js checks that none is missing). */
export const ROOM_MESSAGES = Object.freeze({
  [ROOM_ERR.INVALID_CODE]: 'Bu masa kodu geçersiz. Kod 6 karakterdir.',
  [ROOM_ERR.ROOM_NOT_FOUND]: 'Bu kodla açık bir masa yok.',
  [ROOM_ERR.ROOM_FULL]: 'Bu masa dolu.',
  [ROOM_ERR.INVALID_NAME]: 'Ad 1-20 karakter olmalı; . $ # [ ] / kullanılamaz.',
  [ROOM_ERR.NAME_TAKEN]: 'Bu ad masada zaten var, başka bir ad seç.',
  [ROOM_ERR.INVALID_PIN]: 'Şifre 4 rakam olmalı.',
  [ROOM_ERR.WRONG_PIN]: 'Şifre yanlış.',
  [ROOM_ERR.RETRY_LATER]: 'Çok sık denendi. Biraz bekle, sonra tekrar dene.',
  [ROOM_ERR.INVALID_SEAT]: 'Önce listeden adını seç.',
  [ROOM_ERR.SEAT_EMPTY]: 'Bu yer artık boş.',
  [ROOM_ERR.ALREADY_MEMBER]: 'Bu masada zaten başka bir yerin var.',
  [ROOM_ERR.NOT_MEMBER]: 'Bu masada artık yerin yok.',
  [ROOM_ERR.SEAT_LOST]: 'Bu masada artık yerin yok.',
  [ROOM_ERR.NOT_IN_LOBBY]: 'Bu, yalnızca maçlar arasında yapılabilir.',
  [ROOM_ERR.INVALID_SETTINGS]: 'Masa ayarları geçersiz.',
  [ROOM_ERR.NOT_ENOUGH_PLAYERS]: 'Maçı başlatmak için en az 3 oyuncu gerekir.',
  [ROOM_ERR.INVALID_ACTION]: 'Bu hamle şu an yapılamaz.',
  [ROOM_ERR.ACTION_NOT_ALLOWED]: 'Bu hamle şu an yapılamaz.',
  [ROOM_ERR.NO_MATCH]: 'Şu an süren bir maç yok.',
  [ROOM_ERR.PLAYER_NOT_ALIVE]: 'Bu oyuncu artık maçta değil.',
  [ROOM_ERR.SEAT_PRESENT]: 'Bu oyuncu hâlâ bağlı.',
  [ROOM_ERR.CODE_GENERATION_FAILED]: 'Masa kurulamadı, tekrar dene.',
  [ROOM_ERR.WRITE_DENIED]: 'İşlem kabul edilmedi, tekrar dene.',
  // Programming or setup errors: nothing the player can fix by changing their input.
  [ROOM_ERR.INVALID_UID]: GENERIC,
  [ROOM_ERR.INVALID_DEPENDENCIES]: GENERIC,
  [ROOM_ERR.INVALID_VISIBILITY]: GENERIC,
  [ROOM_ERR.INVALID_MODE]: GENERIC,
});

/** Messages of checks the screens make before any request. */
export const FORM_MESSAGES = Object.freeze({
  CODE_EMPTY: 'Masa kodunu yaz.',
  NAME_EMPTY: 'Adını yaz.',
  BAD_INVITE: 'Davet bağlantısı geçersiz. Kodu elle yazmayı dene.',
  COPY_FAILED: 'Kopyalanamadı. Bağlantıyı elle seçip kopyala.',
  SETTINGS_FAILED: 'Ayar kaydedilemedi; önceki değer geri geldi.',
  CONNECT_FAILED: OFFLINE,
});

export const GENERIC_MESSAGE = GENERIC;
export const OFFLINE_MESSAGE = OFFLINE;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function looksOffline(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('offline') || text.includes('network') || text.includes('unavailable');
}

/**
 * The Turkish message for an error: a RoomError (by its code), a bare code string, or any other
 * error (network problems get the offline message, everything else a generic one).
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (typeof code === 'string' && hasOwn(ROOM_MESSAGES, code)) return ROOM_MESSAGES[code];
  if (typeof code === 'string' && hasOwn(FORM_MESSAGES, code)) return FORM_MESSAGES[code];
  if (error && typeof error === 'object' && looksOffline(error)) return OFFLINE;
  return GENERIC;
}

/** Errors after which the recover button waits (the rules allow one claim per seat every 2 s). */
export const RETRY_WAIT_CODES = Object.freeze([ROOM_ERR.WRONG_PIN, ROOM_ERR.RETRY_LATER]);
export const RETRY_WAIT_SECONDS = 2;
