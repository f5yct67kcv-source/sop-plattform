<?php
declare(strict_types=1);
// Die Mitteilungen aus Sicht der Verwaltung (ENT-421) -- alle, auch die
// abgelaufenen und archivierten, samt Lesestand.
//
// Getrennt von meine_mitteilungen.php und nicht als Zusatzschalter darin:
// Dort gilt "nur was mich angeht", hier "alles". Ein Endpunkt mit einem
// Schalter, der zwischen beidem umlegt, waere die Sorte Stelle, an der eine
// vergessene Rechtepruefung fremde Daten herausgibt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mitteilungen.php';

$user = require_session();
require_recht($user, 'mitteilungen');

$pdo = db();
if (!hat_tabelle($pdo, 'mitteilungen')) {
    // Nicht eingerichtet ist etwas anderes als "keine Mitteilungen" --
    // die Oberflaeche sagt beides verschieden (Hausregel).
    json_response(['status' => 'ok', 'eingerichtet' => false, 'mitteilungen' => []]);
}

$jetzt = date('Y-m-d H:i:s');

// Nur die Nummer? Dann mit den Namen derer, die gelesen haben. Bewusst ein
// eigener Zweig statt Namen an jeder Zeile der Liste: Bei 40 Mitteilungen
// mal 30 Personen waeren das 1200 Zeilen fuer eine Ansicht, in der man
// jeweils EINE Mitteilung aufklappt.
$detail = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($detail > 0) {
    $st = $pdo->prepare(
        'SELECT m.vorname, m.nachname, m.name, g.gelesen_am, g.bestaetigt_am
           FROM mitteilung_gelesen g
           JOIN mitarbeiter m ON m.id = g.mitarbeiter_id
          WHERE g.mitteilung_id = ?
          ORDER BY g.gelesen_am'
    );
    $st->execute([$detail]);
    json_response(['status' => 'ok', 'eingerichtet' => true, 'leser' => $st->fetchAll()]);
}

$st = $pdo->query(
    'SELECT m.id, m.titel, m.text, m.zielgruppe, m.stufe,
            m.sichtbar_ab, m.sichtbar_bis, m.erstellt_am, m.archiviert_am,
            m.verfasser_name,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id) AS gelesen_anzahl,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id AND g.bestaetigt_am IS NOT NULL) AS bestaetigt_anzahl
       FROM mitteilungen m
      ORDER BY m.erstellt_am DESC, m.id DESC'
);
$liste = $st->fetchAll();

// Der Nenner zu "12 von 18". Zwei Werte, einer je Zielgruppe -- einmal
// gezaehlt statt einmal je Zeile.
$nenner = [];
foreach (MITTEILUNG_ZIELGRUPPEN as $z) { $nenner[$z] = mitteilung_empfaengerzahl($pdo, $z); }

foreach ($liste as &$m) {
    $m['gelesen_anzahl']     = (int)$m['gelesen_anzahl'];
    $m['bestaetigt_anzahl']  = (int)$m['bestaetigt_anzahl'];
    // -1 bedeutet unbekannt (siehe mitteilung_empfaengerzahl) und bleibt
    // -1: Die Oberflaeche muss den Unterschied zu 0 zeigen koennen.
    $m['empfaenger_anzahl']  = $nenner[$m['zielgruppe']] ?? -1;
    // Laeuft diese Mitteilung gerade? Aus derselben Regel wie in der App
    // (mitteilung_sichtbar_fuer), nur ohne Personenbezug: Die Verwaltung
    // sieht den Zustand der Mitteilung, nicht ihre eigene Sicht darauf.
    $m['archiviert'] = $m['archiviert_am'] !== null;
    $m['laeuft']     = mitteilung_sichtbar_fuer(
        // Zielgruppe fuer diese Frage ausklammern: Ob eine Revier-
        // Mitteilung laeuft, haengt am Zeitfenster, nicht daran, ob die
        // gerade angemeldete Person selbst Revierdienst macht.
        ['archiviert_am' => $m['archiviert_am'], 'zielgruppe' => 'alle',
         'sichtbar_ab' => $m['sichtbar_ab'], 'sichtbar_bis' => $m['sichtbar_bis']],
        true, $jetzt
    );
    $m['geplant'] = !$m['archiviert'] && $m['sichtbar_ab'] !== null && $m['sichtbar_ab'] > $jetzt;
}
unset($m);

json_response(['status' => 'ok', 'eingerichtet' => true, 'mitteilungen' => $liste, 'jetzt' => $jetzt]);
