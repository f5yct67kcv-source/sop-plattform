<?php
// Die eigenen Kontaktangaben selbst pflegen (ENT-460).
//
// Gegenstueck zu mein_profil.php, das seit ENT-023 bewusst nur lesen konnte:
// *"Ob Mitarbeitende ihre Stammdaten selbst aendern duerfen, ist offen
// (OP-21)."* Mit ENT-460 ist das entschieden -- sofort gueltig, ohne
// Freigabeschritt, dafuer mit Eintrag im Logbuch.
//
// Drei Festlegungen erklaeren den Aufbau:
//
//  1. SITZUNG STATT RECHT. Wie mein_passwort.php verlangt dieser Endpunkt
//     kein Recht aus rechte.php, sondern nur eine gueltige Sitzung -- und
//     schreibt ausschliesslich am Datensatz der anfragenden Person. Die
//     Zeile "WHERE id = ?" mit $user['id'] ist die ganze Zugriffsregel;
//     es gibt keinen Weg, ueber diesen Endpunkt einen fremden Datensatz zu
//     erreichen, weil nie eine ID aus der Anfrage gelesen wird.
//
//  2. WEISSE LISTE, KEINE SCHWARZE. Geschrieben wird nur, was in
//     ma_selbst_aenderbare_felder() steht. Eine Verbotsliste waere die
//     falsche Richtung: Ein spaeter ergaenztes Feld waere darin
//     versehentlich offen, statt versehentlich gesperrt.
//
//  3. BEI DER PRIVATEN E-MAIL DAS BISHERIGE PASSWORT. An email_privat
//     haengt der Rueckstellweg fuers Passwort (passwort_vergessen.php
//     schickt den Link dorthin, ersatzweise an die Geschaeftsadresse). Ohne
//     diese Frage waere ein unbeaufsichtigtes, angemeldetes Geraet kein
//     Aergernis mehr, sondern eine dauerhafte Kontouebernahme: Adresse
//     umbiegen, Passwort zuruecksetzen, fertig. Gefragt wird NUR, wenn die
//     Adresse sich tatsaechlich aendert -- eine Passwortabfrage beim
//     Ummelden der Wohnadresse waere Theater ohne Schutzwirkung.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$eigeneId = (int)$user['id'];
$erlaubt  = ma_selbst_aenderbare_felder();

// Sicherung gegen den Fehler, der in diesem Haus schon mehrfach passiert
// ist: Etwas NEUES erbt die Regel nicht. Dieser Endpunkt behandelt jedes
// Feld als freien Text -- das stimmt fuer die heutige Liste, waere aber
// still falsch, sobald jemand ein Datum, eine Auswahlliste oder einen
// Verweis ergaenzt (die brauchen die Pruefungen aus ma_eingabe_lesen()).
// Darum bricht er hier laut ab, statt einen ungeprueften Wert zu schreiben.
$felderTypen = ma_felder();
foreach ($erlaubt as $feld) {
    if (($felderTypen[$feld] ?? null) !== 'text') {
        json_response(['status' => 'error',
            'message' => "Feld $feld ist kein Textfeld und kann hier nicht gespeichert werden."], 500);
    }
}

// Vertrauliche Angaben duerfen hier unter keinen Umstaenden landen -- auch
// nicht, wenn jemand die weisse Liste erweitert, ohne an die Folge zu
// denken. Zweite Sperre neben der Liste selbst, absichtlich doppelt: Die
// Liste ist eine Entscheidung, diese Zeile ist ein Verbot.
$heikel = array_intersect($erlaubt, ma_vertrauliche_felder());
if ($heikel) {
    json_response(['status' => 'error',
        'message' => 'Vertrauliche Felder lassen sich nicht selbst ändern: '
            . implode(', ', $heikel)], 500);
}

// Laengen aus den Spaltendefinitionen (planung_einrichten.php). Ohne diese
// Pruefung kuerzt MySQL ausserhalb des strengen Modus stillschweigend --
// aus einer zu langen Strasse wuerde eine falsche, ohne Fehlermeldung.
const SELBST_MAXLAENGE = [
    'strasse' => 200, 'hausnummer' => 20, 'adresszusatz' => 200,
    'plz' => 10, 'ort' => 200, 'land' => 100,
    'telefon' => 50, 'mobil' => 50,
    'email_privat' => 200, 'notfallkontakt' => 200,
];

// Beschriftungen fuer die Rueckmeldung. Eine Fehlermeldung "strasse:
// hoechstens 200 Zeichen" liest sich wie ein Datenbankfehler und nicht wie
// ein Hinweis an die Person, die gerade umgezogen ist. Bewusst hier und
// nicht aus der Oberflaeche geholt: Der Server muss antworten koennen, auch
// wenn die Anfrage gar nicht aus app.html kam.
const SELBST_BESCHRIFTUNG = [
    'strasse' => 'Strasse', 'hausnummer' => 'Hausnummer',
    'adresszusatz' => 'Adresszusatz', 'plz' => 'PLZ', 'ort' => 'Ort',
    'land' => 'Land',
    // Seit ENT-466 gibt es EINE private Nummer, und sie steht in 'mobil'.
    // Auf dem Bildschirm heisst sie schlicht "Telefon" -- das Wort, das
    // alle sagen. 'telefon' ist die alte Festnetzspalte; sie taucht in
    // keiner Eingabe mehr auf und wird nur noch geleert.
    'telefon' => 'Festnetz (alt)', 'mobil' => 'Telefon',
    'email_privat' => 'E-Mail', 'notfallkontakt' => 'Notfallkontakt',
];

// Pflichtangaben (ENT-466). Der Projektinhaber: *"Ich würde zudem alle
// Felder als Pflichtfeld erfassen."* Zwei Felder stehen bewusst NICHT
// darin:
//
//   * adresszusatz -- die meisten haben keinen. Erzwungen traegt jemand
//     "-" oder "keiner" ein, und das steht danach dauerhaft in der
//     Adresszeile ("Musterweg 1, -, 9999 Musterstadt"). Ein erfundener
//     Wert ist schlechter als ein leerer, weil er wie eine Angabe aussieht.
//   * telefon -- die alte Festnetzspalte, seit ENT-466 nicht mehr auf dem
//     Bildschirm. Ein Pflichtfeld, das niemand sehen kann, waere eine
//     Sperre ohne Ausweg.
//
// Geprueft wird der Zustand NACH dem Speichern, nicht der Anfragerumpf:
// Eine Teilanfrage darf durch, solange der Datensatz danach vollstaendig
// ist. Sonst scheiterte ein Formular, das nur einen Abschnitt sendet.
const SELBST_PFLICHT = ['strasse', 'hausnummer', 'plz', 'ort', 'land',
    'mobil', 'email_privat', 'notfallkontakt'];

$input = json_decode(file_get_contents('php://input'), true) ?? [];
if (!is_array($input)) { $input = []; }

$vorher = db()->prepare('SELECT * FROM mitarbeiter WHERE id = ?');
$vorher->execute([$eigeneId]);
$bestand = $vorher->fetch(PDO::FETCH_ASSOC);
if (!$bestand) {
    json_response(['status' => 'error', 'message' => 'Konto nicht gefunden'], 404);
}

// Nur Spalten, die es in der Datenbank auch wirklich gibt: Vor dem
// Einrichtungslauf fehlen die neuen Adress- und Kontaktspalten noch, und
// ein UPDATE ueber eine fehlende Spalte scheitert komplett -- dann liesse
// sich gar nichts mehr speichern, statt bloss das eine neue Feld nicht.
$vorhanden = ma_vorhandene_felder(db());

$fehler = [];
$s = [];
foreach ($erlaubt as $feld) {
    if (!array_key_exists($feld, $input)) { continue; }
    if (!array_key_exists($feld, $vorhanden)) { continue; }
    $wert = trim((string)($input[$feld] ?? ''));
    if (mb_strlen($wert) > SELBST_MAXLAENGE[$feld]) {
        $fehler[] = (SELBST_BESCHRIFTUNG[$feld] ?? $feld) . ': höchstens '
            . SELBST_MAXLAENGE[$feld] . ' Zeichen';
        continue;
    }
    $s[$feld] = $wert;
}

// Eine private Nummer, nicht zwei (ENT-466). Bis dahin fuehrte die Akte
// Festnetz und Mobil getrennt; der Projektinhaber: *"2026 hat fast niemand
// mehr ein Festnetz."* Geschrieben wird nur noch 'mobil'. Steht in der
// alten Festnetzspalte noch etwas, wird sie beim ersten Speichern geleert
// -- sonst stuende dieselbe Nummer an zwei Stellen, genau der Zustand, der
// weggeraeumt werden sollte. Das Logbuch haelt beide Schritte fest.
if (array_key_exists('mobil', $s) && array_key_exists('telefon', $vorhanden)
    && trim((string)($bestand['telefon'] ?? '')) !== '') {
    $s['telefon'] = '';
}

// Pflichtangaben. Geprueft wird der Wert, der NACH dem Speichern in der
// Akte steht -- der neue, falls mitgeschickt, sonst der bestehende.
foreach (SELBST_PFLICHT as $pflicht) {
    if (!array_key_exists($pflicht, $vorhanden)) { continue; }
    $danach = array_key_exists($pflicht, $s)
        ? $s[$pflicht]
        : trim((string)($bestand[$pflicht] ?? ''));
    if ($danach === '') {
        $fehler[] = (SELBST_BESCHRIFTUNG[$pflicht] ?? $pflicht) . ' darf nicht leer sein';
    }
}

// Eine vertippte Adresse faellt sonst erst dann auf, wenn jemand sein
// Passwort zuruecksetzen will und die Mail ins Leere geht -- also genau
// dann, wenn er sie am dringendsten braucht.
if (array_key_exists('email_privat', $s) && $s['email_privat'] !== ''
    && !filter_var($s['email_privat'], FILTER_VALIDATE_EMAIL)) {
    $fehler[] = 'E-Mail: keine gültige Adresse';
}

// Beanstandungen VOR dem Hinweis auf eine leere Anfrage. Eine zu lange
// Eingabe landet nicht in $s -- stuende die Leerpruefung davor, meldete der
// Endpunkt "nichts mitgeschickt", obwohl sehr wohl etwas mitgeschickt
// wurde, nur eben zu lang. Eine falsche Begruendung ist schlimmer als gar
// keine: Sie schickt die Person auf die Suche nach dem falschen Fehler.
if ($fehler) {
    json_response(['status' => 'error', 'message' => implode('; ', $fehler)], 400);
}

if (!$s) {
    json_response(['status' => 'error',
        'message' => 'Es wurde nichts zum Speichern mitgeschickt.'], 400);
}

// Wechselt die private E-Mail, wird das bisherige Passwort verlangt (Grund
// oben, Punkt 3). Verglichen wird gegen den Bestand, nicht gegen "wurde
// mitgeschickt": Ein Formular sendet das unveraenderte Feld bei jedem
// Speichern mit, und eine Passwortabfrage beim Ummelden der Wohnadresse
// waere Theater.
$mailNeu = array_key_exists('email_privat', $s)
    && $s['email_privat'] !== trim((string)($bestand['email_privat'] ?? ''));
// Die Wiederholung wird HIER geprueft, nicht nur im Browser (ENT-466).
// Anlass ist ein tatsaechlicher Vorfall: ein Zahlendreher in der Adresse,
// und das Passwort liess sich danach nicht mehr zuruecksetzen. Eine
// Sperre, die nur im Browser sitzt, ist keine -- und der Browser ist
// genau die Stelle, an der ein Fehler den Vorfall ueberhaupt erst
// ermoeglicht hat.
//
// EHRLICHE GRENZE: Das faengt den Vertipper, nicht die gueltige, aber
// falsche Adresse. Dagegen hilft nur eine Bestaetigungsmail -- als
// eigener Punkt festgehalten, nicht hier angehaengt.
if ($mailNeu) {
    $wdh = trim((string)($input['email_privat2'] ?? ''));
    if ($wdh !== $s['email_privat']) {
        json_response(['status' => 'error', 'mail_wiederholung' => true,
            'message' => 'Die beiden E-Mail-Adressen stimmen nicht überein.'], 400);
    }
}

if ($mailNeu) {
    $pw = (string)($input['passwort'] ?? '');
    $hash = (string)($bestand['password_hash'] ?? '');
    if ($pw === '' || $hash === '' || !password_verify($pw, $hash)) {
        json_response(['status' => 'error', 'passwort_noetig' => true,
            'message' => 'Zum Ändern deiner E-Mail-Adresse ist dein Passwort nötig.'], 401);
    }
}

$sql = 'UPDATE mitarbeiter SET ' . implode(', ', array_map(fn($f) => "$f = ?", array_keys($s)))
     . ' WHERE id = ?';
db()->prepare($sql)->execute(array_merge(array_values($s), [$eigeneId]));

// Ins Logbuch -- mit dem Mitarbeitenden als Akteur (ENT-077 schreibt den
// Namen mit, nicht nur die ID). Damit sieht die Verwaltung in der
// Personalakte, WER wann WAS geaendert hat, ohne dafuer freigeben zu
// muessen: genau der Zuschnitt aus ENT-460.
logbuch_vergleichen(db(), $user, 'mitarbeiter', $eigeneId,
    $bestand, $s, ma_vertrauliche_felder());

json_response(['status' => 'ok', 'geaendert' => count($s)]);
