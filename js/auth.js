/* DCS authenticated session, CSRF protection, login, and permission context. */
"use strict";

const Auth = (() => {
  let session = null;
  let access = {};

  async function request(path, options = {}) {
    const headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (session?.csrfToken && !["GET", "HEAD"].includes(String(options.method || "GET").toUpperCase())) headers["X-CSRF-Token"] = session.csrfToken;
    const response = await fetch(path, Object.assign({ credentials: "same-origin", headers }, options));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status; error.code = payload.code; error.payload = payload;
      if (response.status === 401 && !path.includes("/login")) { session = null; renderLogin("Your session ended. Sign in again."); }
      throw error;
    }
    return payload;
  }

  async function init() {
    try {
      session = await request("/api/auth/session");
      return true;
    } catch (error) {
      if (error.status !== 401) renderLogin("The application server is unavailable. Start the Docker deployment and try again.");
      else renderLogin();
      return false;
    }
  }

  function renderLogin(message = "") {
    const root = document.getElementById("app");
    document.body.classList.add("auth-screen");
    const box = document.createElement("main"); box.className = "login-shell";
    box.innerHTML = `<section class="login-brand"><div class="login-mark">DCS</div><div><h1>DCS Assessment Command Center</h1><p>Plan, execute, score, evidence, review, and report Data-Centric Security assessments.</p></div></section>
      <section class="login-card"><div><span class="eyebrow">AUTHORIZED ACCESS</span><h2>Sign in</h2><p class="login-hint">Use the account assigned by your assessment administrator.</p></div>
      <form id="login-form"><label class="field"><span class="field-label">Username</span><input class="input" name="username" autocomplete="username" required autofocus></label>
      <label class="field"><span class="field-label">Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
      <div id="login-error" class="form-error" role="alert">${UI.esc(message)}</div><button class="btn btn-primary login-submit" type="submit">Sign in</button></form>
      <p class="login-notice">Access is logged. Use only for authorized assessment activity and handle information according to its classification.</p></section>`;
    root.replaceChildren(box);
    const form = box.querySelector("#login-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button"); const errorNode = form.querySelector("#login-error");
      button.disabled = true; button.textContent = "Signing in…"; errorNode.textContent = "";
      try {
        session = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: form.username.value, password: form.password.value }) });
        window.location.reload();
      } catch (error) { errorNode.textContent = error.message; }
      finally { button.disabled = false; button.textContent = "Sign in"; }
    });
  }

  function setAccess(value) { access = value || {}; }
  const user = () => session?.user || null;
  const csrfToken = () => session?.csrfToken || "";
  const globalPermissions = () => session?.globalPermissions || [];
  const feature = (name) => session?.features?.[name];
  const assessmentAccess = (id) => access[id] || { permissions: [], canWrite: false, roleId: null };
  function can(permission, assessmentId) {
    if (globalPermissions().includes(permission)) return true;
    const id = assessmentId || (typeof Store !== "undefined" ? Store.activeEvent()?.id : null);
    return !!id && assessmentAccess(id).permissions.includes(permission);
  }
  function canWrite(assessmentId) {
    if (user()?.systemRole === "administrator") return true;
    const id = assessmentId || (typeof Store !== "undefined" ? Store.activeEvent()?.id : null);
    return !!id && assessmentAccess(id).canWrite;
  }

  async function logout() {
    try { await request("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {}
    session = null; access = {}; window.location.reload();
  }

  function changePasswordModal(required = false, initialError = "") {
    const current = UI.input({ type: "password", autocomplete: "current-password" });
    const next = UI.input({ type: "password", autocomplete: "new-password" });
    const confirm = UI.input({ type: "password", autocomplete: "new-password" });
    const error = UI.el("div", { class: "form-error" }, initialError);
    const body = UI.el("div", { class: "form-stack" },
      required ? UI.el("div", { class: "callout callout-warn" }, "You are using a temporary/bootstrap password. Change it before modifying assessment data.") : null,
      UI.field("Current password", current), UI.field("New password", next, "At least 12 characters with uppercase, lowercase, number, and symbol."),
      UI.field("Confirm new password", confirm), error);
    UI.modal("Change password", body, [
      ...(!required ? [{ label: "Cancel", onclick: () => {} }] : []),
      { label: "Update password", primary: true, onclick: () => {
        if (next.value !== confirm.value) { error.textContent = "New passwords do not match."; return false; }
        request("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }) })
          .then(() => { session.user.forcePasswordChange = false; window.location.reload(); })
          .catch((e) => { changePasswordModal(required, e.message); });
      } }
    ]);
  }

  return { init, request, user, csrfToken, globalPermissions, feature, setAccess, assessmentAccess, can, canWrite, logout, renderLogin, changePasswordModal };
})();
