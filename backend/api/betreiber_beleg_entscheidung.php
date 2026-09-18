<?php
// Entscheidung des Empfaengers (Annehmen/Ablehnen) aus der unangemeldeten
// Ansicht entgegennehmen (ENT-605).
//
// Bewusst OHNE Anmeldung -- aus demselben Grund wie
// betreiber_beleg_oeffentlich.php: Der Empfaenger ist ein Betrieb, der diese
// Plattform noch nicht nutzt und kein Konto hat; der Token ersetzt die
// Anmeldung. Steht darum ebenfalls namentlich in OHNE_ANMELDUNG
// (test_php.mjs).
//
// NUR POST, damit ein blosser Linkaufruf -- die Vorschau eines
// Mailprogramms, ein Crawler -- nie selbst eine Entscheidung ausloest.
//
// ERSTE ENTSCHEIDUNG ZAEHLT: Ist schon einmal entschieden worden, wird eine
// weitere Einsendung stillschweigend ignoriert. Sonst koennte ein zweiter
// Klick, ein Browser-Zurueck oder ein erneuter POST eine bereits getroffene
// Entscheidung ueberschreiben.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

function entscheidung_zurueck(string $token): void
{
    header('Location: betreiber_beleg_oeffentlich.php?token=' . urlencode($token));
    exit;
}

function entscheidung_abbruch(int $code, string $text): void
{
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo $text;
    exit;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        entscheidung_abbruch(405, 'Nur POST erlaubt.');
    }

    $token = (string)($_POST['token'] ?? '');
    $wahl  = (string)($_POST['entscheidung'] ?? '');
    if ($token === '' || !in_array($wahl, ['annehmen', 'ablehnen'], true)) {
        entscheidung_abbruch(400, 'Unvollständige Anfrage.');
    }

    $pdo = betreiber_db();
    if (!hat_tabelle($pdo, 'be_belege')) {
        entscheidung_abbruch(404, 'Dieser Link ist nicht (mehr) gültig.');
    }

    $s = $pdo->prepare(
        'SELECT id, art, status, gueltig_bis, entscheidung_am FROM be_belege WHERE versand_token = ?'
    );
    $s->execute([$token]);
    $b = $s->fetch();
    if (!$b) {
        entscheidung_abbruch(404, 'Dieser Link ist nicht (mehr) gültig.');
    }

    // Schon entschieden, oder gar keine Offerte -- die Seite zeigt dann auch
    // keine Knoepfe mehr, aber ein direkter POST am Formular vorbei soll
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
        'UPDATE be_belege SET status = ?, entscheidung_am = NOW(), entscheidung_ip = ? WHERE id = ?'
    )->execute([$neuerStatus, $ip, (int)$b['id']]);

    entscheidung_zurueck($token);
} catch (Throwable $e) {
    entscheidung_abbruch(500,
        'Diese Anfrage liess sich gerade nicht verarbeiten. Bitte versuchen Sie es später erneut.');
}
