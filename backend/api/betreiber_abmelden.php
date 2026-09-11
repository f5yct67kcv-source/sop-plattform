<?php
// Die eigene Betreiber-Sitzung beenden (ENT-519).
//
// Wirkt nur mit dem Token, den man ohnehin schon hat, und trifft nichts
// ausser dem eigenen Eintrag -- dieselbe Ueberlegung wie bei logout.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber();

$token   = (string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? '');
$abdruck = sitzung_abdruck($token);
betreiber_db()->prepare('DELETE FROM betreiber_sessions WHERE token = ?')->execute([$abdruck]);

json_response(['status' => 'ok']);
