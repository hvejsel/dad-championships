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
5. Tap a sport to open it: its matches, its booked day and time, and its
   settings live there. A sport that has been played all the way out is ticked
   off in the overview, so what is left is the thing you see.
6. Tap a match to edit it — who is on each side, and the score.
7. More time than you thought? **Add a sport** takes the pairings nobody has
   played yet.

## Nobody sits out — Pedro

One round cannot always hold everybody: five players in singles leaves one over,
six in doubles leaves two. Instead of a bench, whoever is left over plays one
extra match — a **Pedro match**.

Pedro is simply **the last player on the list**. The same name every time, no
dice, so you can see at a glance who is going to play twice and reorder the
field if you would rather it were somebody else. A Pedro match counts exactly
like any other match; nothing is held back and there is no separate board.

**A Pedro does not have to be one of the players.** Add a stand-in under *Who is
playing* — Pedro, a neighbour, whoever turned up — and pick them on either side
of any match, so "Anders v Pedro" is a normal thing to set up. A stand-in fills
the spot so nobody sits out, plays for nothing, and never appears in the table.

Any match can be marked as a Pedro match by hand, in the match editor.

## Who is playing — editable all day

The field is not settled when the championship starts. Somebody turns up late,
somebody has to leave at four, and a name gets spelled wrong. *Who is playing*
in the menu handles all three:

- **Rename** anyone by typing over the name; it saves as you type and every
  result is kept.
- **Change a generation** with the tag beside the name.
- **Add a player** mid-championship. They start with no matches, and each sport
  says who still has none so you can add one.
- **Take somebody out.** Their matches go with them — a match with an empty side
  cannot be played or scored — and the app says how many that is before you
  agree. Every other result is untouched.

Stand-ins are added, renamed and removed in the same place.

## Times run over days, not hours

A booked time is a **day and a clock time**, because a championship runs over a
weekend as easily as an afternoon. The list orders itself by when things
actually happen, across days, and reads the day back the way you would say it:
"Today 14:30", "Tomorrow 09:00", "Sat 26 Jul 14:30". A championship saved when
times were clock-only keeps its time and is given the day it was set up.

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

## A championship in a link

**Send the championship** puts the whole thing — field, programme, every result
— inside a link and opens the phone's share sheet, so it goes into the family
chat like any other link. Whoever taps it has the championship on their own
phone, with no app to install and no account. A five-player, three-sport
championship makes a link of about 600 characters.

Nothing is uploaded: the championship travels inside the link itself, after the
`#`, which browsers never send to a server. Tapping a link while the app is
already open works too — the app watches for it.

Why a link and not a file the app keeps updated by itself: a browser on a phone
**cannot** write a file on its own. `showSaveFilePicker` does not exist in
Safari, on the phone or on the Mac — only Chrome and Edge on a computer have
it. A link is the one route that works on the device the app is actually used
on.

## A championship in a file

**Save to a file** in the menu writes the whole championship — the field, the
programme and every result — to one file. On a phone the share sheet opens
first, so it goes straight to AirDrop, Messages or Mail; on a desktop it
downloads. **Open from a file** reads one back on any device.

A link and a file are both a *copy*, not a shared line. Whoever opens one
carries on from that point on their own phone; if two people both enter scores
afterwards, the two copies drift apart, and neither a file in a shared folder
nor a link can merge them. For everyone entering scores at the same time the
championship has to live somewhere shared, which needs a server.

## Storage — a library, not one championship

Everything is kept on the phone that keeps score, in that browser's local
storage — so it survives a refresh, a restart and a day with no signal, and
never leaves the phone.

The phone keeps a *library* of championships under one key,
`dadchamps.library.v1`: every championship it has ever held, plus which one is
open. Starting this year's does not cost you last year's. "Your championships"
in the menu lists them newest-touched first, switches between them, and deletes
one at a time. On load the store is migrated in place — a championship saved by
the one-at-a-time version of the app becomes the first entry in the library
rather than being lost.

## Made for a thumb

The app is used one-handed, standing up, on a phone. Three rules follow from
that, and `test-mobile.mjs` holds each of them:

- **No browser dialogs.** A web app added to the home screen is not always
  shown `confirm()`, so every button behind one looks dead. The app asks its
  own yes/no question in a sheet instead.
- **Every sheet pulls closed.** A sheet closes from the Cancel button, from a
  tap on the dimmed area behind it, and from a pull down on the sheet itself —
  which follows the finger and springs back if you let go too early. A sheet
  that scrolls is pulled from its handle or its heading, so the two gestures
  never fight.
- **Nothing under 44px, nothing covering a button.** That is the size a thumb
  hits reliably, and the toast never swallows a tap meant for what is under it.
- **Nothing behind the keyboard.** A phone keyboard does not shrink the page,
  it covers the bottom half of it, so a button down there is invisible and
  untappable — indistinguishable from a dead button. The app measures the
  keyboard live from the visual viewport into `--keyboard`, and every pinned
  action and every sheet sits on top of it. Enter on the keyboard also moves
  from one name to the next, so the button is never the only way forward.
- **Nothing fails in silence.** Sharing tries the phone's share sheet, then the
  clipboard, then shows the table as plain text to copy by hand — one of those
  always works, and every one of them says so.
- **Every tap target is a control you can edit in place.** The field is edited
  by typing over a name, not by opening a form to fill in.

## Keeping it current

Added to the home screen the app has no reload button, and the phone brings it
back exactly as it was left, so a deployed fix can sit on the server for days
without ever reaching the screen. The app therefore checks for a new version
every time it is opened or brought to the front, and reloads itself once when
one arrives — the running championship survives it. The foot of the menu shows
which version is actually on the phone, and **Update the app** clears every
cache and fetches the newest build if even that gets stuck.

When something is reported as still broken, the version line is the first thing
to ask for: it says whether the fix ever arrived. `test-update.mjs` drives that
whole path.

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
node test-mobile.mjs          # mobile tests (needs playwright + webkit)
node test-update.mjs          # the self-update path
node test-keyboard.mjs        # nothing hides behind the on-screen keyboard
node tools/gen-icons.mjs      # regenerate the app icons
```

Add it to your home screen and it opens full screen like a normal app.

## Layout

| File | What it holds |
| --- | --- |
| `tournament.js` | The programme and the standings — pure functions, no DOM |
| `app.js` | Screens, the crest, state and storage |
| `test.mjs` | Engine tests |
| `test-mobile.mjs` | Mobile tests — taps, sheets, the library, sharing |
| `test-update.mjs` | The self-update path |
| `test-keyboard.mjs` | Nothing hides behind the on-screen keyboard |
| `sw.js` | Offline cache |
