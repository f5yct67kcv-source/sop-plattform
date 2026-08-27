<?php
// Kundenentscheidung (Annehmen/Ablehnen) aus der unangemeldeten Web-Ansicht
// entgegennehmen (ENT-192).
//
// Bewusst OHNE require_session() -- aus demselben Grund wie
// beleg_oeffentlich.php: Der Kunde hat kein Konto, der Token ersetzt die
// Anmeldung. Nur POST erlaubt, damit ein blosser Linkaufruf (Vorschau in
// einem Mailprogramm, ein Suchmaschinen-Crawler) nie selbst eine Entscheidung
// ausloest.
//
// ERSTE ENTSCHEIDUNG ZAEHLT: Ist schon einmal entschieden worden, wird eine
// weitere Einsendung stillschweigend ignoriert (Redirect ohne Aenderung) --
// sonst koennte ein zweiter Klick, ein doppelt abgeschickter Browser-Zurueck
// oder ein manipulierter erneuter POST eine bereits getroffene Entscheidung
// ueberschreiben.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require __DIR__ . '/../belege.php';

function entscheidung_zurueck(string $token): void
{
    header('Location: beleg_oeffentlich.php?token=' . urlencode($token));
    exit;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        header('Content-Type: text/html; charset=utf-8');
        echo 'Nur POST erlaubt.';
        exit;
    }

    $token = (string)($_POST['token'] ?? '');
    $wahl = (string)($_POST['entscheidung'] ?? '');
    if ($token === '' || !in_array($wahl, ['annehmen', 'ablehnen'], true)) {
        http_response_code(400);
        header('Content-Type: text/html; charset=utf-8');
        echo 'Unvollständige Anfrage.';
        exit;
    }

    $pdo = db();
    $s = $pdo->prepare('SELECT id, art, status, gueltig_bis, entscheidung_am FROM belege WHERE versand_token = ?');
    $s->execute([$token]);
    $b = $s->fetch();
    if (!$b) {
        http_response_code(404);
        header('Content-Type: text/html; charset=utf-8');
        echo 'Dieser Link ist nicht (mehr) gültig.';
        exit;
    }

    // Schon entschieden, oder gar keine Offerte (Rechnungen kennen dieses
    // Konzept nicht) -- die Seite selbst zeigt in dem Fall auch keine
    // Knoepfe mehr, aber ein direkter POST unter Umgehung des Formulars soll
    // trotzdem nichts bewirken.
    if (!empty($b['entscheidung_am']) || $b['art'] !== 'offerte') {
        entscheidung_zurueck($token);
    }

    $heute = date('Y-m-d');
    $abgelaufen = !empty($b['gueltig_bis']) && substr((string)$b['gueltig_bis'], 0, 10) !== '0000-00-00'
        && substr((string)$b['gueltig_bis'], 0, 10) < $heute;
    if ($abgelaufen) {
        entscheidung_zurueck($token);
    }

    $neuerStatus = $wahl === 'annehmen' ? 'bestaetigt' : 'abgelehnt';
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $pdo->prepare(
        'UPDATE belege SET status = ?, entscheidung_am = NOW(), entscheidung_ip = ? WHERE id = ?'
    )->execute([$neuerStatus, $ip, (int)$b['id']]);

    entscheidung_zurueck($token);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo 'Diese Anfrage liess sich gerade nicht verarbeiten. Bitte versuchen Sie es später erneut.';
    exit;
}
