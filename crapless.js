/* =========================================================================
   Crapless Craps — desktop engine + UI (Phase 1)
   Rules differ from standard craps:
     - On the come-out, ONLY 7 wins the line. Every other total (2,3,4,5,6,
       8,9,10,11,12) becomes the point. You can never crap out.
     - No Don't Pass / Don't Come.
     - Place / odds available on all ten numbers.
   The rules engine is pure and headless-testable (see test/crapless.test.js).
   ========================================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "crapless.state.v1";
  const START_CREDIT = 1000;
  const MIN_BET = 3;
  const MAX_ODDS_MULT = 3;
  const POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]; // everything except 7
  const PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };

  // ---- Payout helpers (Crapless) -------------------------------------------
  // Place payouts shown on the machine.
  function placeProfit(num, amount) {
    if (num === 2 || num === 12) return amount * 11 / 2;  // 11:2
    if (num === 3 || num === 11) return amount * 11 / 4;  // 11:4
    if (num === 4 || num === 10) return amount * 9 / 5;   // 9:5
    if (num === 5 || num === 9) return amount * 7 / 5;    // 7:5
    return amount * 7 / 6;                                 // 6 or 8 -> 7:6
  }
  // True odds (free odds) for the line / come / come points.
  function trueOddsProfit(num, amount) {
    if (num === 2 || num === 12) return amount * 6;        // 6:1
    if (num === 3 || num === 11) return amount * 3;        // 3:1
    if (num === 4 || num === 10) return amount * 2;        // 2:1
    if (num === 5 || num === 9) return amount * 3 / 2;     // 3:2
    return amount * 6 / 5;                                  // 6 or 8 -> 6:5
  }
  function hardProfit(num, amount) {
    return amount * (num === 6 || num === 8 ? 9 : 7);      // 9:1 (6/8), 7:1 (4/10)
  }
  const floor = (n) => Math.floor(n);

  // ---- State ----------------------------------------------------------------
  const defaultState = () => ({
    credit: START_CREDIT,
    buyIn: START_CREDIT,
    point: null,
    selectedChip: 5,
    bets: {},            // key -> { type, num, amount }
    history: [],         // recent totals
    lastRoundBets: null, // for REPEAT
    lastBet: 0,
    lastWin: 0,
  });

  let state = loadState();
  let undoStack = [];
  let flashKeys = [];

  function loadState() {
    try { const r = localStorage.getItem(STORAGE_KEY); if (r) return Object.assign(defaultState(), JSON.parse(r)); } catch (e) {}
    return defaultState();
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }

  // ---- Bet rules ------------------------------------------------------------
  function isRemovable(key, bet) {
    switch (bet.type) {
      case "pass": return state.point === null;     // contract once a point is on
      case "come": return true;                      // pending come can come down
      case "comepoint": case "dccomepoint": return false;
      default: return true;                          // place/odds/hardways/props
    }
  }
  function canPlace(type) {
    switch (type) {
      case "pass": return state.point === null;
      case "come": return state.point !== null;
      case "passodds": return state.point !== null && !!state.bets["pass"];
      default: return true;
    }
  }
  const betKeyFor = (type, num) => (num != null ? `${type}-${num}` : type);

  // ---- Resolution -----------------------------------------------------------
  function evaluate(bet, total, isHard, pointBefore, comeOut) {
    const n = bet.num;
    switch (bet.type) {
      case "pass":
        if (comeOut) {
          if (total === 7) return win(bet.amount, false);
          return stay();                              // any other -> point set, no loss
        }
        if (total === pointBefore) return win(bet.amount, false);
        if (total === 7) return lose();
        return stay();
      case "passodds":
        if (total === pointBefore) return win(floor(trueOddsProfit(pointBefore, bet.amount)), false);
        if (total === 7) return lose();
        return stay();
      case "comepoint":
        if (total === n) return win(bet.amount, false);
        if (total === 7) return lose();
        return stay();
      case "comeodds":
        if (total === n) return win(floor(trueOddsProfit(n, bet.amount)), false);
        if (total === 7) return lose();
        return stay();
      case "place":
        if (total === n) return win(floor(placeProfit(n, bet.amount)), true);
        if (total === 7) return lose();
        return stay();
      case "hard":
        if (total === n) return isHard ? win(floor(hardProfit(n, bet.amount)), true) : lose();
        if (total === 7) return lose();
        return stay();
      // one-roll
      case "field":
        if (total === 2 || total === 12) return win(bet.amount * 2, false);
        if ([3, 4, 9, 10, 11].includes(total)) return win(bet.amount, false);
        return lose();
      case "seven": return total === 7 ? win(bet.amount * 4, false) : lose();
      case "anycraps": case "c": return [2, 3, 12].includes(total) ? win(bet.amount * 7, false) : lose();
      case "e": return total === 11 ? win(bet.amount * 15, false) : lose();
      case "ce":
        if ([2, 3, 12].includes(total)) return win(floor(bet.amount * 3), false);
        if (total === 11) return win(floor(bet.amount * 7), false);
        return lose();
      case "horn": {
        const q = bet.amount / 4;
        if (total === 2 || total === 12) return win(floor(q * 30 - 3 * q), false);
        if (total === 3 || total === 11) return win(floor(q * 15 - 3 * q), false);
        return lose();
      }
      default: return stay();
    }
  }
  const win = (profit, stay) => ({ result: "win", profit, stay });
  const lose = () => ({ result: "lose" });
  const stay = () => ({ result: "stay" });

  // Pure point transition (Crapless).
  function nextPoint(pointBefore, total) {
    if (pointBefore === null) {
      if (total === 7) return { point: null, msg: "7 — line wins! Come-out again." };
      return { point: total, msg: `Point is ${total}.` };
    }
    if (total === pointBefore) return { point: null, msg: `Point ${pointBefore} made!` };
    if (total === 7) return { point: null, msg: "Seven out." };
    return { point: pointBefore, msg: null };
  }

  function mergeBet(key, meta, amount) {
    if (!state.bets[key]) state.bets[key] = Object.assign({ amount: 0 }, meta);
    state.bets[key].amount += amount;
  }

  function resolveRoll(d1, d2) {
    const total = d1 + d2;
    const isHard = d1 === d2;
    const pointBefore = state.point;
    const comeOut = pointBefore === null;

    state.lastRoundBets = JSON.parse(JSON.stringify(state.bets));
    undoStack = [];
    flashKeys = [];

    logRoll(d1, d2, total, comeOut, pointBefore);

    let netDelta = 0, grossWin = 0;
    const messages = [];

    for (const key of Object.keys(state.bets)) {
      if (key === "come") continue;
      const bet = state.bets[key];
      const r = evaluate(bet, total, isHard, pointBefore, comeOut);
      const name = prettyName(key, bet);
      if (r.result === "win") {
        flashKeys.push(key);
        grossWin += r.profit;
        if (r.stay) { state.credit += r.profit; netDelta += r.profit; messages.push({ cls: "log-win", text: `${name} wins +$${r.profit}` }); }
        else { state.credit += bet.amount + r.profit; netDelta += r.profit; messages.push({ cls: "log-win", text: `${name} wins +$${r.profit}` }); delete state.bets[key]; }
      } else if (r.result === "lose") {
        netDelta -= bet.amount;
        messages.push({ cls: "log-lose", text: `${name} loses -$${bet.amount}` });
        delete state.bets[key];
      }
    }

    // pending COME
    if (state.bets["come"]) {
      const bet = state.bets["come"];
      if (total === 7) { state.credit += bet.amount * 2; netDelta += bet.amount; grossWin += bet.amount; messages.push({ cls: "log-win", text: `Come wins +$${bet.amount}` }); }
      else { mergeBet(`comepoint-${total}`, { type: "comepoint", num: total, payout: "1:1" }, bet.amount); messages.push({ cls: "log-info", text: `Come travels to ${total}` }); }
      delete state.bets["come"];
    }

    const transition = nextPoint(pointBefore, total);
    state.point = transition.point;

    state.history.push(total);
    if (state.history.length > 18) state.history = state.history.slice(-18);
    if (grossWin > 0) state.lastWin = grossWin;

    messages.forEach((m) => addLog(m.text, m.cls));
    if (transition.msg) addLog(transition.msg, "log-info");

    save();
    showResult(d1, d2, total, netDelta);
    render();

    if (typeof window !== "undefined") setTimeout(() => { flashKeys = []; render(); }, 1100);
  }

  // ===========================================================================
  //  UI (browser only)
  // ===========================================================================
  let els = {};
  function initEls() {
    const $ = (s) => document.querySelector(s);
    els = {
      machine: $("#machine"), felt: $(".felt"), tray: $("#tray"),
      credit: $("#credit"), playable: $("#playable"), betTotal: $("#betTotal"),
      lastBet: $("#lastBet"), lastWin: $("#lastWin"),
      die1: $("#die1"), die2: $("#die2"), resultNumber: $("#resultNumber"),
      winBanner: $("#winBanner"), history: $("#history"), puck: $("#puck"),
      log: $("#log"), toast: $("#toast"), rollBtn: $("#rollBtn"),
      clearBtn: $("#clearBtn"), doubleBtn: $("#doubleBtn"), repeatBtn: $("#repeatBtn"),
      cashoutBtn: $("#cashoutBtn"),
    };
  }

  function addToBet(type, num, payout, amount, track) {
    const key = betKeyFor(type, num);
    if (!state.bets[key]) state.bets[key] = { type, num: num != null ? num : null, amount: 0, payout };
    state.bets[key].amount += amount;
    state.credit -= amount;
    if (track) undoStack.push({ key, amount });
  }
  function placeBet(type, num, payout) {
    const amount = state.selectedChip;
    if (amount > state.credit) { toast("Not enough credit.", "lose"); return; }
    if (!canPlace(type)) { toast(placeErr(type)); return; }
    if (type === "passodds") {
      const flat = state.bets["pass"] ? state.bets["pass"].amount : 0;
      const have = state.bets["passodds"] ? state.bets["passodds"].amount : 0;
      if (have + amount > flat * MAX_ODDS_MULT) { toast(`Max odds is ${MAX_ODDS_MULT}x the line.`, "lose"); return; }
    }
    addToBet(type, num, payout, amount, true);
    save(); render();
  }
  function placeErr(type) {
    if (type === "pass") return "Line bet only on the come-out.";
    if (type === "come") return "Come needs a point established.";
    if (type === "passodds") return "Take Odds needs a Pass bet and a point.";
    return "Can't place that now.";
  }
  function addComeOdds(num) {
    const base = state.bets[`comepoint-${num}`];
    if (!base) return;
    const amount = state.selectedChip;
    if (amount > state.credit) { toast("Not enough credit.", "lose"); return; }
    const have = state.bets[`comeodds-${num}`] ? state.bets[`comeodds-${num}`].amount : 0;
    if (have + amount > base.amount * MAX_ODDS_MULT) { toast(`Max odds is ${MAX_ODDS_MULT}x.`, "lose"); return; }
    addToBet("comeodds", num, "trueodds", amount, true);
    save(); render();
  }
  function removeBet(key) {
    const bet = state.bets[key];
    if (!bet || !isRemovable(key, bet)) return;
    state.credit += bet.amount;
    delete state.bets[key];
    save(); render();
  }
  function clearLast() {
    const last = undoStack.pop();
    if (!last) { toast("Nothing to clear."); return; }
    const bet = state.bets[last.key];
    if (!bet) { render(); return; }
    bet.amount -= last.amount; state.credit += last.amount;
    if (bet.amount <= 0) delete state.bets[last.key];
    save(); render();
  }
  function doubleAll() {
    let added = 0;
    for (const [key, bet] of Object.entries(state.bets)) {
      if (!isRemovable(key, bet)) continue;
      if (["passodds", "comeodds"].includes(bet.type)) continue;
      if (bet.amount <= state.credit) { addToBet(bet.type, bet.num, bet.payout, bet.amount, true); added += bet.amount; }
    }
    save(); render();
    toast(added ? `Doubled (+$${added}).` : "Nothing to double.");
  }
  function repeatLast() {
    const snap = state.lastRoundBets;
    if (!snap || !Object.keys(snap).length) { toast("No previous bets."); return; }
    let placed = 0;
    for (const bet of Object.values(snap)) {
      let type = bet.type, num = bet.num;
      if (type === "comepoint") { type = "come"; num = null; }
      if (["passodds", "comeodds"].includes(type)) continue;
      if (!canPlace(type) || bet.amount > state.credit) continue;
      addToBet(type, num, bet.payout || "1:1", bet.amount, true);
      placed += bet.amount;
    }
    save(); render();
    toast(placed ? `Repeated (+$${placed}).` : "Couldn't repeat now.");
  }

  // ---- Dice rolling ---------------------------------------------------------
  let rolling = false;
  function roll() {
    if (rolling) return;
    if (state.point === null && atRiskTotal() < MIN_BET) { toast(`Minimum total bet is $${MIN_BET}.`); return; }
    state.lastBet = Object.values(state.bets).reduce((s, b) => s + b.amount, 0) || state.lastBet;
    rolling = true;
    if (els.rollBtn) els.rollBtn.disabled = true;
    [els.die1, els.die2].forEach((d) => d && d.classList && d.classList.add("rolling"));
    if (els.winBanner) { els.winBanner.className = "win-banner"; els.winBanner.innerHTML = ""; }
    if (els.resultNumber) els.resultNumber.textContent = "…";
    const tumble = setInterval(() => { renderDie(els.die1, 1 + (Math.random() * 6 | 0)); renderDie(els.die2, 1 + (Math.random() * 6 | 0)); }, 55);
    setTimeout(() => {
      clearInterval(tumble);
      const d1 = 1 + (Math.random() * 6 | 0), d2 = 1 + (Math.random() * 6 | 0);
      [els.die1, els.die2].forEach((d) => { if (d && d.classList) { d.classList.remove("rolling"); restartAnim(d, "land"); } });
      resolveRoll(d1, d2);
      rolling = false;
      if (els.rollBtn) els.rollBtn.disabled = false;
    }, 800);
  }

  function showResult(d1, d2, total, netDelta) {
    renderDie(els.die1, d1); renderDie(els.die2, d2);
    if (els.resultNumber) { els.resultNumber.textContent = total; restartAnim(els.resultNumber, "pop"); }
    if (els.winBanner) {
      if (netDelta > 0) { els.winBanner.className = "win-banner show-win"; els.winBanner.innerHTML = `WIN <span class="amt">$${netDelta}</span>`; }
      else if (netDelta < 0) { els.winBanner.className = "win-banner show-lose"; els.winBanner.textContent = `−$${Math.abs(netDelta)}`; }
      else { els.winBanner.className = "win-banner"; els.winBanner.textContent = ""; }
    }
    if (typeof window === "undefined") return;
    if (netDelta > 0) celebrate(netDelta);
  }

  // ---- Rendering ------------------------------------------------------------
  function renderDie(el, value) {
    if (!el || typeof document === "undefined" || !el.appendChild) return;
    el.innerHTML = "";
    const on = PIPS[value] || [];
    for (let i = 0; i < 9; i++) { const c = document.createElement("div"); if (on.includes(i)) c.className = "pip"; el.appendChild(c); }
  }
  function restartAnim(el, cls) { if (!el || !el.classList) return; el.classList.remove(cls); if (typeof el.offsetWidth === "number") void el.offsetWidth; el.classList.add(cls); }

  function prettyName(key, bet) {
    const n = bet.num;
    switch (bet.type) {
      case "pass": return "Pass Line"; case "passodds": return "Pass Odds";
      case "come": return "Come"; case "comepoint": return `Come ${n}`; case "comeodds": return `Come ${n} Odds`;
      case "place": return `Place ${n}`; case "hard": return `Hard ${n}`;
      case "field": return "Field"; case "seven": return "Seven"; case "anycraps": return "Any Craps";
      case "c": return "C (Craps)"; case "e": return "E (Eleven)"; case "ce": return "C & E"; case "horn": return "Horn";
      default: return key;
    }
  }
  function chipClass(a) {
    if (a >= 100) return "c100"; if (a >= 50) return "c50"; if (a >= 25) return "c25";
    if (a >= 10) return "c10"; if (a >= 5) return "c5"; if (a >= 3) return "c3"; if (a >= 2) return "c2"; return "c1";
  }
  function spotFor(key, bet) {
    const f = els.felt; if (!f || !f.querySelector) return { el: null };
    const q = (s) => f.querySelector(s);
    switch (bet.type) {
      case "pass": return { el: q('[data-bet="pass"]') };
      case "passodds": return { el: q('[data-bet="passodds"]') };
      case "come": return { el: q('[data-bet="come"]') };
      case "field": return { el: q('[data-bet="field"]') };
      case "place": return { el: q(`.num-cell[data-num="${bet.num}"] .place-slot`), flat: true };
      case "comepoint": return { el: q(`.num-cell[data-num="${bet.num}"] .buy-slot`), flat: true, cp: true };
      case "comeodds": return { el: q(`.num-cell[data-num="${bet.num}"] .buy-slot`), flat: true, odds: true };
      case "hard": return { el: q(`[data-bet="hard"][data-num="${bet.num}"]`) };
      case "seven": return { el: q('[data-bet="seven"]') };
      case "anycraps": return { el: q('[data-bet="anycraps"]') };
      case "c": return { el: q('[data-bet="c"]') };
      case "e": return { el: q('[data-bet="e"]') };
      case "ce": return { el: q('[data-bet="ce"]') };
      case "horn": return { el: q('[data-bet="horn"]') };
      default: return { el: null };
    }
  }
  function renderChips() {
    if (!els.felt || !els.felt.querySelectorAll) return;
    els.felt.querySelectorAll(".placed-chip").forEach((c) => c.remove());
    for (const key of Object.keys(state.bets)) {
      const bet = state.bets[key];
      const t = spotFor(key, bet); if (!t || !t.el || !t.el.appendChild) continue;
      const won = flashKeys.includes(key);
      const chip = document.createElement("div");
      chip.className = `placed-chip ${chipClass(bet.amount)}${won ? " win-chip" : ""}${t.odds ? " odds-chip" : ""}${t.cp ? " cp-chip" : ""}`;
      chip.textContent = `$${bet.amount}`;
      chip.dataset.key = key; chip.dataset.type = bet.type; if (bet.num != null) chip.dataset.num = bet.num;
      t.el.appendChild(chip);
    }
  }
  function positionPuck() {
    const puck = els.puck, felt = els.felt;
    if (!puck || !felt || !felt.appendChild) return;
    if (state.point === null) { puck.className = "puck off"; puck.textContent = "OFF"; const home = felt.querySelector && felt.querySelector(".puck-home"); (home && home.appendChild ? home : felt).appendChild(puck); return; }
    puck.className = "puck on"; puck.textContent = "ON";
    const cell = felt.querySelector && felt.querySelector(`.num-cell[data-num="${state.point}"] .puck-rail`);
    (cell && cell.appendChild ? cell : felt).appendChild(puck);
  }
  function renderHistory() {
    if (!els.history || !els.history.appendChild) return;
    els.history.innerHTML = "";
    state.history.slice(-16).forEach((t) => {
      const pill = document.createElement("span");
      pill.className = "h-pill" + (t === 7 ? " seven" : "");
      pill.textContent = t; els.history.appendChild(pill);
    });
  }
  function atRiskTotal() { return Object.values(state.bets).reduce((s, b) => s + b.amount, 0); }
  function render() {
    const atRisk = atRiskTotal();
    if (els.credit) els.credit.textContent = `$${state.credit.toLocaleString()}`;
    if (els.playable) els.playable.textContent = `$${state.credit.toLocaleString()}`;
    if (els.betTotal) els.betTotal.textContent = `$${atRisk.toLocaleString()}`;
    if (els.lastBet) els.lastBet.textContent = `$${(state.lastBet || 0).toLocaleString()}`;
    if (els.lastWin) els.lastWin.textContent = `$${(state.lastWin || 0).toLocaleString()}`;
    if (els.felt && els.felt.querySelectorAll) {
      els.felt.querySelectorAll(".num-cell").forEach((c) => c.classList.toggle("is-point", Number(c.dataset.num) === state.point));
      const ctx = ["pass", "come", "passodds"];
      els.felt.querySelectorAll(".bet-spot").forEach((s) => { const t = s.dataset && s.dataset.bet; s.classList.toggle("armed", ctx.includes(t) && canPlace(t)); });
    }
    if (els.tray && els.tray.querySelectorAll) els.tray.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", Number(c.dataset.chip) === state.selectedChip));
    renderChips(); renderHistory(); positionPuck();
  }

  // ---- Flair ----------------------------------------------------------------
  function ensureLayer(id, cls) { let el = document.getElementById(id); if (!el) { el = document.createElement("div"); el.id = id; el.className = cls; document.body.appendChild(el); } return el; }
  function celebrate(amount) {
    if (typeof document === "undefined") return;
    const layer = ensureLayer("fx", "fx-layer");
    const colors = ["#f3c34a", "#51e08a", "#ffffff", "#e23b48", "#6a2da0"];
    const n = Math.min(80, 24 + (amount / 8 | 0));
    for (let i = 0; i < n; i++) {
      const p = document.createElement("div");
      const coin = Math.random() < 0.55; p.className = `confetti ${coin ? "coin" : "bit"}`;
      if (!coin) p.style.background = colors[Math.random() * colors.length | 0];
      p.style.setProperty("--tx", `${(Math.random() * 2 - 1) * 46}vw`);
      p.style.setProperty("--ty", `${28 + Math.random() * 55}vh`);
      p.style.setProperty("--rot", `${(Math.random() * 720 - 360) | 0}deg`);
      p.style.left = `${48 + Math.random() * 4}%`; p.style.animationDelay = `${Math.random() * 0.12}s`;
      layer.appendChild(p); setTimeout(() => p.remove(), 1700);
    }
  }

  // ---- Log + toast ----------------------------------------------------------
  function addLog(text, cls) { if (!els.log || !els.log.prepend) return; const d = document.createElement("div"); d.className = `log-entry ${cls || "log-info"}`; d.textContent = text; els.log.prepend(d); while (els.log.childElementCount > 60) els.log.lastChild.remove(); }
  function logRoll(d1, d2, total, comeOut, pointBefore) { addLog(`🎲 ${d1}+${d2} = ${total} (${comeOut ? "come-out" : "point " + pointBefore})`, "log-roll"); }
  let toastTimer = null;
  function toast(msg, kind) { if (!els.toast) return; els.toast.textContent = msg; els.toast.className = `toast show ${kind || ""}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toast.className = "toast"; }, 2200); }

  // ---- Wiring ---------------------------------------------------------------
  function wire() {
    els.tray.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; state.selectedChip = Number(c.dataset.chip); save(); render(); });
    els.felt.addEventListener("click", (e) => {
      const chip = e.target.closest(".cp-chip");
      if (chip) { addComeOdds(Number(chip.dataset.num)); return; }
      const spot = e.target.closest(".bet-spot"); if (!spot) return;
      if (spot.dataset.phase2 != null) { toast("Coming in the next phase."); return; }
      placeBet(spot.dataset.bet, spot.dataset.num ? Number(spot.dataset.num) : null, spot.dataset.payout);
    });
    els.felt.addEventListener("contextmenu", (e) => {
      const spot = e.target.closest(".bet-spot"); if (!spot) return; e.preventDefault();
      removeBet(betKeyFor(spot.dataset.bet, spot.dataset.num ? Number(spot.dataset.num) : null));
    });
    els.rollBtn.addEventListener("click", roll);
    els.clearBtn.addEventListener("click", clearLast);
    els.doubleBtn.addEventListener("click", doubleAll);
    els.repeatBtn.addEventListener("click", repeatLast);
    if (els.cashoutBtn) els.cashoutBtn.addEventListener("click", () => {
      if (confirm("Cash out and start a fresh $1,000 session?")) { state = defaultState(); undoStack = []; flashKeys = []; save(); if (els.log) els.log.innerHTML = ""; if (els.resultNumber) els.resultNumber.textContent = "—"; renderDie(els.die1, 3); renderDie(els.die2, 4); render(); }
    });
    document.addEventListener("keydown", (e) => { if ((e.code === "Space" || e.code === "Enter") && (!document.activeElement || document.activeElement.tagName !== "BUTTON")) { e.preventDefault(); roll(); } });
  }

  function boot() {
    initEls(); wire();
    renderDie(els.die1, 3); renderDie(els.die2, 4);
    render();
    addLog("Welcome to Crapless Craps. On the come-out only 7 wins — every other number becomes the point.", "log-info");
  }

  if (typeof document !== "undefined") boot();

  if (typeof module !== "undefined" && module.exports) {
    if (typeof document === "undefined") initEls();
    module.exports = { evaluate, placeProfit, trueOddsProfit, hardProfit, nextPoint, resolveRoll, getState: () => state, setState: (s) => { state = Object.assign(defaultState(), s); } };
  }
})();
