<?php
// Rollen und Rechte (ENT-077).
//
// Bis hierher kannte das Werkzeug genau eine Unterscheidung: "Admin ja/nein".
// 52 von 61 Endpunkten fragten einzeln `$user['ist_admin']` ab. Wer Admin war,
// sah alles -- die AHV-Nummer, den Aufenthaltsstatus und die Registerdaten
// jeder Person im Betrieb.
//
// Zwei Festlegungen des Projektinhabers tragen diese Datei:
//
//  1. FESTE ROLLEN, nicht frei zusammenklickbar. Was eine Rolle darf,
//     steht hier im Code und im Entscheidungsprotokoll -- nicht in einer
//     Kreuzchen-Maske. Ein falsch gesetztes Haekchen oeffnet sonst
//     Personendaten, ohne dass es jemand merkt, und die Projektregel sagt:
//     Konfigurierbarkeit ist kein Qualitaetsmerkmal. Urspruenglich vier
//     (ENT-077); seit ENT-180 eine fuenfte fuer den Revierdienst dazu --
//     die Anzahl ist kein Selbstzweck, jede weitere braucht aber wie diese
//     eine eigene Entscheidung, kein stillschweigendes Dazuklicken.
//  2. MEHRERE ROLLEN JE PERSON. Planung und Personal sind zwei verschiedene
//     Arbeiten, keine Stufen uebereinander. Bei genau einer Rolle muesste
//     jemand, der beides macht, "Verwaltung" bekommen -- also gleich alles,
//     und der Schutz waere weg.
//
// WICHTIG fuer alle, die hier etwas ergaenzen: Es gibt genau EINE Stelle, an
// der ein Recht geprueft wird -- darf(). Kein Endpunkt entscheidet selbst.
// Eine zweite Pruefstelle waere eine zweite Wahrheit, und Rechte mit zwei
// Wahrheiten sind keine Rechte.
declare(strict_types=1);

// ── Die Rollen ────────────────────────────────────────────────────────
const ROLLE_MITARBEITEND = 'mitarbeitend';
const ROLLE_PLANUNG      = 'planung';
const ROLLE_PERSONAL     = 'personal';
const ROLLE_VERWALTUNG   = 'verwaltung';
// Fuenfte Rolle, quer zu den vier oben (ENT-169/ENT-180): Wer am
// Revierdienst teilnimmt, ist unabhaengig davon, ob dieselbe Person auch
// Planung oder Personal macht -- deshalb ergaenzt sie eine bestehende
// Rolle, statt eine davon zu erweitern (sonst haette z.B. jede
// Planungs-Person automatisch Waechtersystem-Zugriff, was ENT-169
// ausdruecklich nicht will: "nur ausgewaehlte Benutzer").
const ROLLE_WAECHTER = 'waechter';

// Reihenfolge = Anzeigereihenfolge in der Oberflaeche, vom kleinsten zum
// groessten Zugriff. Die Beschreibung steht hier und nicht in der
// Oberflaeche, damit beide dasselbe sagen.
function rollen_katalog(): array
{
    return [
        ROLLE_MITARBEITEND => [
            'titel'    => 'Mitarbeitend',
            'text'     => 'Nur die eigenen Daten in der App: eigene Schichten, eigene Rapporte, eigene Sperrtage. Kein Zugang zur Verwaltung.',
            'rechte'   => [],
        ],
        ROLLE_PLANUNG => [
            'titel'    => 'Planung',
            'text'     => 'Einsätze, Objekte, Masterschichten, Kunden und der Abgleich der Ist-Zeiten. Sieht Mitarbeitende mit Name, Funktion und Berechtigungen — nicht AHV-Nummer, Aufenthaltsstatus oder Registerdaten.',
            'rechte'   => ['plan', 'kunden', 'abgleich', 'personal_lesen'],
        ],
        ROLLE_PERSONAL => [
            'titel'    => 'Personal',
            'text'     => 'Die vollständige Personalakte inklusive der vertraulichen Angaben, Anlegen und Ändern von Mitarbeitenden. Keine Einsatzplanung, keine Kunden.',
            'rechte'   => ['personal_lesen', 'personal_schreiben', 'personal_vertraulich'],
        ],
        ROLLE_VERWALTUNG => [
            'titel'    => 'Verwaltung',
            'text'     => 'Alles, zusätzlich die Betriebseinstellungen, die Einrichtung, die Offerten und die Rollenvergabe selbst.',
            'rechte'   => ['plan', 'kunden', 'abgleich', 'personal_lesen',
                           'personal_schreiben', 'personal_vertraulich',
                           'betrieb', 'rechte', 'offerten'],
        ],
        // Bewusst NICHT in "Alles" bei Verwaltung enthalten (ENT-169: "nur
        // ausgewählte Benutzer") -- wer im Revierdienst-Wächtersystem
        // mitarbeitet, braucht diese Rolle zusätzlich, unabhängig davon,
        // welche der vier Rollen oben sie/er sonst hat.
        ROLLE_WAECHTER => [
            'titel'    => 'Wächtersystem',
            'text'     => 'Revierdienst: Kontrollpunkte und Rundgang-Vorlagen pro Objekt pflegen, laufende und abgeschlossene Rundgänge einsehen, als Kontaktperson für den Alleinarbeiterschutz hinterlegbar. Unabhängig von den anderen Rollen — wird zusätzlich vergeben.',
            'rechte'   => ['rundgang_verwalten', 'rundgang_einsehen', 'alarmempfaenger'],
        ],
    ];
}

// ── Die Rechte ────────────────────────────────────────────────────────
// Bewusst grob geschnitten: acht Rechte, nicht sechzig. Jedes zusaetzliche
// Recht ist eine weitere Kombination, die jemand pruefen muesste.
function rechte_katalog(): array
{
    return [
        'plan'                 => 'Einsätze, Objekte, Masterschichten, Feiertage, Zuteilung',
        'kunden'               => 'Kundenstamm ansehen und bearbeiten',
        'abgleich'             => 'Ist-Zeiten abgleichen, Rapporte verwalten',
        'personal_lesen'       => 'Mitarbeitende ansehen — ohne die vertraulichen Angaben',
        'personal_schreiben'   => 'Mitarbeitende anlegen, ändern, deaktivieren',
        'personal_vertraulich' => 'AHV-Nummer, Bewilligungen, Register-, Herkunfts- und Familienangaben',
        'betrieb'              => 'Betriebseinstellungen, Listen, Einrichtung',
        'rechte'               => 'Rollen vergeben und das Logbuch lesen',
        // Revierdienst-Tool / V3 (ENT-169/ENT-180) -- eigene Rechte statt
        // Mitbenutzung von 'plan', damit sie unabhaengig von der
        // Einsatzplanung vergeben werden koennen (siehe ROLLE_WAECHTER).
        'rundgang_verwalten'   => 'Kontrollpunkte und Rundgang-Vorlagen pro Objekt anlegen und ändern',
        'rundgang_einsehen'    => 'Laufende und abgeschlossene Rundgänge einsehen',
        'alarmempfaenger'      => 'Als Kontaktperson für den Alleinarbeiterschutz hinterlegbar',
        // Bewusst NICHT unter 'kunden' mitgefuehrt (ENT-181): Eine Offerte
        // zeigt Preise, Rabatte und damit die Kalkulation. Wer Adressen
        // pflegen darf, muss sie nicht sehen. Vorerst traegt nur die
        // Verwaltung dieses Recht -- die Rolle 'Planung' bekaeme es sonst
        // ueber ihren Kundenzugang mit, und genau das war der Grund, es
        // getrennt zu fuehren.
        'offerten'             => 'Offerten und Produkte ansehen und bearbeiten',
    ];
}

function rolle_gueltig(string $rolle): bool
{
    return array_key_exists($rolle, rollen_katalog());
}

// ── Die einzige Pruefstelle ───────────────────────────────────────────
// Ohne Datenbank, damit sie sich fuer sich allein pruefen laesst.
function rechte_aus_rollen(array $rollen): array
{
    $katalog = rollen_katalog();
    $rechte  = [];
    foreach ($rollen as $rolle) {
        if (!isset($katalog[$rolle])) { continue; }   // unbekannt = wirkungslos
        foreach ($katalog[$rolle]['rechte'] as $recht) {
            $rechte[$recht] = true;
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

// Darf diese Person das? Alles laeuft hier durch.
//
// Ohne Rollenliste am Benutzer wird auf ist_admin zurueckgefallen. Das ist
// KEINE Bequemlichkeit, sondern der Fall "Einrichtung noch nicht gelaufen":
// Ohne diesen Rueckfall stuende der Betrieb ab dem Deploy still, weil noch
// niemand eine Rolle haette.
function darf(array $user, string $recht): bool
{
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

// Hat diese Person ueberhaupt Zugang zur Verwaltungsoberflaeche?
//
// Fuer die wenigen Endpunkte, die zu keinem einzelnen Fachgebiet gehoeren:
// die Zahlen auf der Uebersicht und die eigene Zwei-Faktor-Einrichtung. Ein
// eigenes Recht dafuer waere falsch -- es waere eines, das man vergeben
// koennte, ohne dass es fuer sich allein etwas bedeutet.
function darf_verwaltung(array $user): bool
{
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

// Die Rollen einer Person. Ohne Tabelle (Einrichtung noch nicht gelaufen)
// wird aus ist_admin abgeleitet -- derselbe Rueckfall wie in darf().
function rechte_rollen(PDO $pdo, int $mitarbeiterId, bool $istAdmin = false): array
{
    if (!rechte_tabelle_da($pdo)) {
        return [$istAdmin ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
    }
    $s = $pdo->prepare('SELECT rolle FROM mitarbeiter_rollen WHERE mitarbeiter_id = ?');
    $s->execute([$mitarbeiterId]);
    $rollen = array_values(array_filter(
        $s->fetchAll(PDO::FETCH_COLUMN),
        'rolle_gueltig'
    ));
    // Kein Eintrag heisst nicht "rechtlos ohne Grund": Wer angelegt wurde,
    // bevor die Einrichtung lief, hat noch keine Zeile. Dann gilt der alte
    // Stand, damit niemand ueber Nacht ausgesperrt wird.
    if (!$rollen) {
        return [$istAdmin ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
    }
    return $rollen;
}

// Wie viele aktive Personen haben die Verwaltungsrolle? Grundlage des
// Aussperrschutzes.
function rechte_verwaltung_zahl(PDO $pdo, int $ausser = 0): int
{
    if (!rechte_tabelle_da($pdo)) { return 0; }
    $s = $pdo->prepare(
        'SELECT COUNT(DISTINCT r.mitarbeiter_id)
           FROM mitarbeiter_rollen r
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE r.rolle = ? AND m.aktiv = 1 AND r.mitarbeiter_id <> ?'
    );
    $s->execute([ROLLE_VERWALTUNG, $ausser]);
    return (int)$s->fetchColumn();
}

// Setzt die Rollen einer Person. Gibt eine Meldung zurueck, wenn es nicht
// geht -- oder null bei Erfolg.
//
// Der Aussperrschutz ist die einzige Regel, die sich hier NICHT uebergehen
// laesst: Waere danach niemand mehr in der Verwaltung, koennte niemand mehr
// Rollen vergeben, und der Betrieb kaeme nur noch ueber phpMyAdmin an sein
// eigenes Werkzeug. Gleiche Ueberlegung wie beim Notausgang der
// Zwei-Faktor-Anmeldung (ENT-076).
function rechte_setzen(PDO $pdo, int $zielId, array $rollen, array $akteur): ?string
{
    if (!rechte_tabelle_da($pdo)) {
        return 'Die Einrichtung ist noch nicht gelaufen — bitte zuerst unten links „Einrichtung" ausführen.';
    }
    $rollen = array_values(array_unique(array_filter($rollen, 'rolle_gueltig')));
    if (!$rollen) {
        return 'Mindestens eine Rolle muss gesetzt sein.';
    }
    $vorher = rechte_rollen($pdo, $zielId);

    $verliertVerwaltung = in_array(ROLLE_VERWALTUNG, $vorher, true)
        && !in_array(ROLLE_VERWALTUNG, $rollen, true);
    if ($verliertVerwaltung && rechte_verwaltung_zahl($pdo, $zielId) === 0) {
        return 'Das ist die letzte Person mit der Rolle „Verwaltung". '
             . 'Ohne sie könnte niemand mehr Rollen vergeben. '
             . 'Zuerst jemand anderem die Verwaltung geben, dann hier ändern.';
    }

    $pdo->prepare('DELETE FROM mitarbeiter_rollen WHERE mitarbeiter_id = ?')->execute([$zielId]);
    $ein = $pdo->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
    foreach ($rollen as $rolle) { $ein->execute([$zielId, $rolle]); }

    // ist_admin bleibt vorerst als Spiegel bestehen. Zwei Wahrheiten waeren
    // schlecht -- darum ist die Rollentabelle die Wahrheit und ist_admin
    // wird nur noch NACHGEFUEHRT, damit ein Endpunkt, der noch nicht
    // umgestellt ist, nicht ploetzlich anders entscheidet.
    $pdo->prepare('UPDATE mitarbeiter SET ist_admin = ? WHERE id = ?')
        ->execute([in_array(ROLLE_VERWALTUNG, $rollen, true) ? 1 : 0, $zielId]);

    sort($vorher); $nachher = $rollen; sort($nachher);
    if ($vorher !== $nachher && function_exists('logbuch_schreiben')) {
        logbuch_schreiben($pdo, $akteur, 'mitarbeiter', $zielId, 'rollen',
            implode(', ', $vorher), implode(', ', $nachher));
    }
    return null;
}

// Rollen aller Personen auf einmal -- fuer die Uebersicht unter Betrieb und
// fuer die Mitarbeiterliste. Eine Abfrage statt einer je Zeile.
function rechte_rollen_alle(PDO $pdo): array
{
    if (!rechte_tabelle_da($pdo)) { return []; }
    $rows = $pdo->query('SELECT mitarbeiter_id, rolle FROM mitarbeiter_rollen')->fetchAll();
    $karte = [];
    foreach ($rows as $r) {
        if (!rolle_gueltig((string)$r['rolle'])) { continue; }
        $karte[(int)$r['mitarbeiter_id']][] = (string)$r['rolle'];
    }
    return $karte;
}
