/* =========================================================================
   Craps — full casino rules, single player vs the house
   Vanilla JS engine. State persists to localStorage.
   ========================================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "craps.state.v1";
  const START_BANKROLL = 1000;
  const MAX_ODDS_MULT = 5; // cap odds at 5x the flat line bet
  const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]; // index 1-6
  const POINTS = [4, 5, 6, 8, 9, 10];

  // ---- State ----------------------------------------------------------------
  const defaultState = () => ({
    bankroll: START_BANKROLL,
    point: null,            // null = OFF, else 4/5/6/8/9/10
    selectedChip: 25,
    // bets: key -> { type, num, amount }
    bets: {},
  });

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign(defaultState(), parsed);
      }
    } catch (e) { /* ignore */ }
    return defaultState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- DOM ------------------------------------------------------------------
  let els = {};
  function initEls() {
    const $ = (sel) => document.querySelector(sel);
    els = {
      bankroll: $("#bankroll"),
      atRisk: $("#atRisk"),
      point: $("#pointVal"),
      die1: $("#die1"),
      die2: $("#die2"),
      rollTotal: $("#rollTotal"),
      rollBtn: $("#rollBtn"),
      resetBtn: $("#resetBtn"),
      clearBetsBtn: $("#clearBetsBtn"),
      chipTray: $("#chipTray"),
      log: $("#log"),
      toast: $("#toast"),
      felt: $(".felt"),
    };
  }

  // ---- Payout helpers -------------------------------------------------------
  // True (free) odds for pass-line odds bets.
  function trueOddsProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 2;        // 2:1
    if (num === 5 || num === 9) return amount * 3 / 2;     // 3:2
    return amount * 6 / 5;                                  // 6 or 8 -> 6:5
  }
  // Lay odds (don't side): you risk more to win less.
  function layOddsProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 1 / 2;    // 1:2
    if (num === 5 || num === 9) return amount * 2 / 3;     // 2:3
    return amount * 5 / 6;                                  // 6 or 8 -> 5:6
  }
  // Place-bet payouts.
  function placeProfit(num, amount) {
    if (num === 4 || num === 10) return amount * 9 / 5;    // 9:5
    if (num === 5 || num === 9) return amount * 7 / 5;     // 7:5
    return amount * 7 / 6;                                  // 6 or 8 -> 7:6
  }
  const floor = (n) => Math.floor(n);

  // ---- Bet metadata for the UI ---------------------------------------------
  // Which bet types can be taken down (refunded) by the player on demand.
  function isRemovable(key, bet) {
    switch (bet.type) {
      case "place": case "lay": case "hard":
      case "field": case "any7": case "anycraps": case "ce": case "horn":
      case "prop2": case "prop3": case "prop11": case "prop12":
      case "come": case "dontcome":
      case "passodds": case "dpodds":
        return true;
      case "pass": case "dontpass":
        return state.point === null; // contract once a point is on
      default:
        return false; // comepoint / dccomepoint are contract bets
    }
  }

  // ---- Placement legality ---------------------------------------------------
  function canPlace(type) {
    switch (type) {
      case "pass": case "dontpass":
        return state.point === null;
      case "come": case "dontcome":
        return state.point !== null;
      case "passodds":
        return state.point !== null && !!state.bets["pass"];
      case "dpodds":
        return state.point !== null && !!state.bets["dontpass"];
      default:
        return true;
    }
  }

  function placementError(type) {
    switch (type) {
      case "pass": case "dontpass":
        return "Line bets can only be made on the come-out (point OFF).";
      case "come": case "dontcome":
        return "Come bets require a point to be established.";
      case "passodds":
        return "Pass Line Odds need an active Pass bet and a point.";
      case "dpodds":
        return "Don't Pass Odds need an active Don't Pass bet and a point.";
      default:
        return "That bet can't be placed right now.";
    }
  }

  // ---- Key + label resolution for a spot ------------------------------------
  function betKeyFor(type, num) {
    if (num != null) return `${type}-${num}`;
    return type;
  }

  // ---- Placing a bet --------------------------------------------------------
  function placeBet(type, num, payout) {
    const amount = state.selectedChip;
    if (amount > state.bankroll) {
      toast("Not enough bankroll for that chip.", "lose");
      return;
    }
    if (!canPlace(type)) {
      toast(placementError(type));
      return;
    }
    // Odds caps
    if (type === "passodds") {
      const flat = state.bets["pass"] ? state.bets["pass"].amount : 0;
      const existing = state.bets["passodds"] ? state.bets["passodds"].amount : 0;
      if (existing + amount > flat * MAX_ODDS_MULT) {
        toast(`Max odds is ${MAX_ODDS_MULT}x your Pass bet ($${flat * MAX_ODDS_MULT}).`, "lose");
        return;
      }
    }
    if (type === "dpodds") {
      const flat = state.bets["dontpass"] ? state.bets["dontpass"].amount : 0;
      const existing = state.bets["dpodds"] ? state.bets["dpodds"].amount : 0;
      // For the don't side you lay up to MAX_ODDS_MULT x to win the flat amount.
      if (existing + amount > flat * MAX_ODDS_MULT * 2) {
        toast(`That exceeds the lay-odds limit for your Don't Pass bet.`, "lose");
        return;
      }
    }

    const key = betKeyFor(type, num);
    if (!state.bets[key]) state.bets[key] = { type, num: num != null ? num : null, amount: 0, payout };
    state.bets[key].amount += amount;
    state.bankroll -= amount;
    save();
    render();
  }

  // ---- Removing bets --------------------------------------------------------
  function removeBet(key) {
    const bet = state.bets[key];
    if (!bet) return;
    if (!isRemovable(key, bet)) {
      toast("That bet is a contract — it can't be taken down now.");
      return;
    }
    state.bankroll += bet.amount;
    delete state.bets[key];
    save();
    render();
    toast(`Took down ${prettyName(key, bet)} — $${bet.amount} returned.`);
  }

  function clearRemovable() {
    let refunded = 0;
    for (const key of Object.keys(state.bets)) {
      const bet = state.bets[key];
      if (isRemovable(key, bet)) {
        refunded += bet.amount;
        state.bankroll += bet.amount;
        delete state.bets[key];
      }
    }
    save();
    render();
    if (refunded > 0) toast(`Cleared removable bets — $${refunded} returned.`);
  }

  // ---- Roll resolution ------------------------------------------------------
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

      // ---- one-roll bets ----
      case "field":
        if (total === 2 || total === 12) return win(bet.amount * 2, false);
        if ([3, 4, 9, 10, 11].includes(total)) return win(bet.amount, false);
        return lose();
      case "any7":
        return total === 7 ? win(bet.amount * 4, false) : lose();
      case "anycraps":
        return [2, 3, 12].includes(total) ? win(bet.amount * 7, false) : lose();
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
      case "prop2":  return total === 2  ? win(bet.amount * 30, false) : lose();
      case "prop12": return total === 12 ? win(bet.amount * 30, false) : lose();
      case "prop3":  return total === 3  ? win(bet.amount * 15, false) : lose();
      case "prop11": return total === 11 ? win(bet.amount * 15, false) : lose();

      default:
        return stay();
    }
  }
  const win = (profit, stay) => ({ result: "win", profit, stay });
  const lose = () => ({ result: "lose" });
  const push = () => ({ result: "push" });
  const stay = () => ({ result: "stay" });

  function resolveRoll(d1, d2) {
    const total = d1 + d2;
    const isHard = d1 === d2;
    const pointBefore = state.point;
    const comeOut = pointBefore === null;

    logRoll(d1, d2, total, comeOut, pointBefore);

    let netDelta = 0;
    const messages = [];

    // Resolve everything except pending come / don't come (handled after travel).
    for (const key of Object.keys(state.bets)) {
      if (key === "come" || key === "dontcome") continue;
      const bet = state.bets[key];
      const r = evaluate(bet, total, isHard, pointBefore, comeOut);
      const name = prettyName(key, bet);
      if (r.result === "win") {
        if (r.stay) {
          state.bankroll += r.profit;
          netDelta += r.profit;
          messages.push({ cls: "log-win", text: `${name} wins +$${r.profit} (bet stays up)` });
        } else {
          state.bankroll += bet.amount + r.profit;
          netDelta += r.profit;
          messages.push({ cls: "log-win", text: `${name} wins +$${r.profit}` });
          delete state.bets[key];
        }
      } else if (r.result === "lose") {
        netDelta -= bet.amount;
        messages.push({ cls: "log-lose", text: `${name} loses -$${bet.amount}` });
        delete state.bets[key];
      } else if (r.result === "push") {
        state.bankroll += bet.amount;
        messages.push({ cls: "log-info", text: `${name} pushes (bar 12) — $${bet.amount} returned` });
        delete state.bets[key];
      }
    }

    // Pending COME
    if (state.bets["come"]) {
      const bet = state.bets["come"];
      if (total === 7 || total === 11) {
        state.bankroll += bet.amount * 2; netDelta += bet.amount;
        messages.push({ cls: "log-win", text: `Come wins +$${bet.amount}` });
      } else if ([2, 3, 12].includes(total)) {
        netDelta -= bet.amount;
        messages.push({ cls: "log-lose", text: `Come loses -$${bet.amount}` });
      } else {
        mergeBet(`comepoint-${total}`, { type: "comepoint", num: total, payout: "1:1" }, bet.amount);
        messages.push({ cls: "log-info", text: `Come travels to ${total}` });
      }
      delete state.bets["come"];
    }

    // Pending DON'T COME
    if (state.bets["dontcome"]) {
      const bet = state.bets["dontcome"];
      if (total === 2 || total === 3) {
        state.bankroll += bet.amount * 2; netDelta += bet.amount;
        messages.push({ cls: "log-win", text: `Don't Come wins +$${bet.amount}` });
      } else if (total === 12) {
        state.bankroll += bet.amount;
        messages.push({ cls: "log-info", text: `Don't Come pushes (bar 12)` });
      } else if (total === 7 || total === 11) {
        netDelta -= bet.amount;
        messages.push({ cls: "log-lose", text: `Don't Come loses -$${bet.amount}` });
      } else {
        mergeBet(`dccomepoint-${total}`, { type: "dccomepoint", num: total, payout: "1:1" }, bet.amount);
        messages.push({ cls: "log-info", text: `Don't Come travels behind ${total}` });
      }
      delete state.bets["dontcome"];
    }

    // ---- Update the point ----
    const transition = nextPoint(pointBefore, total);
    state.point = transition.point;
    const pointMsg = transition.msg;

    messages.forEach((m) => addLog(m.text, m.cls));
    if (pointMsg) addLog(pointMsg, "log-info");

    save();
    render();

    // Toast summary
    if (netDelta > 0) toast(`You're up $${netDelta} this roll!`, "win");
    else if (netDelta < 0) toast(`Down $${Math.abs(netDelta)} this roll.`, "lose");
  }

  // Pure: given the point before a roll and the total, return the new point
  // state and an optional status message. (null point = come-out / OFF.)
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

  // ---- Dice rolling ---------------------------------------------------------
  let rolling = false;
  function roll() {
    if (rolling) return;
    const hasBet = Object.keys(state.bets).length > 0;
    if (!hasBet && state.point === null) {
      toast("Place a bet before rolling.");
      return;
    }
    rolling = true;
    els.rollBtn.disabled = true;
    els.die1.classList.add("rolling");
    els.die2.classList.add("rolling");
    els.rollTotal.textContent = "rolling…";

    // tumble preview
    let ticks = 0;
    const tumble = setInterval(() => {
      els.die1.textContent = DICE_FACES[1 + Math.floor(Math.random() * 6)];
      els.die2.textContent = DICE_FACES[1 + Math.floor(Math.random() * 6)];
      ticks++;
    }, 80);

    setTimeout(() => {
      clearInterval(tumble);
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      els.die1.textContent = DICE_FACES[d1];
      els.die2.textContent = DICE_FACES[d2];
      els.die1.classList.remove("rolling");
      els.die2.classList.remove("rolling");
      els.rollTotal.textContent = `${d1} + ${d2} = ${d1 + d2}`;
      resolveRoll(d1, d2);
      rolling = false;
      els.rollBtn.disabled = false;
    }, 650);
  }

  // ---- Rendering ------------------------------------------------------------
  function prettyName(key, bet) {
    const n = bet.num;
    switch (bet.type) {
      case "pass": return "Pass Line";
      case "dontpass": return "Don't Pass";
      case "passodds": return "Pass Odds";
      case "dpodds": return "Don't Pass Odds";
      case "come": return "Come";
      case "dontcome": return "Don't Come";
      case "comepoint": return `Come ${n}`;
      case "dccomepoint": return `Don't Come ${n}`;
      case "place": return `Place ${n}`;
      case "lay": return `Lay ${n}`;
      case "hard": return `Hard ${n}`;
      case "field": return "Field";
      case "any7": return "Any 7";
      case "anycraps": return "Any Craps";
      case "ce": return "C & E";
      case "horn": return "Horn";
      case "prop2": return "Prop 2";
      case "prop12": return "Prop 12";
      case "prop3": return "Prop 3";
      case "prop11": return "Prop 11";
      default: return key;
    }
  }

  function chipClass(amount) {
    if (amount >= 500) return "c500";
    if (amount >= 100) return "c100";
    if (amount >= 25) return "c25";
    if (amount >= 5) return "c5";
    return "c1";
  }

  // Map a bet key -> { element, posClass } for chip rendering.
  function spotFor(key, bet) {
    const sel = (s) => els.felt.querySelector(s);
    switch (bet.type) {
      case "pass": return { el: sel('[data-bet="pass"]') };
      case "dontpass": return { el: sel('[data-bet="dontpass"]') };
      case "passodds": return { el: sel('[data-bet="passodds"]') };
      case "dpodds": return { el: sel('[data-bet="dpodds"]') };
      case "come": return { el: sel('[data-bet="come"]') };
      case "dontcome": return { el: sel('[data-bet="dontcome"]') };
      case "field": return { el: sel('[data-bet="field"]') };
      case "place": return { el: sel(`[data-bet="place"][data-num="${bet.num}"]`) };
      case "lay": return { el: sel(`[data-bet="lay"][data-num="${bet.num}"]`) };
      case "hard": return { el: sel(`[data-bet="hard"][data-num="${bet.num}"]`) };
      case "comepoint": return { el: sel(`.num-cell[data-cluster="${bet.num}"]`), pos: "badge-tr" };
      case "dccomepoint": return { el: sel(`.num-cell[data-cluster="${bet.num}"]`), pos: "badge-tl" };
      case "any7": return { el: sel('[data-bet="any7"]') };
      case "anycraps": return { el: sel('[data-bet="anycraps"]') };
      case "ce": return { el: sel('[data-bet="ce"]') };
      case "horn": return { el: sel('[data-bet="horn"]') };
      case "prop2": return { el: sel('[data-bet="prop2"]') };
      case "prop12": return { el: sel('[data-bet="prop12"]') };
      case "prop3": return { el: sel('[data-bet="prop3"]') };
      case "prop11": return { el: sel('[data-bet="prop11"]') };
      default: return { el: null };
    }
  }

  function renderChips() {
    els.felt.querySelectorAll(".placed-chip").forEach((c) => c.remove());
    for (const key of Object.keys(state.bets)) {
      const bet = state.bets[key];
      const target = spotFor(key, bet);
      if (!target || !target.el) continue;
      const chip = document.createElement("div");
      chip.className = `placed-chip ${chipClass(bet.amount)}${target.pos ? " " + target.pos : ""}`;
      chip.textContent = `$${bet.amount}`;
      target.el.appendChild(chip);
    }
  }

  function atRiskTotal() {
    return Object.values(state.bets).reduce((s, b) => s + b.amount, 0);
  }

  function render() {
    els.bankroll.textContent = `$${state.bankroll.toLocaleString()}`;
    els.atRisk.textContent = `$${atRiskTotal().toLocaleString()}`;
    if (state.point === null) {
      els.point.textContent = "OFF";
      els.point.classList.remove("on");
    } else {
      els.point.textContent = state.point;
      els.point.classList.add("on");
    }
    // chip tray selection
    els.chipTray.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("selected", Number(c.dataset.chip) === state.selectedChip);
    });
    // Highlight only context-sensitive spots that are legal right now,
    // so the player sees what the current phase allows.
    const contextual = ["pass", "dontpass", "come", "dontcome", "passodds", "dpodds"];
    els.felt.querySelectorAll(".bet-spot").forEach((spot) => {
      const type = spot.dataset.bet;
      spot.classList.toggle("armed", contextual.includes(type) && canPlace(type));
    });
    renderChips();
  }

  // ---- Log + toast ----------------------------------------------------------
  function addLog(text, cls) {
    const div = document.createElement("div");
    div.className = `log-entry ${cls || "log-info"}`;
    div.textContent = text;
    els.log.prepend(div);
    while (els.log.childElementCount > 60) els.log.lastChild.remove();
  }
  function logRoll(d1, d2, total, comeOut, pointBefore) {
    const phase = comeOut ? "come-out" : `point ${pointBefore}`;
    addLog(`🎲 Rolled ${d1}+${d2} = ${total}  (${phase})`, "log-roll");
  }
  let toastTimer = null;
  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = `toast show ${kind || ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = "toast"; }, 2200);
  }

  // ---- Event wiring ---------------------------------------------------------
  function wire() {
    // Chip selection
    els.chipTray.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.selectedChip = Number(chip.dataset.chip);
      save();
      render();
    });

    // Place / remove bets on the felt
    els.felt.addEventListener("click", (e) => {
      const spot = e.target.closest(".bet-spot");
      if (!spot) return;
      const type = spot.dataset.bet;
      const num = spot.dataset.num ? Number(spot.dataset.num) : null;
      placeBet(type, num, spot.dataset.payout);
    });
    els.felt.addEventListener("contextmenu", (e) => {
      const spot = e.target.closest(".bet-spot");
      if (!spot) return;
      e.preventDefault();
      const type = spot.dataset.bet;
      const num = spot.dataset.num ? Number(spot.dataset.num) : null;
      // Map a clicked numbered cell badge area: prefer the spot's own bet key.
      let key = betKeyFor(type, num);
      // For come/dc point badges the spot under the cursor may be place/lay;
      // fall back to any bet whose chip lives in this cell.
      if (!state.bets[key]) {
        const cell = e.target.closest(".num-cell");
        if (cell) {
          const cn = cell.dataset.cluster;
          for (const cand of [`comepoint-${cn}`, `dccomepoint-${cn}`, `place-${cn}`, `lay-${cn}`]) {
            if (state.bets[cand]) { key = cand; break; }
          }
        }
      }
      removeBet(key);
    });

    els.rollBtn.addEventListener("click", roll);
    els.clearBetsBtn.addEventListener("click", clearRemovable);
    els.resetBtn.addEventListener("click", () => {
      if (confirm("Reset your bankroll to $1,000 and clear the table?")) {
        state = defaultState();
        save();
        els.log.innerHTML = "";
        els.rollTotal.textContent = "—";
        els.die1.textContent = DICE_FACES[1];
        els.die2.textContent = DICE_FACES[1];
        addLog("Bankroll reset to $1,000. Good luck!", "log-info");
        render();
      }
    });

    // Keyboard: space / enter to roll
    document.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && document.activeElement.tagName !== "BUTTON") {
        e.preventDefault();
        roll();
      }
    });
  }

  // ---- Boot -----------------------------------------------------------------
  function boot() {
    initEls();
    wire();
    els.die1.textContent = DICE_FACES[1];
    els.die2.textContent = DICE_FACES[2];
    render();
    addLog("Welcome to the table. Make the line bet to start.", "log-info");
  }

  if (typeof document !== "undefined") boot();

  // Expose pure logic + state hooks for headless (Node) testing.
  if (typeof module !== "undefined" && module.exports) {
    if (typeof document === "undefined") initEls(); // populate stubbed els
    module.exports = {
      evaluate, trueOddsProfit, layOddsProfit, placeProfit, nextPoint,
      resolveRoll,
      getState: () => state,
      setState: (s) => { state = Object.assign(defaultState(), s); },
    };
  }
})();
