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

function entscheidung_zurueck(string $token, string $lage = ''): void
{
    header('Location: betreiber_beleg_oeffentlich.php?token=' . urlencode($token)
        . ($lage !== '' ? '&lage=' . urlencode($lage) : ''));
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
    if (!empty($b['entscheidung_am']) || !beleg_unterschreibbar((string)$b['art'])) {
        entscheidung_zurueck($token);
    }

    $heute = date('Y-m-d');
    $abgelaufen = !empty($b['gueltig_bis']) && substr((string)$b['gueltig_bis'], 0, 10) !== '0000-00-00'
        && substr((string)$b['gueltig_bis'], 0, 10) < $heute;
    if ($abgelaufen) {
        entscheidung_zurueck($token);
    }

    // SEIT ENT-688 (SCHRITT 2) GILT EINE ANNAHME ERST MIT DEM CODE, und sie
    // laeuft ueber betreiber_beleg_unterschrift.php. Ein "annehmen" hier waere der
    // alte Klick ohne Nachweis -- er wird abgewiesen, sobald die Tabelle da
    // ist. Fehlt sie (zwischen Deploy und Einrichtungslauf), bleibt es beim
    // bisherigen Weg.
    //
    // Ablehnen braucht einen Namen, der Grund ist freiwillig (Punkt 6).
    $mitUnterschrift = beleg_unterschrift_tabelle_da($pdo, 'be_');
    if ($mitUnterschrift && $wahl === 'annehmen') {
        entscheidung_zurueck($token);
    }
    $name  = mb_substr(trim((string)preg_replace('/\s+/u', ' ', (string)($_POST['name'] ?? ''))), 0, 120);
    $grund = mb_substr(trim((string)($_POST['grund'] ?? '')), 0, 4000);
    if ($mitUnterschrift && $name === '') {
        entscheidung_zurueck($token, 'name_fehlt');
    }

    $neuerStatus = $wahl === 'annehmen' ? 'bestaetigt' : 'abgelehnt';
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    // WELCHE FASSUNG entschieden wurde (ENT-688). Hat der Beleg noch keine
    // -- versendet vor ENT-688 --, wird jetzt festgehalten, was der
    // Empfaenger in diesem Moment sieht: genau das hat er angenommen oder
    // abgelehnt.
    $fassungNr = null;
    if (beleg_fassung_tabelle_da($pdo, 'be_')) {
        $letzte = beleg_letzte_fassung($pdo, (int)$b['id'], 'be_');
        if ($letzte) {
            $fassungNr = (int)$letzte['nummer'];
        } else {
            $abbild = beleg_abbild_lesen($pdo, (int)$b['id'], 'be_', be_beleg_absender($pdo));
            if ($abbild !== null) {
                $fassungNr = (int)beleg_fassung_anlegen($pdo, (int)$b['id'], $abbild, 'annahme', '', 'be_')['nummer'];
            }
        }
    }
    if ($mitUnterschrift && $fassungNr !== null) {
        $k = $pdo->prepare('SELECT k.email FROM be_kunden k JOIN be_belege b ON b.kunde_id = k.id WHERE b.id = ?');
        $k->execute([(int)$b['id']]);
        beleg_ablehnung_anlegen($pdo, 'be_', (int)$b['id'], $fassungNr, $name, $grund,
            trim((string)$k->fetchColumn()), $ip, (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
        // Der Grund gehoert auch in den Faden (ENT-677): Dort steht das
        // Gespraech ueber diese Offerte, und dort antwortet der Betreiber.
        if ($grund !== '') {
            be_beleg_nachricht_anlegen($pdo, (int)$b['id'], 'kunde', $name, 'Abgelehnt: ' . $grund);
        }
    }
    $mitFassung = hat_spalte($pdo, 'be_belege', 'entscheidung_fassung');
    $pdo->prepare(
        'UPDATE be_belege SET status = ?, entscheidung_am = NOW(), entscheidung_ip = ?'
        . ($mitFassung ? ', entscheidung_fassung = ?' : '') . ' WHERE id = ? AND entscheidung_am IS NULL'
    )->execute($mitFassung ? [$neuerStatus, $ip, $fassungNr, (int)$b['id']]
                           : [$neuerStatus, $ip, (int)$b['id']]);

    entscheidung_zurueck($token);
} catch (Throwable $e) {
    entscheidung_abbruch(500,
        'Diese Anfrage liess sich gerade nicht verarbeiten. Bitte versuchen Sie es später erneut.');
}
