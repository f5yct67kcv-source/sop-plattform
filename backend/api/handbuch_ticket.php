<?php
declare(strict_types=1);
// Stellt ein Zugangs-Ticket fuers Cockpit-Handbuch aus (statische Seiten
// unter handbuch/, ausserhalb von backend/api/ -- siehe handbuch_ticket in
// planung_einrichten.php fuer die Tabelle und die Begruendung).
//
// Rollenunabhaengig, wie beim Zahnrad "Einrichtung" und bei "Mein Zugang:
// Zwei-Faktor-Anmeldung": require_verwaltung() statt eines einzelnen
// Bereichsrechts -- das Handbuch beschreibt das Werkzeug selbst, nicht
// einen Bereich, und ist fuer JEDEN Cockpit-Zugang gedacht (Entscheid des
// Projektinhabers).
//
// Das Ticket kommt als HttpOnly-Cookie zurueck, nie im Antwortkoerper: Der
// Rohwert soll nur im Cookie-Speicher des Browsers landen, nicht zusaetzlich
// im JavaScript-Zugriff oder in einem Netzwerk-Log der Antwort.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$user = require_session();
require_verwaltung($user);

$pdo = db();
if (!hat_tabelle($pdo, 'handbuch_ticket')) {
    json_response([
        'status'  => 'error',
        'message' => 'Das Handbuch ist noch nicht eingerichtet. Bitte zuerst "Einrichtung" ausfuehren.',
    ], 503);
}

// Fruehere, noch nicht abgelaufene Tickets dieser Person werden hinfaellig --
// dasselbe Vorgehen wie bei passwort_reset: nach einem erneuten Klick soll
// nur das neueste Cookie gelten, nicht mehrere parallel gueltige.
$pdo->prepare('DELETE FROM handbuch_ticket WHERE mitarbeiter_id = ?')->execute([(int)$user['id']]);

$tokenRoh = bin2hex(random_bytes(32));
$tokenHash = hash('sha256', $tokenRoh);
// 4 Stunden: grosszuegig genug fuer ein Nachschlagen zwischendurch, ohne
// dass ein einmal ausgestelltes Ticket tagelang gueltig bliebe.
$pdo->prepare(
    'INSERT INTO handbuch_ticket (mitarbeiter_id, token_hash, laeuft_ab)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR))'
)->execute([(int)$user['id'], $tokenHash]);

// Nur ueber das Cookie, nie in der Adresszeile (ENT-075) und nie im
// Antwortkoerper -- path-gebunden auf /handbuch/, HttpOnly, nur ueber HTTPS,
// SameSite=Strict.
setcookie('hb_ticket', $tokenRoh, [
    'expires'  => time() + 4 * 3600,
    'path'     => '/handbuch/',
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);

json_response(['status' => 'ok']);
