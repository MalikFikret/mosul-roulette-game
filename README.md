# Mosul Roulette Game

An online multiplayer elimination game for 3 to 15 players, each on their own device. A roulette
holds live and blank chambers in a hidden order; players take turns shooting, and use tools that
reveal, protect or deceive. The last player alive wins. There are two modes: **Classic** (tools are
dealt at random) and **Custom** (Classic plus private information, coins and a shop, and
predictions for eliminated players). Session points add up across the matches played in a room.

**Tech stack:** plain JavaScript ES modules with no build step and no runtime dependencies; a pure,
deterministic rules engine; Firebase Realtime Database with security rules, tested on the local
Firebase Emulator Suite.

## Run locally

You need Node.js 24.12 or newer, the Firebase CLI (`npm install -g firebase-tools`) and Java 21 or
newer (for the database emulator). Everything runs against the local emulators of the demo project
`demo-mosul-roulette`; no real Firebase project is used.

```sh
npm install
npm run emulators   # first terminal: Auth and Realtime Database emulators
npm run dev         # second terminal: static server on http://localhost:8080
```

Then open `http://localhost:8080/dev/rooms.html` in several browser tabs: each tab is its own
player. `http://localhost:8080/dev/` is a hot-seat page for the rules engine alone.

## Tests

```sh
npm test            # rules engine and pure room-layer tests (no emulator needed)
npm run test:rules  # security rules and room layer on the emulators (starts and stops them)
```

The security rules are generated from `tools/rules/` with `npm run rules:build`; never edit
`database.rules.json` by hand (a test checks that it matches the generator).
