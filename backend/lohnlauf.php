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
        'keine_kategorie'    => 'Ohne Anstellungskategorie nach Art. 8 steht die Lohnform nicht fest.',
        'zeiten_unvollstaendig' => 'Die Ist-Zeiten der Schicht sind unvollständig erfasst.',
        'pause_laenger_als_schicht' => 'Die erfasste Pause ist länger als die Schicht — das ist ein Erfassungsfehler, keine Zeit.',
        'monatslohn_offen'   => 'Für den Monatslohn (Kategorie A und B) ist der Rechenweg noch nicht gebaut — Etappe 3 deckt den Stundenlohn ab.',
        'anordnung_fehlt'    => 'Der Zuschlag ist als Stundenentschädigung vereinbart. Nach Art. 19 entsteht er aus dem angeordneten Einsatz — die Anordnung je Schicht führt das Datenmodell noch nicht.',
        'ausgleich_offen'    => 'Art. 14 Ziff. 3 lässt für die Mehrstunden über 210 die Auszahlung ODER den Ausgleich als Freizeit innerhalb von drei Monaten zu. Welches von beidem gilt, ist nicht festgelegt — bis dahin entsteht kein Betrag.',
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
    $kopf['brutto_rappen'] = array_sum(array_map(
        fn($z) => in_array($z['schluessel'], ['geleistete_stunden'], true)
                  ? (int)($z['betrag_rappen'] ?? 0) : 0, $zeilen))
        + array_sum(array_map(
            fn($z) => str_starts_with($z['schluessel'], 'zuschlag_') && $z['betrag_rappen'] !== null
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
