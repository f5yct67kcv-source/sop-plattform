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
// Bei gleichem Datum gewinnt der Stammdatenwert. Er ist der jüngere Vorgang:
// Die Übernahme hat ihn ja gerade erst geschrieben; steht dort etwas
// anderes, hat jemand danach von Hand eingegriffen.
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
    return $stamm['datum'] >= $letzte['datum'] ? $stamm : $letzte;
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
