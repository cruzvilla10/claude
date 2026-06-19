/* =========================================================================
   Craps — "bubble craps" style live-table UI, single player vs the house.
   Vanilla JS. State persists to localStorage. Rules engine is headless-
   testable (see test/craps.test.js).
   ========================================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "craps.state.v2";
  const START_BANKROLL = 1000;
  const MAX_ODDS_MULT = 5;
  const POINTS = [4, 5, 6, 8, 9, 10];

  // Pip positions on a 3x3 grid (indices 0-8, row-major) for each die value.
  const PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };

  // ---- State ----------------------------------------------------------------
  const defaultState = () => ({
    bankroll: START_BANKROLL,
    point: null,
    selectedChip: 25,
    bets: {},            // key -> { type, num, amount }
    history: [],         // recent roll totals
    lastRoundBets: null, // snapshot for REBET
  });

  let state = loadState();
  let undoStack = [];    // [{ key, amount }] — placements since last roll
  let flashKeys = [];    // bet keys that just won (for the gold flash)

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {}
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- DOM refs -------------------------------------------------------------
  let els = {};
  function initEls() {
    const $ = (s) => document.querySelector(s);
    els = {
      app: $("#app"),
      bankroll: $("#bankroll"),
      die1: $("#die1"), die2: $("#die2"),
      resultNumber: $("#resultNumber"),
      winBanner: $("#winBanner"),
      history: $("#history"),
      puck: $("#puck"),
      felt: $(".felt"),
      log: $("#log"),
      toast: $("#toast"),
      chipRail: $("#chipRail"),
      rollBtn: $("#rollBtn"),
      undoBtn: $("#undoBtn"),
      rebetBtn: $("#rebetBtn"),
      doubleBtn: $("#doubleBtn"),
      resetBtn: $("#resetBtn"),
    };
  }

  // ---- Payout helpers -------------------------------------------------------
  function trueOddsProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 2;
    if (num === 5 || num === 9) return amount * 3 / 2;
    return amount * 6 / 5;
  }
  function layOddsProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 1 / 2;
    if (num === 5 || num === 9) return amount * 2 / 3;
    return amount * 5 / 6;
  }
  function placeProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 9 / 5;
    if (num === 5 || num === 9) return amount * 7 / 5;
    return amount * 7 / 6;
  }
  const floor = (n) => Math.floor(n);

  // ---- Bet rules ------------------------------------------------------------
  function isRemovable(key, bet) {
    switch (bet.type) {
      case "place": case "lay": case "hard": case "field":
      case "any7": case "anycraps": case "ce": case "horn":
      case "prop2": case "prop3": case "prop11": case "prop12":
      case "come": case "dontcome": case "passodds": case "dpodds":
        return true;
      case "pass": case "dontpass":
        return state.point === null;
      default:
        return false;
    }
  }
  function canPlace(type) {
    switch (type) {
      case "pass": case "dontpass": return state.point === null;
      case "come": case "dontcome": return state.point !== null;
      case "passodds": return state.point !== null && !!state.bets["pass"];
      case "dpodds": return state.point !== null && !!state.bets["dontpass"];
      default: return true;
    }
  }
  function placementError(type) {
    switch (type) {
      case "pass": case "dontpass": return "Line bets only on the come-out (point OFF).";
      case "come": case "dontcome": return "Come bets need a point established.";
      case "passodds": return "Pass Odds need an active Pass bet and a point.";
      case "dpodds": return "Don't Odds need an active Don't Pass bet and a point.";
      default: return "That bet can't be placed right now.";
    }
  }
  const betKeyFor = (type, num) => (num != null ? `${type}-${num}` : type);

  // ---- Placing / removing ---------------------------------------------------
  function addToBet(type, num, payout, amount, track) {
    const key = betKeyFor(type, num);
    if (!state.bets[key]) state.bets[key] = { type, num: num != null ? num : null, amount: 0, payout };
    state.bets[key].amount += amount;
    state.bankroll -= amount;
    if (track) undoStack.push({ key, amount });
  }

  function placeBet(type, num, payout) {
    const amount = state.selectedChip;
    if (amount > state.bankroll) { toast("Not enough bankroll for that chip.", "lose"); return; }
    if (!canPlace(type)) { toast(placementError(type)); return; }
    if (type === "passodds") {
      const flat = state.bets["pass"] ? state.bets["pass"].amount : 0;
      const have = state.bets["passodds"] ? state.bets["passodds"].amount : 0;
      if (have + amount > flat * MAX_ODDS_MULT) { toast(`Max odds is ${MAX_ODDS_MULT}x your Pass bet.`, "lose"); return; }
    }
    if (type === "dpodds") {
      const flat = state.bets["dontpass"] ? state.bets["dontpass"].amount : 0;
      const have = state.bets["dpodds"] ? state.bets["dpodds"].amount : 0;
      if (have + amount > flat * MAX_ODDS_MULT * 2) { toast("That exceeds the lay-odds limit.", "lose"); return; }
    }
    addToBet(type, num, payout, amount, true);
    save(); render();
  }

  function removeBet(key) {
    const bet = state.bets[key];
    if (!bet) return;
    if (!isRemovable(key, bet)) { toast("That's a contract bet — can't be taken down now."); return; }
    state.bankroll += bet.amount;
    delete state.bets[key];
    save(); render();
    toast(`Took down ${prettyName(key, bet)} — $${bet.amount} back.`);
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) { toast("Nothing to undo."); return; }
    const bet = state.bets[last.key];
    if (!bet) { save(); render(); return; }
    bet.amount -= last.amount;
    state.bankroll += last.amount;
    if (bet.amount <= 0) delete state.bets[last.key];
    save(); render();
  }

  function doubleAll() {
    const entries = Object.entries(state.bets).filter(([k, b]) => isRemovable(k, b));
    if (!entries.length) { toast("No bets to double."); return; }
    let added = 0;
    for (const [key, bet] of entries) {
      if (bet.amount <= state.bankroll) {
        addToBet(bet.type, bet.num, bet.payout, bet.amount, true);
        added += bet.amount;
      }
    }
    save(); render();
    toast(added ? `Doubled bets (+$${added}).` : "Not enough bankroll to double.", added ? "" : "lose");
  }

  function rebet() {
    const snap = state.lastRoundBets;
    if (!snap || !Object.keys(snap).length) { toast("No previous bets to repeat."); return; }
    let placed = 0, skipped = 0;
    for (const bet of Object.values(snap)) {
      // travelled come points come back as fresh come / don't come bets
      let type = bet.type, num = bet.num;
      if (type === "comepoint") { type = "come"; num = null; }
      if (type === "dccomepoint") { type = "dontcome"; num = null; }
      if (!canPlace(type)) { skipped++; continue; }
      if (bet.amount > state.bankroll) { skipped++; continue; }
      addToBet(type, num, bet.payout || "1:1", bet.amount, true);
      placed += bet.amount;
    }
    save(); render();
    if (placed) toast(`Repeated bets (+$${placed})${skipped ? `, ${skipped} skipped` : ""}.`);
    else toast("Couldn't repeat those bets in this phase.");
  }

  // ---- Roll resolution (pure-ish core kept stable for tests) ----------------
  function evaluate(bet, total, isHard, pointBefore, comeOut) {
    const n = bet.num;
    switch (bet.type) {
      case "pass":
        if (comeOut) {
          if (total === 7 || total === 11) return win(bet.amount, false);
          if (total === 2 || total === 3 || total === 12) return lose();
          return stay();
        }
        if (total === pointBefore) return win(bet.amount, false);
        if (total === 7) return lose();
        return stay();
      case "dontpass":
        if (comeOut) {
          if (total === 2 || total === 3) return win(bet.amount, false);
          if (total === 12) return push();
          if (total === 7 || total === 11) return lose();
          return stay();
        }
        if (total === 7) return win(bet.amount, false);
        if (total === pointBefore) return lose();
        return stay();
      case "passodds":
        if (total === pointBefore) return win(floor(trueOddsProfit(pointBefore, bet.amount)), false);
        if (total === 7) return lose();
        return stay();
      case "dpodds":
        if (total === 7) return win(floor(layOddsProfit(pointBefore, bet.amount)), false);
        if (total === pointBefore) return lose();
        return stay();
      case "place":
        if (total === n) return win(floor(placeProfit(n, bet.amount)), true);
        if (total === 7) return lose();
        return stay();
      case "lay":
        if (total === 7) return win(floor(layOddsProfit(n, bet.amount)), true);
        if (total === n) return lose();
        return stay();
      case "hard":
        if (total === n) return isHard
          ? win(floor(bet.amount * (n === 6 || n === 8 ? 9 : 7)), true)
          : lose();
        if (total === 7) return lose();
        return stay();
      case "comepoint":
        if (total === n) return win(bet.amount, false);
        if (total === 7) return lose();
        return stay();
      case "dccomepoint":
        if (total === 7) return win(bet.amount, false);
        if (total === n) return lose();
        return stay();
      case "field":
        if (total === 2 || total === 12) return win(bet.amount * 2, false);
        if ([3, 4, 9, 10, 11].includes(total)) return win(bet.amount, false);
        return lose();
      case "any7": return total === 7 ? win(bet.amount * 4, false) : lose();
      case "anycraps": return [2, 3, 12].includes(total) ? win(bet.amount * 7, false) : lose();
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
      case "prop2": return total === 2 ? win(bet.amount * 30, false) : lose();
      case "prop12": return total === 12 ? win(bet.amount * 30, false) : lose();
      case "prop3": return total === 3 ? win(bet.amount * 15, false) : lose();
      case "prop11": return total === 11 ? win(bet.amount * 15, false) : lose();
      default: return stay();
    }
  }
  const win = (profit, stay) => ({ result: "win", profit, stay });
  const lose = () => ({ result: "lose" });
  const push = () => ({ result: "push" });
  const stay = () => ({ result: "stay" });

  function nextPoint(pointBefore, total) {
    if (pointBefore === null) {
      if (POINTS.includes(total)) return { point: total, msg: `Point is now ${total}.` };
      return { point: null, msg: null };
    }
    if (total === pointBefore) return { point: null, msg: `Point ${pointBefore} made! Back to come-out.` };
    if (total === 7) return { point: null, msg: `Seven out. New shooter, come-out roll.` };
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

    // Snapshot bets for REBET, then clear the undo history (committed).
    state.lastRoundBets = JSON.parse(JSON.stringify(state.bets));
    undoStack = [];
    flashKeys = [];

    logRoll(d1, d2, total, comeOut, pointBefore);

    let netDelta = 0;
    const messages = [];

    for (const key of Object.keys(state.bets)) {
      if (key === "come" || key === "dontcome") continue;
      const bet = state.bets[key];
      const r = evaluate(bet, total, isHard, pointBefore, comeOut);
      const name = prettyName(key, bet);
      if (r.result === "win") {
        flashKeys.push(key);
        if (r.stay) {
          state.bankroll += r.profit; netDelta += r.profit;
          messages.push({ cls: "log-win", text: `${name} wins +$${r.profit} (stays up)` });
        } else {
          state.bankroll += bet.amount + r.profit; netDelta += r.profit;
          messages.push({ cls: "log-win", text: `${name} wins +$${r.profit}` });
          delete state.bets[key];
        }
      } else if (r.result === "lose") {
        netDelta -= bet.amount;
        messages.push({ cls: "log-lose", text: `${name} loses -$${bet.amount}` });
        delete state.bets[key];
      } else if (r.result === "push") {
        state.bankroll += bet.amount;
        messages.push({ cls: "log-info", text: `${name} pushes — $${bet.amount} back` });
        delete state.bets[key];
      }
    }

    if (state.bets["come"]) {
      const bet = state.bets["come"];
      if (total === 7 || total === 11) { state.bankroll += bet.amount * 2; netDelta += bet.amount; messages.push({ cls: "log-win", text: `Come wins +$${bet.amount}` }); }
      else if ([2, 3, 12].includes(total)) { netDelta -= bet.amount; messages.push({ cls: "log-lose", text: `Come loses -$${bet.amount}` }); }
      else { mergeBet(`comepoint-${total}`, { type: "comepoint", num: total, payout: "1:1" }, bet.amount); messages.push({ cls: "log-info", text: `Come travels to ${total}` }); }
      delete state.bets["come"];
    }
    if (state.bets["dontcome"]) {
      const bet = state.bets["dontcome"];
      if (total === 2 || total === 3) { state.bankroll += bet.amount * 2; netDelta += bet.amount; messages.push({ cls: "log-win", text: `Don't Come wins +$${bet.amount}` }); }
      else if (total === 12) { state.bankroll += bet.amount; messages.push({ cls: "log-info", text: `Don't Come pushes` }); }
      else if (total === 7 || total === 11) { netDelta -= bet.amount; messages.push({ cls: "log-lose", text: `Don't Come loses -$${bet.amount}` }); }
      else { mergeBet(`dccomepoint-${total}`, { type: "dccomepoint", num: total, payout: "1:1" }, bet.amount); messages.push({ cls: "log-info", text: `Don't Come travels behind ${total}` }); }
      delete state.bets["dontcome"];
    }

    const transition = nextPoint(pointBefore, total);
    state.point = transition.point;

    state.history.push(total);
    if (state.history.length > 14) state.history = state.history.slice(-14);

    messages.forEach((m) => addLog(m.text, m.cls));
    if (transition.msg) addLog(transition.msg, "log-info");

    save();
    showResult(d1, d2, total, netDelta);
    render();

    if (netDelta > 0) toast(`You win $${netDelta}!`, "win");
    else if (netDelta < 0) toast(`Down $${Math.abs(netDelta)} this roll.`, "lose");

    // Clear the win flash shortly after (browser only).
    if (typeof window !== "undefined") {
      setTimeout(() => { flashKeys = []; render(); }, 1100);
    }
  }

  // ---- Dice rolling ---------------------------------------------------------
  let rolling = false;
  function roll() {
    if (rolling) return;
    if (!Object.keys(state.bets).length && state.point === null) { toast("Place a bet first."); return; }
    rolling = true;
    if (els.rollBtn) els.rollBtn.disabled = true;
    [els.die1, els.die2].forEach((d) => d && d.classList && d.classList.add("rolling"));
    if (els.winBanner) { els.winBanner.className = "win-banner"; els.winBanner.innerHTML = ""; }
    if (els.resultNumber) els.resultNumber.textContent = "…";

    const tumble = setInterval(() => {
      renderDie(els.die1, 1 + Math.floor(Math.random() * 6));
      renderDie(els.die2, 1 + Math.floor(Math.random() * 6));
    }, 80);

    setTimeout(() => {
      clearInterval(tumble);
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      [els.die1, els.die2].forEach((d) => d && d.classList && d.classList.remove("rolling"));
      resolveRoll(d1, d2);
      rolling = false;
      if (els.rollBtn) els.rollBtn.disabled = false;
    }, 650);
  }

  function showResult(d1, d2, total, netDelta) {
    renderDie(els.die1, d1);
    renderDie(els.die2, d2);
    if (els.resultNumber) els.resultNumber.textContent = total;
    if (els.winBanner) {
      if (netDelta > 0) {
        els.winBanner.className = "win-banner show-win";
        els.winBanner.innerHTML = `YOU WIN <span class="amt">$${netDelta}</span>`;
      } else if (netDelta < 0) {
        els.winBanner.className = "win-banner show-lose";
        els.winBanner.textContent = `−$${Math.abs(netDelta)}`;
      } else {
        els.winBanner.className = "win-banner";
        els.winBanner.textContent = "";
      }
    }
  }

  // ---- Rendering helpers ----------------------------------------------------
  function renderDie(el, value) {
    if (!el || typeof document === "undefined" || !el.appendChild) return;
    el.innerHTML = "";
    const on = PIPS[value] || [];
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("div");
      if (on.includes(i)) cell.className = "pip";
      el.appendChild(cell);
    }
  }
  function renderMiniDie(value, whiteDots) {
    const die = document.createElement("span");
    die.className = "mini-die";
    const on = PIPS[value] || [];
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("span");
      if (on.includes(i)) cell.className = "mp";
      die.appendChild(cell);
    }
    return die;
  }
  // Fill every data-faces element with mini pip-dice once at boot.
  function renderStaticDice() {
    if (typeof document === "undefined" || !els.felt || !els.felt.querySelectorAll) return;
    document.querySelectorAll("[data-faces]").forEach((host) => {
      host.innerHTML = "";
      String(host.dataset.faces || "").split(",").forEach((f) => {
        const v = parseInt(f.trim(), 10);
        if (v) host.appendChild(renderMiniDie(v));
      });
    });
  }

  function prettyName(key, bet) {
    const n = bet.num;
    switch (bet.type) {
      case "pass": return "Pass Line"; case "dontpass": return "Don't Pass";
      case "passodds": return "Pass Odds"; case "dpodds": return "Don't Odds";
      case "come": return "Come"; case "dontcome": return "Don't Come";
      case "comepoint": return `Come ${n}`; case "dccomepoint": return `Don't Come ${n}`;
      case "place": return `Place ${n}`; case "lay": return `Lay ${n}`; case "hard": return `Hard ${n}`;
      case "field": return "Field"; case "any7": return "Seven"; case "anycraps": return "Any Craps";
      case "ce": return "C & E"; case "horn": return "Horn";
      case "prop2": return "Prop 2"; case "prop12": return "Prop 12";
      case "prop3": return "Prop 3"; case "prop11": return "Prop 11";
      default: return key;
    }
  }
  function chipClass(a) {
    if (a >= 500) return "c500"; if (a >= 100) return "c100";
    if (a >= 25) return "c25"; if (a >= 5) return "c5"; return "c1";
  }

  function spotFor(key, bet) {
    const f = els.felt;
    if (!f || !f.querySelector) return { el: null };
    const q = (s) => f.querySelector(s);
    switch (bet.type) {
      case "pass": return { el: q('[data-bet="pass"]') };
      case "dontpass": return { el: q('[data-bet="dontpass"]') };
      case "passodds": return { el: q('[data-bet="passodds"]') };
      case "dpodds": return { el: q('[data-bet="dpodds"]') };
      case "come": return { el: q('[data-bet="come"]') };
      case "dontcome": return { el: q('[data-bet="dontcome"]') };
      case "field": return { el: q('[data-bet="field"]') };
      case "place": return { el: q(`.num-chip-slot[data-slot="${bet.num}"]`), flat: true };
      case "hard": return { el: q(`[data-bet="hard"][data-num="${bet.num}"]`) };
      case "comepoint": return { el: q(`.num-col[data-cluster="${bet.num}"]`), pos: "badge-tr" };
      case "dccomepoint": return { el: q(`.num-col[data-cluster="${bet.num}"]`), pos: "badge-tl" };
      case "any7": return { el: q('[data-bet="any7"]') };
      case "anycraps": return { el: q('[data-bet="anycraps"]') };
      case "ce": return { el: q('[data-bet="ce"]') };
      case "horn": return { el: q('[data-bet="horn"]') };
      case "prop2": return { el: q('[data-bet="prop2"]') };
      case "prop12": return { el: q('[data-bet="prop12"]') };
      case "prop3": return { el: q('[data-bet="prop3"]') };
      case "prop11": return { el: q('[data-bet="prop11"]') };
      default: return { el: null };
    }
  }

  function renderChips() {
    if (!els.felt || !els.felt.querySelectorAll) return;
    els.felt.querySelectorAll(".placed-chip").forEach((c) => c.remove());
    els.felt.querySelectorAll(".flash-win").forEach((c) => c.classList.remove("flash-win"));
    for (const key of Object.keys(state.bets)) {
      const bet = state.bets[key];
      const t = spotFor(key, bet);
      if (!t || !t.el || !t.el.appendChild) continue;
      const won = flashKeys.includes(key);
      const chip = document.createElement("div");
      chip.className = `placed-chip ${chipClass(bet.amount)}${t.pos ? " " + t.pos : ""}${won ? " win-chip" : ""}`;
      chip.textContent = `${bet.amount}`;
      t.el.appendChild(chip);
      if (won && t.el.classList) t.el.classList.add("flash-win");
    }
  }

  // Place the puck by relocating the DOM node (no pixel math => scale-safe).
  function positionPuck() {
    const puck = els.puck, felt = els.felt;
    if (!puck || !felt || !felt.appendChild) return;
    if (state.point === null) {
      puck.className = "puck off";
      puck.textContent = "OFF";
      felt.appendChild(puck);
      return;
    }
    puck.className = "puck on";
    puck.textContent = "ON";
    const col = felt.querySelector && felt.querySelector(`.num-col[data-cluster="${state.point}"]`);
    (col && col.appendChild ? col : felt).appendChild(puck);
  }

  // Scale the whole game so it always fits the viewport without scrolling.
  function fitScreen() {
    const app = els.app;
    if (!app || !app.style || typeof window === "undefined") return;
    app.style.transform = "none";
    const w = app.offsetWidth, h = app.offsetHeight;
    if (!w || !h) return;
    const scale = Math.min((window.innerWidth - 12) / w, (window.innerHeight - 12) / h, 2);
    app.style.transform = `scale(${scale > 0 ? scale : 1})`;
  }

  function renderHistory() {
    if (!els.history || !els.history.appendChild) return;
    els.history.innerHTML = "";
    state.history.slice(-12).forEach((t) => {
      const pill = document.createElement("span");
      pill.className = "h-pill" + (t === 7 ? " seven" : POINTS.includes(t) ? " point" : "");
      pill.textContent = t;
      els.history.appendChild(pill);
    });
  }

  function render() {
    if (els.bankroll) els.bankroll.textContent = `$${state.bankroll.toLocaleString()}`;
    // mark point column
    if (els.felt && els.felt.querySelectorAll) {
      els.felt.querySelectorAll(".num-col").forEach((c) => {
        const isPt = c.dataset && Number(c.dataset.cluster) === state.point;
        c.classList.toggle("is-point", !!isPt);
      });
      // WIN/LOSE status tabs: a number "wins" (green) when it's the point or has a come point.
      els.felt.querySelectorAll(".num-status").forEach((s) => {
        const n = Number(s.dataset.num);
        const winning = n === state.point || !!state.bets[`comepoint-${n}`];
        s.classList.toggle("win", winning);
        s.textContent = winning ? "WIN" : "LOSE";
      });
      // contextual highlight
      const contextual = ["pass", "dontpass", "come", "dontcome", "passodds", "dpodds"];
      els.felt.querySelectorAll(".bet-spot").forEach((spot) => {
        const type = spot.dataset && spot.dataset.bet;
        spot.classList.toggle("armed", contextual.includes(type) && canPlace(type));
      });
    }
    if (els.chipRail && els.chipRail.querySelectorAll) {
      els.chipRail.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("selected", Number(c.dataset.chip) === state.selectedChip));
    }
    if (els.undoBtn) els.undoBtn.disabled = undoStack.length === 0;
    if (els.rebetBtn) els.rebetBtn.disabled = !state.lastRoundBets || !Object.keys(state.lastRoundBets).length;
    renderChips();
    renderHistory();
    positionPuck();
  }

  // ---- Log + toast ----------------------------------------------------------
  function addLog(text, cls) {
    if (!els.log || !els.log.prepend) return;
    const div = document.createElement("div");
    div.className = `log-entry ${cls || "log-info"}`;
    div.textContent = text;
    els.log.prepend(div);
    while (els.log.childElementCount > 80) els.log.lastChild.remove();
  }
  function logRoll(d1, d2, total, comeOut, pointBefore) {
    addLog(`🎲 ${d1}+${d2} = ${total}  (${comeOut ? "come-out" : "point " + pointBefore})`, "log-roll");
  }
  let toastTimer = null;
  function toast(msg, kind) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.className = `toast show ${kind || ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = "toast"; }, 2000);
  }

  // ---- Wiring ---------------------------------------------------------------
  function wire() {
    els.chipRail.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip"); if (!chip) return;
      state.selectedChip = Number(chip.dataset.chip); save(); render();
    });
    els.felt.addEventListener("click", (e) => {
      const spot = e.target.closest(".bet-spot"); if (!spot) return;
      placeBet(spot.dataset.bet, spot.dataset.num ? Number(spot.dataset.num) : null, spot.dataset.payout);
    });
    els.felt.addEventListener("contextmenu", (e) => {
      const spot = e.target.closest(".bet-spot"); if (!spot) return;
      e.preventDefault();
      const type = spot.dataset.bet, num = spot.dataset.num ? Number(spot.dataset.num) : null;
      let key = betKeyFor(type, num);
      if (!state.bets[key]) {
        const col = e.target.closest(".num-col");
        if (col) for (const cand of [`comepoint-${col.dataset.cluster}`, `dccomepoint-${col.dataset.cluster}`, `place-${col.dataset.cluster}`]) {
          if (state.bets[cand]) { key = cand; break; }
        }
      }
      removeBet(key);
    });
    els.rollBtn.addEventListener("click", roll);
    els.undoBtn.addEventListener("click", undo);
    els.rebetBtn.addEventListener("click", rebet);
    els.doubleBtn.addEventListener("click", doubleAll);
    els.resetBtn.addEventListener("click", () => {
      if (confirm("Reset bankroll to $1,000 and clear the table?")) {
        state = defaultState(); undoStack = []; flashKeys = [];
        save();
        if (els.log) els.log.innerHTML = "";
        if (els.resultNumber) els.resultNumber.textContent = "—";
        if (els.winBanner) { els.winBanner.className = "win-banner"; els.winBanner.innerHTML = ""; }
        renderDie(els.die1, 1); renderDie(els.die2, 1);
        render();
        toast("Bankroll reset to $1,000.");
      }
    });
    document.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && (!document.activeElement || document.activeElement.tagName !== "BUTTON")) {
        e.preventDefault(); roll();
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("resize", fitScreen);
      window.addEventListener("orientationchange", fitScreen);
    }
    const logWrap = document.querySelector(".log-wrap");
    if (logWrap && logWrap.addEventListener) logWrap.addEventListener("toggle", fitScreen);
  }

  // ---- Boot -----------------------------------------------------------------
  function boot() {
    initEls();
    wire();
    renderStaticDice();
    renderDie(els.die1, 3); renderDie(els.die2, 4);
    render();
    addLog("Welcome. Place a Pass Line bet to start.", "log-info");
    if (typeof window !== "undefined") {
      fitScreen();
      setTimeout(fitScreen, 60);
      setTimeout(fitScreen, 300);
    }
  }

  if (typeof document !== "undefined") boot();

  if (typeof module !== "undefined" && module.exports) {
    if (typeof document === "undefined") initEls();
    module.exports = {
      evaluate, trueOddsProfit, layOddsProfit, placeProfit, nextPoint,
      resolveRoll, getState: () => state, setState: (s) => { state = Object.assign(defaultState(), s); },
    };
  }
})();
