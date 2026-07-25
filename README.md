# Dad Championships

A mobile web app for running a multi-sport championship across three
generations. It carries its own name and crest, works out who plays whom, and
one table decides who buys the beer.

Live: https://hvejsel.github.io/dad-championships/

## What it does

1. Name the championship — the crest in the top corner is drawn from the name.
2. Choose how many are playing and name them: each one is a dad, a granddad or
   a kid. Every choice on the setup screens is a select.
3. Choose the sports. Each sport gets its own game type and point type.
4. The app draws one match per player per sport and picks the opponents so the
   sports together work through everyone against everyone.
5. Tap a sport to open it: its matches, its times and its settings live there.
6. Tap a match to edit it — who is on each side, and the score.
7. More time than you thought? **Add a sport** takes the pairings nobody has
   played yet.

## Nobody sits out — Pedro

One round cannot always hold everybody: five players in singles leaves one over,
six in doubles leaves two. Instead of a bench, whoever is left over plays one
extra match — a **Pedro match** — filled up with players drawn at random from
those already playing, favouring whoever has had the fewest Pedro matches.

Pedro has its own board, its own points and its own rule: the points are held
back until every player has actually played a Pedro match, and they only count
in the main table if you say they should. The board names whoever is still
waiting, and the table says so too.

Any match can be marked as a Pedro match by hand, in the match editor.

## Game types

Game type is set per sport, not per championship — padel can be doubles on the
same day darts is singles. Change it later from the sport's own settings and a
new match is drawn for that sport alone.

**1 v 1** — one opponent each, one score per person. A sport is one round of the
round robin, so the sports together cover every pairing.

**2 v 2** — one match each, two per side, **one score per team**; both players
are credited with the team's score. Partnerships rotate from sport to sport.

**All vs all** — one round with everybody in it, **one score per person**, which
is how mini golf is played. Nobody has a named opponent, so this game type does
not tick off the head-to-head pairings.

## Point types

Also per sport, so a high-scoring sport cannot drown out a low-scoring one.

**Winner gets points** — you set what a win is worth, from 1 to 50. A draw is
worth 1, a loss 0 (and when a win is worth 1, a draw is worth nothing). In an
all-vs-all round the best score takes the points, and a shared best score is a
draw.

**Score counts** — every point your side scores is added to your own total.

Ties are split on score difference, then on points scored. In a match with more
than two sides, what you were up against is the best score anyone else put up.

## Editing after the fact

Everything the setup asks for can be changed afterwards: the championship name
and crest, a sport's name, time, game type and point type, and every element of
a match — the players on each side, the score, whether it is a Pedro match. A
match can be added by hand, cleared, or deleted, and a sport can be deleted with
its matches.

Picking a player who is already in the match swaps the two around, which is how
you rearrange opponents without emptying the match first.

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
| `app.js` | Screens, the crest, state and storage |
| `test.mjs` | Engine tests |
| `sw.js` | Offline cache |
