<?php
// Die eigenen Stammdaten (ENT-023).
//
// Frueher stand hier: *"Ob Mitarbeitende ihre Stammdaten selbst aendern
// duerfen, ist offen (OP-21). Bis das entschieden ist, gibt es hier bewusst
// kein Schreiben."* Mit ENT-460 ist OP-21 entschieden. Geschrieben wird
// weiterhin nicht HIER, sondern in mein_profil_speichern.php -- Lesen und
// Schreiben bleiben getrennte Endpunkte, wie ueberall im Haus.
//
// Dieser Endpunkt liefert zusaetzlich mit, WELCHE Felder die Person selbst
// aendern darf. Die Oberflaeche fuehrt diese Liste damit nicht ein zweites
// Mal: Waere sie in app.html noch einmal aufgeschrieben, liefe sie
// zwangslaeufig irgendwann auseinander -- und der Mitarbeitende saehe ein
// Eingabefeld fuer etwas, das der Server danach zurueckweist.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();

// Die Adress- und Kontaktspalten sind erst mit dem Einrichtungslauf
// dazugekommen. Ein SELECT ueber eine fehlende Spalte scheitert komplett --
// dann waere nicht bloss ein Feld leer, sondern das ganze Profil weg, und
// mit ihm die Kopfzeile der App. Darum wird die Feldliste aus dem geprueft,
// was die Datenbank tatsaechlich hat.
$immer   = ['name', 'ist_admin', 'personalnummer', 'anrede', 'vorname', 'nachname',
            'geburtsdatum', 'strasse', 'ort', 'telefon', 'mobil', 'email',
            'erstellt_am', 'revierdienst_berechtigt'];
$moeglich = ['hausnummer', 'adresszusatz', 'plz', 'land', 'email_privat',
             'notfallkontakt', 'notfallkontakt_tel'];
$vorhanden = ma_vorhandene_felder(db());
$spalten = array_merge($immer, array_values(array_filter(
    $moeglich, fn($f) => array_key_exists($f, $vorhanden)
)));

$stmt = db()->prepare(
    'SELECT ' . implode(', ', $spalten) . ' FROM mitarbeiter WHERE id = ?'
);
$stmt->execute([(int)$user['id']]);
$m = $stmt->fetch();
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Konto nicht gefunden'], 404);
}
$m['ist_admin'] = (bool)$m['ist_admin'];
// Steuert seit ENT-284, ob der Waechter-Reiter in der App erscheint
// (waechterSichtbar()) -- bewusst gesetzte Berechtigung statt Herleitung
// aus der Schicht-Historie.
$m['revierdienst_berechtigt'] = (bool)$m['revierdienst_berechtigt'];

// Die frueher hier gerechnete Monatssumme aus den Rapporten ist mit ENT-049
// entfallen. Grund (vom Projektinhaber): Der Rapport kennt die tatsaechliche
// Pausenabrechnung noch nicht -- die entsteht erst im Abgleich. Zwei
// Stundenzahlen fuer denselben Monat waeren fuer Mitarbeitende nicht
// aufloesbar gewesen. Massgeblich ist die abgeglichene Schichtzeit; sie
// kommt aus meine_schichten.php.
// Nur Felder, die es in der Datenbank auch gibt: Vor dem Einrichtungslauf
// waere ein Eingabefeld fuer eine fehlende Spalte ein Versprechen, das der
// Server beim Speichern nicht halten kann.
$aenderbar = array_values(array_filter(
    ma_selbst_sichtbare_felder(), fn($f) => array_key_exists($f, $vorhanden)
));

json_response([
    'status' => 'ok',
    'profil' => $m,
    'selbst_aenderbar' => $aenderbar,
]);
