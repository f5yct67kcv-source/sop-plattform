<?php
// Fachlogik der Einsatzplanung (ENT-021): Feiertage und die Ableitung
// einzelner Schichten aus den Masterschichten eines Objekts.
//
// Wichtige Abgrenzung: Hier wird ein Kalendertag als Feiertag MARKIERT.
// Ob daraus ein Zeitbonus, ein Zuschlag oder eine Feiertagsentschaedigung
// folgt, ist offen (GAV-AUS-003, GAV-AUS-006) und wird hier bewusst NICHT
// beantwortet.
declare(strict_types=1);

// ── Sparten des Betriebs (ENT-037)
//
// CUPI 24 bietet Sicherheit UND Reinigung an. Beides laeuft strikt getrennt
// durch die Planung, kann aber am selben Objekt gleichzeitig stattfinden --
// auf einer Baustelle etwa Bewachung waehrend der Bauphase und Endreinigung
// bei Fertigstellung.
//
// WICHTIG fuer alles, was spaeter Zeit oder Lohn rechnet: Die beiden Sparten
// unterstehen NICHT demselben Gesamtarbeitsvertrag. Das Regelwerk in 90-gav/
// ist der GAV der Sicherheitsdienstleistungen; fuer Reinigung gilt ein
// anderer, bislang ungepruefter GAV. Diese Angabe ist genau der Schluessel,
// an dem eine spaetere Berechnung ihr Regelwerk auswaehlen muss -- sie ist
// keine blosse Anzeigehilfe (siehe OP-32).
const SPARTEN = ['sicherheit', 'reinigung'];

function sparte_pruefen($wert, string $vorgabe = 'sicherheit'): string
{
    $w = strtolower(trim((string)$wert));
    return in_array($w, SPARTEN, true) ? $w : $vorgabe;
}

// Ostersonntag nach der anonymen gregorianischen Berechnung. Bewusst selbst
// gerechnet: easter_date() braucht die Kalender-Erweiterung, die auf einem
// geteilten Hosting nicht garantiert ist.
function ostersonntag(int $jahr): string
{
    $a = $jahr % 19;
    $b = intdiv($jahr, 100);
    $c = $jahr % 100;
    $d = intdiv($b, 4);
    $e = $b % 4;
    $f = intdiv($b + 8, 25);
    $g = intdiv($b - $f + 1, 3);
    $h = (19 * $a + $b - $d - $g + 15) % 30;
    $i = intdiv($c, 4);
    $k = $c % 4;
    $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
    $m = intdiv($a + 11 * $h + 22 * $l, 451);
    $monat = intdiv($h + $l - 7 * $m + 114, 31);
    $tag = (($h + $l - 7 * $m + 114) % 31) + 1;
    return sprintf('%04d-%02d-%02d', $jahr, $monat, $tag);
}

// Die dem Sonntag gleichgestellten Feiertage im Kanton Solothurn.
//
// Quelle: Arbeitsinspektorat Kanton Solothurn, Art. 20a ArG. Acht kantonale
// Tage zuzueglich der Bundesfeier, die in der ganzen Schweiz gleichgestellt
// ist.
//
// NICHT enthalten sind Berchtoldstag, Oster- und Pfingstmontag, Mariae
// Empfaengnis und Stephanstag. Sie stehen in gebraeuchlichen Kalendern, sind
// aber nicht durchgehend gleichgestellt (siehe GAV-AUS-006).
//
// Ebenfalls nicht abgebildet: der Bezirk Bucheggberg kennt Fronleichnam,
// Mariae Himmelfahrt und Allerheiligen nicht, und einzelne Gemeinden koennen
// eigene Tage haben. Fuer die heutigen Objekte ohne Wirkung -- wer das
// braucht, traegt den Tag von Hand nach.
function feiertage_solothurn(int $jahr): array
{
    $o = new DateTimeImmutable(ostersonntag($jahr));
    $tag = fn(int $plus) => $o->modify(($plus >= 0 ? '+' : '') . $plus . ' days')->format('Y-m-d');

    return [
        ['datum' => sprintf('%04d-01-01', $jahr), 'name' => 'Neujahr',            'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => $tag(-2),                     'name' => 'Karfreitag',         'halbtags' => 0, 'ab_zeit' => null],
        // Der 1. Mai gilt in Solothurn nur nachmittags -- ein halber Feiertag.
        ['datum' => sprintf('%04d-05-01', $jahr), 'name' => 'Tag der Arbeit (ab Mittag)', 'halbtags' => 1, 'ab_zeit' => '12:00'],
        ['datum' => $tag(39),                     'name' => 'Auffahrt',           'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => $tag(60),                     'name' => 'Fronleichnam',       'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => sprintf('%04d-08-01', $jahr), 'name' => 'Bundesfeier',        'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => sprintf('%04d-08-15', $jahr), 'name' => 'Mariä Himmelfahrt',  'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => sprintf('%04d-11-01', $jahr), 'name' => 'Allerheiligen',      'halbtags' => 0, 'ab_zeit' => null],
        ['datum' => sprintf('%04d-12-25', $jahr), 'name' => 'Weihnachten',        'halbtags' => 0, 'ab_zeit' => null],
    ];
}

const FEIERTAG_QUELLE = 'Arbeitsinspektorat Kanton Solothurn (ohne Bezirk Bucheggberg), Art. 20a ArG';

// Feiertage eines Kantons in einem Zeitraum, als Zuordnung Datum -> Name.
function feiertage_im_zeitraum(string $kanton, string $von, string $bis): array
{
    $s = db()->prepare('SELECT datum, name, halbtags FROM feiertage WHERE kanton = ? AND datum BETWEEN ? AND ?');
    $s->execute([$kanton, $von, $bis]);
    $map = [];
    foreach ($s->fetchAll() as $r) {
        $map[$r['datum']] = ['name' => $r['name'], 'halbtags' => (int)$r['halbtags']];
    }
    return $map;
}

// Welche Schichten wuerden im Zeitraum aus den Masterschichten eines Objekts
// entstehen? Schreibt nichts -- das Ergebnis dient der Vorschau und wird von
// schichten_erzeugen.php mit denselben Regeln noch einmal berechnet.
function planung_bedarf(int $objektId, string $von, string $bis): array
{
    $o = db()->prepare('SELECT * FROM objekte WHERE id = ?');
    $o->execute([$objektId]);
    $objekt = $o->fetch();
    if (!$objekt) {
        return ['fehler' => 'Objekt nicht gefunden'];
    }

    $ms = db()->prepare(
        'SELECT * FROM masterschichten
         WHERE objekt_id = ? AND gueltig_ab <= ? AND (gueltig_bis IS NULL OR gueltig_bis >= ?)
         ORDER BY von, name'
    );
    $ms->execute([$objektId, $bis, $von]);
    $vorlagen = $ms->fetchAll();

    $feiertage = feiertage_im_zeitraum((string)$objekt['kanton'], $von, $bis);
    $wochenfeld = [1 => 'bedarf_mo', 2 => 'bedarf_di', 3 => 'bedarf_mi', 4 => 'bedarf_do',
                   5 => 'bedarf_fr', 6 => 'bedarf_sa', 7 => 'bedarf_so'];

    $bedarf = [];
    $ende = new DateTimeImmutable($bis);

    foreach ($vorlagen as $v) {
        $tag = new DateTimeImmutable(max($von, $v['gueltig_ab']));
        $letzter = $v['gueltig_bis'] !== null && $v['gueltig_bis'] < $bis
            ? new DateTimeImmutable($v['gueltig_bis']) : $ende;

        while ($tag <= $letzter) {
            $datum = $tag->format('Y-m-d');
            $anzahl = 0;

            if ($v['rhythmus'] === 'intervall') {
                // Strikter Rhythmus ab dem Startdatum, ohne Ruecksicht auf
                // Wochentage und Feiertage (ENT-021, als ANNAHME vermerkt).
                $start = new DateTimeImmutable((string)($v['intervall_start'] ?: $v['gueltig_ab']));
                $abstand = max(1, (int)$v['intervall_tage']);
                $diff = (int)$start->diff($tag)->format('%r%a');
                if ($diff >= 0 && $diff % $abstand === 0) {
                    $anzahl = (int)$v['bedarf_intervall'];
                }
            } else {
                // Ein Feiertag ersetzt den Wochentagsbedarf, er ergaenzt ihn nicht.
                $anzahl = isset($feiertage[$datum])
                    ? (int)$v['bedarf_feiertag']
                    : (int)$v[$wochenfeld[(int)$tag->format('N')]];
            }

            if ($anzahl > 0) {
                $bedarf[] = [
                    'datum' => $datum,
                    'masterschicht_id' => (int)$v['id'],
                    'name' => $v['name'],
                    'kuerzel' => $v['kuerzel'],
                    'von' => substr((string)$v['von'], 0, 5),
                    'bis' => substr((string)$v['bis'], 0, 5),
                    'bedarf' => $anzahl,
                    'status' => (int)$v['auf_abruf'] ? 'provisorisch' : 'geplant',
                    'feiertag' => $feiertage[$datum]['name'] ?? null,
                    'art' => $v['art'],
                    // Die Sparte reist von der Vorlage mit, damit die erzeugte
                    // Schicht in der richtigen Spur landet (ENT-037).
                    'sparte' => sparte_pruefen($v['sparte'] ?? null),
                    'arbeitszeit_h' => (float)$v['arbeitszeit_h'],
                ];
            }
            $tag = $tag->modify('+1 day');
        }
    }

    usort($bedarf, fn($a, $b) => [$a['datum'], $a['von']] <=> [$b['datum'], $b['von']]);

    return [
        'objekt' => [
            'id' => (int)$objekt['id'],
            'name' => $objekt['name'],
            'kunde_id' => $objekt['kunde_id'] === null ? null : (int)$objekt['kunde_id'],
            'kunde_name' => $objekt['kunde_name'],
            'strasse' => $objekt['strasse'],
            'ort' => $objekt['ort'],
            'kanton' => $objekt['kanton'],
            'einsatzart' => $objekt['einsatzart'],
        ],
        'bedarf' => $bedarf,
        'vorlagen' => $vorlagen,
        'feiertage' => $feiertage,
    ];
}

// Was aus den Vorlagen im Zeitraum noch NICHT existiert. Baut auf
// planung_bedarf() auf -- die Bedarfsregel steht nur an einer Stelle.
function planung_vorschlag(int $objektId, string $von, string $bis): array
{
    $b = planung_bedarf($objektId, $von, $bis);
    if (isset($b['fehler'])) {
        return $b;
    }

    $vorhanden = [];
    $ex = db()->prepare(
        'SELECT masterschicht_id, datum FROM einsaetze
         WHERE objekt_id = ? AND datum BETWEEN ? AND ? AND masterschicht_id IS NOT NULL'
    );
    $ex->execute([$objektId, $von, $bis]);
    foreach ($ex->fetchAll() as $r) {
        $vorhanden[$r['masterschicht_id'] . '|' . $r['datum']] = true;
    }

    $neu = [];
    $uebersprungen = 0;
    foreach ($b['bedarf'] as $s) {
        if (isset($vorhanden[$s['masterschicht_id'] . '|' . $s['datum']])) {
            $uebersprungen++;
            continue;
        }
        unset($s['arbeitszeit_h']);   // im Vorschlag nicht gebraucht
        $neu[] = $s;
    }

    return [
        'objekt' => $b['objekt'],
        'neu' => $neu,
        'uebersprungen' => $uebersprungen,
        'vorlagen' => count($b['vorlagen']),
        'feiertage' => count($b['feiertage']),
    ];
}

// Zeitfenster eines Einsatzes als Zeitstempel. Liegt "bis" vor "von", laeuft
// der Einsatz ueber Mitternacht in den Folgetag.
function zeitfenster(string $datum, string $von, string $bis): array
{
    $tag = substr($datum, 0, 10);
    $a = strtotime($tag . ' ' . substr($von, 0, 5));
    $b = strtotime($tag . ' ' . substr($bis, 0, 5));
    if ($b <= $a) {
        $b += 86400;
    }
    return [$a, $b];
}

// Wer von den gewuenschten Mitarbeitenden ist im selben Zeitfenster schon
// anderswo eingeteilt? (ENT-022)
//
// Aneinandergrenzende Schichten sind KEINE Doppelbelegung: 22:00-22:30 und
// 22:30-22:45 beruehren sich nur. Das ist Absicht -- eine Fahrtzeit schliesst
// direkt an die Runde an.
//
// Abgesagte Einsaetze blockieren nicht. Provisorische schon: die Person ist
// dafuer vorgesehen und kann nicht gleichzeitig woanders sein.
function doppelbelegungen(int $einsatzId, string $datum, string $von, string $bis, array $mitarbeiterIds): array
{
    if (!$mitarbeiterIds) {
        return [];
    }
    [$a, $b] = zeitfenster($datum, $von, $bis);

    // Der Tag davor und danach muss mit, weil Nachtschichten ueber Mitternacht
    // laufen und sonst durchrutschen wuerden.
    $marken = implode(',', array_fill(0, count($mitarbeiterIds), '?'));
    $sql = "SELECT e.id, e.datum, e.von, e.bis, e.kunde_name, e.titel, e.status,
                   z.mitarbeiter_id, m.vorname, m.nachname, m.name
            FROM einsatz_zuteilung z
            JOIN einsaetze e ON e.id = z.einsatz_id
            JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
            WHERE z.mitarbeiter_id IN ($marken)
              AND e.id <> ?
              AND e.status <> 'abgesagt'
              -- Entfallene Zuteilungen belegen niemanden mehr (ENT-347):
              -- Die Zeile bleibt als Nachweis stehen, dass die Person dort
              -- eingeteilt WAR, aber sie ist es nicht mehr. Ohne diese Zeile
              -- meldete die Sperre denselben Konflikt bei jedem weiteren
              -- Versuch erneut -- gegen eine Zuteilung, die sie selbst
              -- aufgeloest hat.
              --
              -- 'abgelehnt' ist seit ENT-350 ebenfalls ausgenommen (OP-348,
              -- vom Projektinhaber entschieden): Die Planungsliste zeigte
              -- eine abgelehnte Zuteilung schon seit ENT-113 als NICHT
              -- besetzt -- die Sperre behauptete an derselben Zeile das
              -- Gegenteil. Eine Ablehnung ist eine aktive Aussage der
              -- Person („ich mache das nicht“) und kein Grund, sie an
              -- einem anderen Objekt zur selben Zeit zu blockieren.
              AND z.zusage NOT IN ('entfallen', 'abgelehnt')
              AND e.datum BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)";
    $stmt = db()->prepare($sql);
    $stmt->execute([...$mitarbeiterIds, $einsatzId, $datum, $datum]);

    $treffer = [];
    foreach ($stmt->fetchAll() as $r) {
        [$c, $d] = zeitfenster($r['datum'], $r['von'], $r['bis']);
        if ($c < $b && $a < $d) {
            $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? '')) ?: $r['name'];
            $treffer[] = [
                'mitarbeiter_id' => (int)$r['mitarbeiter_id'],
                'name' => $name,
                'einsatz_id' => (int)$r['id'],
                'was' => trim(($r['titel'] ?: $r['kunde_name']) . ' ' . substr($r['von'], 0, 5) . '–' . substr($r['bis'], 0, 5)),
                'datum' => $r['datum'],
            ];
        }
    }
    return $treffer;
}

// Wer aus der gewuenschten Zuteilung KEINE Revierdienst-Berechtigung hat
// (ENT-284) -- nur relevant, wenn die Schicht selbst Revierdienst ist. Eine
// Warnung, keine Sperre: Der Planer wird informiert und kann trotzdem
// zuteilen (z. B. beim erstmaligen Einteilen einer Person INS
// Revierdienst) -- anders als bei doppelbelegungen() oben, wo eine
// Ueberschneidung fachlich unmoeglich ist.
function ohneRevierdienstBerechtigung(string $einsatzart, array $mitarbeiterIds): array
{
    if ($einsatzart !== 'Revierdienst' || !$mitarbeiterIds) {
        return [];
    }
    $marken = implode(',', array_fill(0, count($mitarbeiterIds), '?'));
    $stmt = db()->prepare(
        "SELECT id, vorname, nachname, name FROM mitarbeiter
          WHERE id IN ($marken) AND revierdienst_berechtigt = 0"
    );
    $stmt->execute($mitarbeiterIds);
    return array_map(static function ($r) {
        return [
            'mitarbeiter_id' => (int)$r['id'],
            'name' => trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? '')) ?: $r['name'],
            // Anmeldename, getrennt vom Anzeigenamen oben: mbOeffnen() in
            // dashboard.html braucht genau diesen, nicht Vor-/Nachname, um
            // direkt zur Mitarbeiter-Akte zu verlinken (ENT-284).
            'login_name' => $r['name'],
        ];
    }, $stmt->fetchAll());
}

// Setzt den Bedarf einer Vorlage ab einem Datum (ENT-026).
//
// Liegt das Datum nicht nach dem Beginn der Fassung, hat diese nie fuer einen
// frueheren Tag gegolten -- dann wird sie ersetzt statt geteilt. Sonst entsteht
// eine neue Fassung, und die bisherige endet am Vortag. Damit bleibt die Regel
// aus ENT-021 gewahrt: die Vergangenheit wird nicht angefasst.
function bedarf_fassung_setzen(int $id, array $bedarf, string $abDatum): array
{
    $s = db()->prepare('SELECT * FROM masterschichten WHERE id = ?');
    $s->execute([$id]);
    $alt = $s->fetch();
    if (!$alt) {
        return ['fehler' => 'Masterschicht nicht gefunden'];
    }

    $spalten = ['bedarf_mo', 'bedarf_di', 'bedarf_mi', 'bedarf_do', 'bedarf_fr',
                'bedarf_sa', 'bedarf_so', 'bedarf_feiertag', 'bedarf_intervall'];
    $werte = [];
    foreach ($spalten as $sp) {
        $werte[$sp] = array_key_exists($sp, $bedarf)
            ? max(0, min(99, (int)$bedarf[$sp]))
            : (int)$alt[$sp];
    }

    // Nichts geaendert: keine neue Fassung anlegen, sonst waechst die Liste bei
    // jedem Speichern, ohne dass sich etwas unterscheidet.
    $gleich = true;
    foreach ($spalten as $sp) {
        if ((int)$alt[$sp] !== $werte[$sp]) { $gleich = false; break; }
    }
    if ($gleich) {
        return ['id' => $id, 'art' => 'unveraendert'];
    }

    if ($abDatum <= (string)$alt['gueltig_ab']) {
        $satz = implode(', ', array_map(fn($k) => "$k = ?", $spalten));
        $u = db()->prepare("UPDATE masterschichten SET $satz WHERE id = ?");
        $u->execute([...array_values($werte), $id]);
        return ['id' => $id, 'art' => 'ersetzt'];
    }

    $neu = $alt;
    unset($neu['id']);
    foreach ($spalten as $sp) {
        $neu[$sp] = $werte[$sp];
    }
    $neu['gueltig_ab'] = $abDatum;
    $neu['ersetzt_id'] = $id;

    $namen = implode(', ', array_keys($neu));
    $marken = implode(', ', array_fill(0, count($neu), '?'));
    $i = db()->prepare("INSERT INTO masterschichten ($namen) VALUES ($marken)");
    $i->execute(array_values($neu));
    $neuId = (int)db()->lastInsertId();

    $vortag = (new DateTimeImmutable($abDatum))->modify('-1 day')->format('Y-m-d');
    db()->prepare('UPDATE masterschichten SET gueltig_bis = ? WHERE id = ?')->execute([$vortag, $id]);

    return ['id' => $neuId, 'art' => 'neue Fassung', 'alt_bis' => $vortag];
}

// Legt die noch fehlenden Schichten eines Zeitraums an und gibt zurueck, wie
// viele es waren. Gemeinsame Grundlage von schichten_erzeugen.php und dem
// Anwenden-Fenster (ENT-026).
function schichten_anlegen(array $vorschlag, int $adminId): int
{
    if (!$vorschlag['neu']) {
        return 0;
    }
    $o = $vorschlag['objekt'];
    $ins = db()->prepare(
        'INSERT INTO einsaetze (kunde_id, kunde_name, objekt_id, masterschicht_id, titel,
                                strasse, ort, einsatzart, sparte, datum, von, bis, bedarf, status, erstellt_von)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($vorschlag['neu'] as $s) {
        // Fahrtzeit bleibt als eigene Einsatzart sichtbar. Ob sie bezahlte
        // Arbeitszeit ist, entscheidet dieses Werkzeug nicht (GAV).
        $einsatzart = $s['art'] === 'fahrtzeit' ? 'Fahrtzeit' : $o['einsatzart'];
        // Vorlage schlaegt Objekt: eine Reinigungsvorlage an einem sonst
        // bewachten Objekt erzeugt Reinigungsschichten (ENT-037).
        $sparte = sparte_pruefen($s['sparte'] ?? null, sparte_pruefen($o['sparte'] ?? null));
        $ins->execute([
            $o['kunde_id'], $o['kunde_name'], $o['id'], $s['masterschicht_id'], $s['name'],
            $o['strasse'], $o['ort'], $einsatzart, $sparte, $s['datum'], $s['von'], $s['bis'],
            $s['bedarf'], $s['status'], $adminId,
        ]);
    }
    return count($vorschlag['neu']);
}

// ── Sperre abgeglichener Schichten (ENT-045) ─────────────────────────────
//
// Ist eine Schicht einmal abgeglichen, ist sie festgeschrieben: sie hat
// festgehalten, was tatsaechlich geleistet wurde. Wer danach den Plan
// aendert, veraendert rueckwirkend die Grundlage einer Feststellung, die
// jemand geprueft und bestaetigt hat. Das ist dieselbe Regel wie beim
// versionierten Regelwerk in CLAUDE.md: eine spaetere Aenderung darf einen
// abgeschlossenen Vorgang nie rueckwirkend verschieben.
//
// Die Sperre liegt bewusst hier im Server und nicht nur in der Oberflaeche --
// eine Sperre, die man am Browser vorbei umgehen kann, ist keine.
function einsatz_abgeglichen(PDO $pdo, int $einsatzId): bool
{
    $s = $pdo->prepare(
        "SELECT 1 FROM einsaetze WHERE id = ? AND ist_status <> 'offen'
         UNION ALL
         SELECT 1 FROM einsatz_zuteilung WHERE einsatz_id = ? AND ist_status <> 'offen'
         LIMIT 1"
    );
    $s->execute([$einsatzId, $einsatzId]);
    return (bool)$s->fetchColumn();
}

// "Abgeschlossen" (ENT-128): ein Einsatz gilt als fertig rapportiert, sobald
// JEDE Person mit einer zugesagten Zuteilung ihren Rapport eingereicht hat --
// nicht schon, wenn irgendeine das tut, und nicht schon, weil das Kalenderdatum
// vorbei ist. Ohne mindestens eine zugesagte Zuteilung ist der Einsatz NIE
// abgeschlossen (sonst waere ein Einsatz ohne echte Zusage sofort "fertig",
// bevor ueberhaupt jemand haette rapportieren koennen).
function einsatz_vollstaendig_rapportiert(PDO $pdo, int $einsatzId): bool
{
    $s = $pdo->prepare(
        "SELECT COUNT(*) AS zugesagt,
                SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM rapporte r WHERE r.einsatz_id = z.einsatz_id AND r.mitarbeiter_id = z.mitarbeiter_id
                ) THEN 1 ELSE 0 END) AS rapportiert
         FROM einsatz_zuteilung z WHERE z.einsatz_id = ? AND z.zusage = 'zugesagt'"
    );
    $s->execute([$einsatzId]);
    $row = $s->fetch();
    return $row && (int)$row['zugesagt'] > 0 && (int)$row['zugesagt'] === (int)$row['rapportiert'];
}

// Umplanung: eine Person aus den Schichten nehmen, in denen sie zur selben
// Zeit schon steht (ENT-060).
//
// Das ist ausdruecklich KEINE Aufweichung von ENT-022. Niemand ist danach an
// zwei Orten -- die Person wechselt die Schicht, statt in beiden zu stehen.
// Genau deshalb wird hier GELOESCHT und nicht bloss hinzugefuegt.
//
// Zwei Dinge sind dabei unverhandelbar:
//   1. Eine bereits abgeglichene Schicht wird nicht angefasst. Dort steht
//      geleistete Zeit mit Lohnfolge; wer sie nachtraeglich umplant, aendert
//      eine Abrechnung. Solche Faelle werden gemeldet, nicht still uebergangen.
//   2. Die alte Schicht bleibt bestehen und wird dadurch unterbesetzt. Das ist
//      gewollt: Die Luecke, die durch das Umplanen entsteht, muss sichtbar
//      werden, sonst verschwindet sie aus der Planung.
//
// Rueckgabe: Liste der Schichten, aus denen NICHT entfernt werden konnte.
function umplanen(PDO $pdo, array $konflikte, array $mitarbeiterIds): array
{
    $erlaubt = array_flip(array_map('intval', $mitarbeiterIds));
    $blockiert = [];
    foreach ($konflikte as $k) {
        $maId = (int)($k['mitarbeiter_id'] ?? 0);
        $esId = (int)($k['einsatz_id'] ?? 0);
        if ($maId <= 0 || $esId <= 0 || !isset($erlaubt[$maId])) { continue; }
        if (einsatz_abgeglichen($pdo, $esId)) {
            $blockiert[] = $k;
            continue;
        }
        $del = $pdo->prepare('DELETE FROM einsatz_zuteilung WHERE einsatz_id = ? AND mitarbeiter_id = ?');
        $del->execute([$esId, $maId]);
    }
    return $blockiert;
}

// Bricht mit einer verstaendlichen Meldung ab, wenn die Schicht gesperrt ist.
function einsatz_sperre_pruefen(PDO $pdo, int $einsatzId): void
{
    if ($einsatzId <= 0) { return; }
    if (einsatz_abgeglichen($pdo, $einsatzId)) {
        json_response(['status' => 'error', 'gesperrt' => true, 'message' =>
            'Diese Schicht ist bereits abgeglichen und damit festgeschrieben. '
            . 'Zum Aendern zuerst unter Abgleich die Sperre aufheben.'], 409);
    }
}

// ── Dienstfahrzeug und Fahrer am Einsatz (ENT-328) ────────────────────
//
// EINE Pruefstelle fuer BEIDE Schreibwege: einsatz_save.php (beim Anlegen und
// Aendern aus der Anlegen-Ansicht) und einsatz_fahrzeug.php (nachtraeglich im
// Einsatzplan). Zwei getrennte Pruefungen waeren zwei Wahrheiten darueber,
// welche Kombination zulaessig ist -- dieselbe Ueberlegung wie bei darf() in
// rechte.php.
//
// Antwortet selbst mit einer Fehlermeldung und bricht ab; der Aufrufer
// bekommt nur zurueck, was er speichern darf.
//
// $zuteilung sind die Mitarbeiter-IDs, die NACH diesem Speichern am Einsatz
// haengen -- nicht die davor. Sonst liesse sich ein Fahrer bestimmen, der im
// selben Zug aus der Schicht genommen wird.
function einsatz_fahrzeug_pruefen(PDO $pdo, ?int $fahrzeugId, ?int $fahrerId,
                                  array $zuteilung, ?int $bisherFahrzeugId = null): array
{
    if ($fahrzeugId !== null && $fahrzeugId <= 0) { $fahrzeugId = null; }
    if ($fahrerId !== null && $fahrerId <= 0) { $fahrerId = null; }

    // Ohne Fahrzeug hat ein Fahrer keine Bedeutung. Die Angabe wird nicht
    // still verworfen, sondern abgewiesen -- wer einen Fahrer eintraegt, ohne
    // dass ein Fahrzeug dasteht, hat sich vertan und soll das erfahren.
    if ($fahrzeugId === null && $fahrerId !== null) {
        json_response(['status' => 'error', 'message' =>
            'Ein Fahrer ohne Dienstfahrzeug ergibt keine Angabe. Zuerst das Fahrzeug wählen.'], 422);
    }
    if ($fahrzeugId === null) { return ['fahrzeug_id' => null, 'fahrer_id' => null]; }

    if (!hat_tabelle($pdo, 'fahrzeuge')) {
        json_response(['status' => 'error', 'message' =>
            'Es sind noch keine Dienstfahrzeuge eingerichtet.'], 422);
    }
    $s = $pdo->prepare('SELECT kennzeichen, status FROM fahrzeuge WHERE id = ?');
    $s->execute([$fahrzeugId]);
    $fz = $s->fetch(PDO::FETCH_ASSOC);
    if (!$fz) {
        json_response(['status' => 'error', 'message' => 'Dieses Fahrzeug gibt es nicht.'], 422);
    }
    // Ein Fahrzeug ausser Betrieb oder verkauft laesst sich nicht NEU
    // einteilen. Ein bereits eingeteiltes bleibt stehen, auch wenn es
    // spaeter in die Werkstatt geht: Was gefahren wurde, ist eine Tatsache,
    // und ein Speichern der Bemerkung darf sie nicht wegraeumen.
    if ($fz['status'] !== 'aktiv' && (int)$fahrzeugId !== (int)$bisherFahrzeugId) {
        json_response(['status' => 'error', 'message' =>
            $fz['kennzeichen'] . ' steht nicht im Betrieb ('
            . ($fz['status'] === 'verkauft' ? 'verkauft' : 'ausser Betrieb')
            . ') und lässt sich nicht einteilen.'], 422);
    }

    // Der Fahrer muss dem Einsatz zugeteilt sein. Sonst faehrt jemand ein
    // Fahrzeug zu einer Schicht, auf der er gar nicht steht -- und die
    // Auslagen-Folge unten traefe eine Zuteilung, die es nicht gibt.
    if ($fahrerId !== null && !in_array($fahrerId, array_map('intval', $zuteilung), true)) {
        json_response(['status' => 'error', 'message' =>
            'Der Fahrer muss diesem Einsatz zugeteilt sein.'], 422);
    }

    return ['fahrzeug_id' => $fahrzeugId, 'fahrer_id' => $fahrerId];
}

// Die Geld-Folge der Fahrerbestimmung, an EINER Stelle (ENT-328).
//
// Wer das Geschaeftsfahrzeug fuehrt, faehrt damit zum Einsatz. Das Verkehrs-
// mittel dieser Zuteilung MUSS dann 'Geschaeftsfahrzeug' sein -- sonst
// rechnet der Abgleich einen Fahrkostenersatz fuer ein Auto, das dem Betrieb
// selbst gehoert (auslagen.php, Art. 18 Ziff. 4/5). Zwei Angaben ueber
// dieselbe Fahrt, die sich widersprechen koennen, waeren genau die zweite
// Wahrheit, die es hier nicht geben darf.
//
// Ausdruecklich NICHT gesetzt wird das Verkehrsmittel der UEBRIGEN
// Eingeteilten. Dass sie mitfahren, waere eine Annahme -- sie koennen mit dem
// eigenen Auto oder dem Zug direkt zum Einsatzort kommen. Der Planer
// entscheidet das je Person weiter wie bisher.
function einsatz_fahrer_verkehrsmittel_setzen(PDO $pdo, int $einsatzId,
                                              ?int $fahrerId, ?int $bisherFahrerId = null): void
{
    if ($einsatzId <= 0) { return; }

    // Wer nicht mehr faehrt, faellt auf die Vorgabe seines Stammblatts
    // zurueck (NULL) statt auf einem stehengebliebenen 'Geschaeftsfahrzeug'
    // sitzenzubleiben. Bewusst NUR die bisherige Fahrerin oder der bisherige
    // Fahrer und bewusst nur, wenn dort noch der von uns gesetzte Wert steht:
    // Hat jemand danach von Hand etwas anderes eingetragen, gehoert das ihm
    // und wird nicht ueberschrieben.
    if ($bisherFahrerId !== null && $bisherFahrerId !== $fahrerId) {
        $pdo->prepare(
            "UPDATE einsatz_zuteilung SET verkehrsmittel = NULL, oev_rappen = NULL
             WHERE einsatz_id = ? AND mitarbeiter_id = ? AND verkehrsmittel = 'Geschaeftsfahrzeug'"
        )->execute([$einsatzId, $bisherFahrerId]);
    }

    if ($fahrerId === null) { return; }
    $pdo->prepare(
        "UPDATE einsatz_zuteilung SET verkehrsmittel = 'Geschaeftsfahrzeug', oev_rappen = NULL
         WHERE einsatz_id = ? AND mitarbeiter_id = ?"
    )->execute([$einsatzId, $fahrerId]);
}

// Anstellungskategorie nach Art. 8 GAV (ENT-065). Leer bleibt leer: Eine
// geratene Kategorie behauptet eine Obergrenze, die niemand vereinbart hat.
function kategorie_pruefen($w): ?string {
    $k = strtoupper(trim((string)$w));
    return in_array($k, ['A', 'B', 'C'], true) ? $k : null;
}
function pensum_pruefen($w): ?int {
    if ($w === null || $w === '' ) { return null; }
    $n = (int)$w;
    return ($n > 0 && $n <= 3000) ? $n : null;
}
