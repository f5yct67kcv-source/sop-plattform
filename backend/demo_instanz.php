<?php
declare(strict_types=1);
// Der eine Griff in eine Demo-Instanz hinein (ENT-600).
//
// WARUM EINE EIGENE DATEI: Sie ist der Leim zwischen zwei Ebenen, die
// sonst nichts voneinander wissen. betreiber.php weiss, wie man eine
// Mandanten-Datenbank findet (mandant_db). demo_reset.php weiss, wie man
// eine Demo-Instanz leert. Keine der beiden darf die andere einbinden:
// demo_reset.php läuft auch in den Demo-Bündeln, wo es keinen
// Betreiber-Bereich gibt, und betreiber.php läuft auch dort, wo es keine
// Demo gibt. Also steht der Griff hier, wird nur von den Demo-Endpunkten
// des Betreiber-Bereichs eingebunden und zwingt niemandem etwas auf.
//
// GELEERT WIRD ÜBER DIESEN EINEN WEG, nicht an drei Stellen: Beenden,
// Ablaufen und Freigeben tun dasselbe, und wenn es dreimal dasteht, wird
// beim nächsten Umbau eine Stelle vergessen -- die, die am seltensten
// läuft, also der Ablauf, also genau die, die niemand ansieht.
require_once __DIR__ . '/betreiber.php';
require_once __DIR__ . '/demo_reset.php';
require_once __DIR__ . '/support.php';
require_once __DIR__ . '/demo_zugang.php';
// Die Beispieldaten der frischen Instanz -- demo_zugang_einrichten() weiter
// unten ruft sie auf. Kein stiller Vertrag: Wer diese Datei laedt, bekommt
// alles mit, was sie braucht (Lehre aus dem Fehlschlag vom 2026-09-19).
require_once __DIR__ . '/demo_daten.php';
require_once __DIR__ . '/mitarbeiter.php';   // ma_personalnummer_generieren() (ENT-684)
// Fuer kern_schema_fehlend() in der Platzwahl: Der Sollstand des Schemas
// steht dort, wo die Einrichtung ihn selbst benutzt.
require_once __DIR__ . '/planung_einrichten_kern.php';

// Leert die Instanz eines Platzes und sät die Systemrollen neu.
//
// Gibt null zurück, wenn es geklappt hat, sonst den GRUND als Satz. Kein
// bool: "nicht eingetragen", "zeigt auf die Standard-Datenbank", "nicht
// erreichbar" und "nicht eingerichtet" sind vier verschiedene Aussagen,
// und wer sie zu false zusammenzieht, schickt den Betreiber auf die Suche
// (CLAUDE.md: „Unbekannt" darf nie wie „keine" aussehen).
function demo_instanz_leeren(PDO $betreiber, string $platz): ?string
{
    if (!hat_tabelle($betreiber, 'mandant')) {
        return 'Der Mandantenstamm ist noch nicht eingerichtet.';
    }
    $stmt = $betreiber->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
    $stmt->execute([$platz]);
    $m = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$m) {
        return "Der Platz „$platz“ ist im Mandantenstamm nicht eingetragen.";
    }

    // DER WICHTIGSTE FALL. Fällt ein Platz auf die Standardverbindung
    // zurück -- weil db_name leer ist oder das Geheimnis fehlt --, zeigt er
    // auf die Datenbank des laufenden Betriebs. Ein Leeren darauf löschte
    // echte Einsätze, echtes Personal und echte Löhne. Darum wird hier
    // abgebrochen und nicht "sicherheitshalber trotzdem" gearbeitet.
    $lage = mandant_verbindung_bereit($m);
    if ($lage === 'standardverbindung') {
        return "Der Platz „$platz“ zeigt auf die Standard-Datenbank statt auf eine eigene. "
             . 'Es wurde nichts geleert.';
    }
    if ($lage !== 'bereit') {
        return "Der Platz „$platz“ ist nicht verbunden ($lage). Es wurde nichts geleert.";
    }

    try {
        $instanz = mandant_db($m);
    } catch (Throwable $e) {
        return "Der Platz „$platz“ ist nicht erreichbar. Es wurde nichts geleert.";
    }

    // VOR dem Leeren archivieren (ENT-653), nicht danach -- die Rohdaten
    // sind nach demo_reset_alle_tabellen_leeren() weg. Fehlschlagen darf
    // das Archivieren den Ablauf/das Beenden/Freigeben eines Platzes nicht
    // aufhalten: Ein Interessent, dessen Frist ablaeuft, wartet nicht auf
    // eine Statistik.
    try {
        demo_nutzung_archivieren($instanz, $betreiber);
    } catch (Throwable $e) {
        // Absichtlich verschluckt, nicht gemeldet: Diese eine Zeile darf
        // eine sonst erfolgreiche Leerung nicht in einen Fehlerzustand
        // ziehen. Fehlt die Archivtabelle beim Betreiber (be_tabellen()
        // noch nicht eingerichtet), ist das kein Grund, den Platz nicht
        // freizugeben.
    }

    demo_reset_alle_tabellen_leeren($instanz);
    demo_reset_systemrollen_saeen($instanz);
    // Das Support-Konto wieder anlegen (ENT-631). Das Leeren oben macht
    // TRUNCATE auf JEDE Tabelle, also auch auf mitarbeiter -- ohne diese
    // Zeile waere der Supportzugang nach dem ersten Ablauf einer Demo
    // fort, und der Sprung endete auf einer Anmeldemaske, ohne zu sagen
    // warum. Dieselbe Funktion wie in der Einrichtung, nicht eine zweite
    // Fassung davon.
    support_konto_sicherstellen($instanz);
    return null;
}

// Fasst demo_nutzung EINER Instanz je Reiter zusammen (Summe der Dauer,
// Anzahl Meldungen) und schreibt nur dieses Ergebnis ins Archiv der
// Betreiber-Datenbank -- ohne jeden Bezug zur Instanz, zur Firma oder zur
// Person (siehe Kopfkommentar von be_demo_nutzung_archiv, backend/
// betreiber.php). Tut nichts, wenn eine der beiden Tabellen fehlt: ein
// Platz mit aelterem Schema oder eine Betreiber-Datenbank, in der
// be_tabellen_anlegen() noch nicht gelaufen ist, sollen sich trotzdem
// leeren lassen.
function demo_nutzung_archivieren(PDO $instanz, PDO $betreiber): void
{
    if (!hat_tabelle($instanz, 'demo_nutzung') || !hat_tabelle($betreiber, 'be_demo_nutzung_archiv')) {
        return;
    }
    $zeilen = $instanz->query(
        'SELECT reiter, SUM(dauer_s) AS dauer_s_summe, COUNT(*) AS aufrufe
           FROM demo_nutzung GROUP BY reiter'
    )->fetchAll(PDO::FETCH_ASSOC);
    if (!$zeilen) { return; }

    $einfuegen = $betreiber->prepare(
        'INSERT INTO be_demo_nutzung_archiv (reiter, dauer_s_summe, aufrufe) VALUES (?, ?, ?)'
    );
    foreach ($zeilen as $z) {
        $einfuegen->execute([(string)$z['reiter'], (int)$z['dauer_s_summe'], (int)$z['aufrufe']]);
    }
}

// Neues Passwort fuer ein BESTEHENDES Demo-Konto (ENT-601, Punkt 6/7).
//
// Zwei Aufrufer teilen sich diesen Weg und wollen absichtlich dasselbe
// Ergebnis: demo_anfordern.php, wenn dieselbe E-Mail-Adresse ein zweites
// Mal anfragt, und demo_erneut_senden.php, wenn jemand seinen Zugang
// verloren hat. Beide duerfen NIE eine zweite Instanz anlegen -- nur ein
// neues Passwort fuer die, die schon existiert.
//
// Gibt ['fehler' => string, 'mail' => null] oder ['fehler' => null,
// 'mail' => [...]] zurueck -- die aufrufende Datei entscheidet, ob und wie
// sie einen Fehler nach aussen zeigt (demo_erneut_senden.php zeigt NIE
// etwas, demo_anfordern.php zeigt eine Betriebsstoerung).
// $schonRegistriert unterscheidet die beiden Aufrufer (ENT-623): Bei
// "Zugangsdaten erneut senden" hat jemand ausdruecklich danach gefragt und
// bekommt die gewohnte Zugangsdaten-Mail. Bei einer zweiten Anfrage ueber
// das Anforderungsformular hat er das NICHT -- dort muss die Mail zuerst
// sagen, dass sein Zugang bereits besteht, sonst haelt er sie fuer einen
// zweiten. Alles davor -- Passwort setzen, Sitzungen wegwerfen -- ist in
// beiden Faellen dasselbe und bleibt darum an einer Stelle.
function demo_zugang_neues_passwort(PDO $betreiber, array $zugang,
                                    bool $schonRegistriert = false): array
{
    $platz = (string)$zugang['platz'];
    $stmt = $betreiber->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
    $stmt->execute([$platz]);
    $m = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$m) {
        return ['fehler' => "Der Platz „$platz“ ist im Mandantenstamm nicht eingetragen.", 'mail' => null];
    }
    if (mandant_verbindung_bereit($m) !== 'bereit') {
        return ['fehler' => "Der Platz „$platz“ ist nicht verbunden.", 'mail' => null];
    }
    try {
        $instanz = mandant_db($m);
    } catch (Throwable $e) {
        return ['fehler' => "Der Platz „$platz“ ist nicht erreichbar.", 'mail' => null];
    }

    $s = $instanz->prepare('SELECT id FROM mitarbeiter WHERE name = ? LIMIT 1');
    $s->execute([(string)$zugang['login']]);
    $konto = $s->fetch(PDO::FETCH_ASSOC);
    if (!$konto) {
        // Das Register sagt "aktiv", das Konto in der Instanz fehlt --
        // ein Widerspruch, der nicht still uebergangen wird (Hausregel:
        // "unbekannt" darf nie wie "keine" aussehen).
        return ['fehler' => "Das Konto zum Zugang auf „$platz“ fehlt in der Instanz.", 'mail' => null];
    }

    $passwort = demo_passwort_erzeugen();
    $instanz->prepare('UPDATE mitarbeiter SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($passwort, PASSWORD_DEFAULT), (int)$konto['id']]);
    // Bestehende Sitzungen fallen weg -- ein neues Passwort ist ein
    // Wiederherstellungsvorgang, kein normaler Wechsel aus einer
    // angemeldeten Sitzung heraus (dieselbe Regel wie in
    // passwort_zuruecksetzen.php).
    $instanz->prepare('DELETE FROM sessions WHERE mitarbeiter_id = ?')->execute([(int)$konto['id']]);

    // Beide Namen ausgeschrieben statt ueber eine Variable aufgerufen: Ein
    // variabler Funktionsname ist fuer pruef_ladepfad.php unsichtbar, und
    // damit faende sie ein fehlendes require hier nicht mehr.
    $mail = $schonRegistriert
        ? demo_zugang_bekannt_mail(
            (string)$zugang['firma'],
            (string)$zugang['person'],
            (string)demo_platz_adresse($platz),
            (string)$zugang['login'],
            $passwort,
            (string)$zugang['laeuft_ab_am'])
        : demo_zugang_mail(
            (string)$zugang['firma'],
            (string)$zugang['person'],
            (string)demo_platz_adresse($platz),
            (string)$zugang['login'],
            $passwort,
            (string)$zugang['laeuft_ab_am']);
    return ['fehler' => null, 'mail' => $mail];
}

// ══ Einen Demo-Zugang wirklich einrichten (ENT-624) ═══════════════════
//
// Bis ENT-624 stand dieser Ablauf inline in api/demo_anfordern.php. Seit
// der Bestaetigungspflicht braucht ihn ein zweiter Endpunkt
// (api/demo_bestaetigen.php), und zwei Kopien waeren beim naechsten Umbau
// auseinandergelaufen -- dieselbe Ueberlegung wie bei
// demo_zugang_neues_passwort() darueber.
//
// SIE ANTWORTET NICHT SELBST. Kein json_response() hier drin: Die beiden
// Aufrufer machen danach noch weiter (Meldung an den Betreiber, Vermerk am
// Bestaetigungssatz), und eine selbst-antwortende Funktion schnitte ihnen
// das stillschweigend ab -- genau der Fallstrick, vor dem der Kopf von
// demo_daten.php warnt.
//
// Rueckgabe:
//   ['platz' => …, 'adresse' => …, 'laeuft_ab' => …, 'mail' => […],
//    'fehler' => null]                      -- eingerichtet
//   ['fehler' => 'kein_platz',   'code' => 409, 'meldung' => …]
//   ['fehler' => 'nicht_bereit', 'code' => 503, 'meldung' => …]
//   ['fehler' => 'fehlschlag',   'code' => 503, 'meldung' => …]
// Der Grund steht als Wort da, nicht nur als Zahl: "kein Platz frei" und
// "nicht eingerichtet" sind verschiedene Aussagen, und der Aufrufer muss
// sie auseinanderhalten koennen (Hausregel).
function demo_zugang_einrichten(PDO $pdo, string $firma, string $person,
                                string $email, string $telefon): array
{
    $misslungen = static fn (string $fehler, int $code, string $meldung): array
        => ['fehler' => $fehler, 'code' => $code, 'meldung' => $meldung];
    $nichtBereit = 'Der Demo-Bereich ist noch nicht vollständig eingerichtet. '
        . 'Bitte in Kürze erneut versuchen.';
    $fehlschlag = 'Der Demo-Zugang konnte gerade nicht eingerichtet werden. '
        . 'Bitte in Kürze erneut versuchen.';

    // ── Einen freien Platz waehlen, der auch WIRKLICH bereit ist ──
    //
    // ALLE freien Plaetze durchgehen, nicht nur den ersten (Befund
    // 2026-09-19): Zwei der zehn Plaetze standen im Mandantenstamm, ihre
    // Datenbanken waren aber nicht erreichbar. Mit nur einem Versuch
    // sperrte ein kaputter Platz den ganzen Rest -- sind demo1 bis demo5
    // belegt, faellt die Wahl auf demo6, und der Interessent bekommt
    // "noch nicht eingerichtet", obwohl demo7, demo9 und demo10
    // bereitstehen.
    //
    // UEBERSPRUNGEN WIRD NICHT STILL. Jeder uebergangene Platz geht ins
    // Fehlerprotokoll: Ein Vorrat, der lautlos schrumpft, faellt erst auf,
    // wenn er leer ist.
    $belegt = $pdo->query("SELECT platz FROM demo_zugang WHERE status = 'aktiv'")
                  ->fetchAll(PDO::FETCH_COLUMN);
    $frei = demo_plaetze_frei(array_map('strval', $belegt));
    if ($frei === []) {
        return $misslungen('kein_platz', 409,
            'Aktuell sind alle Demo-Plätze belegt. Bitte in Kürze erneut versuchen.');
    }

    $platz = null;
    $m = null;
    $uebersprungen = [];
    foreach ($frei as $kandidat) {
        $stmt = $pdo->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
        $stmt->execute([$kandidat]);
        $kandidatM = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$kandidatM) {
            $uebersprungen[] = "$kandidat (im Mandantenstamm nicht eingetragen)";
            continue;
        }
        $lage = mandant_verbindung_bereit($kandidatM);
        if ($lage !== 'bereit') {
            $uebersprungen[] = "$kandidat (nicht verbunden: $lage)";
            continue;
        }
        // SPALTEN, NICHT NUR TABELLEN (2026-09-19). Bis hierher fragte
        // mandant_stand(), ob fuenf Kerntabellen existieren. Demo-Platz 6
        // und 8 hatten alle Tabellen und trotzdem ein halbes Schema: Die
        // nachtraeglichen Spalten fehlten, weil ihr ALTER TABLE
        // uebersprungen worden war. Beide galten damit als "eingerichtet",
        // waeren geleert worden und erst danach gescheitert -- der
        // Interessent haette einen 503 bekommen und seine Eingabe
        // verloren, und der Platz waere kaputter zurueckgeblieben als
        // vorher.
        //
        // kern_schema_fehlend() prueft den ganzen Bauplan (67 Tabellen,
        // 190 nachtraegliche Spalten) mit EINER Abfrage -- guenstiger als
        // die fuenf Einzelabfragen davor und aus derselben Quelle, aus der
        // die Einrichtung selbst baut.
        try {
            $kandidatPdo = mandant_db($kandidatM);
        } catch (Throwable $e) {
            $uebersprungen[] = "$kandidat (Verbindung fehlgeschlagen)";
            continue;
        }
        $luecken = kern_schema_fehlend($kandidatPdo);
        if ($luecken !== []) {
            // Mit Zahl UND Beispielen: "unvollstaendig" allein sagt
            // niemandem, ob eine Spalte fehlt oder die halbe Anlage.
            $uebersprungen[] = "$kandidat (Schema unvollstaendig, " . count($luecken)
                . ' fehlend: ' . implode(', ', array_slice($luecken, 0, 5))
                . (count($luecken) > 5 ? ', ...' : '') . ')';
            continue;
        }
        $platz = $kandidat;
        $m = $kandidatM;
        break;
    }
    if ($uebersprungen !== []) {
        error_log('demo_zugang_einrichten: uebergangene Plaetze -- '
            . implode(', ', $uebersprungen));
    }
    if ($platz === null || $m === null) {
        // Frei WAREN Plaetze, bereit war keiner. Das ist etwas anderes als
        // "alle belegt" und bekommt darum einen eigenen Grund und einen
        // eigenen Text (Hausregel: "unbekannt" darf nie wie "keine"
        // aussehen). Fuer den Interessenten liest es sich gleich -- er
        // kann mit dem Unterschied nichts anfangen --, fuer den Betreiber
        // steht er im Protokoll.
        return $misslungen('nicht_bereit', 503, $nichtBereit);
    }

    // ── Instanz leeren, befuellen, Konto anlegen ──
    $fehler = demo_instanz_leeren($pdo, $platz);
    if ($fehler !== null) {
        error_log('demo_zugang_einrichten: ' . $fehler);
        return $misslungen('fehlschlag', 503, $fehlschlag);
    }
    $instanz = mandant_db($m);
    // demo_daten_erzeugen() und NICHT die selbst-antwortende
    // demo_daten_erzeugen_ausfuehren(): Nach diesem Aufruf kommt noch
    // Konto, Register und Mail.
    try {
        demo_daten_erzeugen($instanz);
    } catch (Throwable $e) {
        error_log('demo_zugang_einrichten: ' . $e->getMessage());
        return $misslungen('fehlschlag', 503, $fehlschlag);
    }

    // Und nach dem Befuellen: Sind die Systemrollen da? Das Leeren
    // loescht sie, demo_reset_systemrollen_saeen() legt sie neu an. Bleibt
    // das aus, entsteht ein Zugang, in dem niemand ein Recht hat -- die
    // Oberflaeche steht, und nichts laesst sich oeffnen. Das gehoert
    // hierher und nicht in die Vorpruefung: Vorher sind die Rollen
    // ohnehin gleich wieder weg.
    $rollen = (int)$instanz->query('SELECT COUNT(*) FROM rollen WHERE system = 1')->fetchColumn();
    if ($rollen === 0) {
        error_log("demo_zugang_einrichten: $platz ohne Systemrollen nach dem Befuellen");
        return $misslungen('fehlschlag', 503, $fehlschlag);
    }

    $vergeben = $instanz->query('SELECT name FROM mitarbeiter')->fetchAll(PDO::FETCH_COLUMN);
    $login    = demo_login_bilden($firma, array_map('strval', $vergeben));
    $passwort = demo_passwort_erzeugen();

    $teile    = preg_split('/\s+/', $person) ?: [$person];
    $nachname = count($teile) > 1 ? array_pop($teile) : $person;
    $vorname  = count($teile) > 0 ? implode(' ', $teile) : '';
    // Personalnummer gleich mit (ENT-684), gleiche Begruendung wie in
    // setup.php: Jede Person hat eine, ab dem Moment, in dem sie existiert.
    $instanz->prepare(
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, aktiv, personalnummer)
         VALUES (?, ?, 1, ?, ?, 1, ?)'
    )->execute([$login, password_hash($passwort, PASSWORD_DEFAULT), $vorname, $nachname,
                ma_personalnummer_generieren($instanz)]);
    // Alle Rollen ausdruecklich eintragen (2026-09-23, Anordnung des
    // Projektinhabers). Bisher stand hier nur ist_admin = 1, und die Rechte
    // kamen aus dem Rueckfall in rechte_rollen() auf "Verwaltung". An
    // Demo-Platz 3 liess sich damit kein Einsatz anlegen; erst mit allen von
    // Hand vergebenen Rollen ging es. Ein Interessent soll die Plattform
    // ueberall nutzen koennen, ohne zuerst die Rollenvergabe zu finden --
    // und in der Administration sieht man jetzt, was er hat.
    $neu = $instanz->prepare('SELECT id FROM mitarbeiter WHERE name = ?');
    $neu->execute([$login]);
    demo_betreiber_rollen_setzen($instanz, (int)$neu->fetchColumn());

    // ── Register ──
    $start    = date('Y-m-d H:i:s');
    $laeuftAb = demo_zugang_ablauf($start);
    $pdo->prepare(
        'INSERT INTO demo_zugang (platz, firma, person, email, telefon, login, status,
                                  freigegeben_am, freigegeben_von, laeuft_ab_am)
         VALUES (?, ?, ?, ?, ?, ?, \'aktiv\', ?, ?, ?)'
    )->execute([$platz, $firma, $person, $email, $telefon, $login, $start,
        DEMO_FREIGEGEBEN_AUTOMATISCH, $laeuftAb]);

    $adresse = (string)demo_platz_adresse($platz);
    return [
        'fehler'    => null,
        'platz'     => $platz,
        'adresse'   => $adresse,
        'laeuft_ab' => $laeuftAb,
        'mail'      => demo_zugang_mail($firma, $person, $adresse, $login, $passwort, $laeuftAb),
    ];
}

// Welche Rollen der Demobetreiber bekommt: jede Systemrolle, die es gibt.
// Aus dem Katalog gelesen und nicht aufgezaehlt -- kommt eine Rolle dazu,
// hat er sie ohne weiteres Zutun auch. Ohne Datenbank, damit sie sich fuer
// sich allein pruefen laesst.
function demo_betreiber_rollen(): array
{
    return array_keys(system_rollen());
}

function demo_betreiber_rollen_setzen(PDO $instanz, int $mitarbeiterId): void
{
    if ($mitarbeiterId <= 0) {
        throw new RuntimeException('demo_betreiber_rollen_setzen: Konto nicht gefunden');
    }
    $ein = $instanz->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
    foreach (demo_betreiber_rollen() as $rolle) {
        $ein->execute([$mitarbeiterId, $rolle]);
    }
}

// Traegt einem BESTEHENDEN Demobetreiber nach, was ihm an Rollen fehlt
// (2026-09-23, Anordnung des Projektinhabers). demo_betreiber_rollen_setzen()
// wirkt nur bei neu eingerichteten Zugaengen; die schon vergebenen Plaetze
// holt der zentrale Einrichtungslauf (api/betreiber_schema_pruefen.php) mit
// diesem Schritt nach.
//
// Angesprochen wird nur, wer im Register des Betreibers als AKTIVER
// Demo-Zugang dieses Platzes steht -- ueber den Anmeldenamen. So kann der
// Schritt nie ein Konto eines echten Mandanten erreichen: Dort gibt es
// keinen Registereintrag. Nimmt nichts weg, fuegt nur hinzu, und ist damit
// beliebig oft wiederholbar.
//
// Gibt je Konto einen Satz fuer die Liste "getan" (bzw. "offen" beim
// Pruefen) zurueck; leer heisst: nichts zu tun.
function demo_betreiber_rollen_nachtragen(PDO $betreiber, PDO $instanz, string $platz,
                                          bool $nurPruefen): array
{
    $z = $betreiber->prepare("SELECT login FROM demo_zugang WHERE platz = ? AND status = 'aktiv'");
    $z->execute([$platz]);
    $saetze = [];
    foreach ($z->fetchAll(PDO::FETCH_COLUMN) as $login) {
        $ma = $instanz->prepare('SELECT id FROM mitarbeiter WHERE name = ?');
        $ma->execute([(string)$login]);
        $id = (int)$ma->fetchColumn();
        if ($id <= 0) { continue; }
        $r = $instanz->prepare('SELECT rolle FROM mitarbeiter_rollen WHERE mitarbeiter_id = ?');
        $r->execute([$id]);
        $fehlen = array_values(array_diff(demo_betreiber_rollen(), $r->fetchAll(PDO::FETCH_COLUMN)));
        if (!$fehlen) { continue; }
        if (!$nurPruefen) {
            $ein = $instanz->prepare('INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
            foreach ($fehlen as $rolle) { $ein->execute([$id, $rolle]); }
        }
        $saetze[] = 'Demobetreiber „' . $login . '“: ' . count($fehlen)
            . ($nurPruefen ? ' Rolle(n) fehlen noch' : ' Rolle(n) nachgetragen');
    }
    return $saetze;
}
