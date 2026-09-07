<?php
// Kundenportal: eigenes Passwort setzen oder aendern (ENT-444).
//
// POST { passwort }  ->  { status }
//
// Verlangt eine KUNDENSITZUNG. Wer hier ankommt, hat sich also gerade mit
// einem Einmal-Code ausgewiesen (erste Anmeldung oder "Passwort vergessen")
// oder ist mit seinem bisherigen Passwort angemeldet. Ein eigener Weg mit
// einem Rueckstell-Token daneben waere ein zweiter Weg hinein -- und damit
// eine zweite Stelle, die ihn falsch machen kann.
//
// DER ZUGANG KOMMT AUS DER SITZUNG, NIE AUS DER ANFRAGE. Dieser Endpunkt
// nimmt keine Zugangs- oder Kundennummer entgegen; wer eine mitschickt,
// aendert damit nichts. Sonst liesse sich das Passwort eines fremden
// Kundenzugangs setzen -- der schwerste denkbare Fehler an dieser Stelle.
//
// Die Regel selbst steht in anmeldung.php und gilt hier unveraendert:
// Laenge schlaegt Zeichensalat, kein bekanntes Wort, keine Tastaturreihe.
// Eine eigene, mildere Regel fuer Kunden waere die zweite Wahrheit, die
// CLAUDE.md an anderer Stelle ausdruecklich verbietet.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../anmeldung.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in       = json_decode(file_get_contents('php://input'), true) ?? [];
// Nicht beschneiden: Ein Leerzeichen am Ende kann Teil des Passworts sein.
// Wer es hier abschnitte, aber beim Anmelden nicht, sperrte den Zugang aus.
$passwort = (string)($in['passwort'] ?? '');

// Die E-Mail-Adresse ist der Anmeldename dieses Zugangs -- sie darf darum
// nicht im Passwort stehen. Das ist dasselbe Argument wie beim Login-Namen
// der Mitarbeitenden, und der lokale Teil vor dem @ ist das, was jemand
// zuerst probiert.
$loginTeil = explode('@', (string)$zugang['email'])[0] ?? '';
$fehler = passwort_pruefen($passwort, $loginTeil, false);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 422);
}

$pdo = db();
$pdo->prepare('UPDATE kundenzugang SET password_hash = ? WHERE id = ?')
    ->execute([password_hash($passwort, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]),
               (int)$zugang['id']]);

// Alle ANDEREN Sitzungen dieses Zugangs beenden. Wer sein Passwort setzt --
// besonders nach "vergessen" --, will damit oft genau das: den anderen
// hinauswerfen, der noch angemeldet ist. Die eigene bleibt, sonst wuerde
// man sich beim Setzen selbst aussperren.
$eigener = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
$pdo->prepare('DELETE FROM kunden_sessions WHERE zugang_id = ? AND token <> ?')
    ->execute([(int)$zugang['id'], $eigener]);

// Offene Codes entwerten: Ein Code, der noch im Postfach liegt, waere sonst
// weiterhin ein Weg an dem gerade gesetzten Passwort vorbei.
$pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                WHERE zugang_id = ? AND eingeloest_am IS NULL')
    ->execute([(int)$zugang['id']]);

json_response(['status' => 'ok']);
