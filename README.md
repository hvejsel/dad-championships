# Dad Championships

A mobile web app for running a multi-sport championship across three
generations. You choose the sports, the app works out who plays whom, and one
table decides who buys the beer.

Live: https://hvejsel.github.io/dad-championships/

## What it does

1. Choose how many are playing and name them — each one is a dad, a granddad
   or a kid. Every choice on the setup screens is a select.
2. Choose the sports. Each sport gets its own game type and its own point type.
3. The app draws one match per player per sport, and picks the opponents so the
   sports together work through everyone against everyone.
4. Put the times on afterwards, as you book the courts. The list re-sorts
   itself and says what happens next.
5. Enter the score after each match. The table updates itself.
6. More time than you thought? Add a sport with **Add a sport** and it takes
   the pairings nobody has played yet.

The match list is the home screen. It names the pairings still to meet and any
sport that has no time yet, so nothing is forgotten.

## Game types

Game type is set per sport, not per championship — padel can be doubles on the
same day darts is singles. It can be changed later from the sport's own sheet,
which draws a new match for that sport and leaves the others alone.

**1 v 1** — one opponent each. A sport is one round of the round robin, so
everybody plays exactly once; the sports together cover every pairing. With an
odd number, one player sits each sport out, and the list says who.

**2 v 2** — one match each, two per side. Partnerships rotate from sport to
sport, so everyone partners everyone and meets everyone. Points are still
scored individually.

**All vs all** — one round with everybody in it at the same time, which is how
mini golf is played. Each player enters his own score. Nobody has a named
opponent, so this game type does not tick off the head-to-head pairings.

## Point types

Also per sport, so a high-scoring sport cannot drown out a low-scoring one.

**Winner gets points** — you set what a win is worth, from 1 to 50. A draw is
worth 1, a loss 0 (and when a win is worth 1, a draw is worth nothing). In an
all-vs-all round the best score takes the points, and a shared best score is a
draw.

**Score counts** — every point your side scores is added to your own total.
This is the natural one for all vs all: point for point, most points wins.

Ties are split on score difference, then on points scored. In a match with more
than two sides, what you were up against is the best score anyone else put up.

## Storage

Everything is kept on the phone that keeps score, in that browser's local
storage — so it survives a refresh, a restart and a day with no signal, and
never leaves the phone. On load the store is migrated in place, which means an
app update takes over a running championship instead of losing it.

## Design

"Sunlit scorecard." The app is used standing on a court in daylight, so the
surface is warm paper rather than dark chrome, and the palette comes from the
world the game is played in: court blue for anything you can touch, brass for
rank and victory, clay and grass for a negative and positive difference.

The signature is the court: the match card splits the two teams across a net
line with a centre disc, and that shape repeats in the score editor and in the
Play tab icon. Rank uses drawn brass, silver and bronze medallions rather than
emoji. One depth strategy throughout — paper lifted slightly off the desk.

Tokens are named after that world (`--paper`, `--chalk`, `--ink`, `--court`,
`--brass`, `--clay`, `--grass`), so a value's meaning is readable from its name.

## Running it

Static files, no build step and no backend. Everything is stored on the phone
that keeps score, so it works with no signal and survives a refresh.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node test.mjs                 # engine tests
node tools/gen-icons.mjs      # regenerate the app icons
```

Add it to your home screen and it opens full screen like a normal app.

## Layout

| File | What it holds |
| --- | --- |
| `tournament.js` | The programme and the standings — pure functions, no DOM |
| `app.js` | Screens, state and storage |
| `test.mjs` | Engine tests |
| `sw.js` | Offline cache |
