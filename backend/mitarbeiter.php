<?php
declare(strict_types=1);
// Fachlogik rund um Mitarbeitende (ENT-072).
//
// Diese Datei ist die EINZIGE Stelle, an der entschieden wird, welche Felder
// ein Mitarbeitender hat, welche Werte zulaessig sind und wie eine Eingabe
// aufbereitet wird. Anlegen und Bearbeiten laufen beide hier durch. Der
// Grund ist derselbe wie beim Kundenimport (ENT-066): Zwei Wege in dieselbe
// Tabelle sind zwei Regelwerke, die irgendwann auseinanderlaufen -- und der
// Mitarbeiterstamm traegt seit diesem Ausbau Angaben, bei denen ein
// stillschweigender Unterschied teuer wird.
//
// plz_ort_trennen() kommt aus kunden.php und wird hier mitbenutzt statt
// nachgebaut: Es ist dieselbe Aufgabe an einer anderen Tabelle.
require_once __DIR__ . '/kunden.php';
// kategorie_pruefen() und pensum_pruefen() stehen seit ENT-065 in planung.php,
// wo auch die Pensen-Kontrolle sie benutzt. Hier werden sie AUFGERUFEN und
// nicht nachgebaut -- sonst gaebe es zwei Meinungen darueber, was eine
// gueltige Anstellungskategorie ist.
require_once __DIR__ . '/planung.php';
// logbuch_schreiben() fuer ma_login_migrieren() (ENT-381) -- die Umstellung
// bestehender Login-Namen schreibt ihren eigenen Logbuch-Eintrag, statt das
// dem Endpunkt zu ueberlassen: Sonst gaebe es zwei Stellen, die wissen
// muessten, wann genau ein Konto tatsaechlich umbenannt wurde.
require_once __DIR__ . '/logbuch.php';

// ── Zulaessige Werte ─────────────────────────────────────────────────────
// Feste Listen, weil es feste Begriffe sind: Der Zivilstand und die
// Ausweiskategorien stehen im Gesetz beziehungsweise beim Bund, sie sind
// keine Betriebssache. Funktion, Abteilung und Standort sind das Gegenteil
// und liegen darum in eigenen Tabellen (Entscheid des Projektinhabers).

const MA_ANREDEN = ['Herr', 'Frau', 'Divers'];

// Getrennt von der Anrede, weil es zwei verschiedene Dinge sind: die Anrede
// ist die Ansprache, das Geschlecht die Angabe fuer AHV und Versicherung.
const MA_GESCHLECHTER = ['weiblich', 'maennlich', 'unbestimmt'];

// Zivilstaende nach dem Schweizer Zivilgesetzbuch, in der Fassung, die auch
// der eCH-0011-Standard fuehrt -- eingetragene Partnerschaften eingeschlossen.
const MA_ZIVILSTAENDE = [
    'ledig', 'verheiratet', 'verwitwet', 'geschieden',
    'eingetragene Partnerschaft', 'aufgeloeste Partnerschaft',
];

// Auslaenderausweise des Bundes. Bewusst nur das Kuerzel gespeichert -- die
// Bedeutung steht in der Oberflaeche, damit sie sich aendern kann, ohne dass
// gespeicherte Werte ungueltig werden.
const MA_AUSWEISE = ['B', 'C', 'Ci', 'G', 'L', 'F', 'N', 'S'];

const MA_SPRACHEN = ['de', 'fr', 'it', 'en'];

// Die vier eidgenoessischen Fachausweise, die Art. 19 Ziff. 1 GAV woertlich
// nennt: "fuer Personenschutz, Bewachung, Anlaesse oder Zentralendienste".
// Kein Ja/Nein, weil der Wortlaut vier verschiedene aufzaehlt.
const MA_FACHAUSWEISE = ['Personenschutz', 'Bewachung', 'Anlaesse', 'Zentralendienste'];

// Womit die Person UEBLICHERWEISE zum Einsatz anreist (ENT-123/ENT-125).
// Massgeblich fuer den Fahrkostenersatz nach Art. 18 Ziff. 4 und 5 -- der
// Fahrzeitersatz ist davon unabhaengig und in jedem Fall geschuldet.
//   Privatfahrzeug      -- eigenes Auto/Motorrad: voller Fahrkostenersatz
//   Oeffentlicher Verkehr -- Preis des Billetts, 2. Klasse (Ziff. 4)
//   Mitfahrer           -- faehrt bei jemand anderem mit: einzig Fahrzeitersatz
//   Geschaeftsfahrzeug   -- Geschaeftsfahrzeug oder vom Arbeitgeber organisiert:
//                          einzig Fahrzeitersatz (Ziff. 4 bzw. 5)
// Werte als lesbarer deutscher Text, ASCII ohne Umlaute -- wie MA_FACHAUSWEISE.
// Das generische Auswahlfeld (mbAuswahl in dashboard.html) zeigt den
// gespeicherten Wert unveraendert als Beschriftung; ein Programmier-Code
// wie "oev" erschiene dort unuebersetzt.
// Das ist die VORGABE der Person. Je Einsatz laesst sie sich ueberschreiben
// (einsatz_zuteilung.verkehrsmittel) -- fuer die Fahrgemeinschaft, die es nur
// diesmal gibt.
const MA_VERKEHRSMITTEL = ['Privatfahrzeug', 'Oeffentlicher Verkehr', 'Mitfahrer', 'Geschaeftsfahrzeug'];

// ── Feldliste ────────────────────────────────────────────────────────────
// Reihenfolge und Typ an EINER Stelle. Wer ein Feld ergaenzt, ergaenzt es
// hier -- Endpunkte und Pruefungen ziehen daraus.
//   text   beliebiger Text
//   datum  YYYY-MM-DD oder leer
//   zahl   ganze Zahl oder leer
//   liste  einer der oben erlaubten Werte oder leer
//   id     Verweis auf eine andere Tabelle oder leer
function ma_felder(): array
{
    return [
        // Personalien
        'personalnummer' => 'text',
        'anrede'         => 'liste',
        'geschlecht'     => 'liste',
        'vorname'        => 'text',
        'nachname'       => 'text',
        'geburtsdatum'   => 'datum',
        'geburtsort'     => 'text',
        'heimatort'      => 'text',
        'nationalitaet'  => 'text',
        'zivilstand'     => 'liste',
        'heiratsdatum'   => 'datum',
        'ahv_nr'         => 'text',
        // Adresse
        'strasse'        => 'text',
        'hausnummer'     => 'text',
        'adresszusatz'   => 'text',
        'plz'            => 'text',
        'ort'            => 'text',
        'land'           => 'text',
        // Kontakt
        'telefon'           => 'text',
        'telefon_geschaeft' => 'text',
        'mobil'             => 'text',
        'mobil_geschaeft'   => 'text',
        'email'             => 'text',
        'email_privat'      => 'text',
        'notfallkontakt'    => 'text',
        // Betriebliches
        'kurzzeichen'          => 'text',
        'funktion_id'          => 'id',
        'abteilung_id'         => 'id',
        'anstellungsort_id'    => 'id',
        'beruf'                => 'text',
        'eintritt'             => 'datum',
        'austritt'             => 'datum',
        'anstellungskategorie' => 'text',
        'pensum_stunden'       => 'zahl',
        // Ausweise und Bewilligungen
        'aufenthaltsbewilligung'    => 'liste',
        'aufenthalt_gueltig_bis'    => 'datum',
        'arbeitsbewilligung'        => 'text',
        'arbeit_gueltig_bis'        => 'datum',
        'zemis_nr'                  => 'text',
        'strafregister_datum'       => 'datum',
        'betreibung_datum'          => 'datum',
        'dienstausweis_nr'          => 'text',
        'dienstausweis_gueltig_bis' => 'datum',
        // Qualifikationen mit Lohnfolge (Art. 19 und Art. 10 GAV)
        //
        // Hier steht die BERECHTIGUNG, nicht der Zuschlag. Nach Art. 19
        // Ziff. 2 und 3 entsteht dieser aus dem ANGEORDNETEN Einsatz mit
        // Diensthund beziehungsweise Schusswaffe -- das gehoert an die
        // Schicht und ist noch nicht gebaut. Wer die beiden verwechselt,
        // zahlt Zuschlaege an Leute, die an diesem Tag weder Hund noch
        // Waffe dabeihatten.
        'fachausweis'                => 'liste',
        'fachausweis_am'             => 'datum',
        'diensthundefuehrer'         => 'janein',
        'diensthund_bewilligung_bis' => 'datum',
        'waffentragberechtigt'       => 'janein',
        'waffe_bewilligung_bis'      => 'datum',
        'basisausbildung_am'         => 'datum',
        // Einsatzbereich-Berechtigung (ENT-284), KEINE Lohnfolge -- reine
        // Zugriffssteuerung (Waechter-Reiter in der App, Warnung beim
        // Zuteilen ohne Berechtigung), kein Zuschlag wie bei den beiden
        // Feldern oben. Bewusst ein eigener Abschnitt statt hier
        // hineingemischt, siehe MB_ABSCHNITTE in dashboard.html.
        'revierdienst_berechtigt'    => 'janein',
        // Zugang
        'sprache'    => 'liste',
        'zugang_bis' => 'datum',
        // Auslagenersatz (ENT-123/ENT-125). Nicht vertraulich. In der
        // Sammelliste (ma_listenfelder), weil sie dort gebraucht wird: Der
        // Einsatzplan zeigt die Vorgabe neben der Ausnahme-Auswahl, damit
        // klar ist, wovon die Ausnahme ueberhaupt abweicht -- ohne einen
        // eigenen Abruf je Person.
        'verkehrsmittel' => 'liste',
    ];
}

// ── Was darf wohin? ──────────────────────────────────────────────────────
// Die Liste aller Mitarbeitenden wird bei JEDEM Laden des Dashboards geholt.
// Was hier drinsteht, liegt danach im Browser -- fuer alle Personen
// gleichzeitig. Darum traegt die Liste nur, was die Liste auch anzeigt; die
// uebrigen Angaben kommen einzeln ueber mitarbeiter_dossier.php, wenn jemand
// wirklich einen Datensatz oeffnet.
//
// Das ist kein Rollenmodell -- ein solches gibt es hier bis heute nicht, es
// kennt nur "Admin ja/nein". Es ist die schlichte Regel, nicht auszuliefern,
// was niemand anzeigt. Die Frage, wer welche Feldgruppe sehen darf, bleibt
// offen und ist im Protokoll festgehalten.
function ma_listenfelder(): array
{
    return [
        'personalnummer', 'anrede', 'vorname', 'nachname',
        'strasse', 'hausnummer', 'plz', 'ort',
        'telefon', 'mobil', 'email',
        'kurzzeichen', 'funktion_id', 'abteilung_id', 'anstellungsort_id',
        'eintritt', 'austritt', 'anstellungskategorie', 'pensum_stunden',
        // Die Berechtigungen gehoeren in die Liste, die Ausbildungsdaten
        // nicht: Wer einteilt, muss sehen, wer Hund oder Waffe fuehren darf --
        // sonst plant man jemanden auf einen Einsatz, den er nicht leisten
        // darf. Das WANN einer Ausbildung braucht dafuer niemand. Dieselbe
        // Begruendung gilt fuer revierdienst_berechtigt (ENT-284).
        'fachausweis', 'diensthundefuehrer', 'waffentragberechtigt',
        'revierdienst_berechtigt', 'verkehrsmittel',
    ];
}

// Angaben, die nie in einer Sammelabfrage auftauchen. Ausdruecklich benannt
// statt "alles ausser der Liste", damit ein neues Feld nicht versehentlich
// mitfaehrt: Wer hier etwas ergaenzt, entscheidet es bewusst.
function ma_vertrauliche_felder(): array
{
    return [
        'ahv_nr', 'nationalitaet', 'heimatort', 'geburtsort', 'zivilstand',
        'heiratsdatum', 'geburtsdatum', 'geschlecht',
        'aufenthaltsbewilligung', 'aufenthalt_gueltig_bis',
        'arbeitsbewilligung', 'arbeit_gueltig_bis', 'zemis_nr',
        'strafregister_datum', 'betreibung_datum',
        'dienstausweis_nr', 'dienstausweis_gueltig_bis',
    ];
}

// Welche der Felder gibt es in der Datenbank wirklich? Der Nachtrag laeuft
// erst, wenn der Projektinhaber "Einrichtung" drueckt -- bis dahin fehlen die
// neuen Spalten. Ohne diese Pruefung wuerde ein INSERT ueber die volle
// Feldliste komplett scheitern, statt die neuen Angaben bloss zu uebergehen:
// Man koennte also niemanden mehr anlegen, weil ein Feld fehlt, das man gar
// nicht ausgefuellt hat. Das Ergebnis wird je Anfrage gemerkt.
function ma_vorhandene_felder(PDO $pdo): array
{
    static $spalten = null;
    if ($spalten === null) {
        $spalten = [];
        foreach ($pdo->query('SHOW COLUMNS FROM mitarbeiter')->fetchAll(PDO::FETCH_ASSOC) as $z) {
            $spalten[$z['Field']] = true;
        }
    }
    return array_filter(ma_felder(), fn($f) => isset($spalten[$f]), ARRAY_FILTER_USE_KEY);
}

function ma_spalte_da(PDO $pdo, string $spalte): bool
{
    return array_key_exists($spalte, ma_vorhandene_felder($pdo))
        || in_array($spalte, ['passwort_geaendert_am', 'letzter_zugriff'], true)
           && (bool)$pdo->query("SHOW COLUMNS FROM mitarbeiter LIKE " . $pdo->quote($spalte))->fetch();
}

// ── Login-Name automatisch (ENT-376) ────────────────────────────────────
// Der Login-Name laesst sich nach dem Anlegen nicht mehr aendern -- eine
// frei getippte erste Fassung liesse sich also nie mehr korrigieren.
// Darum wird er hier zentral aus Vorname und Nachname gebildet, klein
// geschrieben und ohne Leerzeichen ("Adrian von Arb" -> "adrian.vonarb").
// Das laeuft im Server, nicht nur im Formular (mitarbeiter_create.php ruft
// dies auf und ignoriert einen mitgeschickten Login-Namen) -- eine Sperre,
// die sich am Browser vorbei umgehen liesse, waere keine.
//
// Gibt es die Kombination schon (Namensgleichheit), haengt eine laufende
// Nummer an: max.muster, bei Kollision max.muster2, max.muster3, ... Das
// Anlegen soll nie an einem gleichlautenden Namen scheitern (Entscheidung
// des Projektinhabers, ENT-376).
//
// Seit ENT-393 gibt es doch eine manuelle Korrektur -- aber nur fuer die
// Verwaltung (Recht 'rechte') und nur im selben Muster, siehe
// ma_login_name_gueltig() unten und die Ausnahme in mitarbeiter_update.php.
function ma_login_generieren(string $vorname, string $nachname, PDO $pdo): string
{
    $v = trim($vorname);
    $n = trim($nachname);
    if ($v === '' || $n === '') { return ''; }
    $basis = strtolower(preg_replace('/\s+/', '', "$v.$n"));
    $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM mitarbeiter WHERE name = ?');
    $kandidat = $basis;
    for ($lauf = 2; $lauf < 1000; $lauf++) {
        $stmt->execute([$kandidat]);
        if ((int)$stmt->fetch()['c'] === 0) { return $kandidat; }
        $kandidat = $basis . $lauf;
    }
    return $kandidat;
}

// Prueft, ob ein von Hand eingetragener Login-Name demselben Muster folgt,
// das ma_login_generieren() selbst erzeugen wuerde: klein geschrieben, ohne
// Leerzeichen, mindestens zwei durch einen Punkt getrennte Teile (ENT-393).
// Nur die FORM wird geprueft, nicht die Eindeutigkeit -- das ist Sache des
// Aufrufers, der den Bestand kennt (siehe mitarbeiter_update.php).
function ma_login_name_gueltig(string $name): bool
{
    return preg_match('/^[\p{Ll}0-9]+(\.[\p{Ll}0-9]+)+$/u', $name) === 1;
}

// ── Login-Namen-Umstellung im Bestand (ENT-381) ─────────────────────────
// ENT-376 gilt seither nur fuer NEUE Konten. Auf ausdruecklichen Wunsch des
// Projektinhabers (harter Schnitt, keine Uebergangsfrist -- der Login-Name
// ist die einzige Anmeldekennung, es gibt kein Login per E-Mail) stellt
// diese Funktion auch bestehende Konten auf dasselbe Muster um.
//
// Reine Berechnung, schreibt nichts -- Vorschau (GET) und Ausfuehrung
// (POST) im Endpunkt rufen dieselbe Funktion auf, damit garantiert
// dasselbe herauskommt, was vorher angezeigt wurde.
//
// Verarbeitet in Reihenfolge der ID (== Reihenfolge des Anlegens): Bei
// Namensgleichheit bekommt, wer zuerst da war, die Form ohne Nummer --
// dasselbe Prinzip wie bei der ENT-Nummern-Korrektur im Projekt-
// Repository ("behalten darf sie, wer sie zuerst vergeben hat").
//
// Wessen Vor- oder Nachname fehlt, wird uebersprungen und behaelt den
// bisherigen Namen -- der zaehlt von Anfang an als vergeben, nicht erst,
// wenn die Reihe an ihn kaeme, sonst koennte ihm jemand anders seinen
// Namen wegnehmen.
//
// Idempotent: ein zweiter Lauf berechnet fuer bereits umgestellte Konten
// wieder denselben Namen (Status "unveraendert") und ruehrt sie nicht an.
//
// Personalnummer, Status und Anlegedatum kommen mit (ENT-383) -- nicht fuer
// die Berechnung, sondern damit die Vorschau zwei gleich benannte Zeilen
// unterscheidbar macht. Genau das deckte beim ersten echten Blick auf den
// Plan eine bestehende Dopplung im Bestand auf: zwei Datensaetze mit
// demselben Vor-/Nachnamen, einer davon inaktiv und darum in der normalen
// Liste (mitarbeiter_list.php, WHERE aktiv = 1) gar nicht sichtbar. Ohne
// diese Angaben liesse sich vor der Ausfuehrung nicht erkennen, ob das
// zwei echte Personen oder eine Karteileiche ist. Keine vertraulichen
// Felder (ma_vertrauliche_felder()) -- alle drei stehen ohnehin schon in
// der normalen Mitarbeiterliste.
function ma_login_migrationsplan(PDO $pdo): array
{
    $rows = $pdo->query('SELECT id, name, vorname, nachname, personalnummer, aktiv, erstellt_am
                          FROM mitarbeiter ORDER BY id')
                ->fetchAll(PDO::FETCH_ASSOC);

    $reserviert = [];
    foreach ($rows as $r) {
        if (trim((string)$r['vorname']) === '' || trim((string)$r['nachname']) === '') {
            $reserviert[$r['name']] = true;
        }
    }

    $zeile = fn(array $r, ?string $neu, string $status, ?string $grund) => [
        'id' => (int)$r['id'], 'alt' => $r['name'], 'neu' => $neu,
        'status' => $status, 'grund' => $grund,
        'personalnummer' => $r['personalnummer'], 'aktiv' => (bool)$r['aktiv'],
        'erstellt_am' => $r['erstellt_am'],
    ];

    $plan = [];
    foreach ($rows as $r) {
        $vorname = trim((string)$r['vorname']);
        $nachname = trim((string)$r['nachname']);
        if ($vorname === '' || $nachname === '') {
            $plan[] = $zeile($r, null, 'uebersprungen', 'Vorname oder Nachname fehlt');
            continue;
        }
        $basis = strtolower(preg_replace('/\s+/', '', "$vorname.$nachname"));
        $kandidat = $basis;
        for ($lauf = 2; isset($reserviert[$kandidat]); $lauf++) {
            $kandidat = $basis . $lauf;
        }
        $reserviert[$kandidat] = true;
        $plan[] = $zeile($r, $kandidat, $kandidat === $r['name'] ? 'unveraendert' : 'umbenannt', null);
    }
    return $plan;
}

// Fuehrt den Plan aus ma_login_migrationsplan() wirklich aus: benennt um,
// beendet die Sitzungen der umbenannten Konten (das alte Passwort bleibt
// gueltig, aber der alte Login-Name nicht mehr -- ein noch offenes
// Browserfenster darf nicht unter dem alten Namen weiterlaufen) und
// schreibt je Konto einen Logbuch-Eintrag. Nur Zeilen mit Status
// "umbenannt" werden angefasst; "unveraendert" und "uebersprungen" bleiben
// unberuehrt, auch in ihren Sitzungen.
function ma_login_migrieren(PDO $pdo, array $akteur): array
{
    $plan = ma_login_migrationsplan($pdo);
    $upd = $pdo->prepare('UPDATE mitarbeiter SET name = ? WHERE id = ?');
    $ses = $pdo->prepare('DELETE FROM sessions WHERE mitarbeiter_id = ?');
    foreach ($plan as $eintrag) {
        if ($eintrag['status'] !== 'umbenannt') { continue; }
        $upd->execute([$eintrag['neu'], $eintrag['id']]);
        $ses->execute([$eintrag['id']]);
        logbuch_schreiben($pdo, $akteur, 'mitarbeiter', $eintrag['id'],
            'name', $eintrag['alt'], $eintrag['neu']);
    }
    return $plan;
}

// ── Personalnummer automatisch (ENT-387) ────────────────────────────────
// Auf ausdruecklichen Wunsch des Projektinhabers zufaellig statt
// fortlaufend: eine vierstellige Zahl (1000-9999), die weder Anlegereihen-
// folge noch Mitarbeiterzahl verraet -- anders als eine hochzaehlende
// Nummer. Einzige Vorgabe: jede Person hat eine, und welche, laesst sich
// nachtraeglich nicht mehr aendern -- ausser fuer die Verwaltung, siehe
// ma_personalnummer_gueltig() und die Ausnahme in mitarbeiter_update.php
// (ENT-393). Die Sperre fuer alle anderen bleibt in ma_eingabe_lesen().
function ma_personalnummer_generieren(PDO $pdo): string
{
    $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM mitarbeiter WHERE personalnummer = ?');
    for ($versuch = 0; $versuch < 500; $versuch++) {
        $kandidat = (string)random_int(1000, 9999);
        $stmt->execute([$kandidat]);
        if ((int)$stmt->fetch()['c'] === 0) { return $kandidat; }
    }
    // Bei 9000 moeglichen Werten in den ueblichen Groessenordnungen dieses
    // Betriebs praktisch unerreichbar -- kommt es doch so weit, ist das ein
    // echter Befund (Stellenzahl zu knapp geworden) und kein Fall fuer eine
    // Endlosschleife, die den Aufruf einfach haengen liesse.
    throw new RuntimeException('Keine freie Personalnummer gefunden.');
}

// Prueft, ob eine von Hand eingetragene Personalnummer demselben Muster
// folgt, das ma_personalnummer_generieren() selbst ziehen wuerde: vierstellig,
// erste Ziffer nicht 0 (Bereich 1000-9999) (ENT-393). Nur die FORM wird
// geprueft, nicht die Eindeutigkeit -- das ist Sache des Aufrufers, der den
// Bestand kennt (siehe mitarbeiter_update.php).
function ma_personalnummer_gueltig(string $pn): bool
{
    return preg_match('/^[1-9]\d{3}$/', $pn) === 1;
}

// ── Personalnummern-Nachtrag im Bestand (ENT-387) ───────────────────────
// Wer schon eine Personalnummer hat, behaelt sie unveraendert -- nur wer
// keine hat, bekommt eine zugewiesen. Reine Berechnung, schreibt nichts;
// Vorschau (GET) und Ausfuehrung (POST) im Endpunkt rufen dieselbe Funktion
// auf, gleiches Muster wie ma_login_migrationsplan().
//
// Anders als beim Login-Namen gibt es hier keine Namensgleichheit und
// keine uebersprungenen Zeilen: Jede Person ohne Nummer bekommt eine.
function ma_personalnummer_migrationsplan(PDO $pdo): array
{
    $rows = $pdo->query('SELECT id, name, personalnummer, aktiv, erstellt_am FROM mitarbeiter ORDER BY id')
                ->fetchAll(PDO::FETCH_ASSOC);
    $vergeben = [];
    foreach ($rows as $r) {
        $pn = trim((string)$r['personalnummer']);
        if ($pn !== '') { $vergeben[$pn] = true; }
    }

    $plan = [];
    foreach ($rows as $r) {
        $pn = trim((string)$r['personalnummer']);
        if ($pn !== '') {
            $plan[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'alt' => $pn, 'neu' => $pn,
                'status' => 'unveraendert', 'aktiv' => (bool)$r['aktiv'], 'erstellt_am' => $r['erstellt_am']];
            continue;
        }
        do {
            $kandidat = (string)random_int(1000, 9999);
        } while (isset($vergeben[$kandidat]));
        $vergeben[$kandidat] = true;
        $plan[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'alt' => null, 'neu' => $kandidat,
            'status' => 'zugewiesen', 'aktiv' => (bool)$r['aktiv'], 'erstellt_am' => $r['erstellt_am']];
    }
    return $plan;
}

// Fuehrt den Plan aus ma_personalnummer_migrationsplan() wirklich aus.
// Anders als bei ma_login_migrieren() gibt es hier keine Sitzungen zu
// beenden -- die Personalnummer ist kein Anmeldemerkmal, ihre Vergabe
// meldet niemanden ab. Nur Zeilen mit Status "zugewiesen" werden
// angefasst; wer schon eine Nummer hatte, bleibt unberuehrt.
function ma_personalnummer_migrieren(PDO $pdo, array $akteur): array
{
    $plan = ma_personalnummer_migrationsplan($pdo);
    $upd = $pdo->prepare('UPDATE mitarbeiter SET personalnummer = ? WHERE id = ?');
    foreach ($plan as $eintrag) {
        if ($eintrag['status'] !== 'zugewiesen') { continue; }
        $upd->execute([$eintrag['neu'], $eintrag['id']]);
        logbuch_schreiben($pdo, $akteur, 'mitarbeiter', $eintrag['id'],
            'personalnummer', $eintrag['alt'], $eintrag['neu']);
    }
    return $plan;
}

// ── Eingabe lesen ────────────────────────────────────────────────────────
// Gibt die Spaltenwerte zurueck, die geschrieben werden sollen, sowie eine
// Liste von Beanstandungen. Nicht mitgeschickte Felder bleiben beim
// Bestandswert -- so kann ein Formular auch nur einen Teil senden, ohne den
// Rest zu leeren.
function ma_eingabe_lesen(array $input, array $bestand = [], ?PDO $pdo = null): array
{
    $fehler = [];
    $spalten = [];

    // Mit PDO nur die Felder, die es in der Datenbank auch gibt; ohne PDO
    // die volle Liste (so koennen Pruefungen die Logik ohne Datenbank testen).
    $felder = $pdo ? ma_vorhandene_felder($pdo) : ma_felder();
    foreach ($felder as $feld => $typ) {
        // Personalnummer wird automatisch vergeben und laesst sich danach
        // nicht mehr aendern (ENT-387) -- weder beim Anlegen (das setzt
        // mitarbeiter_create.php separat ueber ma_personalnummer_generieren())
        // noch beim Bearbeiten. Ein mitgeschickter Wert wird stillschweigend
        // uebergangen statt einen Fehler zu werfen: Anders als bei ahv_nr
        // (ENT-348, die nie erfasst werden soll) schickt ein gewoehnliches
        // Formular hier den unveraenderten Bestandswert bei jedem Speichern
        // mit -- ein Fehler dabei bräche jedes normale Speichern.
        //
        // Diese Funktion kennt keine Rechte -- die eine Ausnahme (Verwaltung
        // darf von Hand korrigieren, ENT-393) lebt darum bewusst NICHT hier,
        // sondern als gezielter Zusatzschritt in mitarbeiter_update.php, der
        // ueber $s['personalnummer'] hinweg entscheidet, nachdem diese
        // Funktion zurueckgekehrt ist.
        if ($feld === 'personalnummer') {
            if (array_key_exists('personalnummer', $bestand)) {
                $spalten['personalnummer'] = $bestand['personalnummer'];
            }
            continue;
        }
        if (!array_key_exists($feld, $input)) {
            if (array_key_exists($feld, $bestand)) { $spalten[$feld] = $bestand[$feld]; }
            continue;
        }
        $roh = trim((string)($input[$feld] ?? ''));

        if ($roh === '') {
            // Leer heisst leer -- und bei Verweisen, Zahlen und DATEN NULL,
            // nicht 0 und nicht der leere Text. Ein leerer Text in einer
            // DATE-Spalte wird von MySQL ausserhalb des strengen Modus zu
            // '0000-00-00'; die Oberflaeche zeigte daraufhin "00.00.0000"
            // und stempelte nicht erfasste Bewilligungen als "abgelaufen".
            // Ein nicht erfasstes Datum ist UNBEKANNT, nicht der 0.0.0000.
            // Ein Ja/Nein-Feld kennt kein "leer": nicht angekreuzt heisst nein.
            if ($typ === 'janein') { $spalten[$feld] = 0; continue; }
            $spalten[$feld] = ($typ === 'id' || $typ === 'zahl' || $typ === 'datum') ? null : '';
            continue;
        }

        switch ($typ) {
            case 'datum':
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $roh)) {
                    $fehler[] = "$feld: kein gueltiges Datum";
                    $spalten[$feld] = null;
                } else {
                    $spalten[$feld] = $roh;
                }
                break;
            case 'zahl':
                $spalten[$feld] = (int)$roh;
                break;
            case 'janein':
                $spalten[$feld] = in_array(strtolower($roh), ['1', 'true', 'ja', 'on'], true) ? 1 : 0;
                break;
            case 'id':
                $spalten[$feld] = (int)$roh > 0 ? (int)$roh : null;
                break;
            case 'liste':
                $erlaubt = ma_erlaubte_werte($feld);
                if ($erlaubt !== null && !in_array($roh, $erlaubt, true)) {
                    $fehler[] = "$feld: unzulaessiger Wert";
                    $spalten[$feld] = '';
                } else {
                    $spalten[$feld] = $roh;
                }
                break;
            default:
                $spalten[$feld] = $roh;
        }
    }

    // PLZ und Ort. Schickt der Aufrufer beide getrennt, gilt seine Aufteilung.
    // Schickt er nur den Ort, wird getrennt -- gleiches Verhalten wie beim
    // Kundenstamm, damit ein Formular mit einem gemeinsamen Feld weiterhin
    // funktioniert.
    if (!array_key_exists('plz', $input) && array_key_exists('ort', $input)) {
        [$gPlz, $gOrt] = plz_ort_trennen((string)($spalten['ort'] ?? ''));
        if ($gPlz !== '') { $spalten['plz'] = $gPlz; $spalten['ort'] = $gOrt; }
    }

    // Anstellungskategorie und Pensum laufen durch die Pruefungen aus
    // planung.php -- dieselben, gegen die die Pensen-Kontrolle rechnet.
    if (array_key_exists('anstellungskategorie', $spalten)) {
        $vorher = trim((string)$spalten['anstellungskategorie']);
        $spalten['anstellungskategorie'] = kategorie_pruefen($vorher);
        if ($vorher !== '' && $spalten['anstellungskategorie'] === null) {
            $fehler[] = 'Anstellungskategorie: nur A, B oder C';
        }
    }
    if (array_key_exists('pensum_stunden', $spalten)) {
        $vorher = $spalten['pensum_stunden'];
        $spalten['pensum_stunden'] = pensum_pruefen($vorher);
        if ($vorher !== null && $vorher !== '' && $spalten['pensum_stunden'] === null) {
            $fehler[] = 'Jahrespensum: nur 1 bis 3000 Stunden';
        }
    }

    // AHV-Nummer: wird bis auf Weiteres nicht erfasst (ENT-348). Datenminimierung
    // statt Verschluesselung -- die Nummer liegt heute im Klartext in der
    // Datenbank (OP-62) und wird fuer keine aktive Funktion gebraucht. Erst eine
    // kuenftige Lohnbuchhaltung (Lohnausweise aus der Software) braucht sie
    // wieder; bis dahin blockt dieser zentrale Einlesepunkt jeden Schreibweg --
    // ein Verbot nur in der Oberflaeche liesse sich am Browser vorbei umgehen.
    if (array_key_exists('ahv_nr', $spalten) && (string)$spalten['ahv_nr'] !== '') {
        $fehler[] = 'AHV-Nummer: wird zurzeit nicht erfasst (ENT-348)';
    }

    // Art. 10 Ziff. 4 GAV: "Mitarbeitende mit einem eidgenoessischen
    // Fachausweis der Sicherheitsdienstleistungsbranche muessen die
    // Basisausbildung nicht absolvieren." Das wird NICHT automatisch
    // gesetzt -- ein erfundenes Ausbildungsdatum waere eine Behauptung in
    // der Datenbank. Die Oberflaeche sagt es stattdessen hin.
    //
    // Austritt vor Eintritt ist keine Kleinigkeit: Daran haengen die
    // Jahresstunden nach Art. 8 GAV.
    $ein = (string)($spalten['eintritt'] ?? $bestand['eintritt'] ?? '');
    $aus = (string)($spalten['austritt'] ?? $bestand['austritt'] ?? '');
    if ($ein !== '' && $aus !== '' && $aus < $ein) {
        $fehler[] = 'Austritt liegt vor dem Eintritt';
    }

    return ['spalten' => $spalten, 'fehler' => $fehler];
}

// Welche Werte sind fuer ein Listenfeld erlaubt? null heisst: keine feste
// Liste (die Pruefung laesst dann alles durch).
function ma_erlaubte_werte(string $feld): ?array
{
    switch ($feld) {
        case 'anrede':                 return MA_ANREDEN;
        case 'geschlecht':             return MA_GESCHLECHTER;
        case 'zivilstand':             return MA_ZIVILSTAENDE;
        case 'aufenthaltsbewilligung': return MA_AUSWEISE;
        case 'sprache':                return MA_SPRACHEN;
        case 'fachausweis':            return MA_FACHAUSWEISE;
        case 'verkehrsmittel':         return MA_VERKEHRSMITTEL;
        default:                       return null;
    }
}

// ── Pflegbare Listen ─────────────────────────────────────────────────────
// Funktion und Abteilung sind gleich gebaut; der Tabellenname wird darum
// gegen eine feste Liste geprueft und nie aus der Eingabe uebernommen --
// sonst waere er ein Einfallstor in beliebige Tabellen.
const MA_LISTEN = ['funktion' => 'ma_funktion', 'abteilung' => 'ma_abteilung'];

function ma_listen_tabelle(string $art): ?string
{
    return MA_LISTEN[$art] ?? null;
}

// Eigene kleine Pruefung: hat_tabelle() lebt im Einrichtungsskript und steht
// den Endpunkten nicht zur Verfuegung. Solange die Einrichtung nicht gelaufen
// ist, gibt es die Listentabellen nicht -- die Oberflaeche bekommt dann eine
// leere Liste statt eines Fehlers.
function hat_tabelle_ma(PDO $pdo, string $name): bool
{
    static $bekannt = [];
    if (!array_key_exists($name, $bekannt)) {
        $bekannt[$name] = (bool)$pdo->query('SHOW TABLES LIKE ' . $pdo->quote($name))->fetch();
    }
    return $bekannt[$name];
}

// Setzt einen Zeitstempel am Mitarbeitenden, sofern die Spalte existiert
// (ENT-072). Ohne die Pruefung wuerde das Anmelden scheitern, solange die
// Einrichtung noch nicht gelaufen ist -- ein Zeitstempel ist das nicht wert.
function ma_stempel(PDO $pdo, string $spalte, string $wo, $wert): void
{
    if (!in_array($spalte, ['letzter_zugriff', 'passwort_geaendert_am'], true)) { return; }
    if (!$pdo->query('SHOW COLUMNS FROM mitarbeiter LIKE ' . $pdo->quote($spalte))->fetch()) { return; }
    $pdo->prepare("UPDATE mitarbeiter SET $spalte = NOW() WHERE $wo = ?")->execute([$wert]);
}
