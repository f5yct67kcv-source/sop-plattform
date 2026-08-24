<?php
// Die eigenen Schichten eines Mitarbeitenden (ENT-023).
//
// Anders als alle uebrigen Planungs-Endpunkte NICHT admin-only -- aber strikt
// auf die eigene Person gefiltert. Niemand sieht hier die Einteilung anderer.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();

$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) {
    // Der Vortag muss mit: eine Nachtschicht von gestern laeuft heute noch.
    $von = date('Y-m-d', strtotime('-1 day'));
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    $bis = date('Y-m-d', strtotime('+90 days'));
}

$stmt = db()->prepare(
    // e.sparte muss mit (ENT-061): Ohne sie koennte die App nicht wissen,
    // dass fuer eine Reinigungsschicht kein Zeitbonus zu rechnen ist --
    // sie wuerde eine Zahl ausweisen, die es nicht gibt.
    'SELECT e.id, e.kunde_name, e.titel, e.strasse, e.ort, e.einsatzart, e.sparte,
            e.datum, e.von, e.bis, e.status, e.bemerkung,
            z.zusage, z.gesehen_am, o.name AS objekt_name,
            -- Der eigene Ist-Stand (ENT-049): damit die Person ihre
            -- geleistete Zeit selbst nachschlagen kann. Weiterhin strikt auf
            -- die eigene Zuteilung gefiltert -- fremde Ist-Zeiten sind hier
            -- so wenig sichtbar wie fremde Namen.
            z.ist_status, z.ist_von, z.ist_bis,
            z.ist_pause_von, z.ist_pause_min,
            z.ist_pause_bezahlt_ma, z.abgeglichen_am
     FROM einsatz_zuteilung z
     JOIN einsaetze e ON e.id = z.einsatz_id
     LEFT JOIN objekte o ON o.id = e.objekt_id
     WHERE z.mitarbeiter_id = ? AND e.datum BETWEEN ? AND ?
     ORDER BY e.datum, e.von'
);
$stmt->execute([(int)$user['id'], $von, $bis]);

$schichten = array_map(function ($e) {
    $e['id'] = (int)$e['id'];
    $e['ist_pause_min'] = $e['ist_pause_min'] === null ? null : (int)$e['ist_pause_min'];
    // null bleibt null: 'noch nicht festgestellt' ist etwas anderes als 'nein'
    // (GAV-AUS-004). Ein Cast auf int wuerde beides zu 0 machen.
    $e['ist_pause_bezahlt_ma'] = $e['ist_pause_bezahlt_ma'] === null
        ? null : (int)$e['ist_pause_bezahlt_ma'];
    return $e;
}, $stmt->fetchAll());

// Wie viele Kolleginnen und Kollegen sind sonst noch auf derselben Schicht?
// Nur die Anzahl, keine Namen -- das ist Planungsinformation, keine
// Personalauskunft.
$anzahl = [];
if ($schichten) {
    $ids = array_column($schichten, 'id');
    $marken = implode(',', array_fill(0, count($ids), '?'));
    $z = db()->prepare("SELECT einsatz_id, COUNT(*) AS n FROM einsatz_zuteilung
                        WHERE einsatz_id IN ($marken) GROUP BY einsatz_id");
    $z->execute($ids);
    foreach ($z->fetchAll() as $r) {
        $anzahl[(int)$r['einsatz_id']] = (int)$r['n'];
    }
}
foreach ($schichten as &$s) {
    $s['im_team'] = $anzahl[$s['id']] ?? 1;
}
unset($s);

json_response(['status' => 'ok', 'schichten' => $schichten, 'von' => $von, 'bis' => $bis]);
