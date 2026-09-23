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

function entscheidung_zurueck(string $token, string $lage = ''): void
{
    header('Location: beleg_oeffentlich.php?token=' . urlencode($token)
        . ($lage !== '' ? '&lage=' . urlencode($lage) : ''));
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
    // laeuft ueber beleg_unterschrift.php. Ein "annehmen" hier waere der
    // alte Klick ohne Nachweis -- er wird abgewiesen, sobald die Tabelle da
    // ist. Fehlt sie (zwischen Deploy und Einrichtungslauf), bleibt es beim
    // bisherigen Weg.
    //
    // Ablehnen braucht einen Namen, der Grund ist freiwillig (Punkt 6).
    $mitUnterschrift = beleg_unterschrift_tabelle_da($pdo, '');
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
    if (beleg_fassung_tabelle_da($pdo, '')) {
        $letzte = beleg_letzte_fassung($pdo, (int)$b['id'], '');
        if ($letzte) {
            $fassungNr = (int)$letzte['nummer'];
        } else {
            $abbild = beleg_abbild_lesen($pdo, (int)$b['id'], '', beleg_absender_betrieb($pdo));
            if ($abbild !== null) {
                $fassungNr = (int)beleg_fassung_anlegen($pdo, (int)$b['id'], $abbild, 'annahme', '', '')['nummer'];
            }
        }
    }
    if ($mitUnterschrift && $fassungNr !== null) {
        $k = $pdo->prepare('SELECT k.email FROM kunden k JOIN belege b ON b.kunde_id = k.id WHERE b.id = ?');
        $k->execute([(int)$b['id']]);
        beleg_ablehnung_anlegen($pdo, '', (int)$b['id'], $fassungNr, $name, $grund,
            trim((string)$k->fetchColumn()), $ip, (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    }
    $mitFassung = hat_spalte($pdo, 'belege', 'entscheidung_fassung');
    $pdo->prepare(
        'UPDATE belege SET status = ?, entscheidung_am = NOW(), entscheidung_ip = ?'
        . ($mitFassung ? ', entscheidung_fassung = ?' : '') . ' WHERE id = ? AND entscheidung_am IS NULL'
    )->execute($mitFassung ? [$neuerStatus, $ip, $fassungNr, (int)$b['id']]
                           : [$neuerStatus, $ip, (int)$b['id']]);

    entscheidung_zurueck($token);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo 'Diese Anfrage liess sich gerade nicht verarbeiten. Bitte versuchen Sie es später erneut.';
    exit;
}
