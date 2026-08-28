<?php
// Fachlogik rund um Produkte: Preis-Stammdaten fuer Offerten und Rechnungen
// (ENT-181), Produktnummer (ENT-219).
declare(strict_types=1);

// Naechste freie Produktnummer, Format P0001 aufwaerts. Aus dem bestehenden
// Hoechststand abgeleitet statt aus einem eigenen Zaehler -- gleiches Muster
// wie naechste_kundennummer() in kunden.php und beleg_naechste_nummer() in
// belege.php, aus demselben Grund: kein zweiter Zaehler, der aus dem Tritt
// geraten kann, wenn Datensaetze geloescht werden oder eine Nummer aus einem
// Nachtrag stammt (siehe planung_einrichten.php, Abschnitt Produktnummern
// nachtragen).
//
// Automatisch statt frei eingebbar, und OHNE Typ-Vorsilbe (Projektinhaber-
// Entscheidung, 2026-08-28): eine Unterscheidung Artikel/Dienstleistung gibt
// es bei uns nicht (siehe ENT-215, bewusst nicht aus dem gezeigten
// Fremdsystem uebernommen) -- ein "P" fuer alle Produkte ist darum die
// einzige Vorsilbe, die tatsaechlich etwas bedeutet.
function naechste_produktnummer(PDO $pdo): string
{
    $s = $pdo->query(
        "SELECT nummer FROM produkte WHERE nummer REGEXP '^P[0-9]{4}$'
         ORDER BY CAST(SUBSTRING(nummer, 2) AS UNSIGNED) DESC LIMIT 1"
    );
    $letzte = $s->fetchColumn();
    $n = $letzte ? ((int)substr((string)$letzte, 1)) + 1 : 1;
    return 'P' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}
