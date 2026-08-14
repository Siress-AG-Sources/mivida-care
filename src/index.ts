/**
 * MiVida Care — Cloudflare Worker API + static frontend
 * Administrative coordinator only: the AI never prescribes, never doses,
 * never submits pharmacy orders. It recognizes when a refill/new order is
 * needed and produces a prompt the provider executes manually.
 *
 * Stack: Hono on Workers, D1 for storage, Workers static assets for the UI.
 * Routes: /api/* → API, everything else → static frontend.
 */
import { Hono } from "hono";
import type { ExecutionContext } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Env = {
  DB: D1Database;
  MIVIDA_AUTH_TOKEN: string; // bearer token for API access
  ENVIRONMENT: string; // dev | production
};

type Patient = {
  id: number;
  name: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  membership_level: string | null;
  goals: string | null;
  treatment_phase: string | null;
  expected_contact_interval_days: number;
};

type Medication = {
  id: number;
  patient_id: number;
  name: string;
  dose: string | null;
  quantity: number | null;
  refill_quantity: number | null;
  start_date: string | null;
  estimated_exhaustion_date: string | null;
  order_by_date: string | null;
  in_transit: number | boolean;
  delivery_notes: string | null;
};

type Cycle = {
  id: number;
  patient_id: number;
  cycle_type: string | null;
  start_date: string | null;
  end_date: string | null;
  what_comes_next: string | null;
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// CORS (for the static UI on Pages or local dev)
app.use("*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
});

// Simple bearer auth gate (skips health/debug)
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const path = new URL(c.req.url).pathname;
  if (path === "/health" || path === "/debug") return next();
  const expected = c.env.MIVIDA_AUTH_TOKEN;
  const auth = c.req.header("Authorization") || "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

// Health check (no auth required — useful for debugging binding issues)
app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// Debug: dump all env keys (excludes values) to diagnose secret binding
app.get("/debug", (c) => {
  const keys = Object.keys(c.env).filter((k) => k !== "MIVIDA_AUTH_TOKEN");
  const hasToken = typeof c.env.MIVIDA_AUTH_TOKEN === "string" && c.env.MIVIDA_AUTH_TOKEN.length > 0;
  return c.json({ keys, hasToken, tokenLength: hasToken ? c.env.MIVIDA_AUTH_TOKEN.length : 0 });
});

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

app.get("/patients", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM patients ORDER BY name"
  ).all();
  return c.json(results);
});

app.get("/patients/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const patient = await c.env.DB.prepare(
    "SELECT * FROM patients WHERE id = ?"
  ).bind(id).first();
  if (!patient) return c.json({ error: "not found" }, 404);
  return c.json(patient);
});

app.post("/patients", async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    `INSERT INTO patients
      (name, date_of_birth, phone, address, email, membership_level, goals,
       treatment_phase, expected_contact_interval_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.name,
      body.date_of_birth || null,
      body.phone || null,
      body.address || null,
      body.email || null,
      body.membership_level || null,
      body.goals || null,
      body.treatment_phase || null,
      body.expected_contact_interval_days || 30
    )
    .run();
  await audit(c, "system", "patient.create", "patients", result.meta.last_row_id, null, body);
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch("/patients/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const current = await c.env.DB.prepare("SELECT * FROM patients WHERE id = ?")
    .bind(id)
    .first();
  if (!current) return c.json({ error: "not found" }, 404);
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(
    `UPDATE patients SET ${assignments}, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(...values, id)
    .run();
  await audit(c, "system", "patient.update", "patients", id, current, body);
  const updated = await c.env.DB.prepare("SELECT * FROM patients WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

app.get("/patients/:id/medications", async (c) => {
  const id = Number(c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM medications WHERE patient_id = ? ORDER BY id DESC"
  )
    .bind(id)
    .all();
  return c.json(results);
});

app.post("/patients/:id/medications", async (c) => {
  const patientId = Number(c.req.param("id"));
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    `INSERT INTO medications
      (patient_id, name, dose, quantity, refill_quantity, start_date,
       estimated_exhaustion_date, order_by_date, in_transit, delivery_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      patientId,
      body.name,
      body.dose || null,
      body.quantity || null,
      body.refill_quantity || null,
      body.start_date || null,
      body.estimated_exhaustion_date || null,
      body.order_by_date || null,
      body.in_transit ? 1 : 0,
      body.delivery_notes || null
    )
    .run();
  await audit(c, "system", "medication.create", "medications", result.meta.last_row_id, null, body);
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch("/medications/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(
    `UPDATE medications SET ${assignments}, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM medications WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

app.get("/patients/:id/cycles", async (c) => {
  const id = Number(c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM cycles WHERE patient_id = ? ORDER BY start_date DESC"
  )
    .bind(id)
    .all();
  return c.json(results);
});

app.post("/patients/:id/cycles", async (c) => {
  const patientId = Number(c.req.param("id"));
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    `INSERT INTO cycles (patient_id, cycle_type, start_date, end_date, what_comes_next)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      patientId,
      body.cycle_type || null,
      body.start_date || null,
      body.end_date || null,
      body.what_comes_next || null
    )
    .run();
  await audit(c, "system", "cycle.create", "cycles", result.meta.last_row_id, null, body);
  return c.json({ id: result.meta.last_row_id }, 201);
});

// ---------------------------------------------------------------------------
// Encounters (the four questions)
// ---------------------------------------------------------------------------

app.post("/patients/:id/encounters", async (c) => {
  const patientId = Number(c.req.param("id"));
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    `INSERT INTO encounters
      (patient_id, occurred_at, q1_who, q2_what_happened, q3_workflow,
       q4_question, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      patientId,
      body.occurred_at || new Date().toISOString().slice(0, 19).replace("T", " "),
      body.q1_who || null,
      body.q2_what_happened || null,
      body.q3_workflow || null,
      body.q4_question || null,
      body.source || "manual"
    )
    .run();
  const encounterId = result.meta.last_row_id;

  // If the encounter includes tasks, create them.
  if (Array.isArray(body.tasks)) {
    for (const t of body.tasks) {
      await c.env.DB.prepare(
        `INSERT INTO tasks (patient_id, encounter_id, description, owner, due_date, status)
         VALUES (?, ?, ?, ?, ?, 'open')`
      )
        .bind(patientId, encounterId, t.description, t.owner || null, t.due_date || null)
        .run();
    }
  }

  await audit(c, "system", "encounter.create", "encounters", encounterId, null, body);
  return c.json({ id: encounterId }, 201);
});

app.get("/patients/:id/encounters", async (c) => {
  const id = Number(c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM encounters WHERE patient_id = ? ORDER BY occurred_at DESC"
  )
    .bind(id)
    .all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

app.get("/tasks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT t.*, p.name AS patient_name FROM tasks t JOIN patients p ON p.id = t.patient_id ORDER BY t.due_date ASC"
  ).all();
  return c.json(results);
});

app.patch("/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Refill prompt generator — the 10 fields from the note
// ---------------------------------------------------------------------------

/**
 * Build a refill prompt for a patient + medication. The provider completes the
 * order manually in the pharmacy platform. The system tracks prompt status.
 */
async function buildRefillPrompt(
  db: D1Database,
  patient: Patient,
  med: any,
  quantityNeeded: number | null,
  orderByDate: string | null
) {
  return {
    patient_name: patient.name,
    dob: patient.date_of_birth,
    phone: patient.phone,
    address: patient.address,
    email: patient.email,
    med_name: med.name,
    current_dose: med.dose,
    quantity_needed: quantityNeeded ?? med.refill_quantity ?? null,
    estimated_exhaustion_date: med.estimated_exhaustion_date,
    order_by_date: orderByDate ?? med.order_by_date,
    delivery_notes: med.delivery_notes,
  };
}

app.post("/refill-prompts", async (c) => {
  const body = await c.req.json();
  const { patient_id, medication_id, quantity_needed, order_by_date } = body;

  const patient = (await c.env.DB.prepare("SELECT * FROM patients WHERE id = ?")
    .bind(patient_id)
    .first()) as Patient | null;
  if (!patient) return c.json({ error: "patient not found" }, 404);

  const med = await c.env.DB.prepare("SELECT * FROM medications WHERE id = ? AND patient_id = ?")
    .bind(medication_id, patient_id)
    .first();
  if (!med) return c.json({ error: "medication not found" }, 404);

  const prompt = await buildRefillPrompt(
    c.env.DB,
    patient,
    med,
    quantity_needed ?? null,
    order_by_date ?? null
  );

  const result = await c.env.DB.prepare(
    `INSERT INTO refill_prompts
      (patient_id, medication_id, patient_name, dob, phone, address, email,
       med_name, current_dose, quantity_needed, estimated_exhaustion_date,
       order_by_date, delivery_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')`
  )
    .bind(
      patient.id,
      med.id,
      prompt.patient_name,
      prompt.dob,
      prompt.phone,
      prompt.address,
      prompt.email,
      prompt.med_name,
      prompt.current_dose,
      prompt.quantity_needed,
      prompt.estimated_exhaustion_date,
      prompt.order_by_date,
      prompt.delivery_notes
    )
    .run();

  await audit(c, "system", "refill_prompt.generate", "refill_prompts", result.meta.last_row_id, null, prompt);
  return c.json({ id: result.meta.last_row_id, prompt }, 201);
});

app.get("/refill-prompts", async (c) => {
  const status = c.req.query("status");
  let query = "SELECT * FROM refill_prompts";
  const args: any[] = [];
  if (status) {
    query += " WHERE status = ?";
    args.push(status);
  }
  query += " ORDER BY created_at DESC";
  const { results } = await c.env.DB.prepare(query).bind(...args).all();
  return c.json(results);
});

app.patch("/refill-prompts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const assignments: string[] = fields.map((f) => `${f} = ?`);
  const values: unknown[] = fields.map((f) => body[f]);
  if (body.status === "completed" && !("completed_at" in body)) {
    assignments.push("completed_at = datetime('now')");
  }
  await c.env.DB.prepare(`UPDATE refill_prompts SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM refill_prompts WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Exception monitor — the 8 configurable rules
// ---------------------------------------------------------------------------

async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return (row?.value as string) || fallback;
}

/** True if an unresolved exception matching (patient, type, details LIKE) already exists. */
async function openExists(
  db: D1Database,
  patientId: number,
  type: string,
  detailsLike: string
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM exceptions
     WHERE patient_id = ? AND exception_type = ? AND details LIKE ? AND resolved_date IS NULL`
  )
    .bind(patientId, type, detailsLike)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/** Mark matching unresolved exceptions as resolved (today). */
async function resolveOpen(
  db: D1Database,
  patientId: number,
  type: string,
  detailsLike?: string
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let q = `UPDATE exceptions SET resolved_date = ?
           WHERE patient_id = ? AND exception_type = ? AND resolved_date IS NULL`;
  const args: any[] = [today, patientId, type];
  if (detailsLike) {
    q += " AND details LIKE ?";
    args.push(detailsLike);
  }
  await db.prepare(q).bind(...args).run();
}

/** Dedup helper: only push if no identical unresolved exception already exists. */
async function pushIfNew(
  db: D1Database,
  created: any[],
  seen: Set<string>,
  ex: { patient_id: number; exception_type: string; severity: string; details: string },
  detailsLike: string
) {
  const key = `${ex.patient_id}|${ex.exception_type}|${ex.details}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (await openExists(db, ex.patient_id, ex.exception_type, detailsLike)) return;
  created.push(ex);
}

/**
 * Daily scan. Emits exception rows for every configured rule that fires.
 * Returns the attention list grouped by severity.
 */
export async function runExceptionMonitor(env: Env) {
  const db = env.DB;
  const today = new Date().toISOString().slice(0, 10);

  // Configurable thresholds from settings (defaults from the note)
  const contactDays = Number(await getSetting(db, "contact_interval_days", "30"));
  const exhaustionLead = Number(await getSetting(db, "exhaustion_lead_days", "14"));
  const followupLead = Number(await getSetting(db, "followup_overdue_days", "7"));
  const taskLead = Number(await getSetting(db, "task_overdue_days", "3"));

  const created: any[] = [];
  const seen = new Set<string>();

  // 1. No patient contact for N days (per-patient interval)
  const patients = (await db.prepare("SELECT * FROM patients").all()).results as Patient[];
  for (const p of patients) {
    const interval = p.expected_contact_interval_days || contactDays;
    const lastContact = await db.prepare(
      "SELECT MAX(occurred_at) AS last FROM encounters WHERE patient_id = ?"
    ).bind(p.id).first<{ last: string | null }>();
    const lastDate = lastContact?.last ? lastContact.last.slice(0, 10) : null;
    if (!lastDate) {
      await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "no_contact", severity: "high", details: "No encounters on record" }, "%");
    } else {
      const days = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
      if (days > interval) {
        await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "no_contact", severity: "medium", details: `No contact in ${days} days (interval ${interval})` }, "%");
      } else {
        // Contact happened recently — clear any stale no_contact exception
        await resolveOpen(db, p.id, "no_contact");
      }
    }

    // 2. Medication likely to run out within lead days
    const meds = (await db.prepare(
      "SELECT * FROM medications WHERE patient_id = ? AND estimated_exhaustion_date IS NOT NULL"
    ).bind(p.id).all()).results as unknown as Medication[];
    for (const m of meds) {
      const exDateRaw = m.estimated_exhaustion_date;
      if (!exDateRaw) continue;
      const exDate = exDateRaw.slice(0, 10);
      const daysLeft = Math.floor((new Date(exDate).getTime() - Date.now()) / 86400000);
      if (daysLeft <= exhaustionLead) {
        await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "medication_running_out", severity: daysLeft <= 7 ? "high" : "medium", details: `${m.name} exhausts ${exDate} (${daysLeft} days)` }, `%${m.name}%`);
      } else {
        // No longer running out — clear stale exception for this med
        await resolveOpen(db, p.id, "medication_running_out", `%${m.name}%`);
      }
      // 3. Prescription prompt generated but not completed
      const openPrompt = await db.prepare(
        "SELECT COUNT(*) AS n FROM refill_prompts WHERE medication_id = ? AND status = 'generated'"
      ).bind(m.id).first<{ n: number }>();
      if (openPrompt && openPrompt.n > 0) {
        await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "prompt_uncompleted", severity: "medium", details: `${m.name} has an uncompleted refill prompt` }, `%${m.name}%`);
      } else {
        await resolveOpen(db, p.id, "prompt_uncompleted", `%${m.name}%`);
      }
    }

    // 4. Patient overdue for follow-up (no encounter within followupLead of a scheduled date)
    const overdue = await db.prepare(
      `SELECT e.id FROM encounters e
       WHERE e.patient_id = ? AND e.q3_workflow IS NOT NULL
         AND e.q3_workflow LIKE '%follow%'
         AND e.occurred_at < datetime('now', '-' || ? || ' days')
       ORDER BY e.occurred_at DESC LIMIT 1`
    ).bind(p.id, followupLead).first();
    if (overdue) {
      await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "followup_overdue", severity: "medium", details: "Follow-up noted but no recent encounter" }, "%");
    } else {
      await resolveOpen(db, p.id, "followup_overdue");
    }

    // 5. Labs overdue (placeholder: encounter notes mention lab)
    // 6. Treatment cycle ending without a reassessment scheduled
    const endingCycle = await db.prepare(
      `SELECT id, cycle_type, end_date FROM cycles
       WHERE patient_id = ? AND end_date IS NOT NULL AND end_date >= ? AND end_date <= date('now', '+14 days')`
    ).bind(p.id, today).all();
    let hasEndingCycle = false;
    for (const cyc of endingCycle.results) {
      hasEndingCycle = true;
      const reassessed = await db.prepare(
        "SELECT COUNT(*) AS n FROM encounters WHERE patient_id = ? AND occurred_at > ?"
      ).bind(p.id, cyc.end_date).first<{ n: number }>();
      if (!reassessed || reassessed.n === 0) {
        await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "cycle_ending_unreassessed", severity: "high", details: `Cycle ${cyc.cycle_type || ""} ends ${cyc.end_date} with no reassessment` }, "%");
      } else {
        await resolveOpen(db, p.id, "cycle_ending_unreassessed");
      }
    }
    if (!hasEndingCycle) {
      await resolveOpen(db, p.id, "cycle_ending_unreassessed");
    }

    // 7. Medication received but not confirmed
    const unconfirmed = await db.prepare(
      "SELECT COUNT(*) AS n FROM medications WHERE patient_id = ? AND in_transit = 1 AND delivery_notes IS NULL"
    ).bind(p.id).first<{ n: number }>();
    if (unconfirmed && unconfirmed.n > 0) {
      await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "receipt_unconfirmed", severity: "low", details: "In-transit medication without delivery confirmation" }, "%");
    } else {
      await resolveOpen(db, p.id, "receipt_unconfirmed");
    }

    // 8. Assigned team task remains incomplete
    const openTasks = await db.prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE patient_id = ? AND status IN ('open', 'overdue')"
    ).bind(p.id).first<{ n: number }>();
    if (openTasks && openTasks.n > 0) {
      await pushIfNew(db, created, seen, { patient_id: p.id, exception_type: "task_incomplete", severity: "low", details: `${openTasks.n} open task(s)` }, "%");
    } else {
      await resolveOpen(db, p.id, "task_incomplete");
    }
  }

  // Persist new exceptions
  for (const ex of created) {
    await db.prepare(
      `INSERT INTO exceptions (patient_id, exception_type, severity, details, generated_date)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(ex.patient_id, ex.exception_type, ex.severity, ex.details, today).run();
  }

  return { generated: created.length, exceptions: created };
}

// Manual trigger (also used by the scheduled cron)
app.post("/exceptions/run", async (c) => {
  const result = await runExceptionMonitor(c.env);
  return c.json(result);
});

app.get("/exceptions", async (c) => {
  const unresolved = c.req.query("unresolved") === "true";
  let query = `SELECT e.*, p.name AS patient_name FROM exceptions e
               JOIN patients p ON p.id = e.patient_id`;
  if (unresolved) query += " WHERE e.resolved_date IS NULL";
  query += " ORDER BY e.generated_date DESC";
  const { results } = await c.env.DB.prepare(query).all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Status board — "always be able to tell us"
// ---------------------------------------------------------------------------

app.get("/patients/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const patient = (await c.env.DB.prepare("SELECT * FROM patients WHERE id = ?")
    .bind(id)
    .first()) as Patient | null;
  if (!patient) return c.json({ error: "not found" }, 404);

  const meds = (await c.env.DB.prepare(
    "SELECT * FROM medications WHERE patient_id = ? ORDER BY estimated_exhaustion_date ASC"
  ).bind(id).all()).results as unknown as Medication[];
  const cycles = (await c.env.DB.prepare(
    "SELECT * FROM cycles WHERE patient_id = ? ORDER BY start_date DESC"
  ).bind(id).all()).results as unknown as Cycle[];
  const encounters = (await c.env.DB.prepare(
    "SELECT * FROM encounters WHERE patient_id = ? ORDER BY occurred_at DESC"
  ).bind(id).all()).results as unknown as any[];
  const openPrompts = (await c.env.DB.prepare(
    "SELECT * FROM refill_prompts WHERE patient_id = ? AND status = 'generated'"
  ).bind(id).all()).results as unknown as Record<string, unknown>[];
  const openTasks = (await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE patient_id = ? AND status IN ('open', 'overdue')"
  ).bind(id).all()).results as unknown as Record<string, unknown>[];
  const unresolvedExceptions = (await c.env.DB.prepare(
    "SELECT * FROM exceptions WHERE patient_id = ? AND resolved_date IS NULL"
  ).bind(id).all()).results as unknown as Record<string, unknown>[];

  const lastEncounter = encounters[0] || null;
  const currentCycle = cycles.find((cy) => {
    const end = cy.end_date ? cy.end_date.slice(0, 10) : "9999";
    const start = cy.start_date ? cy.start_date.slice(0, 10) : "0000";
    return start <= new Date().toISOString().slice(0, 10) && end >= new Date().toISOString().slice(0, 10);
  }) || null;

  const nextOrderBy = meds
    .map((m) => m.order_by_date || m.estimated_exhaustion_date)
    .filter(Boolean)
    .sort()[0] || null;

  const daysOnHand = (() => {
    const ex = meds.map((m) => m.estimated_exhaustion_date).filter(Boolean).sort()[0];
    if (!ex) return null;
    return Math.max(0, Math.floor((new Date(ex.slice(0, 10)).getTime() - Date.now()) / 86400000));
  })();

  return c.json({
    patient,
    medications: meds,
    current_cycle: currentCycle,
    cycles,
    last_encounter: lastEncounter,
    days_on_hand: daysOnHand,
    next_order_by: nextOrderBy,
    open_refill_prompts: openPrompts,
    open_tasks: openTasks,
    unresolved_exceptions: unresolvedExceptions,
    status_text: `Taking ${meds.map((m) => m.name).join(", ") || "—"}; cycle ${currentCycle?.cycle_type || "—"} ends ${currentCycle?.end_date?.slice(0, 10) || "—"}; ~${daysOnHand ?? "?"} days of meds on hand; next order by ${nextOrderBy || "—"}; last contact ${lastEncounter?.occurred_at?.slice(0, 10) || "never"}.`,
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function audit(
  c: any,
  actor: string,
  action: string,
  entityType: string,
  entityId: number,
  before: any,
  after: any
) {
  await c.env.DB.prepare(
    `INSERT INTO audit_events (actor, action, entity_type, entity_id, before, after)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(actor, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null)
    .run();
}

// ---------------------------------------------------------------------------
// Feedback (team input capture — drive updates from plain sentences)
// ---------------------------------------------------------------------------

app.post("/feedback", async (c) => {
  const body = await c.req.json();
  if (!body.body || !body.body.trim()) {
    return c.json({ error: "body is required" }, 400);
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO feedback (submitted_by, category, body, context, status)
     VALUES (?, ?, ?, ?, 'new')`
  )
    .bind(
      body.submitted_by || "anonymous",
      body.category || "idea",
      body.body.trim(),
      body.context || null
    )
    .run();
  await audit(c, "system", "feedback.create", "feedback", result.meta.last_row_id, null, body);
  return c.json({ id: result.meta.last_row_id, status: "new" }, 201);
});

app.get("/feedback", async (c) => {
  const status = c.req.query("status");
  const category = c.req.query("category");
  let query = "SELECT * FROM feedback WHERE 1=1";
  const args: any[] = [];
  if (status) { query += " AND status = ?"; args.push(status); }
  if (category) { query += " AND category = ?"; args.push(category); }
  query += " ORDER BY created_at DESC LIMIT 50";
  const { results } = await c.env.DB.prepare(query).bind(...args).all();
  return c.json(results);
});

app.patch("/feedback/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const assignments: string[] = fields.map((f) => `${f} = ?`);
  const values: unknown[] = fields.map((f) => body[f]);
  assignments.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE feedback SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM feedback WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Deploy events (powers the "What's New" feed)
// ---------------------------------------------------------------------------

app.post("/deploy-events", async (c) => {
  // Self-healing: ensure table exists (safe to run every time)
  await c.env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS deploy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      deployed_by TEXT DEFAULT 'ci',
      live_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
  await c.env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_deploy_events_created ON deploy_events(created_at DESC)"
  ).run().catch(() => {});

  const body = await c.req.json();
  if (!body.summary || !body.summary.trim()) {
    return c.json({ error: "summary is required" }, 400);
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO deploy_events (version, summary, details, deployed_by, live_url)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      body.version || null,
      body.summary.trim(),
      body.details || null,
      body.deployed_by || "ci",
      body.live_url || null
    )
    .run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.get("/deploy-events", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 10, 50);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM deploy_events ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Static assets + entrypoint
// ---------------------------------------------------------------------------

// The frontend lives in /public and is served as static assets (Workers
// static assets feature). The API is mounted under /api/*; anything else
// falls through to the static asset handler.

async function staticAssetsHandler(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path === "/") path = "/index.html";

  // Serve from static assets.
  try {
    const asset = await (env as any).ASSETS.fetch(new Request(new URL(path, url.origin), request));
    if (asset.status === 404 && !path.includes(".")) {
      // SPA fallback to index
      return (env as any).ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
    }
    return asset;
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Mount API under /api/*; serve static assets for everything else.
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) {
      // Strip the /api prefix so the Hono app sees its native routes.
      const newUrl = new URL(url);
      newUrl.pathname = url.pathname.replace(/^\/api/, "") || "/";
      const apiRequest = new Request(newUrl.toString(), request);
      return app.fetch(apiRequest, env, ctx);
    }
    return staticAssetsHandler(request, env, ctx);
  },
  async scheduled(_event: any, env: Env, _ctx: any) {
    await runExceptionMonitor(env);
  },
};
