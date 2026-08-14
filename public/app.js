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
  el.className = "badge " + (ok ? "badge-ok" : "badge-muted");
  el.textContent = label || (ok ? "connected" : "disconnected");
}

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
    const patients = await api("GET", "/patients");
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
      item.innerHTML = `
        <div class="card-head">
          <strong>${esc(p.name)}</strong>
          <span class="badge badge-medium">${esc(p.membership_level || "—")}</span>
        </div>
        <dl class="kv">
          <dt>Phase</dt><dd>${esc(p.treatment_phase || "—")}</dd>
          <dt>Contact interval</dt><dd>${esc(p.expected_contact_interval_days)} days</dd>
          <dt>Goals</dt><dd>${esc(p.goals || "—")}</dd>
        </dl>
        <span class="detail-link" data-patient="${p.id}">details →</span>`;
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
      <dt>Contact interval</dt><dd>${esc(st.patient.expected_contact_interval_days)} days</dd>
      <dt>Days on hand</dt><dd>${esc(st.days_on_hand)}</dd>
      <dt>Next order by</dt><dd>${esc(fmtDate(st.next_order_by))}</dd>
      <dt>Last contact</dt><dd>${esc(fmtDate(st.last_encounter?.occurred_at))}</dd>
    </dl>
    <h3 class="section-title" style="margin-top:16px">Medications</h3>
    ${(st.medications || []).map((m) => `
      <div class="exception-item">
        <strong>${esc(m.name)}</strong> ${esc(m.dose || "")}
        <div class="muted small">
          exhausts ${esc(fmtDate(m.estimated_exhaustion_date))} · order by ${esc(fmtDate(m.order_by_date))}
          · quantity ${esc(m.quantity ?? "?")} · ${m.in_transit ? "in transit" : "on hand"}
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
  `;
  $("#patientModal").showModal();
}

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
        </dl>`;
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