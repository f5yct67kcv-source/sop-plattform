<?php
declare(strict_types=1);
// Passwort-Ruecksetzung per E-Mail-Link anfordern (ENT-373).
//
// Der Anlass: Ein Waechter, der morgens vor der ersten Runde sein Passwort
// nicht mehr weiss, kam bis hierher nur ueber einen erreichbaren Admin ins
// System -- und ohne Anmeldung laesst sich kein GPS-gestuetzter Rundgang
// starten. Dieser Weg schliesst genau diese Luecke, absichtlich nur fuer
// normale Mitarbeitende:
//
// EIN ADMIN-/PERSONAL-KONTO BEKOMMT NIEMALS EINEN LINK. An einem
// Verwaltungszugang haengt die ganze Personalakte (AHV-Nummern,
// Aufenthaltsstatus, Registerauszuege, siehe zweifaktor.php). Ein
// abgegriffenes privates Postfach waere sonst derselbe zweite Weg hinein,
// den die dortige Zwei-Faktor-Anmeldung gerade verhindern soll. Fuer diese
// Konten bleibt nur der bestehende Weg: ein anderer Admin setzt das
// Passwort im Cockpit zurueck.
//
// KEIN UNTERSCHIED NACH AUSSEN. Ob der Name existiert, ob er ein
// Admin-Konto ist, ob eine E-Mail hinterlegt ist, ob der Versand
// fehlschlaegt -- die Antwort ist in JEDEM Fall dieselbe. Alles andere
// wuerde verraten, welche Namen echte Konten sind (dieselbe Regel wie beim
// normalen Login, siehe anmeldung.php).
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../anmeldung.php';
require __DIR__ . '/../mailer.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($in['name'] ?? ''));
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Anmeldename erforderlich'], 400);
}

// Dieselbe Bremse wie beim Login (ENT-075), unter einem eigenen
// Namensraum ("reset:"): Wer viele Ruecksetz-Anfragen fuer einen Namen oder
// von einer Adresse aus stellt, wird ausgebremst -- unabhaengig von den
// normalen Anmeldeversuchen desselben Kontos, damit das eine den anderen
// Zaehler nicht sperrt. Anders als beim Login zaehlt hier JEDE Anfrage,
// nicht nur eine falsche -- es gibt kein "falsch", das man unterscheiden
// koennte, ohne die Existenz des Kontos zu verraten.
$pdo = db();
$adresse = anmeld_adresse();
$bremsName = 'reset:' . $name;
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen($pdo, $bremsName, $adresse);
$sperre = anmeld_sperre($fehlerName, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Anfragen. Bitte $sperre Minuten warten."], 429);
}
anmeld_fehlversuch($pdo, $bremsName, $adresse);

// Ab hier bleibt die Antwort in JEDEM Zweig identisch -- darum wird der
// eigentliche Versand in eine eigene, fruehzeitig verlassbare Pruefung
// gepackt, statt die Antwort an mehreren Stellen zu wiederholen.
versuch_link_zu_verschicken($pdo, $name);

json_response(['status' => 'ok', 'message' =>
    'Falls dieser Anmeldename mit einer hinterlegten E-Mail-Adresse verknüpft ist, '
    . 'wurde eine Nachricht mit einem Link zum Zurücksetzen verschickt.']);

function versuch_link_zu_verschicken(PDO $pdo, string $name): void
{
    if (!hat_tabelle($pdo, 'passwort_reset') || !smtp_konfiguriert()) { return; }

    $s = $pdo->prepare('SELECT id, ist_admin, email, email_privat, vorname, nachname FROM mitarbeiter WHERE name = ? AND aktiv = 1');
    $s->execute([$name]);
    $person = $s->fetch(PDO::FETCH_ASSOC);
    if (!$person) { return; }

    $id = (int)$person['id'];
    $istVerwaltung = darf_verwaltung(['rollen' => rechte_rollen($pdo, $id, (bool)$person['ist_admin'])]);
    if ($istVerwaltung) { return; }   // siehe Dateikopf -- kein Link fuer Admin-/Personal-Konten

    // Zwei Adressen im Personaldossier -- E-Mail Geschaeft (email) und
    // E-Mail privat (email_privat, seit der Erweiterung in
    // planung_einrichten.php). Die erste Fassung dieses Endpunkts las nur
    // "email" und ging bei jedem Konto leer aus, das ausschliesslich eine
    // private Adresse hinterlegt hat -- vom Projektinhaber am eigenen
    // Testkonto gefunden.
    //
    // PRIVAT ZUERST, nicht Geschaeft: Der ganze Zweck dieses Wegs ist, wer
    // gerade NICHT ins System kommt -- eine geschaeftliche Adresse haengt
    // oft an genau der Infrastruktur, aus der man ausgesperrt ist. Die
    // private Adresse ist die, die auf dem eigenen Telefon ankommt.
    $email = trim((string)($person['email_privat'] ?? ''));
    if ($email === '') { $email = trim((string)$person['email']); }
    if ($email === '') { return; }

    // Ein frueherer, noch nicht eingeloester Link wird ungueltig: Sonst
    // bliebe nach einer zweiten Anfrage (z.B. weil die erste Mail nicht
    // ankam) der aeltere Link parallel gueltig -- zwei offene Tueren statt
    // einer.
    $pdo->prepare('UPDATE passwort_reset SET benutzt_am = NOW() WHERE mitarbeiter_id = ? AND benutzt_am IS NULL')
        ->execute([$id]);

    $tokenRoh = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $tokenRoh);
    $pdo->prepare(
        'INSERT INTO passwort_reset (mitarbeiter_id, token_hash, laeuft_ab)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))'
    )->execute([$id, $tokenHash]);

    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    $link = 'https://' . $host . '/app.html?reset=' . urlencode($tokenRoh);

    $betrieb = $pdo->query('SELECT firma FROM betrieb WHERE id = 1')->fetch();
    $firma = trim((string)($betrieb['firma'] ?? '')) ?: 'Die Verwaltung';
    $vorname = trim((string)$person['vorname']);

    $betreff = 'Neues Passwort anfordern';
    $text = "Guten Tag" . ($vorname !== '' ? " $vorname" : '') . "\n\n"
        . "Für dein Konto \"$name\" wurde ein neues Passwort angefordert.\n\n"
        . "Hier kannst du ein neues Passwort setzen (30 Minuten gültig):\n$link\n\n"
        . "Falls das nicht du warst: einfach ignorieren, es ändert sich nichts.\n\n"
        . "Freundliche Grüsse\n$firma";

    // Gleiche Bauart wie in beleg_versenden.php (ENT-192): eigenes
    // font-family je Textelement (Outlook-Rendermotor vererbt es sonst
    // nicht verlaesslich), derselbe Akzent-Blauton wie im Cockpit.
    $schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
    $html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
        . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag' . ($vorname !== '' ? ' ' . htmlspecialchars($vorname, ENT_QUOTES, 'UTF-8') : '') . '</p>'
        . '<p style="' . $schrift . ';margin:0 0 16px">Für dein Konto <strong>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</strong> wurde ein neues Passwort angefordert.</p>'
        . '<p style="' . $schrift . ';margin:28px 0">'
        . '<a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '" '
        . 'style="' . $schrift . ';background:#2F5BD7;color:#fff;padding:12px 24px;border-radius:8px;'
        . 'font-weight:700;text-decoration:none;display:inline-block">Neues Passwort setzen</a></p>'
        . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">Funktioniert der Knopf nicht? Diesen Link in den Browser kopieren:<br>'
        . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '</p>'
        . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">Der Link ist 30 Minuten gültig. Falls das nicht du warst: einfach ignorieren, es ändert sich nichts.</p>'
        . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . htmlspecialchars($firma, ENT_QUOTES, 'UTF-8') . '</p>'
        . '</div>';

    try {
        smtp_senden($email, trim($vorname . ' ' . (string)$person['nachname']), $betreff, $html, $text);
    } catch (Throwable $e) {
        // Bewusst verschluckt (siehe Dateikopf): Ein Versandfehler darf die
        // Antwort an den anonymen Aufrufer nicht veraendern.
    }
}
