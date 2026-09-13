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
