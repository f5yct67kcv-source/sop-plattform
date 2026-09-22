<?php
// Belegliste der Betreiberin, heute nur Offerten (ENT-605).
//
// Wie beleg_list.php im Cockpit: KEINE Positionen. Die Liste zeigt je Beleg
// nur Kopfdaten und die bereits gerechnete Gesamtsumme; Positionen holt
// betreiber_beleg_lesen.php einzeln beim Oeffnen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();

$art = (string)($_GET['art'] ?? 'offerte');
if (!beleg_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Belegart'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    // Nicht eingerichtet ist etwas anderes als "keine Offerten" -- zwei
    // Aussagen, zwei Texte (CLAUDE.md).
    json_response(['status' => 'ok', 'eingerichtet' => false, 'belege' => []]);
}

// Die Vertragsspalten (ENT-637) kommen ueber be_spalten_anlegen() nach.
// Zwischen Deploy und Einrichtungslauf gibt es sie nicht, und eine Abfrage,
// die sie dann nennt, liesse auch die Offertenliste ausfallen.
$kenntPerioden = hat_spalte($pdo, 'be_belege', 'total_monat_rappen');
$kenntLaufzeit = hat_spalte($pdo, 'be_belege', 'vertrag_beginn');
$extra = ($kenntPerioden ? ', b.total_monat_rappen, b.total_jahr_rappen' : '')
       . ($kenntLaufzeit ? ', b.vertrag_beginn, b.mindestlaufzeit_monate,
            b.kuendigungsfrist_monate, b.verlaengerung_monate' : '');

$s = $pdo->prepare(
    'SELECT b.id, b.art, b.nummer, b.kunde_id, b.person_id, b.titel, b.referenz,
            b.datum, b.gueltig_bis, b.faellig_bis, b.bezahlt, b.bezahlt_am, b.status,
            b.rabatt_bp, b.zwischensumme_rappen, b.rabatt_rappen, b.mwst_rappen,
            b.rundung_rappen, b.total_rappen, b.ist_vorlage, b.aktiv,
            b.erstellt_am, b.geaendert_am' . $extra . ',
            k.name AS kunde_name, k.kundennummer
       FROM be_belege b
       LEFT JOIN be_kunden k ON k.id = b.kunde_id
      WHERE b.art = ? AND b.ist_vorlage = 0
      ORDER BY b.datum DESC, b.id DESC'
);
$s->execute([$art]);

// Offene Aenderungswuensche (ENT-677). Zwei Zahlen, und sie sagen
// verschiedene Dinge: `aenderung` zaehlt die Belege DIESER Art -- das ist
// die Zahl am Reiter, an dem man sie findet. `aenderung_gesamt` zaehlt alle
// Arten und traegt die Uebersicht; ein Vertrag wird erst beim Oeffnen
// geladen und fehlte dort sonst lautlos.
//
// VOM SERVER GEZAEHLT und nicht aus der gelieferten Liste: Die Liste
// blendet Vorlagen aus und kann gefiltert werden. Eine Zahl, die etwas
// anderes zaehlt als sie sagt, ist schlimmer als keine.
$wunsch = ['aenderung' => 0, 'aenderung_gesamt' => 0];
try {
    $z = $pdo->prepare("SELECT SUM(art = ?) AS eigene, COUNT(*) AS alle
                          FROM be_belege WHERE status = 'aenderung' AND ist_vorlage = 0");
    $z->execute([$art]);
    $zeile = $z->fetch() ?: [];
    $wunsch = ['aenderung' => (int)($zeile['eigene'] ?? 0),
               'aenderung_gesamt' => (int)($zeile['alle'] ?? 0)];
} catch (Throwable $e) {
    // Kennt die Spalte den Wert noch nicht (Anlage vor dem
    // Einrichtungslauf), bleibt es bei null -- eine fehlende Zahl darf die
    // Liste nicht ausfallen lassen.
}

json_response([
    'status'          => 'ok',
    'eingerichtet'    => true,
    'belege'          => $s->fetchAll(),
    'aenderung'        => $wunsch['aenderung'],
    'aenderung_gesamt' => $wunsch['aenderung_gesamt'],
    'kennt_perioden'  => $kenntPerioden,
    'kennt_laufzeit'  => $kenntLaufzeit,
    'naechste_nummer' => beleg_naechste_nummer($pdo, $art, 'be_'),
]);
