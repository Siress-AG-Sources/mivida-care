/* MiVida Care — frontend app
 * Talks to the Worker API at /api/* (same origin).
 * Auth token + base URL stored in localStorage.
 */
const $ = (sel) => document.querySelector(sel);

const state = {
  baseUrl: localStorage.getItem("mivida_base_url") || "",
  token: localStorage.getItem("mivida_token") || "",
  patients: [],
};

function apiPath(p) {
  const base = state.baseUrl.replace(/\/$/, "");
  // If user set a base URL, use it as the origin; always append /api prefix.
  if (base) return base + "/api" + p;
  return "/api" + p;
}

async function api(method, path, body) {
  const res = await fetch(apiPath(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setConn(false, "auth failed");
    throw new Error("Unauthorized — check your token in Settings");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  setConn(true, "connected");
  return res.json();
}

function setConn(ok, label) {
  const el = $("#connStatus");
  el.className = "conn " + (ok ? "conn-ok" : "conn-off");
  const lbl = el.querySelector(".conn-label");
  if (lbl) lbl.textContent = label || (ok ? "online" : "offline");
}

// Brand logo → Overview
function goHome() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelector('.tab[data-view="dash"]').classList.add("active");
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-dash").classList.remove("hidden");
  loadDashboard();
}
$("#brandHome").addEventListener("click", goHome);
$("#brandHome").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); }
});

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 2600);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(d) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}

function fmtDateTime(d) {
  if (!d) return "—";
  const t = new Date(String(d).replace(" ", "T") + (String(d).endsWith("Z") ? "" : "Z"));
  return isNaN(t.getTime()) ? String(d) : t.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function medsTxt(meds) {
  if (!meds || meds.length === 0) return "—";
  return meds.map((m) => `${m.name} (${m.dose || "?"})`).join(", ");
}

// ---- Tabs ----
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("#view-" + tab.dataset.view).classList.remove("hidden");
    if (tab.dataset.view === "dash") loadDashboard();
    if (tab.dataset.view === "patients") loadPatients();
    if (tab.dataset.view === "exceptions") loadExceptions();
    if (tab.dataset.view === "refills") loadRefills();
  });
});

// ---- Dashboard ----
async function loadDashboard() {
  try {
    const [patients, exceptions] = await Promise.all([
      api("GET", "/patients"),
      api("GET", "/exceptions?unresolved=true"),
    ]);
    state.patients = patients;
    $("#statPatients").textContent = patients.length;
    const uniq = new Set(exceptions.map((e) => e.patient_id));
    $("#statExceptions").textContent = exceptions.length;
    $("#statRefills").textContent = "—";

    const board = $("#statusBoard");
    board.innerHTML = "";
    if (patients.length === 0) {
      board.innerHTML = `<div class="card muted">No patients yet.</div>`;
      return;
    }
    for (const p of patients) {
      const st = await api("GET", `/patients/${p.id}/status`);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <strong>${esc(st.patient.name)}</strong>
          <span class="detail-link" data-patient="${p.id}">details →</span>
        </div>
        <p>${esc(st.status_text)}</p>
        <div class="row" style="margin-top:8px">
          ${(st.unresolved_exceptions || []).map((e) =>
            `<span class="badge badge-${esc(e.severity)}">${esc(e.exception_type)}</span>`).join("")}
        </div>`;
      card.querySelector(".detail-link").addEventListener("click", () => openPatient(p.id));
      board.appendChild(card);
    }
  } catch (e) {
    $("#statusBoard").innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

// ---- Patients ----
async function loadPatients() {
  try {
    const showArchived = $("#showArchived")?.checked;
    const patients = await api("GET", "/patients" + (showArchived ? "?include_archived=1" : ""));
    state.patients = patients;
    const list = $("#patientsList");
    list.innerHTML = "";
    if (patients.length === 0) {
      list.innerHTML = `<div class="card muted">No patients yet.</div>`;
      return;
    }
    for (const p of patients) {
      const item = document.createElement("div");
      item.className = "card";
      if (p.archived) item.classList.add("is-archived");
      item.innerHTML = `
        <div class="card-head">
          <strong>${esc(p.name)}</strong>
          <span class="row">
            ${p.archived ? `<span class="badge badge-low">archived</span>` : ""}
            <span class="badge badge-medium">${esc(p.membership_level || "—")}</span>
          </span>
        </div>
        <dl class="kv">
          <dt>Phase</dt><dd>${esc(p.treatment_phase || "—")}</dd>
          <dt>Contact interval</dt><dd>${esc(p.expected_contact_interval_days)} days</dd>
          <dt>Insurance</dt><dd>${esc(p.insurance_info || "—")}</dd>
          <dt>Goals</dt><dd>${esc(p.goals || "—")}</dd>
        </dl>
        <div class="card-actions">
          <button class="btn btn-sm" data-edit="${p.id}">Edit</button>
          ${p.archived
            ? `<button class="btn btn-sm" data-unarchive="${p.id}">Restore</button>`
            : `<button class="btn btn-sm btn-danger" data-archive="${p.id}">Archive</button>`}
          <span class="detail-link" data-patient="${p.id}">details →</span>
        </div>`;
      item.querySelector(".detail-link").addEventListener("click", () => openPatient(p.id));
      list.appendChild(item);
    }
  } catch (e) {
    $("#patientsList").innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

async function openPatient(id) {
  const st = await api("GET", `/patients/${id}/status`);
  $("#patientName").textContent = st.patient.name;
  const box = $("#patientDetail");
  box.innerHTML = `
    <dl class="kv">
      <dt>Status</dt><dd>${esc(st.status_text)}</dd>
      <dt>Membership</dt><dd>${esc(st.patient.membership_level || "—")}</dd>
      <dt>Phase</dt><dd>${esc(st.patient.treatment_phase || "—")}</dd>
      <dt>Insurance</dt><dd>${esc(st.patient.insurance_info || "—")}</dd>
      <dt>Contact interval</dt><dd>${esc(st.patient.expected_contact_interval_days)} days</dd>
      <dt>Days on hand</dt><dd>${esc(st.days_on_hand)}</dd>
      <dt>Next order by</dt><dd>${esc(fmtDate(st.next_order_by))}</dd>
      <dt>Last contact</dt><dd>${esc(fmtDate(st.last_encounter?.occurred_at))}</dd>
    </dl>
    <h3 class="section-title" style="margin-top:16px">Medications</h3>
    ${(st.medications || []).map((m) => `
      <div class="exception-item" id="med-${m.id}">
        <strong>${esc(m.name)}</strong> ${esc(m.dose || "")}
        <div class="muted small">
          exhausts ${esc(fmtDate(m.estimated_exhaustion_date))} · order by ${esc(fmtDate(m.order_by_date))}
          · quantity ${esc(m.quantity ?? "?")} · ${m.in_transit ? "in transit" : "on hand"}
          ${m.confirmed_at ? `· confirmed ${esc(fmtDate(m.confirmed_at))}` : ""}
          ${!m.confirmed_at && m.in_transit ? `<button class="btn btn-sm btn-primary confirm-btn" style="margin-left:8px" data-pid="${st.patient.id}" data-mid="${m.id}">✓ Confirm receipt</button>` : ""}
        </div>
      </div>`).join("") || `<div class="muted">No medications.</div>`}
    <h3 class="section-title" style="margin-top:16px">Current cycle</h3>
    ${st.current_cycle ? `
      <div><strong>${esc(st.current_cycle.cycle_type || "—")}</strong>
      · ${esc(fmtDate(st.current_cycle.start_date))} → ${esc(fmtDate(st.current_cycle.end_date))}</div>
      <div class="muted small">${esc(st.current_cycle.what_comes_next || "")}</div>`
    : `<div class="muted">No active cycle.</div>`}
    <h3 class="section-title" style="margin-top:16px">Open refill prompts</h3>
    ${(st.open_refill_prompts || []).map((r) => `<div class="small">${esc(r.med_name)} — order by ${esc(fmtDate(r.order_by_date))}</div>`).join("") || `<div class="muted">None.</div>`}
    <h3 class="section-title" style="margin-top:16px">Open tasks</h3>
    ${(st.open_tasks || []).map((t) => `<div class="small">☐ ${esc(t.description)} (due ${esc(fmtDate(t.due_date))})</div>`).join("") || `<div class="muted">None.</div>`}

    <div class="card-head" style="margin-top:20px">
      <h3 class="section-title" style="margin-bottom:0">Call log</h3>
      <button class="btn btn-sm btn-primary" id="btnNewCall">+ Log a call</button>
    </div>
    ${callFormHtml(st.patient.id, st.medications || [])}
    <div id="callList" class="stack" style="margin-top:12px"></div>
  `;
  // showModal() throws InvalidStateError if the dialog is already open —
  // openPatient() is also used to refresh the view after logging a call.
  const dlg = $("#patientModal");
  if (!dlg.open) dlg.showModal();
  loadCalls(st.patient.id);
}

// ---- Call log ----
function callFormHtml(patientId, meds) {
  return `
  <div id="callForm" class="call-form hidden" data-patient="${patientId}">
    <label class="field"><span>When</span><input id="clWhen" type="datetime-local" /></label>
    <label class="field"><span>Direction</span>
      <select id="clDirection" class="field-input">
        <option value="outbound">Outbound — we called</option>
        <option value="inbound">Inbound — patient called</option>
      </select>
    </label>
    <label class="field"><span>Duration (minutes)</span><input id="clDuration" type="number" min="0" placeholder="optional" /></label>
    <label class="field"><span>Call notes</span><textarea id="clNotes" rows="4" placeholder="What was discussed, decisions made, what happens next."></textarea></label>
    <fieldset class="rx-picker">
      <legend>Prescriptions discussed</legend>
      ${meds.length
        ? meds.map((m) => `
          <label class="rx-option">
            <input type="checkbox" class="cl-med" value="${m.id}" />
            <span><strong>${esc(m.name)}</strong>${m.dose ? " " + esc(m.dose) : ""}</span>
          </label>`).join("")
        : `<p class="muted small">No prescriptions on file for this patient.</p>`}
    </fieldset>
    <div class="row-end">
      <button id="btnSaveCall" class="btn btn-primary">Save call</button>
    </div>
    <p id="clMsg" class="muted small"></p>
  </div>`;
}

async function loadCalls(patientId) {
  const box = $("#callList");
  if (!box) return;
  try {
    const calls = await api("GET", `/patients/${patientId}/calls`);
    if (!calls.length) {
      box.innerHTML = `<div class="muted small">No calls logged yet.</div>`;
      return;
    }
    box.innerHTML = calls.map((c) => `
      <div class="call-item">
        <div class="row">
          <span class="badge ${c.direction === "inbound" ? "badge-ok" : "badge-muted"}">${esc(c.direction)}</span>
          <span class="small"><strong>${esc(fmtDateTime(c.called_at))}</strong></span>
          ${c.duration_minutes ? `<span class="muted small">${esc(c.duration_minutes)} min</span>` : ""}
        </div>
        ${c.notes ? `<p class="small" style="margin-top:6px">${esc(c.notes)}</p>` : `<p class="muted small" style="margin-top:6px">No notes.</p>`}
        ${(c.medications || []).length
          ? `<div class="row" style="margin-top:8px">${c.medications.map((m) =>
              `<span class="badge badge-low">℞ ${esc(m.name)}${m.dose ? " " + esc(m.dose) : ""}</span>`).join("")}</div>`
          : ""}
      </div>`).join("");
  } catch (e) {
    box.innerHTML = `<div class="muted small">${esc(e.message)}</div>`;
  }
}

// Delegated: the form markup is rebuilt every time the modal opens.
$("#patientModal").addEventListener("click", async (e) => {
  if (e.target.closest("#btnNewCall")) {
    const form = $("#callForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      $("#clWhen").value = now.toISOString().slice(0, 16);
      $("#clNotes").focus();
    }
    return;
  }
  if (e.target.closest("#btnSaveCall")) {
    const form = $("#callForm");
    const patientId = Number(form.dataset.patient);
    const notes = $("#clNotes").value.trim();
    if (!notes) { $("#clMsg").textContent = "Please add a note describing the call."; return; }
    try {
      await api("POST", `/patients/${patientId}/calls`, {
        // Send an explicit UTC instant. A bare datetime-local value ("2026-08-19T10:10")
        // has no offset, so the Worker would read it as UTC and the call would come
        // back displayed hours off from what the doctor typed.
        called_at: $("#clWhen").value ? new Date($("#clWhen").value).toISOString() : null,
        direction: $("#clDirection").value,
        duration_minutes: Number($("#clDuration").value) || null,
        notes,
        medication_ids: [...document.querySelectorAll(".cl-med:checked")].map((el) => Number(el.value)),
      });
      toast("Call logged.");
      openPatient(patientId);
    } catch (err) {
      $("#clMsg").textContent = "Error: " + err.message;
    }
  }
});

// ---- Exceptions ----
async function loadExceptions() {
  try {
    const exceptions = await api("GET", "/exceptions?unresolved=true");
    const list = $("#exceptionsList");
    list.innerHTML = "";
    if (exceptions.length === 0) {
      list.innerHTML = `<div class="card muted">No unresolved exceptions. All clear.</div>`;
      return;
    }
    for (const e of exceptions) {
      const item = document.createElement("div");
      item.className = `card exception-item ${esc(e.severity)}`;
      item.innerHTML = `
        <div class="row">
          <span class="badge badge-${esc(e.severity)}">${esc(e.severity)}</span>
          <strong>${esc(e.exception_type.replace(/_/g, " "))}</strong>
          <span class="muted small">${esc(e.patient_name)}</span>
        </div>
        <p class="muted small" style="margin-top:4px">${esc(e.details || "")}</p>`;
      list.appendChild(item);
    }
  } catch (e) {
    $("#exceptionsList").innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

$("#btnRunMonitor").addEventListener("click", async () => {
  try {
    const r = await api("POST", "/exceptions/run");
    toast(`Exception monitor ran: ${r.generated} new`);
    loadExceptions();
  } catch (e) {
    toast(e.message);
  }
});

// ---- Refills ----
async function loadRefills() {
  try {
    const refills = await api("GET", "/refill-prompts");
    const list = $("#refillsList");
    list.innerHTML = "";
    if (refills.length === 0) {
      list.innerHTML = `<div class="card muted">No refill prompts generated yet.</div>`;
      return;
    }
    for (const r of refills) {
      const item = document.createElement("div");
      item.className = "card refill-item";
      item.innerHTML = `
        <div class="row">
          <strong>${esc(r.med_name)}</strong>
          <span class="badge badge-${r.status === "completed" ? "ok" : "medium"}">${esc(r.status)}</span>
          <span class="muted small">${esc(r.patient_name)}</span>
        </div>
        <dl class="kv" style="margin-top:8px">
          <dt>Dose</dt><dd>${esc(r.current_dose || "—")}</dd>
          <dt>Quantity</dt><dd>${esc(r.quantity_needed ?? "—")}</dd>
          <dt>Exhausts</dt><dd>${esc(fmtDate(r.estimated_exhaustion_date))}</dd>
          <dt>Order by</dt><dd>${esc(fmtDate(r.order_by_date))}</dd>
          <dt>Delivery</dt><dd>${esc(r.delivery_notes || "—")}</dd>
        </dl>
        ${r.status !== "completed" ? `<button class="btn btn-sm btn-primary refill-complete" data-id="${r.id}" style="margin-top:4px">✔ Mark completed</button>` : `<div class="muted small" style="margin-top:4px">✓ Completed ${r.completed_at ? esc(fmtDate(r.completed_at)) : ""}</div>`}`;
      list.appendChild(item);
    }
  } catch (e) {
    $("#refillsList").innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

// ---- Settings ----
$("#btnSettings").addEventListener("click", () => {
  $("#setBaseUrl").value = state.baseUrl;
  $("#setToken").value = state.token;
  $("#settingsMsg").textContent = "";
  $("#settingsModal").showModal();
});

$("#btnSaveSettings").addEventListener("click", () => {
  state.baseUrl = $("#setBaseUrl").value.trim();
  state.token = $("#setToken").value.trim();
  localStorage.setItem("mivida_base_url", state.baseUrl);
  localStorage.setItem("mivida_token", state.token);
  $("#settingsMsg").textContent = "Saved. Reloading…";
  setTimeout(() => {
    $("#settingsModal").close();
    loadDashboard();
  }, 300);
});

// ---- Feedback panel (right slide-out) ----
(function () {
  const panel = $("#feedbackPanel");
  const toggle = $("#feedbackToggle");
  const close = $("#feedbackClose");
  const btnSubmit = $("#btnSubmitFeedback");
  const msg = $("#feedbackMsg");

  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    panel.classList.toggle("closed");
    if (panel.classList.contains("open")) loadFeedback();
  });
  close.addEventListener("click", () => {
    panel.classList.add("closed");
    panel.classList.remove("open");
  });

  btnSubmit.addEventListener("click", async () => {
    const body = $("#fbBody").value.trim();
    if (!body) { toast("Please enter your feedback."); return; }
    try {
      await api("POST", "/feedback", {
        submitted_by: $("#fbSubmittedBy").value.trim() || "anonymous",
        category: $("#fbCategory").value,
        body,
      });
      $("#fbBody").value = "";
      msg.textContent = "✓ Submitted — thanks!";
      setTimeout(() => (msg.textContent = ""), 3000);
      loadFeedback();
    } catch (e) {
      msg.textContent = "Error: " + e.message;
    }
  });

  async function loadFeedback() {
    try {
      const items = await api("GET", "/feedback");
      const list = $("#feedbackList");
      list.innerHTML = "";
      if (items.length === 0) {
        list.innerHTML = `<div class="muted small">No feedback yet. Be the first.</div>`;
        return;
      }
      for (const f of items) {
        const div = document.createElement("div");
        div.className = "feedback-item";
        const catLabel = f.category?.replace(/_/g, " ") || "idea";
        div.innerHTML = `
          <div class="row" style="margin-bottom:4px">
            <span class="badge badge-low">${esc(catLabel)}</span>
            <strong style="font-size:13px">${esc(f.body)}</strong>
          </div>
          <div class="muted small">${esc(f.submitted_by || "anonymous")} · ${esc(fmtDate(f.created_at))} · <span class="badge badge-muted">${esc(f.status)}</span></div>`;
        list.appendChild(div);
      }
    } catch (e) {
      $("#feedbackList").innerHTML = `<div class="muted small">${esc(e.message)}</div>`;
    }
  }
})();

// ---- Init ----
(function init() {
  loadDashboard();
  loadDeployCount();
})();

// ---- What's New (deploy events) ----
let lastDeploySeen = localStorage.getItem("mivida_last_deploy_id") || "0";

async function loadDeployCount() {
  try {
    const events = await api("GET", "/deploy-events?limit=5");
    const count = events.filter((e) => e.id > Number(lastDeploySeen)).length;
    const badge = $("#deployCount");
    if (count > 0) {
      badge.textContent = count;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch (_) { /* silently ignore */ }
}

async function loadDeployEvents() {
  try {
    const events = await api("GET", "/deploy-events?limit=20");
    const list = $("#deployEventsList");
    if (events.length === 0) {
      list.innerHTML = `<div class="muted small">No updates yet. Push code to see them here!</div>`;
      return;
    }
    list.innerHTML = events
      .map((e) => {
        const isNew = e.id > Number(lastDeploySeen);
        return `<div class="card"${isNew ? ' style="border-left:3px solid var(--orange)"' : ""}>
          <div class="row" style="margin-bottom:4px">
            <strong>${esc(e.summary)}</strong>
            ${isNew ? '<span class="badge badge-medium" style="font-size:10px">NEW</span>' : ""}
            <span class="muted small">${esc(e.deployed_by)}</span>
          </div>
          <div class="muted small">
            ${esc(fmtDate(e.created_at))}
            ${e.version ? '· <code style="font-size:11px">' + esc(e.version.slice(0, 7)) + "</code>" : ""}
            ${e.live_url ? '· <a href="' + esc(e.live_url) + '" target="_blank" style="color:var(--orange)">view site →</a>' : ""}
          </div>
        </div>`;
      })
      .join("");
    // Mark seen
    if (events.length > 0) {
      lastDeploySeen = String(events[0].id);
      localStorage.setItem("mivida_last_deploy_id", lastDeploySeen);
      loadDeployCount();
    }
  } catch (e) {
    $("#deployEventsList").innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }
}

$("#btnWhatsNew").addEventListener("click", () => {
  loadDeployEvents();
  $("#whatsNewModal").showModal();
});

// ---- Add patient (intake form) ----
$("#btnAddPatient").addEventListener("click", () => {
  $("#apMsg").textContent = "";
  document.querySelectorAll("#addPatientModal input, #addPatientModal textarea, #addPatientModal select").forEach((el) => {
    if (el.id !== "apInterval") el.value = "";
  });
  $("#apInterval").value = "30";
  $("#addPatientModal").showModal();
});

$("#btnSavePatient").addEventListener("click", async () => {
  const name = $("#apName").value.trim();
  if (!name) { $("#apMsg").textContent = "Name is required."; return; }
  try {
    await api("POST", "/patients", {
      name,
      date_of_birth: $("#apDob").value || null,
      email: $("#apEmail").value.trim() || null,
      phone: $("#apPhone").value.trim() || null,
      address: $("#apAddress").value.trim() || null,
      insurance_info: $("#apInsurance").value.trim() || null,
      membership_level: $("#apMembership").value || null,
      treatment_phase: $("#apPhase").value || null,
      expected_contact_interval_days: Number($("#apInterval").value) || 30,
      goals: $("#apGoals").value.trim() || null,
    });
    $("#addPatientModal").close();
    toast("Patient added!");
    loadPatients();
  } catch (e) {
    $("#apMsg").textContent = "Error: " + e.message;
  }
});

// ---- Confirm receipt (delegated click on patient modal) ----
$("#patientModal").addEventListener("click", async (e) => {
  const btn = e.target.closest(".confirm-btn");
  if (!btn) return;
  const pid = btn.dataset.pid;
  const mid = btn.dataset.mid;
  btn.disabled = true;
  btn.textContent = "Confirming...";
  try {
    await api("PATCH", `/patients/${pid}/medications/${mid}/confirm`);
    toast("Receipt confirmed!");
    openPatient(Number(pid)); // refresh detail view
  } catch (err) {
    toast("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = "✓ Confirm receipt";
  }
});

// ---- Refill complete button (delegated) ----
$("#refillsList").addEventListener("click", async (e) => {
  const btn = e.target.closest(".refill-complete");
  if (!btn) return;
  const id = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = "Marking...";
  try {
    await api("PATCH", "/refill-prompts/" + id, { status: "completed" });
    toast("Refill marked complete!");
    loadRefills();
  } catch (err) {
    toast("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = "✔ Mark completed";
  }
});

// ---- Admin console ----
let adminToken = localStorage.getItem("mivida_admin_token") || "";

function setAdminTabState(unlocked) {
  const tab = document.querySelector(".tab-admin");
  if (unlocked) {
    tab.style.color = "#34d17b";
    tab.style.fontWeight = "700";
  } else {
    tab.style.color = "";
    tab.style.fontWeight = "";
  }
}

async function adminFetch(path) {
  const url = "/api/admin" + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(adminToken ? { Authorization: "Bearer " + adminToken } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) throw new Error("Invalid admin token");
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || ("HTTP " + res.status));
    }
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    const msg = e.name === "AbortError" ? "Request timed out" : (e.message || "Connection failed");
    throw new Error(msg);
  }
}

async function adminPatch(path, body) {
  const url = "/api/admin" + path;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { Authorization: "Bearer " + adminToken } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("Invalid admin token");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || ("HTTP " + res.status));
  }
  return res.json();
}

async function loadAdminStats() {
  try {
    const stats = await adminFetch("/stats");
    const box = $("#adminStats");
    let html = `<div class="card stat-card"><p class="stat-label">Total feedback</p><p class="stat-value">${stats.total}</p></div>`;
    if (stats.by_status) {
      for (const s of stats.by_status) {
        html += `<div class="card stat-card"><p class="stat-label">${esc(s.status || "?")}</p><p class="stat-value">${s.n}</p></div>`;
      }
    }
    box.innerHTML = html;
  } catch (e) {
    $("#adminStats").innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }
}

async function loadAdminFeedback() {
  try {
    const status = $("#adminFilterStatus").value;
    const category = $("#adminFilterCategory").value;
    let path = "/feedback";
    const qs = [];
    if (status) qs.push("status=" + encodeURIComponent(status));
    if (category) qs.push("category=" + encodeURIComponent(category));
    if (qs.length) path += "?" + qs.join("&");
    const items = await adminFetch(path);
    const list = $("#adminFeedbackList");
    if (!items || items.length === 0) {
      list.innerHTML = `<div class="card muted">No feedback matches the filter.</div>`;
      return;
    }
    list.innerHTML = items.map((f) => {
      const isNew = f.status === "new";
      const notes = f.notes || "";
      const hasGh = notes.indexOf("GitHub:") !== -1;
      const ghUrl = hasGh ? notes.split("GitHub: ")[1]?.split("\n")[0] : null;
      return `<div class="card"${isNew ? ' style="border-left:3px solid var(--orange)"' : ""}>
        <div class="row" style="margin-bottom:4px">
          <span class="badge badge-low">${esc(f.category || "idea")}</span>
          <strong>${esc(f.body)}</strong>
          <span class="badge badge-${f.status === "done" ? "ok" : f.status === "new" ? "medium" : "muted"}">${esc(f.status)}</span>
        </div>
        <div class="muted small" style="margin-bottom:8px">
          ${esc(f.submitted_by || "anonymous")} · ${fmtDate(f.created_at)}
          ${ghUrl ? `· <a href="${esc(ghUrl)}" target="_blank" style="color:var(--orange)">GitHub ↗</a>` : ""}
        </div>
        ${notes && !hasGh ? `<div class="muted small" style="margin-bottom:4px">📝 ${esc(notes)}</div>` : ""}
        <div class="row" style="gap:4px">
          ${f.status !== "in_progress" && f.status !== "done" && f.status !== "declined" ? `<button class="btn btn-primary btn-sm admin-approve" data-id="${f.id}">✅ Approve</button>` : ""}
          ${f.status !== "done" && f.status !== "declined" ? `<button class="btn btn-sm admin-done" data-id="${f.id}" style="background:#2e8b57;color:#fff;border-color:#2e8b57">✔ Done</button>` : ""}
          ${f.status !== "declined" ? `<button class="btn btn-sm admin-decline" data-id="${f.id}" style="background:#cf2e2e;color:#fff;border-color:#cf2e2e">✕ Decline</button>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    $("#adminFeedbackList").innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }
}

async function adminAction(id, action, status) {
  try {
    const body = { status };
    if (action === "approve") body.action = "approve";
    await adminPatch("/feedback/" + id, body);
    toast(action === "approve" ? "Approved! GitHub issue created." : "Updated!");
    loadAdminStats();
    loadAdminFeedback();
  } catch (e) {
    toast("Error: " + e.message);
  }
}

$("#adminFeedbackList").addEventListener("click", (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains("admin-approve")) adminAction(id, "approve", "in_progress");
  else if (e.target.classList.contains("admin-done")) adminAction(id, "done", "done");
  else if (e.target.classList.contains("admin-decline")) adminAction(id, "decline", "declined");
});

$("#btnAdminLogin").addEventListener("click", async () => {
  const token = $("#adminTokenInput").value.trim();
  if (!token) { $("#adminLoginMsg").textContent = "Enter the admin token."; return; }
  $("#btnAdminLogin").disabled = true;
  $("#btnAdminLogin").textContent = "Verifying...";
  $("#adminLoginMsg").textContent = "";

  adminToken = token;
  try {
    const stats = await adminFetch("/stats");
    localStorage.setItem("mivida_admin_token", token);
    setAdminTabState(true);
    $("#adminLogin").classList.add("hidden");
    $("#adminPanel").classList.remove("hidden");
    loadAdminStats();
    loadAdminFeedback();
  } catch (e) {
    adminToken = "";
    setAdminTabState(false);
    $("#adminLoginMsg").textContent = e.message || "Connection failed";
    $("#btnAdminLogin").disabled = false;
    $("#btnAdminLogin").textContent = "Unlock";
  }
});

// ---- Filters ----

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "admin" && adminToken) {
      $("#adminLogin").classList.add("hidden");
      $("#adminPanel").classList.remove("hidden");
      loadAdminStats();
      loadAdminFeedback();
    }
  });
});

$("#adminFilterStatus").addEventListener("change", loadAdminFeedback);
$("#adminFilterCategory").addEventListener("change", loadAdminFeedback);

// Restore admin state on page load
if (adminToken) setAdminTabState(true);

// ---- 90-day unseen patients ----
async function loadUnseen() {
  try {
    const patients = await api("GET", "/patients/unseen/90");
    const list = $("#unseenList");
    if (patients.length === 0) {
      list.innerHTML = `<div class="card muted">All patients seen within 90 days. Great!</div>`;
      return;
    }
    list.innerHTML = patients.map((p) => {
      const days = p.last_encounter
        ? Math.floor((Date.now() - new Date(p.last_encounter).getTime()) / 86400000)
        : "never";
      return `<div class="card">
        <div class="row" style="margin-bottom:4px">
          <strong>${esc(p.name)}</strong>
          <span class="badge badge-medium">${days} days</span>
          <span class="muted small">${esc(p.membership_level || "—")}</span>
        </div>
        <div class="muted small">
          Last contact: ${esc(fmtDate(p.last_encounter) || "never")}
          · ${esc(p.phone || "no phone")}
          · ${esc(p.email || "—")}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    $("#unseenList").innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }
}
$("#btnUnseen").addEventListener("click", loadUnseen);

// ---- Prescribing view ----
async function loadPrescribing() {
  try {
    const data = await api("GET", "/prescribing");
    const list = $("#prescribingList");
    if (!data || data.length === 0) {
      list.innerHTML = `<div class="card muted">No active prescriptions.</div>`;
      return;
    }
    list.innerHTML = data.map((p) => {
      const meds = (p.medications || []).map((m) => {
        const days = m.estimated_exhaustion_date
          ? Math.floor((new Date(m.estimated_exhaustion_date).getTime() - Date.now()) / 86400000)
          : null;
        return `<div class="exception-item" style="margin-bottom:4px">
          <strong>${esc(m.name)}</strong> ${esc(m.dose || "")}
          <span class="muted small">
            ${m.quantity ? `· qty ${m.quantity}` : ""}
            ${days !== null ? `· ${days} days left` : ""}
            ${m.in_transit ? "· in transit" : ""}
            ${m.confirmed_at ? "· confirmed" : m.in_transit ? "· unconfirmed" : ""}
          </span>
        </div>`;
      }).join("");
      return `<div class="card">
        <div class="card-head" style="margin-bottom:8px">
          <strong>${esc(p.patient_name)}</strong>
          <span class="badge badge-low">${esc(p.membership_level || "—")}</span>
        </div>
        ${meds}
      </div>`;
    }).join("");
  } catch (e) {
    $("#prescribingList").innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }
}

// ---- Archive / restore ----
// Archive rather than delete: call_log rows cascade on delete, so a hard delete
// would destroy contact history. Archived patients drop out of the active lists
// and the status board, and can be restored at any time.
async function archivePatient(id) {
  const p = state.patients.find((x) => x.id === id);
  if (!confirm(`Archive ${p ? p.name : "this patient"}?\n\nThey are hidden from the patient list, the status board and the exception monitor, but nothing is deleted and you can restore them from "Show archived".`)) return;
  try {
    await api("PATCH", `/patients/${id}/archive`);
    toast("Patient archived.");
    await loadPatients();
    loadDashboard();
  } catch (e) {
    toast("Error: " + e.message);
  }
}

async function unarchivePatient(id) {
  try {
    await api("PATCH", `/patients/${id}/unarchive`);
    toast("Patient restored.");
    await loadPatients();
    loadDashboard();
  } catch (e) {
    toast("Error: " + e.message);
  }
}

// ---- Edit patient ----
const EDIT_FIELDS = [
  ["epName", "name"],
  ["epDob", "date_of_birth"],
  ["epEmail", "email"],
  ["epPhone", "phone"],
  ["epAddress", "address"],
  ["epInsurance", "insurance_info"],
  ["epMembership", "membership_level"],
  ["epPhase", "treatment_phase"],
  ["epInterval", "expected_contact_interval_days"],
  ["epGoals", "goals"],
];
let editingPatientId = null;

// Existing records hold values the picker doesn't offer (e.g. membership
// "intensive", phase "recovery"). Setting an unknown value on a <select> is a
// silent no-op that leaves it blank — and saving would then wipe the field — so
// carry the current value in as an option instead.
function setSelectValue(el, value) {
  const v = value ?? "";
  if (v && ![...el.options].some((o) => o.value === v)) {
    el.add(new Option(v + " (current)", v), 1);
  }
  el.value = v;
}

async function openEditPatient(id) {
  try {
    // Read the full row, not the status projection, so no field round-trips blank.
    const p = await api("GET", `/patients/${id}`);
    editingPatientId = id;
    $("#epMsg").textContent = "";
    for (const [el, key] of EDIT_FIELDS) {
      const node = $("#" + el);
      if (node.tagName === "SELECT") setSelectValue(node, p[key]);
      else node.value = p[key] ?? "";
    }
    $("#editPatientModal").showModal();
  } catch (e) {
    toast("Error: " + e.message);
  }
}

$("#btnUpdatePatient").addEventListener("click", async () => {
  const name = $("#epName").value.trim();
  if (!name) { $("#epMsg").textContent = "Name is required."; return; }
  const body = {
    name,
    date_of_birth: $("#epDob").value || null,
    email: $("#epEmail").value.trim() || null,
    phone: $("#epPhone").value.trim() || null,
    address: $("#epAddress").value.trim() || null,
    insurance_info: $("#epInsurance").value.trim() || null,
    membership_level: $("#epMembership").value || null,
    treatment_phase: $("#epPhase").value || null,
    expected_contact_interval_days: Number($("#epInterval").value) || 30,
    goals: $("#epGoals").value.trim() || null,
  };
  try {
    await api("PATCH", `/patients/${editingPatientId}`, body);
    $("#editPatientModal").close();
    toast("Patient updated.");
    await loadPatients();
    loadDashboard();
  } catch (e) {
    $("#epMsg").textContent = "Error: " + e.message;
  }
});

// Delegated actions on the patient cards
$("#patientsList").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return openEditPatient(Number(edit.dataset.edit));
  const arch = e.target.closest("[data-archive]");
  if (arch) return archivePatient(Number(arch.dataset.archive));
  const un = e.target.closest("[data-unarchive]");
  if (un) return unarchivePatient(Number(un.dataset.unarchive));
});

$("#showArchived").addEventListener("change", loadPatients);

// Hook up tab switching for new tabs
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "unseen") loadUnseen();
    if (tab.dataset.view === "prescribing") loadPrescribing();
  });
});