/* Headless tests for the Crapless Craps engine. Run: node test/crapless.test.js */

function fakeEl() {
  return { textContent: "", innerHTML: "", className: "", classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, style: {}, childElementCount: 0, lastChild: null, appendChild() {}, prepend() {}, remove() {}, addEventListener() {}, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
}
global.document = { querySelector() { return fakeEl(); }, querySelectorAll() { return []; }, createElement() { return fakeEl(); }, addEventListener() {}, getElementById() { return null; }, get activeElement() { return { tagName: "BODY" }; } };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.confirm = () => true;

const c = require("../crapless.js");

let passed = 0, failed = 0;
function eq(a, e, m) { if (a === e) passed++; else { failed++; console.error(`✗ ${m}\n    expected ${e}, got ${a}`); } }

function rollWith({ point = null, bets = {}, credit = 1000 }, d1, d2) {
  const copy = JSON.parse(JSON.stringify(bets));
  const staked = Object.values(copy).reduce((s, b) => s + b.amount, 0);
  c.setState({ point, bets: copy, credit: credit - staked, selectedChip: 5 });
  c.resolveRoll(d1, d2);
  return c.getState();
}

// ==== Payout helpers (Crapless) ===========================================
eq(c.placeProfit(2, 10), 55, "place 2 -> 11:2");
eq(c.placeProfit(3, 8), 22, "place 3 -> 11:4");
eq(c.placeProfit(4, 10), 18, "place 4 -> 9:5");
eq(c.placeProfit(6, 12), 14, "place 6 -> 7:6");
eq(c.trueOddsProfit(2, 10), 60, "odds 2 -> 6:1");
eq(c.trueOddsProfit(3, 10), 30, "odds 3 -> 3:1");
eq(c.trueOddsProfit(4, 10), 20, "odds 4 -> 2:1");

// ==== Come-out: only 7 wins, everything else is a point ===================
let s = rollWith({ bets: { pass: { type: "pass", amount: 10 } } }, 3, 4); // 7
eq(s.bankroll, undefined, "uses credit not bankroll");
eq(s.credit, 1010, "pass wins on come-out 7 (+10)");
eq(s.point, null, "come-out 7 stays off");

s = rollWith({ bets: { pass: { type: "pass", amount: 10 } } }, 1, 1); // 2 -> point (no loss!)
eq(s.point, 2, "come-out 2 becomes the point (crapless)");
eq(s.credit, 990, "pass stays up, no loss on 2");

s = rollWith({ bets: { pass: { type: "pass", amount: 10 } } }, 6, 5); // 11 -> point
eq(s.point, 11, "come-out 11 becomes the point (crapless)");

s = rollWith({ bets: { pass: { type: "pass", amount: 10 } } }, 6, 6); // 12 -> point
eq(s.point, 12, "come-out 12 becomes the point (crapless)");

// point made on 2
s = rollWith({ point: 2, bets: { pass: { type: "pass", amount: 10 } } }, 1, 1);
eq(s.point, null, "point 2 made -> off");
eq(s.credit, 1010, "pass paid even money on point made");

// seven out
s = rollWith({ point: 5, bets: { pass: { type: "pass", amount: 10 } } }, 3, 4);
eq(s.credit, 990, "pass lost on seven out");

// ==== Pass odds at crapless true odds ======================================
s = rollWith({ point: 3, bets: { pass: { type: "pass", amount: 10 }, passodds: { type: "passodds", amount: 10 } } }, 1, 2);
// pass: +10 stake +10 profit; odds: +10 stake + 30 profit (3:1 on the 3)
eq(s.credit, 1000 - 20 + 10 + 10 + 10 + 30, "point 3 made: pass + odds (3:1)");

// ==== Place bets (all numbers) ============================================
s = rollWith({ point: 5, bets: { "place-12": { type: "place", num: 12, amount: 10 } } }, 6, 6);
eq(s.credit, 1000 - 10 + 55, "place 12 wins 11:2 (+55), stays up");
eq(s.bets["place-12"].amount, 10, "place stays up after win");
s = rollWith({ point: 5, bets: { "place-12": { type: "place", num: 12, amount: 10 } } }, 3, 4);
eq(s.credit, 990, "place 12 loses on 7");

// ==== Come travels, including to 2/3/11/12 ================================
s = rollWith({ point: 5, bets: { come: { type: "come", amount: 10 } } }, 1, 1); // come -> 2
eq(s.bets["comepoint-2"].amount, 10, "come travels to 2 (crapless)");
s = rollWith({ point: 5, bets: { come: { type: "come", amount: 10 } } }, 3, 4); // come wins on 7
eq(s.credit, 1010, "pending come wins on 7");
s = rollWith({ point: 5, bets: { "comepoint-2": { type: "comepoint", num: 2, amount: 10 } } }, 1, 1);
eq(s.credit, 1010, "come point 2 wins even money");

// ==== Field, props ========================================================
s = rollWith({ bets: { field: { type: "field", amount: 10 } } }, 6, 6); eq(s.credit, 1020, "field 12 double");
s = rollWith({ bets: { field: { type: "field", amount: 10 } } }, 4, 4); eq(s.credit, 990, "field 8 loses");
s = rollWith({ bets: { seven: { type: "seven", amount: 5 } } }, 3, 4); eq(s.credit, 1020, "seven 4:1");
s = rollWith({ bets: { e: { type: "e", amount: 1 } } }, 5, 6); eq(s.credit, 1015, "E (eleven) 15:1");
s = rollWith({ bets: { c: { type: "c", amount: 5 } } }, 1, 1); eq(s.credit, 1035, "C (any craps) 7:1");
s = rollWith({ bets: { "hard-8": { type: "hard", num: 8, amount: 5 } } }, 4, 4); eq(s.credit, 1040, "hard 8 hits (9:1, +45 profit, stake stays)");
s = rollWith({ bets: { "hard-8": { type: "hard", num: 8, amount: 5 } } }, 5, 3); eq(s.credit, 995, "hard 8 easy loses");

// ==== Bonus bets (Low / High / Roll 'Em All) ==============================
// bonusStep progression
let b = c.bonusStep("lowrolls", [2, 3, 4], 5); eq(b.result, "progress", "low rolls progress on 5");
eq(b.hits.length, 4, "low rolls now has 4 hits");
b = c.bonusStep("lowrolls", [2, 3, 4, 5], 6); eq(b.result, "win", "low rolls completes on last number (6)");
eq(b.mult, 30, "low rolls pays 30:1");
b = c.bonusStep("lowrolls", [2, 3, 4, 5], 7); eq(b.result, "lose", "low rolls dies on 7");
b = c.bonusStep("lowrolls", [2, 3, 4], 4); eq(b.hits.length, 3, "duplicate number doesn't add a hit");
b = c.bonusStep("allrolls", [2,3,4,5,6,8,9,10,11], 12); eq(b.result, "win", "roll 'em all completes");
eq(b.mult, 155, "roll 'em all pays 155:1");

// integrated: place a low-rolls bet and complete it
s = rollWith({ point: null, bets: { lowrolls: { type: "lowrolls", amount: 5, hits: [2, 3, 4, 5] } } }, 3, 3); // 6 completes
eq(s.credit, 1000 - 5 + 5 + 150, "low rolls $5 completes -> +$150 (30:1) plus stake");
// dies on 7
s = rollWith({ point: 5, bets: { lowrolls: { type: "lowrolls", amount: 5, hits: [2, 3] } } }, 3, 4);
eq(s.credit, 995, "low rolls loses on 7");

// ==== Point transitions (pure) ============================================
eq(c.nextPoint(null, 7).point, null, "come-out 7 off");
eq(c.nextPoint(null, 2).point, 2, "come-out 2 -> point 2");
eq(c.nextPoint(null, 11).point, 11, "come-out 11 -> point 11");
eq(c.nextPoint(5, 5).point, null, "point made off");
eq(c.nextPoint(5, 7).point, null, "seven out off");
eq(c.nextPoint(5, 9).point, 5, "no decision keeps point");

// ==== Fuzz: never crap out on come-out ====================================
(function () {
  for (let i = 0; i < 1500; i++) {
    c.setState({ point: null, bets: { pass: { type: "pass", amount: 10 } }, credit: 100000 });
    const d1 = 1 + (Math.random() * 6 | 0), d2 = 1 + (Math.random() * 6 | 0);
    c.resolveRoll(d1, d2);
    const st = c.getState();
    if (!Number.isFinite(st.credit)) { failed++; console.error("✗ credit non-finite"); break; }
    // come-out should never reduce credit (no losses on come-out)
    if (d1 + d2 !== 7 && st.credit < 100000 - 10) { failed++; console.error(`✗ come-out ${d1 + d2} caused a loss`); break; }
  }
  passed++;
})();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
