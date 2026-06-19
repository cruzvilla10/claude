# 🎲 Craps Table

A full-featured casino craps game that runs entirely in the browser. No build
step, no dependencies — open `index.html` and play.

## Play

```bash
# from the project root, just open the file:
xdg-open index.html      # Linux
open index.html          # macOS
# or serve it:
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How to play

1. **Pick a chip** in the sidebar ($1 / $5 / $25 / $100 / $500).
2. **Click a bet area** on the felt to place that chip there. Click again to
   stack more. **Right-click** a bet to take it down (when the rules allow).
3. Press **ROLL DICE** (or hit `Space`) to throw.
4. Your **bankroll** persists in the browser. Use **Cash In / Reset** to start
   over at $1,000.

The gold outline shows which line/come bets are legal in the current phase
(come-out vs. point established).

## Bets supported (full casino layout)

| Bet | Pays | Notes |
|-----|------|-------|
| Pass Line | 1:1 | Win 7/11 come-out; point must repeat before 7 |
| Don't Pass | 1:1 | Bar 12 pushes |
| Pass Line Odds | true odds (2:1 / 3:2 / 6:5) | Up to 5× the line bet |
| Don't Pass Odds | lay odds (1:2 / 2:3 / 5:6) | |
| Come / Don't Come | 1:1 | Travels to its number, then resolves |
| Place 4·5·6·8·9·10 | 9:5 / 7:5 / 7:6 | Stays up after a win |
| Lay 4·5·6·8·9·10 | lay odds | Bet against a number |
| Field | 1:1 (2 & 12 pay double) | One-roll |
| Hardways 4·6·8·10 | 7:1 / 9:1 | Must roll as a pair before easy/7 |
| Any 7 | 4:1 | One-roll |
| Any Craps | 7:1 | One-roll (2/3/12) |
| C & E | 3:1 craps / 7:1 eleven | One-roll |
| Horn | 30:1 (2,12) / 15:1 (3,11) | 4-way split, one-roll |
| 2 · 12 | 30:1 | One-roll |
| 3 · 11 | 15:1 | One-roll |

### House-rule choices in this build
- Place bets and hardways are **always working** (including on the come-out)
  so the single-player flow stays simple and explicit.
- Lay / Don't-side odds use clean true-odds payouts with **no commission (vig)**.
- Field 12 pays **double** (matching the felt text); some casinos pay triple.
- Pass/Don't Pass odds are capped at 5× the flat bet.

## Project layout

```
index.html         # table layout + markup
styles.css         # green-felt styling, chips, dice
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
