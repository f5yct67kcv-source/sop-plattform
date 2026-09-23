<?php
// Das Erstkonto eines Mandanten einladen (ENT-686).
//
// WAS SICH GEGENUEBER backend/setup.php AENDERT: Dort wurde eine Datei von
// Hand per FTP hochgeladen, einmal mit Name und Passwort aufgerufen und
// wieder geloescht. Wer das tat, kannte das Passwort des Kunden, niemand
// protokollierte den Handgriff, und im System stand nirgends, dass die
// Uebergabe stattgefunden hat. Hier erfasst der Betreiber nur die benannte
// Person; das Geheimnis waehlt sie selbst, ueber einen einmaligen Link an
// ihre Adresse.
//
// DIESELBE BAUART WIE betreiber_einladen.php, eine Ebene tiefer: Dort
// entsteht ein Konto der Betreiber-Ebene in der Betreiber-Datenbank, hier
// das Erstkonto eines Mandanten in DESSEN Anlage. Die Einladung selbst liegt
// in beiden Faellen in der Betreiber-Datenbank (ENT-686, Klaerung 1).
//
// WER DARF DAS: require_betreiber_voll() -- wer selbst auf dieser Ebene
// angemeldet ist und seinen zweiten Faktor bestaetigt hat. Dieselbe Wache
// wie beim Einladen eines Betreiber-Kontos. Ein Einladungslink ist ein Konto
// in spe und darf nicht billiger zu haben sein als das Konto selbst -- und
// dieses hier ist der Verwaltungszugang auf eine ganze Anlage.
//
// WARUM DIESER ENDPUNKT ZUR MANDANTENDATENBANK VERBINDET (Eintrag in
// DARF_VERBINDEN, pruefungen/test_betreiber.mjs): Er prueft VOR dem Versand,
// ob die Anlage wirklich uebergabefaehig ist. Das ist die Lehre aus den
// Demo-Plaetzen 6 und 8 (Befund 2026-09-19): Dort waren alle Tabellen da,
// die nachtraeglichen Spalten fehlten, und beide galten als "eingerichtet".
// Ein Link auf eine halbe Anlage geht an einen zahlenden Kunden, und der
// merkt es als Erster. Gelesen wird dabei AUSSCHLIESSLICH der Bauplan
// (kern_schema_fehlend, aus information_schema) -- keine Verwaltungstabelle,
// kein Feld einer solchen. Ob die Anlage schon uebergeben ist, sagt der
// eigene Vermerk in der Betreiber-Datenbank, nicht die Anlage.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../planung_einrichten_kern.php'; // kern_schema_fehlend()

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!mandant_einladung_tabelle_da($pdo)) {
    // Nicht eingerichtet ist etwas anderes als nicht erlaubt (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Die Mandanten-Einladungen sind in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$in        = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$mandantId = (int)($in['mandant_id'] ?? 0);
$email     = mb_strtolower(trim((string)($in['email'] ?? '')));
$anrede    = mb_substr(trim((string)($in['anrede']   ?? '')), 0, 20);
$vorname   = mb_substr(trim((string)($in['vorname']  ?? '')), 0, 100);
$nachname  = mb_substr(trim((string)($in['nachname'] ?? '')), 0, 100);

if ($nachname === '') {
    json_response(['status' => 'error', 'message' => 'Ein Nachname wird gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Diese E-Mail-Adresse ist nicht gültig.'], 400);
}
$person = be_name_bauen($vorname, $nachname);

$s = $pdo->prepare('SELECT * FROM mandant WHERE id = ? LIMIT 1');
$s->execute([$mandantId]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}
// Vier Zustaende, vier Aussagen (Hausregel): Ein gesperrter und ein
// gekuendigter Mandant sind nicht dasselbe, und beide sind etwas anderes als
// "gibt es nicht" darueber.
if ((string)$m['status'] !== 'aktiv') {
    json_response(['status' => 'error',
        'message' => [
            'gekuendigt' => 'Dieser Mandant ist gekündigt. Für eine gekündigte Anlage wird kein Zugang übergeben.',
            'gesperrt'   => 'Dieser Mandant ist gesperrt. Solange das so ist, wird kein Zugang übergeben.',
            // ENT-686: Erst zuteilen, dann einladen. Eine Vorratsanlage hat
            // noch keinen Kunden und keine Adresse, unter der er arbeiten
            // koennte.
            MANDANT_STATUS_VORRAT => 'Diese Anlage liegt noch im Vorrat. '
                . 'Sie muss zuerst einem Kunden zugeteilt werden, dann lässt sich der Zugang übergeben.',
        ][(string)$m['status']] ?? 'Dieser Mandant ist nicht aktiv. Solange das so ist, wird kein Zugang übergeben.'], 409);
}

// ── Erst pruefen, ob sich ueberhaupt verschicken laesst ───────────────
//
// VOR dem Anlegen der Einladung, nicht danach -- dieselbe Reihenfolge wie in
// betreiber_einladen.php. Eine Einladung, die nie hinausgeht, ist eine
// Karteileiche, und bis jemand sie aufraeumt, sieht die Uebergabe in der
// Liste aus, als sei sie unterwegs.
if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Für diese Anlage ist kein E-Mail-Versand eingerichtet. '
                   . 'Ohne ihn lässt sich niemand einladen.'], 503);
}
$basis = basis_url();
if ($basis === null) {
    json_response(['status' => 'error',
        'message' => 'Die eigene Adresse der Anlage ist nicht gesetzt (APP_BASIS_URL). '
                   . 'Ohne sie liesse sich kein Link bauen, der zurückführt.'], 503);
}

// ── Ist die Anlage wirklich uebergabefaehig? ──────────────────────────
//
// DIE VOLLPRUEFUNG, nicht das Zaehlen von Tabellen. mandant_stand() fragt
// fuenf Kerntabellen ab; genau damit galten demo6 und demo8 als
// eingerichtet, obwohl nachtraegliche Spalten fehlten.
// kern_schema_fehlend() prueft den ganzen Bauplan mit einer Abfrage, aus
// derselben Quelle, aus der die Einrichtung baut.
$lage = mandant_verbindung_bereit($m);
if ($lage === 'standardverbindung') {
    // Kein Fehler, aber auch kein Weg: Eine Anlage ohne eigene Datenbank ist
    // die des Betreibers selbst. Dort ein Erstkonto anzulegen hiesse, in die
    // eigene `mitarbeiter`-Tabelle zu schreiben.
    json_response(['status' => 'error',
        'message' => 'Dieser Mandant hat noch keine eigene Datenbank. '
                   . 'Ein Erstkonto lässt sich erst in einer eigenen Anlage übergeben.'], 409);
}
if ($lage !== 'bereit') {
    json_response(['status' => 'error',
        'message' => 'Die Anlage dieses Mandanten ist nicht erreichbar (' . $lage . '). '
                   . 'Vor der Übergabe muss sie stehen.'], 503);
}
try {
    $anlage = mandant_db($m);
} catch (Throwable $e) {
    json_response(['status' => 'error', 'message' => be_verbindungsfehler_text($e)], 503);
}
$luecken = kern_schema_fehlend($anlage);
if ($luecken !== []) {
    // Mit Zahl UND Beispielen, wie bei der Demo-Zuteilung: "unvollstaendig"
    // allein sagt niemandem, ob eine Spalte fehlt oder die halbe Anlage.
    json_response(['status' => 'error',
        'message' => 'Das Schema dieser Anlage ist unvollständig — '
                   . count($luecken) . ' fehlende Stellen, darunter: '
                   . implode(', ', array_slice($luecken, 0, 3)) . '. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 409);
}
// Ist diese Anlage schon uebergeben? GEFRAGT WIRD DER EIGENE VERMERK, nicht
// die Anlage.
//
// Naheliegender waere, in der Anlage nachzuzaehlen, wieviele Menschen in
// `mitarbeiter` stehen -- so sperrt sich setup.php, und so prueft es der
// Einloeseweg. Ein betreiber_*-Endpunkt darf das nicht: Die Trennung der
// Ebenen verbietet ihm die Verwaltungstabellen, und test_betreiber.mjs setzt
// es durch. Die Wache hatte recht, als sie hier anschlug -- die Frage
// gehoert an den Uebergabevermerk, den es seit dieser Entscheidung gibt.
//
// Die zweite, unabhaengige Sperre sitzt im Einloeseweg: Der sieht in der
// Anlage selbst nach und laesst kein zweites Erstkonto entstehen, auch nicht
// bei einer Anlage, die vor ENT-686 ueber setup.php uebergeben wurde und
// darum hier keine Zeile hat.
$uebergeben = mandant_einladung_eingeloest_am($pdo, $mandantId);
if ($uebergeben !== null) {
    json_response(['status' => 'error',
        'message' => 'Dieser Mandant hat seinen Zugang am '
                   . date('d.m.Y', strtotime($uebergeben)) . ' übernommen. '
                   . 'Ein Erstkonto wird nur einmal übergeben; weitere Konten legt '
                   . 'die Verwaltung des Mandanten selbst an.'], 409);
}

// ── Ausstellen und verschicken, oder gar nicht ────────────────────────
//
// Beides in EINER Transaktion, und der Versand entscheidet mit: Geht die
// Nachricht nicht hinaus, bleibt keine Einladung zurueck. Wie in
// betreiber_einladen.php -- der Versand liegt damit innerhalb der
// Transaktion, unschoen, aber dieser Vorgang laeuft je Mandant ein Mal.
//
// REPLACE statt INSERT: Neu ausstellen ueberschreibt Token und Frist, und
// damit ist der alte Link sofort ungueltig (ENT-686, Klaerung 2 -- neu
// ausstellen, nicht verlaengern). Ein bestehender Vermerk `eingeloest_am`
// kann hier nicht im Weg stehen: Die Pruefung auf `eingeloest_am` darueber
// hat dann schon abgebrochen.
$tokenRoh = bin2hex(random_bytes(32));
$pdo->beginTransaction();
try {
    $pdo->prepare(
        'REPLACE INTO mandant_einladung
            (mandant_id, token, anrede, vorname, nachname, email, gueltig_bis, erstellt_von)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ' . MANDANT_EINLADUNG_TAGE . ' DAY), ?)'
    )->execute([$mandantId, hash('sha256', $tokenRoh), $anrede, $vorname, $nachname,
                $email, (int)$ich['id']]);

    mandant_einladung_versenden($basis, $tokenRoh, $email, $person, $vorname,
                                (string)$m['name'], (string)$ich['name']);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    if ($e instanceof RuntimeException) {
        json_response(['status' => 'error', 'message' => $e->getMessage()], 502);
    }
    json_response(['status' => 'error',
        'message' => 'Die Einladung konnte nicht verschickt werden.'], 400);
}

// Logbuch (ENT-614): Wer wen eingeladen hat. Das Einloesen schreibt einen
// zweiten Eintrag -- zusammen ergeben sie, wie die Uebergabe verlaufen ist.
// OHNE DIE ADRESSE IM KLARTEXT waere der Eintrag wertlos: Die Frage, die man
// hinterher stellt, ist "an wen ging der Link".
be_log($pdo, $ich, 'mandant', $mandantId, 'erstkonto eingeladen', null,
       $person . ' (' . $email . ')');

json_response(['status' => 'ok', 'gueltig_tage' => MANDANT_EINLADUNG_TAGE]);

// ── Die Nachricht ─────────────────────────────────────────────────────
//
// Wirft bei Versandfehler, statt ihn zu verschlucken: Der Aufrufer ist
// angemeldet und muss erfahren, dass nichts hinausging.
function mandant_einladung_versenden(string $basis, string $tokenRoh, string $email,
                                     string $person, string $vorname, string $betrieb,
                                     string $vonName): void
{
    // DERSELBE PFADFUND wie bei der Betreiber-Einladung: Auf
    // betreiber.guardops.ch liegt der Bereich auf "/", der Deploy legt ihn
    // dort als index.html ab -- ein "/betreiber.html" gibt es da NICHT und
    // der Link liefe ins Leere. Im Cockpit-Buendel liegt die Datei unter
    // ihrem eigenen Namen. Darum wird nachgesehen, nicht geraten.
    $seite = is_file(__DIR__ . '/../../betreiber.html') ? '/betreiber.html' : '/';
    $link  = $basis . $seite . '?uebergabe=' . urlencode($tokenRoh);
    $tage  = MANDANT_EINLADUNG_TAGE;

    // DIE MARKE ALS ABSENDER, nicht der Name des Betriebs: Der Empfaenger
    // bekommt Post von GuardOpS, nicht von sich selbst (ENT-568).
    $absender = 'GuardOpS';
    $anrede   = $vorname !== '' ? 'Guten Tag ' . $vorname : 'Guten Tag';

    $betreff = 'Ihr Zugang zu GuardOpS für ' . $betrieb;
    $text = "$anrede\n\n"
        . "für $betrieb ist GuardOpS eingerichtet. Sie sind als erste Person "
        . "hinterlegt, die den Zugang verwaltet.\n\n"
        . "Über diesen Link setzen Sie Ihr Passwort selbst ($tage Tage gültig):\n$link\n\n"
        . "Wir kennen Ihr Passwort nicht und können es nicht einsehen.\n\n"
        . "Falls Sie damit nichts anfangen können: Bitte melden Sie sich bei "
        . "$vonName, statt den Link zu benutzen.\n\n"
        . "Freundliche Grüsse\n$absender";

    // Gleiche Bauart wie betreiber_einladen.php: eigenes font-family je
    // Textelement, weil der Rendermotor von Outlook es sonst nicht
    // verlaesslich vererbt.
    $e = static fn(string $w): string => htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
    $schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
    $html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
        . '<p style="' . $schrift . ';margin:0 0 16px">' . $e($anrede) . '</p>'
        . '<p style="' . $schrift . ';margin:0 0 16px">Für <strong>' . $e($betrieb)
        . '</strong> ist <strong>GuardOpS</strong> eingerichtet. Sie sind als erste Person '
        . 'hinterlegt, die den Zugang verwaltet.</p>'
        . '<p style="' . $schrift . ';margin:28px 0">'
        . '<a href="' . $e($link) . '" '
        . 'style="' . $schrift . ';background:#2F5BD7;color:#fff;padding:12px 24px;border-radius:8px;'
        . 'font-weight:700;text-decoration:none;display:inline-block">Passwort setzen</a></p>'
        . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">'
        . 'Funktioniert der Knopf nicht? Diesen Link in den Browser kopieren:<br>' . $e($link) . '</p>'
        . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">'
        . 'Der Link ist ' . $tage . ' Tage gültig. Wir kennen Ihr Passwort nicht und '
        . 'können es nicht einsehen.</p>'
        . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">'
        . 'Falls Sie damit nichts anfangen können: Bitte melden Sie sich bei '
        . $e($vonName) . ', statt den Link zu benutzen.</p>'
        . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . $e($absender) . '</p>'
        . '</div>';

    try {
        smtp_senden($email, $person, $betreff, $html, $text);
    } catch (Throwable $e2) {
        throw new RuntimeException(
            'Die Einladung liess sich nicht verschicken. Es wurde darum keine ausgestellt.');
    }
}
