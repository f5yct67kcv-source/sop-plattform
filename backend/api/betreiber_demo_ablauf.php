<?php
// Abgelaufene Demo-Zugänge schliessen (ENT-600).
//
// Der Zeitgeber, der die 14 Tage durchsetzt. Ohne ihn liefe nichts ab, und
// die Daten der Interessenten lägen weiter in den Instanzen -- der Ablauf
// ist keine Anzeige, er ist die Löschung.
//
// ZWEI WEGE HEREIN, EIN RECHENKERN:
//   - Der Zeitgeber ruft mit dem Schlüssel aus dem Deploy auf, ohne
//     Anmeldung (wie api/demo_reset_ausfuehren.php).
//   - Der Betreiber kann von Hand anstossen; dann zählt seine Sitzung.
// Beides ist derselbe Lauf, nur der Nachweis ist ein anderer.
//
// GET liefert nur den Stand, POST räumt auf. Ein Aufräumen per GET wäre
// von jedem Vorschau-Dienst auslösbar, der Links aufruft.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_instanz.php';
// Fuer die Abschiedsmail (ENT-634). Der Rechenkern der Mail liegt in
// demo_zugang.php, das betreiber.php bereits mitbringt; der Versand
// braucht diese Datei.
require_once __DIR__ . '/../mailer.php';

$schluessel = (string)($_GET['schluessel'] ?? '');
// Der Platzhalter steht ZERLEGT da, und das mit Absicht: Diese Datei geht
// mit der pauschalen Kopie aller Endpunkte auch in dist/, dist-cupi24/ und die
// Demo-Plaetze. Dort soll der Zeitgeber nicht eingerichtet sein, und ein
// Platzhalter am Stueck braeche deren Pruefung auf Uebriggebliebenes.
// NUR das Betreiber-Buendel ersetzt ihn -- und zwar genau in dieser
// zerlegten Form. Anfangs suchte das sed dort die ganze Form, fand sie
// nie, und jeder Cron-Aufruf fiel als "nicht eingerichtet" in die
// Sitzungspruefung ("kein Token"). Die Wache dagegen: test_deploy.mjs.
$erwartet   = '__DEMO_ABLAUF' . '_TOKEN__';
$lage = demo_ablauf_zeitgeber_lage($erwartet, $schluessel);
$perZeitgeber = $lage === 'ok';

// Kommt ein Schluessel an, ist hier aber keiner eingerichtet, sagt der
// Endpunkt genau das -- statt "kein Token" aus der Sitzungspruefung, das nach
// einem falschen Aufruf aussieht. Unbekannt ist nicht dasselbe wie falsch.
if ($lage === 'nicht_eingerichtet' && $schluessel !== '') {
    json_response(['status' => 'error',
        'message' => 'Der Zeitgeber-Schlüssel ist auf diesem Server nicht eingerichtet. '
                   . 'Secret DEMO_ABLAUF_TOKEN setzen und neu deployen.'], 503);
}

if (!$perZeitgeber) {
    // Keine gültige Zeitgeber-Kennung: Dann muss eine Betreiber-Sitzung
    // dahinterstehen. Die Wache antwortet selbst, wenn sie fehlt.
    //
    // Ein FALSCHER Schlüssel ist etwas anderes als gar keiner und wird
    // abgewiesen, statt in die Sitzungsprüfung zu rutschen: Wer es mit
    // einem Schlüssel versucht, ist kein Mensch am Bildschirm.
    if ($lage === 'falscher_schluessel') {
        json_response(['status' => 'error', 'message' => 'kein Zugang'], 403);
    }
    require_betreiber_voll();
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$jetzt = date('Y-m-d H:i:s');
// Person und Adresse kommen mit, weil der Lauf seit ENT-634 eine
// Abschiedsmail verschickt. Ob die Spalten dafuer schon stehen, entscheidet
// sich weiter unten -- der Ablauf selbst darf daran nicht haengen.
$offen = $pdo->prepare(
    "SELECT id, platz, firma, person, email, telefon, laeuft_ab_am FROM demo_zugang
      WHERE status = 'aktiv' AND laeuft_ab_am < ? ORDER BY id"
);
$offen->execute([$jetzt]);
$faellig = $offen->fetchAll(PDO::FETCH_ASSOC);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response([
        'status'  => 'ok',
        'faellig' => count($faellig),
        'zeitpunkt' => $jetzt,
        'liste'   => array_map(static fn (array $z): array => [
            'id' => (int)$z['id'], 'platz' => $z['platz'],
            'firma' => $z['firma'], 'laeuft_ab_am' => $z['laeuft_ab_am']], $faellig),
    ]);
}

/* Die Abschiedsmail (ENT-634).

   ERST NACH DEM LEEREN UND NACH DEM EINTRAG, nicht davor: Die Mail sagt,
   dass die Daten geloescht sind. Ginge sie vorher raus und das Leeren
   scheiterte, waere sie eine Falschaussage.

   DER LAUF DARF DARAN NICHT SCHEITERN. Ein Zugang, der geschlossen ist,
   bleibt geschlossen -- auch wenn der Mailserver nicht antwortet oder die
   Spalten auf dieser Anlage noch nicht stehen. Darum faengt hier alles,
   und der Fehlschlag steht im Fehlerprotokoll statt in der Antwort.

   DER WERT STEHT NUR IN DER MAIL. In der Tabelle liegt sein Abdruck
   (ENT-501) -- wer in die Datenbank sieht, bekommt keinen gueltigen Link.

   KEINE ZWEITE MAIL: Wo `ende_mail_am` schon steht, wird nichts mehr
   verschickt. Der Lauf kann oefter laufen als einmal pro Zugang. */
$kenntEnde = hat_spalte($pdo, 'demo_zugang', 'ende_abdruck')
    && hat_spalte($pdo, 'demo_zugang', 'ende_mail_am');

function demo_ende_mail_senden(PDO $pdo, array $z, bool $kenntEnde): void
{
    if (!$kenntEnde) { return; }
    $email = trim((string)($z['email'] ?? ''));
    if ($email === '') { return; }
    try {
        $schon = $pdo->prepare('SELECT ende_mail_am FROM demo_zugang WHERE id = ?');
        $schon->execute([(int)$z['id']]);
        /* EINMAL lesen und den Wert festhalten: fetchColumn() zweimal zu
           rufen liest beim zweiten Mal die naechste Zeile, nicht denselben
           Wert. Drei Faelle, drei Ausgaenge -- keine Zeile (false), schon
           verschickt (ein Datum) und noch nicht (null). */
        $stand = $schon->fetchColumn();
        if ($stand === false) { return; }
        if ($stand !== null) { return; }

        $wert = demo_ende_wert();
        $pdo->prepare('UPDATE demo_zugang SET ende_abdruck = ?, ende_mail_am = NOW() WHERE id = ?')
            ->execute([demo_ende_abdruck($wert), (int)$z['id']]);

        $mail = demo_ende_mail((string)$z['firma'], (string)$z['person'],
            demo_ende_link($wert, demo_bestaetigung_basis()));
        smtp_senden($email, (string)$z['person'], $mail['betreff'], $mail['html'],
            $mail['text'], [], $mail['bilder']);
    } catch (Throwable $e) {
        error_log('betreiber_demo_ablauf: Abschiedsmail nicht verschickt -- ' . $e->getMessage());
    }
}

$geschlossen = [];
$gescheitert = [];
foreach ($faellig as $z) {
    $fehler = demo_instanz_leeren($pdo, (string)$z['platz']);
    if ($fehler !== null) {
        // Weitermachen statt abbrechen: Ein Platz, der nicht erreichbar
        // ist, darf die anderen nicht mit blockieren. Der Zugang bleibt
        // aktiv, und der nächste Lauf versucht es erneut -- ein Zugang, der
        // im Register als beendet stünde, während seine Daten noch liegen,
        // wäre das Schlimmere.
        $gescheitert[] = ['platz' => $z['platz'], 'grund' => $fehler];
        continue;
    }
    $pdo->prepare("UPDATE demo_zugang SET status = 'abgelaufen', beendet_am = NOW() WHERE id = ?")
        ->execute([(int)$z['id']]);
    $geschlossen[] = (int)$z['id'];
    demo_ende_mail_senden($pdo, $z, $kenntEnde);
}

json_response([
    'status'      => 'ok',
    'geschlossen' => count($geschlossen),
    'gescheitert' => $gescheitert,
    'zeitpunkt'   => $jetzt,
]);
