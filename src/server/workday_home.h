// Compact, role-scoped operational summary. Never includes clinical notes,
// assessments, rehabilitation goals, risk flags or document content.
J workdayHome(DB&db,const J&u,const httplib::Request&r){
 allow(u,{"admin","reception"});
 const auto day=now().substr(0,10);
 const auto counts=db.query(
  "SELECT count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed') AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) expected_total, "
  "count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed') AND t.arrived_at='' AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) waiting, "
  "count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed') AND t.arrived_at<>'' AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) arrived, "
  "count(*) FILTER(WHERE EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) completed, "
  "count(*) FILTER(WHERE t.visit_status<>'' OR a.status IN ('cancelled','no_show')) not_completed "
  "FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE substr(a.start,1,10)=?",{day})[0];
 const auto next=db.query(
  "SELECT a.id appointment_id,a.start,a.\"end\",p.id patient_id,p.name patient,p.patient_no,us.name psychologist,r.name room,"
  "t.arrived_at FROM appointments a JOIN attendees t ON t.appointment_id=a.id "
  "JOIN patients p ON p.id=t.patient_id JOIN users us ON us.id=a.psychologist_id "
  "JOIN rooms r ON r.id=a.room_id WHERE substr(a.start,1,10)=? "
  "AND a.status IN ('scheduled','confirmed') AND t.visit_status='' "
  "AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id) "
  "ORDER BY CASE WHEN a.start>=? THEN 0 ELSE 1 END,a.start,p.name LIMIT 6",{day,now().substr(0,16)});
 const auto patients=db.query("SELECT count(*) n FROM patients WHERE status='active'")[0]["n"];
 const auto waiting=db.query("SELECT count(*) n FROM waiting_list WHERE status='active'")[0]["n"];
 // One audit record per explicit patient-card access, not every dashboard poll.
 return {{"date",day},{"counts",counts},{"active_patients",patients},
   {"waiting_list",waiting},{"next",next}};
}
