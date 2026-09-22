<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'personal_lesen');
require_once __DIR__ . '/../mitarbeiter.php';   // ma_nur_menschen() (ENT-631)

$rows = db()->query(
    'SELECT m.name, COUNT(r.id) AS anzahl, COALESCE(SUM(r.netto_h),0) AS stunden, MAX(r.datum) AS letzter
     FROM mitarbeiter m LEFT JOIN rapporte r ON r.mitarbeiter_id = m.id
     WHERE m.aktiv = 1 AND ' . ma_nur_menschen(db(), 'm') . '
     GROUP BY m.id, m.name
     ORDER BY stunden DESC'
)->fetchAll();

json_response(['status' => 'ok', 'stats' => $rows]);
