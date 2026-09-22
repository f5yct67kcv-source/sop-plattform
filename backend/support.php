<?php
// Support-Freigabe: der Weg, auf dem ein Betrieb dem Plattform-Betreiber
// befristet Einblick gewährt (ENT-526).
//
// WARUM DIESE TABELLEN IN DER DATENBANK DES MANDANTEN LIEGEN -- und nicht
// beim Betreiber, wo der Mandantenstamm steht:
//
// Läge die Freigabe beim Betreiber, könnte er sie sich selbst ausstellen.
// "Nur auf Freigabe" wäre dann eine Behauptung und keine Bauart. Dieselbe
// Überlegung, die im ganzen Haus die Trennungen trägt: Eine Sperre, die der
// Gesperrte selbst öffnen kann, ist keine.
//
// Dasselbe gilt für das Protokoll. Es gehört dem Betrieb, der eingesehen
// wurde -- er muss nachlesen können, wer wann was gesehen hat, ohne dafür
// den Betreiber fragen zu müssen.
//
// WAS EINE FREIGABE NICHT IST: Sie öffnet keinen Zugang zu Personendaten.
// Was der Betreiber im Supportfall sieht, ist in
// backend/api/betreiber_support.php abschliessend aufgezählt -- Zeilenzahlen,
// Schema-Lücken und die Struktur der Rechteprofile, alles ohne Namen. Die
// vertraulichen Personalfelder (ma_vertrauliche_felder()), Löhne und
// Rapportinhalte bleiben aussen vor, auch bei gültiger Freigabe.
declare(strict_types=1);

// ── Fristen ───────────────────────────────────────────────────────────
//
// Vorgabe 24 Stunden: Ein Supportfall wird am selben oder am nächsten Tag
// angesehen. Höchstens 7 Tage, weil eine Freigabe, die man vergisst,
// sonst unbegrenzt offen bliebe -- und der häufigste Fehler bei solchen
// Fenstern ist nicht das Öffnen, sondern das Vergessen.
const SUPPORT_STUNDEN_VORGABE = 24;
const SUPPORT_STUNDEN_MAX     = 24 * 7;

function support_tabellen_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'support_freigabe') && hat_tabelle($pdo, 'support_zugriff');
}

// Die gültige Freigabe, oder null.
//
// Drei Bedingungen in EINER Abfrage, nicht in nachträglichen Prüfungen:
// nicht widerrufen, noch nicht abgelaufen, jüngste zuerst. Ein Widerruf
// soll in derselben Sekunde wirken, in der jemand ihn ausspricht -- ohne
// dass irgendwo noch ein Zwischenstand liegt, der das nicht mitbekommen
// hat.
function support_freigabe_gueltig(PDO $pdo): ?array
{
    if (!support_tabellen_da($pdo)) { return null; }
    $s = $pdo->query(
        'SELECT id, freigegeben_von, freigegeben_am, gilt_bis, zweck
           FROM support_freigabe
          WHERE widerrufen_am IS NULL AND gilt_bis > NOW()
          ORDER BY id DESC LIMIT 1'
    );
    $r = $s->fetch(PDO::FETCH_ASSOC);
    return $r === false ? null : $r;
}

// Die Lage in Worten. Vier Antworten statt "offen/zu", weil sie zu vier
// verschiedenen Texten führen -- "nie freigegeben", "abgelaufen",
// "widerrufen" und "offen" sind verschiedene Aussagen (Hausregel:
// unbekannt darf nie wie keine aussehen).
function support_lage(PDO $pdo): string
{
    if (!support_tabellen_da($pdo)) { return 'nicht_eingerichtet'; }
    if (support_freigabe_gueltig($pdo) !== null) { return 'offen'; }
    $s = $pdo->query(
        'SELECT widerrufen_am, gilt_bis FROM support_freigabe ORDER BY id DESC LIMIT 1'
    );
    $r = $s->fetch(PDO::FETCH_ASSOC);
    if ($r === false) { return 'nie_freigegeben'; }
    return $r['widerrufen_am'] !== null ? 'widerrufen' : 'abgelaufen';
}

// Eine Freigabe eintragen. Gibt die Id zurück.
//
// Die Dauer wird auf SUPPORT_STUNDEN_MAX gedeckelt und nicht abgewiesen:
// Wer 30 Tage eintippt, will Support -- er soll ihn bekommen, nur eben
// nicht 30 Tage lang. Der Aufrufer erfährt aus gilt_bis, was tatsächlich
// gilt.
function support_freigeben(PDO $pdo, int $stunden, string $wer, string $zweck): int
{
    if ($stunden < 1) { $stunden = SUPPORT_STUNDEN_VORGABE; }
    if ($stunden > SUPPORT_STUNDEN_MAX) { $stunden = SUPPORT_STUNDEN_MAX; }
    $s = $pdo->prepare(
        'INSERT INTO support_freigabe (freigegeben_von, gilt_bis, zweck)
         VALUES (?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)'
    );
    $s->execute([mb_substr($wer, 0, 200), $stunden, mb_substr($zweck, 0, 500)]);
    return (int)$pdo->lastInsertId();
}

// Alle offenen Freigaben widerrufen -- nicht nur die jüngste. Wer widerruft,
// meint "ab jetzt niemand mehr", und eine ältere, noch laufende Freigabe
// wäre genau die Lücke, die niemand erwartet.
function support_widerrufen(PDO $pdo): int
{
    $s = $pdo->prepare('UPDATE support_freigabe SET widerrufen_am = NOW()
                         WHERE widerrufen_am IS NULL AND gilt_bis > NOW()');
    $s->execute();
    return $s->rowCount();
}

// Jeden Zugriff festhalten. OHNE diesen Eintrag gibt es keinen Zugriff --
// der Aufrufer schreibt ihn, BEVOR er Daten ausliefert, damit ein Abbruch
// mitten in der Auslieferung keine Lücke im Protokoll hinterlässt.
function support_zugriff_merken(PDO $pdo, int $freigabeId, string $wer, string $was): void
{
    $pdo->prepare(
        'INSERT INTO support_zugriff (freigabe_id, wer, was) VALUES (?, ?, ?)'
    )->execute([$freigabeId, mb_substr($wer, 0, 200), mb_substr($was, 0, 200)]);
}

// ── Der Sprung ins Cockpit (ENT-631) ──────────────────────────────────
//
// Der Betreiber stellt in der Datenbank des Betriebs einen Einmal-
// Schluessel aus; sein Browser loest ihn auf der Adresse des Betriebs ein
// und bekommt dafuer eine gewoehnliche Sitzung.
//
// SECHZIG SEKUNDEN, weil der Schluessel nur einen Seitenwechsel ueberleben
// muss. Alles darueber ist Zeit, in der er irgendwo herumliegt, ohne dass
// es jemandem nuetzt.
const SUPPORT_SPRUNG_SEKUNDEN = 60;

function support_sprung_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'support_sprung');
}

// Das Support-Konto des Betriebs, oder null.
//
// Ohne die Spalte gibt es kein Support-Konto -- und nicht etwa "irgendein
// Konto". Vier Lagen, vier Antworten (Hausregel): Die Einrichtung ist
// noch nicht gelaufen, und das ist etwas anderes als "kein Konto da".
function support_konto_id(PDO $pdo): ?int
{
    if (!hat_spalte($pdo, 'mitarbeiter', 'support_konto')) { return null; }
    $id = $pdo->query('SELECT id FROM mitarbeiter WHERE support_konto = 1 AND aktiv = 1
                        ORDER BY id LIMIT 1')->fetchColumn();
    return $id === false ? null : (int)$id;
}

// Einen Schluessel ausstellen. Gibt den ROHWERT zurueck -- er verlaesst
// diese Funktion einmal und wird nirgends gespeichert; in der Tabelle
// steht nur sein Abdruck (ENT-501).
//
// $freigabeId ist bei einem Demo-Platz null: Dort gibt es keine Freigabe,
// weil es keinen Kunden gibt, der sie erteilen koennte (ENT-631). Ob eine
// verlangt wird, entscheidet der Aufrufer -- diese Funktion stellt aus,
// sie urteilt nicht.
function support_sprung_ausstellen(PDO $pdo, ?int $freigabeId, string $wer): string
{
    $roh = bin2hex(random_bytes(32));
    $pdo->prepare(
        'INSERT INTO support_sprung (abdruck, freigabe_id, ausgestellt_von, gilt_bis)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))'
    )->execute([sitzung_abdruck($roh), $freigabeId, mb_substr($wer, 0, 200), SUPPORT_SPRUNG_SEKUNDEN]);
    return $roh;
}

// Einen Schluessel einloesen. Gibt die Zeile zurueck, oder null.
//
// DER ENTWERTUNGSSCHRITT IST DIE PRUEFUNG, nicht eine Prüfung davor: Das
// UPDATE trifft nur eine Zeile, die noch nicht eingeloest und noch gueltig
// ist. Kommt derselbe Schluessel zweimal gleichzeitig an -- zwei Reiter,
// ein doppelter Klick, ein Vorschau-Abruf --, gewinnt genau einer, weil
// die Datenbank die Zeile fuer den zweiten schon veraendert hat. Wer
// zuerst prueft und dann entwertet, hat zwischen beiden Schritten eine
// Luecke, durch die beide passen.
function support_sprung_einloesen(PDO $pdo, string $roh): ?array
{
    if (!support_sprung_da($pdo)) { return null; }
    $abdruck = sitzung_abdruck($roh);
    $s = $pdo->prepare(
        'UPDATE support_sprung SET eingeloest_am = NOW()
          WHERE abdruck = ? AND eingeloest_am IS NULL AND gilt_bis > NOW()'
    );
    $s->execute([$abdruck]);
    if ($s->rowCount() !== 1) { return null; }
    $z = $pdo->prepare('SELECT id, freigabe_id, ausgestellt_von FROM support_sprung WHERE abdruck = ?');
    $z->execute([$abdruck]);
    $r = $z->fetch(PDO::FETCH_ASSOC);
    return $r === false ? null : $r;
}

// Abgelaufene und eingeloeste Schluessel wegraeumen.
//
// Nicht aus Ordnungsliebe: Ein eingeloester Schluessel ist der Abdruck
// eines Zugangs, der einmal bestand. Er nuetzt niemandem mehr und soll
// nicht jahrelang herumliegen. Die Zugriffe selbst bleiben in
// support_zugriff -- DIE sind die Historie, nicht diese Tabelle.
function support_sprung_aufraeumen(PDO $pdo): int
{
    if (!support_sprung_da($pdo)) { return 0; }
    $s = $pdo->prepare('DELETE FROM support_sprung
                         WHERE gilt_bis < DATE_SUB(NOW(), INTERVAL 1 DAY)');
    $s->execute();
    return $s->rowCount();
}

// Das Support-Konto anlegen, falls es fehlt (ENT-631).
//
// EINE DEFINITION, ZWEI AUFRUFER: Die Einrichtung legt es an, und
// demo_instanz.php legt es nach jedem Leeren einer Demo wieder an.
// demo_reset_alle_tabellen_leeren() macht TRUNCATE auf JEDE Tabelle --
// ohne diesen zweiten Aufruf waere das Konto nach dem ersten Ablauf einer
// Demo weg, und der Sprung traefe auf eine Anmeldemaske, ohne zu sagen
// warum.
//
// ES GIBT KEIN PASSWORT DAZU: In password_hash steht "*", und das ist
// kein gueltiger Hash -- jedes password_verify() dagegen ist false, egal
// was jemand eingibt. Kein Zufallswert: Ein Zufallswert koennte
// theoretisch zu einem Passwort passen, dieser nicht. Der einzige Weg in
// dieses Konto ist der Einmal-Schluessel, und der kommt von aussen.
//
// aktiv = 1 ist noetig und nicht kosmetisch: require_session() verlangt
// es (JOIN ... WHERE m.aktiv = 1).
//
// Gibt true zurueck, wenn eines angelegt wurde.
function support_konto_sicherstellen(PDO $pdo): bool
{
    if (!hat_tabelle($pdo, 'mitarbeiter') || !hat_spalte($pdo, 'mitarbeiter', 'support_konto')) {
        return false;
    }
    if ((int)$pdo->query('SELECT COUNT(*) FROM mitarbeiter WHERE support_konto = 1')->fetchColumn() > 0) {
        return false;
    }
    $pdo->prepare(
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, aktiv, support_konto, vorname, nachname)
         VALUES (?, ?, 1, 1, 1, ?, ?)'
    )->execute(['GuardOpS Support', '*', 'GuardOpS', 'Support']);
    $id = (int)$pdo->lastInsertId();
    if (hat_tabelle($pdo, 'mitarbeiter_rollen')) {
        require_once __DIR__ . '/rechte.php';
        $pdo->prepare('INSERT IGNORE INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)')
            ->execute([$id, ROLLE_ADMINISTRATOR]);
    }
    return true;
}

// ── Die Spur im Cockpit (ENT-631) ─────────────────────────────────────

function support_spur_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'support_spur');
}

// Einen Schritt festhalten.
//
// AUFGERUFEN AUS require_session(), also aus der EINEN Stelle, durch die
// jeder angemeldete Endpunkt laeuft. Die Alternative waere ein Aufruf in
// jedem einzelnen Schreibweg gewesen -- und genau so eine Regel ist hier
// schon mehrfach an etwas Neuem gescheitert, das sie nicht geerbt hat
// (CLAUDE.md). Ein Endpunkt, den jemand morgen dazuschreibt, protokolliert
// mit, ohne dass er davon wissen muss.
//
// NUR VERAENDERNDE ANFRAGEN. Jeden Abruf mitzuschreiben ergaebe Berge, in
// denen die Aenderungen untergehen -- ein Cockpit laedt ein Dutzend
// Endpunkte beim Oeffnen. Dass jemand DA war, steht ohnehin in
// support_sprung; was er GETAN hat, steht hier.
//
// SCHLAEGT NIE DURCH: Ein Fehler beim Protokollieren darf die Arbeit nicht
// abbrechen -- sonst waere die Folge eines vollen Datentraegers, dass
// niemand mehr etwas speichern kann. Die Ausnahme wird verschluckt, der
// Aufrufer merkt nichts. Das ist die bewusste Gegenrichtung zu
// support_zugriff_merken(), wo der Eintrag VOR der Auslieferung steht und
// scheitern DARF: Dort entscheidet er, ob Daten herausgehen; hier hält er
// fest, was ohnehin geschieht.
function support_spur_merken(PDO $pdo, ?int $sprungId, string $wer,
                             string $methode, string $endpunkt): void
{
    if (!support_spur_da($pdo)) { return; }
    try {
        $pdo->prepare(
            'INSERT INTO support_spur (sprung_id, wer, methode, endpunkt) VALUES (?, ?, ?, ?)'
        )->execute([
            $sprungId,
            mb_substr($wer, 0, 200),
            mb_substr($methode, 0, 10),
            mb_substr($endpunkt, 0, 100),
        ]);
    } catch (Throwable $e) {
        // bewusst still, siehe oben
    }
}

// Die Spur eines Betriebs, juengste zuerst. Fuer den Betrieb selbst --
// er soll nachlesen koennen, ohne den Betreiber zu fragen.
function support_spur_lesen(PDO $pdo, int $grenze = 200): array
{
    if (!support_spur_da($pdo)) { return []; }
    $s = $pdo->prepare('SELECT id, sprung_id, zeitpunkt, wer, methode, endpunkt
                          FROM support_spur ORDER BY id DESC LIMIT ?');
    $s->bindValue(1, max(1, min($grenze, 1000)), PDO::PARAM_INT);
    $s->execute();
    return $s->fetchAll(PDO::FETCH_ASSOC);
}
