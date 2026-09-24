<?php
// Den Vorrat vorbereiteter Anlagen pruefen und melden, wenn er zu klein wird
// (ENT-686).
//
// ZWEI WEGE HEREIN, EIN RECHENKERN -- wie api/betreiber_demo_ablauf.php:
//   - Der Zeitgeber (Hostpoint-Cronjob, einmal taeglich) ruft mit dem
//     Schluessel aus dem Deploy auf, ohne Anmeldung.
//   - Ein Betreiber kann den Stand jederzeit ansehen; dann zaehlt seine
//     Sitzung mit bestaetigtem zweitem Faktor.
//
// GET LIEFERT NUR DEN STAND, POST MELDET. Eine Mail per GET waere von jedem
// Vorschau-Dienst ausloesbar, der Links aufruft.
//
// WARUM DIESER ENDPUNKT ZU MANDANTENDATENBANKEN VERBINDET (Eintrag in
// DARF_VERBINDEN, test_betreiber.mjs): Er prueft jede Vorratsanlage auf
// Erreichbarkeit und ihren ganzen Bauplan. Das ist der urspruenglich
// erlaubte Zweck der Verbindung -- Erreichbarkeit und Einrichtungsstand --,
// und er liest keine Verwaltungstabelle. Vorratsanlagen gehoeren ohnehin
// noch keinem Kunden.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../planung_einrichten_kern.php'; // kern_schema_fehlend()
require_once __DIR__ . '/../supportvorgang.php';          // sv_empfaenger()

// DERSELBE SCHLUESSEL WIE BEIM DEMO-ABLAUF: Es ist derselbe Cron-Dienst beim
// Hoster, und dieselbe Ueberlegung steht schon am Demo-Ablauf selbst. Der
// Deploy setzt ihn per sed ein, NUR im Betreiber-Buendel -- darum steht
// der Platzhalter zerlegt da, und das sed sucht genau diese zerlegte Form
// (Begruendung und Vorgeschichte: betreiber_demo_ablauf.php).
$schluessel = (string)($_GET['schluessel'] ?? '');
$erwartet = '__VORRAT_ZEITGEBER' . '_TOKEN__';
$lage = mandant_vorrat_zeitgeber_lage($erwartet, $schluessel);
$perZeitgeber = $lage === 'ok';

// Schluessel mitgegeben, aber hier keiner eingerichtet: genau das sagen,
// statt "kein Token" aus der Sitzungspruefung.
if ($lage === 'nicht_eingerichtet' && $schluessel !== '') {
    json_response(['status' => 'error',
        'message' => 'Der Zeitgeber-Schlüssel ist auf diesem Server nicht eingerichtet. '
                   . 'Secret DEMO_ABLAUF_TOKEN setzen und neu deployen.'], 503);
}

if (!$perZeitgeber) {
    // Ein FALSCHER Schluessel ist etwas anderes als gar keiner und wird
    // abgewiesen, statt in die Sitzungspruefung zu rutschen: Wer es mit einem
    // Schluessel versucht, ist kein Mensch am Bildschirm.
    if ($lage === 'falscher_schluessel') {
        json_response(['status' => 'error', 'message' => 'kein Zugang'], 403);
    }
    require_betreiber_voll();
}

$stamm = betreiber_db();
if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}
// Der Status "vorrat" kommt mit einem Nachtrag (be_auswahlwerte). Solange er
// fehlt, kann keine Anlage im Vorrat stehen -- und das ist "nicht
// eingerichtet", nicht "leerer Vorrat". Zwei Aussagen, zwei Texte.
if (!mandant_vorrat_status_da($stamm)) {
    json_response(['status' => 'error',
        'message' => 'Der Vorrat ist in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

// ── Jede Vorratsanlage einzeln pruefen ────────────────────────────────
//
// DIE SCHLEIFE STEHT HIER, nicht in betreiber.php: Sie verbindet zu den
// Anlagen, und die Wache ueber mandant_db()-Aufrufer (test_betreiber.mjs)
// sieht nur, was im Endpunkt selbst oder in einem eigenen Modul steht.
//
// ALLE werden angesehen, nicht bis zur ersten brauchbaren -- dieselbe Lehre
// wie bei demo_zugang_einrichten(): Ein Vorrat, der lautlos schrumpft, faellt
// erst auf, wenn er leer ist. Jede untaugliche Anlage steht mit ihrem Grund
// im Ergebnis.
//
// GELESEN WIRD NUR DER BAUPLAN (kern_schema_fehlend, aus information_schema).
// Keine Verwaltungstabelle. Ob in einer Vorratsanlage schon jemand steht,
// prueft diese Schleife bewusst NICHT: Das duerfte sie von der
// Betreiber-Ebene aus gar nicht, und die Sperre dagegen sitzt im Einloeseweg.
$plaetze = [];
foreach (mandant_vorrat_zeilen($stamm) as $m) {
    $verbindung = mandant_verbindung_bereit($m);
    $luecken = null;
    if ($verbindung === 'bereit') {
        try {
            $anlage = mandant_db($m);
            $luecken = kern_schema_fehlend($anlage);
        } catch (Throwable $e) {
            $verbindung = 'fehlgeschlagen';
        }
    }
    $plaetze[] = ['id' => (int)$m['id'], 'name' => (string)$m['name']]
               + mandant_vorrat_befund($verbindung, $luecken);
}
$vorrat = mandant_vorrat_zusammenfassen($plaetze);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'ok'] + $vorrat);
}

// ── Melden ────────────────────────────────────────────────────────────
//
// DER VERSAND DARF DEN LAUF NIE SCHEITERN LASSEN, und er darf auch nicht
// verschweigen, dass er nichts erreicht hat. Die Antwort sagt darum, was
// tatsaechlich geschah -- der Zeitgeber protokolliert sie.
$meldung = mandant_vorrat_meldung($vorrat);
if ($meldung === null) {
    json_response(['status' => 'ok', 'gemeldet' => 'nicht_noetig'] + $vorrat);
}
if (!smtp_konfiguriert()) {
    json_response(['status' => 'ok', 'gemeldet' => 'kein_versand'] + $vorrat);
}
$empfaenger = sv_empfaenger($stamm);
if ($empfaenger === []) {
    json_response(['status' => 'ok', 'gemeldet' => 'niemand_da'] + $vorrat);
}

$e = static fn(string $w): string => htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$html = '<div style="' . $schrift . ';color:#14161A;max-width:560px">'
      . '<p style="' . $schrift . ';margin:0;white-space:pre-line">' . $e($meldung['text']) . '</p>'
      . '</div>';

$erreicht = 0;
foreach ($empfaenger as $an) {
    try {
        smtp_senden((string)$an['email'], (string)$an['name'], $meldung['betreff'], $html, $meldung['text']);
        $erreicht++;
    } catch (Throwable $ex) {
        // Einer, der nicht ankommt, haelt die uebrigen nicht auf.
    }
}
json_response(['status' => 'ok',
               'gemeldet' => $erreicht > 0 ? 'versandt' : 'versand_fehlgeschlagen',
               'erreicht' => $erreicht] + $vorrat);
