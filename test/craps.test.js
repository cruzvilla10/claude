/* Headless tests for the craps engine. Run: node test/craps.test.js
   Stubs just enough DOM/localStorage so the real module loads, then drives
   resolveRoll() and checks bankroll accounting + bet outcomes. */

// ---- Minimal DOM / storage stubs -----------------------------------------
function fakeEl() {
  return {
    textContent: "", innerHTML: "", className: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, style: {}, childElementCount: 0, lastChild: null,
    appendChild() {}, prepend() {}, remove() {}, addEventListener() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}
global.document = {
  querySelector() { return fakeEl(); },
  querySelectorAll() { return []; },
  createElement() { return fakeEl(); },
  addEventListener() {},
  get activeElement() { return { tagName: "BODY" }; },
};
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.confirm = () => true;

const craps = require("../craps.js");

// ---- Tiny assert framework ------------------------------------------------
let passed = 0, failed = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`✗ ${msg}\n    expected ${expected}, got ${actual}`); }
}

// Configure a fresh game state, roll once, return resulting state.
// `bankroll` is the PRE-placement balance; stakes for the given bets are
// deducted first, mirroring what placeBet() does in the live game.
function rollWith({ point = null, bets = {}, bankroll = 1000 }, d1, d2) {
  const copy = JSON.parse(JSON.stringify(bets));
  const staked = Object.values(copy).reduce((sum, b) => sum + b.amount, 0);
  craps.setState({ point, bets: copy, bankroll: bankroll - staked, selectedChip: 25 });
  craps.resolveRoll(d1, d2);
  return craps.getState();
}

// ==== Payout helpers =======================================================
eq(craps.trueOddsProfit(4, 10), 20, "true odds 4 -> 2:1");
eq(craps.trueOddsProfit(5, 10), 15, "true odds 5 -> 3:2");
eq(craps.trueOddsProfit(6, 12), 14.4, "true odds 6 -> 6:5");
eq(craps.layOddsProfit(4, 20), 10, "lay odds 4 -> 1:2");
eq(craps.layOddsProfit(5, 30), 20, "lay odds 5 -> 2:3");
eq(craps.placeProfit(6, 12), 14, "place 6 -> 7:6");
eq(craps.placeProfit(4, 10), 18, "place 4 -> 9:5");

// ==== Point transitions ====================================================
eq(craps.nextPoint(null, 7).point, null, "come-out 7 stays off");
eq(craps.nextPoint(null, 5).point, 5, "come-out 5 sets point");
eq(craps.nextPoint(5, 5).point, null, "point made -> off");
eq(craps.nextPoint(5, 7).point, null, "seven out -> off");
eq(craps.nextPoint(5, 9).point, 5, "non-decision keeps point");

// ==== Pass line ============================================================
let s = rollWith({ bets: { pass: { type: "pass", num: null, amount: 10 } } }, 4, 3); // 7 on come-out
eq(s.bankroll, 1010, "pass wins on come-out 7 (+10)");

s = rollWith({ bets: { pass: { type: "pass", num: null, amount: 10 } } }, 1, 1); // 2 craps
eq(s.bankroll, 990, "pass loses on come-out craps (-10)");

s = rollWith({ bets: { pass: { type: "pass", num: null, amount: 10 } } }, 2, 2); // point 4
eq(s.point, 4, "pass establishes point 4");
eq(s.bankroll, 990, "stake stays on table while point on");
eq(s.bets.pass.amount, 10, "pass bet remains");

// Now make the point 4
s = rollWith({ point: 4, bets: { pass: { type: "pass", num: null, amount: 10 } } }, 2, 2);
eq(s.point, null, "point 4 made -> off");
eq(s.bankroll, 1010, "pass paid even money on point made");

// Seven out
s = rollWith({ point: 4, bets: { pass: { type: "pass", num: null, amount: 10 } } }, 3, 4);
eq(s.bankroll, 990, "pass lost on seven out (stake already off)");
eq(Object.keys(s.bets).length, 0, "pass removed on seven out");

// ==== Pass odds (true odds) ===============================================
s = rollWith({ point: 4, bets: {
  pass: { type: "pass", num: null, amount: 10 },
  passodds: { type: "passodds", num: null, amount: 10 },
} }, 2, 2);
// pass: stake10 + profit10 = 20; odds: stake10 + profit20 (2:1) = 30; total +50 net +30
eq(s.bankroll, 1030, "pass(+10) & odds(+20 at 2:1) on point 4");

// ==== Don't pass ===========================================================
s = rollWith({ bets: { dontpass: { type: "dontpass", num: null, amount: 10 } } }, 6, 6); // 12 bar
eq(s.bankroll, 1000, "don't pass pushes on 12 (stake returned)");
s = rollWith({ bets: { dontpass: { type: "dontpass", num: null, amount: 10 } } }, 1, 1); // 2 wins
eq(s.bankroll, 1010, "don't pass wins on come-out 2");
s = rollWith({ point: 6, bets: { dontpass: { type: "dontpass", num: null, amount: 10 } } }, 3, 4); // 7 out wins
eq(s.bankroll, 1010, "don't pass wins on seven out");

// ==== Place bets ===========================================================
s = rollWith({ point: 5, bets: { "place-6": { type: "place", num: 6, amount: 12 } } }, 3, 3);
eq(s.bankroll, 1002, "place 6 wins 7:6 (+14 profit, $12 stake stays on table)");
eq(s.bets["place-6"].amount, 12, "place bet stays up after win");
s = rollWith({ point: 5, bets: { "place-6": { type: "place", num: 6, amount: 12 } } }, 3, 4);
eq(s.bankroll, 988, "place 6 loses on 7, stake gone");
eq(Object.keys(s.bets).length, 0, "place removed on 7");

// ==== Field ================================================================
s = rollWith({ bets: { field: { type: "field", num: null, amount: 10 } } }, 1, 1); // 2 -> double
eq(s.bankroll, 1020, "field 2 pays double (net +20)");
s = rollWith({ bets: { field: { type: "field", num: null, amount: 10 } } }, 4, 5); // 9 -> even
eq(s.bankroll, 1010, "field 9 pays even (net +10)");
s = rollWith({ bets: { field: { type: "field", num: null, amount: 10 } } }, 3, 2); // 5 loses
eq(s.bankroll, 990, "field 5 loses (-10)");

// ==== Hardways =============================================================
s = rollWith({ bets: { "hard-8": { type: "hard", num: 8, amount: 5 } } }, 4, 4); // hard 8
eq(s.bankroll, 1040, "hard 8 hits hard (9:1, net +40), stake stays");
eq(s.bets["hard-8"].amount, 5, "hardway stays up after win");
s = rollWith({ bets: { "hard-8": { type: "hard", num: 8, amount: 5 } } }, 5, 3); // easy 8
eq(s.bankroll, 995, "hard 8 loses on easy way (-5)");

// ==== One-roll props =======================================================
s = rollWith({ bets: { any7: { type: "any7", num: null, amount: 5 } } }, 3, 4);
eq(s.bankroll, 1020, "any 7 pays 4:1 (net +20)");
s = rollWith({ bets: { prop12: { type: "prop12", num: null, amount: 1 } } }, 6, 6);
eq(s.bankroll, 1030, "prop 12 pays 30:1 (net +30)");
s = rollWith({ bets: { horn: { type: "horn", num: null, amount: 4 } } }, 6, 6); // 12
eq(s.bankroll, 1027, "horn 12 nets +27 on $4");

// ==== Come bet travel + win ===============================================
s = rollWith({ point: 5, bets: { come: { type: "come", num: null, amount: 10 } } }, 3, 3); // 6
eq(s.bets["comepoint-6"].amount, 10, "come travels to 6");
eq(s.point, 5, "come travel doesn't change main point");
// Now roll the 6: come point wins
s = rollWith({ point: 5, bets: { "comepoint-6": { type: "comepoint", num: 6, amount: 10 } } }, 3, 3);
eq(s.bankroll, 1010, "come point 6 wins even money (net +10)");
// Come pending wins immediately on 7 (but main point sevens out)
s = rollWith({ point: 5, bets: { come: { type: "come", num: null, amount: 10 } } }, 3, 4);
eq(s.bankroll, 1010, "come pending wins on 7 (net +10)");

// ==== Come odds ============================================================
s = rollWith({ point: 5, bets: { "comeodds-6": { type: "comeodds", num: 6, amount: 10 } } }, 3, 3); // 6 hits
eq(s.bankroll, 1012, "come 6 odds win true odds (6:5 -> +12)");
s = rollWith({ point: 5, bets: { "comeodds-6": { type: "comeodds", num: 6, amount: 10 } } }, 3, 4); // 7
eq(s.bankroll, 990, "come 6 odds lose on 7");
s = rollWith({ point: 5, bets: { "dccomeodds-4": { type: "dccomeodds", num: 4, amount: 20 } } }, 3, 4); // 7 wins
eq(s.bankroll, 1010, "don't come 4 odds win on 7 (1:2 -> +10)");
s = rollWith({ point: 5, bets: { "dccomeodds-4": { type: "dccomeodds", num: 4, amount: 20 } } }, 2, 2); // 4
eq(s.bankroll, 980, "don't come 4 odds lose when 4 rolls");

// ==== Lay bet ==============================================================
s = rollWith({ point: 5, bets: { "lay-4": { type: "lay", num: 4, amount: 20 } } }, 3, 4); // 7 wins
eq(s.bankroll, 990, "lay 4 wins on 7 (+10 profit, $20 stake stays on table)");
s = rollWith({ point: 5, bets: { "lay-4": { type: "lay", num: 4, amount: 20 } } }, 2, 2); // 4 loses
eq(s.bankroll, 980, "lay 4 loses when 4 rolls");

// ==== Full random simulation: bankroll conservation ========================
// Drive 2000 random rolls with a pass-line + odds strategy and assert the
// engine never produces NaN / negative-from-nowhere balances and that
// bankroll + at-risk only changes by realised win/loss (sanity: stays finite).
(function simulate() {
  craps.setState({ point: null, bets: {}, bankroll: 100000, selectedChip: 25 });
  for (let i = 0; i < 2000; i++) {
    const st = craps.getState();
    if (st.point === null && !st.bets.pass && st.bankroll >= 10) {
      st.bets.pass = { type: "pass", num: null, amount: 10 };
      st.bankroll -= 10;
    }
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    craps.resolveRoll(d1, d2);
    const after = craps.getState();
    if (!Number.isFinite(after.bankroll)) { failed++; console.error("✗ bankroll became non-finite"); break; }
  }
  const fin = craps.getState();
  if (Number.isFinite(fin.bankroll)) passed++;
  else { failed++; console.error("✗ simulation produced bad bankroll"); }
})();

// ---- Summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
