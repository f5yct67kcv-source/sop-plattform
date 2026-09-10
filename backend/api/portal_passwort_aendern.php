<?php
// Kundenportal: das eigene Passwort aendern (ENT-488).
//
// POST { alt, neu }  ->  { status }
//
// Bis hierher konnte ein Kunde sein Passwort genau EINMAL setzen -- beim
// ersten Besuch ueber den zugeschickten Link (ENT-448). Danach nie wieder.
// Das ist keine Bequemlichkeitsluecke: Wer sein Passwort weitergegeben hat
// oder es verdaechtigt, kam nicht mehr heraus, ohne beim Betrieb anzurufen.
//
// Aufbau bewusst gleich wie mein_passwort.php fuer Mitarbeitende (ENT-023):
// Das BISHERIGE Passwort wird verlangt. Ein offenes Geraet soll nicht zum
// Kontodiebstahl werden -- wer kurz am fremden Bildschirm sitzt, koennte
// sonst den Zugang uebernehmen, ohne das alte Passwort je gekannt zu haben.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../anmeldung.php';   // passwort_pruefen, PASSWORT_KOSTEN

$zugang = require_kundensession();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
// Nicht beschneiden: Ein Leerzeichen am Ende kann Teil des Passworts sein
// (gleiche Ueberlegung wie in portal_neues_passwort.php).
$alt = (string)($in['alt'] ?? '');
$neu = (string)($in['neu'] ?? '');

if ($alt === '' || $neu === '') {
    json_response(['status' => 'error', 'message' => 'alt und neu erforderlich'], 422);
}

$pdo = db();
// password_hash ist eine NACHGETRAGENE Spalte (ENT-444). Vor dem naechsten
// Einrichten gibt es sie nicht -- und "noch nicht eingerichtet" ist etwas
// anderes als "das bisherige Passwort stimmt nicht". Wer das verwechselt,
// laesst den Kunden Passwoerter durchprobieren, die nie falsch waren.
if (!hat_spalte($pdo, 'kundenzugang', 'password_hash')) {
    json_response(['status' => 'error',
        'message' => 'Die Passwortvergabe ist noch nicht eingerichtet. '
                   . 'Bitte wenden Sie sich an Ihren Ansprechpartner.'], 503);
}
$zugangId = (int)$zugang['id'];

$s = $pdo->prepare('SELECT password_hash, email FROM kundenzugang WHERE id = ?');
$s->execute([$zugangId]);
$row = $s->fetch(PDO::FETCH_ASSOC);

// Drei verschiedene Lagen, drei verschiedene Antworten. „Noch kein Passwort
// gesetzt" als „das bisherige stimmt nicht" auszugeben waere die falsche
// Auskunft -- der Kunde probierte dann Passwoerter durch, die es nie gab.
if (!$row) {
    json_response(['status' => 'error', 'message' => 'Der Zugang ist nicht abrufbar.'], 404);
}
if ($row['password_hash'] === null) {
    json_response(['status' => 'error',
        'message' => 'Für diesen Zugang ist noch kein Passwort gesetzt. '
                   . 'Bitte fordern Sie über „Passwort vergessen" einen Link an.'], 409);
}

// Die Regel gilt beim SETZEN, nicht beim Anmelden (ENT-075) -- und mit
// derselben Sperre wie beim Erstsetzen: Die E-Mail-Adresse ist der
// Anmeldename, ihr lokaler Teil darf nicht im Passwort stehen.
// Dritter Parameter false: ein Kundenzugang ist kein Verwaltungszugang und
// unterliegt nicht dessen strengerer Laenge.
$loginTeil = explode('@', (string)$row['email'])[0] ?? '';
$fehler = passwort_pruefen($neu, $loginTeil, false);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 422);
}

// Erst NACH der Regelpruefung: Ein zu schwaches neues Passwort ist ein
// Vertipper und soll nicht wie ein falsches altes aussehen.
if (!password_verify($alt, (string)$row['password_hash'])) {
    json_response(['status' => 'error',
        'message' => 'Das bisherige Passwort stimmt nicht.'], 401);
}

$pdo->beginTransaction();
try {
    $pdo->prepare('UPDATE kundenzugang SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($neu, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), $zugangId]);
    // Alle ANDEREN Sitzungen beenden, die eigene behalten. Wer sein Passwort
    // wechselt, will oft genau das: den hinauswerfen, der noch angemeldet
    // ist -- sich selbst aber nicht.
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    $pdo->prepare('DELETE FROM kunden_sessions WHERE zugang_id = ? AND token <> ?')
        ->execute([$zugangId, sitzung_abdruck((string)$token)]);
    // Und offene Links entwerten. Einer, der noch im Postfach liegt, waere
    // sonst ein Weg an dem eben gesetzten Passwort vorbei -- dieselbe
    // Ueberlegung wie beim Erstsetzen.
    $pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                    WHERE zugang_id = ? AND eingeloest_am IS NULL')->execute([$zugangId]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok']);
