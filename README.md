# Dad Championships

A mobile web app for running a multi-sport championship across three
generations. You pick the opponents, you set the times, and one table decides
who buys the beer.

Live: https://hvejsel.github.io/dad-championships/

## What it does

1. Add everyone playing — each one is a dad, a granddad or a kid.
2. Add the sports. Each sport is set up on its own: singles or doubles, plus
   the time you booked the court for.
3. Pick who plays whom in each sport. Nobody has to play everyone.
4. Enter the score after each match. The table updates itself.

The match list is the home screen. Sports appear in the order of their booked
time, so everybody can see what happens when, and the app tells you who is
still without an opponent in each sport.

## Formats

Format is set per sport, not per championship — padel can be doubles on the
same day darts is singles.

**1 v 1** — one player on each side.

**2 v 2** — two on each side, and everyone still scores individually.

Opponents are always chosen by hand. Changing a sport's format clears the
matches already added to that sport, and only that sport.

## Points

**Win = 3** — win 3, draw 1, loss 0. Keeps a high-scoring sport from drowning
out a low-scoring one, so this is the default.

**Score counts** — every point your team scores is added to your own total,
which is how a padel americano is normally run.

Ties are split on score difference, then on points scored.

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
| `tournament.js` | Fixture generation and standings — pure functions, no DOM |
| `app.js` | Screens, state and storage |
| `test.mjs` | Engine tests |
| `sw.js` | Offline cache |
