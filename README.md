# 🎲 Craps Table

A full-featured casino craps game that runs entirely in the browser. No build
step, no dependencies, nothing to install.

## Play

**▶ Live game:** https://raw.githack.com/cruzvilla10/claude/main/index.html

Bookmark that link and play anytime — it serves the latest version straight
from this repo, so any update appears on a refresh.

> Prefer to run it offline? Because it's a plain static page, you can also just
> download `index.html`, `styles.css`, and `craps.js` into one folder and open
> `index.html` in any browser.

The UI is styled after a live "bubble craps" table: a dark felt panel, props
on top with pip-dice, the `4·5·6·8·9·10` place numbers with `LOSE`/`WIN`
tabs, an `ON`/`OFF` puck that sits on the point, red 3-D dice with a big
result number, and a `YOU WIN $X` banner. It's a vertical layout that works
on phones and in any desktop browser window.

## How to play

1. **Pick a chip** in the bottom bar ($1 / $5 / $25 / $100 / $500).
2. **Tap a bet area** on the felt to place that chip there. Tap again to
   stack more. **Right-click** (or long-press) a bet to take it down.
3. Press **ROLL** (or hit `Space`) to throw the dice.
4. Your **bankroll** persists in the browser. The small **⟲ $1000** button
   (top-right) resets it.

### Bottom action bar
- **UNDO** — removes the last chip you placed (until you roll).
- **REBET** — re-places the same bets you had on the previous roll.
- **DOUBLE (×2)** — doubles every bet currently on the table.
- **ROLL** — throws the dice.

The gold outline shows which line/come bets are legal in the current phase
(come-out vs. point established). Winning bets flash gold.

## Bets supported

| Bet | Pays | Notes |
|-----|------|-------|
| Pass Line | 1:1 | Win 7/11 come-out; point must repeat before 7 |
| Don't Pass | 1:1 | Bar 12 pushes |
| Pass / Don't Pass Odds | true odds (2:1 / 3:2 / 6:5) | Slim bars under the line; up to 5× |
| Come / Don't Come | 1:1 | Travels to its number, then resolves |
| Place 4·5·6·8·9·10 | 9:5 / 7:5 / 7:6 | Stays up after a win |
| Field | 1:1 (2 & 12 pay double) | One-roll |
| Hardways 4·6·8·10 | 7:1 / 9:1 | Must roll as a pair before easy/7 |
| Seven (Any 7) | 4:1 | One-roll |
| Any Craps | 7:1 | One-roll (2/3/12) |
| C & E | 3:1 craps / 7:1 eleven | One-roll |
| 2 · 12 | 30:1 | One-roll |
| 3 · 11 | 15:1 | One-roll |

### House-rule choices in this build
- Place bets and hardways are **always working** (including on the come-out)
  so the single-player flow stays simple and explicit.
- Odds use clean true-odds payouts with **no commission (vig)**.
- Field 12 pays **double** (matching the felt text); some casinos pay triple.
- Pass/Don't Pass odds are capped at 5× the flat bet.
- The rules engine also supports Lay bets and the Horn split, though the
  bubble-craps layout doesn't surface buttons for them.

## Project layout

```
index.html         # table layout + markup
styles.css         # dark "bubble craps" styling, chips, pip-dice
craps.js           # game engine (state machine, payouts, persistence)
test/craps.test.js # headless Node tests for the rules engine
```

## Tests

The rules engine is pure and headless-testable:

```bash
node test/craps.test.js
```

Covers every payout, point transitions, contract vs. one-roll handling,
come-bet travel, and a 2,000-roll fuzz simulation.
