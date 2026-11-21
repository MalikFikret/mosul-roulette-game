// Bekleme salonu: the waiting room of a table, for the host and for the players, live.
//
// While it is shown, this device keeps its seat present (startPresence), watches the host seat
// so the host role moves after 60 s of host absence (watchHost), and follows the room
// (watchLobby). The current host edits the general match settings; everyone else sees them as a
// summary. Every listener, presence and timer stops when the screen is left.
//
// Not built yet (visible but disabled, as in the design): Tablo, the seat order, the player
// options and starting the match. While a match runs, a temporary "Maç sürüyor" panel is shown.

import { h } from '../dom.js';
import { copyText, errorLine, icon, screen } from '../components.js';
import { FORM_MESSAGES, errorMessage } from '../messages.js';
import { inviteLink } from '../routes.js';
import {
  MODE_HINTS,
  MODE_LABELS,
  STEPPED_SETTINGS,
  canStep,
  canToggleTool,
  defaultsFor,
  formatPoints,
  normalizeSettings,
  playerRows,
  sameSettings,
  stepSetting,
  toggleTool,
  toolCounter,
  toolList,
} from '../lobby-model.js';
import { createSettingsSync } from '../settings-sync.js';
import { toolIcon } from '../tools.js';
import { ROOM_ERR } from '../../rooms/index.js';

const LOST_CODES = [ROOM_ERR.SEAT_LOST, ROOM_ERR.NOT_MEMBER, ROOM_ERR.ROOM_NOT_FOUND];

/**
 * @param {object} ctx  { api, uid, go, goHome(message), forgetTable(), refresh(message) }
 * @param {object} view { active(), onLeave(fn) }
 * @param {{ code: string, mine: { seatId: string }, message?: string }} params
 */
export function lobbyScreen(ctx, view, { code, mine, message }) {
  const mySeat = mine.seatId;
  const link = inviteLink(location.href, code);
  const stops = [];
  let lobby = null; // the latest snapshot from watchLobby
  let isHost = null; // the role the settings section is drawn for
  let hostUi = null; // the host's settings controls (refs), while I am the host
  let sync = null; // coalesced settings writes, while I am the host
  let leaving = false;
  let ended = false;

  // --- Static parts --------------------------------------------------------------------------
  const subtitle = h('span', { class: 'header-sub', text: 'Bekleme salonu' });
  const leaveButton = h('button', { type: 'button', class: 'btn-small', text: 'Çık', on: { click: askToLeave } });
  const topBar = h('header', { class: 'lobby-top' },
    h('div', { class: 'header-text' },
      h('h1', { class: 'lobby-title', text: 'Son Çay' }),
      subtitle),
    h('div', { class: 'lobby-top-actions' },
      h('button', { type: 'button', class: 'btn-small btn-small-accent', disabled: true, title: 'Yakında' }, icon('table'), 'Tablo'),
      leaveButton));

  const copyStatus = h('p', { class: 'field-error status-line', role: 'status', hidden: true });
  const copyButton = h('button', { type: 'button', class: 'btn-invite', on: { click: copyInvite } }, icon('link'), 'Davet bağlantısı');
  const codeCard = h('div', { class: 'field' },
    h('div', { class: 'code-card' },
      h('span', { class: 'code-card-text' },
        h('span', { class: 'hint', text: 'Masa kodu' }),
        h('span', { class: 'code-card-code', text: code })),
      copyButton),
    copyStatus);

  const playersList = h('ul', { class: 'player-list', 'aria-labelledby': 'players-title' });
  const seatOrderNote = h('span', { class: 'hint', text: 'Oturma sırası: rastgele' });
  const seatOrderButton = h('button', { type: 'button', class: 'link-button', disabled: true, title: 'Yakında', text: 'Oturma sırasını elle düzenle' });
  const playersSection = h('section', { class: 'lobby-section' },
    h('div', { class: 'section-head' },
      h('h2', { class: 'section-title', id: 'players-title', text: 'Oyuncular' }),
      seatOrderNote),
    playersList,
    seatOrderButton);

  const settingsBody = h('div', { class: 'lobby-settings' });
  const settingsError = errorLine('settings-error');
  const settingsSection = h('section', { class: 'lobby-section', 'aria-labelledby': 'settings-title' },
    h('h2', { class: 'section-title', id: 'settings-title', text: 'Oyun ayarları' }),
    settingsBody,
    settingsError.el);

  const pageError = errorLine('lobby-error');
  if (message) pageError.show(message);

  // Shown instead of the players and settings while a match runs (temporary).
  const playingText = h('span');
  const playingNotice = h('div', { class: 'notice', role: 'status', hidden: true }, icon('info'), playingText);

  const loadingLine = h('p', { class: 'loading', role: 'status', text: 'Yükleniyor…' });
  const body = h('div', { class: 'stack lobby-body', hidden: true },
    pageError.el, codeCard, playingNotice, playersSection, settingsSection);
  const bottom = h('div', { class: 'lobby-bottom' });

  const confirmDialog = buildLeaveDialog();
  const root = screen('screen-lobby', topBar, loadingLine, body, bottom, confirmDialog.el);

  // --- Live parts ----------------------------------------------------------------------------
  function start() {
    try {
      stops.push(ctx.api.startPresence({ uid: ctx.uid, code, seatId: mySeat, onError: onLiveError }));
      stops.push(ctx.api.watchHost({ uid: ctx.uid, code, onError: onLiveError }));
      stops.push(ctx.api.watchLobby({ uid: ctx.uid, code, onUpdate: render, onError: onLiveError }));
    } catch (error) {
      onLiveError(error);
    }
  }

  function stopAll() {
    if (sync) sync.dispose();
    sync = null;
    for (const stop of stops.splice(0)) {
      try {
        const result = stop();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // Already stopped.
      }
    }
    confirmDialog.close();
  }

  view.onLeave(() => {
    ended = true;
    stopAll();
  });

  // Seat lost (kicked, recovered on another device, room gone): back to Giriş.
  function onLiveError(error) {
    if (ended || leaving || !view.active()) return;
    if (LOST_CODES.includes(error?.code)) {
      ended = true;
      stopAll();
      ctx.forgetTable();
      ctx.goHome(errorMessage(error?.code === ROOM_ERR.ROOM_NOT_FOUND ? ROOM_ERR.ROOM_NOT_FOUND : ROOM_ERR.SEAT_LOST));
      return;
    }
    // Anything else (e.g. a refused presence write while offline): show it, keep going.
    pageError.show(errorMessage(error));
  }

  function render(next) {
    if (ended || !view.active()) return;
    lobby = next;
    loadingLine.remove();
    body.hidden = false;
    const rows = playerRows({
      seats: next.seats,
      presence: next.presence,
      scores: next.scores,
      hostSeat: next.meta.hostSeat,
      mySeat,
    });
    subtitle.textContent = `Bekleme salonu · ${rows.length} oyuncu`;

    const playing = next.meta.status === 'playing';
    // Leaving is possible only between matches (leaveRoom refuses with NOT_IN_LOBBY).
    leaveButton.disabled = playing;
    leaveButton.title = playing ? 'Maç sırasında masadan çıkılamaz' : '';
    playingNotice.hidden = !playing;
    playersSection.hidden = playing;
    settingsSection.hidden = playing;
    if (playing) {
      showPlaying(rows);
      return;
    }
    renderPlayers(rows);
    renderRole(next.meta.hostSeat === mySeat, rows);
    const settings = normalizeSettings(next.settings, next.meta.mode);
    if (sync) sync.fromServer(settings);
    else renderSummary(settings);
  }

  // --- Players -------------------------------------------------------------------------------
  function renderPlayers(rows) {
    playersList.replaceChildren(...rows.map((row) => h('li', { class: 'player-row' },
      h('span', { class: row.present ? 'presence-dot is-present' : 'presence-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'player-text' },
        h('span', { class: 'player-name', text: row.name }),
        row.tagLine ? h('span', { class: row.me ? 'player-tag is-me' : 'player-tag', text: row.tagLine }) : null),
      h('span', { class: 'player-points', text: formatPoints(row.points) }),
      isHost
        ? h('button', { type: 'button', class: 'icon-button', disabled: true, title: 'Yakında', 'aria-label': `${row.name} için seçenekler` }, icon('dots'))
        : null)));
  }

  // --- Role: host controls or player summary ---------------------------------------------------
  function renderRole(host, rows) {
    const hostName = rows.find((row) => row.host)?.name ?? '';
    if (host !== isHost) {
      isHost = host;
      seatOrderNote.hidden = !host;
      seatOrderButton.hidden = !host;
      settingsError.clear();
      if (host) {
        hostUi = buildHostControls();
        settingsBody.replaceChildren(hostUi.el);
        sync = createSettingsSync({
          write: (settings) => ctx.api.updateSettings({ uid: ctx.uid, code, settings }),
          onShow: showHostSettings,
          onError: () => settingsError.show(FORM_MESSAGES.SETTINGS_FAILED),
        });
      } else {
        if (sync) sync.dispose();
        sync = null;
        hostUi = null;
      }
      // Rows drawn before the role was known need their option buttons.
      renderPlayers(rows);
    }
    renderBottom(host, hostName);
  }

  function renderBottom(host, hostName) {
    if (host) {
      bottom.replaceChildren(
        h('button', { type: 'button', class: 'btn-start', disabled: true, title: 'Yakında', text: 'Maçı başlat' }),
        h('span', { class: 'hint center', text: 'Bağlantısı olmayanlar da maça dahil olur. En az 3 oyuncu gerekir.' }));
    } else {
      bottom.replaceChildren(h('div', { class: 'waiting-line', role: 'status' },
        icon('clock'),
        h('span', { text: hostName ? `${hostName} maçı başlatınca masa açılır` : 'Masa sahibi maçı başlatınca masa açılır' })));
    }
  }

  function buildHostControls() {
    const modeHint = h('span', { class: 'hint' });
    const modeGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Oyun türü' },
      ['classic', 'custom'].map((mode) => {
        const input = h('input', { type: 'radio', name: 'lobby-mode', value: mode, class: 'visually-hidden', disabled: mode !== 'classic' });
        return h('label', { class: mode === 'classic' ? 'segment' : 'segment is-disabled', title: mode === 'classic' ? null : 'Yakında' },
          input, MODE_LABELS[mode]);
      }));

    const rows = STEPPED_SETTINGS.map((setting) => {
      const labelId = `set-${setting.key}`;
      const output = h('output', { class: 'stepper-value', 'aria-labelledby': labelId });
      const minus = h('button', { type: 'button', class: 'stepper-button', 'aria-label': `${setting.label}: azalt` }, icon('minus'));
      const plus = h('button', { type: 'button', class: 'stepper-button', 'aria-label': `${setting.label}: artır` }, icon('plus'));
      minus.addEventListener('click', () => change((c) => stepSetting(c, setting.key, -1)));
      plus.addEventListener('click', () => change((c) => stepSetting(c, setting.key, +1)));
      const el = h('div', { class: 'stepper-row' },
        h('span', { class: 'stepper-label', id: labelId, text: setting.label }), minus, output, plus);
      return { setting, el, output, minus, plus };
    });

    const toolCount = h('span', { class: 'tool-count' });
    const toolToggle = h('button', { type: 'button', class: 'tools-toggle', 'aria-expanded': 'false', 'aria-controls': 'tool-list' },
      h('span', { class: 'stepper-label', text: 'Oyundaki malzemeler' }), toolCount, icon('chevron'));
    const toolBox = h('ul', { class: 'tool-list', id: 'tool-list', hidden: true });
    toolToggle.addEventListener('click', () => {
      const open = toolBox.hidden;
      toolBox.hidden = !open;
      toolToggle.setAttribute('aria-expanded', String(open));
    });

    const card = h('div', { class: 'settings-card' });
    rows.forEach((row) => card.append(row.el, h('span', { class: 'separator', 'aria-hidden': 'true' })));
    card.append(toolToggle, toolBox);

    const reset = h('button', { type: 'button', class: 'link-button', text: 'Varsayılanlara dön', on: { click: () => change((c) => defaultsFor(c)) } });

    return {
      el: h('div', { class: 'lobby-settings' }, modeGroup, modeHint, card, reset),
      modeGroup, modeHint, rows, toolCount, toolBox, reset,
    };
  }

  // A host change: shown at once, written after a short pause (settings-sync).
  function change(update) {
    if (!sync) return;
    const current = sync.current();
    if (current === null) return;
    const next = update(current);
    if (next === current || sameSettings(next, current)) return;
    settingsError.clear();
    sync.change(next);
  }

  function showHostSettings(settings) {
    if (!hostUi) return;
    for (const input of hostUi.modeGroup.querySelectorAll('input')) input.checked = input.value === settings.mode;
    for (const label of hostUi.modeGroup.querySelectorAll('label')) {
      label.classList.toggle('is-checked', label.querySelector('input').checked);
    }
    hostUi.modeHint.textContent = MODE_HINTS[settings.mode] ?? '';
    for (const row of hostUi.rows) {
      row.output.textContent = row.setting.format(settings[row.setting.key]);
      row.minus.disabled = !canStep(settings, row.setting.key, -1);
      row.plus.disabled = !canStep(settings, row.setting.key, +1);
    }
    const { enabled, total } = toolCounter(settings);
    hostUi.toolCount.textContent = `${enabled} / ${total}`;
    // Keep the focused checkbox in place: update the states instead of redrawing the list.
    if (hostUi.toolBox.childElementCount === 0) {
      hostUi.toolBox.append(...toolList(settings).map(({ tool, name }) => {
        const box = h('input', { type: 'checkbox', class: 'tool-check', value: tool });
        box.addEventListener('change', () => change((c) => toggleTool(c, tool)));
        return h('li', {}, h('label', { class: 'tool-item' }, box, toolIcon(tool, 'small'), h('span', { class: 'tool-name', text: name })));
      }));
    }
    for (const box of hostUi.toolBox.querySelectorAll('input')) {
      box.checked = settings.enabledTools.includes(box.value);
      box.disabled = !canToggleTool(settings, box.value);
    }
    hostUi.reset.disabled = sameSettings(settings, defaultsFor(settings));
  }

  // Players: the same settings, read only. The tool list opens like the host's (and stays open
  // across updates); switched-off tools are dimmed.
  let playerToolsOpen = false;
  function renderSummary(settings) {
    const { enabled, total } = toolCounter(settings);
    const items = [
      ['Tür', MODE_LABELS[settings.mode] ?? ''],
      ...STEPPED_SETTINGS.map((s) => [s.summaryLabel, s.summary(settings[s.key])]),
    ];
    const list = h('ul', { class: 'tool-list', id: 'player-tool-list', hidden: !playerToolsOpen },
      toolList(settings).map(({ tool, name, enabled: on }) => h('li', { class: on ? 'tool-item' : 'tool-item is-off' },
        toolIcon(tool, 'small'),
        h('span', { class: 'tool-name', text: name }),
        on ? null : h('span', { class: 'visually-hidden', text: ' (kapalı)' }))));
    const toggle = h('button', {
      type: 'button', class: 'tools-toggle summary-tools-toggle',
      'aria-expanded': String(playerToolsOpen), 'aria-controls': 'player-tool-list',
    },
    h('span', { class: 'stepper-label', text: 'Oyundaki malzemeler' }),
    h('span', { class: 'tool-count', text: `${enabled} / ${total}` }),
    icon('chevron'));
    toggle.addEventListener('click', () => {
      playerToolsOpen = !playerToolsOpen;
      list.hidden = !playerToolsOpen;
      toggle.setAttribute('aria-expanded', String(playerToolsOpen));
    });
    settingsBody.replaceChildren(h('div', { class: 'summary-card' },
      h('dl', { class: 'summary-list' },
        items.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })])),
      toggle,
      list));
  }

  // --- A match is running (temporary) -------------------------------------------------------
  function showPlaying(rows) {
    bottom.replaceChildren();
    // Settings cannot change during a match: a pending change is dropped by the role reset.
    if (sync) sync.dispose();
    sync = null;
    isHost = null;
    hostUi = null;
    const me = rows.find((row) => row.me);
    playingText.textContent = me?.waiting
      ? 'Maç sürüyor. Bu maçı izleyeceksin, sonraki maçta oynarsın.'
      : 'Maç sürüyor. Maç ekranı yakında burada olacak.';
  }

  // --- Invite link -----------------------------------------------------------------------------
  let copyTimer = null;
  view.onLeave(() => clearTimeout(copyTimer));
  async function copyInvite() {
    const copied = await copyText(link);
    if (!view.active()) return;
    copyStatus.classList.toggle('is-error', !copied);
    copyStatus.textContent = copied ? 'Bağlantı kopyalandı.' : `${FORM_MESSAGES.COPY_FAILED} ${link}`;
    copyStatus.hidden = false;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyStatus.hidden = true; }, copied ? 2500 : 15000);
  }

  // --- Leaving ---------------------------------------------------------------------------------
  function buildLeaveDialog() {
    const text = h('p', { class: 'muted' });
    const error = errorLine('leave-error');
    const yes = h('button', { type: 'button', class: 'btn btn-primary', text: 'Evet, çık' });
    const no = h('button', { type: 'button', class: 'btn btn-outline', text: 'Vazgeç' });
    const el = h('dialog', { class: 'dialog', 'aria-labelledby': 'leave-title' },
      h('h2', { class: 'section-title', id: 'leave-title', text: 'Masadan çıkılsın mı?' }),
      text, error.el, h('div', { class: 'dialog-actions' }, no, yes));
    no.addEventListener('click', () => el.close());
    yes.addEventListener('click', () => leave(yes));
    return {
      el,
      open() {
        const others = lobby ? Object.keys(lobby.seats).filter((s) => s !== mySeat).length : 1;
        const lines = ['Yerin boşalır; tekrar oturursan puanların sıfırdan başlar.'];
        if (others === 0) lines.push('Masada başka kimse olmadığı için masa kapanır.');
        else if (lobby?.meta.hostSeat === mySeat) lines.push('Masa sahipliği başka bir oyuncuya geçer.');
        text.textContent = lines.join(' ');
        error.clear();
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      },
      close() {
        if (el.open) el.close();
      },
    };
  }

  function askToLeave() {
    if (!lobby) return;
    confirmDialog.open();
  }

  async function leave(button) {
    if (leaving) return;
    leaving = true;
    button.disabled = true;
    try {
      // leaveRoom stops this device's presence and host watcher itself before writing.
      await ctx.api.leaveRoom({ uid: ctx.uid, code });
    } catch (failure) {
      leaving = false;
      button.disabled = false;
      if (!view.active()) return;
      if (LOST_CODES.includes(failure?.code)) {
        // Nothing left to leave.
        ended = true;
        stopAll();
        ctx.forgetTable();
        ctx.goHome();
        return;
      }
      // leaveRoom stopped presence before it failed: draw the screen again, with the message.
      ended = true;
      stopAll();
      ctx.refresh(errorMessage(failure));
      return;
    }
    ended = true;
    stopAll();
    ctx.forgetTable();
    if (view.active()) ctx.goHome();
  }

  start();
  return root;
}
