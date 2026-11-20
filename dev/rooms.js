// Developer test page for the room and match layer (dev/rooms.html). Not the game UI.
//
// It loads the official Firebase JS SDK from the gstatic CDN (same major version as the npm
// devDependency) and talks ONLY to the local emulators (auth 9099, database 9000) of the demo
// project. Every tab signs in as its own anonymous user (in-memory auth persistence), so several
// tabs of one browser are several players.
//
// Start (Windows cmd, project root): `npm run emulators` in one window, `npm run dev` in another,
// then open http://localhost:8080/dev/rooms.html in several tabs.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  update,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js';
import { SEAT_IDS, createRoomApi, isSeatPresent } from '../src/rooms/index.js';

// --- Emulator only --------------------------------------------------------------------------
const PROJECT_ID = 'demo-mosul-roulette';
if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error('rooms.html only runs against a demo- project on the local emulators');
}
const EMULATOR_HOST = '127.0.0.1';
// The CLI applies database.rules.json to the default instance of the demo project.
const DATABASE_URL = `http://${EMULATOR_HOST}:9000?ns=${PROJECT_ID}-default-rtdb`;

const app = initializeApp({
  projectId: PROJECT_ID,
  // The auth emulator needs some API key; this placeholder is not a real key.
  apiKey: 'demo-api-key-for-the-emulator',
  databaseURL: DATABASE_URL,
});
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
const db = getDatabase(app, DATABASE_URL);
connectDatabaseEmulator(db, EMULATOR_HOST, 9000);

const api = createRoomApi({ db, ref, get, update, serverTimestamp, onValue, onDisconnect, runTransaction });

// --- Page state and helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const page = {
  uid: null,
  code: null,
  mySeat: null,
  meta: null,
  seats: {},
  presence: {},
  scores: {},
  delivery: null,
  offset: 0,
  stops: [],
};

function log(message, data) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${message}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
  $('log').prepend(li);
}

// Runs an API call from a button; errors go to the log (no dialogs).
async function act(label, fn) {
  try {
    const result = await fn();
    log(`${label}: ok`, result);
    return result;
  } catch (error) {
    log(`${label}: ${error.code ?? 'ERROR'} ${error.message}`);
    return undefined;
  }
}

function input(id) {
  return $(id).value;
}

// --- Entering a room ------------------------------------------------------------------------
async function enter(code, seatId) {
  for (const stop of page.stops) stop();
  page.stops = [];
  page.code = code;
  page.mySeat = seatId;
  page.delivery = null;
  $('code').value = code;
  $('roomCode').textContent = code;
  $('mySeat').textContent = seatId;
  $('room').classList.remove('hidden');
  $('events').textContent = '';

  const roomRef = (path) => ref(db, `rooms/${code}/${path}`);
  const watch = (path, fn) => page.stops.push(onValue(roomRef(path), (s) => fn(s.val()), (e) => log(`listen ${path}: ${e.message}`)));
  watch('meta', (meta) => {
    page.meta = meta;
    renderRoom();
  });
  watch('seats', (seats) => {
    page.seats = seats ?? {};
    renderRoom();
  });
  watch('presence', (presence) => {
    page.presence = presence ?? {};
    renderRoom();
  });
  watch('results', () => refreshScores());

  const onError = (where) => (error) => log(`${where}: ${error.code ?? 'ERROR'} ${error.message}`);
  page.stops.push(api.startPresence({ uid: page.uid, code, seatId, onError: onError('presence') }));
  page.stops.push(api.watchHost({ uid: page.uid, code, onError: onError('watchHost'), onResult: (r) => r.moved && log('host moved', r) }));
  page.stops.push(api.runMatchClock({ uid: page.uid, code, onError: onError('clock') }));
  page.stops.push(
    api.watchMatch({
      uid: page.uid,
      code,
      onError: onError('watchMatch'),
      onUpdate: (delivery) => {
        page.delivery = delivery;
        renderMatch(delivery);
      },
    }),
  );
}

async function refreshScores() {
  if (!page.code) return;
  try {
    page.scores = await api.getSessionScores({ uid: page.uid, code: page.code });
  } catch (error) {
    log(`scores: ${error.code ?? 'ERROR'} ${error.message}`);
  }
  renderRoom();
}

// --- Rendering ------------------------------------------------------------------------------
function renderRoom() {
  const meta = page.meta ?? {};
  $('status').textContent = meta.status ?? '-';
  const amHost = meta.hostSeat === page.mySeat;
  $('start').disabled = !amHost || meta.status !== 'lobby';
  const body = $('seats');
  body.textContent = '';
  for (const seatId of SEAT_IDS) {
    const seat = page.seats[seatId];
    if (!seat) continue;
    const tr = document.createElement('tr');
    const cells = [
      seatId + (seatId === page.mySeat ? ' (me)' : ''),
      seat.name,
      meta.hostSeat === seatId ? 'HOST' : '',
      isSeatPresent(page.presence[seatId]) ? 'yes' : 'no',
      seat.waiting ? 'waiting' : '',
      String(page.scores[seatId] ?? 0),
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const tools = document.createElement('td');
    if (amHost && seatId !== page.mySeat) {
      const kick = document.createElement('button');
      kick.textContent = 'kick';
      kick.disabled = meta.status !== 'lobby';
      kick.onclick = () => act(`kick ${seatId}`, () => api.kickSeat({ uid: page.uid, code: page.code, seatId }));
      const remove = document.createElement('button');
      remove.textContent = 'remove absent';
      remove.disabled = meta.status !== 'playing';
      remove.onclick = () => act(`remove ${seatId}`, () => api.removeAbsentPlayer({ uid: page.uid, code: page.code, seatId }));
      tools.append(kick, remove);
    }
    tr.append(tools);
    body.append(tr);
  }
}

function actionLabel(action) {
  const { type, playerId, ...rest } = action;
  const details = Object.keys(rest).length === 0 ? '' : ` ${JSON.stringify(rest)}`;
  return `${type}${details}`;
}

function renderMatch(delivery) {
  $('match').classList.remove('hidden');
  $('matchN').textContent = String(delivery.n);
  $('matchSeq').textContent = String(delivery.seq);
  $('view').textContent = JSON.stringify(delivery.view, null, 2);
  for (const event of delivery.events) {
    const li = document.createElement('li');
    li.textContent = `[${delivery.seq}] ${JSON.stringify(event)}`;
    $('events').append(li);
  }
  const box = $('actions');
  box.textContent = '';
  if (delivery.legalActions.length === 0) box.textContent = delivery.view.role === 'spectator' ? '(spectator: no actions)' : '(none right now)';
  for (const action of delivery.legalActions) {
    const button = document.createElement('button');
    button.textContent = actionLabel(action);
    button.onclick = () => act(actionLabel(action), () => api.submitAction({ uid: page.uid, code: page.code, action }));
    box.append(button);
  }
}

// The countdown of the current clock, in server time.
function renderClock() {
  const d = page.delivery;
  const clock = d?.view?.clock;
  if (!d || !clock || clock.kind === 'none' || typeof d.clockAt !== 'number') {
    $('countdown').textContent = d?.view?.status === 'ended' ? 'match over' : '-';
    return;
  }
  const deadline = d.clockAt + d.view.config.shotTimeSeconds * 1000;
  const left = Math.max(0, (deadline - (Date.now() + page.offset)) / 1000);
  $('countdown').textContent = `${clock.kind} for ${clock.playerId}: ${left.toFixed(1)} s`;
}

function renderTraffic() {
  const t = api.getTrafficStats();
  $('traffic').textContent = `sent ~${t.bytesWritten} B in ${t.writes} writes, received ~${t.bytesReceived} B in ${t.snapshots} snapshots`;
}

// --- Buttons --------------------------------------------------------------------------------
$('create').onclick = async () => {
  const result = await act('create', () =>
    api.createRoom({ uid: page.uid, name: input('name'), pin: input('pin'), mode: input('mode'), visibility: input('visibility') }),
  );
  if (result) await enter(result.code, result.seatId);
};
$('join').onclick = async () => {
  const result = await act('join', () => api.joinRoom({ uid: page.uid, code: input('code'), name: input('name'), pin: input('pin') }));
  if (result) await enter(input('code').trim().toUpperCase(), result.seatId);
};
$('listNames').onclick = async () => {
  const seats = await act('list seats', () => api.listSeatNames({ uid: page.uid, code: input('code') }));
  const select = $('recoverSeat');
  select.textContent = '';
  for (const seat of seats ?? []) {
    const option = document.createElement('option');
    option.value = seat.seatId;
    option.textContent = `${seat.seatId} ${seat.name}`;
    select.append(option);
  }
};
$('recover').onclick = async () => {
  const code = input('code').trim().toUpperCase();
  const result = await act('recover', () => api.recoverSeat({ uid: page.uid, code, seatId: input('recoverSeat'), pin: input('pin') }));
  if (result) await enter(code, result.seatId);
};
$('start').onclick = () => act('start match', () => api.startMatch({ uid: page.uid, code: page.code }));
$('leave').onclick = async () => {
  const result = await act('leave', () => api.leaveRoom({ uid: page.uid, code: page.code }));
  if (result) {
    for (const stop of page.stops) stop();
    page.stops = [];
    page.code = null;
    $('room').classList.add('hidden');
    $('match').classList.add('hidden');
  }
};
$('rename').onclick = () =>
  act('rename', () => api.renameSeat({ uid: page.uid, code: page.code, seatId: page.mySeat, name: input('newName') }));

// --- Start ----------------------------------------------------------------------------------
onValue(ref(db, '.info/serverTimeOffset'), (s) => {
  page.offset = Number(s.val()) || 0;
});
setInterval(renderClock, 250);
setInterval(renderTraffic, 1000);

const credential = await signInAnonymously(auth);
page.uid = credential.user.uid;
$('name').value = `Player ${page.uid.slice(0, 4)}`;
$('who').textContent = `Signed in (anonymous, this tab only) as ${page.uid} - project ${PROJECT_ID}, emulators at ${EMULATOR_HOST}`;
log('ready');
