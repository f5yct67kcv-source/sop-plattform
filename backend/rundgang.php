<?php
// Fachlogik fuer die Rundgang-Durchfuehrung (ENT-132/ENT-145/ENT-180).
//
// Getrennt von den API-Endpunkten (backend/api/mein_rundgang_*.php), damit
// sich der eigentliche Rechenkern echt gegen SQLite pruefen laesst --
// gleiches Prinzip wie planung.php/einsatz_sperre_pruefen().
declare(strict_types=1);

/* Die Ereignisart, unter der eine nicht ausfuehrbare Aufgabe im Meldeweg
   erscheint (ENT-311). Als Konstante und nicht zweimal als Zeichenkette:
   Der Endpunkt SUCHT sie, die Einrichtung LEGT sie an -- laufen die beiden
   Schreibweisen auseinander, entstehen Ereignisse ohne Art, und niemand
   merkt es, weil sie trotzdem im Feed stehen. */
const EREIGNISART_AUFGABE = 'Aufgabe nicht ausführbar';

/* Die Ereignisart, unter der ein abgebrochener Rundgang im Meldeweg
   erscheint (ENT-324). Vom Projektinhaber verlangt: „Ich habe vorhin noch
   einen Rundgang bewusst abgebrochen, diese Info muss zwingend in die
   Ereignisse im Dashboard."
   Wie bei EREIGNISART_AUFGABE als Konstante: Der Endpunkt SUCHT sie, die
   Einrichtung LEGT sie an -- laufen die Schreibweisen auseinander,
   entstehen Ereignisse ohne Art, und niemand merkt es. */
const EREIGNISART_ABBRUCH = 'Rundgang abgebrochen';

/* Eine Runde, die waehrend einer anderswo geplanten Schicht gestartet wurde
   (ENT-342). Bis dahin war das eine SPERRE: Der Server wies den Start mit
   409 ab. Vom Projektinhaber aufgehoben, mit Begruendung -- der Disponent
   plant kurzfristig um, der Waechter steht davor und kommt nicht weiter,
   und ausgerechnet dann ist der Planer oft nicht am Telefon. Die Sperre
   schuetzte vor einem Planungsfehler, den der Waechter draussen gar nicht
   beheben kann.

   An die Stelle der Sperre tritt Sichtbarkeit: Der Waechter bestaetigt
   einmal, und die Disposition sieht es an ZWEI Orten -- an der geplanten
   Schicht (abgeleitet in einsatz_list.php, ohne neue Spalte) und hier als
   Ereignis. */
const EREIGNISART_PARALLELRUNDE = 'Rundgang trotz anderer Einteilung';

/* Wie lange eine Bewegungsspur aufbewahrt wird (ENT-318).
   Als Konstante und mit Begruendung, damit die Zahl eine Entscheidung ist
   und keine Zufaelligkeit: Die Spur dient dem Nachweis EINER Runde. Ist
   diese Frist um, tragen die Kontrollpunkt-Scans mit ihren Zeitstempeln den
   Nachweis weiter -- nur die Bewegung dazwischen verschwindet.
   Nicht zu verwechseln mit den fuenf Jahren aus Art. 12 Ziff. 5 GAV: Die
   gelten fuer die Lohnabrechnung, nicht fuer Aufenthaltsdaten. */
const RUNDGANG_SPUR_TAGE = 90;

// Haversine-Distanz in Metern zwischen zwei Koordinaten.
function geo_distanz_meter(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $erdradius = 6371000.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2
        + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $erdradius * $c;
}

// Welche Kontrollpunkte eines Objekts sind in diesem Rundgang noch offen?
// "Offen" heisst: aktiv UND noch kein rundgang_scan-Eintrag dafuer (ENT-145:
// ein Punkt verschwindet aus der Restliste, sobald er bestaetigt, als nicht
// verfuegbar gemeldet ODER per Ersatzscan bestaetigt wurde -- alle drei sind
// "erledigt", nicht nur die reguläre Bestaetigung).
//
// $vorlageId (ENT-204): null bedeutet "keine Kontrollrunde gewaehlt" -- dann
// unveraendertes Verhalten von vor ENT-204 (alle aktiven Punkte des
// Objekts). Ist eine Vorlage gesetzt, zaehlen nur deren Punkte, in ihrer
// eigenen Reihenfolge statt der globalen kontrollpunkt.reihenfolge.
// Aufgaben je Kontrollpunkt, samt bereits gegebener Antwort in DIESER Runde
// (ENT-305). Eine Liste von Kontrollpunkten ohne ihre Aufgaben waere in der
// App nutzlos: Die Aufgabe erscheint genau dann, wenn der Punkt erfasst wird.
//
// Nur aktive Aufgaben (ENT-302 setzt beim Entfernen aktiv = 0). Die bereits
// gegebene Antwort kommt mit, damit ein erneutes Oeffnen der Runde nicht
// dieselbe Frage noch einmal stellt -- und damit sichtbar bleibt, was schon
// beantwortet ist.
function rundgang_aufgaben_je_punkt(PDO $pdo, int $rundgangId, array $punktIds): array
{
    if (!$punktIds) { return []; }
    // hat_tabelle steht in db.php und ist hier nicht garantiert geladen
    // (diese Datei laeuft in Pruefungen isoliert). Darum die Tabellenfrage
    // ueber einen Versuch statt ueber eine Hilfsfunktion.
    $platz = implode(',', array_fill(0, count($punktIds), '?'));
    try {
        $s = $pdo->prepare(
            "SELECT ka.kontrollpunkt_id, a.id, a.bezeichnung, a.information
               FROM kontrollpunkt_aufgabe ka
               JOIN objekt_aufgabe a ON a.id = ka.aufgabe_id AND a.aktiv = 1
              WHERE ka.kontrollpunkt_id IN ($platz)
              ORDER BY ka.reihenfolge, a.id"
        );
        $s->execute($punktIds);
        $zeilen = $s->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return [];
    }

    $antworten = [];
    try {
        $aStmt = $pdo->prepare(
            'SELECT kontrollpunkt_id, aufgabe_id, status, grund, erfasst_am
               FROM rundgang_aufgabe WHERE rundgang_id = ?'
        );
        $aStmt->execute([$rundgangId]);
        foreach ($aStmt->fetchAll(PDO::FETCH_ASSOC) as $a) {
            $antworten[(int)$a['kontrollpunkt_id'] . ':' . (int)$a['aufgabe_id']] = [
                'status' => $a['status'], 'grund' => $a['grund'], 'erfasst_am' => $a['erfasst_am'],
            ];
        }
    } catch (Throwable $e) {
        $antworten = [];
    }

    $nach = [];
    foreach ($zeilen as $z) {
        $kid = (int)$z['kontrollpunkt_id'];
        $nach[$kid][] = [
            'id'          => (int)$z['id'],
            'bezeichnung' => $z['bezeichnung'],
            'information' => $z['information'],
            'erledigt'    => $antworten[$kid . ':' . (int)$z['id']] ?? null,
        ];
    }
    return $nach;
}

// Haengt die Aufgaben an eine bereits geladene Kontrollpunkt-Liste.
function rundgang_punkte_mit_aufgaben(PDO $pdo, int $rundgangId, array $punkte): array
{
    $ids = array_map(static fn($k) => (int)$k['id'], $punkte);
    $nach = rundgang_aufgaben_je_punkt($pdo, $rundgangId, $ids);
    foreach ($punkte as $i => $k) {
        $punkte[$i]['aufgaben'] = $nach[(int)$k['id']] ?? [];
    }
    return $punkte;
}

/* Ansprechpartner eines Objekts, aus BEIDEN Quellen (ENT-308).
   Wortgleich aus mein_rundgang_uebersicht.php hierher gezogen, damit es sie
   nur einmal gibt: Die laufende Runde braucht sie genauso wie die Vorschau
   -- der Waechter ruft nicht vor dem Losgehen an, sondern wenn er etwas
   vorfindet. Zwei Kopien derselben Abfrage waeren zwei Stellen, die beide
   stimmen muessten.

   Reihenfolge und Kennzeichnung wie in ENT-300 entschieden: Objekt zuerst,
   jeder Eintrag mit 'quelle'. */
function rundgang_ansprechpartner(PDO $pdo, int $objektId, ?int $kundeId,
                                  string $objektName, ?string $kundeName): array
{
    $liste = [];
    $tabelleDa = static function (PDO $p, string $t): bool {
        try { $p->query("SELECT 1 FROM $t LIMIT 1"); return true; }
        catch (Throwable $e) { return false; }
    };

    if ($tabelleDa($pdo, 'objekt_person')) {
        $opStmt = $pdo->prepare(
            'SELECT id, anrede, vorname, nachname, funktion FROM objekt_person
              WHERE objekt_id = ? ORDER BY sortierung, id'
        );
        $opStmt->execute([$objektId]);
        $oWege = [];
        if ($tabelleDa($pdo, 'objekt_kontaktweg')) {
            $owStmt = $pdo->prepare(
                'SELECT person_id, art, wert FROM objekt_kontaktweg
                  WHERE objekt_id = ? ORDER BY sortierung, id'
            );
            $owStmt->execute([$objektId]);
            foreach ($owStmt->fetchAll(PDO::FETCH_ASSOC) as $w) {
                $k = $w['person_id'] === null ? 'objekt' : (string)(int)$w['person_id'];
                $oWege[$k][] = ['art' => $w['art'], 'wert' => $w['wert']];
            }
        }
        foreach ($opStmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $name = trim(($p['vorname'] ?? '') . ' ' . ($p['nachname'] ?? ''));
            $funktion = trim((string)($p['funktion'] ?? ''));
            if ($name === '' && $funktion === '') { continue; }
            $liste[] = [
                'name'     => $name !== '' ? $name : $funktion,
                'anrede'   => $p['anrede'] ?: null,
                'funktion' => ($name !== '' && $funktion !== '') ? $funktion : null,
                'quelle'   => 'objekt',
                'wege'     => $oWege[(string)(int)$p['id']] ?? [],
            ];
        }
        if (!empty($oWege['objekt'])) {
            $liste[] = ['name' => $objektName, 'anrede' => null, 'funktion' => null,
                'quelle' => 'objekt', 'wege' => $oWege['objekt']];
        }
    }

    if ($kundeId !== null && $tabelleDa($pdo, 'kunden_person')) {
        $pStmt = $pdo->prepare(
            'SELECT id, anrede, vorname, nachname FROM kunden_person
              WHERE kunde_id = ? ORDER BY sortierung, id'
        );
        $pStmt->execute([$kundeId]);
        $wege = [];
        if ($tabelleDa($pdo, 'kunden_kontaktweg')) {
            $wStmt = $pdo->prepare(
                'SELECT person_id, art, wert FROM kunden_kontaktweg
                  WHERE kunde_id = ? ORDER BY sortierung, id'
            );
            $wStmt->execute([$kundeId]);
            foreach ($wStmt->fetchAll(PDO::FETCH_ASSOC) as $w) {
                $k = $w['person_id'] === null ? 'firma' : (string)(int)$w['person_id'];
                $wege[$k][] = ['art' => $w['art'], 'wert' => $w['wert']];
            }
        }
        foreach ($pStmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $name = trim(($p['vorname'] ?? '') . ' ' . ($p['nachname'] ?? ''));
            if ($name === '') { continue; }
            $liste[] = ['name' => $name, 'anrede' => $p['anrede'] ?: null, 'funktion' => null,
                'quelle' => 'kunde', 'wege' => $wege[(string)(int)$p['id']] ?? []];
        }
        if (!empty($wege['firma'])) {
            $liste[] = ['name' => (string)$kundeName, 'anrede' => null, 'funktion' => null,
                'quelle' => 'kunde', 'wege' => $wege['firma']];
        }
    }
    return $liste;
}

// Eigene Pikett-/Zentralnummer (ENT-299), ebenfalls fuer beide Wege.
/* Darf diese Person in den Revierdienst-Bereich? (ENT-338)
 *
 * EINE Stelle fuer vier Endpunkte (Rundgaenge-Uebersicht, Vorschau einer
 * Runde, spontaner Start, Ereignismeldung). Vorher stand in jedem dieselbe
 * Abfrage von Hand -- und alle vier fragten das FALSCHE:
 *
 *   "War diese Person jemals einem Objekt mit aktiven Kontrollpunkten
 *    zugeteilt?"
 *
 * Diese Herleitung hat ENT-284 abgeloest. Seither entscheidet das bewusst
 * von Personal/Verwaltung gesetzte Merkmal `mitarbeiter.revierdienst_
 * berechtigt`, und die "jemals zugeteilt"-Abfrage war nur noch die
 * einmalige Migration, die dieses Merkmal befuellt hat. In app.html wurde
 * das nachgezogen (waechterSichtbar()), serverseitig nicht -- die Kommentare
 * in den vier Endpunkten behaupteten sogar, sie fragten dasselbe wie
 * waechterSichtbar(). Taten sie nicht.
 *
 * Folge im Betrieb, vom Projektinhaber gemeldet: Ein frisch angelegter,
 * in der Personalakte freigegebener Waechter sah den Reiter, bekam von
 * jedem dieser Endpunkte aber 403 -- also genau den Konflikt, gegen den
 * ENT-284 gebaut wurde, eine Ebene tiefer.
 *
 * Fehlt die Spalte (Einrichtung noch nicht gelaufen), gilt weiterhin die
 * alte Herleitung. Sonst wuerde ein nicht migrierter Bestand alle
 * aussperren -- eine Zugriffsaenderung darf nie an einer fehlenden
 * Migration haengen.
 */
function revierdienst_zugang(PDO $pdo, int $mitarbeiterId): bool
{
    if (hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')) {
        $st = $pdo->prepare('SELECT revierdienst_berechtigt FROM mitarbeiter WHERE id = ?');
        $st->execute([$mitarbeiterId]);
        $wert = $st->fetchColumn();
        return $wert !== false && (int)$wert === 1;
    }
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM einsatz_zuteilung z
          JOIN einsaetze e ON e.id = z.einsatz_id
          JOIN kontrollpunkt k ON k.objekt_id = e.objekt_id AND k.aktiv = 1
         WHERE z.mitarbeiter_id = ?'
    );
    $st->execute([$mitarbeiterId]);
    return (int)$st->fetchColumn() > 0;
}

function rundgang_zentrale(PDO $pdo): ?array
{
    try {
        $bz = $pdo->query('SELECT firma, pikett_telefon FROM betrieb WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return null;
    }
    if (!$bz || trim((string)($bz['pikett_telefon'] ?? '')) === '') { return null; }
    return [
        'name'    => trim((string)$bz['firma']) !== '' ? trim((string)$bz['firma']) : null,
        'telefon' => trim((string)$bz['pikett_telefon']),
    ];
}

function rundgang_kontrollpunkte_uebrig(PDO $pdo, int $rundgangId, int $objektId, ?int $vorlageId = null): array
{
    if ($vorlageId !== null) {
        $s = $pdo->prepare(
            'SELECT k.* FROM kontrollpunkt k
              JOIN rundgang_vorlage_punkt p ON p.kontrollpunkt_id = k.id AND p.vorlage_id = ?
              WHERE k.objekt_id = ? AND k.aktiv = 1
                AND NOT EXISTS (
                  SELECT 1 FROM rundgang_scan s
                   WHERE s.rundgang_id = ? AND s.kontrollpunkt_id = k.id
                )
              ORDER BY p.reihenfolge, k.id'
        );
        $s->execute([$vorlageId, $objektId, $rundgangId]);
        return rundgang_punkte_mit_aufgaben($pdo, $rundgangId, $s->fetchAll(PDO::FETCH_ASSOC));
    }
    $s = $pdo->prepare(
        'SELECT k.* FROM kontrollpunkt k
          WHERE k.objekt_id = ? AND k.aktiv = 1
            AND NOT EXISTS (
              SELECT 1 FROM rundgang_scan s
               WHERE s.rundgang_id = ? AND s.kontrollpunkt_id = k.id
            )
          ORDER BY k.reihenfolge, k.id'
    );
    $s->execute([$objektId, $rundgangId]);
    return rundgang_punkte_mit_aufgaben($pdo, $rundgangId, $s->fetchAll(PDO::FETCH_ASSOC));
}

// Ist eine "bestaetigt"-Meldung fuer diesen Kontrollpunkt plausibel? NFC
// verlangt die passende Chip-ID, Geofence verlangt eine Position innerhalb
// des Radius. Eine Sperre gehoert in den Server, nicht nur in die
// Oberflaeche (ENT-145: am echten System liess sich ein rein
// client-seitig kontrollierter Start sonst von jedem beliebigen Ort aus
// ausloesen).
// Gibt eine Fehlermeldung zurueck, oder null wenn plausibel.
function rundgang_scan_pruefen(array $kontrollpunkt, ?string $chipId, ?float $lat, ?float $lng): ?string
{
    if ($kontrollpunkt['typ'] === 'nfc') {
        if ($chipId === null || $chipId === '' || $chipId !== $kontrollpunkt['chip_id']) {
            return 'Chip-ID stimmt nicht mit diesem Kontrollpunkt ueberein.';
        }
        return null;
    }
    // geofence
    if ($lat === null || $lng === null) {
        return 'Standort fehlt.';
    }
    $distanz = geo_distanz_meter($lat, $lng, (float)$kontrollpunkt['lat'], (float)$kontrollpunkt['lng']);
    if ($distanz > (float)$kontrollpunkt['geofence_radius_m']) {
        return 'Ausserhalb des Kontrollpunkt-Bereichs (' . round($distanz) . 'm entfernt).';
    }
    return null;
}

// Pflichtgruende beim Abbruch (ENT-146 Punkt 2) -- die vier bei Coredinate
// beobachteten Kategorien, vom Projektinhaber am 2026-08-27 als ausreichend
// bestaetigt (keine eigenen CUPI24-Kategorien noetig). Eine Stelle fuer den
// Endpunkt UND jede Pruefung, damit sich die Liste nie an zwei Orten
// auseinanderentwickelt.
const RUNDGANG_ABBRUCH_GRUENDE = [
    'stelle_nicht_gefunden' => 'Stelle nicht gefunden',
    'nicht_genug_zeit'      => 'Nicht genug Zeit',
    'notfall_gebunden'      => 'Durch Notfall anderweitig gebunden',
    'sonstige'              => 'Sonstige Gruende',
];

// Toleranz am Rand des Ausfuehrungsfensters (ENT-279, Vorgabe Projektinhaber
// nach Rueckfrage): eine Abweichung bis zu 5 Minuten ist noch kein
// Ausnahmefall und verlangt keinen Grund.
const RUNDGANG_FENSTER_TOLERANZ_MIN = 5;

// Gruende fuer einen Rundgang-Start ausserhalb des konfigurierten Fensters
// (ENT-279) -- eigene, kleinere Liste als RUNDGANG_ABBRUCH_GRUENDE oben:
// andere Situation (Start vorverlegt/verspaetet wegen Umdisposition, nicht
// abgebrochen). Erster Eintrag ist das eigene Beispiel des Projektinhabers.
const RUNDGANG_AUSSERHALB_FENSTER_GRUENDE = [
    'planer_freigabe'            => 'Freigabe durch Planer',
    'kurzfristige_umdisposition' => 'Kurzfristige Umdisposition',
    'kundenwunsch'               => 'Wunsch des Kunden',
    'sonstige'                   => 'Sonstige Gruende',
];

// Liegt eine Uhrzeit (HH:MM oder HH:MM:SS) innerhalb eines Fensters, das auch
// ueber Mitternacht gehen kann (ENT-279)? $toleranzMin gilt auf BEIDEN Seiten
// des Fensters -- eine minimale Verspaetung oder ein minimaler Vorlauf soll
// keinen Grund verlangen. Kein Fenster konfiguriert (eines der beiden Felder
// NULL) heisst: diese Funktion schraenkt nichts ein, gibt also true zurueck.
function rundgang_im_fenster(string $jetztHm, ?string $fensterVonHm, ?string $fensterBisHm, int $toleranzMin): bool
{
    if ($fensterVonHm === null || $fensterBisHm === null) {
        return true;
    }
    $min = static function (string $hm): int {
        return ((int)substr($hm, 0, 2)) * 60 + ((int)substr($hm, 3, 2));
    };
    $jetzt = $min($jetztHm);
    $von = $min($fensterVonHm) - $toleranzMin;
    $bis = $min($fensterBisHm) + $toleranzMin;
    // Fenster geht ueber Mitternacht (z. B. 23:00-01:00): $bis liegt nach der
    // Toleranz-Korrektur rechnerisch VOR $von -- dann gehoert es zum
    // naechsten Tag.
    if ($bis <= $von) { $bis += 1440; }
    // "jetzt" liegt vor Mitternacht, das Fenster reicht aber in den
    // naechsten Tag hinein (z. B. jetzt = 00:30, Fenster 23:00-01:00).
    if ($jetzt < $von) { $jetzt += 1440; }
    return $jetzt >= $von && $jetzt <= $bis;
}

// Fortschritt eines Rundgangs fuer die Uebersicht der Einsatzleitung
// (ENT-183): wie viele aktuell aktive Kontrollpunkte das Objekt hat, und wie
// viele davon in DIESEM Rundgang bestaetigt bzw. als nicht verfuegbar
// gemeldet wurden. "Aktuell aktive" heisst bewusst: wird ein Punkt spaeter
// aus der Vorlage entfernt, sinkt "gesamt" nachtraeglich fuer alte
// Rundgaenge -- das ist die gleiche Abwaegung wie bei kontrollpunkt_id
// ON DELETE SET NULL in rundgang_scan: die Vorlage von heute, nicht die von
// damals.
//
// $vorlageId (ENT-204): wurde beim Rundgang eine Kontrollrunde gewaehlt,
// zaehlt "gesamt" nur deren Punkte -- sonst wuerde ein Rundgang ueber eine
// kleine Runde (z.B. "Oeffnungsrunde", 1 Punkt) faelschlich gegen ALLE
// Punkte des Objekts gezaehlt und saehe nach einer unvollstaendigen Runde
// aus, obwohl er vollstaendig war.
function rundgang_fortschritt(PDO $pdo, int $rundgangId, int $objektId, ?int $vorlageId = null): array
{
    if ($vorlageId !== null) {
        $gesamtStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM kontrollpunkt k
              JOIN rundgang_vorlage_punkt p ON p.kontrollpunkt_id = k.id AND p.vorlage_id = ?
              WHERE k.objekt_id = ? AND k.aktiv = 1'
        );
        $gesamtStmt->execute([$vorlageId, $objektId]);
    } else {
        $gesamtStmt = $pdo->prepare('SELECT COUNT(*) FROM kontrollpunkt WHERE objekt_id = ? AND aktiv = 1');
        $gesamtStmt->execute([$objektId]);
    }
    $gesamt = (int)$gesamtStmt->fetchColumn();

    $s = $pdo->prepare('SELECT status, COUNT(*) AS n FROM rundgang_scan WHERE rundgang_id = ? GROUP BY status');
    $s->execute([$rundgangId]);
    $zaehler = [];
    foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $zaehler[(string)$z['status']] = (int)$z['n'];
    }
    return rundgang_fortschritt_werte($gesamt, $zaehler);
}

/* Aus "wie viele Punkte gibt es" und "wie viele Scans welcher Art" die
   Fortschrittszahlen bauen. Eigene, reine Funktion, damit die Einzel- und
   die Sammelfassung darunter NICHT zwei Rechnungen sind: Zwei Stellen, die
   dasselbe ausrechnen, laufen frueher oder spaeter auseinander -- und dann
   zeigt die Liste einen anderen Fortschritt als die Einzelansicht derselben
   Runde, ohne dass jemand sagen kann warum. */
function rundgang_fortschritt_werte(int $gesamt, array $zaehler): array
{
    $bestaetigt      = (int)($zaehler['bestaetigt'] ?? 0);
    $nichtVerfuegbar = (int)($zaehler['nicht_verfuegbar'] ?? 0);
    // Ersatzscan (Q-22): zaehlt separat, nicht einfach zu "bestaetigt"
    // dazu -- sonst waere ein Foto-Beleg von einem echten NFC-/Geofence-
    // Scan nicht mehr unterscheidbar (Einheiten nie vermischen).
    $ersatzscan      = (int)($zaehler['ersatzscan'] ?? 0);
    /* 'erledigt' fasst zusammen, was als KONTROLLIERT gilt (ENT-329):
       bestaetigt + ersatzscan. Ein Ersatzscan ist ein Fotobeleg statt einer
       technischen Prüfung -- der Punkt wurde aufgesucht, nur liess er sich
       nicht per NFC/Geofence bestätigen (Chip zerstört, kein Netz).

       'nicht_verfuegbar' zählt bewusst NICHT mit: Dort wurde der Punkt gar
       nicht erreicht. Das ist der Unterschied, auf den es ankommt.

       Die Einzelzahlen bleiben daneben stehen und werden NICHT ersetzt --
       die Begründung aus ENT-145/Q-22 gilt für die Datenhaltung unverändert
       weiter: Ein Fotobeleg muss von einem echten NFC-/Geofence-Scan
       unterscheidbar bleiben. Geändert hat sich nur, was die Anzeige als
       'erledigt' zusammenfasst -- und sie weist den Ersatzscan sichtbar aus,
       statt ihn unter 'bestätigt' verschwinden zu lassen. */
    return ['gesamt' => $gesamt, 'bestaetigt' => $bestaetigt, 'nicht_verfuegbar' => $nichtVerfuegbar,
            'ersatzscan' => $ersatzscan, 'erledigt' => $bestaetigt + $ersatzscan];
}

/* Derselbe Fortschritt fuer VIELE Runden auf einmal (Lasttest 09.09.2026).

   Anlass: rundgang_liste.php rief rundgang_fortschritt() in einer Schleife
   ueber alle gefundenen Runden auf -- zwei Abfragen je Zeile. Gemessen 371
   Abfragen fuer einen einzigen Tag und 2 451 fuer einen Monat; auf ein Jahr
   hochgerechnet waeren es rund 150 000 fuer EINEN Seitenaufruf.

   Hier sind es drei Abfragen, egal wie viele Runden es sind: die Scans, die
   Punktzahl je Vorlage und die Punktzahl je Objekt. Gerechnet wird danach
   mit derselben Funktion wie oben.

   $runden: Liste von ['id' => int, 'objekt_id' => int, 'vorlage_id' => ?int].
   Zurueck kommt eine Zuordnung rundgang_id => Fortschritt. */
function rundgang_fortschritt_viele(PDO $pdo, array $runden): array
{
    if (!$runden) { return []; }

    $ids       = [];
    $vorlagen  = [];   // [vorlage_id, objekt_id] -- die Paare, die vorkommen
    $objekte   = [];   // Objekte OHNE Vorlage
    foreach ($runden as $r) {
        $ids[] = (int)$r['id'];
        if ($r['vorlage_id'] !== null) {
            $vorlagen[(int)$r['vorlage_id']] = true;
        } else {
            $objekte[(int)$r['objekt_id']] = true;
        }
    }

    // ── 1. Scans je Runde und Art
    $marken = implode(',', array_fill(0, count($ids), '?'));
    $s = $pdo->prepare(
        "SELECT rundgang_id, status, COUNT(*) AS n
           FROM rundgang_scan WHERE rundgang_id IN ($marken)
          GROUP BY rundgang_id, status"
    );
    $s->execute($ids);
    $scans = [];
    foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $scans[(int)$z['rundgang_id']][(string)$z['status']] = (int)$z['n'];
    }

    // ── 2. Punktzahl je Vorlage. Nach Vorlage UND Objekt gruppiert, weil die
    // Einzelfassung oben beides verlangt (k.objekt_id = ?) -- ein Punkt einer
    // fremden Vorlage zaehlt dort nicht mit, und das soll hier genauso sein.
    $proVorlage = [];
    if ($vorlagen) {
        $vids = array_keys($vorlagen);
        $m = implode(',', array_fill(0, count($vids), '?'));
        $v = $pdo->prepare(
            "SELECT p.vorlage_id, k.objekt_id, COUNT(*) AS n
               FROM kontrollpunkt k
               JOIN rundgang_vorlage_punkt p ON p.kontrollpunkt_id = k.id
              WHERE p.vorlage_id IN ($m) AND k.aktiv = 1
              GROUP BY p.vorlage_id, k.objekt_id"
        );
        $v->execute($vids);
        foreach ($v->fetchAll(PDO::FETCH_ASSOC) as $z) {
            $proVorlage[(int)$z['vorlage_id'] . ':' . (int)$z['objekt_id']] = (int)$z['n'];
        }
    }

    // ── 3. Punktzahl je Objekt, fuer Runden ohne Vorlage
    $proObjekt = [];
    if ($objekte) {
        $oids = array_keys($objekte);
        $m = implode(',', array_fill(0, count($oids), '?'));
        $o = $pdo->prepare(
            "SELECT objekt_id, COUNT(*) AS n FROM kontrollpunkt
              WHERE objekt_id IN ($m) AND aktiv = 1 GROUP BY objekt_id"
        );
        $o->execute($oids);
        foreach ($o->fetchAll(PDO::FETCH_ASSOC) as $z) {
            $proObjekt[(int)$z['objekt_id']] = (int)$z['n'];
        }
    }

    $aus = [];
    foreach ($runden as $r) {
        $id   = (int)$r['id'];
        $obj  = (int)$r['objekt_id'];
        $vid  = $r['vorlage_id'] !== null ? (int)$r['vorlage_id'] : null;
        // Kein Eintrag heisst null Punkte -- genau das liefert COUNT(*) in
        // der Einzelfassung, wenn nichts passt.
        $gesamt = $vid !== null
            ? ($proVorlage[$vid . ':' . $obj] ?? 0)
            : ($proObjekt[$obj] ?? 0);
        $aus[$id] = rundgang_fortschritt_werte($gesamt, $scans[$id] ?? []);
    }
    return $aus;
}

// Erkennt JPEG/PNG anhand der Magic Bytes, nicht anhand einer vom Client
// gemeldeten Endung oder eines MIME-Typs -- beides laesst sich frei setzen
// (gleiches Prinzip wie bei einsatz_dokument.php, dort fuer PDF). Gibt den
// tatsaechlichen MIME-Typ zurueck, oder null wenn keins von beiden passt.
function ersatzscan_foto_mime(string $roh): ?string
{
    if (str_starts_with($roh, "\xFF\xD8\xFF")) { return 'image/jpeg'; }
    if (str_starts_with($roh, "\x89PNG\r\n\x1a\n")) { return 'image/png'; }
    return null;
}

// Ersetzt die komplette Punktzuordnung einer Kontrollrunden-Vorlage in einem
// Zug (ENT-204) -- der Aufrufer schickt die vollstaendige, geordnete Liste,
// kein einzelnes Hinzufuegen/Entfernen. Einfacher und weniger fehleranfaellig
// als inkrementelle Endpunkte, gleiches Vorgehen wie an anderen Stellen des
// Hauses (z.B. zuteilung_masse.php).
//
// Prueft serverseitig, dass jeder Punkt tatsaechlich zum Objekt der Vorlage
// gehoert -- sonst liesse sich ueber die API ein Punkt eines fremden Objekts
// in eine Runde mischen (Sperren gehoeren in den Server, nicht nur in die
// Oberflaeche). Gibt eine Fehlermeldung zurueck, oder null bei Erfolg.
function rundgang_vorlage_punkte_setzen(PDO $pdo, int $vorlageId, array $kontrollpunktIds): ?string
{
    $vorlageStmt = $pdo->prepare('SELECT objekt_id FROM rundgang_vorlage WHERE id = ?');
    $vorlageStmt->execute([$vorlageId]);
    $objektId = $vorlageStmt->fetchColumn();
    if ($objektId === false) {
        return 'Vorlage nicht gefunden.';
    }

    $ids = array_map('intval', $kontrollpunktIds);
    if (count(array_unique($ids)) !== count($ids)) {
        return 'Ein Kontrollpunkt wurde mehrfach angegeben.';
    }

    if ($ids) {
        $platzhalter = implode(',', array_fill(0, count($ids), '?'));
        $chk = $pdo->prepare("SELECT COUNT(*) FROM kontrollpunkt WHERE id IN ($platzhalter) AND objekt_id = ?");
        $chk->execute([...$ids, $objektId]);
        if ((int)$chk->fetchColumn() !== count($ids)) {
            return 'Mindestens ein Kontrollpunkt gehoert nicht zu diesem Objekt.';
        }
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM rundgang_vorlage_punkt WHERE vorlage_id = ?')->execute([$vorlageId]);
        $ins = $pdo->prepare(
            'INSERT INTO rundgang_vorlage_punkt (vorlage_id, kontrollpunkt_id, reihenfolge) VALUES (?, ?, ?)'
        );
        foreach ($ids as $i => $kpId) {
            $ins->execute([$vorlageId, $kpId, $i]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    return null;
}

/* ══════════ DAUER EINER RUNDE (ENT-322) ══════════════════════════════════

   Warum das eine eigene Funktion ist und nicht drei Zeilen im Endpunkt:

   Die Endzeit einer Runde hat DREI Quellen, und sie sind nicht gleich gut.
   Die App rechnet seit ENT-321 nach genau derselben Reihenfolge
   (rgLaufEndeMs() in app.html), weil der Projektinhaber im Feld erlebt hat,
   dass eine abgeschlossene Runde weiterzaehlte. Stuende die Regel hier ein
   zweites Mal in eigenen Worten, zeigte die Liste im Dashboard frueher oder
   spaeter eine andere Dauer als das Handy fuer dieselbe Runde -- und beide
   waeren "richtig".

     1. rohzeit_ende      Der Server hat das Ende selbst vermerkt. Gilt.
     2. letzter Scan      Kein Ende vermerkt, aber die Runde ist beendet --
                          dann ist der letzte angekommene Scan das, was
                          nachweisbar geschehen ist.
     3. gar nichts        Laeuft noch, oder es fehlt der Start.

   Die Pause wird abgezogen: Sie ist gestoppte Zeit, keine Rundenzeit.
   Ein negativer Wert wird auf 0 geklemmt statt weitergereicht -- eine
   Dauer von "-4 Minuten" ist keine Aussage, sondern ein kaputter
   Datensatz, und die Anzeige soll ihn nicht als Zahl adeln.

   Reine Funktion, kein PDO: Genau darum laesst sie sich pruefen. */
const RUNDGANG_OFFENE_STATUS = ['vorbereitet', 'laeuft', 'pausiert'];

function rundgang_dauer(?string $start, ?string $ende, ?string $letzterScan,
                        int $pauseMinuten, string $status): array
{
    $start = trim((string)$start);
    $ende = trim((string)$ende);
    $letzterScan = trim((string)$letzterScan);
    $laeuft = in_array($status, RUNDGANG_OFFENE_STATUS, true);

    if ($start === '') {
        return ['sekunden' => null, 'quelle' => $laeuft ? 'laeuft' : 'unbekannt'];
    }

    // Bei einer laufenden Runde wird der letzte Scan NICHT als Ende genommen:
    // Sie ist nicht fertig, nur weil gerade nichts Neues ankam.
    $bis = $ende !== '' ? $ende : ($laeuft ? '' : $letzterScan);
    if ($bis === '') {
        return ['sekunden' => null, 'quelle' => $laeuft ? 'laeuft' : 'unbekannt'];
    }

    $vonTs = strtotime($start);
    $bisTs = strtotime($bis);
    if ($vonTs === false || $bisTs === false) {
        return ['sekunden' => null, 'quelle' => 'unbekannt'];
    }

    $sek = $bisTs - $vonTs - max(0, $pauseMinuten) * 60;
    return ['sekunden' => max(0, $sek), 'quelle' => $ende !== '' ? 'rohzeit_ende' : 'letzter_scan'];
}

/* Die Kontrollpunkte, die zu EINER Runde gehoeren (ENT-322).

   Wortgleich aus mein_rundgang_offen.php hierher gezogen, damit es die
   Vorlage-oder-Objekt-Weiche nur einmal gibt. Sie stand vorher an zwei
   Stellen; mit der Detailansicht waere sie an drei gestanden, und eine
   Runde ueber eine kleine Kontrollrunde saehe je nach Ansicht anders aus.

   "Aktuell aktiv" ist bewusst dieselbe Abwaegung wie in
   rundgang_fortschritt(): die Vorlage von heute, nicht die von damals. */
function rundgang_punkte_der_runde(PDO $pdo, int $objektId, ?int $vorlageId): array
{
    if ($vorlageId !== null) {
        $stmt = $pdo->prepare(
            'SELECT k.id, k.bezeichnung, p.reihenfolge, k.typ, k.lat, k.lng, k.geofence_radius_m
               FROM kontrollpunkt k
               JOIN rundgang_vorlage_punkt p ON p.kontrollpunkt_id = k.id AND p.vorlage_id = ?
              WHERE k.objekt_id = ? AND k.aktiv = 1 ORDER BY p.reihenfolge, k.id'
        );
        $stmt->execute([$vorlageId, $objektId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    $stmt = $pdo->prepare(
        'SELECT id, bezeichnung, reihenfolge, typ, lat, lng, geofence_radius_m
           FROM kontrollpunkt WHERE objekt_id = ? AND aktiv = 1 ORDER BY reihenfolge, id'
    );
    $stmt->execute([$objektId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/* ══ WACHBUCH (ENT-480) ═══════════════════════════════════════════════
   Eine chronologische Chronik dessen, was im Revierdienst tatsaechlich
   geschehen ist: Kontrollpunkt erfasst, Rundgang erledigt oder
   abgebrochen, Aufgabe beantwortet, Ereignis gemeldet.

   KEIN neuer Datenbestand -- alle vier Arten liegen bereits vor. Das
   Wachbuch fuehrt sie zusammen und sortiert sie nach der Zeit; es
   schreibt nichts und rechnet nichts. Damit ist es genau das, was das
   Projektprotokoll (revierdienst-tool-kernfrage.md, Abschnitt 8) als
   Wachbuch beschrieben hat: "kein neuer Datentyp ... eine zweite,
   umfassendere Ansicht derselben Basis".

   Warum hier und nicht im Endpunkt: Der Endpunkt kann nur gegen einen
   echten Server laufen. Diese Funktion laeuft in pruef_wachbuch.php gegen
   eine wirkliche Datenbank -- eine Zusammenfuehrung aus vier Quellen mit
   Sortierung und Kappung ist genau die Art Logik, die man nicht am
   Bildschirm nachsieht, sondern ausfuehrt.

   Alle vier Quellen haengen am selben Recht ('rundgaenge'); der Endpunkt
   prueft es EINMAL. Faehrt hier je eine fuenfte Quelle mit einem anderen
   Recht dazu, saehe dieselbe Liste fuer zwei Personen verschieden aus,
   ohne es zu sagen -- darum bleiben Fahrzeug-Uebernahmen (Recht
   'fahrzeuge') bewusst draussen; sie haben ihren eigenen Reiter.

   NICHT enthalten: unbeantwortete Aufgaben (ENT-311). Eine unbeantwortete
   Aufgabe ist das FEHLEN eines Eintrags und hat darum keinen eigenen
   Zeitpunkt. Sie in eine Zeitleiste zu stellen hiesse, ihr einen zu
   erfinden. Sichtbar bleibt sie im Reiter "Kontrollpunktscans", der sie
   an ihren Scan bindet. */
const WACHBUCH_GRENZE = 400;

/* Die vier Arten, in der Reihenfolge, in der sie bei gleicher Sekunde
   stehen sollen: Der Rundgang schliesst ab, was die Scans davor getan
   haben -- er gehoert darum ueber sie, nicht darunter. Ohne diese feste
   Ordnung wechselte die Reihenfolge zweier gleichzeitiger Eintraege von
   Abfrage zu Abfrage, und dieselbe Nacht saehe zweimal anders aus. */
const WACHBUCH_RANG = ['rundgang' => 3, 'ereignis' => 2, 'aufgabe' => 1, 'scan' => 0];

/* Ein Zeitpunkt fuer die Runde, aus drei Quellen in fester Reihenfolge
   (gleiche Dreier-Regel wie rundgang_dauer(), ENT-321): abgebrochen_am
   gilt nur beim Abbruch, rohzeit_ende beim regulaeren Ende, und wo der
   Server keines von beiden gesetzt hat, ist der letzte Scan das, was
   zuletzt nachweislich geschah. Eine Runde ohne alle drei hat keinen
   Zeitpunkt und kann in einer Zeitleiste nicht stehen -- ihr einen zu
   erfinden waere schlimmer, als sie wegzulassen. */
const WACHBUCH_RUNDE_ZEIT =
    'COALESCE(r.abgebrochen_am, r.rohzeit_ende,
              (SELECT MAX(sz.erfasst_am) FROM rundgang_scan sz WHERE sz.rundgang_id = r.id))';

/* Person als "Nachname, Vorname" -- dieselbe Schreibweise wie in der
   Scan-Auswertung. Leer bleibt sie nie: Ein Eintrag ohne Namen ist ein
   Nachweis ohne Urheber, und "-" sagt das, statt es zu verschweigen. */
function wachbuch_person(array $z): string
{
    $n = trim(implode(', ', array_filter([
        trim((string)($z['nachname'] ?? '')), trim((string)($z['vorname'] ?? '')),
    ], static fn($t) => $t !== '')));
    return $n !== '' ? $n : '–';
}

/* Die Angaben, die jeder Eintrag traegt, ganz gleich aus welcher Quelle:
   wohin die drei Verweise fuehren (Kunde, Objekt, Rundgang) und wer es
   war. Einmal hier statt viermal unten -- vier Schreibweisen derselben
   Zuordnung waeren vier Gelegenheiten, eine davon zu vergessen. */
function wachbuch_rahmen(array $z): array
{
    return [
        'kunde_id'       => isset($z['kunde_id']) && $z['kunde_id'] !== null ? (int)$z['kunde_id'] : null,
        'kunde_name'     => $z['kunde_name'] ?? null,
        'objekt_id'      => isset($z['objekt_id']) && $z['objekt_id'] !== null ? (int)$z['objekt_id'] : null,
        'objekt_name'    => $z['objekt_name'] ?? null,
        'rundgang_id'    => isset($z['rundgang_id']) && $z['rundgang_id'] !== null ? (int)$z['rundgang_id'] : null,
        'rundgang_name'  => $z['rundgang_name'] ?? null,
        'fenster_von'    => $z['fenster_von'] ?? null,
        'fenster_bis'    => $z['fenster_bis'] ?? null,
        'einsatz_id'     => isset($z['einsatz_id']) && $z['einsatz_id'] !== null ? (int)$z['einsatz_id'] : null,
        'einsatz_titel'  => $z['einsatz_titel'] ?? null,
        'person'         => wachbuch_person($z),
    ];
}

/* Eine Quelle abfragen: zaehlen, dann die neuesten holen.

   Gezaehlt wird SEPARAT und nicht aus der Menge der geholten Zeilen: Wird
   gekappt, ist "400 von 1238" eine Aussage, "400" allein sieht aus wie
   die Gesamtzahl. Genau der Fall, vor dem die Hausregel warnt -- keine
   Zahl ohne Bezug, sobald etwas greift.

   Bricht eine Quelle weg (fehlende Spalte nach einem halben Einrichten),
   faellt nicht das ganze Wachbuch aus. Der Aufrufer erfaehrt es ueber
   'quellen' und sagt es weiter -- eine luecken­hafte Liste, die aussieht
   wie eine vollstaendige, ist schlimmer als gar keine. */
function wachbuch_quelle(PDO $pdo, string $sql, string $zaehlSql, array $werte,
                        int $grenze, bool $holen = true): ?array
{
    try {
        $z = $pdo->prepare($zaehlSql);
        $z->execute($werte);
        $anzahl = (int)$z->fetchColumn();
        // Gezaehlt wird IMMER, geholt nur, was der Filter durchlaesst. Sonst
        // stuende neben einem gesetzten Filter keine Zahl mehr fuer das, was
        // er ausblendet -- und ein Filter, der alles ausblendet, saehe aus
        // wie "nichts vorhanden".
        if (!$holen) { return ['anzahl' => $anzahl, 'zeilen' => []]; }
        $s = $pdo->prepare($sql . ' LIMIT ' . (int)($grenze + 1));
        $s->execute($werte);
        return ['anzahl' => $anzahl, 'zeilen' => $s->fetchAll(PDO::FETCH_ASSOC)];
    } catch (Throwable $e) {
        return null;
    }
}

/* $objekte: null = kein Zuschnitt, eine Zahl = ein Objekt, ein Feld =
   mehrere. Die Liste braucht das Kundenportal (ENT-484): Dort ist der
   Zuschnitt nicht EIN Objekt, sondern alles, was dem angemeldeten Kunden
   gehoert -- und nichts sonst.

   $optionen kennt zwei Schalter, beide fuer das Portal, beide bewusst
   einzeln benannt statt hinter einem Wort "portal" versteckt:

     'nur_beendete_runden'      -- Vorgaenge einer noch laufenden Runde
                                   bleiben draussen. Ein Kunde soll den
                                   Nachweis sehen, nicht die Person bei der
                                   Arbeit (ENT-441 Punkt 5). Im Cockpit gilt
                                   das NICHT: Die Einsatzleitung soll gerade
                                   sehen, was gerade laeuft.
     'nur_ereignisse_mit_runde' -- nur Meldungen, die an einer Runde
                                   haengen. Meldungen ausserhalb einer Runde
                                   hat ein Kunde noch nie gesehen; sie hier
                                   mitzuliefern waere ein neuer Datenfluss
                                   und keine Darstellungsfrage. */
function wachbuch_eintraege(PDO $pdo, string $von, string $bis,
                            $objekte = null, int $grenze = WACHBUCH_GRENZE,
                            ?array $arten = null, array $optionen = []): array
{
    $abVon = $von . ' 00:00:00';
    $bisEnde = $bis . ' 23:59:59';
    $objektIds = $objekte === null ? null
        : array_values(array_map('intval', is_array($objekte) ? $objekte : [$objekte]));
    // Eine LEERE Liste ist etwas anderes als gar kein Zuschnitt: Sie heisst
    // „dieser Zugang hat kein einziges Objekt" und muss NICHTS liefern. Ohne
    // diese Unterscheidung ergaebe ein leeres Feld eine Abfrage ohne
    // Einschraenkung -- ein Kundenzugang ohne Objekte saehe die Chronik
    // aller. Das ist keine Randbedingung, das ist die Grenze selbst.
    if ($objektIds !== null && !$objektIds) {
        return ['eintraege' => [], 'gezeigt' => 0, 'gesamt' => 0, 'gekuerzt' => false,
                'grenze' => $grenze, 'je_art' => [], 'quellen' => []];
    }
    $nurBeendet = !empty($optionen['nur_beendete_runden']);
    $nurEreignisMitRunde = !empty($optionen['nur_ereignisse_mit_runde']);
    // Ein leeres Filterfeld heisst "alles", nicht "nichts": Wer keine Art
    // waehlt, will die ganze Chronik, nicht eine leere Seite.
    $will = static function (string $art) use ($arten): bool {
        return $arten === null || $arten === [] || in_array($art, $arten, true);
    };
    $eintraege = [];
    $gesamt = 0;
    // Je Art die WIRKLICHE Zahl im Zeitraum -- auch fuer eine Art, die der
    // Filter gerade ausblendet. Ohne sie liesse sich nicht sagen, ob hinter
    // einem gesetzten Filter noch etwas liegt.
    $jeArt = [];
    // Drei verschiedene Aussagen je Quelle, nie dieselbe: vorhanden und
    // abgefragt / gar nicht eingerichtet / eingerichtet, aber nicht
    // abfragbar. "Unbekannt" darf nie wie "keine" aussehen.
    $quellen = [];

    /* Der gemeinsame Zusatz zur WHERE-Bedingung: Objektzuschnitt und, wo
       verlangt, die Beschraenkung auf beendete Runden. Text UND Werte kommen
       aus DERSELBEN Funktion und in derselben Reihenfolge -- getrennt
       gepflegt liefen sie irgendwann auseinander, und eine verschobene
       Reihenfolge der Platzhalter ist der Fehler, den niemand sieht: Die
       Abfrage laeuft, sie filtert nur nach dem Falschen.

       $rundgangAlias ist null, wo die Quelle ohnehin nur beendete Runden
       kennt (die Runden selbst) oder wo die Runde nur per LEFT JOIN
       danebensteht (Ereignisse) -- dort wuerde die Bedingung jede Zeile
       ohne Runde stillschweigend mitloeschen. */
    $zusatz = static function (string $objektAlias, ?string $rundgangAlias)
            use ($objektIds, $nurBeendet): array {
        $wo = ''; $werte = [];
        if ($objektIds !== null) {
            $wo .= " AND $objektAlias.objekt_id IN ("
                . implode(',', array_fill(0, count($objektIds), '?')) . ')';
            $werte = array_merge($werte, $objektIds);
        }
        if ($nurBeendet && $rundgangAlias !== null) {
            $wo .= " AND $rundgangAlias.status NOT IN ("
                . implode(',', array_fill(0, count(RUNDGANG_OFFENE_STATUS), '?')) . ')';
            $werte = array_merge($werte, RUNDGANG_OFFENE_STATUS);
        }
        return [$wo, $werte];
    };

    // ── 1. Kontrollpunkt erfasst ──────────────────────────────────────
    if (!hat_tabelle($pdo, 'rundgang_scan')) {
        $quellen['scans'] = 'fehlt';
    } else {
        $foto = hat_spalte($pdo, 'rundgang_scan', 'foto_mime') ? 's.foto_mime' : 'NULL';
        [$zWo, $zWerte] = $zusatz('r', 'r');
        $rumpf = "FROM rundgang_scan s
                  JOIN rundgang r ON r.id = s.rundgang_id
                  JOIN einsaetze e ON e.id = r.einsatz_id
                  JOIN objekte o ON o.id = r.objekt_id
                  JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
                  LEFT JOIN kontrollpunkt k ON k.id = s.kontrollpunkt_id
                  LEFT JOIN rundgang_vorlage rv ON rv.id = r.rundgang_vorlage_id
                 WHERE s.erfasst_am >= ? AND s.erfasst_am <= ?" . $zWo;
        $t = wachbuch_quelle($pdo,
            "SELECT s.id, s.erfasst_am AS zeit, s.uebermittelt_am, s.status, s.beschreibung,
                    s.kontrollpunkt_id, k.bezeichnung AS punkt_name, $foto AS foto_mime,
                    r.id AS rundgang_id, rv.name AS rundgang_name,
                    rv.fenster_von, rv.fenster_bis,
                    o.id AS objekt_id, o.name AS objekt_name,
                    e.id AS einsatz_id, e.titel AS einsatz_titel,
                    COALESCE(e.kunde_id, o.kunde_id) AS kunde_id,
                    COALESCE(e.kunde_name, o.kunde_name) AS kunde_name,
                    m.vorname, m.nachname
             $rumpf ORDER BY s.erfasst_am DESC, s.id DESC",
            "SELECT COUNT(*) $rumpf", array_merge([$abVon, $bisEnde], $zWerte), $grenze, $will('scan'));
        if ($t === null) { $quellen['scans'] = 'fehler'; } else {
            $quellen['scans'] = 'ok';
            $jeArt['scan'] = $t['anzahl'];
            if ($will('scan')) { $gesamt += $t['anzahl']; }
            foreach ($t['zeilen'] as $z) {
                $eintraege[] = wachbuch_rahmen($z) + [
                    'art'             => 'scan',
                    'id'              => 'scan-' . (int)$z['id'],
                    'zeit'            => $z['zeit'],
                    'uebermittelt_am' => $z['uebermittelt_am'],
                    'status'          => $z['status'],
                    // Ein Scan auf einen inzwischen entfernten Kontrollpunkt
                    // behaelt seinen Nachweiswert -- der Punkt fehlt, die
                    // Durchfuehrung nicht. Der Text sagt genau das.
                    'punkt_name'      => $z['punkt_name'],
                    'punkt_id'        => $z['kontrollpunkt_id'] !== null ? (int)$z['kontrollpunkt_id'] : null,
                    'text'            => $z['beschreibung'],
                    'hat_foto'        => $z['foto_mime'] !== null,
                ];
            }
        }
    }

    // ── 2. Rundgang erledigt oder abgebrochen ─────────────────────────
    if (!hat_tabelle($pdo, 'rundgang')) {
        $quellen['runden'] = 'fehlt';
    } else {
        $zeit = WACHBUCH_RUNDE_ZEIT;
        // Kein Rundgang-Alias fuer den Zusatz: Diese Quelle kennt ohnehin nur
        // beendete Runden, eine zweite Statusbedingung waere eine zweite
        // Wahrheit ueber denselben Sachverhalt.
        [$zWo, $zWerte] = $zusatz('r', null);
        $rumpf = "FROM rundgang r
                  JOIN einsaetze e ON e.id = r.einsatz_id
                  JOIN objekte o ON o.id = r.objekt_id
                  JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
                  LEFT JOIN rundgang_vorlage rv ON rv.id = r.rundgang_vorlage_id
                 WHERE r.status IN ('abgeschlossen', 'abgebrochen')
                   AND $zeit >= ? AND $zeit <= ?" . $zWo;
        $t = wachbuch_quelle($pdo,
            "SELECT r.id, $zeit AS zeit, r.status, r.rohzeit_start, r.rohzeit_ende,
                    r.pause_minuten, r.abbruch_grund, r.abbruch_freitext,
                    (SELECT COUNT(*) FROM rundgang_scan sc WHERE sc.rundgang_id = r.id) AS scans_anzahl,
                    r.id AS rundgang_id, rv.name AS rundgang_name,
                    rv.fenster_von, rv.fenster_bis,
                    o.id AS objekt_id, o.name AS objekt_name,
                    e.id AS einsatz_id, e.titel AS einsatz_titel,
                    COALESCE(e.kunde_id, o.kunde_id) AS kunde_id,
                    COALESCE(e.kunde_name, o.kunde_name) AS kunde_name,
                    m.vorname, m.nachname
             $rumpf ORDER BY zeit DESC, r.id DESC",
            "SELECT COUNT(*) $rumpf", array_merge([$abVon, $bisEnde], $zWerte), $grenze, $will('rundgang'));
        if ($t === null) { $quellen['runden'] = 'fehler'; } else {
            $quellen['runden'] = 'ok';
            $jeArt['rundgang'] = $t['anzahl'];
            if ($will('rundgang')) { $gesamt += $t['anzahl']; }
            foreach ($t['zeilen'] as $z) {
                $eintraege[] = wachbuch_rahmen($z) + [
                    'art'             => 'rundgang',
                    'id'              => 'rundgang-' . (int)$z['id'],
                    'zeit'            => $z['zeit'],
                    'uebermittelt_am' => null,
                    'status'          => $z['status'],
                    'rohzeit_start'   => $z['rohzeit_start'],
                    'rohzeit_ende'    => $z['rohzeit_ende'],
                    'pause_minuten'   => (int)($z['pause_minuten'] ?? 0),
                    'abbruch_grund'   => $z['abbruch_grund'],
                    // Der Freitext eines Abbruchs steht IM Eintrag, nicht nur
                    // in der Detailansicht: Wer die Nacht durchliest, soll den
                    // Grund sehen, ohne jede abgebrochene Runde einzeln zu
                    // oeffnen.
                    'text'            => $z['abbruch_freitext'],
                    'scans_anzahl'    => (int)($z['scans_anzahl'] ?? 0),
                    'hat_foto'        => false,
                ];
            }
        }
    }

    // ── 3. Aufgabe beantwortet ────────────────────────────────────────
    if (!hat_tabelle($pdo, 'rundgang_aufgabe')) {
        $quellen['aufgaben'] = 'fehlt';
    } else {
        [$zWo, $zWerte] = $zusatz('r', 'r');
        $rumpf = "FROM rundgang_aufgabe ra
                  JOIN rundgang r ON r.id = ra.rundgang_id
                  JOIN einsaetze e ON e.id = r.einsatz_id
                  JOIN objekte o ON o.id = r.objekt_id
                  JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
                  LEFT JOIN kontrollpunkt k ON k.id = ra.kontrollpunkt_id
                  LEFT JOIN rundgang_vorlage rv ON rv.id = r.rundgang_vorlage_id
                 WHERE ra.erfasst_am >= ? AND ra.erfasst_am <= ?" . $zWo;
        $t = wachbuch_quelle($pdo,
            "SELECT ra.id, ra.erfasst_am AS zeit, ra.uebermittelt_am, ra.status,
                    ra.grund, ra.bezeichnung,
                    ra.kontrollpunkt_id, k.bezeichnung AS punkt_name,
                    r.id AS rundgang_id, rv.name AS rundgang_name,
                    rv.fenster_von, rv.fenster_bis,
                    o.id AS objekt_id, o.name AS objekt_name,
                    e.id AS einsatz_id, e.titel AS einsatz_titel,
                    COALESCE(e.kunde_id, o.kunde_id) AS kunde_id,
                    COALESCE(e.kunde_name, o.kunde_name) AS kunde_name,
                    m.vorname, m.nachname
             $rumpf ORDER BY ra.erfasst_am DESC, ra.id DESC",
            "SELECT COUNT(*) $rumpf", array_merge([$abVon, $bisEnde], $zWerte), $grenze, $will('aufgabe'));
        if ($t === null) { $quellen['aufgaben'] = 'fehler'; } else {
            $quellen['aufgaben'] = 'ok';
            $jeArt['aufgabe'] = $t['anzahl'];
            if ($will('aufgabe')) { $gesamt += $t['anzahl']; }
            foreach ($t['zeilen'] as $z) {
                $eintraege[] = wachbuch_rahmen($z) + [
                    'art'             => 'aufgabe',
                    'id'              => 'aufgabe-' . (int)$z['id'],
                    'zeit'            => $z['zeit'],
                    'uebermittelt_am' => $z['uebermittelt_am'],
                    'status'          => $z['status'],
                    // Der Text stammt aus rundgang_aufgabe, NICHT aus dem
                    // Katalog: Er ist im Moment der Erledigung kopiert worden,
                    // und eine spaetere Umbenennung darf den Beleg von letzter
                    // Nacht nicht rueckwirkend aendern.
                    'bezeichnung'     => $z['bezeichnung'],
                    'punkt_name'      => $z['punkt_name'],
                    'punkt_id'        => $z['kontrollpunkt_id'] !== null ? (int)$z['kontrollpunkt_id'] : null,
                    'text'            => $z['grund'],
                    'hat_foto'        => false,
                ];
            }
        }
    }

    // ── 4. Ereignis gemeldet ──────────────────────────────────────────
    if (!hat_tabelle($pdo, 'ereignis_meldung')) {
        $quellen['ereignisse'] = 'fehlt';
    } else {
        // Der Rundgang haengt hier nur per LEFT JOIN daneben -- eine Meldung
        // kann ohne laufende Runde entstehen. Darum die beiden Bedingungen
        // von Hand statt ueber den Zusatz: "r.status NOT IN (...)" allein
        // waere bei fehlender Runde NULL und loeschte jede runden-lose
        // Meldung still mit, auch wenn sie erlaubt waere.
        [$zWo, $zWerte] = $zusatz('v', null);
        if ($nurEreignisMitRunde) { $zWo .= ' AND v.rundgang_id IS NOT NULL'; }
        if ($nurBeendet) {
            $zWo .= ' AND (v.rundgang_id IS NULL OR r.status NOT IN ('
                . implode(',', array_fill(0, count(RUNDGANG_OFFENE_STATUS), '?')) . '))';
            $zWerte = array_merge($zWerte, RUNDGANG_OFFENE_STATUS);
        }
        $rumpf = "FROM ereignis_meldung v
                  JOIN objekte o ON o.id = v.objekt_id
                  JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
                  LEFT JOIN ereignisart ea ON ea.id = v.ereignisart_id
                  LEFT JOIN einsaetze e ON e.id = v.einsatz_id
                  LEFT JOIN rundgang r ON r.id = v.rundgang_id
                  LEFT JOIN rundgang_vorlage rv ON rv.id = r.rundgang_vorlage_id
                 WHERE v.erfasst_am >= ? AND v.erfasst_am <= ?" . $zWo;
        $t = wachbuch_quelle($pdo,
            "SELECT v.id, v.erfasst_am AS zeit, v.vorfall_am, v.uebermittelt_am,
                    v.bemerkung, v.foto_mime, v.lat, v.lng,
                    ea.bezeichnung AS art_name,
                    v.rundgang_id, rv.name AS rundgang_name,
                    rv.fenster_von, rv.fenster_bis,
                    o.id AS objekt_id, o.name AS objekt_name,
                    e.id AS einsatz_id, e.titel AS einsatz_titel,
                    COALESCE(e.kunde_id, o.kunde_id) AS kunde_id,
                    COALESCE(e.kunde_name, o.kunde_name) AS kunde_name,
                    m.vorname, m.nachname
             $rumpf ORDER BY v.erfasst_am DESC, v.id DESC",
            "SELECT COUNT(*) $rumpf", array_merge([$abVon, $bisEnde], $zWerte), $grenze, $will('ereignis'));
        if ($t === null) { $quellen['ereignisse'] = 'fehler'; } else {
            $quellen['ereignisse'] = 'ok';
            $jeArt['ereignis'] = $t['anzahl'];
            if ($will('ereignis')) { $gesamt += $t['anzahl']; }
            foreach ($t['zeilen'] as $z) {
                $eintraege[] = wachbuch_rahmen($z) + [
                    'art'             => 'ereignis',
                    'id'              => 'ereignis-' . (int)$z['id'],
                    'zeit'            => $z['zeit'],
                    'uebermittelt_am' => $z['uebermittelt_am'],
                    'status'          => null,
                    // Ohne hinterlegte Art bleibt das Feld leer statt "Sonstiges"
                    // -- eine erfundene Kategorie waere eine Aussage, die
                    // niemand getroffen hat. Die Oberflaeche sagt dann
                    // "ohne Art", nicht nichts.
                    'bezeichnung'     => $z['art_name'],
                    // Der Vorfallzeitpunkt ergaenzt den Erfassungszeitpunkt und
                    // ersetzt ihn nie (ENT-295): Einsortiert wird nach dem
                    // Erfassen, gesagt wird beides.
                    'vorfall_am'      => $z['vorfall_am'],
                    'text'            => $z['bemerkung'],
                    'hat_foto'        => $z['foto_mime'] !== null,
                ];
            }
        }
    }

    // Zusammenfuehren: neueste zuoberst, bei gleicher Sekunde nach der
    // festen Rangfolge oben und zuletzt nach der Kennung -- damit dieselbe
    // Abfrage zweimal dieselbe Reihenfolge ergibt.
    usort($eintraege, static function (array $a, array $b): int {
        $c = strcmp((string)$b['zeit'], (string)$a['zeit']);
        if ($c !== 0) { return $c; }
        $c = (WACHBUCH_RANG[$b['art']] ?? 0) <=> (WACHBUCH_RANG[$a['art']] ?? 0);
        if ($c !== 0) { return $c; }
        return strcmp((string)$b['id'], (string)$a['id']);
    });

    $gekuerzt = count($eintraege) > $grenze;
    if ($gekuerzt) { $eintraege = array_slice($eintraege, 0, $grenze); }

    return [
        'eintraege' => $eintraege,
        // "gezeigt" und "gesamt" sind zwei verschiedene Zahlen und stehen
        // darum getrennt da. Sie in einer zusammenzufassen hiesse, eine
        // gekuerzte Liste wie eine vollstaendige aussehen zu lassen.
        'gezeigt'   => count($eintraege),
        'gesamt'    => $gesamt,
        'gekuerzt'  => $gekuerzt || $gesamt > count($eintraege),
        'grenze'    => $grenze,
        'je_art'    => $jeArt,
        'quellen'   => $quellen,
    ];
}
