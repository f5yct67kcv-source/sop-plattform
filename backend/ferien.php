<?php
declare(strict_types=1);
// Ferienanspruch nach Art. 20 GAV (ENT-255).
//
// Reiner Rechenkern, keine Datenbankzugriffe -- derselbe Grund wie bei
// kategorie_pruefen()/pensum_pruefen() in planung.php: leichter fuer sich
// allein zu pruefen, und die Aufrufer (Endpunkte) entscheiden, welche
// Abwesenheiten und Zeitraeume sie hereingeben.
//
// Der volle Wortlaut steht erfasst in sop-projekt/90-gav/regelmatrix.md
// (Abschnitt "Art. 20 Ferien"). Was hier UNVOLLSTAENDIG bleibt, steht dort
// unter GAV-AUS-012 -- die Kuerzung nach Ziff. 5 laeuft mit einer
// ausdruecklich als ANNAHME markierten Auslegung, nicht als Tatsache.
require_once __DIR__ . '/planung.php'; // kategorie_pruefen()

// Abwesenheitsarten, die Ferien betreffen koennen (Ziff. 5-Kuerzung) bzw.
// die Kategorie-C-Personen als Kalendereintrag ohne Saldo erfassen duerfen.
// Eigene Konstante statt verstreuter String-Listen -- ein neuer Endpunkt,
// der eine Art vergisst, faellt sonst erst beim Testen auf.
const FERIEN_ABWESENHEITSARTEN = ['ferien', 'krankheit', 'unfall', 'militaer', 'schwangerschaft'];
// Ziff. 5: Krankheit/Unfall/Militaer-/Zivilschutzdienst teilen sich dieselbe
// Zwei-Monats-Schwelle, Schwangerschaft hat eine eigene Drei-Monats-Schwelle.
const FERIEN_KUERZUNGSGRUPPE_KRANKHEIT = ['krankheit', 'unfall', 'militaer'];
const FERIEN_KUERZUNGSGRUPPE_SCHWANGERSCHAFT = ['schwangerschaft'];

// -- Dienstjahr / Altersjahr -------------------------------------------
// Art. 20 Ziff. 3, wortgleich in gav-2026.pdf und im PAKO-Kommentar: "Bei
// Arbeitsaufnahme vor dem 1. Juli wird das Eintrittsjahr als erstes
// Dienstjahr bzw. bei Geburtstag vor dem 1. Juli das Altersjahr
// angerechnet." Der Wortlaut nennt nur den Vor-Fall; der Nach-Fall (Eintritt
// oder Geburtstag AM oder NACH dem 1. Juli) ist der Umkehrschluss -- keine
// Auslegungsfrage, weil kein zweiter Fall uebrig bleibt, den man anders
// lesen koennte: "vor dem 1. Juli" ist gleichbedeutend mit "im Monat
// Januar bis Juni", weil der 1. Juli selbst schon nicht mehr "davor" liegt.
function ferien_dienstjahr(string $eintritt, int $jahr): int
{
    $e = new DateTime($eintritt);
    $vorJuli = (int)$e->format('n') < 7;
    $erstesJahr = (int)$e->format('Y') + ($vorJuli ? 0 : 1);
    return $jahr - $erstesJahr + 1;
}

function ferien_altersjahr(string $geburtsdatum, int $jahr): int
{
    $g = new DateTime($geburtsdatum);
    $vorJuli = (int)$g->format('n') < 7;
    $verschiebung = $vorJuli ? 0 : 1;
    return $jahr - (int)$g->format('Y') - $verschiebung;
}

// -- Grundanspruch nach Kategorie (Ziff. 1 und 2) ------------------------
// Kategorie A/B: Tage-Anspruch, aus der hoechsten erfuellten Stufe (6 vor 5
// vor 4 Wochen). Die vier Bedingungen fuer "5 Wochen" in Ziff. 1.b stehen im
// Wortlaut als Aufzaehlung ohne verbindendes "und" zwischen den Gruppen --
// gelesen als vier unabhaengige ODER-Bedingungen (siehe Regelmatrix).
//
// Die Grenze "bis zum vollendeten 20. Altersjahr" ist SCHLUSS (eigene
// Folgerung, kein woertlicher Fund) als "so lange altersjahr <= 20" gelesen,
// nicht "< 20": Ziff. 2 (Kategorie C) formuliert dieselbe Grenze als "5
// Wochen bis zum zurueckgelegten 20. Altersjahr" und laesst den Anspruch erst
// "ab dem Kalenderjahr des vollendeten 21. Altersjahrs" auf 4 Wochen fallen
// -- fuer das Jahr, in dem die 20 gerade erreicht wird, bliebe sonst eine
// Luecke, die keine der beiden Kategorien so meint. Dieselbe Grenze wird
// hier fuer A/B uebernommen, um die beiden Parallelbestimmungen konsistent
// zu lesen.
function ferien_grundanspruch_tage_ab(int $dienstjahr, int $altersjahr): int
{
    // dienstjahr < 1 heisst nach Ziff. 3 nur "die Schwellen-Zaehlung fuer
    // dieses Jahr hat noch nicht eingesetzt" (z. B. Eintritt nach dem
    // 1. Juli im selben Kalenderjahr) -- NICHT "kein Anspruch". Der
    // Basisanspruch ab Ziff. 1.a gilt ab der tatsaechlichen Anstellung; ob
    // im betrachteten Jahr ueberhaupt ein Arbeitsverhaeltnis bestand, prueft
    // der Aufrufer (ferien_anspruch_jahr) getrennt ueber die gearbeiteten
    // Monate, bevor diese Funktion ueberhaupt gerufen wird.
    $dienstjahr = max(1, $dienstjahr);
    if ($dienstjahr >= 10 && $altersjahr >= 60) { return 30; }
    if (($dienstjahr >= 5 && $altersjahr >= 45)
        || ($dienstjahr >= 10 && $altersjahr >= 40)
        || $dienstjahr >= 15
        || $altersjahr <= 20) {
        return 25;
    }
    return 20;
}

// Kategorie C hat KEINEN Tage-Anspruch, sondern einen Lohnzuschlag auf jede
// Abrechnung (Ziff. 2) -- das ist Lohnbuchhaltung, die dieses Werkzeug nicht
// baut (Teil B, "keine produktive Lohnberechnung"). Gibt bewusst null
// zurueck statt einer Tageszahl: ein Aufrufer, der das ignoriert und trotzdem
// einen Saldo anzeigt, waere der eigentliche Fehler, kein stiller
// Nullanspruch.
function ferien_grundanspruch_tage_c(string $geburtsdatum, int $jahr): ?int
{
    return null;
}

// -- Pro-rata bei unterjährigem Ein-/Austritt (Ziff. 6) ------------------
// "Fuer jeden gearbeiteten Monat Anspruch auf einen Zwoelftel der fuer das
// ganze Jahr vorgesehenen Ferien." Ein angebrochener Monat zaehlt als voller
// Monat (SCHLUSS, gaengige Praxis bei monatsbasierten Pro-rata-Regeln ohne
// gegenteiligen Wortlaut -- der Artikel unterscheidet nirgends zwischen
// vollem und angebrochenem Monat, anders als in Ziff. 5, wo er es fuer die
// Kuerzung ausdruecklich tut).
function ferien_gearbeitete_monate(string $eintritt, ?string $austritt, int $jahr): int
{
    $jahresanfang = new DateTime("$jahr-01-01");
    $jahresende = new DateTime("$jahr-12-31");
    $von = max(new DateTime($eintritt), $jahresanfang);
    $bis = $austritt !== null ? min(new DateTime($austritt), $jahresende) : $jahresende;
    if ($von > $bis) { return 0; }
    $monate = ((int)$bis->format('Y') - (int)$von->format('Y')) * 12
        + ((int)$bis->format('n') - (int)$von->format('n')) + 1;
    return max(0, min(12, $monate));
}

function ferien_ist_unterjaehrig(string $eintritt, ?string $austritt, int $jahr): bool
{
    $e = new DateTime($eintritt);
    if ((int)$e->format('Y') === $jahr && ($e->format('m-d') !== '01-01')) { return true; }
    if ($austritt !== null) {
        $a = new DateTime($austritt);
        if ((int)$a->format('Y') === $jahr && $a->format('m-d') !== '12-31') { return true; }
    }
    return false;
}

// -- Kuerzung bei langer unverschuldeter Abwesenheit (Ziff. 5) -----------
// ANNAHME (GAV-AUS-012, Status offen): Monate werden kumuliert je
// Kalenderjahr und je Ursachengruppe gezaehlt, nicht je einzelnem Ausfall.
// Ein Aufrufer, der diese Zahl anzeigt, MUSS sie als ANNAHME kennzeichnen
// (siehe abwesenheit_saldo.php) -- nie als bestaetigten Wert ausgeben.
//
// "Voller Monat" wird hier technisch als 30 Tage gezaehlt (SCHLUSS, eigene
// Konvention zur Umrechnung von Tagen in Monate -- der GAV nennt keine
// Tagesbasis). Das ist unabhaengig von der oben genannten Auslegungsfrage:
// selbst bei Klaerung auf "je einzelnem Ausfall" bliebe die Frage, wie viele
// Tage ein "voller Monat" hat, offen und muesste hier so oder aehnlich
// technisch entschieden werden.
//
// $zeitraeume: Liste von ['typ' => ..., 'von' => 'Y-m-d', 'bis' => 'Y-m-d']
// aus genehmigten Abwesenheiten IM BETRACHTETEN KALENDERJAHR.
function ferien_kuerzung_zwoelftel(array $zeitraeume, int $jahr): int
{
    $tageKrankheit = 0;
    $tageSchwangerschaft = 0;
    foreach ($zeitraeume as $z) {
        $von = new DateTime(max($z['von'], "$jahr-01-01"));
        $bis = new DateTime(min($z['bis'], "$jahr-12-31"));
        if ($von > $bis) { continue; }
        $tage = (int)$von->diff($bis)->days + 1;
        if (in_array($z['typ'], FERIEN_KUERZUNGSGRUPPE_KRANKHEIT, true)) {
            $tageKrankheit += $tage;
        } elseif (in_array($z['typ'], FERIEN_KUERZUNGSGRUPPE_SCHWANGERSCHAFT, true)) {
            $tageSchwangerschaft += $tage;
        }
    }
    $monateKrankheit = intdiv($tageKrankheit, 30);
    $monateSchwangerschaft = intdiv($tageSchwangerschaft, 30);
    $zwoelftel = 0;
    if ($monateKrankheit >= 2) { $zwoelftel += $monateKrankheit - 2 + 1; }
    if ($monateSchwangerschaft >= 3) { $zwoelftel += $monateSchwangerschaft - 3 + 1; }
    return $zwoelftel;
}

// -- Gesamtanspruch eines Kalenderjahres ----------------------------------
// Fasst Grundanspruch, Pro-rata und Kuerzung zusammen. Gibt fuer Kategorie C
// null zurueck (siehe ferien_grundanspruch_tage_c) -- der Aufrufer darf dann
// KEINEN Saldo anzeigen, nur den Kalendereintrag selbst.
//
// Rueckgabe absichtlich mit allen Zwischenschritten, nicht nur der
// Endzahl: Rohanspruch, Kuerzung und Pro-rata-Faktor bleiben getrennt
// nachvollziehbar -- dieselbe Anforderung wie bei Rohzeit/bewerteter
// Zeit/Bonus/Zuschlag in der Arbeitszeit (CLAUDE.md, GAV-Logik). Eine
// einzelne fertige Zahl waere hier eine Blackbox.
function ferien_anspruch_jahr(
    string $kategorie,
    string $geburtsdatum,
    string $eintritt,
    ?string $austritt,
    int $jahr,
    array $kuerzungsZeitraeume = []
): array {
    $kategorie = kategorie_pruefen($kategorie);
    if ($kategorie === 'C') {
        return [
            'kategorie' => 'C',
            'grundanspruch_tage' => null,
            'kuerzung_zwoelftel' => null,
            'pro_rata_monate' => null,
            'anspruch_tage' => null,
            'hinweis' => 'Kategorie C: Ferien als Lohnzuschlag, kein Tage-Saldo (Art. 20 Ziff. 2).',
        ];
    }

    $monate = ferien_gearbeitete_monate($eintritt, $austritt, $jahr);
    if ($monate === 0) {
        return [
            'kategorie' => $kategorie,
            'dienstjahr' => ferien_dienstjahr($eintritt, $jahr),
            'altersjahr' => ferien_altersjahr($geburtsdatum, $jahr),
            'grundanspruch_tage' => 0,
            'pro_rata_monate' => 0,
            'kuerzung_zwoelftel' => 0,
            'anspruch_tage' => 0.0,
            'kuerzung_ist_annahme' => false,
            'hinweis' => 'Kein Arbeitsverhaeltnis in diesem Kalenderjahr.',
        ];
    }

    $dienstjahr = ferien_dienstjahr($eintritt, $jahr);
    $altersjahr = ferien_altersjahr($geburtsdatum, $jahr);
    $grundTage = ferien_grundanspruch_tage_ab($dienstjahr, $altersjahr);

    $unterjaehrig = ferien_ist_unterjaehrig($eintritt, $austritt, $jahr);
    $tageNachProRata = $unterjaehrig ? round($grundTage * $monate / 12, 1) : (float)$grundTage;

    $zwoelftel = ferien_kuerzung_zwoelftel($kuerzungsZeitraeume, $jahr);
    $tageNachKuerzung = round($tageNachProRata * max(0, 12 - $zwoelftel) / 12, 1);

    return [
        'kategorie' => $kategorie,
        'dienstjahr' => $dienstjahr,
        'altersjahr' => $altersjahr,
        'grundanspruch_tage' => $grundTage,
        'pro_rata_monate' => $unterjaehrig ? $monate : null,
        'kuerzung_zwoelftel' => $zwoelftel,
        'anspruch_tage' => $tageNachKuerzung,
        'kuerzung_ist_annahme' => $zwoelftel > 0,
    ];
}
