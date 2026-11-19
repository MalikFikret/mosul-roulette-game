// Seeded PRNG (mulberry32). The generator state is a single uint32 that lives
// inside the game state as `state.rng.s`, so replaying the same actions on the
// same initial state always produces the same match.

// Accepts an integer or a string and returns a uint32 seed.
export function seedToUint32(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  // FNV-1a over the UTF-16 code units.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Pure step: returns the next uint32 output and the next generator state.
export function nextUint32(s) {
  const next = (s + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: next };
}

// The helpers below advance `state.rng` on a DRAFT state (see match.js).

// Integer in [0, n).
export function randInt(state, n) {
  const step = nextUint32(state.rng.s);
  state.rng.s = step.state;
  return Math.floor((step.value / 4294967296) * n);
}

// Integer in [min, max], both inclusive.
export function randRange(state, min, max) {
  return min + randInt(state, max - min + 1);
}

// Fisher-Yates shuffle of list[from..] in place.
export function shuffleInPlace(state, list, from = 0) {
  for (let i = list.length - 1; i > from; i--) {
    const j = from + randInt(state, i - from + 1);
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}
