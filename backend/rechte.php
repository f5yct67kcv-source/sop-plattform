<?php
// Rollen und Rechte (ENT-077, umgebaut mit ENT-440).
//
// GESCHICHTE IN ZWEI SCHRITTEN, damit spaetere Leser nicht raten muessen:
//
//  1. Bis ENT-077 kannte das Werkzeug genau eine Unterscheidung: "Admin
//     ja/nein". 52 von 61 Endpunkten fragten einzeln `$user['ist_admin']`
//     ab. Wer Admin war, sah alles -- die AHV-Nummer, den Aufenthalts-
//     status und die Registerdaten jeder Person im Betrieb. ENT-077 hat
//     daraus vier feste Rollen gemacht, spaeter fuenf (ENT-180).
//
//  2. ENT-077 hielt ausdruecklich fest: FESTE Rollen, keine frei
//     zusammenklickbare Rechte-Matrix -- "ein falsch gesetztes Haekchen
//     oeffnet sonst Personendaten, ohne dass es jemand merkt". Der
//     Projektinhaber hat das mit ENT-440 revidiert, aber nur zur Haelfte:
//     Die fuenf Rollen bleiben als SYSTEMROLLEN bestehen und sind weiterhin
//     nicht veraenderbar; daneben duerfen eigene Profile entstehen. Der
//     Schutz von ENT-077 gilt damit unveraendert fuer den Zustand, in dem
//     der Betrieb heute laeuft -- niemand kann an den geprueften Rollen
//     etwas kaputtklicken, er kann nur DANEBEN etwas Eigenes bauen.
//
// Was ENT-440 sonst aendert: Jeder Bereich hat nicht mehr ein Ja/Nein,
// sondern eine STUFE -- verborgen, lesen, schreiben.
//
// WICHTIG fuer alle, die hier etwas ergaenzen: Es gibt weiterhin genau EINE
// Stelle, an der ein Recht geprueft wird -- darf(). Kein Endpunkt
// entscheidet selbst. Eine zweite Pruefstelle waere eine zweite Wahrheit,
// und Rechte mit zwei Wahrheiten sind keine Rechte.
declare(strict_types=1);

// ── Die Stufen ────────────────────────────────────────────────────────
// Drei Werte, aber nur zwei davon werden je gespeichert: "verborgen" ist
// die Abwesenheit einer Zeile, kein eigener Eintrag. Sonst gaebe es zwei
// Schreibweisen fuer dasselbe (keine Zeile / Zeile mit 'verborgen'), und
// ein Vergleich zweier gleicher Rechtestaende saehe nach einem Unterschied
// aus.
const STUFE_VERBORGEN = 'verborgen';
const STUFE_LESEN     = 'lesen';
const STUFE_SCHREIBEN = 'schreiben';

// Schreiben schliesst Lesen ein. Das ist keine Bequemlichkeit: Wer speichern
// darf, ohne sehen zu duerfen, was er ueberschreibt, ist die gefaehrlichere
// Kombination -- dieselbe Ueberlegung wie bei den vertraulichen Feldern in
// ENT-077 ("wer sie nicht sehen darf, darf sie auch nicht aendern").
function stufe_deckt(string $gesetzt, string $verlangt): bool
{
    if ($gesetzt === STUFE_SCHREIBEN) { return $verlangt === STUFE_LESEN || $verlangt === STUFE_SCHREIBEN; }
    if ($gesetzt === STUFE_LESEN)     { return $verlangt === STUFE_LESEN; }
    return false;
}

// ── Die Bereiche ──────────────────────────────────────────────────────
// 20 Zeilen in 6 Gruppen (ENT-440). Der Schnitt folgt dem, was die
// Endpunkte heute tatsaechlich trennen, und haelt die Trennungen, die
// bereits einzeln entschieden wurden:
//   - Offerten getrennt von Kunden (ENT-181: eine Offerte zeigt Preise und
//     Rabatte, also die Kalkulation -- wer Adressen pflegt, muss sie nicht
//     sehen).
//   - Vertrauliche Angaben getrennt von der uebrigen Personalakte
//     (ENT-072/ENT-077).
//   - Mitteilungen getrennt von den Betriebseinstellungen (ENT-421: wer
//     Listen pflegt, muss darum nicht im Namen des Betriebs sprechen).
//
// BEWUSST KEINE ZEILE "Auswertungen": Der Navigationspunkt Auswertung
// besteht aus Pensen, Auslagenersatz, Abwesenheiten und Arbeitsergebnissen
// -- alle vier haengen bereits an anderen Zeilen hier. Eine eigene Zeile
// waere ein Schalter, der entweder nichts steuert oder als zweite Wahrheit
// neben der ersten steht. Die Rubrik erscheint, wenn eine ihrer Ansichten
// sichtbar ist.
//
// 'stufen' zaehlt die Stufen auf, die es in diesem Bereich UEBERHAUPT gibt.
// Wo es nichts zu schreiben gibt, steht nur 'lesen' -- die Oberflaeche
// zeigt dort zwei Schalter statt drei. Ein Schreibschalter ohne
// Schreibweg waere eine Behauptung.
function bereiche_katalog(): array
{
    return [
        // ── Planung ──
        'einsaetze' => [
            'gruppe' => 'Planung',
            'titel'  => 'Einsätze & Zuteilung',
            'text'   => 'Einsätze ansehen, anlegen, zuteilen und absagen; der Ereignis-Feed auf der Übersicht.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'objekte' => [
            'gruppe' => 'Planung',
            'titel'  => 'Objekte',
            'text'   => 'Objekte, Objektpläne, Distanzen und die Personen am Objekt.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'masterschichten' => [
            'gruppe' => 'Planung',
            'titel'  => 'Masterschichten & Feiertage',
            'text'   => 'Wiederkehrende Schichtmuster und der Feiertagskalender.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        // Nur lesen: Verfuegbarkeit und Pensen entstehen aus der App und aus
        // den Einsaetzen. Aus dem Cockpit wird hier heute nichts geschrieben.
        'verfuegbarkeit' => [
            'gruppe' => 'Planung',
            'titel'  => 'Verfügbarkeit & Pensen',
            'text'   => 'Wer wann kann, und wie weit das Jahrespensum erfüllt ist.',
            'stufen' => [STUFE_LESEN],
        ],

        // ── Abgleich ──
        'abgleich' => [
            'gruppe' => 'Abgleich',
            'titel'  => 'Ist-Zeiten & Rapporte',
            'text'   => 'Geplante gegen gemeldete Zeiten abgleichen, Rapporte prüfen und löschen.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'auslagen' => [
            'gruppe' => 'Abgleich',
            'titel'  => 'Auslagenersatz',
            'text'   => 'Fahrkosten und Fahrzeit nach Art. 18 GAV je Einsatz.',
            'stufen' => [STUFE_LESEN],
        ],

        // ── Kunden ──
        'kunden' => [
            'gruppe' => 'Kunden',
            'titel'  => 'Kunden',
            'text'   => 'Kundenstamm mit Adressen und Ansprechpartnern.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'offerten' => [
            'gruppe' => 'Kunden',
            'titel'  => 'Offerten & Rechnungen',
            'text'   => 'Belege mit Preisen, Rabatten und Zahlungsstand — also die Kalkulation.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'leistungen' => [
            'gruppe' => 'Kunden',
            'titel'  => 'Leistungen',
            'text'   => 'Der Leistungskatalog, aus dem Offerten und Rechnungen zusammengesetzt werden.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],

        // ── Personal ──
        'personal' => [
            'gruppe' => 'Personal',
            'titel'  => 'Mitarbeitende',
            'text'   => 'Die Personalakte ohne die vertraulichen Angaben: Name, Funktion, Anstellung, Qualifikationen.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'personal_vertraulich' => [
            'gruppe' => 'Personal',
            'titel'  => 'Vertrauliche Angaben',
            'text'   => 'AHV-Nummer, Bewilligungen, Register-, Herkunfts- und Familienangaben.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'abwesenheiten' => [
            'gruppe' => 'Personal',
            'titel'  => 'Abwesenheiten & Ferien',
            'text'   => 'Ferien- und Abwesenheitsgesuche ansehen und darüber entscheiden.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'mitteilungen' => [
            'gruppe' => 'Personal',
            'titel'  => 'Mitteilungen',
            'text'   => 'Mitteilungen an die Belegschaft verfassen und zurückziehen — sie erscheinen bei jedem im Telefon und tragen den Namen des Betriebs.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],

        // ── Revierdienst ──
        'kontrollpunkte' => [
            'gruppe' => 'Revierdienst',
            'titel'  => 'Kontrollpunkte & Rundgang-Vorlagen',
            'text'   => 'Kontrollpunkte, Aufgaben und Rundgang-Vorlagen je Objekt pflegen.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'rundgaenge' => [
            'gruppe' => 'Revierdienst',
            'titel'  => 'Rundgänge & Vorfallmeldungen',
            'text'   => 'Laufende und abgeschlossene Rundgänge, Scans, Spuren und die aus der App gemeldeten Vorfälle.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        // Ein Ja/Nein, kein Lesen/Schreiben: Es geht nicht darum, etwas zu
        // sehen, sondern darum, hinterlegbar zu SEIN. Die Stufe heisst
        // trotzdem 'lesen', damit es fuer Rechtenamen keine Sonderform gibt
        // -- die Oberflaeche zeigt hier einen einzelnen Schalter.
        'alarmempfaenger' => [
            'gruppe' => 'Revierdienst',
            'titel'  => 'Alarmempfänger',
            'text'   => 'Als Kontaktperson für den Alleinarbeiterschutz hinterlegbar.',
            'stufen' => [STUFE_LESEN],
        ],

        // ── Administration ──
        'betrieb' => [
            'gruppe' => 'Administration',
            'titel'  => 'Betriebseinstellungen & Listen',
            'text'   => 'Briefkopf, Anstellungsorte, pflegbare Listen und die Einrichtung.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'fahrzeuge' => [
            'gruppe' => 'Administration',
            'titel'  => 'Dienstfahrzeuge',
            'text'   => 'Fahrzeugbestand, Übernahmen und das Fahrtenbuch.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        'rechte' => [
            'gruppe' => 'Administration',
            'titel'  => 'Rollen & Berechtigungen',
            'text'   => 'Profile anlegen und zuteilen — also bestimmen, wer an welche Daten kommt.',
            'stufen' => [STUFE_LESEN, STUFE_SCHREIBEN],
        ],
        // Nur lesen, und das ist keine Luecke: "Ein Logbuch, aus dem sich
        // Eintraege entfernen lassen, waere keines" (ENT-077). Es gibt
        // serverseitig weder POST noch DELETE darauf.
        'logbuch' => [
            'gruppe' => 'Administration',
            'titel'  => 'Logbuch',
            'text'   => 'Der Änderungsverlauf: wer wann was geändert hat. Nur lesbar, für niemanden änderbar.',
            'stufen' => [STUFE_LESEN],
        ],
    ];
}

function bereich_gueltig(string $bereich): bool
{
    return array_key_exists($bereich, bereiche_katalog());
}

// Gibt es diese Stufe in diesem Bereich ueberhaupt? Verhindert, dass ein
// Profil "Logbuch: schreiben" traegt -- ein Recht, das nie etwas oeffnet und
// jeden, der es liest, in die Irre fuehrt.
function stufe_gueltig(string $bereich, string $stufe): bool
{
    $k = bereiche_katalog();
    return isset($k[$bereich]) && in_array($stufe, $k[$bereich]['stufen'], true);
}

// ── Die Rechte ────────────────────────────────────────────────────────
// Nicht mehr von Hand gepflegt, sondern aus den Bereichen abgeleitet:
// <bereich>_lesen und <bereich>_schreiben. Der Grund ist keine Sparsamkeit,
// sondern die Vermeidung einer zweiten Liste -- eine von Hand gefuehrte
// Rechteliste neben der Bereichsliste waere wieder eine zweite Wahrheit.
function rechte_katalog(): array
{
    $rechte = [];
    foreach (bereiche_katalog() as $b => $d) {
        foreach ($d['stufen'] as $stufe) {
            $rechte[$b . '_' . $stufe] = $d['titel'] . ' — ' . $stufe;
        }
    }
    return $rechte;
}

function recht_gueltig(string $recht): bool
{
    return array_key_exists($recht, rechte_katalog());
}

// ── Die Systemrollen ──────────────────────────────────────────────────
// Die fuenf Rollen aus ENT-077/ENT-180, Stufe fuer Stufe ausgeschrieben.
// Sie sind mit ENT-440 nicht enger und nicht weiter geworden: Jede kann
// nach dem Umbau genau das, was sie vorher konnte. Wer das nachrechnen
// will, findet die Gegenprobe in pruefungen/pruef_rechte.php.
//
// Ein Bereich, der hier fehlt, ist "verborgen" -- siehe STUFE_VERBORGEN.
const ROLLE_MITARBEITEND = 'mitarbeitend';
const ROLLE_PLANUNG      = 'planung';
const ROLLE_PERSONAL     = 'personal';
const ROLLE_VERWALTUNG   = 'verwaltung';
const ROLLE_WAECHTER     = 'waechter';

function system_rollen(): array
{
    return [
        ROLLE_MITARBEITEND => [
            'titel'  => 'Mitarbeitend',
            'text'   => 'Nur die eigenen Daten in der App: eigene Schichten, eigene Rapporte, eigene Sperrtage. Kein Zugang zum Cockpit.',
            'stufen' => [],
        ],
        ROLLE_PLANUNG => [
            'titel'  => 'Planung',
            'text'   => 'Einsätze, Objekte, Masterschichten, Kunden und der Abgleich der Ist-Zeiten. Sieht Mitarbeitende mit Name, Funktion und Berechtigungen — nicht AHV-Nummer, Aufenthaltsstatus oder Registerdaten.',
            'stufen' => [
                'einsaetze'       => STUFE_SCHREIBEN,
                'objekte'         => STUFE_SCHREIBEN,
                'masterschichten' => STUFE_SCHREIBEN,
                'verfuegbarkeit'  => STUFE_LESEN,
                'abgleich'        => STUFE_SCHREIBEN,
                'auslagen'        => STUFE_LESEN,
                'kunden'          => STUFE_SCHREIBEN,
                'personal'        => STUFE_LESEN,
                'abwesenheiten'   => STUFE_LESEN,
                // Wer einem Einsatz ein Fahrzeug zuteilt, braucht die Liste.
                // Vor ENT-440 lief das ueber das Planungsrecht mit (siehe
                // fahrzeuge.php); jetzt steht es da, wo man es nachschlaegt.
                'fahrzeuge'       => STUFE_LESEN,
            ],
        ],
        ROLLE_PERSONAL => [
            'titel'  => 'Personal',
            'text'   => 'Die vollständige Personalakte inklusive der vertraulichen Angaben, Anlegen und Ändern von Mitarbeitenden, Mitteilungen an die Belegschaft. Keine Einsatzplanung, keine Kunden.',
            'stufen' => [
                'personal'             => STUFE_SCHREIBEN,
                'personal_vertraulich' => STUFE_SCHREIBEN,
                'abwesenheiten'        => STUFE_SCHREIBEN,
                'mitteilungen'         => STUFE_SCHREIBEN,
            ],
        ],
        ROLLE_VERWALTUNG => [
            'titel'  => 'Verwaltung',
            'text'   => 'Alles, zusätzlich die Betriebseinstellungen, die Einrichtung, die Offerten, die Mitteilungen und die Rollenvergabe selbst.',
            'stufen' => [
                'einsaetze'            => STUFE_SCHREIBEN,
                'objekte'              => STUFE_SCHREIBEN,
                'masterschichten'      => STUFE_SCHREIBEN,
                'verfuegbarkeit'       => STUFE_LESEN,
                'abgleich'             => STUFE_SCHREIBEN,
                'auslagen'             => STUFE_LESEN,
                'kunden'               => STUFE_SCHREIBEN,
                'offerten'             => STUFE_SCHREIBEN,
                'leistungen'           => STUFE_SCHREIBEN,
                'personal'             => STUFE_SCHREIBEN,
                'personal_vertraulich' => STUFE_SCHREIBEN,
                'abwesenheiten'        => STUFE_SCHREIBEN,
                'mitteilungen'         => STUFE_SCHREIBEN,
                'betrieb'              => STUFE_SCHREIBEN,
                'fahrzeuge'            => STUFE_SCHREIBEN,
                'rechte'               => STUFE_SCHREIBEN,
                'logbuch'              => STUFE_LESEN,
            ],
        ],
        // Bewusst NICHT in "Alles" bei Verwaltung enthalten (ENT-169: "nur
        // ausgewählte Benutzer") -- wer im Revierdienst-Wächtersystem
        // mitarbeitet, braucht diese Rolle zusaetzlich, unabhaengig davon,
        // welche der vier Rollen oben sie/er sonst hat.
        ROLLE_WAECHTER => [
            'titel'  => 'Wächtersystem',
            'text'   => 'Revierdienst: Kontrollpunkte und Rundgang-Vorlagen pro Objekt pflegen, laufende und abgeschlossene Rundgänge einsehen, als Kontaktperson für den Alleinarbeiterschutz hinterlegbar. Unabhängig von den anderen Rollen — wird zusätzlich vergeben.',
            'stufen' => [
                'kontrollpunkte'  => STUFE_SCHREIBEN,
                'rundgaenge'      => STUFE_SCHREIBEN,
                'alarmempfaenger' => STUFE_LESEN,
            ],
        ],
    ];
}

function ist_systemrolle(string $schluessel): bool
{
    return array_key_exists($schluessel, system_rollen());
}

// ── Ableitung: Stufen zu Rechten ──────────────────────────────────────
// Ohne Datenbank, damit sie sich fuer sich allein pruefen laesst.
//
// $definitionen ist [schluessel => ['stufen' => [bereich => stufe], ...]].
// Fehlt sie, gelten die Systemrollen -- der Fall "Einrichtung noch nicht
// gelaufen", in dem es die Tabellen noch gar nicht gibt.
function rechte_aus_rollen(array $rollen, ?array $definitionen = null): array
{
    $katalog = $definitionen ?? system_rollen();
    $rechte  = [];
    foreach ($rollen as $rolle) {
        if (!isset($katalog[$rolle])) { continue; }   // unbekannt = wirkungslos
        foreach (($katalog[$rolle]['stufen'] ?? []) as $bereich => $stufe) {
            if (!stufe_gueltig((string)$bereich, (string)$stufe)) { continue; }
            // Schreiben traegt Lesen mit -- sonst muesste jeder Endpunkt
            // beide Namen abfragen, und genau dort entstehen die Luecken.
            $rechte[$bereich . '_' . STUFE_LESEN] = true;
            if ($stufe === STUFE_SCHREIBEN) {
                $rechte[$bereich . '_' . STUFE_SCHREIBEN] = true;
            }
        }
    }
    // Sortiert, damit dieselben Rollen immer dieselbe Liste ergeben --
    // unabhaengig davon, in welcher Reihenfolge sie in der Datenbank
    // stehen. Sonst sieht ein Vergleich zweier gleicher Rechtestaende nach
    // einem Unterschied aus.
    $rechte = array_keys($rechte);
    sort($rechte);
    return $rechte;
}

// Hoechste Stufe je Bereich ueber mehrere Rollen hinweg. Fuer die Anzeige
// ("was kann diese Person insgesamt") -- entschieden wird weiterhin ueber
// die Rechteliste, nicht hierueber.
function stufen_aus_rollen(array $rollen, ?array $definitionen = null): array
{
    $katalog = $definitionen ?? system_rollen();
    $hoechste = [];
    foreach ($rollen as $rolle) {
        foreach (($katalog[$rolle]['stufen'] ?? []) as $bereich => $stufe) {
            if (!stufe_gueltig((string)$bereich, (string)$stufe)) { continue; }
            if (($hoechste[$bereich] ?? '') === STUFE_SCHREIBEN) { continue; }
            $hoechste[$bereich] = $stufe;
        }
    }
    return $hoechste;
}

// ── Die einzige Pruefstelle ───────────────────────────────────────────
// Darf diese Person das? Alles laeuft hier durch.
//
// Ohne Rollenliste am Benutzer wird auf ist_admin zurueckgefallen. Das ist
// KEINE Bequemlichkeit, sondern der Fall "Einrichtung noch nicht gelaufen":
// Ohne diesen Rueckfall stuende der Betrieb ab dem Deploy still, weil noch
// niemand eine Rolle haette.
function darf(array $user, string $recht): bool
{
    if (isset($user['rechte']) && is_array($user['rechte'])) {
        return in_array($recht, $user['rechte'], true);
    }
    if (isset($user['rollen']) && is_array($user['rollen'])) {
        return in_array($recht, rechte_aus_rollen($user['rollen']), true);
    }
    return !empty($user['ist_admin']);
}

// Abweisen mit klarer Meldung. 403 heisst: angemeldet, aber nicht befugt --
// im Unterschied zu 401 "nicht angemeldet". Die Oberflaeche unterscheidet
// beides, sonst schickt ein fehlendes Recht jemanden auf die Anmeldeseite
// und er versucht es endlos erneut.
function require_recht(array $user, string $recht): void
{
    if (darf($user, $recht)) { return; }
    json_response([
        'status'  => 'error',
        'recht'   => $recht,
        'message' => 'Dafür fehlt dir die Berechtigung.',
    ], 403);
}

// Fuer Endpunkte, die lesen UND schreiben (etwa objekt_personen.php: GET
// holt die Liste, POST aendert sie). Ohne diese Unterscheidung waere die
// Stufe "lesen" wertlos: Ein Endpunkt, der beides unter einem Recht fuehrt,
// gibt jedem Leser auch das Schreiben.
//
// GET und HEAD sind Lesen, alles andere ist Schreiben -- und zwar in dieser
// Richtung, nicht umgekehrt: Eine unbekannte Methode faellt damit auf die
// STRENGERE Seite.
function require_recht_nach_methode(array $user, string $bereich): void
{
    $lesend = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);
    require_recht($user, $bereich . '_' . ($lesend ? STUFE_LESEN : STUFE_SCHREIBEN));
}

// Hat diese Person ueberhaupt Zugang zur Verwaltungsoberflaeche (Cockpit)?
//
// Abgeleitet und nicht als eigener Schalter am Profil (ENT-440): Es kann
// damit kein Profil geben, das Schreibrechte traegt, aber nicht hineinkommt
// -- also Rechte ohne Wirkung, die niemandem auffallen. Wer hier nichts
// hat, gehoert in die Mitarbeiter-App; der spaeter geplante Mitarbeiter-
// Desktop haengt am selben Zugang wie die App und braucht kein eigenes
// Recht.
//
// Fuer die wenigen Endpunkte, die zu keinem einzelnen Fachgebiet gehoeren:
// die Zahlen auf der Uebersicht und die eigene Zwei-Faktor-Einrichtung. Ein
// eigenes Recht dafuer waere falsch -- es waere eines, das man vergeben
// koennte, ohne dass es fuer sich allein etwas bedeutet.
function darf_verwaltung(array $user): bool
{
    if (isset($user['rechte']) && is_array($user['rechte'])) {
        return $user['rechte'] !== [];
    }
    if (isset($user['rollen']) && is_array($user['rollen'])) {
        return rechte_aus_rollen($user['rollen']) !== [];
    }
    return !empty($user['ist_admin']);
}

function require_verwaltung(array $user): void
{
    if (darf_verwaltung($user)) { return; }
    json_response([
        'status'  => 'error',
        'message' => 'Dieser Bereich ist der Verwaltung vorbehalten.',
    ], 403);
}

// ── Datenbankteil ─────────────────────────────────────────────────────
function rechte_tabelle_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'mitarbeiter_rollen');
}

// Die beiden Tabellen aus ENT-440. Getrennt von der Frage oben, weil ein
// Betrieb dazwischen stehen kann: Rollen zugeteilt (ENT-077 gelaufen), aber
// die Einrichtung fuer die Profile noch nicht. Dann gelten die Systemrollen
// aus dem Code -- derselbe Zustand wie vorher, nicht "keine Rechte".
function rollen_tabellen_da(PDO $pdo): bool
{
    return hat_tabelle($pdo, 'rollen') && hat_tabelle($pdo, 'rollen_rechte');
}

// Alle Rollendefinitionen: [schluessel => ['titel','text','system','stufen'=>[bereich=>stufe]]].
//
// Ohne die Tabellen der Code-Katalog. Der Rueckfall gibt NICHT weniger
// zurueck, sondern genau den geprueften Stand -- "noch nicht eingerichtet"
// darf nie wie "keine Rechte" aussehen.
function rollen_definitionen(PDO $pdo): array
{
    if (!rollen_tabellen_da($pdo)) {
        $aus = [];
        foreach (system_rollen() as $s => $d) {
            $aus[$s] = $d + ['system' => true];
        }
        return $aus;
    }
    $rollen = $pdo->query('SELECT id, schluessel, titel, text, system FROM rollen ORDER BY system DESC, titel')->fetchAll();
    $nachId = [];
    $aus    = [];
    foreach ($rollen as $r) {
        $aus[(string)$r['schluessel']] = [
            'titel'  => (string)$r['titel'],
            'text'   => (string)$r['text'],
            'system' => (int)$r['system'] === 1,
            'stufen' => [],
        ];
        $nachId[(int)$r['id']] = (string)$r['schluessel'];
    }
    foreach ($pdo->query('SELECT rolle_id, bereich, stufe FROM rollen_rechte')->fetchAll() as $z) {
        $s = $nachId[(int)$z['rolle_id']] ?? null;
        if ($s === null) { continue; }
        if (!stufe_gueltig((string)$z['bereich'], (string)$z['stufe'])) { continue; }
        $aus[$s]['stufen'][(string)$z['bereich']] = (string)$z['stufe'];
    }
    return $aus;
}

// Nur Schluessel, Titel, Text und Systemkennzeichen -- fuer Antworten, die
// die Profile beim NAMEN nennen muessen, ohne die ganze Rechtematrix zu
// tragen (Mitarbeiterliste, Personalakte). Ohne sie zeigte die Oberflaeche
// eigene Profile als rohen Schluessel an.
function rollen_kurzliste(PDO $pdo): array
{
    $aus = [];
    foreach (rollen_definitionen($pdo) as $schluessel => $d) {
        $aus[] = [
            'schluessel' => $schluessel,
            'titel'      => $d['titel'],
            'text'       => $d['text'],
            'system'     => (bool)($d['system'] ?? ist_systemrolle($schluessel)),
        ];
    }
    return $aus;
}

// Die Rollen einer Person. Ohne Tabelle (Einrichtung noch nicht gelaufen)
// wird aus ist_admin abgeleitet -- derselbe Rueckfall wie in darf().
function rechte_rollen(PDO $pdo, int $mitarbeiterId, bool $istAdmin = false): array
{
    if (!rechte_tabelle_da($pdo)) {
        return [$istAdmin ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
    }
    $s = $pdo->prepare('SELECT rolle FROM mitarbeiter_rollen WHERE mitarbeiter_id = ?');
    $s->execute([$mitarbeiterId]);
    $rollen = array_values($s->fetchAll(PDO::FETCH_COLUMN));
    // Kein Eintrag heisst nicht "rechtlos ohne Grund": Wer angelegt wurde,
    // bevor die Einrichtung lief, hat noch keine Zeile. Dann gilt der alte
    // Stand, damit niemand ueber Nacht ausgesperrt wird.
    if (!$rollen) {
        return [$istAdmin ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
    }
    return $rollen;
}

// Wie viele aktive Personen koennen noch Rollen vergeben? Grundlage des
// Aussperrschutzes.
//
// Gezaehlt wird seit ENT-440 das RECHT und nicht mehr die Rolle
// "Verwaltung": Sonst schuetzte die Sperre eine Rolle, die es nach dem
// Umbau auch als eigenes Profil geben kann -- und der letzte Zugang waere
// weg, obwohl formal noch jemand "Verwaltung" heisst.
function rechte_verwaltung_zahl(PDO $pdo, int $ausser = 0): int
{
    if (!rechte_tabelle_da($pdo)) { return 0; }
    $defs = rollen_definitionen($pdo);
    $s = $pdo->prepare(
        'SELECT r.mitarbeiter_id, r.rolle
           FROM mitarbeiter_rollen r
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE m.aktiv = 1 AND r.mitarbeiter_id <> ?'
    );
    $s->execute([$ausser]);
    $proPerson = [];
    foreach ($s->fetchAll() as $z) {
        $proPerson[(int)$z['mitarbeiter_id']][] = (string)$z['rolle'];
    }
    $zahl = 0;
    foreach ($proPerson as $rollen) {
        if (in_array('rechte_' . STUFE_SCHREIBEN, rechte_aus_rollen($rollen, $defs), true)) { $zahl++; }
    }
    return $zahl;
}

// Setzt die Rollen einer Person. Gibt eine Meldung zurueck, wenn es nicht
// geht -- oder null bei Erfolg.
//
// Der Aussperrschutz ist die einzige Regel, die sich hier NICHT uebergehen
// laesst: Waere danach niemand mehr da, der Rollen vergeben kann, koennte
// niemand mehr Rollen vergeben, und der Betrieb kaeme nur noch ueber
// phpMyAdmin an sein eigenes Werkzeug. Gleiche Ueberlegung wie beim
// Notausgang der Zwei-Faktor-Anmeldung (ENT-076).
function rechte_setzen(PDO $pdo, int $zielId, array $rollen, array $akteur): ?string
{
    if (!rechte_tabelle_da($pdo)) {
        return 'Die Einrichtung ist noch nicht gelaufen — bitte zuerst unten links „Einrichtung" ausführen.';
    }
    $defs   = rollen_definitionen($pdo);
    $rollen = array_values(array_unique(array_filter(
        $rollen,
        fn($r) => is_string($r) && isset($defs[$r])
    )));
    if (!$rollen) {
        return 'Mindestens ein Profil muss gesetzt sein.';
    }
    $vorher = rechte_rollen($pdo, $zielId);

    $konnteVergeben = in_array('rechte_' . STUFE_SCHREIBEN, rechte_aus_rollen($vorher, $defs), true);
    $kannVergeben   = in_array('rechte_' . STUFE_SCHREIBEN, rechte_aus_rollen($rollen, $defs), true);
    if ($konnteVergeben && !$kannVergeben && rechte_verwaltung_zahl($pdo, $zielId) === 0) {
        return 'Das ist die letzte Person, die Rollen vergeben darf. '
             . 'Ohne sie könnte niemand mehr Berechtigungen ändern. '
             . 'Zuerst jemand anderem ein Profil mit „Rollen & Berechtigungen: schreiben" geben, dann hier ändern.';
    }

    $pdo->prepare('DELETE FROM mitarbeiter_rollen WHERE mitarbeiter_id = ?')->execute([$zielId]);
    $ein = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
    foreach ($rollen as $rolle) { $ein->execute([$zielId, $rolle]); }

    // ist_admin bleibt vorerst als Spiegel bestehen (OP-72). Zwei Wahrheiten
    // waeren schlecht -- darum ist die Rollentabelle die Wahrheit und
    // ist_admin wird nur noch NACHGEFUEHRT. Es spiegelt seit ENT-440 das
    // Recht "Rollen vergeben" und nicht mehr den Rollennamen: Ein eigenes
    // Profil mit diesem Recht ist genauso Administration wie die Systemrolle.
    $pdo->prepare('UPDATE mitarbeiter SET ist_admin = ? WHERE id = ?')
        ->execute([$kannVergeben ? 1 : 0, $zielId]);

    sort($vorher); $nachher = $rollen; sort($nachher);
    if ($vorher !== $nachher && function_exists('logbuch_schreiben')) {
        logbuch_schreiben($pdo, $akteur, 'mitarbeiter', $zielId, 'rollen',
            implode(', ', $vorher), implode(', ', $nachher));
    }
    return null;
}

// Rollen aller Personen auf einmal -- fuer die zentrale Seite und fuer die
// Mitarbeiterliste. Eine Abfrage statt einer je Zeile.
function rechte_rollen_alle(PDO $pdo): array
{
    if (!rechte_tabelle_da($pdo)) { return []; }
    $rows = $pdo->query('SELECT mitarbeiter_id, rolle FROM mitarbeiter_rollen')->fetchAll();
    $karte = [];
    foreach ($rows as $r) {
        $karte[(int)$r['mitarbeiter_id']][] = (string)$r['rolle'];
    }
    return $karte;
}

// ── Profile anlegen und aendern (ENT-440) ─────────────────────────────
// Aus dem Titel einen Schluessel machen. Der Schluessel steht in
// mitarbeiter_rollen und in den Antworten; er bleibt fest, auch wenn der
// Titel spaeter umbenannt wird -- sonst haetten alle Zuteilungen auf einen
// Namen gezeigt, den es nicht mehr gibt.
function rolle_schluessel_bilden(PDO $pdo, string $titel): string
{
    $roh = strtolower($titel);
    $roh = strtr($roh, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    $roh = preg_replace('/[^a-z0-9]+/', '_', $roh) ?? '';
    $roh = trim((string)$roh, '_');
    if ($roh === '') { $roh = 'profil'; }
    $roh = substr($roh, 0, 24);
    $s = $pdo->prepare('SELECT COUNT(*) FROM rollen WHERE schluessel = ?');
    $kandidat = $roh; $n = 2;
    while (true) {
        $s->execute([$kandidat]);
        if ((int)$s->fetchColumn() === 0 && !ist_systemrolle($kandidat)) { return $kandidat; }
        $kandidat = $roh . '_' . $n; $n++;
    }
}

// Legt ein Profil an oder aendert eines. Systemrollen sind gesperrt: Sie
// tragen den geprueften Zustand aus ENT-077/ENT-180, und wer sie aendern
// koennte, koennte den Schutz stillschweigend aushebeln.
//
// $stufen ist [bereich => stufe]; was fehlt, ist verborgen.
function rolle_speichern(PDO $pdo, ?string $schluessel, string $titel, string $text, array $stufen, array $akteur): array
{
    if (!rollen_tabellen_da($pdo)) {
        return ['fehler' => 'Die Einrichtung ist noch nicht gelaufen — bitte zuerst unten links „Einrichtung" ausführen.'];
    }
    $titel = trim($titel);
    if ($titel === '') { return ['fehler' => 'Das Profil braucht einen Namen.']; }
    if (mb_strlen($titel) > 60) { return ['fehler' => 'Der Name ist zu lang (höchstens 60 Zeichen).']; }

    // Nur gueltige Bereich/Stufe-Paare kommen durch. Ein unbekannter Bereich
    // wird NICHT stillschweigend geschluckt: Er waere sonst ein Recht, das
    // in der Maske steht und nichts oeffnet.
    $sauber = [];
    foreach ($stufen as $bereich => $stufe) {
        $bereich = (string)$bereich; $stufe = (string)$stufe;
        if ($stufe === STUFE_VERBORGEN || $stufe === '') { continue; }
        if (!bereich_gueltig($bereich)) {
            return ['fehler' => 'Unbekannter Bereich: ' . $bereich];
        }
        if (!stufe_gueltig($bereich, $stufe)) {
            return ['fehler' => 'Die Stufe „' . $stufe . '" gibt es im Bereich „'
                . bereiche_katalog()[$bereich]['titel'] . '" nicht.'];
        }
        $sauber[$bereich] = $stufe;
    }

    if ($schluessel !== null && $schluessel !== '') {
        if (ist_systemrolle($schluessel)) {
            return ['fehler' => 'Systemrollen lassen sich nicht ändern. Lege daneben ein eigenes Profil an.'];
        }
        $s = $pdo->prepare('SELECT id, titel FROM rollen WHERE schluessel = ? AND system = 0');
        $s->execute([$schluessel]);
        $alt = $s->fetch();
        if (!$alt) { return ['fehler' => 'Dieses Profil gibt es nicht (mehr).']; }
        $id = (int)$alt['id'];
        $pdo->prepare('UPDATE rollen SET titel = ?, text = ? WHERE id = ?')->execute([$titel, $text, $id]);
    } else {
        $schluessel = rolle_schluessel_bilden($pdo, $titel);
        $pdo->prepare('INSERT INTO rollen (schluessel, titel, text, system) VALUES (?, ?, ?, 0)')
            ->execute([$schluessel, $titel, $text]);
        $id = (int)$pdo->lastInsertId();
    }

    $vorher = [];
    $s = $pdo->prepare('SELECT bereich, stufe FROM rollen_rechte WHERE rolle_id = ?');
    $s->execute([$id]);
    foreach ($s->fetchAll() as $z) { $vorher[(string)$z['bereich']] = (string)$z['stufe']; }

    $pdo->prepare('DELETE FROM rollen_rechte WHERE rolle_id = ?')->execute([$id]);
    $ein = $pdo->prepare('INSERT INTO rollen_rechte (rolle_id, bereich, stufe) VALUES (?, ?, ?)');
    foreach ($sauber as $bereich => $stufe) { $ein->execute([$id, $bereich, $stufe]); }

    // Ins Logbuch, weil eine Profiländerung auf einen Schlag fuer JEDE
    // Person gilt, die das Profil traegt -- die folgenreichste Aenderung,
    // die es an Rechten gibt.
    if ($vorher !== $sauber && function_exists('logbuch_schreiben')) {
        logbuch_schreiben($pdo, $akteur, 'rollen', $id, 'rechte',
            rolle_stufen_text($vorher), rolle_stufen_text($sauber));
    }
    return ['schluessel' => $schluessel];
}

// Lesbare Fassung fuer das Logbuch. Nicht der rohe Datensatz: Ein Verlauf,
// den nur lesen kann, wer die Tabelle kennt, ist keiner.
function rolle_stufen_text(array $stufen): string
{
    if (!$stufen) { return 'nichts'; }
    $k = bereiche_katalog();
    $teile = [];
    foreach ($stufen as $bereich => $stufe) {
        $teile[] = ($k[$bereich]['titel'] ?? $bereich) . ': ' . $stufe;
    }
    sort($teile);
    return implode(' · ', $teile);
}

// Ein Profil entfernen. Nicht moeglich, solange es jemand traegt -- sonst
// stuende in mitarbeiter_rollen ein Schluessel, den es nicht mehr gibt, und
// die betroffene Person haette stillschweigend weniger Rechte als gedacht.
function rolle_loeschen(PDO $pdo, string $schluessel, array $akteur): ?string
{
    if (!rollen_tabellen_da($pdo)) {
        return 'Die Einrichtung ist noch nicht gelaufen.';
    }
    if (ist_systemrolle($schluessel)) {
        return 'Systemrollen lassen sich nicht löschen.';
    }
    $s = $pdo->prepare('SELECT id, titel FROM rollen WHERE schluessel = ? AND system = 0');
    $s->execute([$schluessel]);
    $r = $s->fetch();
    if (!$r) { return 'Dieses Profil gibt es nicht (mehr).'; }

    $z = $pdo->prepare('SELECT COUNT(*) FROM mitarbeiter_rollen WHERE rolle = ?');
    $z->execute([$schluessel]);
    $traeger = (int)$z->fetchColumn();
    if ($traeger > 0) {
        return 'Dieses Profil ist noch ' . $traeger . ' Person'
             . ($traeger === 1 ? '' : 'en') . ' zugeteilt. Zuerst dort wegnehmen, dann löschen.';
    }
    $pdo->prepare('DELETE FROM rollen WHERE id = ?')->execute([(int)$r['id']]);
    if (function_exists('logbuch_schreiben')) {
        logbuch_schreiben($pdo, $akteur, 'rollen', (int)$r['id'], 'profil',
            (string)$r['titel'], 'gelöscht');
    }
    return null;
}
