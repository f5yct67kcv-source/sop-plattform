<?php
declare(strict_types=1);
// ══════════════════════════════════════════════════════════════════════════
// LOHNLAUF — BRUTTOSEITE (ENT-451, Etappe 3).
//
// Aus abgeglichenen Ist-Zeiten entstehen hier Lohnzeilen. Was NICHT hier
// entsteht: Abzuege, Quellensteuer und das Abrechnungsdokument -- das sind
// die Etappen 4 bis 6.
//
// DER SERVER RECHNET SELBST. Die Stunden kommen aus der Datenbank und
// werden mit backend/gavzeit.php bewertet; aus der Anfrage wird KEINE
// fertige Zahl uebernommen. Ein Lohnlauf ist ein Dokument mit
// Rechtswirkung -- seine Zahlen duerfen nicht davon abhaengen, was ein
// Browser schickt.
//
// GETRENNT NACHVOLLZIEHBAR (CLAUDE.md Teil B): Rohzeit, Nettozeit,
// Zeitbonus und Zeitzuschlag werden einzeln gefuehrt und gespeichert, nie
// nur ein fertiger Stundenwert. Wer spaeter fragt, wie eine Zahl zustande
// kam, muss es ablesen koennen.
//
// WAS GESPERRT WIRD STATT GERECHNET: Jede Zeile, deren Grundlage fehlt oder
// offen ist, bekommt einen benannten Sperrgrund und KEINEN Betrag -- nie
// eine Null. "Unbekannt" und "keine" sind zwei verschiedene Aussagen.
// ══════════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/gavzeit.php';
require_once __DIR__ . '/lohn.php';
require_once __DIR__ . '/planung.php';

// Sperrgruende, ausdruecklich benannt statt als freier Text. Wer einen
// ergaenzt, entscheidet ihn bewusst -- und die Oberflaeche kann jeden
// einzelnen erklaeren, statt einen Rohschluessel anzuzeigen.
function lohnlauf_sperrgruende(): array
{
    return [
        'sparte_reinigung'   => 'Für Reinigungseinsätze gilt ein anderer, noch nicht geprüfter GAV (OP-32). Diese Stunden fliessen in keine Lohnzeile.',
        'kein_regelwerk'     => 'Für dieses Datum ist kein GAV-Regelwerk hinterlegt — es wird nicht gerechnet, statt auf abgelaufener Grundlage.',
        'kein_ansatz'        => 'Für diesen Zeitraum ist kein Lohnansatz erfasst.',
        'ansatz_ohne_kategorie' => 'Beim erfassten Lohnansatz fehlt die Anstellungskategorie. Ohne sie steht nicht fest, ob der Betrag pro Stunde oder pro Monat gilt — es wird nicht geraten.',
        'ansatz_andere_lohnform' => 'Der jüngste Lohnansatz wurde für die andere Lohnform erfasst (Monat statt Stunde oder umgekehrt). Nach einer Umstufung nach Art. 8 braucht es einen neuen Ansatz — der alte Betrag wird nicht umgedeutet.',
        'keine_kategorie'    => 'Ohne Anstellungskategorie nach Art. 8 steht die Lohnform nicht fest.',
        'zeiten_unvollstaendig' => 'Die Ist-Zeiten der Schicht sind unvollständig erfasst.',
        'pause_laenger_als_schicht' => 'Die erfasste Pause ist länger als die Schicht — das ist ein Erfassungsfehler, keine Zeit.',
        'monatslohn_offen'   => 'Für den Monatslohn (Kategorie A und B) ist der Rechenweg noch nicht gebaut — Etappe 3 deckt den Stundenlohn ab.',
        'anordnung_fehlt'    => 'Der Zuschlag ist als Stundenentschädigung vereinbart. Nach Art. 19 entsteht er aus dem angeordneten Einsatz — die Anordnung je Schicht führt das Datenmodell noch nicht.',
        'ausgleich_offen'    => 'Art. 14 Ziff. 3 lässt für die Mehrstunden über 210 die Auszahlung ODER den Ausgleich als Freizeit innerhalb von drei Monaten zu. Welches von beidem gilt, ist nicht festgelegt — bis dahin entsteht kein Betrag.',
        // ── Abzugsseite (Etappe 4) ──────────────────────────────────────
        'kein_sv_regelwerk'  => 'Für dieses Beitragsjahr sind die Sätze für AHV, IV und EO nicht erfasst. Es wird nicht mit den Sätzen eines anderen Jahres gerechnet.',
        'kein_alv_regelwerk' => 'Für dieses Beitragsjahr ist der ALV-Satz nicht erfasst. Es wird nicht mit den Sätzen eines anderen Jahres gerechnet.',
        'kein_nbu_satz'      => 'Es besteht Deckung gegen Nichtberufsunfälle, aber der Prämiensatz des Versicherers ist nicht erfasst.',
        'kein_ktg_satz'      => 'Der Krankentaggeld-Satz ist nicht erfasst. Solange er fehlt, wird nicht gerechnet — auch nicht mit null.',
        'kein_bvg_satz'      => 'Der BVG-Beitrag aus der Meldung der Pensionskasse ist nicht erfasst.',
        'nbu_keine_deckung'  => 'Unter acht Wochenstunden besteht keine Deckung gegen Nichtberufsunfälle (Merkblatt 6.05 Ziff. 4). Es darf kein Beitrag abgezogen werden.',
        'nbu_unbekannt'      => 'Ob eine Deckung gegen Nichtberufsunfälle besteht, ist nicht ermittelt — es fehlt die Stundenhistorie oder das UVG-Regelwerk des Jahres.',
        'nbu_pruefen'        => 'Die geleisteten Stunden ergeben keine Deckung, aber im Zeitraum liegen Ausfalltage wegen Unfall oder Krankheit. Ziff. 4 der Empfehlung 7/87 lässt sie ergänzen; wie, ist nicht geklärt. Von Hand prüfen.',
        'kein_pako'          => 'Ohne Anstellungskategorie lässt sich der Vollzugskostenbeitrag nach Art. 6 Ziff. 2 nicht bestimmen.',
        'quellensteuer_offen' => 'Die Quellensteuer ist Etappe 5 und bewusst gesperrt statt mit null gerechnet — ein nicht nachgeführter kantonaler Tarif produziert weiter plausible Zahlen. Betroffene Personen werden von Hand abgerechnet.',
        // Die wichtigste der Abzugsseite: Eine Summe ueber eine nicht
        // gerechnete Zeile ist keine Summe, sondern eine zu hohe Zahl.
        'abzug_fehlt'        => 'Solange ein Abzug fehlt, entsteht weder ein Nettolohn noch ein Auszahlungsbetrag. Eine Summe, die den fehlenden Abzug als null behandelt, wäre plausibel und zu hoch — und wer sie ausbezahlt, zahlt zu viel und schuldet die Beiträge trotzdem.',
    ];
}

// ── Zeiten einer Person im Zeitraum ──────────────────────────────────────
// Geliefert wird je Schicht die volle Aufschluesselung, nicht nur die
// Summe. Nur ABGEGLICHENE Schichten zaehlen: "Planung bleibt Planung"
// (ENT-045) -- was noch offen ist, wird gezaehlt und benannt, nicht
// stillschweigend weggelassen.
function lohnlauf_zeiten(PDO $pdo, int $maId, string $von, string $bis): array
{
    $sql = "SELECT z.einsatz_id, e.datum, e.sparte, e.kunde_name, e.objekt_id,
                   z.ist_status, z.ist_von, z.ist_bis, z.ist_pause_min, z.ist_pause_bezahlt_ma
            FROM einsatz_zuteilung z
            JOIN einsaetze e ON e.id = z.einsatz_id
            WHERE z.mitarbeiter_id = ? AND e.datum BETWEEN ? AND ?
              AND e.status <> 'abgesagt'
            ORDER BY e.datum, z.ist_von";
    $st = $pdo->prepare($sql);
    $st->execute([$maId, $von, $bis]);

    $schichten = [];
    $offen = 0;
    foreach ($st->fetchAll() as $r) {
        if (($r['ist_status'] ?? 'offen') !== 'abgeglichen') { $offen++; continue; }

        $datum = (string)$r['datum'];
        $eintrag = [
            'einsatz_id' => (int)$r['einsatz_id'], 'datum' => $datum,
            'von' => $r['ist_von'], 'bis' => $r['ist_bis'],
            'pause_min' => $r['ist_pause_min'] === null ? null : (int)$r['ist_pause_min'],
            'sparte' => $r['sparte'],
            'roh_min' => null, 'netto_min' => null, 'bonus_min' => null, 'bewertet_min' => null,
            'gesperrt_grund' => null,
        ];

        // Reihenfolge der Pruefungen: erst was die Schicht ueberhaupt
        // ausschliesst, dann was sie unvollstaendig macht. Ein Grund je
        // Schicht -- zwei Gruende nebeneinander sagen weniger als einer.
        if (!gavzeit_gilt($r['sparte'])) {
            $eintrag['gesperrt_grund'] = 'sparte_reinigung';
        } elseif (!gavzeit_regel($datum)) {
            $eintrag['gesperrt_grund'] = 'kein_regelwerk';
        } elseif (!$r['ist_von'] || !$r['ist_bis']) {
            $eintrag['gesperrt_grund'] = 'zeiten_unvollstaendig';
        } else {
            $netto = gavzeit_netto_min($r['ist_von'], $r['ist_bis'],
                $r['ist_pause_min'], $r['ist_pause_bezahlt_ma']);
            if ($netto === null) {
                $eintrag['gesperrt_grund'] = 'pause_laenger_als_schicht';
            } else {
                $eintrag['roh_min']   = gavzeit_roh_min($r['ist_von'], $r['ist_bis']);
                $eintrag['netto_min'] = $netto;
                $eintrag['bonus_min'] = gavzeit_bonus_min($datum, $r['ist_von'], $r['ist_bis']);
                // Bewertete Zeit = Nettozeit + Zeitbonus. Art. 12 Ziff. 2:
                // "Dieser Zeitbonus fliesst in die Berechnung der Arbeitszeit
                // ein." Beide Groessen bleiben zusaetzlich einzeln stehen.
                $eintrag['bewertet_min'] = $netto + (float)$eintrag['bonus_min'];
            }
        }
        $schichten[] = $eintrag;
    }

    $summe = ['roh_min' => 0, 'netto_min' => 0, 'bonus_min' => 0.0, 'bewertet_min' => 0.0];
    $gesperrt = [];
    foreach ($schichten as $s) {
        if ($s['gesperrt_grund']) {
            $gesperrt[$s['gesperrt_grund']] = ($gesperrt[$s['gesperrt_grund']] ?? 0) + 1;
            continue;
        }
        $summe['roh_min']      += $s['roh_min'];
        $summe['netto_min']    += $s['netto_min'];
        $summe['bonus_min']    += (float)$s['bonus_min'];
        $summe['bewertet_min'] += (float)$s['bewertet_min'];
    }
    return ['schichten' => $schichten, 'summe' => $summe,
            'gesperrt' => $gesperrt, 'nicht_abgeglichen' => $offen];
}

// ── Wochenstunden fuer die NBU-Unterstellung (ENT-451, Etappe 4) ─────────
//
// Liefert die effektiv geleisteten Stunden je Kalenderwoche ueber die
// letzten $monate Monate. Grundlage der Ermittlung nach Empfehlung 7/87;
// gerechnet wird sie im Kern (lohn_nbu_ermittlung), hier wird nur gezaehlt.
//
// ZWEI ENTSCHEIDUNGEN, DIE DAS ERGEBNIS VERAENDERN -- beide gegen die
// naheliegende Wahl:
//
// 1. GEZAEHLT WIRD DIE NETTOZEIT, NICHT DIE BEWERTETE. Die bewertete Zeit
//    enthaelt den Zeitbonus nach Art. 12 Ziff. 2 GAV -- eine tarifliche
//    Gutschrift, keine geleistete Arbeitszeit. Wer sie mitzaehlt, hebt
//    jemanden mit sieben tatsaechlichen Stunden ueber die Acht-Stunden-
//    Schwelle und begruendet einen Abzug auf Stunden, die nie gearbeitet
//    wurden. Das UVG fragt nach Arbeitszeit, nicht nach Lohnwert.
//
// 2. GEZAEHLT WERDEN AUCH SCHICHTEN, DIE DER LOHNLAUF SPERRT. Die
//    Reinigungssparte ist fuer den GAV gesperrt (OP-32) und ein fehlendes
//    GAV-Regelwerk sperrt den Lohn -- fuer die Unfallversicherung ist beides
//    ohne Bedeutung. Wer dort arbeitet, arbeitet. Diese Schichten
//    auszulassen, senkte die Wochenstunden und koennte die Deckung zu
//    Unrecht verneinen. Darum laeuft diese Zaehlung ausdruecklich NICHT
//    durch gavzeit_gilt() und gavzeit_regel().
//
// Das Fenster beginnt am MONTAG der Kalenderwoche, in die der Fensteranfang
// faellt -- sonst waere die erste Woche angebrochen und zaehlte mit zu
// wenigen Stunden als volle Woche gegen den Mitarbeitenden.
function lohnlauf_nbu_wochen(PDO $pdo, int $maId, string $bis, int $monate): array
{
    $roh = date('Y-m-d', strtotime($bis . ' -' . $monate . ' months +1 day'));
    // Ziff. 2 der Empfehlung 7/87, vom Bundesgericht in 8C_644/2025 E. 3.3
    // wiedergegeben: "Nur ganze Wochen sind zu beachten. Faellt der Beginn
    // bzw. das Ende der relevanten Periode zwischen zwei Wochenenden,
    // bleiben diese angebrochenen Wochen unberuehrt."
    //
    // KORREKTUR einer eigenen Fehlbauart: Zuerst hatte ich den Anfang
    // RUECKWAERTS auf den Montag gelegt und die angebrochene Schlusswoche
    // voll mitgezaehlt. Beides ist falsch. Rueckwaerts holt Stunden von VOR
    // dem Zeitraum herein; eine angebrochene Schlusswoche zaehlt mit zu
    // wenigen Stunden als volle Woche und drueckt den Durchschnitt. Beide
    // angebrochenen Wochen bleiben unberuehrt -- der Anfang wandert also
    // VORWAERTS auf den naechsten Montag, das Ende auf den letzten Sonntag.
    $start = date('N', strtotime($roh)) === '1'
        ? $roh : date('Y-m-d', strtotime('next monday', strtotime($roh)));
    $bis   = date('N', strtotime($bis)) === '7'
        ? $bis : date('Y-m-d', strtotime('last sunday', strtotime($bis)));
    if (strtotime($bis) < strtotime($start)) {
        return ['von' => $start, 'bis' => $bis, 'monate' => $monate,
                'wochen' => [], 'liste' => [], 'unbrauchbar' => 0, 'ausfalltage' => 0];
    }

    $st = $pdo->prepare(
        "SELECT e.datum, z.ist_von, z.ist_bis, z.ist_pause_min, z.ist_pause_bezahlt_ma
           FROM einsatz_zuteilung z
           JOIN einsaetze e ON e.id = z.einsatz_id
          WHERE z.mitarbeiter_id = ? AND e.datum BETWEEN ? AND ?
            AND e.status <> 'abgesagt' AND z.ist_status = 'abgeglichen'");
    $st->execute([$maId, $start, $bis]);

    // Erst alle Kalenderwochen des Fensters mit null anlegen. Eine Woche
    // ohne Einsatz ist eine Nullstundenwoche und wird gebraucht -- ohne sie
    // waeren die Regeln 3 und 4 der Empfehlung nicht anwendbar.
    $wochen = [];
    for ($t = strtotime($start); $t <= strtotime($bis); $t += 7 * 86400) {
        $wochen[date('o-\WW', $t)] = 0.0;
    }

    $unbrauchbar = 0;
    foreach ($st->fetchAll() as $r) {
        $netto = gavzeit_netto_min($r['ist_von'], $r['ist_bis'],
            $r['ist_pause_min'], $r['ist_pause_bezahlt_ma']);
        if ($netto === null) { $unbrauchbar++; continue; }
        $kw = date('o-\WW', strtotime((string)$r['datum']));
        if (!array_key_exists($kw, $wochen)) { $wochen[$kw] = 0.0; }
        $wochen[$kw] += $netto / 60;
    }
    // Ziff. 4: tageweise Ausfallstunden wegen Unfall ODER KRANKHEIT koennen
    // ergaenzt werden, wenn die effektiven Stunden keine Deckung ergeben.
    // "Weitere Ergaenzungen, z.B. wegen Militaer, Feier- oder Urlaubstagen,
    // sind nicht zulaessig" -- darum genau diese zwei Arten und keine
    // weitere. Gezaehlt werden nur genehmigte Abwesenheiten; eine beantragte
    // ist keine.
    $ausfalltage = 0;
    try {
        $sa = $pdo->prepare(
            "SELECT von, bis FROM abwesenheiten
              WHERE mitarbeiter_id = ? AND status = 'genehmigt'
                AND typ IN ('krankheit','unfall')
                AND von <= ? AND bis >= ?");
        $sa->execute([$maId, $bis, $start]);
        foreach ($sa->fetchAll() as $a) {
            $v = max(strtotime((string)$a['von']),  strtotime($start));
            $b = min(strtotime((string)$a['bis']), strtotime($bis));
            if ($b >= $v) { $ausfalltage += (int)round(($b - $v) / 86400) + 1; }
        }
    } catch (Throwable $e) {
        // Die Tabelle kann in einer aelteren Einrichtung fehlen. Dann bleibt
        // es bei null Ausfalltagen -- das ist hier unschaedlich, weil null
        // nur bedeutet, dass Stufe 2 nicht greift.
        $ausfalltage = 0;
    }

    ksort($wochen);
    return ['von' => $start, 'bis' => $bis, 'monate' => $monate,
            'wochen' => $wochen, 'liste' => array_values($wochen),
            'unbrauchbar' => $unbrauchbar, 'ausfalltage' => $ausfalltage];
}

// Die NBU-Unterstellung einer Person zum Stichtag -- gerechnet, oder von
// Hand gesetzt.
//
// REIHENFOLGE: Erst wird nachgesehen, ob jemand von Hand entschieden hat.
// Nur wenn nicht, wird gerechnet. Eine Uebersteuerung, die von der Rechnung
// ueberstimmt wuerde, waere keine.
//
// Die Uebersteuerung liegt in lohn_person und ist HISTORISIERT wie alles
// dort: Wer sie im Maerz setzt, aendert damit den Februar nicht.
//
// WAS MITGELIEFERT WIRD, weil ohne das niemand die Zahl nachvollziehen kann:
// der Beobachtungszeitraum beider Fenster, die gezaehlten Wochen, der
// Durchschnitt, und bei einer Uebersteuerung Grund, Person und Zeitpunkt.
// Das ist der "gespeicherte Berechnungsstichtag" -- er entsteht hier und
// wird vom Lauf in den Schnappschuss uebernommen.
function lohnlauf_nbu(PDO $pdo, int $maId, string $bis): array
{
    // 1. Uebersteuerung ZUERST -- vor dem Regelwerk.
    //
    // Eine von Hand getroffene Entscheidung braucht die Acht-Stunden-Schwelle
    // nicht: Sie ersetzt die Rechnung, statt auf ihr aufzubauen. Stuende die
    // Regelwerkspruefung davor, verschwaende ein fehlender Jahrgang eine
    // Antwort, die laengst vorliegt -- und der Lohnlauf sperrte eine Person,
    // ueber die jemand bereits entschieden hat.
    try {
        $st = $pdo->prepare(
            "SELECT nbu_pflichtig, nbu_grund, nbu_von, nbu_am, gueltig_ab
               FROM lohn_person
              WHERE mitarbeiter_id = ? AND gueltig_ab <= ?
              ORDER BY gueltig_ab DESC LIMIT 1");
        $st->execute([$maId, $bis]);
        $r = $st->fetch();
    } catch (Throwable $e) { $r = null; }

    if ($r && $r['nbu_pflichtig'] !== null && $r['nbu_pflichtig'] !== '') {
        $ja = (int)$r['nbu_pflichtig'] === 1;
        return [
            'stand' => $ja ? LOHN_NBU_VERSICHERT : LOHN_NBU_NICHT,
            'quelle' => 'uebersteuert',
            'uebersteuert' => ['auf' => $ja ? LOHN_NBU_VERSICHERT : LOHN_NBU_NICHT,
                'grund' => $r['nbu_grund'] ?? null, 'von' => $r['nbu_von'] ?? null,
                'am' => $r['nbu_am'] ?? null, 'gueltig_ab' => $r['gueltig_ab'] ?? null],
            'fenster' => [],
            'text' => 'Von Hand auf ' . ($ja ? 'versichert' : 'nicht versichert') . ' gesetzt'
                . (trim((string)($r['nbu_grund'] ?? '')) !== ''
                   ? ': ' . trim((string)$r['nbu_grund']) : ' — ohne Begruendung.')];
    }

    // 2. Sonst rechnen -- und DAFUER braucht es das Regelwerk.
    $uvg = lohn_uvg($bis);
    if ($uvg === null) {
        return ['stand' => LOHN_NBU_UNBEKANNT, 'quelle' => 'kein_regelwerk',
            'text' => 'Fuer ' . substr($bis, 0, 4) . ' ist kein UVG-Regelwerk erfasst. '
                . 'Ohne die Schwelle laesst sich die Unterstellung nicht ermitteln.',
            'fenster' => [], 'uebersteuert' => null];
    }
    $fenster = [];
    foreach (LOHN_NBU_FENSTER_MONATE as $monate) {
        $w = lohnlauf_nbu_wochen($pdo, $maId, $bis, $monate);
        $e = lohn_nbu_ermittlung($w['liste'], $uvg, (int)($w['ausfalltage'] ?? 0));
        $e['zeitraum'] = ['von' => $w['von'], 'bis' => $w['bis'], 'monate' => $monate];
        $fenster[$monate] = $e;
    }
    $erg = lohn_nbu_unterstellung($fenster, $uvg);
    $erg['quelle'] = 'gerechnet';
    $erg['uebersteuert'] = null;
    $erg['stichtag'] = $bis;
    return $erg;
}

// ══════════════════════════════════════════════════════════════════════════
// DIE ABZUGSSEITE (ENT-451, Etappe 4).
//
// AUFBAU IN ZWEI SCHRITTEN, und die Trennung ist der Kern:
//   1. lohnlauf_grundlagen() bildet aus den Bruttozeilen und den SECHS
//      KENNZEICHEN des Lohnartenkatalogs die Bemessungsgrundlagen. Welche
//      Zeile in welche Grundlage zaehlt, steht damit an EINER Stelle -- im
//      Katalog -- und nicht verstreut in der Abzugsrechnung.
//   2. lohnlauf_abzuege() rechnet je Abzug seinen Betrag aus der zugehoerigen
//      Grundlage.
//
// WAS HIER NIE PASSIERT: mit null rechnen. Fehlt ein Satz, entsteht die
// Zeile trotzdem -- mit Sperrgrund und ohne Betrag. Ein stillschweigend
// weggelassener Abzug faellt niemandem auf; eine gesperrte Zeile schon.
// Dieselbe Regel wie auf der Bruttoseite beim Zeitzuschlag.

// Der Katalog als Abbildung Schluessel -> Kennzeichen. Aus dem Startbestand,
// damit Pruefungen ihn erreichen; die Tabelle kann ihn ueberschreiben.
function lohnlauf_katalog(?PDO $pdo = null): array
{
    // Einmal je Lauf gelesen, nicht je Person: Bei fuenfzig Mitarbeitenden
    // waeren es sonst fuenfzig gleiche Abfragen.
    static $merker = null;
    if ($pdo !== null && $merker !== null) { return $merker; }

    $k = [];
    foreach (lohnart_startbestand() as $z) {
        $k[$z[0]] = ['ahv' => (int)$z[5], 'ferien' => (int)$z[6], 'ml13' => (int)$z[7],
                     'bvg' => (int)$z[8], 'uvg' => (int)$z[9], 'qst' => (int)$z[10],
                     'bemessung' => lohnart_ist_bemessung($z) ? 1 : 0];
    }
    if ($pdo === null) { return $k; }
    try {
        $st = $pdo->query("SELECT schluessel, ahv_pflichtig, ferien_pflichtig, ml13_pflichtig,
                                  bvg_pflichtig, uvg_pflichtig, qst_pflichtig, bemessung
                             FROM lohnart");
        foreach ($st->fetchAll() as $r) {
            $k[(string)$r['schluessel']] = [
                'ahv' => (int)$r['ahv_pflichtig'], 'ferien' => (int)$r['ferien_pflichtig'],
                'ml13' => (int)$r['ml13_pflichtig'], 'bvg' => (int)$r['bvg_pflichtig'],
                'uvg' => (int)$r['uvg_pflichtig'], 'qst' => (int)$r['qst_pflichtig'],
                'bemessung' => (int)$r['bemessung']];
        }
    } catch (Throwable $e) { /* vor der Einrichtung gibt es die Tabelle nicht */ }
    $merker = $k;
    return $k;
}

// Bemessungsgrundlagen aus den Bruttozeilen.
//
// Eine Zeile OHNE Betrag zaehlt nirgends mit -- sie ist gesperrt, und eine
// gesperrte Zeile ist keine Null. Eine Zeile, deren Lohnart der Katalog
// nicht kennt, zaehlt ebenfalls nicht mit, wird aber NAMENTLICH gemeldet:
// Sonst verschwaende ein Tippfehler im Schluessel stillschweigend Lohn aus
// jeder Bemessungsgrundlage. Genau dieser Fehler ist in diesem Baustein
// schon einmal passiert (`geleistete_stunden` fehlte im Katalog).
function lohnlauf_grundlagen(array $zeilen, array $katalog): array
{
    $g = ['ahv' => 0, 'bvg' => 0, 'uvg' => 0, 'qst' => 0];
    $unbekannt = [];
    foreach ($zeilen as $z) {
        if (($z['betrag_rappen'] ?? null) === null) { continue; }
        $k = $katalog[$z['schluessel']] ?? null;
        if ($k === null) { $unbekannt[] = $z['schluessel']; continue; }
        // Nur Zeilen, die einen Betrag der PERIODE tragen. Grundlohn,
        // Ferienentschaedigung und 13.-Anteil sind Bestandteile eines
        // STUNDENSATZES -- sie mitzuzaehlen ergaebe den Stundenlohn zweimal.
        if (!(int)($k['bemessung'] ?? 0)) { continue; }
        foreach (['ahv', 'bvg', 'uvg', 'qst'] as $art) {
            if ($k[$art]) { $g[$art] += (int)$z['betrag_rappen']; }
        }
    }
    $g['unbekannte_lohnarten'] = array_values(array_unique($unbekannt));
    return $g;
}

// Die Abzugsparameter DIESER Person zum Stichtag (lohn_person, historisiert).
// Getrennt von lohnlauf_nbu(), das nur die Unterstellung braucht.
function lohnlauf_person_parameter(PDO $pdo, int $maId, string $bis): ?array
{
    try {
        $st = $pdo->prepare(
            'SELECT * FROM lohn_person WHERE mitarbeiter_id = ? AND gueltig_ab <= ?
              ORDER BY gueltig_ab DESC LIMIT 1');
        $st->execute([$maId, $bis]);
        return $st->fetch() ?: null;
    } catch (Throwable $e) { return null; }
}

// Der zum Stichtag geltende Betriebssatz aus lohn_abzug. NULL heisst
// "nicht erfasst" -- nicht "null Prozent".
function lohnlauf_abzugsatz(PDO $pdo, string $schluessel, string $bis): ?array
{
    try {
        $st = $pdo->prepare(
            "SELECT satz_bp, fix_rappen, hoechstlohn_rappen, quelle
               FROM lohn_abzug
              WHERE schluessel = ? AND gueltig_ab <= ?
                AND (gueltig_bis IS NULL OR gueltig_bis >= ?)
              ORDER BY gueltig_ab DESC LIMIT 1");
        $st->execute([$schluessel, $bis, $bis]);
        $r = $st->fetch();
        return $r ?: null;
    } catch (Throwable $e) { return null; }
}

// Die Abzugszeilen einer Person.
//
// REIHENFOLGE wie in der heute eingesetzten Fremdloesung: erst die
// Sozialversicherungsabzuege, dann der Nettolohn als Zwischensumme, dann der
// PaKo-Beitrag, dann der Auszahlungsbetrag. Der PaKo steht dort ausdruecklich
// NACH dem Nettolohn -- das ist nicht bloss Darstellung, sondern bestimmt,
// was "Nettolohn" auf dem Papier bedeutet.
//
// ZWEI FESTLEGUNGEN, beide am 2026-09-08 vom Projektinhaber entschieden
// (OP-465). Sie stehen als Konstante da und nicht im Rechenweg versteckt,
// damit die Entscheidung ein Wert bleibt und keine Suche durch den Quelltext.
//
//   * GERUNDET WIRD JE ABZUG auf den Rappen, nicht auf die Summe. Art. 12
//     Ziff. 5 GAV verlangt, dass jede Position der Abrechnung als Betrag
//     darstellbar ist -- ein Abzug, der nur in der Summe aufgeht, ist das
//     nicht, und der Mitarbeitende koennte seinen AHV-Abzug nicht
//     nachrechnen. Bei vier Abzuegen gehen die beiden Wege in rund 41 % der
//     Bruttobetraege auseinander, jedes Mal um einen oder zwei Rappen.
//
//   * DER AUSZAHLUNGSBETRAG WIRD AUF 5 RAPPEN GERUNDET, und zwar genau
//     einmal, ganz am Schluss. Belegt durch die Referenzabrechnung des
//     Projektinhabers: Sie weist den Nettolohn UNGERUNDET aus (272.94) und
//     den Auszahlungsbetrag GERUNDET (272.80 statt exakt 272.79). Merkblatt
//     2.08 Ziff. 4 rundet ebenso. Zwischensummen bleiben rappengenau.
const LOHNLAUF_RUNDUNG_JE_ABZUG = true;
const LOHNLAUF_AUSZAHLUNG_AUF_5_RAPPEN = true;

function lohnlauf_abzuege(PDO $pdo, array $kopf, string $bis, ?array $nbu = null): array
{
    $katalog = lohnlauf_katalog($pdo);
    $g = lohnlauf_grundlagen($kopf['zeilen'] ?? [], $katalog);
    $zeilen = [];
    $sperren = [];

    // Kleiner Helfer: eine Abzugszeile, entweder mit Betrag oder mit Grund.
    $zeile = function (string $sl, string $bez, ?int $basis, ?int $satzBp, ?int $betrag,
                       int $sort, ?string $grund, string $hinweis) use (&$zeilen, &$sperren) {
        if ($grund !== null) { $sperren[$grund] = ($sperren[$grund] ?? 0) + 1; }
        $zeilen[] = ['schluessel' => $sl, 'bezeichnung' => $bez, 'basis_rappen' => $basis,
            'satz_bp' => $satzBp, 'menge' => null, 'betrag_rappen' => $betrag,
            'sortierung' => $sort, 'annahme' => 0,
            'gesperrt_grund' => $grund, 'hinweis' => $hinweis];
    };

    // 1. AHV, IV, EO -- Bundesrecht aus dem Regelwerk, nicht aus lohn_abzug.
    $sv = lohn_sv($bis);
    if ($sv === null) {
        $zeile('ahv', 'AHV-, IV-, EO-Beitrag', $g['ahv'], null, null, 50, 'kein_sv_regelwerk',
            'Fuer ' . substr($bis, 0, 4) . ' ist kein AHV-Regelwerk erfasst. Es wird nicht '
            . 'mit den Saetzen des Vorjahres gerechnet.');
    } else {
        $zeile('ahv', 'AHV-, IV-, EO-Beitrag', $g['ahv'], $sv['an_bp'],
            -lohn_anteil($g['ahv'], (int)$sv['an_bp']), 50, null, $sv['quelle']);
    }

    // 2. ALV -- eigenes Regelwerk, eigener Stand, und eine Obergrenze.
    //    Merkblatt 2.08 Ziff. 5: In der monatlichen Abrechnung gilt ein
    //    provisorischer Hoechstbetrag von einem Zwoelftel des Jahresbetrags.
    $alv = lohn_alv($bis);
    if ($alv === null) {
        $zeile('alv', 'ALV-Beitrag', $g['ahv'], null, null, 51, 'kein_alv_regelwerk',
            'Fuer ' . substr($bis, 0, 4) . ' ist kein ALV-Regelwerk erfasst.');
    } else {
        $grenze = lohn_alv_monatsgrenze($alv);
        $basis  = min($g['ahv'], $grenze);
        $zeile('alv', 'ALV-Beitrag', $basis, $alv['an_bp'],
            -lohn_anteil($basis, (int)$alv['an_bp']), 51, null,
            $g['ahv'] > $grenze
                ? 'Begrenzt auf den provisorischen Monatshoechstbetrag (Merkblatt 2.08 Ziff. 5).'
                : $alv['quelle']);
    }

    // 3. NBU -- zwei Bedingungen, und beide koennen einzeln fehlen: die
    //    Unterstellung nach Empfehlung 7/87 und der Praemiensatz des
    //    Versicherers. Der Berufsunfall erscheint NIE als Abzug (Merkblatt
    //    6.05 Ziff. 5) -- darum gibt es hier nur den NBU.
    $uvg  = lohn_uvg($bis);
    $satz = lohnlauf_abzugsatz($pdo, 'nbu', $bis);
    $stand = $nbu['stand'] ?? LOHN_NBU_UNBEKANNT;
    $uvgBasis = $g['uvg'];
    if ($uvg !== null) {
        // Der Hoechstbetrag ist ein JAHRESwert; monatlich gilt ein Zwoelftel.
        // Dieselbe Bauart wie bei der ALV, aber aus dem eigenen Regelwerk --
        // die Betraege stimmen ueberein, hergeleitet wird nichts.
        $uvgBasis = min($uvgBasis, lohn_rappen((int)$uvg['hoechstbetrag_jahr_rappen'] / 12));
    }
    if ($stand === LOHN_NBU_NICHT) {
        $zeile('nbu', 'NBU-Beitrag', $uvgBasis, null, null, 52, 'nbu_keine_deckung',
            $nbu['text'] ?? 'Keine Deckung gegen Nichtberufsunfaelle -- es darf kein Beitrag '
            . 'abgezogen werden.');
    } elseif ($stand !== LOHN_NBU_VERSICHERT) {
        $zeile('nbu', 'NBU-Beitrag', $uvgBasis, null, null, 52,
            $stand === LOHN_NBU_PRUEFEN ? 'nbu_pruefen' : 'nbu_unbekannt',
            $nbu['text'] ?? 'Die Unterstellung ist nicht ermittelt.');
    } elseif ($satz === null || $satz['satz_bp'] === null) {
        $zeile('nbu', 'NBU-Beitrag', $uvgBasis, null, null, 52, 'kein_nbu_satz',
            'Deckung besteht, aber der Praemiensatz des Versicherers ist nicht erfasst.');
    } else {
        $zeile('nbu', 'NBU-Beitrag', $uvgBasis, (int)$satz['satz_bp'],
            -lohn_anteil($uvgBasis, (int)$satz['satz_bp']), 52, null,
            (string)($satz['quelle'] ?? ''));
    }

    // 4. KTG und BVG -- reine Betriebswerte. Art. 17 Ziff. 3 und Art. 25
    //    Ziff. 3 GAV begrenzen den Anteil, den der Betrieb abziehen darf;
    //    die Aufteilung selbst steht im erfassten Satz.
    foreach ([['ktg', 'Krankentaggeld-Beitrag', 'ahv', 53, 'Art. 17 Ziff. 3 GAV: der Arbeitgeber '
              . 'traegt mindestens die Haelfte.'],
              ['bvg', 'BVG-Beitrag', 'bvg', 54, 'Art. 25 Ziff. 3 GAV: hoechstens die Haelfte '
              . 'darf abgezogen werden. Der Betrag stammt aus der Meldung der Pensionskasse.'],
             ] as [$sl, $bez, $grund, $sort, $hinweis]) {
        $s = lohnlauf_abzugsatz($pdo, $sl, $bis);
        $basis = $g[$grund];
        if ($s === null) {
            $zeile($sl, $bez, $basis, null, null, $sort, 'kein_' . $sl . '_satz',
                'Kein Satz erfasst. Solange er fehlt, wird nicht gerechnet -- auch nicht mit null.');
        } elseif ($s['satz_bp'] !== null) {
            $zeile($sl, $bez, $basis, (int)$s['satz_bp'],
                -lohn_anteil($basis, (int)$s['satz_bp']), $sort, null,
                (string)($s['quelle'] ?? $hinweis));
        } else {
            $zeile($sl, $bez, null, null, -(int)$s['fix_rappen'], $sort, null,
                (string)($s['quelle'] ?? $hinweis));
        }
    }

    // 5. Nettolohn als Zwischensumme.
    //
    // KRITISCH: Fehlt EINE Abzugszeile, gibt es KEINEN Nettolohn.
    //
    // Das war hier zuerst falsch gebaut, und der Fehler ist die gefaehrlichste
    // Sorte: Die einzelne Zeile sagte korrekt "nicht gerechnet", die Summe
    // zaehlte sie aber als null. Am Referenzbeispiel stand dann ein Nettolohn
    // von 276.15 statt 272.94 -- eine plausible Zahl, die zu HOCH ist, weil
    // ein Abzug fehlt. Wer sie ausbezahlt, zahlt zu viel aus und schuldet die
    // Beitraege trotzdem. Eine gesperrte Zeile ist keine Null, und eine Summe
    // ueber eine gesperrte Zeile ist keine Summe.
    $fehlend = [];
    foreach ($zeilen as $z) {
        if (($z['betrag_rappen'] ?? null) === null && ($z['gesperrt_grund'] ?? null) !== null) {
            $fehlend[] = $z['bezeichnung'];
        }
    }
    $netto = null;
    if (!$fehlend) {
        $netto = (int)$kopf['brutto_rappen'];
        foreach ($zeilen as $z) { $netto += (int)($z['betrag_rappen'] ?? 0); }
    }
    $zeilen[] = ['schluessel' => 'nettolohn', 'bezeichnung' => 'Nettolohn',
        'basis_rappen' => null, 'satz_bp' => null, 'menge' => null,
        'betrag_rappen' => $netto, 'sortierung' => 60, 'annahme' => 0,
        'gesperrt_grund' => $fehlend ? 'abzug_fehlt' : null,
        'hinweis' => $fehlend
            ? 'Kein Nettolohn, solange ein Abzug fehlt: ' . implode(', ', $fehlend)
              . '. Eine Summe ueber eine nicht gerechnete Zeile waere zu hoch.'
            : 'Bruttolohn abzueglich der Sozialversicherungsbeitraege'];

    // 6. PaKo NACH dem Nettolohn -- so weist es die Fremdloesung aus, und
    //    Art. 6 Ziff. 2 verlangt ausdruecklich, dass er auf der Abrechnung
    //    erscheint. Er darf nie stillschweigend im Nettolohn verschwinden.
    $stunden = ($kopf['bewertet_min'] ?? 0) / 60;
    $pako = lohn_pako_beitrag_rappen($kopf['kategorie'] ?? null, $stunden);
    if (($pako['rappen'] ?? null) === null) {
        $zeile('pako', 'Vollzugskostenbeitrag PaKo', null, null, null, 61, 'kein_pako',
            $pako['text'] ?? 'Ohne Anstellungskategorie laesst sich der Beitrag nicht bestimmen.');
    } else {
        $zeile('pako', 'Vollzugskostenbeitrag PaKo', null, null, -(int)$pako['rappen'], 61, null,
            $pako['text'] ?? 'Art. 6 Ziff. 2 GAV');
    }

    // 7. Quellensteuer -- Etappe 5. AUSDRUECKLICH GESPERRT und nicht still
    //    abzugsfrei: Ein nicht nachgefuehrter kantonaler Tarif produziert
    //    weiter plausible Zahlen (ENT-451, Risiken).
    //
    //    SIE HAENGT AN DER PERSON, nicht an der Bemessungsgrundlage. Das war
    //    hier zuerst falsch: Die Zeile entstand, sobald ein
    //    quellensteuerpflichtiger LOHNBESTANDTEIL vorlag -- also bei jedem
    //    normalen Lohn. Damit haette JEDE Abrechnung bis Etappe 5 gesperrt,
    //    obwohl die allermeisten Mitarbeitenden gar nicht
    //    quellensteuerpflichtig sind. Massgebend ist das erfasste Merkmal
    //    lohn_person.qst_pflichtig.
    $pp = lohnlauf_person_parameter($pdo, (int)($kopf['mitarbeiter_id'] ?? 0), $bis);
    if ($g['qst'] > 0 && !empty($pp['qst_pflichtig'])) {
        $zeile('quellensteuer', 'Quellensteuer', $g['qst'], null, null, 62, 'quellensteuer_offen',
            'Die Quellensteuer ist Etappe 5 und bewusst gesperrt statt mit null gerechnet. '
            . 'Betroffene Personen werden von Hand abgerechnet.');
    }

    // 8. Auszahlungsbetrag -- dieselbe Regel, eine Stufe weiter. Ohne
    //    Nettolohn kein Auszahlungsbetrag, und eine gesperrte Zeile NACH dem
    //    Nettolohn (etwa die Quellensteuer) sperrt ihn ebenso.
    $fehlendNach = [];
    foreach ($zeilen as $z) {
        if ((int)($z['sortierung'] ?? 0) > 60 && ($z['betrag_rappen'] ?? null) === null
            && ($z['gesperrt_grund'] ?? null) !== null) {
            $fehlendNach[] = $z['bezeichnung'];
        }
    }
    $aus = null;
    if ($netto !== null && !$fehlendNach) {
        $aus = $netto;
        foreach ($zeilen as $z) {
            if ((int)($z['sortierung'] ?? 0) > 60) { $aus += (int)($z['betrag_rappen'] ?? 0); }
        }
        if (LOHNLAUF_AUSZAHLUNG_AUF_5_RAPPEN) {
            $gerundet = lohn_fuenfrappen($aus);
            // Die Differenz als EIGENE ZEILE, entschieden vom Projektinhaber
            // am 2026-09-08. Ohne sie ginge die Rechnung auf dem Papier um
            // bis zu zwei Rappen nicht auf, und niemand koennte sagen warum
            // -- Art. 12 Ziff. 5 verlangt eine nachvollziehbare Abrechnung.
            //
            // Nur wenn es wirklich eine Differenz GIBT. Eine Zeile mit 0.00
            // waere in rund einem Fuenftel aller Abrechnungen zu sehen und
            // sagte nichts; fehlt sie, geht die Rechnung ohnehin auf.
            if ($gerundet !== $aus) {
                $zeilen[] = ['schluessel' => 'rundungsdifferenz',
                    'bezeichnung' => 'Rundung auf 5 Rappen',
                    'basis_rappen' => null, 'satz_bp' => null, 'menge' => null,
                    'betrag_rappen' => $gerundet - $aus, 'sortierung' => 65,
                    'annahme' => 0, 'gesperrt_grund' => null,
                    'hinweis' => 'Der Auszahlungsbetrag wird auf 5 Rappen gerundet. Diese Zeile '
                        . 'haelt die Differenz fest, damit die Abrechnung aufgeht.'];
            }
            $aus = $gerundet;
        }
    }
    $zeilen[] = ['schluessel' => 'auszahlung', 'bezeichnung' => 'Auszahlungsbetrag',
        'basis_rappen' => null, 'satz_bp' => null, 'menge' => null,
        'betrag_rappen' => $aus, 'sortierung' => 70, 'annahme' => 0,
        'gesperrt_grund' => $aus === null ? 'abzug_fehlt' : null,
        'hinweis' => $aus === null
            ? ($netto === null
               ? 'Kein Auszahlungsbetrag ohne Nettolohn.'
               : 'Kein Auszahlungsbetrag, solange nach dem Nettolohn etwas fehlt: '
                 . implode(', ', $fehlendNach) . '.')
            : 'Nettolohn abzueglich der Beitraege, die nach ihm ausgewiesen werden'];

    usort($zeilen, fn($a, $b) => $a['sortierung'] <=> $b['sortierung']);
    return ['zeilen' => $zeilen, 'grundlagen' => $g, 'sperren' => $sperren,
            'netto_rappen' => $netto, 'auszahlung_rappen' => $aus,
            'vollstaendig' => empty($sperren)];
}

// ── Der zum Stichtag geltende Lohnansatz ─────────────────────────────────
// Die juengste Zeile, die nicht in der Zukunft liegt. Ein kuenftiger Ansatz
// ist erfasst, aber noch nicht gueltig.
function lohnlauf_ansatz(PDO $pdo, int $maId, string $stichtag): ?array
{
    $st = $pdo->prepare(
        'SELECT * FROM lohn_ansatz WHERE mitarbeiter_id = ? AND gueltig_ab <= ?
         ORDER BY gueltig_ab DESC LIMIT 1'
    );
    $st->execute([$maId, $stichtag]);
    $a = $st->fetch();
    return $a ?: null;
}

// ── Die Lohnzeilen einer Person ──────────────────────────────────────────
// Rueckgabe: ['zeilen' => [...], 'summe' => [...], 'gesperrt_grund' => ?].
//
// Die REIHENFOLGE der Rundung ist eine Festlegung mit Geldfolge (ENT-451):
// Der Bruttostundenlohn entsteht aus auf Rappen gerundeten Bestandteilen
// und wird DANN mit den Stunden multipliziert -- so wie es die im Betrieb
// eingesetzte Referenzloesung tut. Die andere Reihenfolge (Prozentsatz erst
// auf den Monatsbetrag) ergaebe bei zehn Stunden sechs Rappen mehr. Beide
// sind vertretbar; festgelegt ist diese, weil jede Abrechnungszeile nach
// Art. 12 Ziff. 5 als Betrag darstellbar sein muss.
function lohnlauf_person(PDO $pdo, array $ma, string $von, string $bis): array
{
    $maId = (int)$ma['id'];
    $kategorie = kategorie_pruefen($ma['anstellungskategorie'] ?? null);
    $form = lohn_form($kategorie);
    $zeit = lohnlauf_zeiten($pdo, $maId, $von, $bis);

    $kopf = [
        'mitarbeiter_id' => $maId,
        'kategorie' => $kategorie,
        'lohnform' => $form,
        'roh_min' => $zeit['summe']['roh_min'],
        'netto_min' => $zeit['summe']['netto_min'],
        'bonus_min' => round($zeit['summe']['bonus_min'], 4),
        'bewertet_min' => round($zeit['summe']['bewertet_min'], 4),
        'gesperrt' => $zeit['gesperrt'],
        'nicht_abgeglichen' => $zeit['nicht_abgeglichen'],
        'gesperrt_grund' => null,
        'brutto_rappen' => 0,
        'zeilen' => [],
    ];

    if ($form === null) { $kopf['gesperrt_grund'] = 'keine_kategorie'; return $kopf; }
    // Der Monatslohn braucht einen eigenen Rechenweg -- die Stunden kommen
    // dort nicht aus dem Abgleich, und Ferien und 13. Monatslohn werden
    // nicht prozentual mitausbezahlt. Ausdruecklich gesperrt statt still
    // als Stundenlohn gerechnet.
    if ($form === LOHN_FORM_MONAT) { $kopf['gesperrt_grund'] = 'monatslohn_offen'; return $kopf; }

    $ansatz = lohnlauf_ansatz($pdo, $maId, $bis);
    if (!$ansatz) { $kopf['gesperrt_grund'] = 'kein_ansatz'; return $kopf; }

    // Der Ansatz traegt einen Schnappschuss der Kategorie, die bei seiner
    // Erfassung galt -- genau dafuer steht die Spalte da ("damit eine spaetere
    // Umstufung den alten Ansatz nicht umdeutet"). Sie wurde geschrieben, aber
    // nie gelesen: Ohne diese Pruefung liest ein Wechsel von A/B nach C den
    // alten MONATSbetrag als STUNDENansatz -- aus CHF 4500 im Monat werden
    // CHF 4500 in der Stunde. lohn_mindestlohn() schlaegt nur nach unten an,
    // faengt das also nicht. Gesperrt statt gerechnet, wie ueberall hier.
    $ansatzForm = lohn_form($ansatz['kategorie'] ?? null);
    if ($ansatzForm === null) { $kopf['gesperrt_grund'] = 'ansatz_ohne_kategorie'; return $kopf; }
    if ($ansatzForm !== $form) { $kopf['gesperrt_grund'] = 'ansatz_andere_lohnform'; return $kopf; }

    $grund = (int)$ansatz['ansatz_rappen'];
    $stunden = $kopf['bewertet_min'] / 60;
    $zeilen = [];

    // 1. Grundlohn je Stunde.
    $zeilen[] = ['schluessel' => 'grundlohn_stunde', 'bezeichnung' => 'Grundlohn pro Stunde',
        'basis_rappen' => $grund, 'satz_bp' => null, 'menge' => null,
        'betrag_rappen' => $grund, 'sortierung' => 10, 'annahme' => 0,
        'hinweis' => 'Art. 16 i.V.m. Anhang 1 — ohne Ferienentschädigung'];

    // 2. Ferienentschaedigung nach Art. 20 Ziff. 2, aus dem Alter
    //    ABGELEITET und nicht erfasst.
    $fe = lohn_ferienentschaedigung_bp($ma['geburtsdatum'] ?? null, $bis);
    $feBetrag = lohn_anteil($grund, $fe['bp']);
    $zeilen[] = ['schluessel' => 'ferienentschaedigung', 'bezeichnung' => 'Ferienentschädigung',
        'basis_rappen' => $grund, 'satz_bp' => $fe['bp'], 'menge' => null,
        'betrag_rappen' => $feBetrag, 'sortierung' => 20,
        'annahme' => $fe['annahme'] ? 1 : 0, 'hinweis' => $fe['text']];

    // 3. Anteil 13. Monatslohn -- BETRIEBLICH, keine GAV-Pflicht. Fehlt er,
    //    entsteht keine Zeile: "nicht vereinbart" ist nicht "null Prozent".
    $ml13Betrag = 0;
    if ($ansatz['ml13_bp'] !== null) {
        $ml13Betrag = lohn_anteil($grund, (int)$ansatz['ml13_bp']);
        $zeilen[] = ['schluessel' => 'anteil_13ml', 'bezeichnung' => 'Anteil 13. Monatslohn',
            'basis_rappen' => $grund, 'satz_bp' => (int)$ansatz['ml13_bp'], 'menge' => null,
            'betrag_rappen' => $ml13Betrag, 'sortierung' => 21, 'annahme' => 0,
            'hinweis' => 'Betrieblich vereinbart — der GAV kennt keinen 13. Monatslohn'];
    }

    // 4. Bruttostundenlohn: die Summe der gerundeten Bestandteile.
    $bruttoStunde = $grund + $feBetrag + $ml13Betrag;
    $zeilen[] = ['schluessel' => 'brutto_stundenlohn', 'bezeichnung' => 'Brutto Stundenlohn',
        'basis_rappen' => null, 'satz_bp' => null, 'menge' => null,
        'betrag_rappen' => $bruttoStunde, 'sortierung' => 25, 'annahme' => 0,
        'hinweis' => 'Summe der Bestandteile, je auf Rappen gerundet'];

    // 5. Die geleisteten Stunden. BEWERTETE Zeit nach Art. 12 Ziff. 2 --
    //    Nettozeit plus Zeitbonus. Beide stehen im Kopf einzeln daneben.
    $lohn = lohn_rappen($bruttoStunde * $stunden);
    $zeilen[] = ['schluessel' => 'geleistete_stunden', 'bezeichnung' => 'Total geleistete Stunden',
        'basis_rappen' => $bruttoStunde, 'satz_bp' => null, 'menge' => round($stunden, 4),
        'betrag_rappen' => $lohn, 'sortierung' => 30,
        // Der Zeitbonus laeuft auf einer offenen Auslegung (GAV-AUS-008):
        // anteilig statt nur volle Stunden. Sobald er in die Stunden
        // einfliesst, beruht die Zeile darauf -- und das wird gesagt.
        'annahme' => $kopf['bonus_min'] > 0 ? 1 : 0,
        'hinweis' => 'Bewertete Zeit nach Art. 12 Ziff. 2: '
            . gavzeit_std($kopf['netto_min']) . ' Nettozeit + '
            . gavzeit_std($kopf['bonus_min']) . ' Zeitbonus'];

    // 6. Zuschlaege nach Art. 19. Sie entstehen aus dem ANGEORDNETEN
    //    Einsatz, nicht aus der Berechtigung in der Akte -- das Datenmodell
    //    fuehrt die Anordnung je Schicht noch nicht. Darum entsteht hier
    //    NUR die Monatspauschale; die Stundenvariante braucht die
    //    Anordnung und wird ausdruecklich benannt statt still weggelassen.
    foreach ([['fachausweis', 'Zuschlag Fachausweis', 31],
              ['hund', 'Zuschlag Diensthund', 32],
              ['waffe', 'Zuschlag Schusswaffe', 33]] as [$feld, $titel, $sort]) {
        $betrag = $ansatz['zuschlag_' . $feld . '_rappen'];
        $art = $ansatz['zuschlag_' . $feld . '_art'];
        if ($betrag === null || (int)$betrag === 0) { continue; }
        if ($art === 'monat') {
            $zeilen[] = ['schluessel' => 'zuschlag_' . $feld, 'bezeichnung' => $titel,
                'basis_rappen' => null, 'satz_bp' => null, 'menge' => null,
                'betrag_rappen' => (int)$betrag, 'sortierung' => $sort, 'annahme' => 0,
                'hinweis' => 'Art. 19 — Monatspauschale'];
        } else {
            $zeilen[] = ['schluessel' => 'zuschlag_' . $feld, 'bezeichnung' => $titel,
                'basis_rappen' => (int)$betrag, 'satz_bp' => null, 'menge' => null,
                'betrag_rappen' => null, 'sortierung' => $sort, 'annahme' => 0,
                'gesperrt_grund' => 'anordnung_fehlt',
                'hinweis' => 'Art. 19 — als Stundenentschädigung vereinbart. Der Zuschlag entsteht '
                    . 'aus dem angeordneten Einsatz; die Anordnung je Schicht führt das '
                    . 'Datenmodell noch nicht.'];
        }
    }

    // 7. Zeitzuschlag nach Art. 14 Ziff. 3: "Sofern pro Monat mehr als 210
    //    Stunden geleistet werden, wird auf diesen Mehrstunden ein
    //    Zeitzuschlag von 25 % gewaehrt."
    //
    //    Bemessungsgrundlage ist die BEWERTETE Zeit -- GAV-AUS-002 ist dazu
    //    geklaert. Was NICHT geklaert ist: ob die Mehrstunden ausbezahlt
    //    oder "als Freizeit innerhalb der folgenden drei Monate
    //    ausgeglichen" werden. Der GAV laesst beides zu, und die Wahl hat
    //    niemand getroffen.
    //
    //    Darum entsteht die Zeile GESPERRT statt gar nicht: Fehlte sie,
    //    waere die Abrechnung einer Person mit 220 Stunden stillschweigend
    //    zu tief, und es fiele niemandem auf. Eine gesperrte Zeile mit
    //    Grund faellt auf.
    $schwelleMin = 210 * 60;
    if ($kopf['bewertet_min'] > $schwelleMin) {
        $mehrMin = $kopf['bewertet_min'] - $schwelleMin;
        $zeilen[] = ['schluessel' => 'zeitzuschlag', 'bezeichnung' => 'Zeitzuschlag über 210 Stunden',
            'basis_rappen' => $bruttoStunde, 'satz_bp' => 2500,
            'menge' => round($mehrMin / 60, 4), 'betrag_rappen' => null,
            'sortierung' => 35, 'annahme' => 0, 'gesperrt_grund' => 'ausgleich_offen',
            'hinweis' => 'Art. 14 Ziff. 3: ' . gavzeit_std($mehrMin) . ' über der Schwelle von '
                . '210 Stunden. Der Zuschlag von 25 % kann ausbezahlt ODER innerhalb von drei '
                . 'Monaten als Freizeit ausgeglichen werden — welches von beidem gilt, ist nicht '
                . 'festgelegt. Bis dahin entsteht kein Betrag.'];
    }

    $kopf['zeilen'] = $zeilen;
    // Die Bruttosumme zaehlt NUR Zeilen mit Betrag. Eine gesperrte Zeile
    // ist keine Null -- sie fehlt, und das steht daneben.
    // Der Bruttolohn zaehlt dieselben Zeilen wie die Bemessungsgrundlagen:
    // die mit einem Betrag der Periode. Vorher stand hier eine Namensliste
    // ('geleistete_stunden' plus alles, was mit 'zuschlag_' beginnt) -- eine
    // zweite Wahrheit neben dem Katalog, die beim naechsten neuen Lohnart
    // auseinanderlaufen musste. Jetzt entscheidet der Katalog, und zwar
    // einmal.
    $kat = lohnlauf_katalog($pdo);
    $kopf['brutto_rappen'] = array_sum(array_map(
        fn($z) => ($z['betrag_rappen'] !== null
                   && (int)(($kat[$z['schluessel']] ?? [])['bemessung'] ?? 0) === 1)
                  ? (int)$z['betrag_rappen'] : 0, $zeilen));

    // Mindestlohnpruefung gegen Anhang 1. Warnt, sperrt nicht -- Anhang 1
    // laesst fuer unter 25-Jaehrige in Kategorie A einen Fall zu, den das
    // Werkzeug nie von sich aus anwendet.
    $mindest = lohn_mindestlohn($kategorie, $ma['eintritt'] ?? null, $bis);
    if ($mindest['wert'] !== null && ($mindest['einheit'] ?? '') === 'stunde'
        && $grund < $mindest['wert']) {
        $kopf['warnung'] = ['art' => 'unter_mindestlohn', 'mindest_rappen' => $mindest['wert'],
            'text' => 'Der Grundlohn liegt unter dem GAV-Mindestlohn von '
                    . number_format($mindest['wert'] / 100, 2, '.', "'") . ' CHF pro Stunde.'];
    }
    return $kopf;
}
