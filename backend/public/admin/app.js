const TOKEN_KEY = "toit_admin_token";

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function money(n) { return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function dateOnly(iso) { return iso ? String(iso).slice(0, 10) : "—"; }

async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    showLogin();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // response wasn't JSON - body stays null, caller falls back to a generic message
    }
    const err = new Error(body?.message || `request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard-screen");

function showLogin() {
  if (typeof showSignInForm === "function") showSignInForm();
  loginScreen.classList.remove("hidden");
  dashboardScreen.classList.add("hidden");
}

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
  loadEmployees();
  loadRosterChanges();
}

// ---------------- Login ----------------

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginButton = document.getElementById("login-button");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  loginButton.disabled = true;
  loginButton.textContent = "Signing in...";
  try {
    const password = document.getElementById("login-password").value;
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (body.error === "password_not_set") {
        loginError.textContent = "No password yet. Use \"Sign in with Google\" below to set one.";
      } else if (res.status === 429) {
        const hours = Math.max(1, Math.ceil((body.retryAfterSeconds || 28800) / 3600));
        loginError.textContent = `Too many wrong attempts. Try again in about ${hours} hour${hours === 1 ? "" : "s"}, or sign in with Google.`;
      } else if (body.attemptsLeft === 0) {
        loginError.textContent = "Incorrect password. Too many attempts: sign-in is locked for 8 hours.";
      } else {
        loginError.textContent = `Incorrect password.${typeof body.attemptsLeft === "number" ? ` ${body.attemptsLeft} attempt${body.attemptsLeft === 1 ? "" : "s"} left.` : ""}`;
      }
      loginError.classList.remove("hidden");
      return;
    }
    setToken(body.token);
    showDashboard();
  } catch {
    loginError.textContent = "Couldn't reach the server. Check your connection.";
    loginError.classList.remove("hidden");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Sign in";
  }
});

// ---------------- Google sign-in (the admin's own email only) + her password ----------------

const passwordForm = document.getElementById("password-form");
const passwordError = document.getElementById("password-error");
const passwordCancel = document.getElementById("password-cancel");

// Swaps the login card between "sign in" and "choose a password".
function showPasswordForm(cancellable) {
  loginScreen.classList.remove("hidden");
  dashboardScreen.classList.add("hidden");
  for (const el of [loginForm, document.querySelector(".or"), document.getElementById("google-button")]) el.classList.add("hidden");
  document.getElementById("login-subtitle").classList.add("hidden");
  passwordForm.classList.remove("hidden");
  passwordCancel.classList.toggle("hidden", !cancellable);
  passwordForm.reset();
  passwordError.classList.add("hidden");
}

function showSignInForm() {
  passwordForm.classList.add("hidden");
  document.getElementById("login-subtitle").classList.remove("hidden");
  for (const el of [loginForm, document.querySelector(".or"), document.getElementById("google-button")]) el.classList.remove("hidden");
}

// "Forgot your password?" was clicked: the Google sign-in that follows goes
// straight to choosing a new password instead of into the dashboard.
let resetMode = false;
document.getElementById("forgot-link").addEventListener("click", (e) => {
  e.preventDefault();
  resetMode = true;
  loginError.textContent = "Sign in with Google below to choose a new password.";
  loginError.classList.remove("hidden");
});

async function onGoogleCredential(response) {
  loginError.classList.add("hidden");
  try {
    const res = await fetch("/api/admin/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: response.credential }),
    });
    const body = await res.json();
    if (!res.ok) {
      loginError.textContent = res.status === 403 ? "This Google account is not allowed to use the admin dashboard." : "Google sign-in failed. Try again.";
      loginError.classList.remove("hidden");
      return;
    }
    setToken(body.token);
    if (body.passwordSet && !resetMode) showDashboard();
    else showPasswordForm(false);
    resetMode = false;
  } catch {
    loginError.textContent = "Couldn't reach the server. Check your connection.";
    loginError.classList.remove("hidden");
  }
}

async function initGoogleButton() {
  try {
    const { googleClientId, testTools } = await (await fetch("/api/admin/config")).json();
    if (testTools) document.getElementById("nav-update-balance").classList.remove("hidden");
    // The Google script loads async; wait for it.
    for (let i = 0; i < 50 && !window.google?.accounts?.id; i++) await new Promise((r) => setTimeout(r, 100));
    if (!window.google?.accounts?.id) return;
    google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleCredential });
    google.accounts.id.renderButton(document.getElementById("google-button"), { theme: "outline", size: "large", text: "signin_with", width: 336 });
  } catch {
    // no Google button: password sign-in still works
  }
}
initGoogleButton();

passwordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = document.getElementById("new-password").value;
  const show = (msg) => { passwordError.textContent = msg; passwordError.classList.remove("hidden"); };
  if (pw.length < 10) return show("Use at least 10 characters.");
  if (pw !== document.getElementById("new-password2").value) return show("The two passwords don't match.");
  try {
    await api("/password", { method: "POST", body: JSON.stringify({ password: pw }) });
    showSignInForm();
    showDashboard();
  } catch {
    show("Couldn't save the password. Try again.");
  }
});

passwordCancel.addEventListener("click", () => { showSignInForm(); showDashboard(); });
document.getElementById("password-open").addEventListener("click", () => showPasswordForm(true));

document.getElementById("logout-button").addEventListener("click", () => {
  clearToken();
  showLogin();
});

// ---------------- Sidebar navigation ----------------

const sidebar = document.getElementById("sidebar");

document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-page]").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`page-${btn.dataset.page}`).classList.remove("hidden");
    sidebar.classList.remove("open");
  });
});

document.getElementById("sidebar-toggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

// ---------------- Update balance (testing only) ----------------

let balanceRows = null;
const balanceFileInput = document.getElementById("balance-file-input");
const balanceRunButton = document.getElementById("balance-run-button");
const balanceError = document.getElementById("balance-error");

function showBalanceError(msg) { balanceError.textContent = msg; balanceError.classList.remove("hidden"); }

balanceFileInput.addEventListener("change", () => {
  const file = balanceFileInput.files?.[0];
  balanceError.classList.add("hidden");
  balanceRunButton.disabled = true;
  balanceRows = null;
  if (!file) return;
  document.getElementById("balance-filename").textContent = file.name;
  readExcelRows(file).then(
    (rows) => {
      // Headers matched case-insensitively: wallet, new_balance
      const pick = (row, name) => Object.entries(row).find(([k]) => k.toLowerCase().replace(/\s+/g, "_") === name)?.[1] ?? "";
      balanceRows = rows.map((r) => ({ wallet: pick(r, "wallet"), new_balance: String(pick(r, "new_balance")).replace(/,/g, "") }));
      if (balanceRows.length === 0) return showBalanceError("No rows found in this file.");
      const bad = balanceRows.map((r, i) => (r.wallet && r.new_balance !== "" ? null : i + 2)).filter(Boolean);
      if (bad.length) { balanceRows = null; return showBalanceError(`Both wallet and new_balance are needed. Check row${bad.length === 1 ? "" : "s"}: ${bad.slice(0, 20).join(", ")}`); }
      balanceRunButton.disabled = false;
    },
    () => showBalanceError("Couldn't read that file - make sure it's a valid Excel file (.xlsx).")
  );
});

balanceRunButton.addEventListener("click", async () => {
  if (!balanceRows) return;
  balanceError.classList.add("hidden");
  balanceRunButton.disabled = true;
  try {
    const data = await api("/test/update-balance", { method: "POST", body: JSON.stringify({ rows: balanceRows }) });
    document.getElementById("balance-empty").classList.add("hidden");
    document.getElementById("balance-body").innerHTML = data.results
      .map((r) => `<tr><td>${escapeHtml(r.wallet)}</td><td>${escapeHtml(r.name)}</td><td>${money(r.used)}</td><td>${money(r.newBalance)}</td></tr>`)
      .join("");
    loadEmployees();
  } catch (err) {
    const b = err.body;
    if (b?.error === "unknown_wallets") showBalanceError(`Nothing updated. These wallets don't exist: ${b.wallets.slice(0, 20).join(", ")}`);
    else if (b?.error === "invalid_rows") showBalanceError("Nothing updated. Check these rows:\n" + b.issues.slice(0, 20).map((i) => `Row ${i.row}: ${i.field} ${i.message}`).join("\n"));
    else showBalanceError("Update failed - check your connection and try again.");
  } finally {
    balanceRunButton.disabled = false;
  }
});

// ---------------- Employees ----------------

let allEmployees = [];

async function loadEmployees() {
  const data = await api("/employees");
  allEmployees = data.employees;
  renderEmployees(allEmployees);
  if (typeof renderRevoke === "function") renderRevoke();
}

function renderEmployees(list) {
  const body = document.getElementById("employees-body");
  const empty = document.getElementById("employees-empty");
  body.innerHTML = "";
  if (list.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const e of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.employeeCode)}</td>
      <td>${dateOnly(e.lastWorkingDay)}</td>
      <td>${escapeHtml(e.email ?? "—")}</td>
      <td>${escapeHtml(e.phone || "—")}</td>
      <td>${escapeHtml(e.roleName)}</td>
      <td>${escapeHtml(e.homeOutlet ?? "—")}</td>
      <td>${money(e.allowance)}</td>
      <td>${e.walletLimit != null ? money(e.walletLimit) : "—"}</td>
      <td>${e.otpEnabled ? "Yes" : "No"}</td>
      <td>${dateOnly(e.walletValidFrom)}</td>
      <td>${dateOnly(e.walletValidTo)}</td>
      <td>${escapeHtml(e.grade || "—")}</td>
      <td>${dateOnly(e.dateOfJoining)}</td>
      <td>${money(e.used)}</td>
      <td>${money(e.remaining)}</td>
    `;
    body.appendChild(tr);
  }
}

let searchBy = "code"; // "code" | "name"
const employeesSearch = document.getElementById("employees-search");

function applyEmployeeSearch() {
  const q = employeesSearch.value.trim().toLowerCase();
  const field = searchBy === "name" ? "name" : "employeeCode";
  renderEmployees(q ? allEmployees.filter((emp) => emp[field].toLowerCase().includes(q)) : allEmployees);
}

employeesSearch.addEventListener("input", applyEmployeeSearch);

document.querySelectorAll("[data-search-by]").forEach((btn) => {
  btn.addEventListener("click", () => {
    searchBy = btn.dataset.searchBy;
    document.querySelectorAll("[data-search-by]").forEach((b) => b.classList.toggle("active", b === btn));
    employeesSearch.placeholder = searchBy === "name" ? "Search by employee name" : "Search by employee code";
    employeesSearch.focus();
    applyEmployeeSearch();
  });
});

// ---------------- Dialog ----------------

// Our own confirm box (the browser's looks out of place). Resolves true on the
// confirm button, false on Cancel, Escape or a click outside. `facts` is a list
// of [label, value] pairs shown as a small summary. cancelLabel: null = no Cancel.
function showDialog({ title, message, facts = [], confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  const root = document.getElementById("dialog");
  document.getElementById("dialog-title").textContent = title;
  document.getElementById("dialog-message").textContent = message;
  const factsEl = document.getElementById("dialog-facts");
  factsEl.innerHTML = "";
  for (const [label, value] of facts) {
    const row = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    row.append(dt, dd);
    factsEl.append(row);
  }
  factsEl.classList.toggle("hidden", facts.length === 0);
  root.classList.toggle("danger", danger);
  const ok = document.getElementById("dialog-ok");
  const cancel = document.getElementById("dialog-cancel");
  ok.textContent = confirmLabel;
  cancel.textContent = cancelLabel ?? "";
  cancel.classList.toggle("hidden", cancelLabel === null);
  root.classList.remove("hidden");
  ok.focus();

  return new Promise((resolve) => {
    const done = (value) => {
      root.classList.add("hidden");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      root.removeEventListener("mousedown", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (ev) => { if (ev.target === root) done(false); };
    const onKey = (ev) => { if (ev.key === "Escape") done(false); };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    root.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

// ---------------- Revoke balance ----------------

const revokeSearch = document.getElementById("revoke-search");

function renderRevoke() {
  const q = revokeSearch.value.trim().toLowerCase();
  const body = document.getElementById("revoke-body");
  const empty = document.getElementById("revoke-empty");
  body.innerHTML = "";
  if (!q) {
    empty.textContent = "Type a name or employee code to find someone.";
    empty.classList.remove("hidden");
    return;
  }
  const matches = allEmployees
    .filter((e) => e.name.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q))
    .slice(0, 25);
  empty.textContent = "Nobody matches that.";
  empty.classList.toggle("hidden", matches.length > 0);
  for (const e of matches) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.employeeCode)}</td>
      <td>${e.lastWorkingDay ? dateOnly(e.lastWorkingDay) : "—"}</td>
      <td>${money(e.used)}</td>
      <td>${money(e.remaining)}</td>
      <td></td>
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "danger-button";
    btn.textContent = "Revoke balance";
    if (!e.lastWorkingDay) {
      btn.disabled = true;
      btn.title = "This employee has no LWD (last working day) in the roster upload";
    } else if (!(e.remaining > 0)) {
      btn.disabled = true;
      btn.title = "Nothing left to revoke";
    }
    btn.addEventListener("click", async () => {
      const go = await showDialog({
        title: "Revoke balance?",
        message: "Their remaining balance for this month becomes ₹0.00. This can't be undone from here.",
        facts: [["Employee", `${e.name} (${e.employeeCode})`], ["Last working day", dateOnly(e.lastWorkingDay)], ["Amount revoked", money(e.remaining)]],
        confirmLabel: "Revoke balance",
        danger: true,
      });
      if (!go) return;
      btn.disabled = true;
      try {
        await api(`/employees/${encodeURIComponent(e.employeeCode)}/revoke-balance`, { method: "POST" });
        await loadEmployees();
      } catch (err) {
        if (err.message !== "unauthorized") await showDialog({ title: "Couldn't revoke the balance", message: "Something went wrong. Nothing was changed. Try again.", confirmLabel: "OK", cancelLabel: null });
      }
      renderRevoke();
    });
    tr.lastElementChild.append(btn);
    body.appendChild(tr);
  }
}

revokeSearch.addEventListener("input", renderRevoke);

// ---------------- Import / Export ----------------

document.getElementById("export-button").addEventListener("click", async () => {
  const data = await api("/employees/export");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.employees), "Employees");
  XLSX.writeFile(wb, `toit-employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// One Excel cell as the text the import expects: dates as 08-Oct-2026, numbers
// without a trailing .0, everything trimmed. (The server wants strings.)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function cellToText(v) {
  if (v instanceof Date) return `${String(v.getDate()).padStart(2, "0")}-${MONTHS[v.getMonth()]}-${v.getFullYear()}`;
  return v == null ? "" : String(v).trim();
}

// First sheet of the workbook -> one object per row, keyed by the header row.
async function readExcelRows(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true, blankrows: false }).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), cellToText(v)]))
  );
}

let importRows = null;

const importFileInput = document.getElementById("import-file-input");
const importFilenameLabel = document.getElementById("import-filename");
const importRunButton = document.getElementById("import-run-button");
const importError = document.getElementById("import-error");

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files?.[0];
  importError.classList.add("hidden");
  importRunButton.disabled = true;
  importRows = null;
  if (!file) return;

  importFilenameLabel.textContent = file.name;

  readExcelRows(file).then(
    (rows) => {
      importRows = rows;
      if (importRows.length === 0) {
        importError.textContent = "No rows found in this file.";
        importError.classList.remove("hidden");
        return;
      }
      importRunButton.disabled = false;
    },
    () => {
      importError.textContent = "Couldn't read that file - make sure it's a valid Excel file (.xlsx).";
      importError.classList.remove("hidden");
    }
  );
});

importRunButton.addEventListener("click", async () => {
  if (!importRows) return;
  importError.classList.add("hidden");
  importRunButton.disabled = true;
  importRunButton.textContent = "Importing...";
  try {
    const data = await api("/employees/import", { method: "POST", body: JSON.stringify({ rows: importRows }) });
    renderImportResults(data);
    loadEmployees();
    loadRosterChanges();
  } catch (err) {
    if (err.body?.error === "missing_required_fields") {
      importError.textContent = formatMissingFieldsError(err.body.issues);
    } else {
      importError.textContent = "Import failed - check your connection and try again.";
    }
    importError.classList.remove("hidden");
  } finally {
    importRunButton.disabled = false;
    importRunButton.innerHTML = '<i class="ti ti-upload"></i>Run Import';
  }
});

// Groups per-field issues by row so "Row 5: Grade, DOJ" reads as one line
// instead of one line per field. Capped so a file with a systematic problem
// (every row affected) doesn't dump hundreds of lines into the banner - the
// first 20 rows already show the pattern. Shows the real validation message
// per field when zod provided one (e.g. "amount: Expected integer, received
// float") rather than always saying "missing" - a present-but-invalid value
// isn't actually missing, and saying so sends an admin looking for a blank
// cell that was never the real problem.
function formatMissingFieldsError(issues) {
  const byRow = new Map();
  for (const issue of issues) {
    const label = issue.wallet_no ? `Row ${issue.row} (${issue.wallet_no})` : `Row ${issue.row}`;
    if (!byRow.has(label)) byRow.set(label, []);
    byRow.get(label).push(issue.message ? `${issue.field} (${issue.message})` : issue.field);
  }
  const lines = [...byRow.entries()].map(([label, fields]) => `${label}: ${fields.join(", ")}`);
  const shown = lines.slice(0, 20);
  const remaining = lines.length - shown.length;
  const header = `Can't upload - ${byRow.size} row${byRow.size === 1 ? "" : "s"} have invalid or missing fields:`;
  const footer = remaining > 0 ? `\n…and ${remaining} more row${remaining === 1 ? "" : "s"}.` : "";
  return `${header}\n${shown.join("\n")}${footer}`;
}

function renderImportResults(data) {
  const body = document.getElementById("import-body");
  const empty = document.getElementById("import-empty");
  const summary = document.getElementById("import-summary");

  body.innerHTML = "";
  empty.classList.add("hidden");
  summary.classList.remove("hidden");
  document.getElementById("import-created-count").textContent = data.summary.created;
  document.getElementById("import-updated-count").textContent = data.summary.updated;
  document.getElementById("import-error-count").textContent = data.summary.errors;

  for (const r of data.results) {
    const tr = document.createElement("tr");
    const statusPill =
      r.status === "error"
        ? `<span class="pill pill-warning"><i class="ti ti-alert-triangle"></i>Error</span>`
        : `<span class="pill pill-success"><i class="ti ti-check"></i>${r.status === "created" ? "Created" : "Updated"}</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(r.wallet_no)}</td>
      <td>${escapeHtml(r.customer_name ?? "—")}</td>
      <td>${escapeHtml(r.email_id ?? "—")}</td>
      <td>${escapeHtml(r.phone_number || "—")}</td>
      <td>${escapeHtml(r.ref_no ?? "—")}</td>
      <td>${escapeHtml(r["Cost Center"] || "—")}</td>
      <td>${r.amount != null ? money(r.amount) : "—"}</td>
      <td>${r.limit != null ? money(r.limit) : "—"}</td>
      <td>${r.enable_otp == null ? "—" : r.enable_otp ? "Yes" : "No"}</td>
      <td>${escapeHtml(r.valid_from || "—")}</td>
      <td>${escapeHtml(r.valid_to || "—")}</td>
      <td>${escapeHtml(r.Grade || "—")}</td>
      <td>${escapeHtml(r.DOJ || "—")}</td>
      <td>${escapeHtml(r.LWD || "—")}</td>
      <td>${statusPill}</td>
      <td>${escapeHtml(r.error ?? "—")}</td>
    `;
    body.appendChild(tr);
  }
}

// Fetched independently of any import run - this is what makes the panels
// show real data on a plain page load/reload, not just right after someone
// personally clicks "Run Import" in that browser tab.
async function loadRosterChanges() {
  try {
    const data = await api("/employees/roster-changes");
    renderRosterChanges(data);
  } catch {
    // Non-critical - the rest of the dashboard still works if this fails.
  }
}

function renderRosterChanges(data) {
  const joinersBody = document.getElementById("joiners-body");
  const joinersEmpty = document.getElementById("joiners-empty");
  joinersBody.innerHTML = "";
  joinersEmpty.classList.toggle("hidden", data.joiners.length > 0);
  for (const j of data.joiners) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(j.employeeCode)}</td><td>${escapeHtml(j.name)}</td>`;
    joinersBody.appendChild(tr);
  }

  const leaversBody = document.getElementById("leavers-body");
  const leaversEmpty = document.getElementById("leavers-empty");
  leaversBody.innerHTML = "";
  leaversEmpty.classList.toggle("hidden", data.leavers.length > 0);
  for (const l of data.leavers) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(l.employeeCode)}</td><td>${escapeHtml(l.name)}</td>`;
    leaversBody.appendChild(tr);
  }
}

// ---------------- Reconcile ----------------
//
// Reconciliation is by bill number. The bill-number column's real name in
// Digitory's ledger export isn't confirmed yet (the sample we have predates
// this) - guessed via candidates. Update this list if/when a real sample with
// the actual column name shows up, rather than assuming it's fixed.
const BILL_CANDIDATES = ["bill no", "bill no.", "bill number", "bill_no", "billno", "bill #", "bill", "invoice no", "invoice number", "invoice"];

function findColumn(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

let reconcileRows = null;
let reconcileData = null; // { reconciled: [...], unreconciled: [...] } from the last successful run
let reconcileSubtab = "reconciled";

const fileInput = document.getElementById("reconcile-file-input");
const filenameLabel = document.getElementById("reconcile-filename");
const runButton = document.getElementById("reconcile-run-button");
const reconcileError = document.getElementById("reconcile-error");

// The wallet-ledger export's other columns are confirmed/fixed (see
// data/Ledgers-7.csv): Wallet #, Event, Transaction Id, Payment Name,
// Amount, Balance, Date Time, User, Status - only the bill-number column's
// name is guessed, since it doesn't exist in the sample we have yet.
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  reconcileError.classList.add("hidden");
  runButton.disabled = true;
  reconcileRows = null;
  if (!file) return;

  filenameLabel.textContent = file.name;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      const headers = result.meta.fields ?? [];
      const billColumn = findColumn(headers, BILL_CANDIDATES);
      if (!billColumn) {
        reconcileError.textContent =
          `Couldn't find a Bill No column. Found: ${headers.join(", ") || "(no headers)"}.`;
        reconcileError.classList.remove("hidden");
        return;
      }

      reconcileRows = result.data
        .map((row) => ({
          billNo: String(row[billColumn] ?? "").trim(),
          walletNo: row["Wallet #"] ? String(row["Wallet #"]) : undefined,
          event: row["Event"] ? String(row["Event"]) : undefined,
          transactionId: row["Transaction Id"] ? String(row["Transaction Id"]) : undefined,
          paymentName: row["Payment Name"] ? String(row["Payment Name"]) : undefined,
          // A non-numeric placeholder (e.g. "N/A"/"Pending" for a voided
          // POS row) must become explicit null, not NaN - NaN silently
          // turns into JSON null anyway once this is sent, but doing it on
          // purpose here (rather than relying on that implicit behavior)
          // keeps this row matching ledgerRowSchema's amount field, which
          // accepts null but not a bare "number" that's secretly NaN.
          amount: (() => {
            if (row["Amount"] == null || row["Amount"] === "") return undefined;
            const n = Number(String(row["Amount"]).replace(/,/g, ""));
            return Number.isNaN(n) ? null : n;
          })(),
          balance: row["Balance"] != null && row["Balance"] !== "" ? Number(String(row["Balance"]).replace(/,/g, "")) : undefined,
          dateTime: row["Date Time"] ? String(row["Date Time"]) : undefined,
          user: row["User"] ? String(row["User"]) : undefined,
          status: row["Status"] ? String(row["Status"]) : undefined,
        }))
        .filter((r) => r.billNo.length > 0);

      if (reconcileRows.length === 0) {
        reconcileError.textContent = "No rows with a bill number were found in this file.";
        reconcileError.classList.remove("hidden");
        return;
      }
      runButton.disabled = false;
    },
    error: () => {
      reconcileError.textContent = "Couldn't read that file - make sure it's a valid CSV.";
      reconcileError.classList.remove("hidden");
    },
  });
});

runButton.addEventListener("click", async () => {
  if (!reconcileRows) return;
  reconcileError.classList.add("hidden");
  runButton.disabled = true;
  runButton.textContent = "Reconciling...";
  try {
    const data = await api("/reconcile", { method: "POST", body: JSON.stringify({ rows: reconcileRows }) });
    reconcileData = data;
    reconcileSubtab = "reconciled";
    renderReconcileResults();
  } catch (err) {
    reconcileError.textContent =
      err.body?.error === "invalid_body"
        ? "Reconciliation failed - one or more rows in this file have an invalid value (check the Amount column for non-numeric entries like \"N/A\")."
        : "Reconciliation failed - check your connection and try again.";
    reconcileError.classList.remove("hidden");
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<i class="ti ti-refresh"></i>Run reconciliation';
  }
});

document.querySelectorAll("#reconcile-subtabs .subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    reconcileSubtab = btn.dataset.subtab;
    document.querySelectorAll("#reconcile-subtabs .subtab").forEach((b) => b.classList.toggle("active", b === btn));
    renderReconcileResults();
  });
});

function renderReconcileResults() {
  const data = reconcileData;
  const body = document.getElementById("reconcile-body");
  const empty = document.getElementById("reconcile-empty");
  const summary = document.getElementById("reconcile-summary");
  const subtabs = document.getElementById("reconcile-subtabs");

  body.innerHTML = "";
  empty.classList.add("hidden");
  summary.classList.remove("hidden");
  subtabs.classList.remove("hidden");
  document.getElementById("reconcile-matched-count").textContent = data.summary.reconciled;
  document.getElementById("reconcile-unmatched-count").textContent = data.summary.unreconciled;

  const rows = reconcileSubtab === "reconciled" ? data.reconciled : data.unreconciled;
  for (const r of rows) {
    const tr = document.createElement("tr");
    const statusPill = r.reconciled
      ? `<span class="pill pill-success"><i class="ti ti-check"></i>Reconciled</span>`
      : `<span class="pill pill-warning"><i class="ti ti-alert-triangle"></i>Unreconciled</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(r.billNo)}</td>
      <td>${escapeHtml(r.walletNo ?? "—")}</td>
      <td>${r.employeeName ? escapeHtml(r.employeeName) : "—"}</td>
      <td>${r.amount != null ? money(r.amount) : "—"}</td>
      <td>${r.ourAmount != null ? money(r.ourAmount) : "—"}</td>
      <td>${escapeHtml(r.event ?? "—")}</td>
      <td>${escapeHtml(r.dateTime ?? "—")}</td>
      <td>${statusPill}</td>
      <td>${escapeHtml(r.reason ?? "—")}</td>
    `;
    body.appendChild(tr);
  }
}

// ---------------- Boot ----------------

if (getToken()) {
  showDashboard();
} else {
  showLogin();
}
