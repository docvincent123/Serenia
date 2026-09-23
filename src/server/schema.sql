CREATE TABLE IF NOT EXISTS users(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','reception','psychologist','director')),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS families(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  dob TEXT NOT NULL,
  category TEXT NOT NULL,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  family_id BIGINT REFERENCES families(id),
  family_role TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS appointments(
  id BIGSERIAL PRIMARY KEY,
  psychologist_id BIGINT NOT NULL REFERENCES users(id),
  room_id BIGINT NOT NULL REFERENCES rooms(id),
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('individual','group')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled','completed')),
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
