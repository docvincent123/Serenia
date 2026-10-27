CREATE TABLE IF NOT EXISTS users(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','reception','psychologist','director')),
  phone TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires BIGINT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS families(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients(
  id BIGSERIAL PRIMARY KEY,
  patient_no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  dob TEXT NOT NULL,
  category TEXT NOT NULL,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  family_id BIGINT REFERENCES families(id),
  family_role TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  admin_note TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'individual',
  capacity INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS appointments(
  id BIGSERIAL PRIMARY KEY,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  room_id BIGINT NOT NULL REFERENCES rooms(id),
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('individual','group')),
  status TEXT NOT NULL DEFAULT 'scheduled',
  note TEXT NOT NULL DEFAULT '',
  cancellation_reason TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendees(
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES patients(id) ON DELETE CASCADE,
  PRIMARY KEY(appointment_id,patient_id)
);

-- Reception attendance is separate from booking confirmation and clinical completion.
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS arrived_at TEXT NOT NULL DEFAULT '';
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS arrived_by BIGINT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS consultations(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  appointment_id BIGINT NOT NULL REFERENCES appointments(id),
  note TEXT NOT NULL,
  goals TEXT NOT NULL,
  next_plan TEXT NOT NULL,
  homework TEXT NOT NULL,
  consultation_type TEXT NOT NULL DEFAULT 'repeat',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  request_text TEXT NOT NULL DEFAULT '',
  state_text TEXT NOT NULL DEFAULT '',
  work_done TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  result_text TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'low',
  risk_flags TEXT NOT NULL DEFAULT '[]',
  created TEXT NOT NULL,
  UNIQUE(appointment_id,patient_id)
);

CREATE TABLE IF NOT EXISTS shift_reports(
  id BIGSERIAL PRIMARY KEY,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL,
  consultations_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  incidents TEXT NOT NULL DEFAULT '',
  handover TEXT NOT NULL DEFAULT '',
  primary_count INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 0,
  crisis_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  family_count INTEGER NOT NULL DEFAULT 0,
  critical_cases BOOLEAN NOT NULL DEFAULT FALSE,
  notify_admin BOOLEAN NOT NULL DEFAULT FALSE,
  notify_director BOOLEAN NOT NULL DEFAULT FALSE,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  UNIQUE(psychologist_id, shift_date)
);

CREATE TABLE IF NOT EXISTS assessments(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  expires BIGINT NOT NULL,
  completed TEXT,
  answers TEXT,
  score INTEGER
);

CREATE TABLE IF NOT EXISTS audit(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  event TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id BIGINT,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox(
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  created TEXT NOT NULL,
  processed TEXT
);

CREATE TABLE IF NOT EXISTS module_settings(
  name TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_patient_psychologist ON patients(psychologist_id);
CREATE INDEX IF NOT EXISTS idx_appointment_start ON appointments(start,"end");
CREATE INDEX IF NOT EXISTS idx_consultation_patient ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_shift_report_date ON shift_reports(shift_date);

CREATE TABLE IF NOT EXISTS center_settings(
  id SMALLINT PRIMARY KEY CHECK(id=1),
  center_name TEXT NOT NULL DEFAULT 'SOLVIA Center',
  short_name TEXT NOT NULL DEFAULT 'SOLVIA',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  director_name TEXT NOT NULL DEFAULT '',
  admin_name TEXT NOT NULL DEFAULT '',
  work_hours TEXT NOT NULL DEFAULT '',
  document_footer TEXT NOT NULL DEFAULT '',
  discharge_signatory TEXT NOT NULL DEFAULT '',
  head_name TEXT NOT NULL DEFAULT '',
  head_title TEXT NOT NULL DEFAULT 'Завідувач центру',
  logo_data TEXT NOT NULL DEFAULT '',
  appointment_reminder_minutes INTEGER NOT NULL DEFAULT 30,
  connection_mode TEXT NOT NULL DEFAULT 'local',
  local_api_url TEXT NOT NULL DEFAULT '',
  vps_api_url TEXT NOT NULL DEFAULT '',
  vps_name TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL DEFAULT ''
);
INSERT INTO center_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_notes(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discharge_summaries(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  author_id BIGINT NOT NULL REFERENCES users(id),
  psychologist_id BIGINT REFERENCES users(id),
  psychologist_name TEXT NOT NULL DEFAULT '',
  patient_name TEXT NOT NULL DEFAULT '',
  patient_no_snapshot TEXT NOT NULL DEFAULT '',
  patient_dob TEXT NOT NULL DEFAULT '',
  patient_category TEXT NOT NULL DEFAULT '',
  document_no TEXT NOT NULL DEFAULT '',
  generated BOOLEAN NOT NULL DEFAULT TRUE,
  summary TEXT NOT NULL,
  dynamics TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  followup TEXT NOT NULL DEFAULT '',
  consultation_count INTEGER NOT NULL DEFAULT 0,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_events(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  action TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS sex TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '';

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK(status IN ('draft','scheduled','confirmed','cancelled','completed','no_show','rescheduled'));

ALTER TABLE consultations ADD COLUMN IF NOT EXISTS consultation_type TEXT NOT NULL DEFAULT 'repeat';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS request_text TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS state_text TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS work_done TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS recommendations TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS result_text TEXT NOT NULL DEFAULT '';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS risk_flags TEXT NOT NULL DEFAULT '[]';

ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS primary_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS crisis_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS cancelled_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS group_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS family_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS critical_cases BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS notify_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shift_reports ADD COLUMN IF NOT EXISTS notify_director BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_admin_notes_patient ON admin_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_discharge_patient ON discharge_summaries(patient_id);

CREATE TABLE IF NOT EXISTS shift_days(
  shift_date TEXT PRIMARY KEY,
  opened_by BIGINT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  closed_by BIGINT REFERENCES users(id),
  closed_at TEXT
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen TEXT NOT NULL DEFAULT '';

ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_no TEXT NOT NULL DEFAULT '';
UPDATE patients
SET patient_no = LPAD(((((id * 7919) % 90000) + 10000))::text, 5, '0')
WHERE patient_no = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_number
  ON patients(patient_no)
  WHERE patient_no <> '';

ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS head_name TEXT NOT NULL DEFAULT '';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS head_title TEXT NOT NULL DEFAULT 'Завідувач центру';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS logo_data TEXT NOT NULL DEFAULT '';

ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS psychologist_id BIGINT REFERENCES users(id);
UPDATE discharge_summaries d
SET psychologist_id = p.psychologist_id
FROM patients p
WHERE d.patient_id = p.id AND d.psychologist_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_shift_days_date ON shift_days(shift_date);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS appointment_reminder_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS document_no TEXT NOT NULL DEFAULT '';
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS generated BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_kind_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_kind_check CHECK(kind IN ('individual','group','family','child','crisis'));

CREATE INDEX IF NOT EXISTS idx_sessions_seen ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_appointments_psychologist_start ON appointments(psychologist_id,start);

ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'local';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS vps_api_url TEXT NOT NULL DEFAULT '';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS vps_name TEXT NOT NULL DEFAULT '';
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS local_api_url TEXT NOT NULL DEFAULT '';

ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS psychologist_name TEXT NOT NULL DEFAULT '';
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS patient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS patient_no_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS patient_dob TEXT NOT NULL DEFAULT '';
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS patient_category TEXT NOT NULL DEFAULT '';

UPDATE discharge_summaries d
SET patient_name = p.name,
    patient_no_snapshot = p.patient_no,
    patient_dob = p.dob,
    patient_category = p.category
FROM patients p
WHERE d.patient_id = p.id
  AND (d.patient_name = '' OR d.patient_no_snapshot = '');

UPDATE discharge_summaries d
SET psychologist_name = u.name
FROM users u
WHERE d.psychologist_id = u.id
  AND d.psychologist_name = '';


-- SOLVIA 2.1: courses, referrals, signed documents and staff supervision.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source_details TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS patient_courses(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  course_no INTEGER NOT NULL,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
  reason TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created TEXT NOT NULL,
  UNIQUE(patient_id,course_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_courses_one_active
  ON patient_courses(patient_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_patient_courses_patient ON patient_courses(patient_id,id DESC);

INSERT INTO patient_courses(patient_id,course_no,psychologist_id,started_at,ended_at,status,reason,outcome,created_by,created)
SELECT p.id,1,p.psychologist_id,substr(p.created,1,10),NULL,
       CASE WHEN p.status='active' THEN 'active'
            WHEN p.status='archived' THEN 'archived'
            ELSE 'completed' END,
       'Початковий курс','',NULL,p.created
FROM patients p
WHERE NOT EXISTS (SELECT 1 FROM patient_courses c WHERE c.patient_id=p.id);

CREATE TABLE IF NOT EXISTS patient_referrals(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  destination_type TEXT NOT NULL,
  destination_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'recommended' CHECK(status IN ('recommended','sent','completed','cancelled')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patient_referrals_patient ON patient_referrals(patient_id,id DESC);

CREATE TABLE IF NOT EXISTS patient_documents(
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK(document_type IN ('informed_consent','data_processing','center_rules','family_consent','service_refusal','other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('signed','refused')),
  signed_by_name TEXT NOT NULL DEFAULT '',
  signature_data TEXT NOT NULL DEFAULT '',
  signed_at TEXT NOT NULL,
  patient_name TEXT NOT NULL DEFAULT '',
  patient_no_snapshot TEXT NOT NULL DEFAULT '',
  patient_dob TEXT NOT NULL DEFAULT '',
  patient_category TEXT NOT NULL DEFAULT '',
  center_name_snapshot TEXT NOT NULL DEFAULT '',
  center_address_snapshot TEXT NOT NULL DEFAULT '',
  center_phone_snapshot TEXT NOT NULL DEFAULT '',
  center_email_snapshot TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id,id DESC);

CREATE TABLE IF NOT EXISTS supervisions(
  id BIGSERIAL PRIMARY KEY,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  supervisor_id BIGINT NOT NULL REFERENCES users(id),
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
  topic TEXT NOT NULL DEFAULT '',
  case_summary TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id),
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supervisions_psychologist_date ON supervisions(psychologist_id,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_supervisions_supervisor_date ON supervisions(supervisor_id,scheduled_at);


-- Repair timestamp dates written by the original 2.1 migration.
UPDATE patient_courses SET started_at=substr(started_at,1,10)
WHERE started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T';

-- Operational policy shared by Linux, Windows and mobile clients.
CREATE TABLE IF NOT EXISTS workflow_settings(
 id INTEGER PRIMARY KEY CHECK(id=1),
 opening_time TEXT NOT NULL DEFAULT '08:00',
 closing_time TEXT NOT NULL DEFAULT '20:00',
 working_days TEXT NOT NULL DEFAULT '1234567',
 slot_step_minutes INTEGER NOT NULL DEFAULT 60,
 default_duration_minutes INTEGER NOT NULL DEFAULT 60,
 session_hours INTEGER NOT NULL DEFAULT 8
);
INSERT INTO workflow_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

-- Private drafts use optimistic revisions: a second device cannot silently overwrite.
CREATE TABLE IF NOT EXISTS consultation_drafts (
 patient_id BIGINT NOT NULL REFERENCES patients(id),
 user_id BIGINT NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1,
 payload TEXT NOT NULL,
 updated TEXT NOT NULL,
 PRIMARY KEY(patient_id,user_id)
);
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_consultation_client_key
 ON consultations(psychologist_id,client_key) WHERE client_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS waiting_list (
 id BIGSERIAL PRIMARY KEY,
 patient_id BIGINT NOT NULL REFERENCES patients(id),
 psychologist_id BIGINT NOT NULL REFERENCES users(id),
 date_from TEXT NOT NULL,
 date_to TEXT NOT NULL,
 time_from TEXT NOT NULL DEFAULT '09:00',
 time_to TEXT NOT NULL DEFAULT '18:00',
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high')),
 contact_note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','offered','booked','cancelled')),
 appointment_id BIGINT REFERENCES appointments(id),
 version INTEGER NOT NULL DEFAULT 1,
 created_by BIGINT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL,
 updated TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_active_patient
 ON waiting_list(patient_id) WHERE status IN ('waiting','offered');
CREATE INDEX IF NOT EXISTS idx_waiting_status_dates ON waiting_list(status,date_from,date_to);

ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS patient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS patient_no_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS patient_dob TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS patient_category TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS center_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS center_address_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS center_phone_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS center_email_snapshot TEXT NOT NULL DEFAULT '';

UPDATE patient_documents d
SET patient_name = p.name,
    patient_no_snapshot = p.patient_no,
    patient_dob = p.dob,
    patient_category = p.category
FROM patients p
WHERE d.patient_id = p.id
  AND (d.patient_name = '' OR d.patient_no_snapshot = '');

UPDATE patient_documents d
SET center_name_snapshot = cs.center_name,
    center_address_snapshot = cs.address,
    center_phone_snapshot = cs.phone,
    center_email_snapshot = cs.email
FROM center_settings cs
WHERE cs.id = 1
  AND d.center_name_snapshot = '';

-- Additive upgrade: original clinical records remain immutable.
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS started_at TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS consultation_addenda(
 id BIGSERIAL PRIMARY KEY,
 consultation_id BIGINT NOT NULL REFERENCES consultations(id),
 author_id BIGINT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL,
 content TEXT NOT NULL,
 client_key TEXT NOT NULL,
 created TEXT NOT NULL,
 UNIQUE(author_id,client_key)
);
CREATE INDEX IF NOT EXISTS idx_addenda_consultation ON consultation_addenda(consultation_id,id);
CREATE TABLE IF NOT EXISTS patient_progress(
 id BIGSERIAL PRIMARY KEY,
 patient_id BIGINT NOT NULL REFERENCES patients(id),
 author_id BIGINT NOT NULL REFERENCES users(id),
 goal TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('planned','in_progress','achieved','paused')),
 observation TEXT NOT NULL DEFAULT '',
 created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_patient ON patient_progress(patient_id,id);
CREATE TABLE IF NOT EXISTS mobile_devices(
 user_id BIGINT NOT NULL REFERENCES users(id),
 device_id TEXT NOT NULL,
 device_name TEXT NOT NULL,
 version_code INTEGER NOT NULL,
 version_name TEXT NOT NULL,
 last_seen TEXT NOT NULL,
 last_sync TEXT NOT NULL DEFAULT '',
 pending_count INTEGER NOT NULL,
 blocked_count INTEGER NOT NULL,
 error_code TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(user_id,device_id)
);

ALTER TABLE attendees ADD COLUMN IF NOT EXISTS visit_status TEXT NOT NULL DEFAULT '';
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS exclusion_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS last_seen_epoch BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS staff_messages(
 id BIGSERIAL PRIMARY KEY,
 sender_id BIGINT NOT NULL REFERENCES users(id),
 recipient_id BIGINT NOT NULL REFERENCES users(id),
 device_id TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL,
 client_key TEXT NOT NULL,
 created TEXT NOT NULL,
 delivered_at TEXT,
 read_at TEXT,
 UNIQUE(sender_id,client_key)
);
CREATE INDEX IF NOT EXISTS idx_staff_messages_recipient ON staff_messages(recipient_id,id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS shift_date TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_number ON users(staff_number);
ALTER TABLE center_settings ADD COLUMN IF NOT EXISTS server_name TEXT NOT NULL DEFAULT 'Основний';
CREATE TABLE IF NOT EXISTS shift_device_bindings(
 shift_date TEXT NOT NULL,
 device_id TEXT NOT NULL,
 user_id BIGINT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL,
 PRIMARY KEY(shift_date,device_id)
);

-- Daily reception authorization is separate from the persistent clinical shift.
CREATE TABLE IF NOT EXISTS reception_access(
  access_date TEXT PRIMARY KEY,
  starts_at TEXT NOT NULL,
  granted_by BIGINT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS updated TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS discharge_revisions(
  discharge_id BIGINT NOT NULL REFERENCES discharge_summaries(id),
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  author_id BIGINT NOT NULL REFERENCES users(id),
  created TEXT NOT NULL,
  PRIMARY KEY(discharge_id,revision)
);


-- Immutable source snapshots for mobile recovery; resolution is attributed separately.
CREATE TABLE IF NOT EXISTS mobile_recovery(
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 device_id TEXT NOT NULL,
 client_key TEXT NOT NULL,
 patient_id BIGINT NOT NULL REFERENCES patients(id),
 appointment_id BIGINT NOT NULL REFERENCES appointments(id),
 kind TEXT NOT NULL CHECK(kind IN ('draft','consultation')),
 payload TEXT NOT NULL,
 error TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','completed','linked')),
 consultation_id BIGINT REFERENCES consultations(id),
 resolved_by BIGINT REFERENCES users(id),
 resolution_reason TEXT NOT NULL DEFAULT '',
 resolved_payload TEXT NOT NULL DEFAULT '',
 server_snapshot TEXT NOT NULL DEFAULT '',
 created TEXT NOT NULL,
 updated TEXT NOT NULL,
 UNIQUE(user_id,device_id,client_key)
);
CREATE INDEX IF NOT EXISTS idx_mobile_recovery_state ON mobile_recovery(state,updated);

-- Preserve the first active session when upgrading older databases with duplicates.
-- Closed shifts and expired unbound sessions no longer reserve the account.
DELETE FROM sessions WHERE (shift_date='' AND expires<=extract(epoch from now())::bigint)
  OR (shift_date<>'' AND NOT EXISTS(SELECT 1 FROM shift_days WHERE shift_date=sessions.shift_date AND closed_at IS NULL));
-- created is the login time; token provides a deterministic tie-breaker.
DELETE FROM sessions WHERE token IN (
  SELECT token FROM (
    SELECT token, row_number() OVER (
      PARTITION BY user_id ORDER BY created ASC, token ASC
    ) AS position FROM sessions
  ) duplicates WHERE position > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_per_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS desktop_updates(
  platform TEXT PRIMARY KEY CHECK(platform IN ('windows','linux')),
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  release_notes TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL,
  published_by BIGINT REFERENCES users(id)
);

-- Dedicated display devices never reference or create staff sessions.
CREATE TABLE IF NOT EXISTS tv_displays(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  page_seconds INTEGER NOT NULL DEFAULT 12 CHECK(page_seconds BETWEEN 6 AND 60),
  show_full_names BOOLEAN NOT NULL DEFAULT TRUE,
  created TEXT NOT NULL,
  last_seen TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tv_pairings(
  token_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  expires BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tv_pairings_expires ON tv_pairings(expires);
CREATE TABLE IF NOT EXISTS tv_calls(
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  called_at BIGINT NOT NULL,
  called_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY(appointment_id,patient_id),
  FOREIGN KEY(appointment_id,patient_id) REFERENCES attendees(appointment_id,patient_id) ON DELETE CASCADE
);

-- Stable across address changes; included in backups and connection profiles.
CREATE TABLE IF NOT EXISTS installation_identity(id INTEGER PRIMARY KEY CHECK(id=1), server_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS center_license(id INTEGER PRIMARY KEY CHECK(id=1), envelope TEXT NOT NULL);


-- SOLVIA Rehabilitation: course-linked goals, revision-safe updates and audit trail.
-- These rows are clinical. Never expose them in reception or TV projections.
CREATE TABLE IF NOT EXISTS rehabilitation_goals (
 id BIGSERIAL PRIMARY KEY,
 patient_id BIGINT NOT NULL REFERENCES patients(id),
 course_id BIGINT NOT NULL REFERENCES patient_courses(id),
 owner_id BIGINT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 measurement TEXT NOT NULL DEFAULT '',
 baseline TEXT NOT NULL DEFAULT '',
 target_value TEXT NOT NULL DEFAULT '',
 target_date TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','in_progress','achieved','paused')),
 progress_value TEXT NOT NULL DEFAULT '',
 created_by BIGINT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL,
 updated TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE INDEX IF NOT EXISTS idx_rehab_goals_patient ON rehabilitation_goals(patient_id,course_id,id);
CREATE TABLE IF NOT EXISTS rehabilitation_goal_updates (
 id BIGSERIAL PRIMARY KEY,
 goal_id BIGINT NOT NULL REFERENCES rehabilitation_goals(id),
 state TEXT NOT NULL CHECK(state IN ('planned','in_progress','achieved','paused')),
 progress_value TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL,
 author_id BIGINT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rehab_updates_goal ON rehabilitation_goal_updates(goal_id,id DESC);
