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
