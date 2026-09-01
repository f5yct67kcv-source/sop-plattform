<?php
declare(strict_types=1);
// Zwei-Faktor-Anmeldung fuer Verwaltungszugaenge (ENT-076).
//
// Verfahren: TOTP nach RFC 6238 -- sechsstellige Zahl, die sich alle 30
// Sekunden aendert, erzeugt aus einem gemeinsamen Geheimnis und der Uhrzeit.
// Das koennen alle gaengigen Authenticator-Apps.
//
// KEIN ZUSATZPAKET. Das Verfahren sind rund vierzig Zeilen; HMAC und Base32
// kann PHP von Haus aus. Ein Paket nachzuladen hiesse, den Deploy und die
// Abhaengigkeitspflege zu aendern -- fuer vierzig Zeilen kein guter Tausch.
//
// WARUM NICHT SMS: Eine SIM-Karte laesst sich mit etwas Aufwand uebernehmen,
// und jede Nachricht kostet. Die App braucht keinen Empfang und nichts.
//
// WARUM NUR FUER ADMINS (Entscheid des Projektinhabers): Am Admin-Zugang
// haengt die ganze Personalakte -- AHV-Nummern, Aufenthaltsstatus,
// Registerauszuege. In der Mitarbeiter-App sieht jemand nur die eigenen
// Schichten. Dort stimmt das Verhaeltnis von Umstand zu Schutz nicht.

const ZF_ZIFFERN   = 6;     // Laenge des Codes
const ZF_FENSTER   = 30;    // Sekunden je Code
const ZF_TOLERANZ  = 1;     // wie viele Fenster davor/danach noch gelten
const ZF_GERAET_TAGE = 14;  // wie lange ein Geraet gemerkt wird (Entscheid)
const ZF_NOTFALLCODES = 10; // wie viele Notfallcodes es beim Einrichten gibt

// ── Base32 (RFC 4648), wie Authenticator-Apps es erwarten ───────────────
const ZF_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function zf_base32_kodieren(string $roh): string
{
    $bits = '';
    foreach (str_split($roh) as $z) {
        $bits .= str_pad(decbin(ord($z)), 8, '0', STR_PAD_LEFT);
    }
    $aus = '';
    foreach (str_split($bits, 5) as $stueck) {
        $aus .= ZF_B32[bindec(str_pad($stueck, 5, '0', STR_PAD_RIGHT))];
    }
    return $aus;
}

function zf_base32_dekodieren(string $b32): string
{
    $b32 = strtoupper(str_replace([' ', '='], '', $b32));
    $bits = '';
    foreach (str_split($b32) as $z) {
        $i = strpos(ZF_B32, $z);
        if ($i === false) { return ''; }         // ungueltiges Zeichen
        $bits .= str_pad(decbin($i), 5, '0', STR_PAD_LEFT);
    }
    $aus = '';
    foreach (str_split($bits, 8) as $stueck) {
        if (strlen($stueck) === 8) { $aus .= chr(bindec($stueck)); }
    }
    return $aus;
}

// ── Der Code zu einem Zeitpunkt ─────────────────────────────────────────
// $zaehler ist die Nummer des 30-Sekunden-Fensters seit 1970.
function zf_code(string $geheimBase32, int $zaehler): string
{
    $schluessel = zf_base32_dekodieren($geheimBase32);
    if ($schluessel === '') { return ''; }
    // Der Zaehler als 8 Bytes, hoechstwertiges zuerst.
    $bin = pack('N*', 0, $zaehler);
    $hmac = hash_hmac('sha1', $bin, $schluessel, true);
    // "Dynamic truncation" nach RFC 4226: Das letzte Halbbyte sagt, wo die
    // vier Bytes stehen, aus denen die Zahl gebildet wird.
    $versatz = ord($hmac[19]) & 0x0F;
    $zahl = ((ord($hmac[$versatz])     & 0x7F) << 24)
          | ((ord($hmac[$versatz + 1]) & 0xFF) << 16)
          | ((ord($hmac[$versatz + 2]) & 0xFF) << 8)
          |  (ord($hmac[$versatz + 3]) & 0xFF);
    return str_pad((string)($zahl % (10 ** ZF_ZIFFERN)), ZF_ZIFFERN, '0', STR_PAD_LEFT);
}

// Stimmt der eingegebene Code? Prueft ein Fenster davor und danach, weil
// die Uhr im Handy und die auf dem Server selten genau gleich gehen.
// Gibt das getroffene Fenster zurueck oder null -- die Nummer wird gemerkt,
// damit derselbe Code nicht ein zweites Mal gilt.
function zf_pruefen(string $geheimBase32, string $eingabe, int $jetzt): ?int
{
    $eingabe = preg_replace('/\D/', '', $eingabe) ?? '';
    if (strlen($eingabe) !== ZF_ZIFFERN) { return null; }
    $aktuell = intdiv($jetzt, ZF_FENSTER);
    for ($v = -ZF_TOLERANZ; $v <= ZF_TOLERANZ; $v++) {
        // hash_equals: Der Vergleich soll nicht ueber seine Dauer verraten,
        // wie viele Stellen schon stimmten.
        if (hash_equals(zf_code($geheimBase32, $aktuell + $v), $eingabe)) {
            return $aktuell + $v;
        }
    }
    return null;
}

// ── Geheimnis und Adresse fuer die Authenticator-App ────────────────────
function zf_geheimnis_erzeugen(): string
{
    // 20 Byte Zufall = 160 Bit, wie im Standard empfohlen.
    return zf_base32_kodieren(random_bytes(20));
}

// Die Adresse, die eine Authenticator-App erwartet. Der Betriebsname steht
// darin, damit im Handy nicht nur "hansmuster" ohne Zusammenhang steht.
function zf_adresse(string $loginName, string $geheimBase32, string $betrieb = 'CUPI 24'): string
{
    return 'otpauth://totp/' . rawurlencode($betrieb . ':' . $loginName)
         . '?secret=' . $geheimBase32
         . '&issuer=' . rawurlencode($betrieb)
         . '&digits=' . ZF_ZIFFERN
         . '&period=' . ZF_FENSTER;
}

// Zum Abtippen in Vierergruppen -- eine 32-stellige Zeichenkette am Stueck
// vertippt sich jeder.
function zf_lesbar(string $geheimBase32): string
{
    return trim(chunk_split($geheimBase32, 4, ' '));
}

// ── Notfallcodes ────────────────────────────────────────────────────────
// Format "abcd-efgh": kurz genug zum Abschreiben, lang genug zum Nichtraten.
// Ohne die Zeichen, die man beim Abschreiben verwechselt (0/O, 1/l/I).
const ZF_CODE_ZEICHEN = 'abcdefghjkmnpqrstuvwxyz23456789';

function zf_notfallcode(): string
{
    $teil = static function (): string {
        $s = '';
        for ($i = 0; $i < 4; $i++) {
            $s .= ZF_CODE_ZEICHEN[random_int(0, strlen(ZF_CODE_ZEICHEN) - 1)];
        }
        return $s;
    };
    return $teil() . '-' . $teil();
}

// Vereinheitlicht, was jemand abtippt: Grossschreibung und fehlende
// Bindestriche sollen nicht der Grund sein, warum ein Notfallcode
// nicht angenommen wird.
function zf_code_normalisieren(string $code): string
{
    $c = strtolower(preg_replace('/[^a-zA-Z0-9]/', '', $code) ?? '');
    return strlen($c) === 8 ? substr($c, 0, 4) . '-' . substr($c, 4) : $c;
}

// ══════════════════════════════════════════ DATENBANK-TEIL
// Alles hier vertraegt fehlende Tabellen: Wer die Einrichtung noch nicht
// ausgefuehrt hat, soll sich nicht aussperren, sondern schlicht keine
// Zwei-Faktor-Anmeldung haben.

function zf_tabellen_da(PDO $pdo): bool
{
    static $da = null;
    if ($da === null) {
        $da = (bool)$pdo->query("SHOW TABLES LIKE 'zwei_faktor'")->fetchColumn();
    }
    return $da;
}

// Der Stand EINER Person. Gibt null zurueck, wenn nichts eingerichtet ist.
function zf_stand(PDO $pdo, int $person): ?array
{
    if (!zf_tabellen_da($pdo)) { return null; }
    $s = $pdo->prepare('SELECT geheimnis, aktiv, letztes_fenster, bestaetigt_am
                        FROM zwei_faktor WHERE mitarbeiter_id = ?');
    $s->execute([$person]);
    $r = $s->fetch();
    return $r ?: null;
}

function zf_ist_an(PDO $pdo, int $person): bool
{
    $st = zf_stand($pdo, $person);
    return $st !== null && (bool)$st['aktiv'];
}

// Neues Geheimnis anlegen oder ein noch unbestaetigtes ersetzen. Ein
// BESTAETIGTES wird nie ueberschrieben -- sonst koennte ein uebernommener
// Zugang die Zwei-Faktor-Anmeldung einfach neu einrichten.
function zf_einrichten(PDO $pdo, int $person): string
{
    $geheim = zf_geheimnis_erzeugen();
    $pdo->prepare(
        'INSERT INTO zwei_faktor (mitarbeiter_id, geheimnis, aktiv) VALUES (?, ?, 0)
         ON DUPLICATE KEY UPDATE geheimnis = VALUES(geheimnis), aktiv = 0,
                                 eingerichtet_am = NOW(), bestaetigt_am = NULL'
    )->execute([$person, $geheim]);
    return $geheim;
}

// Code pruefen UND gegen Wiederverwendung sperren. Ohne das koennte jemand,
// der einen Code mitliest, ihn innerhalb desselben Fensters selbst benutzen.
function zf_code_einloesen(PDO $pdo, int $person, string $eingabe, int $jetzt): bool
{
    $st = zf_stand($pdo, $person);
    if ($st === null) { return false; }
    $fenster = zf_pruefen((string)$st['geheimnis'], $eingabe, $jetzt);
    if ($fenster === null) { return false; }
    if ($st['letztes_fenster'] !== null && (int)$st['letztes_fenster'] >= $fenster) {
        return false;                    // dieser Code war schon dran
    }
    $pdo->prepare('UPDATE zwei_faktor SET letztes_fenster = ? WHERE mitarbeiter_id = ?')
        ->execute([$fenster, $person]);
    return true;
}

function zf_bestaetigen(PDO $pdo, int $person): void
{
    $pdo->prepare('UPDATE zwei_faktor SET aktiv = 1, bestaetigt_am = NOW()
                   WHERE mitarbeiter_id = ?')->execute([$person]);
}

// Abschalten raeumt ALLES weg: Geheimnis, Notfallcodes, gemerkte Geraete.
// Ein Rest davon waere ein Schluessel, von dem niemand mehr weiss.
function zf_abschalten(PDO $pdo, int $person): void
{
    if (!zf_tabellen_da($pdo)) { return; }
    foreach (['zwei_faktor_geraete', 'zwei_faktor_codes', 'zwei_faktor'] as $t) {
        $pdo->prepare("DELETE FROM $t WHERE mitarbeiter_id = ?")->execute([$person]);
    }
}

// ── Notfallcodes ────────────────────────────────────────────────────────
// Erzeugt einen frischen Satz und gibt ihn im KLARTEXT zurueck -- das ist
// das einzige Mal, dass es ihn im Klartext gibt.
function zf_notfallcodes_neu(PDO $pdo, int $person): array
{
    $pdo->prepare('DELETE FROM zwei_faktor_codes WHERE mitarbeiter_id = ?')->execute([$person]);
    $ein = $pdo->prepare('INSERT INTO zwei_faktor_codes (mitarbeiter_id, code_hash) VALUES (?, ?)');
    $codes = [];
    for ($i = 0; $i < ZF_NOTFALLCODES; $i++) {
        $code = zf_notfallcode();
        $codes[] = $code;
        $ein->execute([$person, password_hash($code, PASSWORD_DEFAULT)]);
    }
    return $codes;
}

function zf_notfallcodes_offen(PDO $pdo, int $person): int
{
    if (!zf_tabellen_da($pdo)) { return 0; }
    $s = $pdo->prepare('SELECT COUNT(*) FROM zwei_faktor_codes
                        WHERE mitarbeiter_id = ? AND benutzt_am IS NULL');
    $s->execute([$person]);
    return (int)$s->fetchColumn();
}

// Einen Notfallcode einloesen. Er gilt genau einmal.
function zf_notfallcode_einloesen(PDO $pdo, int $person, string $eingabe): bool
{
    if (!zf_tabellen_da($pdo)) { return false; }
    $code = zf_code_normalisieren($eingabe);
    if (!preg_match('/^[a-z2-9]{4}-[a-z2-9]{4}$/', $code)) { return false; }
    $s = $pdo->prepare('SELECT id, code_hash FROM zwei_faktor_codes
                        WHERE mitarbeiter_id = ? AND benutzt_am IS NULL');
    $s->execute([$person]);
    foreach ($s->fetchAll() as $zeile) {
        if (password_verify($code, (string)$zeile['code_hash'])) {
            $pdo->prepare('UPDATE zwei_faktor_codes SET benutzt_am = NOW() WHERE id = ?')
                ->execute([(int)$zeile['id']]);
            return true;
        }
    }
    return false;
}

// ── Vertrauenswuerdige Geraete ──────────────────────────────────────────
function zf_geraet_merken(PDO $pdo, int $person, string $bezeichnung): string
{
    $wert = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO zwei_faktor_geraete (mitarbeiter_id, merkmal_hash, bezeichnung, letzte_nutzung)
                   VALUES (?, ?, ?, NOW())')
        ->execute([$person, hash('sha256', $wert), mb_substr($bezeichnung, 0, 120)]);
    return $wert;
}

// Ist dieses Geraet gemerkt und noch nicht abgelaufen? Frischt bei Erfolg
// den Stempel auf -- die 14 Tage laufen aber ab dem EINRICHTEN, nicht ab
// der letzten Nutzung. Sonst waere ein staendig benutztes Geraet nie faellig.
function zf_geraet_gilt(PDO $pdo, int $person, string $wert): bool
{
    if (!zf_tabellen_da($pdo) || $wert === '') { return false; }
    $s = $pdo->prepare('SELECT id FROM zwei_faktor_geraete
                        WHERE mitarbeiter_id = ? AND merkmal_hash = ?
                          AND erstellt_am > DATE_SUB(NOW(), INTERVAL ' . ZF_GERAET_TAGE . ' DAY)');
    $s->execute([$person, hash('sha256', $wert)]);
    $id = $s->fetchColumn();
    if ($id === false) { return false; }
    $pdo->prepare('UPDATE zwei_faktor_geraete SET letzte_nutzung = NOW() WHERE id = ?')
        ->execute([(int)$id]);
    return true;
}

function zf_geraete_liste(PDO $pdo, int $person): array
{
    if (!zf_tabellen_da($pdo)) { return []; }
    $s = $pdo->prepare('SELECT id, bezeichnung, erstellt_am, letzte_nutzung
                        FROM zwei_faktor_geraete
                        WHERE mitarbeiter_id = ?
                          AND erstellt_am > DATE_SUB(NOW(), INTERVAL ' . ZF_GERAET_TAGE . ' DAY)
                        ORDER BY letzte_nutzung DESC');
    $s->execute([$person]);
    return array_map(fn($z) => ['id' => (int)$z['id'], 'bezeichnung' => $z['bezeichnung'],
        'erstellt_am' => $z['erstellt_am'], 'letzte_nutzung' => $z['letzte_nutzung']], $s->fetchAll());
}

// Abgelaufene Geraete gelegentlich wegraeumen -- ein abgelaufener Eintrag
// ist wirkungslos, aber er steht in der Liste und verwirrt.
function zf_geraete_aufraeumen(PDO $pdo): void
{
    if (!zf_tabellen_da($pdo)) { return; }
    $pdo->exec('DELETE FROM zwei_faktor_geraete
                WHERE erstellt_am < DATE_SUB(NOW(), INTERVAL ' . ZF_GERAET_TAGE . ' DAY)');
}
