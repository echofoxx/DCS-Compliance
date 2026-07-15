/* User directory and assessment team/role administration. */
"use strict";

const ViewAdministration = (() => {
  const { el } = UI;

  async function render(root) {
    root.appendChild(el("div", { class: "view-head" }, el("div", {}, el("h1", {}, "Administration & Team"), el("p", { class: "view-sub" }, "Create accounts, assign system access, and staff the active assessment with role-based responsibilities."))));
    const status = el("div", { class: "card" }, "Loading administration data…"); root.appendChild(status);
    try {
      const rolesData = await Auth.request("/api/roles");
      status.remove();
      if (Auth.can("users.manage")) await renderUsers(root);
      if (Store.activeEvent() && Auth.can("assessment.team.manage")) await renderTeam(root, rolesData.roles);
      if (!Auth.can("users.manage") && !Auth.can("assessment.team.manage")) root.appendChild(UI.empty("No administration permission", "Your assessment role does not allow account or team administration."));
    } catch (error) { status.textContent = error.message; }
  }

  async function renderUsers(root) {
    const data = await Auth.request("/api/admin/users");
    const card = el("section", { class: "card" },
      el("div", { class: "card-head" }, el("div", {}, el("h2", { class: "card-title" }, "User Directory"), el("p", { class: "card-hint" }, `${data.users.length} accounts · temporary passwords require change at first sign-in`)),
        el("button", { class: "btn btn-primary", onclick: () => createUser(root) }, "+ Create User")),
      userTable(data.users, root));
    root.appendChild(card);
  }

  function userTable(users, root) {
    const table = el("table", { class: "data-table" });
    table.appendChild(el("thead", {}, el("tr", {}, ["User", "Organization / Title", "System Access", "Status", "Last Sign-in", "Actions"].map((h) => el("th", {}, h)))));
    const tbody = el("tbody");
    users.forEach((u) => tbody.appendChild(el("tr", {},
      el("td", {}, el("strong", {}, u.displayName), el("div", { class: "muted small" }, `${u.username}${u.email ? ` · ${u.email}` : ""}`)),
      el("td", {}, u.organization || "—", el("div", { class: "muted small" }, u.title || "")),
      el("td", {}, UI.badge(({ administrator: "Administrator", program_manager: "Program Manager", user: "Standard User" })[u.systemRole], u.systemRole === "administrator" ? "critical" : "info")),
      el("td", {}, UI.badge(u.status + (u.forcePasswordChange ? " · password change" : ""), u.status === "active" ? "good" : "muted")),
      el("td", {}, UI.fmtDate(u.lastLoginAt)),
      el("td", {}, el("div", { class: "row-actions" },
        el("button", { class: "btn btn-ghost small", onclick: () => editUser(u, root) }, "Edit"),
        el("button", { class: "btn btn-ghost small", onclick: () => resetPassword(u) }, "Reset password"))))));
    table.appendChild(tbody); return el("div", { class: "table-wrap" }, table);
  }

  function createUser() {
    const fields = userForm({ systemRole: "user", status: "active" }, true);
    UI.modal("Create user", fields.node, [{ label: "Cancel", onclick: () => {} }, { label: "Create user", primary: true, onclick: () => {
      Auth.request("/api/admin/users", { method: "POST", body: JSON.stringify(fields.value()) })
        .then(() => { UI.toast("User created. Assign them to an assessment team next."); App.refresh(); })
        .catch((e) => { UI.toast(e.message, "error"); createUser(); });
    } }]);
  }

  function editUser(user) {
    const fields = userForm(user, false);
    UI.modal(`Edit ${user.displayName}`, fields.node, [{ label: "Cancel", onclick: () => {} }, { label: "Save", primary: true, onclick: () => {
      Auth.request(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(fields.value()) })
        .then(() => { UI.toast("User updated."); App.refresh(); }).catch((e) => { UI.toast(e.message, "error"); editUser(user); });
    } }]);
  }

  function userForm(user, includePassword) {
    const username = UI.input({ value: user.username || "", disabled: !includePassword });
    const displayName = UI.input({ value: user.displayName || "" }); const email = UI.input({ type: "email", value: user.email || "" });
    const organization = UI.input({ value: user.organization || "" }); const title = UI.input({ value: user.title || "" });
    const systemRole = UI.select([{ value: "user", label: "Standard User" }, { value: "program_manager", label: "Program Manager" }, { value: "administrator", label: "System Administrator" }], user.systemRole || "user");
    const status = UI.select([{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }], user.status || "active");
    const temporaryPassword = includePassword ? UI.input({ type: "password", autocomplete: "new-password" }) : null;
    return { node: el("div", { class: "form-grid" }, UI.field("Username", username), UI.field("Display name", displayName), UI.field("Email", email), UI.field("Organization", organization), UI.field("Title / Position", title), UI.field("System access", systemRole), UI.field("Account status", status), includePassword ? UI.field("Temporary password", temporaryPassword, "12+ characters; uppercase, lowercase, number, and symbol.") : null), value: () => ({ username: username.value, displayName: displayName.value, email: email.value, organization: organization.value, title: title.value, systemRole: systemRole.value, status: status.value, temporaryPassword: temporaryPassword?.value }) };
  }

  function resetPassword(user) {
    const password = UI.input({ type: "password", autocomplete: "new-password" });
    UI.modal(`Reset password · ${user.displayName}`, UI.field("Temporary password", password, "The user must change it at next sign-in."), [{ label: "Cancel", onclick: () => {} }, { label: "Reset password", primary: true, onclick: () => {
      Auth.request(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: JSON.stringify({ temporaryPassword: password.value }) })
        .then(() => UI.toast("Password reset; existing sessions were ended.")).catch((e) => { UI.toast(e.message, "error"); resetPassword(user); });
    } }]);
  }

  async function renderTeam(root, roles) {
    const ev = Store.activeEvent();
    const [membersData, usersData] = await Promise.all([Auth.request(`/api/assessments/${ev.id}/members`), Auth.request(`/api/assessments/${ev.id}/candidates`)]);
    const card = el("section", { class: "card" },
      el("div", { class: "card-head" }, el("div", {}, el("h2", { class: "card-title" }, "Assessment Team"), el("p", { class: "card-hint" }, `${ev.name} · ${membersData.members.length} assigned`)),
        usersData.users.length ? el("button", { class: "btn btn-primary", onclick: () => assignMember(ev, usersData.users, roles) }, "+ Assign Member") : null),
      teamTable(ev, membersData.members, roles));
    root.appendChild(card);
  }

  function teamTable(ev, members, roles) {
    const list = el("div", { class: "team-grid" });
    members.forEach((m) => list.appendChild(el("article", { class: "team-card" },
      el("div", {}, el("strong", {}, m.displayName), el("div", { class: "muted small" }, `${m.organization || "No organization"}${m.title ? ` · ${m.title}` : ""}`)),
      el("div", {}, UI.badge(m.roleName, "info")),
      el("div", { class: "row-actions" },
        el("button", { class: "btn btn-ghost small", onclick: () => assignMember(ev, [m], roles, m) }, "Change role"),
        m.id !== Auth.user().id ? el("button", { class: "btn btn-danger-ghost small", onclick: () => UI.confirm("Remove team member", `Remove ${m.displayName} from this assessment?`, () => Auth.request(`/api/assessments/${ev.id}/members/${m.id}`, { method: "DELETE" }).then(() => { UI.toast("Team member removed."); App.refresh(); }).catch((e) => UI.toast(e.message, "error")), "Remove") }, "Remove") : null))));
    return list;
  }

  function assignMember(ev, users, roles, selectedMember = null) {
    const available = users.filter((u) => u.status === "active");
    const userSelect = UI.select(available.map((u) => ({ value: u.id, label: `${u.displayName} (${u.username})` })), selectedMember?.id || available[0]?.id, { disabled: !!selectedMember });
    const roleSelect = UI.select(roles.map((r) => ({ value: r.id, label: r.name })), selectedMember?.roleId || "dcs_control_assessor");
    const roleHelp = el("div", { class: "callout" }); const updateHelp = () => { const r = roles.find((x) => x.id === roleSelect.value); roleHelp.textContent = r ? `${r.description} Permissions: ${r.permissions.join(", ")}.` : ""; }; roleSelect.addEventListener("change", updateHelp); updateHelp();
    UI.modal(selectedMember ? "Change assessment role" : "Assign assessment member", el("div", { class: "form-stack" }, UI.field("User", userSelect), UI.field("Assessment role", roleSelect), roleHelp), [{ label: "Cancel", onclick: () => {} }, { label: "Save assignment", primary: true, onclick: () => {
      Auth.request(`/api/assessments/${ev.id}/members/${userSelect.value}`, { method: "PUT", body: JSON.stringify({ roleId: roleSelect.value }) }).then(() => { UI.toast("Assessment assignment saved."); App.refresh(); }).catch((e) => UI.toast(e.message, "error"));
    } }]);
  }

  return { render };
})();
