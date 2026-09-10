<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';

// Nur aus dem Kopfbereich (ENT-075) -- wie beim Anmelden.
$token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
if ($token) {
    $stmt = db()->prepare('DELETE FROM sessions WHERE token = ?');
    $stmt->execute([sitzung_abdruck((string)$token)]);
}
json_response(['status' => 'ok']);
