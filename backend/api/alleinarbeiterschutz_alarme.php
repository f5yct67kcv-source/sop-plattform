<?php
declare(strict_types=1);
// Offene Stufe-1-Alarme des Alleinarbeiterschutzes (Mechanismus B, ENT-153/
// ENT-644) -- reine ANZEIGE des bereits bestehenden Zustands aus
// backend/alleinarbeiterschutz.php. Kein neuer Rechenkern, kein Versand:
// die Erkennung selbst (ueberfaellig? gemeldet?) laeuft weiterhin
// ausschliesslich in push_versand.php ueber alleinarbeiterschutz_stufe1_
// pruefen(). Dieser Endpunkt liest nur, was dort schon vermerkt wurde.
//
// GENAU DIE LUECKE, DIE OP-233 OFFEN LIESS: revierdienst_status.php
// zeichnet ausdruecklich KEINEN Alarmzustand ("Ein erfundener Alarmzustand
// waere in einem Waechtersystem schlimmer als keiner", siehe dort) --
// zu Recht, solange es dafuer kein Datenmodell gab. Seit Mechanismus B
// Stufe 1 gibt es eines (rundgang.stufe1_gemeldet_um); dieser Endpunkt
// macht es sichtbar, ohne den Vorsatz von revierdienst_status.php zu
// verletzen: Es wird weiterhin nichts erfunden, nur etwas Reales gezeigt.
//
// RECHT: dasselbe wie revierdienst_status.php (rundgaenge_lesen) -- wer
// die Waechter beim Laufen sehen darf, darf auch sehen, wenn einer
// ueberfaellig ist. Kein eigenes Alarm-Recht erfunden.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../alleinarbeiterschutz.php';

$user = require_session();
require_recht($user, 'rundgaenge_lesen');

$pdo = db();
$fund = alleinarbeiterschutz_offene_alarme($pdo, date('Y-m-d H:i:s'));

json_response([
    'status'       => 'ok',
    'eingerichtet' => $fund['eingerichtet'],
    'alarme'       => $fund['alarme'],
]);
