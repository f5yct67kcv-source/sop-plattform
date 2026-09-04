<?php
// Gemeinsame Logik der Fahrzeugübernahme (ENT-340).
//
// Liegt hier und nicht in den beiden Endpunkten, weil sich die Frage
// "worauf setzt dieser Kilometerstand auf?" nur EINMAL beantworten lässt.
// Zwei Antworten hiesse: Die App zeigt einen anderen Bezugswert an, als der
// Server beim Speichern anlegt -- und der Widerspruch fiele erst auf, wenn
// eine Eingabe abgewiesen wird, die auf dem Bildschirm richtig aussah.
declare(strict_types=1);

// Die Prüfung des Bildformats ist DIESELBE wie beim Ersatzscan am
// Kontrollpunkt, nicht eine zweite daneben: ersatzscan_foto_mime() liest das
// Format am Dateianfang statt am mitgeschickten Typ. Zwei Kopien liefen
// auseinander, sobald irgendwann ein drittes Format dazukommt -- und die
// zweite Stelle fiele niemandem auf.
require_once __DIR__ . '/rundgang.php';

// Foto eines Tachostands. Gleiche Grössenordnung wie beim Ersatzscan
// (ERSATZSCAN_FOTO_MAX in rundgang.php): Ein Beleg "so stand es da" braucht
// keine Druckauflösung, und die App verkleinert vor dem Versand.
const FZ_FOTO_MAX = 2 * 1024 * 1024;

// Ein Sprung dieser Grösse zwischen zwei Übernahmen ist nicht verboten --
// eine Fahrt nach Genf und zurück erreicht ihn. Er wird nur BENANNT, damit
// die spätere Abstimmung (Projektinhaber: "dass die Anzahl gefahrener
// Kilometer in etwa den Richtlinien besteht") nicht bei null anfangen muss.
const FZ_SPRUNG_AUFFAELLIG = 800;

// Worauf ein neuer Kilometerstand aufsetzt.
//
// Zwei Quellen kommen in Frage, und welche gilt, entscheidet das Datum:
//
//  - die letzte Übernahme (die Kette selbst) und
//  - der Stammdatenwert fahrzeuge.tacho_km, den die Verwaltung im Cockpit
//    pflegt.
//
// Im Normalbetrieb sind beide gleich: Jede Übernahme schreibt den
// Stammdatenwert mit. Auseinander laufen sie nur, wenn die Verwaltung
// eingreift -- und genau dann muss der Eingriff gewinnen. Sonst wäre ein
// einziger Vertipper (1'234'567 statt 123'456) eine Sperre für immer: Jede
// weitere Übernahme läge darunter und würde abgewiesen, ohne dass irgendwer
// den Fehler noch korrigieren könnte. Ein Eingriff der Verwaltung ist
// nachvollziehbar -- er steht mit Namen im Logbuch (ENT-330).
//
// Bei gleichem Datum gewinnt der Stammdatenwert NUR, wenn er vom letzten
// Kettenwert abweicht -- das ist der Eingriff der Verwaltung. Stimmt er
// exakt überein, ist das der automatische Spiegel derselben Übernahme,
// kein Eingriff (ENT-354-Nachbesserung nach Live-Test): Sonst würde die
// "besetzt/fremd"-Auskunft an jedem Tag mit einer echten Übernahme sofort
// wieder auf die anonyme Stammdaten-Zeile zurückfallen, siehe unten.
//
// Rückgabe: null, wenn es überhaupt keinen bekannten Stand gibt -- das ist
// etwas anderes als "0 km" und muss auch anders angezeigt werden.
//
// $eigeneId (ENT-354): Gibt der Aufrufer die eigene Mitarbeiter-ID mit,
// trägt das Ergebnis zusätzlich 'eigene' -- die Ja/Nein-Auskunft, ob die
// letzte Übernahme von genau dieser Person stammt. Die rohe mitarbeiter_id
// der letzten Übernahme verlässt diese Funktion nie, nur diese Auskunft --
// beide Aufrufer geben ihr Ergebnis direkt als JSON weiter.
function fz_bezugsstand(PDO $pdo, int $fahrzeugId, ?int $eigeneId = null): ?array
{
    $letzte = null;
    if (hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
        $s = $pdo->prepare(
            "SELECT u.tacho_km, u.zeitpunkt, u.mitarbeiter_id, m.vorname, m.nachname, m.name
               FROM fahrzeug_uebernahme u
               LEFT JOIN mitarbeiter m ON m.id = u.mitarbeiter_id
              WHERE u.art = 'uebernahme' AND u.fahrzeug_id = ? AND u.tacho_km IS NOT NULL
              ORDER BY u.zeitpunkt DESC, u.id DESC LIMIT 1"
        );
        $s->execute([$fahrzeugId]);
        $r = $s->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? ''));
            if ($name === '') { $name = trim((string)($r['name'] ?? '')); }
            $letzte = [
                'quelle'    => 'uebernahme',
                'tacho_km'  => (int)$r['tacho_km'],
                'zeitpunkt' => (string)$r['zeitpunkt'],
                'datum'     => substr((string)$r['zeitpunkt'], 0, 10),
                'person'    => $name !== '' ? $name : null,
            ];
            if ($eigeneId !== null) {
                $letzte['eigene'] = ((int)$r['mitarbeiter_id'] === $eigeneId);
            }
        }
    }

    $stamm = null;
    $s = $pdo->prepare('SELECT tacho_km, tacho_am FROM fahrzeuge WHERE id = ?');
    $s->execute([$fahrzeugId]);
    $f = $s->fetch(PDO::FETCH_ASSOC);
    if ($f && $f['tacho_km'] !== null && $f['tacho_km'] !== '') {
        $am = trim((string)($f['tacho_am'] ?? ''));
        $stamm = [
            'quelle'    => 'stammdaten',
            'tacho_km'  => (int)$f['tacho_km'],
            'zeitpunkt' => $am !== '' ? $am : null,
            // Ohne Ablesedatum lässt sich der Stammdatenwert zeitlich nicht
            // einordnen. Dann gilt er als der ältere -- die Kette mit
            // Zeitstempel ist die belastbarere Auskunft.
            'datum'     => $am !== '' ? substr($am, 0, 10) : '0000-00-00',
            'person'    => null,
        ];
    }

    if ($letzte === null) { return $stamm; }
    if ($stamm === null) { return $letzte; }
    if ($stamm['datum'] !== $letzte['datum']) {
        return $stamm['datum'] > $letzte['datum'] ? $stamm : $letzte;
    }
    // Gleiches Datum: JEDE Uebernahme schreibt den Stammdatenwert automatisch
    // mit (meine_fahrzeug_uebernahme.php, "UPDATE fahrzeuge SET tacho_km = ?,
    // tacho_am = CURDATE()") -- am selben Tag ist der Stammdatenwert darum in
    // aller Regel genau dieser Spiegel, kein zusaetzlicher Buero-Eingriff.
    // Nur wenn er vom letzten Kettenwert ABWEICHT, hat wirklich jemand danach
    // von Hand korrigiert (siehe Fahrzeug 6/5 oben) -- dann gewinnt er weiter.
    // Stimmt er ueberein, gilt weiterhin die Kette: Sie allein traegt Person
    // und Uhrzeit, und ohne diese Unterscheidung wuerde die "besetzt/fremd"-
    // Auskunft (ENT-354) an JEDEM Tag mit einer echten Uebernahme sofort
    // wieder auf die anonyme Stammdaten-Zeile zurueckfallen -- real
    // beobachtet: zwei Personen konnten dasselbe Fahrzeug am selben Tag ohne
    // jede Warnung nacheinander uebernehmen.
    return $stamm['tacho_km'] === $letzte['tacho_km'] ? $letzte : $stamm;
}

// Das Fahrzeug, das gerade als "bei dieser Person aktiv" gilt (ENT-354) --
// rein informativ für die eigene Maske, kein Riegel und kein zweiter
// Eintragspfad in der Kette. Zwei Regeln entscheiden, in dieser Reihenfolge:
//
//  1. Die eigene LETZTE Zeile zu einem Fahrzeug entscheidet -- 'uebernahme'
//     oder 'abgabe', je nachdem was zuletzt war. Eine 'abgabe' beendet die
//     Anzeige sofort, unabhängig davon, was fz_bezugsstand() zur Kette sagt.
//  2. Bei 'uebernahme' gilt es nur, solange seither niemand sonst dasselbe
//     Fahrzeug übernommen hat (fz_bezugsstand() mit der eigenen ID bleibt
//     'eigene' => true) -- sonst hat es faktisch schon gewechselt, auch ohne
//     eine eigene Abgabe.
//
// 'abgabe' bleibt dabei bewusst wirkungslos für fz_bezugsstand() selbst
// (dort zählt weiterhin nur 'uebernahme'): Ein Vergessen dieses Knopfs kann
// darum nie die Kilometerkette stören, nur die eigene Anzeige hier stehen
// lassen, bis das nächste echte Übernahme-Ereignis sie ohnehin ablöst --
// genau das Gegenteil des Rückgabe-Risikos, das ENT-340 verworfen hat.
function fz_meine_aktiv(PDO $pdo, int $mitarbeiterId): ?array
{
    if (!hat_tabelle($pdo, 'fahrzeug_uebernahme')) { return null; }
    $s = $pdo->prepare(
        "SELECT fahrzeug_id, art, zeitpunkt FROM fahrzeug_uebernahme
          WHERE art IN ('uebernahme', 'abgabe') AND mitarbeiter_id = ? AND fahrzeug_id IS NOT NULL
          ORDER BY zeitpunkt DESC, id DESC LIMIT 1"
    );
    $s->execute([$mitarbeiterId]);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    if (!$r || $r['art'] !== 'uebernahme') { return null; }

    $bez = fz_bezugsstand($pdo, (int)$r['fahrzeug_id'], $mitarbeiterId);
    if ($bez === null || $bez['quelle'] !== 'uebernahme' || !($bez['eigene'] ?? false)) {
        return null;
    }

    $f = $pdo->prepare('SELECT id, kennzeichen, bezeichnung FROM fahrzeuge WHERE id = ?');
    $f->execute([(int)$r['fahrzeug_id']]);
    $ff = $f->fetch(PDO::FETCH_ASSOC);
    if (!$ff) { return null; }
    return ['id' => (int)$ff['id'], 'kennzeichen' => $ff['kennzeichen'],
             'bezeichnung' => $ff['bezeichnung'], 'seit' => (string)$r['zeitpunkt']];
}

// Die Übernahmen-Liste fürs Cockpit (ENT-346/fahrzeug_uebernahme_liste.php),
// als Konstante statt inline im Endpunkt -- damit eine echte Prüfung
// (pruef_fahrzeug_uebernahme.php) exakt dieselbe Abfrage gegen SQLite
// ausführen kann, die auch gegen die echte Datenbank läuft. Der Aufrufer
// hängt den optionalen Fahrzeug-Filter und die Sortierung selbst an.
//
// "voriger": die vorangehende Übernahme DESSELBEN Fahrzeugs -- derselbe
// Bezug, den fz_bezugsstand() auch für die NÄCHSTE Übernahme heranzöge,
// hier per Korrelation für JEDE Zeile mitgeholt (nicht nur die aktuellste).
// "soll_*" (ENT-361): die Soll-Distanz zwischen dieser und der vorigen
// Übernahme, aus den bereits für den GAV-Auslagenersatz erfassten Wegen
// (einsaetze.weg_km, ENT-116) hergeleitet -- KEIN neues Erfassungsfeld,
// keine Fahrzeugstandort-Frage (OP-316 bleibt für diesen Vergleich
// unberührt). Datumsgenau verglichen (DATE(), portabel zwischen MySQL und
// SQLite), nicht zeitgenau -- der Projektinhaber selbst: "nicht die 100%
// genaue Ermittlung, aber grössere Abweichung muss man erkennen können".
// Drei Werte statt einem: Zahl der zugeteilten Einsätze im Fenster, davon
// mit gesetztem weg_km, und die Summe -- sonst würde ein NUR TEILWEISE
// erfasster weg_km still zu einer zu niedrigen Soll-Distanz führen, ohne
// dass das irgendwo sichtbar wäre ("unbekannt darf nie wie keine aussehen").
// 'entfallen'/'abgelehnt' zählen nicht mit (dieselbe Ausnahme wie ENT-350).
const FZ_UEBERNAHME_LISTE_SQL = "SELECT u.id, u.art, u.zeitpunkt, u.tacho_km, u.quelle,
           u.mitarbeiter_id AS eigene_mitarbeiter_id, u.foto IS NOT NULL AS hat_foto,
           f.id AS fahrzeug_id, f.kennzeichen, f.bezeichnung AS fz_bezeichnung,
           m.vorname, m.nachname, m.name,
           e.kunde_name, e.titel,
           voriger.tacho_km AS voriger_km, voriger.mitarbeiter_id AS voriger_mitarbeiter_id,
           (SELECT COUNT(*) FROM einsaetze se JOIN einsatz_zuteilung sz ON sz.einsatz_id = se.id
             WHERE sz.mitarbeiter_id = u.mitarbeiter_id AND sz.zusage NOT IN ('entfallen', 'abgelehnt')
               AND se.datum BETWEEN DATE(voriger.zeitpunkt) AND DATE(u.zeitpunkt)
           ) AS soll_einsaetze,
           (SELECT COUNT(se.weg_km) FROM einsaetze se JOIN einsatz_zuteilung sz ON sz.einsatz_id = se.id
             WHERE sz.mitarbeiter_id = u.mitarbeiter_id AND sz.zusage NOT IN ('entfallen', 'abgelehnt')
               AND se.datum BETWEEN DATE(voriger.zeitpunkt) AND DATE(u.zeitpunkt)
           ) AS soll_einsaetze_mit_weg_km,
           (SELECT SUM(2 * se.weg_km) FROM einsaetze se JOIN einsatz_zuteilung sz ON sz.einsatz_id = se.id
             WHERE sz.mitarbeiter_id = u.mitarbeiter_id AND sz.zusage NOT IN ('entfallen', 'abgelehnt')
               AND se.datum BETWEEN DATE(voriger.zeitpunkt) AND DATE(u.zeitpunkt)
           ) AS soll_km_summe
      FROM fahrzeug_uebernahme u
      LEFT JOIN fahrzeuge f ON f.id = u.fahrzeug_id
      JOIN mitarbeiter m ON m.id = u.mitarbeiter_id
      LEFT JOIN einsaetze e ON e.id = u.einsatz_id
      LEFT JOIN fahrzeug_uebernahme voriger ON voriger.id = (
          SELECT v.id FROM fahrzeug_uebernahme v
           WHERE v.art = 'uebernahme' AND v.fahrzeug_id = u.fahrzeug_id AND v.tacho_km IS NOT NULL
             AND (v.zeitpunkt < u.zeitpunkt OR (v.zeitpunkt = u.zeitpunkt AND v.id < u.id))
           ORDER BY v.zeitpunkt DESC, v.id DESC LIMIT 1
      )";

// Ab welcher Differenz zwischen gefahrenen und erwarteten Kilometern die
// Abweichungs-Feststellung anschlägt (ENT-361). Fest statt prozentual, auf
// ausdrücklichen Wunsch des Projektinhabers: "10km" -- Stauumfahrungen u.ä.
// bis in diese Grössenordnung sind normal.
const FZ_ABWEICHUNG_TOLERANZ_KM = 10;

// Drei Feststellungen (ENT-356/ENT-361), getrennt von der SQL-Abfrage
// geprüft, damit jede für sich falsch sein kann, ohne dass eine andere es
// verdeckt. Alle drei bleiben Feststellungen, keine Beanstandungen --
// OP-314/ENT-356.
//
//  - "auffaellig": derselbe Sprung wie beim Abschicken selbst
//    (FZ_SPRUNG_AUFFAELLIG) -- hier zusätzlich fürs Cockpit sichtbar
//    gemacht, nicht nur im Toast der fahrenden Person. Das ist ENT-313s
//    "Lücke" -- braucht keinen Erwartungswert.
//  - "wiederholt": dieselbe Person, dasselbe Fahrzeug, derselbe Stand wie
//    bei ihrer EIGENEN letzten Übernahme -- anders als der bewusst
//    erlaubte Fall "andere Person übernimmt beim gleichen Stand" (ENT-340),
//    den fz_stand_pruefen() weiterhin nicht abweist.
//  - "abweichend": gefahrene gegen erwartete Kilometer -- ENT-313s
//    "Abweichung". Erwartet ist die Summe der bereits für den GAV-
//    Auslagenersatz erfassten Wege (weg_km, ENT-116) über alle Einsätze
//    zwischen dieser und der vorigen Übernahme. Fehlt weg_km bei
//    MINDESTENS EINEM dieser Einsätze, ist die Summe unvollständig und
//    NICHT vergleichbar -- "soll_unvollstaendig" macht das sichtbar, statt
//    still eine zu niedrige Erwartung anzunehmen ("unbekannt darf nie wie
//    keine aussehen").
function fz_uebernahme_feststellungen(?int $tachoKm, ?int $vorigerKm, ?int $vorigerMa, ?int $eigeneMa,
    int $sollEinsaetze = 0, int $sollEinsaetzeMitWegKm = 0, ?float $sollKmSumme = null): array
{
    $kmSeither = ($tachoKm !== null && $vorigerKm !== null) ? $tachoKm - $vorigerKm : null;

    $sollUnvollstaendig = $sollEinsaetze > 0 && $sollEinsaetzeMitWegKm < $sollEinsaetze;
    $sollKm = ($sollEinsaetze > 0 && !$sollUnvollstaendig) ? (float)$sollKmSumme : null;
    $abweichungKm = ($kmSeither !== null && $sollKm !== null) ? $kmSeither - $sollKm : null;

    return [
        'km_seither' => $kmSeither,
        'auffaellig' => $kmSeither !== null && $kmSeither > FZ_SPRUNG_AUFFAELLIG,
        'wiederholt' => $vorigerKm !== null && $tachoKm === $vorigerKm
            && $vorigerMa !== null && $vorigerMa === $eigeneMa,
        'soll_km' => $sollKm,
        'soll_unvollstaendig' => $sollUnvollstaendig,
        'abweichung_km' => $abweichungKm,
        'abweichend' => $abweichungKm !== null && abs($abweichungKm) > FZ_ABWEICHUNG_TOLERANZ_KM,
    ];
}

// Der Schlüssel hinter dem Aufkleber. Zufällig und nicht aus Kennzeichen
// oder ID abgeleitet: Wäre er ableitbar, liesse sich für jedes Fahrzeug eine
// Übernahme buchen, ohne je davorgestanden zu haben -- und der Aufkleber
// verlöre genau die Eigenschaft, für die er da ist.
//
// 32 Hexzeichen aus random_bytes(). Nicht mt_rand()/uniqid(): Beide sind
// vorhersagbar, wenn man einen Wert kennt.
function fz_kennung_neu(): string
{
    return bin2hex(random_bytes(16));
}

// Versieht Fahrzeuge ohne Aufkleber-Schlüssel mit einem. Läuft beim
// Einrichten und beim Anlegen -- Fahrzeuge aus der Zeit vor ENT-340 hätten
// sonst nie einen und blieben stumm, ohne dass es jemandem auffiele.
// Gibt die Zahl der vergebenen Schlüssel zurück.
function fz_kennungen_nachtragen(PDO $pdo): int
{
    if (!hat_tabelle($pdo, 'fahrzeuge') || !hat_spalte($pdo, 'fahrzeuge', 'qr_kennung')) {
        return 0;
    }
    $offen = $pdo->query("SELECT id FROM fahrzeuge WHERE qr_kennung IS NULL OR qr_kennung = ''")
                 ->fetchAll(PDO::FETCH_COLUMN);
    $stmt = $pdo->prepare('UPDATE fahrzeuge SET qr_kennung = ? WHERE id = ?');
    $anzahl = 0;
    foreach ($offen as $fid) {
        $stmt->execute([fz_kennung_neu(), (int)$fid]);
        $anzahl++;
    }
    return $anzahl;
}

// Darf dieser Kilometerstand angenommen werden? Gibt null zurück, wenn ja,
// sonst den Text, der abgewiesen wird.
//
// Steht hier und nicht im Endpunkt, damit die Regel AUSGEFÜHRT geprüft
// werden kann (pruef_fahrzeug_uebernahme.php). Eine Sperre, die nur als
// Quelltext dasteht, ist eine Behauptung -- und diese hier entscheidet, ob
// eine Fahrt in der Kette landet oder abgewiesen wird.
function fz_stand_pruefen(?array $bezug, int $km): ?string
{
    // Der Zähler zählt nur aufwärts. Ein kleinerer Wert ist immer ein
    // Fehler -- entweder in dieser Eingabe oder im vorigen Eintrag.
    // Aufgelöst wird das im Büro (siehe fz_bezugsstand()), nicht durch
    // einen Weg an der Sperre vorbei.
    if ($bezug !== null && $km < $bezug['tacho_km']) {
        return 'Der Zähler zählt nur aufwärts. Zuletzt bekannt: '
             . number_format($bezug['tacho_km'], 0, '.', "'") . ' km.';
    }
    // Obergrenze gegen den Vertipper, der eine Ziffer zu viel trägt. FZ_KM_MAX
    // in fahrzeuge.php prüft dasselbe für die Stammdaten -- dieselbe Grenze,
    // damit nicht der eine Weg annimmt, was der andere abweist.
    if ($km < 0 || $km > 3000000) {
        return 'Dieser Kilometerstand kann nicht stimmen.';
    }
    return null;
}
