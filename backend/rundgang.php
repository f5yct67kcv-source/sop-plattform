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
    $bestaetigt = 0; $nichtVerfuegbar = 0; $ersatzscan = 0;
    foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $z) {
        if ($z['status'] === 'bestaetigt') { $bestaetigt = (int)$z['n']; }
        if ($z['status'] === 'nicht_verfuegbar') { $nichtVerfuegbar = (int)$z['n']; }
        // Ersatzscan (Q-22): zaehlt separat, nicht einfach zu "bestaetigt"
        // dazu -- sonst waere ein Foto-Beleg von einem echten NFC-/Geofence-
        // Scan nicht mehr unterscheidbar (Einheiten nie vermischen).
        if ($z['status'] === 'ersatzscan') { $ersatzscan = (int)$z['n']; }
    }
    return ['gesamt' => $gesamt, 'bestaetigt' => $bestaetigt, 'nicht_verfuegbar' => $nichtVerfuegbar,
            'ersatzscan' => $ersatzscan];
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
