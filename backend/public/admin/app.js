const TOKEN_KEY = "toit_admin_token";

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function money(n) { return `₹${Number(n).toLocaleString("en-IN")}`; }
function dateTime(iso) { return new Date(iso).toLocaleString("en-IN"); }

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
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
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
  loginScreen.classList.remove("hidden");
  dashboardScreen.classList.add("hidden");
}

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
  loadOverview();
  loadEmployees();
  loadTransactions();
  loadCodes();
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
      loginError.textContent = "Incorrect password.";
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

// ---------------- Overview ----------------

async function loadOverview() {
  const data = await api("/overview");
  const cards = document.getElementById("overview-cards");
  cards.innerHTML = `
    <div class="card accent"><p class="label">Active employees</p><p class="value">${data.activeEmployeeCount}</p></div>
    <div class="card accent"><p class="label">Total remaining</p><p class="value">${money(data.totals.remaining)}</p></div>
    <div class="card"><p class="label">Total allowance</p><p class="value">${money(data.totals.allowance)}</p></div>
    <div class="card"><p class="label">Total used</p><p class="value">${money(data.totals.used)}</p></div>
  `;
}

// ---------------- Employees ----------------

async function loadEmployees() {
  const data = await api("/employees");
  const body = document.getElementById("employees-body");
  const empty = document.getElementById("employees-empty");
  body.innerHTML = "";
  if (data.employees.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const e of data.employees) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.employeeCode)}</td><td>${escapeHtml(e.roleName)}</td>
      <td>${escapeHtml(e.department ?? "—")}</td><td>${escapeHtml(e.homeOutlet ?? "—")}</td>
      <td>${money(e.allowance)}</td><td>${money(e.used)}</td><td>${money(e.remaining)}</td>
    `;
    body.appendChild(tr);
  }
}

// ---------------- Transactions (paginated) ----------------

let transactionsCursor = null;

async function loadTransactions(append = false) {
  const qs = transactionsCursor ? `?cursor=${transactionsCursor}` : "";
  const data = await api(`/transactions${qs}`);
  const body = document.getElementById("transactions-body");
  const empty = document.getElementById("transactions-empty");
  const loadMoreBtn = document.getElementById("transactions-load-more");

  if (!append) body.innerHTML = "";
  empty.classList.toggle("hidden", append || data.transactions.length > 0);

  for (const t of data.transactions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.employeeName)}</td><td>${escapeHtml(t.employeeCode)}</td><td>${escapeHtml(t.outlet)}</td>
      <td>${money(t.amount)}</td><td>${dateTime(t.occurredAt)}</td><td>${escapeHtml(t.status)}</td>
    `;
    body.appendChild(tr);
  }

  transactionsCursor = data.nextCursor;
  loadMoreBtn.classList.toggle("hidden", !transactionsCursor);
}

document.getElementById("transactions-load-more").addEventListener("click", () => loadTransactions(true));

// ---------------- Reconciliation codes (paginated, lives on Overview) ----------------

let codesCursor = null;

async function loadCodes(append = false) {
  const qs = codesCursor ? `?cursor=${codesCursor}` : "";
  const data = await api(`/reconciliation-codes${qs}`);
  const body = document.getElementById("codes-body");
  const empty = document.getElementById("codes-empty");
  const loadMoreBtn = document.getElementById("codes-load-more");

  if (!append) body.innerHTML = "";
  empty.classList.toggle("hidden", append || data.codes.length > 0);

  for (const c of data.codes) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.code)}</td><td>${escapeHtml(c.employeeName)}</td><td>${escapeHtml(c.employeeCode)}</td>
      <td>${escapeHtml(c.context)}</td><td>${dateTime(c.createdAt)}</td>
    `;
    body.appendChild(tr);
  }

  codesCursor = data.nextCursor;
  loadMoreBtn.classList.toggle("hidden", !codesCursor);
}

document.getElementById("codes-load-more").addEventListener("click", () => loadCodes(true));

// ---------------- Reconcile ----------------
//
// Digitory's real export column names haven't been confirmed yet, so this
// guesses among a few likely headers (case-insensitive) rather than
// hardcoding one. If Digitory's actual export uses something else, add it
// to the relevant *_CANDIDATES list below - the matching logic itself
// doesn't need to change.

const CODE_CANDIDATES = ["code", "reference_code", "reconciliation_code", "otp", "ref_code", "reference"];
const AMOUNT_CANDIDATES = ["amount", "value", "total", "price"];
const DATE_CANDIDATES = ["date", "transaction_date", "datetime", "timestamp"];
const OUTLET_CANDIDATES = ["outlet", "outlet_name", "location", "branch"];

function findColumn(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

let reconcileRows = null;

const fileInput = document.getElementById("reconcile-file-input");
const filenameLabel = document.getElementById("reconcile-filename");
const runButton = document.getElementById("reconcile-run-button");
const reconcileError = document.getElementById("reconcile-error");

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
      const codeCol = findColumn(headers, CODE_CANDIDATES);
      if (!codeCol) {
        reconcileError.textContent =
          `Couldn't find a code column. Found: ${headers.join(", ") || "(no headers)"}. ` +
          `Expected one of: ${CODE_CANDIDATES.join(", ")}.`;
        reconcileError.classList.remove("hidden");
        return;
      }
      const amountCol = findColumn(headers, AMOUNT_CANDIDATES);
      const dateCol = findColumn(headers, DATE_CANDIDATES);
      const outletCol = findColumn(headers, OUTLET_CANDIDATES);

      reconcileRows = result.data
        .map((row) => ({
          code: String(row[codeCol] ?? "").trim(),
          amount: amountCol ? Number(row[amountCol]) : undefined,
          date: dateCol ? String(row[dateCol]) : undefined,
          outlet: outletCol ? String(row[outletCol]) : undefined,
        }))
        .filter((r) => r.code.length > 0);

      if (reconcileRows.length === 0) {
        reconcileError.textContent = "No rows with a code value were found in this file.";
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
    renderReconcileResults(data);
  } catch {
    reconcileError.textContent = "Reconciliation failed - check your connection and try again.";
    reconcileError.classList.remove("hidden");
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<i class="ti ti-refresh"></i>Run reconciliation';
  }
});

function renderReconcileResults(data) {
  const body = document.getElementById("reconcile-body");
  const empty = document.getElementById("reconcile-empty");
  const summary = document.getElementById("reconcile-summary");

  body.innerHTML = "";
  empty.classList.add("hidden");
  summary.classList.remove("hidden");
  document.getElementById("reconcile-matched-count").textContent = data.summary.matched;
  document.getElementById("reconcile-unmatched-count").textContent = data.summary.unmatched;

  for (const r of data.results) {
    const tr = document.createElement("tr");
    const statusPill = r.matched
      ? `<span class="pill pill-success"><i class="ti ti-check"></i>Matched</span>`
      : `<span class="pill pill-warning"><i class="ti ti-alert-triangle"></i>Unmatched</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(r.code)}</td>
      <td>${r.matched ? escapeHtml(r.employeeName) : "—"}</td>
      <td>${r.amount != null ? money(r.amount) : "—"}</td>
      <td>${escapeHtml(r.outlet ?? "—")}</td>
      <td>${escapeHtml(r.date ?? "—")}</td>
      <td>${statusPill}</td>
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
