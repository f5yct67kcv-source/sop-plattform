<?php
// Supportvorgänge (ENT-538): der Weg, auf dem ein Mandant dem Betreiber ein
// Anliegen schildert, und der Arbeitsvorrat, in dem der Betreiber es
// abarbeitet.
//
// NICHT ZU VERWECHSELN MIT support.php. Jene Datei regelt die
// Support-FREIGABE (ENT-526) — den befristeten, protokollierten Einblick in
// Diagnosedaten. Diese hier regelt die ANFRAGE. Zwei verschiedene Dinge:
// Die Freigabe öffnet ein Fenster, der Vorgang stellt eine Frage. Ein
// Vorgang kann eine Freigabe anregen, ersetzt sie aber nie — und erteilt
// sie auch nicht selbst.
//
// WARUM DIE VORGÄNGE BEIM BETREIBER LIEGEN und nicht beim Mandanten, wo die
// Freigabe liegt:
//
// Bei der Freigabe ist die Ablage die Sicherung — läge sie beim Betreiber,
// könnte er sie sich selbst ausstellen. Beim Vorgang gibt es nichts
// auszustellen, dafür aber etwas zu verlieren: Der Betreiber braucht EINE
// Arbeitsliste über alle Mandanten. Lägen die Vorgänge verteilt, müsste er
// bei zwanzig Betrieben zwanzig Datenbanken abfragen, und eine gerade nicht
// erreichbare fiele lautlos heraus. Die Liste sähe dann leer aus statt
// unvollständig — genau die Verwechslung, die die Hausregel „unbekannt darf
// nie wie keine aussehen" verbietet.
//
// DER PREIS, benannt statt verschwiegen: Der Text des Kunden liegt beim
// Betreiber. Anders als bei der Freigabe, die personenfrei gebaut ist.
// Darum der Hinweis am Eingabefeld, darum keine Dateianhänge in dieser
// Stufe, und darum steht das Risiko in ENT-538 statt in einer Fussnote.
//
// DIESE DATEI IST DIE EINZIGE STELLE, an der Mandanten-Code die
// Betreiber-Ebene beschreibt. backend/betreiber.php hält fest, dass keine
// Abfrage beides vermischt; support_vorgang_einreichen() tut es, als
// benannte Ausnahme und über genau eine Funktion. test_php.mjs bewacht,
// dass es dabei bleibt — ohne diese Wache wäre es in einem halben Jahr die
// Stelle, an der jemand „schnell noch" den Mandantenstamm mitliest.
declare(strict_types=1);

// ── Die Wörter ────────────────────────────────────────────────────────

// Drei Arten. Sie sortieren den Arbeitsvorrat, sie steuern nichts — eine
// Störung wird nicht anders behandelt als eine Frage, sie ist nur
// dringender zu lesen.
const SV_ARTEN = ['stoerung', 'frage', 'wunsch'];

// Vier Status, nicht zwei (ENT-538). 'wartet_auf_kunde' ist der wichtigste:
// Ohne ihn zählen Vorgänge als offen, die längst beim Kunden liegen, und
// ein Vorrat, der Erledigtes als offen führt, wird nach zwei Wochen
// ignoriert.
const SV_STATUS = ['neu', 'in_arbeit', 'wartet_auf_kunde', 'erledigt'];

// Wer offen ist, wartet auf UNS. 'wartet_auf_kunde' gehört ausdrücklich
// nicht dazu — dieselbe Liste beantwortet den Zähler auf der Übersicht und
// die Frage, woran erinnert wird.
const SV_STATUS_OFFEN = ['neu', 'in_arbeit'];

// Die beiden Seiten eines Verlaufs. Ein Wort am Datensatz, keine zweite
// Tabelle: Wer geschrieben hat, ist eine Eigenschaft der Nachricht.
const SV_SEITEN = ['kunde', 'betreiber'];

const SV_MAX_BETREFF   = 200;
const SV_MAX_TEXT      = 4000;
const SV_MAX_KONTEXT   = 200;

// Nach so vielen Stunden auf 'neu' wird EINMAL erinnert. 24 Stunden, weil
// ein Anliegen, das nicht dringend genug für einen Anruf ist, am nächsten
// Arbeitstag beantwortet gehört — nicht in derselben Stunde und nicht in
// derselben Woche.
const SV_ERINNERUNG_STUNDEN = 24;

function sv_art_gueltig(string $wert): bool
{
    return in_array($wert, SV_ARTEN, true);
}

function sv_status_gueltig(string $wert): bool
{
    return in_array($wert, SV_STATUS, true);
}

function sv_seite_gueltig(string $wert): bool
{
    return in_array($wert, SV_SEITEN, true);
}

// ── Eingabe prüfen ────────────────────────────────────────────────────
//
// Reine Funktion, keine Datenbank — dieselbe Trennung wie in
// demo_anfrage.php, damit pruef_supportvorgang.php sie echt ausführen kann
// statt den Quelltext zu lesen.
//
// Gibt ['fehler' => [feld => text], 'werte' => [...]] zurück; leeres
// 'fehler' heisst annehmbar.
function sv_anfrage_pruefen(array $in): array
{
    $fehler = [];

    $betreff = sv_einzeilig($in['betreff'] ?? '', SV_MAX_BETREFF);
    if ($betreff === '') {
        $fehler['betreff'] = 'Bitte kurz sagen, worum es geht.';
    }

    // Der Text ist Pflicht. Ein Vorgang ohne Schilderung erzeugt genau die
    // Rückfrage, die er ersparen soll.
    $text = trim((string)($in['text'] ?? ''));
    if ($text === '') {
        $fehler['text'] = 'Bitte das Anliegen beschreiben.';
    }
    $text = mb_substr($text, 0, SV_MAX_TEXT);

    // Eine unbekannte Art wird NICHT abgewiesen, sondern zu 'frage'. Die
    // Art sortiert nur; sie ist keine Bedingung dafür, dass jemand ein
    // Anliegen loswerden darf.
    $art = (string)($in['art'] ?? '');
    if (!sv_art_gueltig($art)) { $art = 'frage'; }

    return ['fehler' => $fehler, 'werte' => [
        'betreff'   => $betreff,
        'text'      => $text,
        'art'       => $art,
        'bildschirm'=> sv_einzeilig($in['bildschirm'] ?? '', SV_MAX_KONTEXT),
        'umgebung'  => sv_einzeilig($in['umgebung'] ?? '', SV_MAX_KONTEXT),
    ]];
}

// Ein einzeiliges Feld: Umbrüche und Tabulatoren werden zu Leerzeichen,
// dann gekürzt. Multibyte-sicher, damit ein Umlaut am Ende nicht zerrissen
// wird. Dasselbe Vorgehen wie demo_einzeilig() — der Betreff landet im
// Betreff einer E-Mail, und dort wäre ein eingeschmuggeltes "\r\n" eine
// zusätzliche Kopfzeile.
function sv_einzeilig(mixed $wert, int $max): string
{
    $s = preg_replace('/[\r\n\t]+/', ' ', (string)$wert) ?? '';
    return mb_substr(trim($s), 0, $max);
}

// ── Welcher Mandant fragt? ────────────────────────────────────────────
//
// Die Mandanten-Installation kennt ihre eigene Id nicht — es gibt keinen
// Deploy-Wert dafür, und einen einzuführen hiesse, ihn bei jeder
// Inbetriebnahme richtig setzen zu müssen. Stattdessen wird zugeordnet, was
// ohnehin feststeht: der Name der Datenbank, in der wir gerade arbeiten.
//
// DREI ANTWORTEN, nicht zwei. 'nicht_zuordenbar' ist ausdrücklich nicht
// dasselbe wie „Mandant 1" — wer im Zweifel auf den ersten Mandanten
// rät, schreibt die Anfrage eines Betriebs unter dem Namen eines anderen
// in den Vorrat. Lieber ein ehrlicher Fehler als eine falsche Zuordnung.
//
// Reine Funktion: Sie bekommt die Mandantenliste und den Datenbanknamen,
// sie fragt nichts ab.
function sv_mandant_waehlen(array $mandanten, string $dbName): array
{
    // 1. Ein Mandant, dessen db_name genau auf diese Datenbank zeigt.
    foreach ($mandanten as $m) {
        if (trim((string)($m['db_name'] ?? '')) !== ''
            && trim((string)$m['db_name']) === trim($dbName)) {
            return ['id' => (int)$m['id'], 'lage' => 'zugeordnet'];
        }
    }

    // 2. Der Bestandsmandant. Leeres db_host/db_name heisst laut
    //    betreiber.php „Standardverbindung aus db.php" — das ist der
    //    Betrieb, dessen Daten schon da waren, bevor es einen
    //    Mandantenstamm gab. Nur eindeutig, wenn es genau EINEN gibt.
    $bestand = [];
    foreach ($mandanten as $m) {
        if (trim((string)($m['db_name'] ?? '')) === '') { $bestand[] = (int)$m['id']; }
    }
    if (count($bestand) === 1) {
        return ['id' => $bestand[0], 'lage' => 'bestand'];
    }

    return ['id' => null, 'lage' => 'nicht_zuordenbar'];
}

// ── Ist eine Erinnerung fällig? ───────────────────────────────────────
//
// Reine Funktion, damit sie sich ohne Uhr und ohne Datenbank prüfen lässt.
// Drei Bedingungen, und jede einzelne hat einen Grund:
//
//  - Status 'neu': Wer den Vorgang angefasst hat, braucht keine Erinnerung.
//  - Noch nie erinnert: EINMAL, nicht täglich. Ein Riegel, der jeden Tag
//    kommt, wird gewohnheitsmässig weggeklickt — und dann trifft es genau
//    die eine Meldung, auf die es ankommt (dieselbe Überlegung wie bei den
//    Mitteilungen, ENT-421).
//  - Alt genug: sonst käme die Erinnerung, bevor jemand überhaupt
//    hinsehen konnte.
function sv_erinnerung_faellig(array $vorgang, int $jetzt, int $stunden = SV_ERINNERUNG_STUNDEN): bool
{
    if (($vorgang['status'] ?? '') !== 'neu')            { return false; }
    if (($vorgang['erinnert_am'] ?? null) !== null)      { return false; }

    $eroeffnet = strtotime((string)($vorgang['eroeffnet_am'] ?? ''));
    if ($eroeffnet === false) { return false; }

    return ($jetzt - $eroeffnet) >= $stunden * 3600;
}

// Der Betreff der Erinnerungs- und der Eingangsmail.
//
// KEIN ANFRAGETEXT (ENT-538, Entscheidung 6). Mail ist der unsicherste
// Kanal; schreibt ein Kunde entgegen dem Hinweis doch einen Namen in die
// Schilderung, soll der nicht zusätzlich in einem Postfach liegen. Der
// Betreff des Vorgangs steht drin, weil ohne ihn niemand erkennt, welcher
// gemeint ist — er ist die einzige Zeile, die der Kunde selbst formuliert,
// und darum die einzige, die abzuwägen war.
function sv_mail_betreff(string $mandantName, string $betreff, bool $erinnerung): string
{
    $vorn = $erinnerung ? 'Erinnerung: Supportanfrage offen' : 'Neue Supportanfrage';
    return sv_einzeilig($vorn . ' — ' . $mandantName . ': ' . $betreff, 300);
}

function sv_mail_text(string $mandantName, string $betreff, string $art,
                      bool $erinnerung, ?string $link): string
{
    $zeilen = [];
    $zeilen[] = $erinnerung
        ? 'Diese Supportanfrage steht seit über ' . SV_ERINNERUNG_STUNDEN
          . ' Stunden unbearbeitet:'
        : 'Es ist eine neue Supportanfrage eingegangen:';
    $zeilen[] = '';
    $zeilen[] = 'Betrieb:  ' . $mandantName;
    $zeilen[] = 'Art:      ' . sv_art_wort($art);
    $zeilen[] = 'Betreff:  ' . $betreff;
    $zeilen[] = '';
    // Der Link kommt aus basis_url() und damit aus dem Deploy, nie aus der
    // Anfrage (ENT-501). Fehlt er, wird das gesagt statt eine halbe Adresse
    // zu bauen.
    $zeilen[] = $link !== null
        ? 'Ansehen: ' . $link
        : 'Im Betreiber-Bereich unter „Support" ansehen.';
    $zeilen[] = '';
    $zeilen[] = 'Der Text der Anfrage steht bewusst nicht in dieser E-Mail.';
    return implode("\n", $zeilen);
}

// Die Arten in Worten — EINE Stelle, damit Oberfläche und E-Mail nicht
// verschiedene Wörter für dasselbe verwenden.
function sv_art_wort(string $art): string
{
    return match ($art) {
        'stoerung' => 'Störung',
        'wunsch'   => 'Wunsch',
        default    => 'Frage',
    };
}

// Die Status in Worten. 'wartet_auf_kunde' heisst bewusst nicht „offen" und
// nicht „erledigt" — es ist die dritte Aussage, und sie ist der Grund,
// warum es vier Status gibt.
function sv_status_wort(string $status): string
{
    return match ($status) {
        'neu'              => 'Neu',
        'in_arbeit'        => 'In Arbeit',
        'wartet_auf_kunde' => 'Wartet auf Kunde',
        'erledigt'         => 'Erledigt',
        default            => 'Unbekannt',
    };
}

// ── Der Status folgt der Nachricht ────────────────────────────────────
//
// Wer antwortet, hat den Ball abgegeben — das soll der Vorrat von selbst
// wissen. Ein Status, der von Hand nachgezogen werden muss, wird beim
// dritten Mal vergessen, und danach stimmt die Liste nicht mehr.
//
// Reine Funktion, damit die Regel an einer Stelle steht und prüfbar ist:
//
//  - Der Betreiber antwortet  -> 'wartet_auf_kunde'. Nicht 'erledigt':
//    Ob etwas erledigt ist, entscheidet nicht der, der gerade geschrieben
//    hat.
//  - Der Kunde antwortet      -> 'in_arbeit'. Auch aus 'erledigt' heraus:
//    Wer auf einen abgeschlossenen Vorgang antwortet, hat ein Anliegen,
//    keine Nachbemerkung. Ein neuer Vorgang wäre der zweite mit derselben
//    Sache.
//  - 'neu' bleibt 'neu', wenn der Kunde nachschiebt: Es hat noch niemand
//    hingesehen, und die Erinnerung soll weiterlaufen.
function sv_status_nach_antwort(string $aktuell, string $seite): string
{
    if ($seite === 'betreiber') { return 'wartet_auf_kunde'; }
    return $aktuell === 'neu' ? 'neu' : 'in_arbeit';
}

// ── Datenbank ─────────────────────────────────────────────────────────
//
// Jede Funktion bekommt ihr PDO übergeben und holt es sich nie selbst --
// dieselbe Bauart wie support.php. Das Verbinden gehört dem Aufrufer, damit
// hier nichts entscheidet, WELCHE Datenbank gemeint ist.

function sv_tabellen_da(PDO $stamm): bool
{
    return hat_tabelle($stamm, 'support_vorgang') && hat_tabelle($stamm, 'support_nachricht');
}

// Einen Vorgang eröffnen. Gibt die Id zurück.
//
// Vorgang und erste Nachricht entstehen zusammen in EINER Transaktion: Ein
// Vorgang ohne Schilderung wäre ein leerer Eintrag im Vorrat, den niemand
// einordnen kann -- und genau das entstünde, bräche es zwischen den beiden
// Schreibvorgängen ab.
function sv_einreichen(PDO $stamm, int $mandantId, array $werte,
                       string $melder, string $melderRolle): int
{
    $stamm->beginTransaction();
    try {
        $s = $stamm->prepare(
            'INSERT INTO support_vorgang
               (mandant_id, betreff, art, status, melder_name, melder_rolle,
                bildschirm, umgebung)
             VALUES (?, ?, ?, \'neu\', ?, ?, ?, ?)'
        );
        $s->execute([
            $mandantId,
            $werte['betreff'],
            $werte['art'],
            mb_substr($melder, 0, 200),
            mb_substr($melderRolle, 0, 200),
            $werte['bildschirm'],
            $werte['umgebung'],
        ]);
        $id = (int)$stamm->lastInsertId();

        $stamm->prepare(
            'INSERT INTO support_nachricht (vorgang_id, seite, autor, text)
             VALUES (?, \'kunde\', ?, ?)'
        )->execute([$id, mb_substr($melder, 0, 200), $werte['text']]);

        $stamm->commit();
        return $id;
    } catch (Throwable $e) {
        $stamm->rollBack();
        throw $e;
    }
}

// Die Liste. Ein einziger Weg für beide Seiten, mit zwei Filtern:
//
//  - $mandantId gesetzt  -> nur die Vorgänge dieses Betriebs (die
//    Kundensicht). NULL heisst „alle" und ist der Betreiber-Vorrat.
//  - $nurOffen           -> ohne 'erledigt' und ohne 'wartet_auf_kunde'.
//
// Eine zweite Abfrage für die zweite Seite wären zwei Sichtbarkeitsregeln,
// die auseinanderlaufen können -- dieselbe Überlegung wie in
// mitteilungen.php.
function sv_liste(PDO $stamm, ?int $mandantId = null, bool $nurOffen = false): array
{
    $wo = []; $werte = [];
    if ($mandantId !== null) { $wo[] = 'v.mandant_id = ?'; $werte[] = $mandantId; }
    if ($nurOffen) {
        $wo[] = 'v.status IN (' . implode(',', array_fill(0, count(SV_STATUS_OFFEN), '?')) . ')';
        foreach (SV_STATUS_OFFEN as $st) { $werte[] = $st; }
    }
    $bedingung = $wo ? ' WHERE ' . implode(' AND ', $wo) : '';

    // Sortiert nach letzter Bewegung, nicht nach Eröffnung: Der Vorrat soll
    // oben zeigen, wo gerade etwas passiert ist.
    $s = $stamm->prepare(
        'SELECT v.id, v.mandant_id, v.betreff, v.art, v.status, v.melder_name,
                v.melder_rolle, v.bildschirm, v.umgebung, v.eroeffnet_am,
                v.geaendert_am, v.erinnert_am,
                (SELECT COUNT(*) FROM support_nachricht n WHERE n.vorgang_id = v.id) AS nachrichten,
                (SELECT n2.seite FROM support_nachricht n2 WHERE n2.vorgang_id = v.id
                  ORDER BY n2.id DESC LIMIT 1) AS letzte_seite
           FROM support_vorgang v' . $bedingung . '
          ORDER BY COALESCE(v.geaendert_am, v.eroeffnet_am) DESC, v.id DESC
          LIMIT 500'
    );
    $s->execute($werte);
    return $s->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// Ein einzelner Vorgang. $mandantId eingrenzen heisst: Ein Kunde erreicht
// über diesen Weg NIE den Vorgang eines anderen Betriebs -- die Eingrenzung
// steht in der Abfrage, nicht in einer Prüfung danach.
function sv_detail(PDO $stamm, int $id, ?int $mandantId = null): ?array
{
    $wo = 'v.id = ?'; $werte = [$id];
    if ($mandantId !== null) { $wo .= ' AND v.mandant_id = ?'; $werte[] = $mandantId; }

    $s = $stamm->prepare(
        'SELECT v.id, v.mandant_id, v.betreff, v.art, v.status, v.melder_name,
                v.melder_rolle, v.bildschirm, v.umgebung, v.eroeffnet_am,
                v.geaendert_am, v.erledigt_am, v.erinnert_am
           FROM support_vorgang v WHERE ' . $wo . ' LIMIT 1'
    );
    $s->execute($werte);
    $r = $s->fetch(PDO::FETCH_ASSOC);
    return $r === false ? null : $r;
}

function sv_nachrichten(PDO $stamm, int $vorgangId): array
{
    $s = $stamm->prepare(
        'SELECT id, seite, autor, text, erstellt_am
           FROM support_nachricht WHERE vorgang_id = ? ORDER BY id ASC'
    );
    $s->execute([$vorgangId]);
    return $s->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// Eine Antwort anhängen und den Status mitziehen (siehe
// sv_status_nach_antwort). Gibt den neuen Status zurück, oder null, wenn es
// den Vorgang nicht gibt beziehungsweise er dem Betrieb nicht gehört.
function sv_antwort(PDO $stamm, int $id, string $seite, string $autor,
                    string $text, ?int $mandantId = null): ?string
{
    $vorgang = sv_detail($stamm, $id, $mandantId);
    if ($vorgang === null) { return null; }

    $neu = sv_status_nach_antwort((string)$vorgang['status'], $seite);

    $stamm->beginTransaction();
    try {
        $stamm->prepare(
            'INSERT INTO support_nachricht (vorgang_id, seite, autor, text)
             VALUES (?, ?, ?, ?)'
        )->execute([$id, $seite, mb_substr($autor, 0, 200),
                    mb_substr($text, 0, SV_MAX_TEXT)]);

        $stamm->prepare(
            'UPDATE support_vorgang SET status = ?, geaendert_am = NOW() WHERE id = ?'
        )->execute([$neu, $id]);

        $stamm->commit();
        return $neu;
    } catch (Throwable $e) {
        $stamm->rollBack();
        throw $e;
    }
}

// Status von Hand setzen (nur der Betreiber). 'erledigt' hält zusätzlich
// fest, WANN -- ohne das liesse sich später nicht sagen, wie lange ein
// Vorgang offen war.
function sv_status_setzen(PDO $stamm, int $id, string $status): bool
{
    if (!sv_status_gueltig($status)) { return false; }
    $s = $stamm->prepare(
        'UPDATE support_vorgang
            SET status = ?, geaendert_am = NOW(),
                erledigt_am = CASE WHEN ? = \'erledigt\' THEN NOW() ELSE NULL END
          WHERE id = ?'
    );
    $s->execute([$status, $status, $id]);
    return $s->rowCount() > 0;
}

// Wie viele Vorgänge warten auf UNS. Der Zähler der Übersicht.
function sv_zaehler_offen(PDO $stamm, ?int $mandantId = null): int
{
    $wo = 'status IN (' . implode(',', array_fill(0, count(SV_STATUS_OFFEN), '?')) . ')';
    $werte = SV_STATUS_OFFEN;
    if ($mandantId !== null) { $wo .= ' AND mandant_id = ?'; $werte[] = $mandantId; }
    $s = $stamm->prepare('SELECT COUNT(*) FROM support_vorgang WHERE ' . $wo);
    $s->execute($werte);
    return (int)$s->fetchColumn();
}

// Die Vorgänge, für die eine Erinnerung ansteht. Die Auswahl steht in SQL,
// die Entscheidung in sv_erinnerung_faellig() -- der Aufrufer prüft jeden
// Treffer noch einmal mit der reinen Funktion, damit die Regel an einer
// Stelle steht und nicht zweimal formuliert ist.
function sv_faellige_erinnerungen(PDO $stamm, int $stunden = SV_ERINNERUNG_STUNDEN): array
{
    $s = $stamm->prepare(
        'SELECT v.id, v.mandant_id, v.betreff, v.art, v.status, v.eroeffnet_am,
                v.erinnert_am, m.name AS mandant_name
           FROM support_vorgang v
           LEFT JOIN mandant m ON m.id = v.mandant_id
          WHERE v.status = \'neu\' AND v.erinnert_am IS NULL
            AND v.eroeffnet_am <= DATE_SUB(NOW(), INTERVAL ? HOUR)
          ORDER BY v.id ASC LIMIT 50'
    );
    $s->execute([$stunden]);
    return $s->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// Die Erinnerung als gesendet vermerken -- VOR dem Versand und nur, wenn
// der Vermerk noch frei war.
//
// Das ist die Sperre gegen doppelten Versand, und sie liegt bewusst in der
// Datenbank statt im Ablauf: Laufen später mehrere Anlagen mit eigenem
// Zeitgeber gegen denselben Stamm, greift genau einer zu; die anderen
// bekommen rowCount() === 0 und schweigen. Ein Vermerk NACH dem Versand
// hiesse, dass ein Abbruch dazwischen die Mail beim nächsten Lauf
// wiederholt.
function sv_erinnerung_merken(PDO $stamm, int $id): bool
{
    $s = $stamm->prepare(
        'UPDATE support_vorgang SET erinnert_am = NOW()
          WHERE id = ? AND erinnert_am IS NULL'
    );
    $s->execute([$id]);
    return $s->rowCount() === 1;
}

// Die Empfänger der Benachrichtigung: alle aktiven Betreiber-Konten.
//
// Keine eigene Adressliste und kein Deploy-Wert -- wer ein Konto hat,
// arbeitet am Vorrat, und wer keines mehr hat, soll auch keine Post mehr
// bekommen. Eine zweite Liste liefe auseinander, sobald jemand geht.
function sv_empfaenger(PDO $stamm): array
{
    $s = $stamm->query('SELECT name, email FROM betreiber WHERE aktiv = 1 ORDER BY id ASC');
    return $s->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// ── Benachrichtigung ──────────────────────────────────────────────────
//
// EINE Stelle für beide Anlässe -- Eingang und Erinnerung. Zwei Versender
// mit denselben Empfängern und fast demselben Text liefen auseinander,
// sobald einer davon angepasst wird.
//
// DER VERSAND DARF DIE ANFRAGE NIE SCHEITERN LASSEN. Ist SMTP nicht
// eingerichtet oder der Server nicht erreichbar, ist der Vorgang trotzdem
// eingegangen -- er steht im Vorrat, und dort findet ihn der Betreiber
// auch ohne Post. Umgekehrt wäre es eine Anfrage, die der Kunde für
// gestellt hält und die es nicht gibt.
//
// Gibt zurück, was tatsächlich geschah: Zahl der erreichten Empfänger und
// die Lage. 'kein_versand' und 'niemand_da' sind verschiedene Aussagen --
// nicht eingerichtet ist etwas anderes als kein aktives Konto.
function sv_benachrichtigen(PDO $stamm, array $vorgang, string $mandantName,
                            bool $erinnerung, ?string $basis): array
{
    if (!function_exists('smtp_senden') || !function_exists('smtp_konfiguriert')) {
        return ['gesendet' => 0, 'lage' => 'kein_versand'];
    }
    if (!smtp_konfiguriert()) {
        return ['gesendet' => 0, 'lage' => 'kein_versand'];
    }

    $empfaenger = sv_empfaenger($stamm);
    if ($empfaenger === []) {
        return ['gesendet' => 0, 'lage' => 'niemand_da'];
    }

    $betreff = (string)($vorgang['betreff'] ?? '');
    $art     = (string)($vorgang['art'] ?? 'frage');
    $link    = $basis !== null ? rtrim($basis, '/') . '/betreiber.html' : null;

    $mailBetreff = sv_mail_betreff($mandantName, $betreff, $erinnerung);
    $text        = sv_mail_text($mandantName, $betreff, $art, $erinnerung, $link);
    $html        = '<p>' . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8')) . '</p>';

    $gesendet = 0;
    foreach ($empfaenger as $e) {
        try {
            smtp_senden((string)$e['email'], (string)$e['name'], $mailBetreff, $html, $text);
            $gesendet++;
        } catch (Throwable $ex) {
            // Ein Empfänger, den es nicht mehr gibt, darf die übrigen nicht
            // aufhalten. Was schiefging, gehört nicht in die Antwort an den
            // Kunden -- die Fehlermeldung des Mailservers kann Host und
            // Benutzer enthalten.
        }
    }
    return ['gesendet' => $gesendet, 'lage' => $gesendet > 0 ? 'ok' : 'fehlgeschlagen'];
}

// ── Die benannte Ausnahme ─────────────────────────────────────────────
//
// Dies ist die EINZIGE Funktion, über die Mandanten-Code die Betreiber-Ebene
// erreicht. backend/betreiber.php hält fest, dass keine Abfrage beides
// vermischt -- hier geschieht es, weil ein Vorgang von der einen Seite zur
// anderen muss, und es geschieht an genau einer Stelle, damit es auffällt,
// wenn jemand eine zweite baut.
//
// $betrieb ist die Mandanten-Verbindung (db()), $stamm die des Betreibers
// (betreiber_db()). Aus dem Namen der Mandanten-Datenbank wird zugeordnet,
// wer hier fragt -- siehe sv_mandant_waehlen() für die drei möglichen
// Antworten.
function sv_mandant_bestimmen(PDO $stamm, PDO $betrieb): array
{
    if (!hat_tabelle($stamm, 'mandant')) {
        return ['id' => null, 'lage' => 'kein_stamm', 'name' => ''];
    }

    $dbName = '';
    try {
        $dbName = (string)($betrieb->query('SELECT DATABASE()')->fetchColumn() ?: '');
    } catch (Throwable $e) {
        // Kein Name, keine Zuordnung -- und ausdrücklich kein Rückfall auf
        // den ersten Mandanten.
    }

    $mandanten = $stamm->query('SELECT id, name, db_name FROM mandant ORDER BY id ASC')
                       ->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $treffer = sv_mandant_waehlen($mandanten, $dbName);

    $name = '';
    foreach ($mandanten as $m) {
        if ((int)$m['id'] === ($treffer['id'] ?? -1)) { $name = (string)$m['name']; break; }
    }
    return ['id' => $treffer['id'], 'lage' => $treffer['lage'], 'name' => $name];
}

// ── Der Nachlauf ──────────────────────────────────────────────────────
//
// Was der Zeitgeber tut. Steht HIER und nicht im Endpunkt, damit die Regel
// bei der Sache liegt und sich prüfen lässt -- der Endpunkt ist nur der
// Auslöser.
//
// Die Reihenfolge ist Absicht: erst vermerken, dann versenden. Bricht es
// dazwischen ab, fehlt eine Erinnerung -- schickte man umgekehrt, käme sie
// beim nächsten Lauf ein zweites Mal. Von beiden Fehlern ist der erste der
// harmlosere: Der Vorgang steht weiter im Vorrat und im Zähler.
function sv_erinnerungen_versenden(PDO $stamm, ?string $basis,
                                   int $stunden = SV_ERINNERUNG_STUNDEN): array
{
    if (!sv_tabellen_da($stamm)) {
        return ['eingerichtet' => false, 'erinnert' => 0, 'vorgaenge' => []];
    }

    $getan = [];
    $jetzt = time();
    foreach (sv_faellige_erinnerungen($stamm, $stunden) as $v) {
        // Die Auswahl kam aus SQL, die Entscheidung trifft die reine
        // Funktion -- damit die Regel an EINER Stelle steht und eine
        // Änderung an ihr nicht an zwei Orten nachgezogen werden muss.
        if (!sv_erinnerung_faellig($v, $jetzt, $stunden)) { continue; }

        // Die Sperre: Wer hier nicht zum Zug kommt, war zu spät und
        // schweigt. Bei mehreren gleichzeitig laufenden Zeitgebern schickt
        // genau einer.
        if (!sv_erinnerung_merken($stamm, (int)$v['id'])) { continue; }

        $name = trim((string)($v['mandant_name'] ?? '')) !== ''
            ? (string)$v['mandant_name'] : 'Unbekannter Mandant';
        $post = sv_benachrichtigen($stamm, $v, $name, true, $basis);
        $getan[] = ['id' => (int)$v['id'], 'post' => $post['lage'],
                    'gesendet' => $post['gesendet']];
    }

    return ['eingerichtet' => true, 'erinnert' => count($getan), 'vorgaenge' => $getan];
}
