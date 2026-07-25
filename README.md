# Dad Championships

A mobile web app for running a multi-sport championship between dads. One pitch,
one sport at a time, one table that decides who buys the beer.

Live: https://hvejsel.github.io/dad-championships/

## What it does

1. Pick how many sports you are playing and name them.
2. Pick how many dads are playing and name them.
3. Choose **1 v 1** or **2 v 2**, and how points are awarded.
4. The app builds the full fixture list — every sport finished before the next one starts.
5. Enter the score after each match. The table updates itself.

## Formats

**1 v 1** — a full round robin per sport: every dad meets every other dad once.
With 4 dads that is 6 matches per sport.

**2 v 2** — americano style: partners rotate every match and everyone still
scores individually. The scheduler keeps game counts level and avoids repeating
partners for as long as it can. With 4 dads it produces the 3 matches where
everyone partners everyone exactly once.

## Points

**Win = 3** — win 3, draw 1, loss 0. Keeps a high-scoring sport from drowning
out a low-scoring one, so this is the default.

**Score counts** — every point your team scores is added to your own total,
which is how a padel americano is normally run.

Ties are split on score difference, then on points scored.

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
