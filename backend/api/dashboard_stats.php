<?php
// Aggregierte Kennzahlen fuer das Dashboard. Reine Leseoperation.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../ereignisse.php';

$user = require_session();
require_verwaltung($user);

$monatStart    = date('Y-m-01');
$vormonatStart = date('Y-m-01', strtotime('first day of last month'));

// ── Kennzahlen laufender Monat vs. Vormonat
$stmt = db()->prepare(
    'SELECT
        COALESCE(SUM(CASE WHEN datum >= ? THEN 1 ELSE 0 END), 0)        AS rapporte_monat,
        COALESCE(SUM(CASE WHEN datum >= ? THEN netto_h ELSE 0 END), 0)  AS stunden_monat,
        COALESCE(SUM(CASE WHEN datum >= ? AND datum < ? THEN 1 ELSE 0 END), 0)       AS rapporte_vormonat,
        COALESCE(SUM(CASE WHEN datum >= ? AND datum < ? THEN netto_h ELSE 0 END), 0) AS stunden_vormonat
     FROM rapporte'
);
$stmt->execute([$monatStart, $monatStart, $vormonatStart, $monatStart, $vormonatStart, $monatStart]);
$kpi = $stmt->fetch() ?: [];

$counts = db()->query(
    'SELECT (SELECT COUNT(*) FROM mitarbeiter WHERE aktiv = 1) AS mitarbeiter,
            (SELECT COUNT(*) FROM kunden) AS kunden,
            (SELECT COUNT(*) FROM rapporte) AS rapporte_total'
)->fetch() ?: [];

// ── Stundenverlauf der letzten 8 Kalenderwochen (Luecken bewusst als 0 auffuellen)
$rows = db()->query(
    "SELECT DATE_FORMAT(datum, '%x-%v') AS kw, SUM(netto_h) AS stunden, COUNT(*) AS anzahl
     FROM rapporte
     WHERE datum >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
     GROUP BY kw"
)->fetchAll();
$byKw = [];
foreach ($rows as $r) {
    $byKw[$r['kw']] = $r;
}
$verlauf = [];
for ($i = 7; $i >= 0; $i--) {
    $ts  = strtotime("monday this week -{$i} week");
    $key = date('o-W', $ts);
    $verlauf[] = [
        'kw'      => (int)date('W', $ts),
        'von'     => date('Y-m-d', $ts),
        'stunden' => isset($byKw[$key]) ? (float)$byKw[$key]['stunden'] : 0.0,
        'anzahl'  => isset($byKw[$key]) ? (int)$byKw[$key]['anzahl'] : 0,
    ];
}

// ── Offene Sitzungen (Sessions laufen in diesem Modell nicht automatisch ab)
$angemeldet = db()->query(
    'SELECT m.name, m.vorname, m.nachname, MAX(s.erstellt_am) AS letzte_anmeldung, COUNT(*) AS sitzungen
     FROM sessions s JOIN mitarbeiter m ON m.id = s.mitarbeiter_id
     WHERE m.aktiv = 1
     GROUP BY m.id, m.name, m.vorname, m.nachname
     ORDER BY letzte_anmeldung DESC'
)->fetchAll();

// ── Stunden je Mitarbeitende im laufenden Monat
$stmt = db()->prepare(
    'SELECT m.name, m.vorname, m.nachname,
            COALESCE(SUM(r.netto_h), 0) AS stunden, COUNT(r.id) AS anzahl
     FROM mitarbeiter m
     LEFT JOIN rapporte r ON r.mitarbeiter_id = m.id AND r.datum >= ?
     WHERE m.aktiv = 1
     GROUP BY m.id, m.name, m.vorname, m.nachname
     ORDER BY stunden DESC, m.name'
);
$stmt->execute([$monatStart]);
$proMitarbeiter = $stmt->fetchAll();

// ── Ereignis-Feed (ENT-090). Loest den frueheren Sperrtage-Feed ab: Er ist
// jetzt EINE der Arten, nicht der ganze Inhalt. Die Zusammenstellung steht in
// backend/ereignisse.php, damit sie pruefbar ist und nicht im Endpunkt liegt.
$ereignisse = ereignisse_sammeln(db());

// ── Letzte Rapporte
$letzte = db()->query(
    'SELECT r.id, r.datum, m.name AS mitarbeiter, r.kunde, r.ort, r.einsatzart, r.netto_h
     FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
     ORDER BY r.datum DESC, r.id DESC
     LIMIT 8'
)->fetchAll();

json_response([
    'status' => 'ok',
    'stand'  => date('c'),
    'kpi' => [
        'rapporte_monat'    => (int)($kpi['rapporte_monat'] ?? 0),
        'rapporte_vormonat' => (int)($kpi['rapporte_vormonat'] ?? 0),
        'stunden_monat'     => (float)($kpi['stunden_monat'] ?? 0),
        'stunden_vormonat'  => (float)($kpi['stunden_vormonat'] ?? 0),
        'mitarbeiter'       => (int)($counts['mitarbeiter'] ?? 0),
        'kunden'            => (int)($counts['kunden'] ?? 0),
        'rapporte_total'    => (int)($counts['rapporte_total'] ?? 0),
    ],
    'verlauf'         => $verlauf,
    'angemeldet'      => $angemeldet,
    'pro_mitarbeiter' => $proMitarbeiter,
    'letzte_rapporte' => $letzte,
    'ereignisse'            => $ereignisse['ereignisse'],
    'ereignisse_gesamt'     => $ereignisse['gesamt'],
    'ereignisse_gekuerzt'   => $ereignisse['gekuerzt'],
    // Welche Arten sich nicht abfragen liessen -- meist eine Spalte, die die
    // Einrichtung noch nicht angelegt hat. Die Oberflaeche muss den
    // Unterschied hinschreiben koennen: "nichts passiert" und "hier fehlt
    // etwas" sehen sonst gleich aus.
    'ereignisse_unvollstaendig' => $ereignisse['unvollstaendig'],
]);
