<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();

// Admins sehen alle Rapporte (Uebersicht/Rechnungsstellung), normale
// Mitarbeitende nur die eigenen -- Kundendaten anderer Einsaetze gehen
// einen einzelnen Mitarbeitenden nichts an.
// einsatz_id/mitarbeiter_id werden mitgeliefert, damit App und Dashboard
// einen Schicht-Rapport seiner Zuteilung zuordnen koennen (ENT-082). Ein
// manueller Rapport traegt einsatz_id weiterhin als NULL.
// Kundenstammdaten fuer den Ausdruck kommen MIT dem Rapport (ENT-155) und
// werden nicht in der Oberflaeche aus einsaetze/kunden zusammengesucht: beide
// Listen werden dort erst beim Oeffnen ihrer Ansicht geladen. Wer direkt
// unter "Rapporte" druckt, haette sonst je nach zuvor besuchter Ansicht mal
// eine Kundennummer auf dem Blatt und mal nicht -- ein Unterschied, den
// niemand sieht und niemand erklaeren kann.
//
// Der Weg ist ausschliesslich r.einsatz_id -> einsaetze.kunde_id. Ueber den
// Kundennamen zu verknuepfen waere bequem und falsch: Namen wiederholen sich
// und aendern sich, und der Treffer landet als Rechnungsadresse auf einem
// Beleg, der Richtung Rechnung geht. Ein manuell erfasster Rapport bleibt
// darum ohne Kundenstamm -- und das Blatt laesst die Zeilen dann weg.
//
// ── Warum diese Liste seit dem Lasttest (09.09.2026) begrenzt ist ──────
//
// Bis dahin lieferte sie JEDEN Rapport, den es je gab, samt Unterschriftsbild.
// Gemessen an einem Jahrgang eines Betriebs mit 50 Kunden (32 108 Rapporte):
// 108 MB Antwort, 348 MB Spitzenspeicher in PHP. Mit dem ueblichen
// Speicherlimit stirbt der Endpunkt dabei -- im Lasttest endete JEDER Aufruf
// mit HTTP 500, und zwar unabhaengig von der Last. Nicht langsam: kaputt.
//
// Zwei Aenderungen daran:
//
//  1. Das Unterschriftsbild geht nicht mehr mit. Es ist im Mittel 2,8 kB
//     Base64 und wird in der Uebersicht nur als Ja/Nein gebraucht -- dafuer
//     steht jetzt hat_unterschrift da. Wer das Bild wirklich braucht (Druck,
//     PDF, Schublade), holt den einen Rapport ueber rapport_lesen.php.
//     Allein das bringt 108 MB auf 19,8 MB.
//
//  2. Es gibt einen Zeitraum und eine Obergrenze. Wichtig dabei: Eine
//     gekuerzte Liste darf NIE wie eine vollstaendige aussehen -- die Antwort
//     sagt darum mit 'gesamt' und 'gekuerzt' ausdruecklich, wie viel es
//     wirklich gibt. Jede Ansicht, die etwas anderes als "die neuesten"
//     braucht, fragt gezielt danach (Kunde, Zeitraum), statt aus einer
//     abgeschnittenen Gesamtliste zu filtern.

// Der Server begrenzt, nicht die Oberflaeche: Was der Browser mitschickt,
// darf die Grenze senken, nie anheben (Hausregel -- eine Sperre, die man am
// Browser vorbei umgehen kann, ist keine).
const RAPPORT_GRENZE_VORGABE = 2000;
const RAPPORT_GRENZE_MAX     = 5000;

$grenze = (int)($_GET['grenze'] ?? RAPPORT_GRENZE_VORGABE);
if ($grenze <= 0) { $grenze = RAPPORT_GRENZE_VORGABE; }
$grenze = min($grenze, RAPPORT_GRENZE_MAX);

$wo    = [];
$werte = [];

$datum = static function (string $roh): ?string {
    $roh = trim($roh);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $roh) ? $roh : null;
};
$von = $datum((string)($_GET['von'] ?? ''));
$bis = $datum((string)($_GET['bis'] ?? ''));
// Ohne Praefix: Diese Bedingungen laufen in der Unterabfrage weiter unten,
// also direkt auf rapporte und nicht auf einem Verbund-Alias.
if ($von !== null) { $wo[] = 'datum >= ?'; $werte[] = $von; }
if ($bis !== null) { $wo[] = 'datum <= ?'; $werte[] = $bis; }

// Nach Kundenname, fuer die Kundendetailseite. Ueber den NAMEN, weil
// rapporte.kunde ein Textfeld ohne echten Verweis ist -- dasselbe Risiko wie
// beim Rapportzaehler (ENT-040), aber dieselbe Verknuepfung, die die
// Oberflaeche bisher selbst gebildet hat. Hier wird sie nur an die Stelle
// verlegt, an der sie die Datenmenge auch begrenzen kann.
$kunde = trim((string)($_GET['kunde'] ?? ''));
if ($kunde !== '') { $wo[] = 'kunde = ?'; $werte[] = $kunde; }

// Ein Einzelabruf nach Einsatz und Person -- das braucht der Abgleich, um
// den Schicht-Rapport an der Zeile zu finden (ENT-082).
$einsatzId = (int)($_GET['einsatz_id'] ?? 0);
if ($einsatzId > 0) { $wo[] = 'einsatz_id = ?'; $werte[] = $einsatzId; }

$kundenFelder = ', e.kunde_id AS kunde_id, k.kundennummer AS kunde_nr,
        k.name AS k_name, k.strasse AS k_strasse, k.hausnummer AS k_hausnummer,
        k.adresszusatz AS k_adresszusatz, k.plz AS k_plz, k.ort AS k_ort,
        k.re_name, k.re_zusatz, k.re_strasse, k.re_hausnummer, k.re_plz, k.re_ort';
$kundenJoin = ' LEFT JOIN einsaetze e ON e.id = r.einsatz_id
                LEFT JOIN kunden k ON k.id = e.kunde_id';

// hat_unterschrift statt der Unterschrift selbst -- siehe oben. Als echtes
// Ja/Nein und nicht als "1"/"0": Die Oberflaeche prueft darauf, und "0" ist
// als Zeichenkette wahr.
$basis = 'SELECT r.id, r.datum, r.mitarbeiter_id, r.einsatz_id, m.name AS mitarbeiter, r.kunde, r.strasse, r.ort, r.auftrag_nr,
               r.einsatzart, r.von, r.bis, r.pause_min, r.netto_h, r.unterzeichner,
               r.hat_unterschrift, r.bemerkung, r.erfasst_am';
// Dieselbe Auswahl, aber ohne Verbund -- fuer die Unterabfrage weiter unten
// und fuer das Zaehlen.
$rapportSpalten = 'id, datum, mitarbeiter_id, einsatz_id, kunde, strasse, ort, auftrag_nr,
               einsatzart, von, bis, pause_min, netto_h, unterzeichner,
               (unterschrift IS NOT NULL) AS hat_unterschrift, bemerkung, erfasst_am';

// Wer die Ist-Zeiten abgleicht, sieht alle Rapporte. Alle anderen sehen
// ausschliesslich die eigenen -- auch die Personalrolle, denn ein Rapport
// ist Arbeitszeit und keine Personalakte (ENT-077).
//
// Die Kundenstammdaten haengen an derselben Grenze: Sie gehen nur an den
// Zugang, der ohnehin alle Rapporte sieht und Kundenberichte druckt. Ein
// einzelner Mitarbeitender braucht die Rechnungsadresse seines Einsatzortes
// nicht -- und was nicht ausgeliefert wird, kann auch nicht abfliessen.
$alle = darf($user, 'abgleich_lesen');
if (!$alle) {
    $wo[] = 'mitarbeiter_id = ?';
    $werte[] = (int)$user['id'];
}

// Die Bedingungen liegen ALLE auf rapporte selbst (Datum, Kunde, Einsatz,
// eigene Person) -- keine davon auf einer verbundenen Tabelle. Sie stehen
// darum ohne Alias da und wandern unveraendert in die Unterabfrage.
$bedingung = $wo ? (' WHERE ' . implode(' AND ', $wo)) : '';

// Wie viele es WIRKLICH gibt -- ohne diese Zahl liesse sich nicht sagen, ob
// die Liste vollstaendig ist. Gezaehlt wird ohne jeden Verbund: Er aendert
// an der Zeilenzahl nichts (Schluesselverbund bzw. LEFT JOIN) und kostet nur.
$zaehler = db()->prepare('SELECT COUNT(*) FROM rapporte' . $bedingung);
$zaehler->execute($werte);
$gesamt = (int)$zaehler->fetchColumn();

// Erst begrenzen, dann verbinden -- dieselbe Umstellung wie im Ereignis-Feed
// (siehe backend/ereignisse.php). Mit dem Verbund zuerst begann MariaDB beim
// Personalstamm und sortierte alle 32 108 Rapporte, um 2 000 auszugeben:
// 130 633 gelesene Zeilen, 1,3 s. So sind es die 2 000 aus dem Index und
// danach je Zeile ein Schluesselzugriff.
$sql = $basis . ($alle ? $kundenFelder : '')
     . ' FROM (SELECT ' . $rapportSpalten . ' FROM rapporte' . $bedingung
     . ' ORDER BY datum DESC, id DESC LIMIT ' . $grenze . ') r'
     . ' JOIN mitarbeiter m ON m.id = r.mitarbeiter_id'
     . ($alle ? $kundenJoin : '')
     . ' ORDER BY r.datum DESC, r.id DESC';
$stmt = db()->prepare($sql);
$stmt->execute($werte);
$rows = $stmt->fetchAll();

foreach ($rows as &$r) {
    $r['hat_unterschrift'] = (bool)$r['hat_unterschrift'];
}
unset($r);

json_response([
    'status'    => 'ok',
    'rapporte'  => $rows,
    // Drei Angaben statt einer Liste: wie viele es gibt, wie viele davon
    // hier stehen, und ob etwas fehlt. Die Oberflaeche muss den Unterschied
    // zwischen "das sind alle" und "das sind die neuesten" hinschreiben
    // koennen.
    'gesamt'    => $gesamt,
    'grenze'    => $grenze,
    'gekuerzt'  => $gesamt > count($rows),
    'von'       => $von,
    'bis'       => $bis,
]);
