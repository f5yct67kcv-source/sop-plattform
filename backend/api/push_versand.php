<?php
declare(strict_types=1);
// Nachzuegler-Versand fuer vorbereitete Mitteilungen (ENT-424).
//
// Die eben veroeffentlichte Mitteilung loest den Versand direkt beim
// Speichern aus (mitteilung_save.php). Eine mit "sichtbar ab" in der
// Zukunft kann das nicht -- niemand ist zu diesem Zeitpunkt am Werkzeug.
// Dieser Endpunkt holt das nach.
//
// ZWEI WEGE HINEIN, und sie sind verschieden abgesichert:
//
//  1. ZEITGEBER (Hostpoint-Cronjob). Ruft die Adresse mit ?schluessel=…
//     auf. Der Schluessel wird beim Deploy gesetzt; ohne ihn ist dieser
//     Weg zu. KEINE Sitzung noetig -- ein Cronjob hat keine.
//  2. ANGEMELDETE PERSON mit dem Recht 'mitteilungen'. Damit sich der
//     Versand von Hand ausloesen und der Zustand ansehen laesst, ohne auf
//     den Zeitgeber zu warten.
//
// WARUM BEIDES: Ein Zeitgeber, den niemand eingerichtet hat, ist eine
// stille Luecke -- die vorbereitete Mitteilung erschiene in der App, aber
// das Telefon klingelte nie. Als Rueckfall holt darum die Mitteilungsseite
// im Cockpit den Nachlauf beilaeufig nach (mitteilung_list.php).
//
// BEWUSST NICHT in meine_mitteilungen.php: Dort wartete eine Mitarbeiterin
// beim Oeffnen der App darauf, dass ihr Telefon dreissig Push-Dienste
// anschreibt. Der Beilaeufer gehoert dorthin, wo ohnehin die Verwaltung
// sitzt und eine Sekunde nicht stoert -- nicht in den Weg der Leute
// draussen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../push.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../supportvorgang.php';
require_once __DIR__ . '/../mitarbeiter.php';   // ma_austritt_erinnerung_versenden() (ENT-598)

// Beim Deploy ersetzt. Ungesetzt heisst: Der Zeitgeber-Weg ist zu.
const PUSH_ZEITGEBER_SCHLUESSEL = '__PUSH_CRON_SCHLUESSEL__';

// Verschickt die Sammel-Erinnerung an alle mit 'personal_schreiben' -- genau
// die Rolle, die Austrittsdatum und Kontostatus ohnehin pflegt (ENT-598).
// ma_austritt_erinnerung_faellige() (mitarbeiter.php) uebernimmt die
// atomare Zuteilung; hier steht nur, WER die Mail bekommt und WIE sie
// aussieht -- rechte.php und mailer.php sind in dieser Datei ohnehin schon
// eingebunden.
function austritt_erinnerung_versenden(PDO $pdo): array
{
    try {
        $faellig = ma_austritt_erinnerung_faellige($pdo);
    } catch (Throwable $e) {
        return ['versendet' => 0, 'fehler' => db_fehlermeldung($e)];
    }
    if (!$faellig) { return ['versendet' => 0]; }

    $empfaenger = rechte_mitarbeiter_mit_recht($pdo, 'personal_schreiben');
    if (!$empfaenger) { return ['versendet' => 0, 'betroffen' => count($faellig), 'ohne_empfaenger' => true]; }

    $zeilen = array_map(function ($m) {
        $name = trim(($m['vorname'] ?? '') . ' ' . ($m['nachname'] ?? '')) ?: $m['name'];
        return $name . ' — Austritt am ' . date('d.m.Y', strtotime((string)$m['austritt']));
    }, $faellig);

    $betreff = count($faellig) === 1
        ? 'Ausgetretenes Konto noch aktiv'
        : count($faellig) . ' ausgetretene Konten noch aktiv';
    $text = "Folgende Konten sind laut Austrittsdatum nicht mehr im Betrieb, aber noch aktiv:\n\n"
        . implode("\n", $zeilen)
        . "\n\nBitte pruefen und bei Bedarf deaktivieren.";
    $esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $html = '<p>Folgende Konten sind laut Austrittsdatum nicht mehr im Betrieb, aber noch aktiv:</p>'
        . '<ul>' . implode('', array_map(fn($z) => '<li>' . $esc($z) . '</li>', $zeilen)) . '</ul>'
        . '<p>Bitte prüfen und bei Bedarf deaktivieren.</p>';

    $versendet = 0;
    foreach ($empfaenger as $p) {
        $name = trim(($p['vorname'] ?? '') . ' ' . ($p['nachname'] ?? '')) ?: $p['name'];
        try {
            smtp_senden((string)$p['email'], $name, $betreff, $html, $text);
            $versendet++;
        } catch (Throwable $e) {
            // Ein Fehlschlag bei einer Empfaengerin darf die anderen nicht
            // verhindern -- jede Adresse ist ein eigener Versand.
            continue;
        }
    }
    return ['versendet' => $versendet, 'betroffen' => count($faellig)];
}

$mitgegeben = (string)($_GET['schluessel'] ?? '');
$lage = push_zeitgeber_lage(PUSH_ZEITGEBER_SCHLUESSEL, $mitgegeben);

// Die drei Fehlerlagen sagen, WAS zu tun ist -- jede verlangt einen
// anderen Handgriff an einer anderen Stelle. Beim Einrichten kamen sie
// alle als "kein Token" heraus (die Meldung der Sitzungspruefung, in die
// der Aufruf hineinlief), und das Suchen ging in die falsche Richtung.
//
// Nur wer einen Schluessel MITGIBT, bekommt diese Antworten. Wer keinen
// mitgibt, laeuft weiter in die Sitzungspruefung -- das ist der Weg fuer
// die angemeldete Person aus dem Cockpit, und der darf nicht erfahren,
// dass es einen zweiten Weg gibt.
if ($lage === 'nicht_eingerichtet' && $mitgegeben !== '') {
    json_response(['status' => 'error', 'zeitgeber' => $lage,
        'message' => 'Der Zeitgeber-Zugang ist auf dem Server nicht eingerichtet — '
            . 'das Secret PUSH_CRON_SCHLUESSEL fehlt, oder seit dem Setzen ist kein Deploy gelaufen.'], 401);
}
if ($lage === 'falscher_schluessel') {
    json_response(['status' => 'error', 'zeitgeber' => $lage,
        'message' => 'Der Schlüssel in der Adresse stimmt nicht mit dem hinterlegten überein.'], 401);
}

if ($lage !== 'ok') {
    // Kein Schluessel mitgegeben: dann muss es eine angemeldete Person mit
    // dem Recht sein. require_session() beendet mit 401, require_recht mit
    // 403 -- beides bevor irgendetwas verschickt wird.
    $user = require_session();
    require_recht($user, 'mitteilungen_schreiben');
    // NUR fuer diesen Weg: der Zeitgeber-Weg oben BLEIBT GET, weil ein
    // Hostpoint-Cronjob nichts anderes kann als eine Adresse aufzurufen
    // (siehe README) -- dort ist das kein Versehen, sondern die einzige
    // Form, die ein Cronjob hat, und durch den zeitsicher verglichenen
    // Schluessel abgesichert. Der angemeldete Weg dagegen hat diesen Zwang
    // nicht: er braucht nur einen echten Klick aus dem Cockpit. Ein GET mit
    // Schreibwirkung laesst sich durch einen blossen Linkaufruf (Browser-
    // Verlauf, Vorschau-Bots, ein versehentlich geteilter Link) ausloesen,
    // ein POST nicht. Security-Audit Lauf 2 (ENT-577/ENT-578, Punkt 4).
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        json_response(['status' => 'error', 'message' => 'nur POST'], 405);
    }
}

$pdo = db();
$jetzt = date('Y-m-d H:i:s');

/* ── Zweite Aufgabe desselben Zeitgebers: Supportvorgaenge (ENT-538) ──

   WARUM HIER UND NICHT IN EINEM EIGENEN ENDPUNKT: Ein zweiter Endpunkt
   braeuchte einen zweiten Cronjob -- und der Kommentar oben nennt den
   Grund, warum das schlecht waere: Ein Zeitgeber, den niemand eingerichtet
   hat, ist eine stille Luecke. Einen einzurichten ist ein Handgriff, an
   den sich jemand erinnern muss; zwei sind zwei.

   WARUM VOR DEN PUSH-AUSSTEIGERN: Direkt darunter beendet der Endpunkt
   sich, wenn die Push-Tabellen fehlen oder der Push-Schluessel nicht
   gesetzt ist. Beides sagt nichts ueber den Support aus. Stuende der
   Nachlauf weiter unten, liefe er auf jeder Anlage ohne Push nie -- und
   das faellt nicht auf, weil nichts rot wird. Es passiert einfach nichts.

   Der Nachlauf schreibt in die BETREIBER-Datenbank, nicht in die des
   Mandanten. Fehlt sie oder fehlen die Tabellen, meldet er das und bricht
   nichts ab. */
$supportNachlauf = ['eingerichtet' => false, 'erinnert' => 0];
try {
    $supportNachlauf = sv_erinnerungen_versenden(betreiber_db(), basis_url());
} catch (Throwable $e) {
    // Ein Fehler im Support-Nachlauf darf den Push-Versand nicht aufhalten
    // -- die beiden haben nichts miteinander zu tun ausser der Uhr. Was
    // schiefging, steht in der Antwort, nicht in der Mitteilung an
    // irgendjemanden.
    $supportNachlauf = ['eingerichtet' => false, 'erinnert' => 0,
                        'fehler' => db_fehlermeldung($e)];
}

/* ── Dritte Aufgabe desselben Zeitgebers: Austritts-Erinnerung (ENT-598) ──
   Gleicher Grund wie beim Supportvorgang oben: kein eigener Cronjob, und
   VOR den Push-Aussteigern, weil ein fehlendes Push-Setup nichts darueber
   aussagt, ob irgendwo ein laengst ausgetretenes Konto noch aktiv ist. Die
   Funktion schreibt in DIESELBE (Mandanten-)Datenbank wie der Push-Versand,
   anders als der Support-Nachlauf. */
$austrittNachlauf = austritt_erinnerung_versenden($pdo);

if (!hat_tabelle($pdo, 'mitteilungen') || !hat_tabelle($pdo, 'push_abo')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'verschickt' => 0,
        'support' => $supportNachlauf, 'austritt' => $austrittNachlauf,
        'meldung' => 'Die Tabellen fehlen — einmal „Einrichtung" ausführen.']);
}
if (!push_konfiguriert()) {
    // NICHT als Fehler: Der Zeitgeber laeuft jede Viertelstunde, ein
    // Fehlschlag je Lauf fuellte das Protokoll ohne neuen Erkenntniswert.
    // Aber auch nicht als Erfolg -- die Antwort sagt ausdruecklich, dass
    // nichts eingerichtet ist.
    json_response(['status' => 'ok', 'eingerichtet' => false, 'verschickt' => 0,
        'support' => $supportNachlauf, 'austritt' => $austrittNachlauf,
        'meldung' => 'Auf dem Server fehlt der Push-Schlüssel.']);
}

$faellig = push_faellige_mitteilungen($pdo, $jetzt);
$bilanzen = [];
foreach ($faellig as $m) {
    $b = push_fuer_mitteilung($pdo, $m, $jetzt);
    // Auch dann vermerken, wenn es null Geraete waren: Sonst versuchte es
    // jeder Lauf erneut, und eine Mitteilung von vor drei Monaten
    // klingelte, sobald sich jemand neu anmeldet.
    push_mitteilung_vermerken($pdo, (int)$m['id'], $b, $jetzt);
    $bilanzen[] = ['id' => (int)$m['id'], 'bilanz' => $b];
}

json_response([
    'status'       => 'ok',
    'eingerichtet' => true,
    'verschickt'   => count($bilanzen),
    'mitteilungen' => $bilanzen,
    'support'      => $supportNachlauf,
    'austritt'     => $austrittNachlauf,
]);
