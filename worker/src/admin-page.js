const ADMIN_HOST = 'admin.chat.helixcer.com';

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="helixcer-api-base" content="https://api.chat.helixcer.com">
  <title>Helixcer Admin</title>
  <link rel="stylesheet" href="/admin.css">
</head>
<body>
  <main class="gate" id="gate">
    <section class="card">
      <p class="eyebrow">Helixcer platform</p>
      <h1>Client administration</h1>
      <p class="copy">Sign in with the Helixcer owner Google account to create client companies and their login details.</p>
      <p class="alert" id="alert" hidden></p>
      <a class="google" id="googleSignIn" href="#">Continue with Google</a>
    </section>
  </main>
  <div class="app" id="app" hidden>
    <header class="top">
      <div>
        <p class="eyebrow">admin.chat.helixcer.com</p>
        <h1>Clients</h1>
      </div>
      <div class="top-actions">
        <span id="meLabel"></span>
        <button class="ghost" id="signOut" type="button">Sign out</button>
      </div>
    </header>
    <section class="layout">
      <form class="panel" id="createClient">
        <h2>New client</h2>
        <p class="copy">The owner signs in at chat.helixcer.com with this email and password.</p>
        <label>Company name <input name="companyName" required minlength="2" maxlength="120" autocomplete="organization"></label>
        <label>Owner name <input name="ownerName" required minlength="2" maxlength="160" autocomplete="name"></label>
        <label>Owner email <input name="ownerEmail" type="email" required maxlength="254" autocomplete="off"></label>
        <label>Password <input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
        <button class="primary" type="submit">Create client</button>
        <p class="note" id="createdNote" hidden></p>
      </form>
      <section class="panel list-panel">
        <h2>Client companies</h2>
        <p class="empty" id="emptyClients" hidden>No clients yet.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Company</th><th>Owner</th><th>Status</th><th></th></tr>
            </thead>
            <tbody id="clientRows"></tbody>
          </table>
        </div>
      </section>
    </section>
  </div>
  <dialog class="dialog" id="passwordDialog">
    <form method="dialog" id="passwordForm">
      <h2>Reset password</h2>
      <p class="copy" id="passwordTarget"></p>
      <label>New password <input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
      <div class="dialog-actions">
        <button class="ghost" type="button" id="passwordCancel">Cancel</button>
        <button class="primary" value="save" type="submit">Save password</button>
      </div>
    </form>
  </dialog>
  <script src="/admin.js"></script>
</body>
</html>`;

const ADMIN_CSS = `:root { color-scheme: light; --brand: #6d3bea; --ink: #172033; --muted: #667085; --line: #e7eaf0; --canvas: #f5f7fb; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); }
.gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.card, .panel { background: white; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 16px 50px rgba(16,24,40,.06); }
.card { width: min(440px, 100%); padding: 32px; }
.eyebrow { margin: 0; color: var(--brand); font-size: 12px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
h1 { margin: 8px 0; font-size: 32px; letter-spacing: -.04em; }
h2 { margin: 0 0 8px; font-size: 18px; }
.copy, .note, .empty { color: var(--muted); font-size: 14px; line-height: 1.5; }
.alert { border: 1px solid #f1c3b8; border-radius: 10px; background: #fff1ec; color: #963723; padding: 10px 12px; }
.google, .primary, .ghost, .tiny { border-radius: 10px; font-weight: 700; cursor: pointer; }
.google, .primary { display: inline-flex; justify-content: center; align-items: center; min-height: 44px; border: 0; background: var(--brand); color: white; text-decoration: none; padding: 0 16px; }
.google { width: 100%; margin-top: 18px; }
.ghost, .tiny { border: 1px solid var(--line); background: white; color: var(--ink); }
.ghost { min-height: 36px; padding: 0 12px; }
.tiny { min-height: 32px; padding: 0 10px; font-size: 12px; }
.app { padding: 28px clamp(16px, 4vw, 40px) 48px; }
.top, .top-actions, .dialog-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.top { margin-bottom: 22px; }
.layout { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 18px; align-items: start; }
.panel { padding: 18px; }
.panel label { display: grid; gap: 6px; margin: 12px 0; font-size: 13px; font-weight: 700; }
input { width: 100%; min-height: 42px; border: 1px solid #d6dbe5; border-radius: 10px; padding: 0 12px; font: inherit; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 12px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 14px; }
th { color: var(--muted); font-size: 12px; }
.owner small { display: block; color: var(--muted); }
.actions { display: flex; gap: 8px; justify-content: flex-end; }
.status { display: inline-flex; border-radius: 999px; padding: 3px 8px; background: #e8f7f0; color: #177a55; font-size: 12px; font-weight: 750; }
.status.is-suspended { background: #fff1ec; color: #963723; }
.dialog { width: min(420px, calc(100vw - 24px)); border: 0; border-radius: 16px; padding: 20px; }
.dialog::backdrop { background: rgba(23,32,51,.35); }
@media (max-width: 800px) { .layout, .top { grid-template-columns: 1fr; display: grid; } .top-actions { justify-content: flex-start; } }`;

const ADMIN_JS = `const apiBase = document.querySelector('meta[name="helixcer-api-base"]').content.replace(/\\/$/, "");
const gate = document.getElementById("gate");
const app = document.getElementById("app");
const alertBox = document.getElementById("alert");
const rows = document.getElementById("clientRows");
const empty = document.getElementById("emptyClients");
const createdNote = document.getElementById("createdNote");
const passwordDialog = document.getElementById("passwordDialog");
let passwordClientId = "";

function showAlert(message) {
  alertBox.hidden = !message;
  alertBox.textContent = message || "";
}

async function api(path, options) {
  const settings = options || {};
  const response = await fetch(apiBase + path, {
    method: settings.method || "GET",
    headers: { Accept: "application/json", ...(settings.body ? { "Content-Type": "application/json" } : {}) },
    body: settings.body ? JSON.stringify(settings.body) : undefined,
    credentials: "include"
  });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    const error = new Error(typeof payload.error === "string" ? payload.error : "Request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function loginHref() {
  const url = new URL("/auth/google/start", apiBase);
  url.searchParams.set("return_to", location.origin + "/");
  return url.toString();
}

function cell(text) {
  const item = document.createElement("td");
  item.textContent = text;
  return item;
}

function renderClients(items) {
  rows.replaceChildren();
  empty.hidden = items.length > 0;
  items.forEach(function (item) {
    const row = document.createElement("tr");
    row.append(cell(item.name));
    const owner = document.createElement("td");
    owner.className = "owner";
    owner.append(document.createTextNode(item.owner.displayName || "Owner"));
    const email = document.createElement("small");
    email.textContent = item.owner.email;
    owner.append(email);
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "status" + (item.status === "suspended" ? " is-suspended" : "");
    status.textContent = item.status;
    statusCell.append(status);
    const actions = document.createElement("td");
    actions.className = "actions";
    const toggle = document.createElement("button");
    toggle.className = "tiny";
    toggle.type = "button";
    toggle.textContent = item.status === "active" ? "Suspend" : "Activate";
    toggle.addEventListener("click", function () { changeStatus(item, toggle); });
    const reset = document.createElement("button");
    reset.className = "tiny";
    reset.type = "button";
    reset.textContent = "Reset password";
    reset.addEventListener("click", function () { openPassword(item); });
    actions.append(toggle, reset);
    row.append(owner, statusCell, actions);
    rows.append(row);
  });
}

async function refresh() {
  const data = await api("/api/platform/clients");
  renderClients(data.items || []);
}

async function changeStatus(item, button) {
  button.disabled = true;
  try {
    await api("/api/platform/clients/" + encodeURIComponent(item.workspaceId), {
      method: "PATCH",
      body: { status: item.status === "active" ? "suspended" : "active" }
    });
    await refresh();
  } catch (error) {
    showAlert(error.message);
  } finally {
    button.disabled = false;
  }
}

function openPassword(item) {
  passwordClientId = item.workspaceId;
  document.getElementById("passwordTarget").textContent = item.name + " · " + item.owner.email;
  document.getElementById("passwordForm").reset();
  passwordDialog.showModal();
}

async function boot() {
  document.getElementById("googleSignIn").href = loginHref();
  try {
    const me = await api("/api/platform/me");
    gate.hidden = true;
    app.hidden = false;
    document.getElementById("meLabel").textContent = me.user.email;
    await refresh();
  } catch (error) {
    gate.hidden = false;
    app.hidden = true;
    if (error.status === 403) showAlert("This Google account is not a Helixcer platform administrator.");
    else if (error.status !== 401) showAlert(error.message);
  }
}

document.getElementById("createClient").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  createdNote.hidden = true;
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const result = await api("/api/platform/clients", { method: "POST", body: data });
    createdNote.hidden = false;
    createdNote.textContent = result.item.name + " can sign in at https://chat.helixcer.com with " + result.item.owner.email + " and the password you entered.";
    form.reset();
    await refresh();
  } catch (error) {
    showAlert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("passwordForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  try {
    await api("/api/platform/clients/" + encodeURIComponent(passwordClientId), {
      method: "PATCH",
      body: { password: password }
    });
    passwordDialog.close();
  } catch (error) {
    showAlert(error.message);
  }
});

document.getElementById("passwordCancel").addEventListener("click", function () { passwordDialog.close(); });
document.getElementById("signOut").addEventListener("click", async function () {
  await api("/api/logout", { method: "POST", body: {} });
  location.href = "/";
});
boot();
`;

function textResponse(body, contentType) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function adminAsset(url) {
  if (url.hostname !== ADMIN_HOST) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/webhooks/')) return null;
  if (url.pathname === '/admin.css') return textResponse(ADMIN_CSS, 'text/css; charset=utf-8');
  if (url.pathname === '/admin.js') return textResponse(ADMIN_JS, 'text/javascript; charset=utf-8');
  if (url.pathname === '/' || url.pathname === '/index.html') return textResponse(ADMIN_HTML, 'text/html; charset=utf-8');
  return null;
}
