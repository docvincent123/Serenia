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
