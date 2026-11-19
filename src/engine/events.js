// Event construction and filtering.
//
// Every event carries a `visibility` tag:
//   { visibility: 'public' }                 -> everyone may see it
//   { visibility: 'private', to: [ids...] }  -> only the listed players
//   { visibility: 'private', to: [] }        -> nobody (audit record for the
//                                               trusted host / dev tools only)

// `ctx` is the reducer context: { state: <draft>, events: [] }.

export function pub(ctx, type, data) {
  const event = { type, ...data, visibility: 'public' };
  ctx.events.push(event);
  return event;
}

export function priv(ctx, to, type, data) {
  const list = Array.isArray(to) ? to.slice() : [to];
  // Addressing goes last so a data field can never override it.
  const event = { type, ...data, visibility: 'private', to: list };
  ctx.events.push(event);
  return event;
}

export function audit(ctx, type, data) {
  return priv(ctx, [], type, data);
}

// The events a given player is allowed to receive. Pass null/undefined for an
// outside spectator (public events only).
export function eventsFor(events, playerId) {
  return events.filter(
    (e) => e.visibility === 'public' || (playerId != null && e.visibility === 'private' && e.to.includes(playerId)),
  );
}

export function publicEvents(events) {
  return events.filter((e) => e.visibility === 'public');
}
