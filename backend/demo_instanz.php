<?php
declare(strict_types=1);
// Der eine Griff in eine Demo-Instanz hinein (ENT-600).
//
// WARUM EINE EIGENE DATEI: Sie ist der Leim zwischen zwei Ebenen, die
// sonst nichts voneinander wissen. betreiber.php weiss, wie man eine
// Mandanten-Datenbank findet (mandant_db). demo_reset.php weiss, wie man
// eine Demo-Instanz leert. Keine der beiden darf die andere einbinden:
// demo_reset.php läuft auch in den Demo-Bündeln, wo es keinen
// Betreiber-Bereich gibt, und betreiber.php läuft auch dort, wo es keine
// Demo gibt. Also steht der Griff hier, wird nur von den Demo-Endpunkten
// des Betreiber-Bereichs eingebunden und zwingt niemandem etwas auf.
//
// GELEERT WIRD ÜBER DIESEN EINEN WEG, nicht an drei Stellen: Beenden,
// Ablaufen und Freigeben tun dasselbe, und wenn es dreimal dasteht, wird
// beim nächsten Umbau eine Stelle vergessen -- die, die am seltensten
// läuft, also der Ablauf, also genau die, die niemand ansieht.
require_once __DIR__ . '/betreiber.php';
require_once __DIR__ . '/demo_reset.php';
require_once __DIR__ . '/demo_zugang.php';

// Leert die Instanz eines Platzes und sät die Systemrollen neu.
//
// Gibt null zurück, wenn es geklappt hat, sonst den GRUND als Satz. Kein
// bool: "nicht eingetragen", "zeigt auf die Standard-Datenbank", "nicht
// erreichbar" und "nicht eingerichtet" sind vier verschiedene Aussagen,
// und wer sie zu false zusammenzieht, schickt den Betreiber auf die Suche
// (CLAUDE.md: „Unbekannt" darf nie wie „keine" aussehen).
function demo_instanz_leeren(PDO $betreiber, string $platz): ?string
{
    if (!hat_tabelle($betreiber, 'mandant')) {
        return 'Der Mandantenstamm ist noch nicht eingerichtet.';
    }
    $stmt = $betreiber->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
    $stmt->execute([$platz]);
    $m = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$m) {
        return "Der Platz „$platz“ ist im Mandantenstamm nicht eingetragen.";
    }

    // DER WICHTIGSTE FALL. Fällt ein Platz auf die Standardverbindung
    // zurück -- weil db_name leer ist oder das Geheimnis fehlt --, zeigt er
    // auf die Datenbank des laufenden Betriebs. Ein Leeren darauf löschte
    // echte Einsätze, echtes Personal und echte Löhne. Darum wird hier
    // abgebrochen und nicht "sicherheitshalber trotzdem" gearbeitet.
    $lage = mandant_verbindung_bereit($m);
    if ($lage === 'standardverbindung') {
        return "Der Platz „$platz“ zeigt auf die Standard-Datenbank statt auf eine eigene. "
             . 'Es wurde nichts geleert.';
    }
    if ($lage !== 'bereit') {
        return "Der Platz „$platz“ ist nicht verbunden ($lage). Es wurde nichts geleert.";
    }

    try {
        $instanz = mandant_db($m);
    } catch (Throwable $e) {
        return "Der Platz „$platz“ ist nicht erreichbar. Es wurde nichts geleert.";
    }

    demo_reset_alle_tabellen_leeren($instanz);
    demo_reset_systemrollen_saeen($instanz);
    return null;
}

// Neues Passwort fuer ein BESTEHENDES Demo-Konto (ENT-601, Punkt 6/7).
//
// Zwei Aufrufer teilen sich diesen Weg und wollen absichtlich dasselbe
// Ergebnis: demo_anfordern.php, wenn dieselbe E-Mail-Adresse ein zweites
// Mal anfragt, und demo_erneut_senden.php, wenn jemand seinen Zugang
// verloren hat. Beide duerfen NIE eine zweite Instanz anlegen -- nur ein
// neues Passwort fuer die, die schon existiert.
//
// Gibt ['fehler' => string, 'mail' => null] oder ['fehler' => null,
// 'mail' => [...]] zurueck -- die aufrufende Datei entscheidet, ob und wie
// sie einen Fehler nach aussen zeigt (demo_erneut_senden.php zeigt NIE
// etwas, demo_anfordern.php zeigt eine Betriebsstoerung).
function demo_zugang_neues_passwort(PDO $betreiber, array $zugang): array
{
    $platz = (string)$zugang['platz'];
    $stmt = $betreiber->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
    $stmt->execute([$platz]);
    $m = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$m) {
        return ['fehler' => "Der Platz „$platz“ ist im Mandantenstamm nicht eingetragen.", 'mail' => null];
    }
    if (mandant_verbindung_bereit($m) !== 'bereit') {
        return ['fehler' => "Der Platz „$platz“ ist nicht verbunden.", 'mail' => null];
    }
    try {
        $instanz = mandant_db($m);
    } catch (Throwable $e) {
        return ['fehler' => "Der Platz „$platz“ ist nicht erreichbar.", 'mail' => null];
    }

    $s = $instanz->prepare('SELECT id FROM mitarbeiter WHERE name = ? LIMIT 1');
    $s->execute([(string)$zugang['login']]);
    $konto = $s->fetch(PDO::FETCH_ASSOC);
    if (!$konto) {
        // Das Register sagt "aktiv", das Konto in der Instanz fehlt --
        // ein Widerspruch, der nicht still uebergangen wird (Hausregel:
        // "unbekannt" darf nie wie "keine" aussehen).
        return ['fehler' => "Das Konto zum Zugang auf „$platz“ fehlt in der Instanz.", 'mail' => null];
    }

    $passwort = demo_passwort_erzeugen();
    $instanz->prepare('UPDATE mitarbeiter SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($passwort, PASSWORD_DEFAULT), (int)$konto['id']]);
    // Bestehende Sitzungen fallen weg -- ein neues Passwort ist ein
    // Wiederherstellungsvorgang, kein normaler Wechsel aus einer
    // angemeldeten Sitzung heraus (dieselbe Regel wie in
    // passwort_zuruecksetzen.php).
    $instanz->prepare('DELETE FROM sessions WHERE mitarbeiter_id = ?')->execute([(int)$konto['id']]);

    $mail = demo_zugang_mail(
        (string)$zugang['firma'],
        (string)$zugang['person'],
        (string)demo_platz_adresse($platz),
        (string)$zugang['login'],
        $passwort,
        (string)$zugang['laeuft_ab_am']
    );
    return ['fehler' => null, 'mail' => $mail];
}
