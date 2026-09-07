<?php
// Kundenzugaenge fuer die Verwaltung auflisten (ENT-441).
//
// GET -> { status, zugaenge: [...] }
//
// Bereich 'portal' und nicht 'kunden': Wer Adressen pflegt, muss darum nicht
// sehen koennen, wer von aussen ins System schauen darf (Begruendung im
// Bereichskatalog). Stufe LESEN -- angelegt und gesperrt wird in
// kundenzugang_save.php, das die Stufe SCHREIBEN verlangt. Ohne diese
// Trennung waere die Lesestufe wertlos (siehe require_recht_nach_methode).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../kundenportal.php';

$user = require_session();
require_recht($user, 'portal_' . STUFE_LESEN);

$pdo = db();
if (!kp_tabellen_da($pdo)) {
    // Nicht als leere Liste ausgeben: "noch nicht eingerichtet" und "keine
    // Zugaenge" sind zwei verschiedene Aussagen (Hausregel).
    json_response(['status' => 'ok', 'zugaenge' => [], 'eingerichtet' => false]);
}

// kunde_aktiv wird mitgegeben, damit die Oberflaeche einen Zugang zu einem
// stillgelegten Kunden kennzeichnen kann. Der Zugang selbst bleibt davon
// unberuehrt (offene Frage in ENT-441) -- aber wer die Liste ansieht, soll
// den Fall sehen, statt ihn zu erraten.
$sql = 'SELECT z.id, z.kunde_id, z.name, z.email, z.funktion, z.aktiv,
               z.erstellt_am, z.gesperrt_am, z.letzter_zugriff,
               k.name AS kunde_name, k.aktiv AS kunde_aktiv,
               m.vorname AS von_vorname, m.nachname AS von_nachname,
               (SELECT COUNT(*) FROM kunden_sessions s WHERE s.zugang_id = z.id) AS sitzungen
          FROM kundenzugang z
          JOIN kunden k ON k.id = z.kunde_id
     LEFT JOIN mitarbeiter m ON m.id = z.erstellt_von
      ORDER BY k.name, z.name';
$zeilen = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

$zugaenge = [];
foreach ($zeilen as $z) {
    $von = trim(((string)($z['von_vorname'] ?? '')) . ' ' . ((string)($z['von_nachname'] ?? '')));
    $zugaenge[] = [
        'id'              => (int)$z['id'],
        'kunde_id'        => (int)$z['kunde_id'],
        'kunde_name'      => (string)$z['kunde_name'],
        'kunde_aktiv'     => (int)($z['kunde_aktiv'] ?? 1) === 1,
        'name'            => (string)$z['name'],
        'email'           => (string)$z['email'],
        'funktion'        => (string)($z['funktion'] ?? ''),
        'aktiv'           => (int)$z['aktiv'] === 1,
        'erstellt_am'     => $z['erstellt_am'],
        'erstellt_von'    => $von !== '' ? $von : null,
        'gesperrt_am'     => $z['gesperrt_am'],
        // NULL heisst "noch nie angemeldet" -- und das ist etwas anderes
        // als "lange nicht mehr da gewesen". Die Oberflaeche muss beides
        // unterscheiden koennen, darum bleibt hier NULL stehen statt eines
        // Ersatzdatums.
        'letzter_zugriff' => $z['letzter_zugriff'],
        'sitzungen'       => (int)$z['sitzungen'],
    ];
}

json_response(['status' => 'ok', 'zugaenge' => $zugaenge, 'eingerichtet' => true]);
