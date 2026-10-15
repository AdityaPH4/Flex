/*
 * Cashier screen. Meant to stay open on a tablet at the till.
 *
 * When an employee pays (part of) a bill from their phone, the payment is
 * recorded against the bill number they entered and the app generates a
 * 6-digit OTP for it. This screen asks the backend for bills about once a
 * second and shows each bill as ONE card - when several employees split one
 * bill, they all appear on the same card with the bill's total and each
 * payer's OTP - so the cashier can check the amounts against the bill, collect
 * any cash part and type the OTPs into Digitory.
 *
 * Two tabs:
 *   - Live payments: a 2x2 board of the bills paid in the last 10 minutes (the
 *     server sends the exact length as windowSeconds; it runs from a bill's
 *     latest payer). Older ones drop off by themselves; "Got it" clears one
 *     early, and it comes back if someone else then pays the same bill.
 *   - All Transactions: every payment recorded today (the IST calendar day),
 *     one row per employee payment with its OTP, searchable by name, employee code or bill number.
 *
 * Read-only: nothing here changes or verifies a payment. "Got it" only hides
 * a card on this device (remembered in localStorage).
 */
(() => {
  "use strict";

  const API = "/api/cashier";
  const KEYS = {
    token: "toit.cashier.token",
    outlet: "toit.cashier.outlet",
    seen: "toit.cashier.seen",
    sound: "toit.cashier.sound",
  };
  const ALL = "__all__"; // outlet value meaning "every outlet"
  const TZ = "Asia/Kolkata"; // every outlet is in India; "today" means the IST day

  const POLL_MS = 1000;
  // Each poll asks for "everything since the last answer, minus a minute" and
  // de-duplicates by id below. The overlap means a payment that commits a
  // moment late (or during a slow poll) is still picked up.
  const OVERLAP_MS = 60 * 1000;
  // How long a payment counts as "just arrived": it gets the gold ring and
  // "New" badge, and a freshly opened screen only beeps for payments this young.
  const FRESH_MS = 2 * 60 * 1000;
  // Used until the first answer says how long the board really holds a payment.
  const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
  // After a payment leaves the board it is remembered this much longer, so a
  // straggling poll can't bring it back (and beep for it) at the boundary.
  const REMEMBER_AFTER_EXPIRY_MS = 2 * 60 * 1000;
  const SEEN_CAP = 500;
  const TICK_MS = 1000;
  const TIME_REFRESH_MS = 20 * 1000;
  const TX_REFRESH_MS = 15 * 1000;
  const SEARCH_DEBOUNCE_MS = 100;

  const $ = (id) => document.getElementById(id);

  // localStorage can throw (private mode, blocked storage) - never let that
  // take the screen down.
  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  function loadSeen() {
    try {
      const ids = JSON.parse(store.get(KEYS.seen) || "[]");
      return new Set(Array.isArray(ids) ? ids : []);
    } catch {
      return new Set();
    }
  }

  const state = {
    token: store.get(KEYS.token),
    outlet: store.get(KEYS.outlet), // null until picked, else a name or ALL
    soundOn: store.get(KEYS.sound) !== "0",
    tab: "live", // "live" | "all"

    // live board
    payments: new Map(), // id -> payment
    seen: loadSeen(), // ids the cashier has tapped "Got it" on
    windowMs: DEFAULT_WINDOW_MS,
    cursorMs: 0, // server time of the last successful poll
    skewMs: 0, // server clock minus this device's clock
    firstLoadDone: false,
    failures: 0,
    pollTimer: null,
    generation: 0, // bumped to cancel an in-flight polling loop

    // all transactions
    tx: null, // last answer from /transactions
    txGen: 0, // bumped to discard an in-flight /transactions answer
    txTimer: null,
    txLoading: false,
    txQueued: false, // a refresh was asked for while one was running
    txFailed: false,
    query: "",

    audio: null,
    wakeLock: null,
  };

  const alertEls = new Map(); // id -> card element currently on the board

  // ---------- small helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const formatCode = (code) =>
    typeof code === "string" && code.length === 6 ? code.slice(0, 3) + " " + code.slice(3) : code;

  const rupees = (n) =>
    "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const nowMs = () => Date.now() + state.skewMs;

  const clock = (ms) =>
    new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });

  const dayLabel = (ms) =>
    new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

  function ago(ms) {
    const s = Math.max(0, Math.round((nowMs() - ms) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    return Math.floor(m / 60) + "h " + (m % 60) + "m ago";
  }

  const outletLabel = () => (state.outlet === ALL ? "All outlets" : state.outlet || "");
  const windowMinutes = () => Math.round(state.windowMs / 60000);
  const mainVisible = () => !$("main-screen").classList.contains("hidden");

  function show(which) {
    $("login-screen").classList.toggle("hidden", which !== "login");
    $("outlet-screen").classList.toggle("hidden", which !== "outlet");
    $("main-screen").classList.toggle("hidden", which !== "main");
    document.body.classList.toggle("on-main", which === "main");
    updateSoundBanner();
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && state.token) headers.Authorization = "Bearer " + state.token;
    const res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || "request_failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- sound + keeping the screen on ----------

  function ensureAudio() {
    try {
      if (!state.audio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        state.audio = new Ctx();
        state.audio.onstatechange = updateSoundBanner;
      }
      if (state.audio.state === "suspended") state.audio.resume().catch(() => {});
    } catch { /* no audio available */ }
  }

  function beep() {
    const ctx = state.audio;
    if (!state.soundOn || !ctx || ctx.state !== "running") return;
    try {
      const start = ctx.currentTime;
      [[880, 0], [660, 0.2], [880, 0.4]].forEach(([freq, offset]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start + offset);
        osc.stop(start + offset + 0.18);
      });
    } catch { /* ignore */ }
  }

  // Beep and buzz for payments that just arrived.
  function announce() {
    beep();
    // Browsers refuse to vibrate before the first tap and log a warning;
    // only try once there has been one.
    try {
      const tapped = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (navigator.vibrate && tapped) navigator.vibrate([150, 80, 150]);
    } catch { /* ignore */ }
  }

  function renderSoundButton() {
    $("sound-button").textContent = state.soundOn ? "Sound on" : "Sound off";
  }

  // Browsers only allow audio after a tap. A freshly reloaded screen has had
  // none yet, so say so instead of silently never beeping.
  //
  // The banner takes up room, so hiding it moves everything below it. The tap
  // that unlocks the audio is also the tap that hides the banner - if that
  // happened while the finger was still down, the card would slide away from
  // under it and the tap (say, on "Got it") would be lost. So while a pointer
  // is down the banner is left as it is, and settled once the pointer is up.
  let pointerDown = false;
  function updateSoundBanner() {
    if (pointerDown) return;
    const needsTap = state.soundOn && (!state.audio || state.audio.state !== "running");
    $("sound-banner").classList.toggle("hidden", !(mainVisible() && needsTap));
  }

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && !state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
      }
    } catch { /* not supported, or the tab is hidden - fine */ }
  }

  // ---------- live payments ----------

  // A bill's card is rebuilt when this changes: another payer, a new total, or an
  // OTP arriving (it exists a moment after the payment itself).
  const billSig = (b) => b.payments.length + "|" + b.totalAmount + "|" + b.payments.filter((p) => p.code).length;
  const isFresh = (b) => nowMs() - b.lastMs < FRESH_MS;
  // Cleared per head-count: if another person pays the same bill afterwards the
  // bill is a different "state" and comes back onto the board.
  const seenKey = (b) => b.id + "#" + b.payments.length;
  // On the board = a payer in the last window and not cleared with "Got it".
  const onBoard = (b) => !state.seen.has(seenKey(b)) && nowMs() - b.lastMs < state.windowMs;

  function buildAlert(b) {
    const card = el("article", "alert" + (isFresh(b) ? " fresh" : "") + (b.cashAmount > 0 ? "" : " no-split"));
    card.dataset.id = b.id;
    card.dataset.sig = billSig(b);
    // The card is a size container (see styles.css); the padded column inside
    // it holds the content so its text can be sized from the card's own box.
    const inner = el("div", "alert-in");

    const head = el("div", "alert-head");
    head.append(el("span", "badge", "New"));
    const when = el("span", "when", clock(b.lastMs) + " · " + ago(b.lastMs));
    when.dataset.created = String(b.lastMs);
    head.append(when);
    inner.append(head);

    inner.append(el("div", "amount", rupees(b.totalAmount)));

    const billLine = el("div", "bill-line");
    billLine.append(el("strong", null, "Bill " + b.billNo), el("span", null, b.outlet || ""));
    inner.append(billLine);

    // Everyone who paid is listed with their own OTP - the cashier needs each one
    // for Digitory - so a long list scrolls inside the card rather than hiding names.
    const people = b.payments;
    const payers = el("div", "payers");
    for (const p of people) {
      const row = el("div", "payer");
      const amount = el("span", "payer-amt", rupees(p.allowanceAmount));
      if (p.cashAmount > 0) amount.append(el("span", "payer-cash", " + " + rupees(p.cashAmount) + " cash"));
      row.append(el("span", "payer-name", p.employeeName), el("span", "payer-id", "ID " + p.employeeCode));
      if (p.code) row.append(el("span", "payer-code", formatCode(p.code)));
      row.append(amount);
      payers.append(row);
    }
    inner.append(payers);

    if (b.cashAmount > 0) {
      const bar = el("div", "cashbar");
      bar.append(el("span", null, "Collect in cash"), el("strong", null, rupees(b.cashAmount)));
      inner.append(bar);
    } else {
      inner.append(el("div", "nocash", "Paid fully from allowances. No cash to collect."));
    }

    const foot = el("div", "foot");
    foot.append(el("span", "foot-note", people.length + (people.length === 1 ? " payer" : " payers")));
    const button = el("button", "btn primary", "Got it");
    button.type = "button";
    button.addEventListener("click", () => acknowledge(b));
    foot.append(button);
    inner.append(foot);

    card.append(inner);
    return card;
  }

  function renderLive() {
    const board = [...state.payments.values()].filter(onBoard).sort((a, b) => b.lastMs - a.lastMs);
    const current = new Map(board.map((b) => [b.id, billSig(b)]));

    // Drop cards that left the board, and cards whose bill changed (another
    // person paid it): those are rebuilt below so the new payer shows up.
    for (const [id, node] of alertEls) {
      if (current.get(id) !== node.dataset.sig) {
        node.remove();
        alertEls.delete(id);
      }
    }

    // Newest first, left to right then down. Existing cards stay put (so
    // their entrance animation doesn't replay); new ones are slotted in.
    const container = $("alerts");
    let next = container.firstElementChild;
    for (const b of board) {
      let node = alertEls.get(b.id);
      if (!node) {
        node = buildAlert(b);
        alertEls.set(b.id, node);
      }
      if (node === next) next = next.nextElementSibling;
      else container.insertBefore(node, next);
    }

    const count = board.length;
    container.classList.toggle("hidden", count === 0);
    const empty = $("empty");
    empty.classList.toggle("hidden", count > 0);
    empty.textContent =
      "Waiting for payments.\nEach bill stays here for " + windowMinutes() + " minutes. " +
      "Use All Transactions to look up the rest of today.";

    const badge = $("live-count");
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
    document.title = count ? "(" + count + ") TREAT — Cashier" : "TREAT — Cashier";
    updateAllBanner(count);
  }

  // Once a second: let cards age out, and settle the gold "new" look.
  function tick() {
    for (const [id, b] of state.payments) {
      if (nowMs() - b.lastMs >= state.windowMs + REMEMBER_AFTER_EXPIRY_MS) state.payments.delete(id);
    }
    let rerender = false;
    for (const [id, node] of alertEls) {
      const b = state.payments.get(id);
      if (!b || !onBoard(b)) {
        rerender = true;
        break;
      }
      if (node.classList.contains("fresh") && !isFresh(b)) node.classList.remove("fresh");
    }
    if (rerender) renderLive();
  }

  function refreshTimes() {
    document.querySelectorAll(".when[data-created]").forEach((node) => {
      const ms = Number(node.dataset.created);
      node.textContent = clock(ms) + " · " + ago(ms);
    });
  }

  function setStatus(kind) {
    $("status").dataset.state = kind;
    $("status-text").textContent = kind === "live" ? "Live" : "Reconnecting…";
  }

  function acknowledge(b) {
    state.seen.add(seenKey(b));
    store.set(KEYS.seen, JSON.stringify([...state.seen].slice(-SEEN_CAP)));
    renderLive();
  }

  // ---------- the live feed ----------

  function mergePayments(list, serverMs) {
    const fresh = [];
    let changed = false;

    // The server sends newest first; walk oldest first so cards arrive in order.
    for (const b of [...list].reverse()) {
      b.lastMs = Date.parse(b.lastAt);
      // Already too old for the board (the server filters too; this covers
      // clock edge cases) - nothing to show or announce.
      if (serverMs - b.lastMs >= state.windowMs) continue;
      // A bill comes back on every poll that covers one of its payments;
      // only a different set of payers is news.
      const prev = state.payments.get(b.id);
      if (prev && billSig(prev) === billSig(b)) continue;
      state.payments.set(b.id, b);
      changed = true;
      // Only a new payer or total is news; an OTP arriving just fills in the card.
      if (prev && prev.payments.length === b.payments.length && prev.totalAmount === b.totalAmount) continue;

      if (state.seen.has(seenKey(b))) continue; // cleared earlier, e.g. before a reload
      // A freshly opened screen shows what is still on the board but only
      // announces what is genuinely new.
      if (state.firstLoadDone || serverMs - b.lastMs < FRESH_MS) fresh.push(b);
    }
    state.firstLoadDone = true;

    if (changed) renderLive();
    if (fresh.length) {
      announce();
      // The cashier may be searching All Transactions; keep that list current too.
      if (state.tab === "all") loadTransactions();
    }
  }

  async function pollOnce(gen) {
    const query = new URLSearchParams();
    if (state.outlet && state.outlet !== ALL) query.set("outlet", state.outlet);
    if (state.cursorMs) query.set("since", new Date(state.cursorMs - OVERLAP_MS).toISOString());
    query.set("limit", state.cursorMs ? "50" : "100");

    const data = await api("/payments?" + query.toString());
    if (gen !== state.generation) return; // outlet changed / signed out mid-request

    const serverMs = Date.parse(data.serverTime);
    state.skewMs = serverMs - Date.now();
    state.cursorMs = serverMs;
    if (data.windowSeconds > 0) state.windowMs = data.windowSeconds * 1000;
    mergePayments(data.payments, serverMs);
  }

  function stopPolling() {
    state.generation += 1;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    const gen = state.generation;

    const loop = async () => {
      if (gen !== state.generation) return;
      try {
        await pollOnce(gen);
        state.failures = 0;
        if (gen === state.generation) setStatus("live");
      } catch (err) {
        if (gen !== state.generation) return;
        if (err.status === 401) {
          signOut("Your session ended. Please sign in again.");
          return;
        }
        state.failures += 1;
        setStatus("offline");
      }
      if (gen !== state.generation) return;
      const delay = state.failures ? Math.min(5000, POLL_MS * 2 ** Math.min(state.failures, 3)) : POLL_MS;
      state.pollTimer = setTimeout(loop, delay);
    };

    loop();
  }

  // ---------- all transactions ----------

  function buildTxRow(t) {
    const row = el("div", "tx-row");
    row.append(el("div", "c-time", clock(t.createdMs)));

    const who = el("div", "c-who");
    const detail = "ID " + t.employeeCode + (state.outlet === ALL && t.outlet ? " · " + t.outlet : "");
    who.append(el("strong", null, t.employeeName), el("span", null, detail));
    row.append(who);

    row.append(el("div", "c-bill", t.billNo ? "Bill " + t.billNo : "—"));
    row.append(el("div", "c-total num", rupees(t.totalAmount)));
    row.append(el("div", "c-allow num", rupees(t.allowanceAmount)));
    row.append(el("div", "c-cash num" + (t.cashAmount > 0 ? " has-cash" : ""), t.cashAmount > 0 ? rupees(t.cashAmount) : "—"));
    row.append(el("div", "c-code" + (t.code ? "" : " none"), t.code ? formatCode(t.code) : "No code"));
    return row;
  }

  function renderAll() {
    const tx = state.tx;
    const list = $("tx-list");
    const empty = $("all-empty");
    list.textContent = "";

    if (!tx) {
      $("all-title").textContent = "Today";
      $("all-sub").textContent = outletLabel();
      empty.textContent = state.txFailed
        ? "Couldn't load today's transactions. Check the connection."
        : "Loading today's transactions…";
      empty.classList.remove("hidden");
      $("tx-head").classList.add("hidden");
      $("all-note").textContent = "";
      return;
    }

    const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = tokens.length ? tx.list.filter((t) => tokens.every((tok) => t.haystack.includes(tok))) : tx.list;
    const frag = document.createDocumentFragment();
    for (const t of rows) frag.append(buildTxRow(t));
    list.append(frag);

    $("all-title").textContent = "Today · " + dayLabel(tx.dayStartMs);
    const count = tokens.length
      ? rows.length + " of " + tx.list.length + " match"
      : tx.list.length + (tx.list.length === 1 ? " payment" : " payments");
    $("all-sub").textContent = [outletLabel(), count].filter(Boolean).join(" · ");

    if (tx.list.length === 0) empty.textContent = "No payments recorded today yet.";
    else if (rows.length === 0) empty.textContent = "No payment matches “" + state.query.trim() + "”.";
    empty.classList.toggle("hidden", rows.length > 0);
    $("tx-head").classList.toggle("hidden", rows.length === 0);

    const notes = [
      state.txFailed
        ? "Couldn't refresh - showing the list from " + clock(tx.loadedMs) + "."
        : "Updated " + clock(tx.loadedMs) + ".",
    ];
    if (tx.truncated) notes.push("Showing the latest " + tx.list.length + " payments of today.");
    $("all-note").textContent = notes.join(" ");
  }

  async function loadTransactions() {
    if (state.txLoading) {
      state.txQueued = true;
      return;
    }
    const gen = state.txGen;
    state.txLoading = true;
    let again = false;

    try {
      const query = new URLSearchParams();
      if (state.outlet && state.outlet !== ALL) query.set("outlet", state.outlet);
      const data = await api("/transactions" + (query.toString() ? "?" + query.toString() : ""));
      if (gen === state.txGen) {
        state.tx = {
          list: data.transactions.map((t) => ({
            ...t,
            createdMs: Date.parse(t.createdAt),
            haystack: (t.employeeName + " " + t.employeeCode + " " + (t.billNo || "")).toLowerCase(),
          })),
          truncated: !!data.truncated,
          dayStartMs: Date.parse(data.dayStart),
          loadedMs: Date.parse(data.serverTime),
        };
        state.txFailed = false;
      }
    } catch (err) {
      if (gen === state.txGen) {
        if (err.status === 401) {
          signOut("Your session ended. Please sign in again.");
          return;
        }
        state.txFailed = true;
      }
    } finally {
      // A newer generation (outlet changed, signed out) owns these flags now.
      if (gen === state.txGen) {
        state.txLoading = false;
        again = state.txQueued;
        state.txQueued = false;
      }
    }

    if (gen !== state.txGen) return;
    if (state.tab === "all") renderAll();
    if (again) loadTransactions();
  }

  function startTxTimer() {
    stopTxTimer();
    state.txTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadTransactions();
    }, TX_REFRESH_MS);
  }

  function stopTxTimer() {
    if (state.txTimer) clearInterval(state.txTimer);
    state.txTimer = null;
  }

  // While browsing All Transactions, say so if payments are waiting on the
  // live board - the cashier must never miss one because of the other tab.
  function updateAllBanner(count) {
    const banner = $("all-banner");
    const showIt = state.tab === "all" && count > 0;
    banner.classList.toggle("hidden", !showIt);
    if (!showIt) return;
    banner.textContent = "";
    banner.append(
      el("span", null, count + (count === 1 ? " payment is" : " payments are") + " waiting on Live payments.")
    );
    const go = el("button", "btn small", "Show");
    go.type = "button";
    go.addEventListener("click", () => setTab("live"));
    banner.append(go);
  }

  // ---------- tabs ----------

  function setTab(name) {
    state.tab = name;
    const live = name === "live";
    $("view-live").classList.toggle("hidden", !live);
    $("view-all").classList.toggle("hidden", live);
    for (const [id, active] of [["tab-live", live], ["tab-all", !live]]) {
      $(id).classList.toggle("active", active);
      $(id).setAttribute("aria-selected", String(active));
    }
    if (live) {
      stopTxTimer();
      renderLive();
    } else {
      renderAll();
      loadTransactions();
      startTxTimer();
      updateAllBanner([...state.payments.values()].filter(onBoard).length);
    }
  }

  // ---------- screens ----------

  function resetFeed() {
    state.payments = new Map();
    state.cursorMs = 0;
    state.firstLoadDone = false;
    state.failures = 0;
    alertEls.clear();
    $("alerts").textContent = "";

    // The day's list belongs to one outlet too.
    state.txGen += 1;
    stopTxTimer();
    state.tx = null;
    state.txLoading = false;
    state.txQueued = false;
    state.txFailed = false;
    state.query = "";
    $("search").value = "";
    $("tx-list").textContent = "";
  }

  function enterMain() {
    show("main");
    $("outlet-button").textContent = outletLabel() + " · Change";
    renderSoundButton();
    setStatus("live");
    keepAwake();
    setTab("live");
    startPolling();
  }

  function chooseOutlet(value) {
    if (value !== state.outlet) resetFeed();
    state.outlet = value;
    store.set(KEYS.outlet, value);
    enterMain();
  }

  function outletButton(value, label, isAll) {
    const button = el("button", "btn" + (isAll ? " all" : ""), label);
    button.type = "button";
    button.addEventListener("click", () => chooseOutlet(value));
    return button;
  }

  async function openOutletPicker() {
    stopPolling();
    stopTxTimer();
    show("outlet");
    $("outlet-back").classList.toggle("hidden", !state.outlet);
    $("outlet-error").classList.add("hidden");
    const list = $("outlet-list");
    list.textContent = "";
    try {
      const data = await api("/outlets");
      for (const name of data.outlets) list.append(outletButton(name, name, false));
      list.append(outletButton(ALL, "All outlets", true));
    } catch (err) {
      if (err.status === 401) {
        signOut("Your session ended. Please sign in again.");
        return;
      }
      $("outlet-error").textContent = "Couldn't load the outlets. Check the connection.";
      $("outlet-error").classList.remove("hidden");
      const retry = el("button", "btn ghost", "Try again");
      retry.type = "button";
      retry.addEventListener("click", openOutletPicker);
      list.append(retry);
    }
  }

  function signOut(message) {
    stopPolling();
    state.token = null;
    store.del(KEYS.token);
    resetFeed();
    state.tab = "live";
    show("login");
    const error = $("login-error");
    error.textContent = message || "";
    error.classList.toggle("hidden", !message);
    $("login-password").focus();
    document.title = "TREAT — Cashier";
  }

  function loginErrorText(err) {
    if (err.status === 401) return "That password isn't right.";
    if (err.status === 429) {
      const mins = Math.max(1, Math.ceil(((err.data && err.data.retryAfterSeconds) || 300) / 60));
      return "Too many wrong attempts. Try again in " + mins + " minute" + (mins === 1 ? "" : "s") + ".";
    }
    if (err.status === 503) return "The cashier screen isn't set up on the server yet.";
    return "Couldn't reach the server. Check the connection and try again.";
  }

  // ---------- wiring ----------

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    ensureAudio(); // this tap is the gesture browsers need before they allow sound
    const password = $("login-password").value;
    if (!password) return;

    const button = $("login-button");
    const error = $("login-error");
    button.disabled = true;
    error.classList.add("hidden");
    try {
      const data = await api("/login", { method: "POST", body: { password }, auth: false });
      state.token = data.token;
      store.set(KEYS.token, data.token);
      $("login-password").value = "";
      if (state.outlet) enterMain();
      else openOutletPicker();
    } catch (err) {
      error.textContent = loginErrorText(err);
      error.classList.remove("hidden");
      $("login-password").select();
    } finally {
      button.disabled = false;
    }
  });

  $("outlet-button").addEventListener("click", openOutletPicker);
  $("outlet-back").addEventListener("click", enterMain);
  $("logout-button").addEventListener("click", () => signOut(""));
  $("tab-live").addEventListener("click", () => setTab("live"));
  $("tab-all").addEventListener("click", () => setTab("all"));
  $("all-refresh").addEventListener("click", () => loadTransactions());

  let searchTimer = null;
  $("search").addEventListener("input", (event) => {
    state.query = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderAll, SEARCH_DEBOUNCE_MS);
  });

  $("sound-button").addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    store.set(KEYS.sound, state.soundOn ? "1" : "0");
    if (state.soundOn) {
      ensureAudio();
      beep(); // so the tap also proves it works
    }
    renderSoundButton();
    updateSoundBanner();
  });

  const unlockAudio = () => {
    ensureAudio();
    updateSoundBanner();
  };
  let pointerFailsafe = null;
  const pointerReleased = () => {
    clearTimeout(pointerFailsafe);
    pointerDown = false;
    // After the click that goes with this release has been delivered.
    setTimeout(updateSoundBanner, 0);
  };
  document.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
      // If a release is ever missed, don't leave the banner stuck.
      clearTimeout(pointerFailsafe);
      pointerFailsafe = setTimeout(pointerReleased, 3000);
      unlockAudio();
    },
    { passive: true }
  );
  document.addEventListener("pointerup", pointerReleased, { passive: true });
  document.addEventListener("pointercancel", pointerReleased, { passive: true });
  document.addEventListener("keydown", unlockAudio);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && mainVisible()) {
      keepAwake();
      startPolling(); // catch up straight away rather than wait for the next tick
      if (state.tab === "all") loadTransactions();
    }
  });
  window.addEventListener("online", () => {
    if (mainVisible()) startPolling();
  });

  setInterval(tick, TICK_MS);
  setInterval(refreshTimes, TIME_REFRESH_MS);

  // ---------- start ----------

  if (state.token) {
    if (state.outlet) enterMain();
    else openOutletPicker();
  } else {
    show("login");
  }
})();
