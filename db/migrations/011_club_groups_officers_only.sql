-- Kulüp gruplarında yalnızca aktif görevliler ve danışmanlar kalır; öğrenci üyeler Google grubundan da çıkarılır.
INSERT INTO sync_jobs (action, entity_type, entity_id, payload)
SELECT 'REMOVE_MEMBER', 'group', g.id, json_object('groupEmail', g.email, 'memberEmail', m.member_email)
FROM group_members m
JOIN groups g ON g.id = m.group_id
JOIN clubs k ON k.group_id = g.id
WHERE m.student_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_officers o WHERE o.club_id = k.id AND o.student_id = m.student_id AND o.ended_at IS NULL);

DELETE FROM group_members
WHERE student_id IS NOT NULL
  AND group_id IN (SELECT group_id FROM clubs WHERE group_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM club_officers o JOIN clubs k ON k.id = o.club_id
    WHERE k.group_id = group_members.group_id AND o.student_id = group_members.student_id AND o.ended_at IS NULL
  );

DELETE FROM club_members
WHERE NOT EXISTS (
  SELECT 1 FROM club_officers o
  WHERE o.club_id = club_members.club_id AND o.student_id = club_members.student_id AND o.ended_at IS NULL
);
