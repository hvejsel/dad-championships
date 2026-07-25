# Dad Championships

A mobile web app for running a multi-sport championship across three
generations. You choose the sports, the app draws up every match, and one table
decides who buys the beer.

Live: https://hvejsel.github.io/dad-championships/

## What it does

1. Choose how many are playing and name them — each one is a dad, a granddad
   or a kid. Every choice on the setup screens is a select.
2. Choose the sports. Each sport gets its own game type and its own point type.
3. The app draws up the whole programme itself, so everyone meets everyone.
4. Put the times on afterwards, as you book the courts. The list re-sorts
   itself and says what happens next.
5. Enter the score after each match. The table updates itself.

The match list is the home screen. A sport with no time yet is called out, so
nothing is forgotten.

## Game types

Game type is set per sport, not per championship — padel can be doubles on the
same day darts is singles. It can be changed later from the sport's own sheet,
which draws up a fresh programme for that sport and leaves the others alone.

**1 v 1** — a full round robin: every player meets every other player exactly
once, spread across rounds so nobody plays twice in a row.

**2 v 2** — every possible partnership is used once, and each is put up against
the pair its four players have met the least. Everyone partners everyone and
meets everyone; points are still scored individually.

**All vs all** — one round with everybody in it at the same time, which is how
mini golf is played. Each player enters his own score.

You can still add an extra match by hand in a 1 v 1 or 2 v 2 sport.

## Point types

Also per sport, so a high-scoring sport cannot drown out a low-scoring one.

**Win = 3** — win 3, draw 1, loss 0. In an all-vs-all round the best score takes
the 3 points, and a shared best score is a draw.

**Score counts** — every point your side scores is added to your own total. This
is the natural one for all vs all: point for point, most points wins.

Ties are split on score difference, then on points scored. In a match with more
than two sides, what you were up against is the best score anyone else put up.

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
