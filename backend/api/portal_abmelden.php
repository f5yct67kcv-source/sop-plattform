<?php
// Kundenportal: abmelden (ENT-441).
//
// POST -> { status: 'ok' }
//
// Loescht die Sitzung serverseitig. Ein Token, der nur im Browser
// weggeworfen wird, bleibt bis zum Ablauf gueltig -- und liegt bis dahin
// dort, wo er hingeschickt wurde.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

// Vorher pruefen, wer es ist: Ohne das koennte jemand mit einem geratenen
// Token fremde Sitzungen beenden. Ein Aergernis, kein Schaden -- aber
// unnoetig.
$zugang = require_kundensession();

$token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
db()->prepare('DELETE FROM kunden_sessions WHERE token = ?')
    ->execute([sitzung_abdruck((string)$token)]);

json_response(['status' => 'ok']);
