<?php
// Kundenportal: Zugaenge, Einmal-Codes, Sitzungen (ENT-441).
//
// WARUM DIESE DATEI GETRENNT VON db.php UND rechte.php STEHT
//
// Ein Kundenzugang gehoert einem Betriebsfremden. Er darf nichts von dem
// erreichen, was `require_session()` oeffnet -- und das laesst sich nicht
// mit einer Fallunterscheidung IN require_session() sicherstellen, sondern
// nur damit, dass es zwei getrennte Wege gibt. Darum:
//
//   - eigene Tabellen (`kundenzugang`, `kunden_sessions`)
//   - eigene Pruefstelle (`require_kundensession()`)
//   - keine Beruehrung mit `darf()` / `rechte_aus_rollen()`
//
// Ein Kundenzugang hat KEINE Rechte im Sinne von rechte.php. Er hat genau
// eine Eigenschaft: die `kunde_id`. Was er sehen darf, ergibt sich
// ausschliesslich daraus -- und die kommt IMMER aus der Sitzung, nie aus
// der Anfrage. Ein Portal-Endpunkt, der eine kunde_id entgegennaehme,
// waere derselbe Fehler wie ein Zwei-Faktor-Endpunkt, der die Person aus
// der Anfrage liest.
//
// Der Anmelde-Token wandert im selben Kopf `X-Auth-Token` wie der der
// Verwaltung. Das ist unbedenklich, WEIL die Tabellen getrennt sind: Ein
// Kunden-Token findet sich nicht in `sessions`, ein Mitarbeiter-Token
// nicht in `kunden_sessions`. Beide Male ist die Antwort 401.
declare(strict_types=1);

// ── Fristen ───────────────────────────────────────────────────────────
// Der Einmal-Code ist kurz gueltig: Er liegt in einem Postfach, und ein
// Postfach ist offen, solange jemand daran sitzt. Fuenfzehn Minuten reichen,
// um eine Mail zu holen, und sind zu kurz, um einen alten Code spaeter noch
// zu verwenden.
// Der Link zum Passwortsetzen (ENT-448). Dreissig Minuten wie beim
// Ruecksetzlink der Mitarbeitenden (ENT-373) -- er liegt in einem Postfach,
// und ein Postfach ist offen, solange jemand daran sitzt.
const KP_LINK_MINUTEN    = 30;
// Wie viele Links je Zugang in einer Stunde. Schuetzt das Postfach des
// Kunden davor, ueber diesen Weg zugemuellt zu werden.
const KP_LINK_PRO_STUNDE = 5;

const KP_CODE_MINUTEN  = 15;
// Fehlversuche AUF DENSELBEN Code. Sechs Stellen sind eine Million
// Moeglichkeiten; ohne Zaehler waeren sie in Minuten durchprobiert. Die
// Bremse aus anmeldung.php greift hier nicht -- sie haengt an einem
// Login-Namen, und ein Kundenzugang hat keinen.
const KP_CODE_VERSUCHE = 5;
// Wie viele Codes je Zugang in einer Stunde angefordert werden koennen.
// Schuetzt das Postfach des Kunden davor, als Briefkasten missbraucht zu
// werden -- der Versand geht an eine hinterlegte Adresse, nicht an eine
// mitgeschickte, aber zumuellen liesse er sich trotzdem.
const KP_CODE_PRO_STUNDE = 5;

// Sitzungsdauer. Bewusst laenger als bei der Verwaltung (ENT-075: dort
// Minuten bis Stunden) und begruendet aus dem, was daran haengt: ein
// Lesezugang auf die Nachweise EINES Kunden, keine Personalakte, kein
// Schreibweg. Ein Kunde sieht typischerweise monatlich hinein; mit einer
// kurzen Frist waere jeder Besuch eine Neuanmeldung, und Bequemlichkeit
// bringt Leute dazu, sich Wege zu suchen.
const KP_SITZUNG_MAX_TAGE  = 90;   // absolutes Alter, danach immer neu
const KP_SITZUNG_RUHE_TAGE = 30;   // ohne Nutzung

// ── Regeln als reine Funktionen ───────────────────────────────────────
// Ohne Datenbank, damit `pruefungen/` sie wirklich ausfuehren kann. Eine
// Regel, die nur im Zusammenspiel mit MySQL laeuft, wird von den
// Browser-Pruefungen nie erreicht -- und eine Regel, die niemand ausfuehrt,
// ist eine Behauptung.

// Alle Zeiten als Unix-Sekunden.
function kp_sitzung_abgelaufen(int $geboren, int $gesehen, int $jetzt): bool
{
    return ($jetzt - $geboren) > KP_SITZUNG_MAX_TAGE * 86400
        || ($jetzt - $gesehen) > KP_SITZUNG_RUHE_TAGE * 86400;
}

// Zustand eines Einmal-Codes, bevor ueberhaupt verglichen wird.
// Rueckgabe: 'offen' | 'abgelaufen' | 'verbraucht' | 'zu_viele'
//
// Die Reihenfolge ist Absicht: 'verbraucht' zuerst, weil ein bereits
// eingeloester Code auch dann nicht mehr gilt, wenn er noch frisch ist.
function kp_code_zustand(?int $eingeloestAm, int $gueltigBis, int $versuche, int $jetzt): string
{
    if ($eingeloestAm !== null)          { return 'verbraucht'; }
    if ($versuche >= KP_CODE_VERSUCHE)   { return 'zu_viele'; }
    if ($jetzt > $gueltigBis)            { return 'abgelaufen'; }
    return 'offen';
}

// Sechsstellig, mit fuehrenden Nullen. Als Zeichenkette gefuehrt und nicht
// als Zahl: "042315" ist ein gueltiger Code, 42315 waere ein anderer.
function kp_code_erzeugen(): string
{
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

// E-Mail-Adressen werden zum Nachschlagen kleingeschrieben und beschnitten.
// Ohne das meldet sich niemand an, der seine Adresse gross tippt -- und der
// Fehler saehe aus wie "Zugang gibt es nicht".
function kp_email_normal(string $roh): string
{
    return mb_strtolower(trim($roh));
}

// ── Datenbankteil ─────────────────────────────────────────────────────

function kp_tabellen_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'kundenzugang') && hat_tabelle($pdo, 'kunden_sessions');
}

// Die einzige Pruefstelle des Portals. Gibt den Zugang zurueck -- samt
// kunde_id, die JEDER Portal-Endpunkt von hier nimmt und nirgendwo sonst.
//
// aktiv = 1 steht in der Abfrage und nicht in einer nachtraeglichen
// Pruefung: Ein gesperrter Zugang soll im selben Moment nichts mehr
// finden, in dem jemand ihn sperrt -- ohne dass eine laufende Sitzung
// erst ablaufen muss.
function require_kundensession(): array
{
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!$token) {
        json_response(['status' => 'error', 'message' => 'kein Token'], 401);
    }
    $pdo = db();
    if (!kp_tabellen_da($pdo)) {
        // Kein stilles "nicht angemeldet": Die Einrichtung ist nicht
        // gelaufen, und das ist etwas anderes als ein abgelaufener Zugang.
        json_response(['status' => 'error',
            'message' => 'Das Kundenportal ist noch nicht eingerichtet.'], 503);
    }
    $stmt = $pdo->prepare(
        'SELECT z.id, z.kunde_id, z.name, z.email, k.name AS kunde_name,
                s.erstellt_am, s.letzte_nutzung
           FROM kunden_sessions s
           JOIN kundenzugang z ON z.id = s.zugang_id
           JOIN kunden k ON k.id = z.kunde_id
          WHERE s.token = ? AND z.aktiv = 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        json_response(['status' => 'error',
            'message' => 'Die Anmeldung gilt nicht mehr — bitte neu anmelden.'], 401);
    }

    $jetzt   = time();
    $geboren = strtotime((string)$row['erstellt_am']) ?: $jetzt;
    $gesehen = strtotime((string)$row['letzte_nutzung']) ?: $geboren;
    if (kp_sitzung_abgelaufen($geboren, $gesehen, $jetzt)) {
        $pdo->prepare('DELETE FROM kunden_sessions WHERE token = ?')->execute([$token]);
        json_response(['status' => 'error',
            'message' => 'Die Anmeldung ist abgelaufen — bitte neu anmelden.'], 401);
    }

    // Nutzung stempeln, aber nicht bei jedem Klick: Eine Seite laedt
    // mehrere Endpunkte auf einmal (gleiche Ueberlegung wie in db.php).
    if ($jetzt - $gesehen > 300) {
        $pdo->prepare('UPDATE kunden_sessions SET letzte_nutzung = NOW() WHERE token = ?')
            ->execute([$token]);
    }

    // Gelegentlich aufraeumen -- jede tote Sitzung ist ein Token, der
    // irgendwo noch liegt.
    if (random_int(1, 50) === 1) {
        $pdo->exec('DELETE FROM kunden_sessions WHERE erstellt_am < DATE_SUB(NOW(), INTERVAL '
            . KP_SITZUNG_MAX_TAGE . ' DAY)');
        $pdo->exec('DELETE FROM kundenzugang_code WHERE erstellt_am < DATE_SUB(NOW(), INTERVAL 7 DAY)');
    }

    unset($row['erstellt_am'], $row['letzte_nutzung']);
    $row['id']       = (int)$row['id'];
    $row['kunde_id'] = (int)$row['kunde_id'];
    return $row;
}

// Die Objekte, die dieser Zugang sehen darf. EINE Stelle, damit kein
// Endpunkt seine eigene Vorstellung davon entwickelt.
//
// ZWEI Bedingungen, nicht eine -- und die zweite ist die wichtigere:
//
//   (a) Am Objekt sind Kontrollpunkte hinterlegt. Das ist das einzige
//       belastbare Kennzeichen fuer "hier laeuft Revierdienst".
//       objekte.einsatzart taugt dafuer NICHT: Es traegt den Vorgabewert
//       'Revierdienst' und steht darum auch an einem Verkehrsdienst-Objekt.
//   (b) ODER es gibt zu dem Objekt bereits Rundgaenge.
//
// Ohne (b) verschwaende die gesamte Historie eines Objekts in dem Moment,
// in dem jemand dessen letzten Kontrollpunkt loescht -- der Kunde saehe
// dann nicht "keine Kontrollpunkte mehr", sondern gar nichts, und das sieht
// aus wie "hier wurde nie gearbeitet". Ein Nachweis, der sich durch eine
// spaetere Stammdatenpflege aufloest, ist keiner.
//
// Der Zustand des KUNDEN (kunden.aktiv) wird hier bewusst NICHT geprueft:
// Einen Kunden zu archivieren und einen Portalzugang zu sperren sind zwei
// verschiedene Handlungen, und welche die andere nach sich zieht, ist noch
// nicht entschieden (offene Frage in ENT-441). Bis dahin gilt allein
// kundenzugang.aktiv -- die ausdrueckliche Sperre, nicht die stille.
function kp_objekt_ids(PDO $pdo, int $kundeId): array
{
    $stmt = $pdo->prepare(
        'SELECT o.id
           FROM objekte o
          WHERE o.kunde_id = ?
            AND (EXISTS (SELECT 1 FROM kontrollpunkt kp WHERE kp.objekt_id = o.id)
                 OR EXISTS (SELECT 1 FROM rundgang r WHERE r.objekt_id = o.id))
          ORDER BY o.name'
    );
    $stmt->execute([$kundeId]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}
