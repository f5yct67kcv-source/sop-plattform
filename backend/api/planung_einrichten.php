<?php
// Legt die Tabellen der Einsatzplanung an (ENT-020, ENT-021).
//
// Ersetzt das Kopieren von schema_planung.sql in phpMyAdmin. Der Endpunkt
// prueft selbst, was bereits vorhanden ist, und ergaenzt nur das Fehlende --
// er laesst sich also gefahrlos mehrfach aufrufen und deckt beide Faelle ab:
// vollstaendige Neuanlage und Nachtrag zur ersten Fassung.
//
// Er legt ausschliesslich an. Es wird nichts geloescht und nichts geleert.
//
// GET ist ein reiner Pruefmodus (kein exec) -- das Dashboard nutzt ihn, um
// den bestehenden Einrichten-Knopf farblich hervorzuheben, wenn seit dem
// letzten Aufruf neue Tabellen/Spalten hinzugekommen sind (ENT-033). Es
// entsteht dadurch kein zweiter Mechanismus: dieselbe Liste, derselbe Knopf.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
// ma_felder() wird fuer die Nulldatum-Reparatur weiter unten gebraucht --
// die Feldliste steht dort und wird hier nicht nachgebaut.
require_once __DIR__ . '/../mitarbeiter.php';
// require_once, nicht require: mitarbeiter.php eine Zeile hoeher bindet
// kunden.php bereits ein. Ein zweites Laden legt naechste_kundennummer() ein
// zweites Mal an -- PHP bricht dann hart ab, am Ausnahmehandler vorbei. Genau
// daran ist dieser Endpunkt am 22.08.2026 vollstaendig gestorben, ohne dass
// eine lesbare Meldung herauskam.
require_once __DIR__ . '/../kunden.php';
require_once __DIR__ . '/../produkte.php';

$user = require_session();
require_recht($user, 'betrieb');
$methode = $_SERVER['REQUEST_METHOD'];
if ($methode !== 'GET' && $methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}
$nurPruefen = $methode === 'GET';

$pdo = db();

// hat_tabelle() und hat_spalte() stehen in db.php, damit alle Endpunkte
// sie benutzen koennen. Hier wird immer OHNE Gedaechtnis gefragt: Dieses
// Skript legt Tabellen im eigenen Lauf an und fragt danach erneut nach
// ihnen -- ein gemerktes "gibt es nicht" waere hier falsch.
function hat_tabelle_jetzt(PDO $pdo, string $tabelle): bool {
    return hat_tabelle($pdo, $tabelle, true);
}
// hat_spalte() steht seit dem Ausbau des Mitarbeiterstamms in db.php,
// damit auch andere Endpunkte sie benutzen koennen.
function hat_fremdschluessel(PDO $pdo, string $tabelle, string $spalte): bool {
    $s = $pdo->prepare(
        'SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
           AND REFERENCED_TABLE_NAME IS NOT NULL'
    );
    $s->execute([$tabelle, $spalte]);
    return (bool)$s->fetchColumn();
}

$getan = [];
$schon = [];
// Was nicht durchging. Bis hierher riss der erste fehlgeschlagene Schritt den
// ganzen Lauf mit: Die Ausnahme lief in den Handler in db.php, der Endpunkt
// antwortete mit 500, und im Dialog stand "Einrichtung fehlgeschlagen." ohne
// jeden Grund -- waehrend die vorher gelaufenen Schritte bereits gewirkt
// hatten. Jeder Schritt steht jetzt fuer sich; was scheitert, wird namentlich
// gemeldet, statt den Rest zu verhindern.
$fehler = [];

// Ein Schritt. Gibt zurueck, ob er durchging.
//
// Die Datenbankmeldung wird MITGEGEBEN, anders als sonst in db.php: Diesen
// Endpunkt darf nur aufrufen, wer das Recht "betrieb" hat -- also die Person,
// die den Fehler beheben soll. Ohne den Grund bleibt ihr nur Raten.
function schritt(PDO $pdo, string $sql, string $was, array &$getan, array &$fehler): bool {
    try {
        $pdo->exec($sql);
        $getan[] = $was . ' ergaenzt';
        return true;
    } catch (Throwable $e) {
        $fehler[] = $was . ' — ' . $e->getMessage();
        return false;
    }
}

// ── 1. Tabellen. Reihenfolge zaehlt: worauf verwiesen wird, muss zuerst da sein.
$tabellen = [

// Vertraglich vereinbarte Anstellungsorte nach Art. 18 Ziff. 2 (ENT-054).
// Der GAV erlaubt HOECHSTENS ZWEI, und wenn es zwei sind, muss der eine
// als Hauptanstellungsort (HAO) und der andere als Nebenanstellungsort
// (NAO) klar bezeichnet sein -- es gibt keine zwei HAO. Gemessen wird
// immer ab HAO; der NAO erzeugt nur das vorrangige Nebenanstellungsgebiet.
//
// Der PAKO-Kommentar verlangt eine genaue Adresse mit Strasse und Nummer
// ('ein Parkplatz ohne Adresse ist als vertraglich definierter
// Anstellungsort nicht zulaessig') -- darum ist strasse hier NOT NULL,
// anders als bei den Objekten.
// Pflegbare Listen am Mitarbeiterstamm (ENT-072). Funktion und Abteilung
// sind betriebliche Begriffe, die sich aendern -- der Projektinhaber soll sie
// selbst anlegen koennen, ohne dass jemand den Code anfasst. Bewusst ZWEI
// gleich gebaute Tabellen statt einer generischen "Listen"-Tabelle mit
// Typspalte: Zwei kurze Tabellen sind leichter zu lesen als eine, die alles
// kann, und eine Fremdschluesselpruefung greift nur bei getrennten Tabellen.
// Beide starten LEER -- erfundene Funktionsbezeichnungen waeren Inhalte, die
// niemand entschieden hat.
'ma_funktion' => "
CREATE TABLE IF NOT EXISTS ma_funktion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bezeichnung VARCHAR(100) NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_funktion (bezeichnung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'ma_abteilung' => "
CREATE TABLE IF NOT EXISTS ma_abteilung (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bezeichnung VARCHAR(100) NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_abteilung (bezeichnung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Briefkopf des eigenen Betriebs (ENT-155). Bis dahin standen Firmenname und
// Zusatz als Text im Quelltext des Rapport-Ausdrucks -- wer sie aendern
// wollte, musste den Code anfassen.
//
// GENAU EINE Zeile, erzwungen ueber id mit CHECK-Ersatz: Ein Betrieb hat
// einen Briefkopf. Eine Tabelle, die mehrere zulaesst, wirft sofort die
// Frage auf, welche Zeile denn gilt -- und irgendwann steht die falsche im
// Ausdruck. Die Zeile wird beim Einrichten leer angelegt, nicht mit
// erfundenen Angaben: Was hier steht, geht an Kunden heraus.
//
// Das Logo liegt als LONGBLOB in der Datenbank, nicht im Dateisystem --
// dieselbe Entscheidung und derselbe Grund wie bei den Einsatz-Dokumenten
// (ENT-117): kein Pfad, der ueber eine geratene Adresse abrufbar waere.
'betrieb' => "
CREATE TABLE IF NOT EXISTS betrieb (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  firma VARCHAR(200) NOT NULL DEFAULT '',
  zusatz VARCHAR(200) NOT NULL DEFAULT '',
  fusszeile TEXT NULL,
  logo_mime VARCHAR(100) NULL,
  logo_groesse INT NULL,
  logo LONGBLOB NULL,
  geaendert_am DATETIME NULL,
  geaendert_von INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'anstellungsorte' => "
CREATE TABLE IF NOT EXISTS anstellungsorte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bezeichnung VARCHAR(200) NOT NULL,
  rolle VARCHAR(10) NOT NULL DEFAULT 'hao',
  strasse VARCHAR(200) NOT NULL,
  plz VARCHAR(10),
  ort VARCHAR(200) NOT NULL,
  km_zum_anderen DECIMAL(7,2) NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  bemerkung TEXT,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rolle (rolle, aktiv)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Wegstrecke Anstellungsort -> Objekt (ENT-054). Eine Zeile je Paar.
//
// Warum am Objekt und nicht am Einsatz: Gemessen wird HAO -> Einsatzort,
// und der Einsatzort ist das Objekt. Bei einem HAO und N Objekten gibt es
// also N Distanzen, nicht eine je Schicht. Das ist der Grund, warum die
// Sache ueberhaupt bezahlbar bleibt.
//
// quelle/ermittelt_am/bestaetigt_von halten fest, WOHER die Zahl stammt.
// An der 10-km-Grenze entscheidet sie ueber Geld -- da darf man spaeter
// nicht raten muessen, ob jemand sie eingetippt oder ein Dienst geliefert
// hat.
'objekt_distanz' => "
CREATE TABLE IF NOT EXISTS objekt_distanz (
  objekt_id INT NOT NULL,
  anstellungsort_id INT NOT NULL,
  km DECIMAL(7,2) NOT NULL,
  quelle VARCHAR(50) NOT NULL DEFAULT 'manuell',
  ermittelt_am DATE NULL,
  bestaetigt_von VARCHAR(100) NULL,
  bemerkung TEXT,
  geaendert_am DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (objekt_id, anstellungsort_id),
  KEY idx_ort (anstellungsort_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'objekte' => "
CREATE TABLE IF NOT EXISTS objekte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT NULL,
  kunde_name VARCHAR(200) NOT NULL,
  name VARCHAR(200) NOT NULL,
  strasse VARCHAR(200),
  ort VARCHAR(200) NOT NULL,
  kanton CHAR(2) NOT NULL DEFAULT 'SO',
  einsatzart VARCHAR(100) NOT NULL DEFAULT 'Revierdienst',
  -- Sparte des Betriebs (ENT-037): 'sicherheit' oder 'reinigung'. Bewusst
  -- VARCHAR und nicht ENUM -- eine dritte Sparte braucht dann keine
  -- Tabellenaenderung. Am Objekt ist sie die Vorgabe, verbindlich ist die
  -- Sparte am einzelnen Einsatz.
  sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit',
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  bemerkung TEXT,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aktiv (aktiv),
  FOREIGN KEY (kunde_id) REFERENCES kunden(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'masterschichten' => "
CREATE TABLE IF NOT EXISTS masterschichten (
  id INT AUTO_INCREMENT PRIMARY KEY,
  objekt_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  kuerzel VARCHAR(10),
  art VARCHAR(20) NOT NULL DEFAULT 'arbeit',
  -- Eigene Sparte je Vorlage: dasselbe Objekt kann eine Sicherheits- und eine
  -- Reinigungsvorlage tragen, auch gleichzeitig (Baustelle, ENT-037).
  sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit',
  von TIME NOT NULL,
  bis TIME NOT NULL,
  pause_von TIME NULL,
  pause_bis TIME NULL,
  pause_min INT NOT NULL DEFAULT 0,
  arbeitszeit_h DECIMAL(5,2) NOT NULL DEFAULT 0,
  farbe VARCHAR(7),
  auf_abruf TINYINT(1) NOT NULL DEFAULT 0,
  rhythmus VARCHAR(20) NOT NULL DEFAULT 'woche',
  bedarf_mo INT NOT NULL DEFAULT 0,
  bedarf_di INT NOT NULL DEFAULT 0,
  bedarf_mi INT NOT NULL DEFAULT 0,
  bedarf_do INT NOT NULL DEFAULT 0,
  bedarf_fr INT NOT NULL DEFAULT 0,
  bedarf_sa INT NOT NULL DEFAULT 0,
  bedarf_so INT NOT NULL DEFAULT 0,
  bedarf_feiertag INT NOT NULL DEFAULT 0,
  intervall_tage INT NULL,
  intervall_start DATE NULL,
  bedarf_intervall INT NOT NULL DEFAULT 1,
  gueltig_ab DATE NOT NULL,
  gueltig_bis DATE NULL,
  ersetzt_id INT NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_objekt (objekt_id),
  FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'feiertage' => "
CREATE TABLE IF NOT EXISTS feiertage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  datum DATE NOT NULL,
  kanton CHAR(2) NOT NULL,
  name VARCHAR(100) NOT NULL,
  halbtags TINYINT(1) NOT NULL DEFAULT 0,
  ab_zeit TIME NULL,
  quelle VARCHAR(255),
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tag (datum, kanton, name),
  KEY idx_kanton_datum (kanton, datum)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'einsaetze' => "
CREATE TABLE IF NOT EXISTS einsaetze (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT NULL,
  kunde_name VARCHAR(200) NOT NULL,
  objekt_id INT NULL,
  masterschicht_id INT NULL,
  -- Zusammen angelegte Einsaetze einer Reihe (ENT-119). Alle Tage einer
  -- Reihe tragen dieselbe Kennung; sie ist die id des ERSTEN Tages, damit
  -- sie ohne eigene Tabelle und ohne Kollisionsrisiko entsteht.
  -- Bewusst NUR eine Zugehoerigkeit, keine eigene Serientabelle: Die
  -- Einsaetze bleiben eigenstaendig, es gibt keine gemeinsamen Daten, die
  -- ueber sie hinausgingen. Rhythmus und Wochentage liegen weiterhin an
  -- der Masterschicht des Objekts (ENT-118).
  serie_id INT NULL,
  titel VARCHAR(200),
  strasse VARCHAR(200),
  ort VARCHAR(200) NOT NULL,
  einsatzart VARCHAR(100) NOT NULL DEFAULT 'Verkehrsdienst',
  -- Hier ist die Sparte verbindlich: nach ihr wird gefiltert und getrennt.
  sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit',
  datum DATE NOT NULL,
  von TIME NOT NULL,
  bis TIME NOT NULL,
  bedarf INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'geplant',
  -- Das Ist neben dem Plan (ENT-045). Bis dahin wusste das System nur, was
  -- geplant war; abgerechnet und ausgewertet wird aber, was geleistet wurde.
  ist_status VARCHAR(20) NOT NULL DEFAULT 'offen',
  ist_von TIME NULL,
  ist_bis TIME NULL,
  ist_pause_von TIME NULL,
  ist_pause_min INT NULL,
  -- NULL heisst ausdruecklich 'noch nicht entschieden' und ist NICHT dasselbe
  -- wie 0/nein (GAV-AUS-004, ENT-046). Eine Vorbelegung waere eine
  -- stillschweigende GAV-Auslegung.
  ist_pause_bezahlt_ma TINYINT NULL,
  ist_pause_bezahlt_kunde TINYINT NULL,
  ist_bemerkung TEXT NULL,
  abgeglichen_von INT NULL,
  abgeglichen_am DATETIME NULL,
  bemerkung TEXT,
  -- Felder aus dem Vorbild der Intraday-Planung (ENT-076): der Anlass, zu dem
  -- der Einsatz gehoert, wo man sich trifft, was zu tun ist und wer den
  -- Einsatz verantwortet.
  veranstaltung VARCHAR(200) NULL,
  treffpunkt VARCHAR(200) NULL,
  taetigkeit TEXT NULL,
  qualifikation VARCHAR(200) NULL,
  zustaendig_id INT NULL,
  erstellt_von INT NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_datum (datum),
  KEY idx_objekt (objekt_id, datum),
  FOREIGN KEY (kunde_id) REFERENCES kunden(id) ON DELETE SET NULL,
  FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE SET NULL,
  FOREIGN KEY (masterschicht_id) REFERENCES masterschichten(id) ON DELETE SET NULL,
  FOREIGN KEY (erstellt_von) REFERENCES mitarbeiter(id) ON DELETE SET NULL,
  FOREIGN KEY (zustaendig_id) REFERENCES mitarbeiter(id) ON DELETE SET NULL,
  FOREIGN KEY (abgeglichen_von) REFERENCES mitarbeiter(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Positionen eines Einsatzes (ENT-076). Bis hierher hatte ein Einsatz eine
// Zeit und eine Anzahl -- damit laesst sich nicht abbilden, dass vier Leute
// gestaffelt arbeiten: einer 21:00-01:00, zwei bis 02:00, einer ab 02:00 bis
// zum Schluss. Jede Position traegt darum ihre eigene Zeit, Funktion und
// Verrechnung; die Person haengt an der Position statt am Einsatz.
//
// Ein Einsatz ohne Positionen bleibt gueltig: dann gilt seine eigene Zeit fuer
// alle, und "bedarf" sagt, wie viele gebraucht werden. So laufen alle
// bestehenden Einsaetze unveraendert weiter.
'einsatz_position' => "
CREATE TABLE IF NOT EXISTS einsatz_dokument (
  id INT AUTO_INCREMENT PRIMARY KEY,
  einsatz_id INT NOT NULL,
  dateiname VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  groesse INT NOT NULL,
  -- Der Inhalt liegt in der Datenbank, nicht im Dateisystem (ENT-117).
  -- Kein Pfad, kein Verzeichnis, keine .htaccess, die versehentlich nicht
  -- greift: Ein PDF mit Objektplaenen oder Kundenangaben darf nie ueber eine
  -- geratene Adresse abrufbar sein. Der einzige Weg heraus fuehrt ueber den
  -- Endpunkt, der die Rechte prueft.
  inhalt LONGBLOB NOT NULL,
  hochgeladen_von INT NULL,
  hochgeladen_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_einsatz (einsatz_id),
  FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS einsatz_position (
  id INT AUTO_INCREMENT PRIMARY KEY,
  einsatz_id INT NOT NULL,
  nr INT NOT NULL DEFAULT 1,
  funktion VARCHAR(120) NULL,
  position VARCHAR(120) NULL,
  von TIME NOT NULL,
  bis TIME NOT NULL,
  -- Verrechnung je Stunde ODER pauschal fuer die ganze Position. Beide NULL
  -- heisst 'noch nicht entschieden', nicht 'gratis'.
  std_verrechnung DECIMAL(8,2) NULL,
  pauschal DECIMAL(8,2) NULL,
  qualifikation VARCHAR(200) NULL,
  -- Gesperrt heisst: die Einteilung steht und soll nicht mehr automatisch
  -- ueberschrieben werden. Es ist ein Hinweis, kein technisches Verbot.
  gesperrt TINYINT NOT NULL DEFAULT 0,
  bemerkung TEXT NULL,
  angelegt DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_einsatz (einsatz_id, nr),
  FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'einsatz_zuteilung' => "
CREATE TABLE IF NOT EXISTS einsatz_zuteilung (
  einsatz_id INT NOT NULL,
  mitarbeiter_id INT NOT NULL,
  zusage VARCHAR(20) NOT NULL DEFAULT 'offen',
  -- NULL heisst: die Person deckt den Einsatz in seiner eigenen Zeit ab.
  -- Sonst haengt sie an genau einer Position und uebernimmt deren Zeit.
  position_id INT NULL,
  -- Der Abgleich laeuft je Person (ENT-045): eigene Ist-Zeiten und eigener
  -- Status je zugeteilter Person, weil dieselbe Person am selben Tag auf zwei
  -- Objekten unterschiedlich lang gearbeitet haben kann.
  ist_status VARCHAR(20) NOT NULL DEFAULT 'offen',
  ist_von TIME NULL,
  ist_bis TIME NULL,
  ist_pause_von TIME NULL,
  ist_pause_min INT NULL,
  ist_pause_bezahlt_ma TINYINT NULL,
  ist_pause_bezahlt_kunde TINYINT NULL,
  ist_bemerkung TEXT NULL,
  abgeglichen_von INT NULL,
  abgeglichen_am DATETIME NULL,
  zugeteilt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (einsatz_id, mitarbeiter_id),
  KEY idx_ma (mitarbeiter_id),
  KEY idx_position (position_id),
  FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES einsatz_position(id) ON DELETE SET NULL,
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Sperrtage der Mitarbeitenden (ENT-028). Eine Sperre ist eine Mitteilung,
// kein technisches Verbot -- die Planung warnt, verbietet aber nicht.
'verfuegbarkeiten' => "
CREATE TABLE IF NOT EXISTS verfuegbarkeiten (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  datum DATE NOT NULL,
  art VARCHAR(16) NOT NULL DEFAULT 'gesperrt',
  bemerkung VARCHAR(200) NULL,
  erfasst_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_tag (mitarbeiter_id, datum),
  KEY idx_datum (datum),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Ansprechpersonen eines Kunden (ENT-044). Eigene Tabelle statt eines
// Textfelds, weil ein Kunde mehrere haben kann -- das bisherige Feld
// kunden.kontaktperson bleibt als Kurzfassung der ersten Person bestehen,
// damit Liste, Suche und CSV unveraendert weiterlaufen.
'kunden_person' => "
CREATE TABLE IF NOT EXISTS kunden_person (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT NOT NULL,
  anrede VARCHAR(20) NULL,
  vorname VARCHAR(100) NULL,
  nachname VARCHAR(100) NULL,
  sortierung INT NOT NULL DEFAULT 0,
  KEY idx_kunde (kunde_id, sortierung),
  FOREIGN KEY (kunde_id) REFERENCES kunden(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Kommunikationswege -- wahlweise der Firma selbst (person_id NULL) oder
// einer ihrer Ansprechpersonen. Eine Tabelle fuer beides, weil Aufbau und
// Bedienung identisch sind; zwei fast gleiche Tabellen waeren doppelte Logik.
'kunden_kontaktweg' => "
CREATE TABLE IF NOT EXISTS kunden_kontaktweg (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kunde_id INT NOT NULL,
  person_id INT NULL,
  art VARCHAR(20) NOT NULL,
  wert VARCHAR(255) NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  KEY idx_kunde (kunde_id, sortierung),
  KEY idx_person (person_id),
  FOREIGN KEY (kunde_id) REFERENCES kunden(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES kunden_person(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Zwei-Faktor-Anmeldung fuer Verwaltungszugaenge (ENT-076).
//
// Das Geheimnis steht im Klartext, weil der Server damit rechnen muss --
// verschluesseln waere Selbsttaeuschung, solange der Schluessel daneben
// laege. Es ist genau so schutzwuerdig wie die Passwort-Hashes und faellt
// unter dieselbe Frage wie OP-58: Wer an die Datenbank kommt, kommt an
// beides.
//
// aktiv = 0 heisst: eingerichtet, aber noch nicht bestaetigt. Erst wenn
// jemand einen gueltigen Code eingegeben hat, wird daraus 1. Sonst sperrt
// sich aus, wer den Schluessel falsch abgetippt hat.
'zwei_faktor' => "CREATE TABLE zwei_faktor (
  mitarbeiter_id INT PRIMARY KEY,
  geheimnis VARCHAR(64) NOT NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 0,
  eingerichtet_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  bestaetigt_am DATETIME NULL,
  letztes_fenster BIGINT NULL,
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Notfallcodes. GEHASHT, nicht im Klartext -- sie sind ein zweiter Weg
// hinein und damit so schutzwuerdig wie ein Passwort. Bcrypt und nicht
// etwas Schnelleres: Ein achtstelliger Code aus 31 Zeichen liesse sich
// sonst aus einer gestohlenen Datenbank durchprobieren.
'zwei_faktor_codes' => "CREATE TABLE zwei_faktor_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  benutzt_am DATETIME NULL,
  KEY idx_person (mitarbeiter_id, benutzt_am),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Vertrauenswuerdige Geraete (14 Tage, Entscheid des Projektinhabers).
// Auch hier nur der Hash: Der Wert im Browser ist ein Schluessel, der den
// zweiten Faktor ersetzt -- im Klartext gespeichert waere er ein zweites
// Passwort in der Datenbank.
'zwei_faktor_geraete' => "CREATE TABLE zwei_faktor_geraete (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  merkmal_hash CHAR(64) NOT NULL,
  bezeichnung VARCHAR(120) NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  letzte_nutzung DATETIME NULL,
  UNIQUE KEY uq_merkmal (merkmal_hash),
  KEY idx_person (mitarbeiter_id),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Rollen je Person (ENT-077). Mehrere Zeilen je Mitarbeitendem sind der
// Zweck der Tabelle, nicht ein Nebeneffekt: Planung und Personal sind zwei
// verschiedene Arbeiten, keine Stufen uebereinander.
//
// Die Rollennamen stehen als Text, nicht als Fremdschluessel auf eine
// Rollentabelle -- es gibt bewusst keine frei anlegbaren Rollen. Was eine
// Rolle darf, steht in backend/rechte.php und im Entscheidungsprotokoll.
'mitarbeiter_rollen' => "CREATE TABLE mitarbeiter_rollen (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  rolle VARCHAR(30) NOT NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_rolle (mitarbeiter_id, rolle),
  KEY idx_rolle (rolle),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Logbuch der Aenderungen (ENT-077).
//
// KEIN Fremdschluessel auf mitarbeiter: Ein Verlauf muss den Datensatz
// ueberleben, ueber den er berichtet. Mit ON DELETE CASCADE waere beim
// Loeschen einer Person genau die Spur weg, die man dann sucht. Aus
// demselben Grund steht der Name des Akteurs als Text daneben und nicht
// nur seine ID.
//
// wert_alt/wert_neu bleiben NULL, wenn werte_verborgen gesetzt ist -- das
// ist der Fall bei den vertraulichen Feldern: Man sieht, DASS jemand die
// AHV-Nummer geaendert hat, aber die Nummer liegt nicht ein zweites Mal in
// der Datenbank.
'aenderungslog' => "CREATE TABLE aenderungslog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zeitpunkt DATETIME DEFAULT CURRENT_TIMESTAMP,
  akteur_id INT NOT NULL,
  akteur_name VARCHAR(100) NOT NULL,
  bereich VARCHAR(30) NOT NULL,
  objekt_id INT NOT NULL,
  feld VARCHAR(60) NOT NULL,
  wert_alt TEXT NULL,
  wert_neu TEXT NULL,
  werte_verborgen TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_objekt (bereich, objekt_id, zeitpunkt),
  KEY idx_zeit (zeitpunkt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Kurzzeitgedaechtnis der Anmeldebremse (ENT-075).
//
// Bewusst KEIN dauerhaftes Protokoll: Es wird nach einem Tag geleert und
// nach einer erfolgreichen Anmeldung fuer diesen Namen geloescht. Eine
// Sammlung darueber, wer wann von wo aus etwas versucht hat, waere selbst
// wieder ein Bestand mit Personenbezug.
'anmeldeversuche' => "CREATE TABLE anmeldeversuche (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login_name VARCHAR(100) NOT NULL,
  adresse VARCHAR(45) NOT NULL,
  zeitpunkt DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_zeitpunkt (zeitpunkt),
  KEY idx_name (login_name, zeitpunkt),
  KEY idx_adresse (adresse, zeitpunkt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Anordnung der Container je Benutzer und Bereich (ENT-073).
//
// Bewusst EINE Tabelle fuer alle Bereiche statt je Bereich eine Spalte
// irgendwo: Kommt ein weiterer anordenbarer Bereich dazu, braucht es keine
// Migration mehr. Der Inhalt ist eine Anzeigeeinstellung und keine
// Geschaeftsangabe -- geht sie verloren, steht die Standardanordnung da und
// nichts ist kaputt.
//
// mitarbeiter_id kommt IMMER aus der Sitzung, nie aus der Anfrage. Sonst
// koennte jemand die Ansicht eines anderen umstellen.
// ═══════════════════════════════════════════════ AUSLAGENERSATZ (ENT-125)
//
// Der Snapshot je Einsatz und Person, geschrieben beim Abgleich (ENT-045) --
// derselbe Moment, in dem Ist-Zeiten fest werden. Vorher kann sich noch
// alles aendern (Verkehrsmittel, Zuteilung selbst); danach ist es die
// Grundlage der Spesenabrechnung nach Art. 18 Ziff. 10 und darf nicht mehr
// stillschweigend abweichen, wenn sich spaeter ein Kilometerwert oder eine
// GAV-Ausgabe aendert (CLAUDE.md Teil B: "Eine spaetere GAV- oder
// Lohnrevision darf alte Abrechnungen nie rueckwirkend veraendern").
//
// Rohkomponenten getrennt, nicht nur ein fertiger Betrag (CLAUDE.md Teil B,
// GAV-Logik): Zone, Wegstrecke, Verkehrsmittel und Regelwerk-Quelle bleiben
// je fuer sich nachvollziehbar.
//
// NULL bei fahrzeitersatz_rappen/fahrkostenersatz_rappen heisst NICHT "0
// geschuldet" -- es heisst "nicht bestimmbar", mit dem Grund in
// gesperrt_grund (GAV-AUS-004-Muster). Eine 0 wird nur geschrieben, wenn sie
// tatsaechlich der Anspruch ist (z.B. Anstellungsgebiet, oder Mitfahrer beim
// Fahrkostenersatz).
'einsatz_auslagen' => "CREATE TABLE einsatz_auslagen (
  einsatz_id INT NOT NULL,
  mitarbeiter_id INT NOT NULL,
  zone_schluessel VARCHAR(30) NULL,
  zone_name VARCHAR(60) NULL,
  zone_quelle VARCHAR(60) NULL,
  weg_km DECIMAL(6,2) NULL,
  verkehrsmittel VARCHAR(20) NULL,
  fahrzeitersatz_rappen INT NULL,
  fahrkostenersatz_rappen INT NULL,
  -- z.B. 'gav_aus_010', 'verkehrsmittel_unbekannt', 'sparte_reinigung',
  -- 'wegstrecke_unbekannt' -- der Grund, warum ein Betrag oben NULL ist.
  -- NULL, wenn nichts davon zutrifft.
  gesperrt_grund VARCHAR(40) NULL,
  regelwerk VARCHAR(120) NOT NULL,
  erzeugt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (einsatz_id, mitarbeiter_id),
  FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE CASCADE,
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

'benutzer_layout' => "CREATE TABLE benutzer_layout (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  bereich VARCHAR(40) NOT NULL,
  layout TEXT NOT NULL,
  geaendert_am DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_benutzer_bereich (mitarbeiter_id, bereich),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Revierdienst-Tool / V3 (ENT-008-Ausnahme, Kontrollpunkt-Datenmodell
// ENT-132/ENT-132-N1/ENT-145). Die Vorlage (welche Punkte gehoeren zu einem
// Objekt) und die Durchfuehrung (wer hat wann welchen Rundgang gemacht)
// stehen bewusst in getrennten Tabellen -- eine spaetere Aenderung an der
// Vorlage darf bereits gelaufene Rundgaenge nicht rueckwirkend veraendern,
// gleiches Prinzip wie bei masterschichten/einsaetze.
'kontrollpunkt' => "CREATE TABLE kontrollpunkt (
  id INT AUTO_INCREMENT PRIMARY KEY,
  objekt_id INT NOT NULL,
  bezeichnung VARCHAR(200) NOT NULL,
  reihenfolge INT NOT NULL DEFAULT 0,
  -- VARCHAR statt ENUM wie bei objekte.sparte -- ein dritter Kontrollpunkt-
  -- Typ soll keine Tabellenaenderung brauchen.
  typ VARCHAR(20) NOT NULL,
  chip_id VARCHAR(100) NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  -- Default 20m, je Punkt uebersteuerbar (ENT-132-N1) -- kein globaler Wert,
  -- da Innen- und Aussenpunkte sich in der Flaeche stark unterscheiden.
  geofence_radius_m INT NOT NULL DEFAULT 20,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_objekt (objekt_id, reihenfolge),
  FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// objekt_id liegt hier zusaetzlich zu einsatz_id, obwohl ueber einsaetze
// erreichbar: einsaetze.objekt_id darf NULL sein (freier Einsatz ohne
// Dauerauftrag), ein Rundgang braucht aber immer ein konkretes Objekt, da
// die Kontrollpunkte daran haengen. Die Kopie vermeidet diese Ambiguitaet,
// gleiches Prinzip wie die Kunde-/Objekt-Kopien auf einsaetze selbst.
'rundgang' => "CREATE TABLE rundgang (
  id INT AUTO_INCREMENT PRIMARY KEY,
  einsatz_id INT NOT NULL,
  mitarbeiter_id INT NOT NULL,
  objekt_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'vorbereitet',
  vorbereitet_am DATETIME NULL,
  -- Rohzeit beginnt erst mit dem ersten bestaetigten Kontrollpunkt, nicht
  -- mit dem Start-Knopf (ENT-145) -- deshalb getrennt von vorbereitet_am.
  rohzeit_start DATETIME NULL,
  rohzeit_ende DATETIME NULL,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_einsatz (einsatz_id),
  KEY idx_mitarbeiter (mitarbeiter_id),
  FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE CASCADE,
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE,
  FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// erfasst_am wird GERAETESEITIG gesetzt (Offline-Prinzip, ENT-132 Punkt 5):
// ohne Netz zwischengespeichert und erst spaeter uebermittelt, teils Stunden
// oder Tage danach. uebermittelt_am haelt den tatsaechlichen Server-Empfang
// separat fest, sonst liesse sich eine lange Offline-Phase nicht erkennen.
// kontrollpunkt_id bleibt NULLable fuer den Fall, dass der Punkt spaeter aus
// der Vorlage entfernt wird -- die Durchfuehrung als Nachweis bleibt stehen.
'rundgang_scan' => "CREATE TABLE rundgang_scan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rundgang_id INT NOT NULL,
  kontrollpunkt_id INT NULL,
  status VARCHAR(20) NOT NULL,
  erfasst_am DATETIME NOT NULL,
  uebermittelt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  beschreibung TEXT NULL,
  KEY idx_rundgang (rundgang_id),
  FOREIGN KEY (rundgang_id) REFERENCES rundgang(id) ON DELETE CASCADE,
  FOREIGN KEY (kontrollpunkt_id) REFERENCES kontrollpunkt(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Kontrollrunden (ENT-204): eine benannte Vorlage buendelt eine Teilmenge der
// Kontrollpunkte eines Objekts (z.B. "Oeffnungsrunde", "Schlusskontrolle").
// Bewusst eine eigene Tabelle statt eines Feldes an kontrollpunkt selbst --
// ein Punkt kann in mehreren Runden vorkommen (vom Projektinhaber am
// Beispiel eines eigenen Objekts bestaetigt), eine einfache Zuordnung
// waere dafuer zu eng.
'rundgang_vorlage' => "CREATE TABLE rundgang_vorlage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  objekt_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_objekt (objekt_id),
  FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Reine Zuordnungstabelle, echte Mehrfachbeziehung (ENT-204): dieselbe
// kontrollpunkt_id darf in mehreren Vorlagen auftauchen, aber nicht zweimal
// in derselben. reihenfolge gilt je Vorlage, nicht die globale
// kontrollpunkt.reihenfolge -- dieselbe Startreihenfolge in zwei Runden
// darf unterschiedlich sein. Anders als rundgang_scan ist das kein
// Nachweis: ON DELETE CASCADE auf beiden Seiten, die Zuordnung verschwindet
// mit, wenn Vorlage oder Punkt geloescht werden.
'rundgang_vorlage_punkt' => "CREATE TABLE rundgang_vorlage_punkt (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vorlage_id INT NOT NULL,
  kontrollpunkt_id INT NOT NULL,
  reihenfolge INT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_vorlage_punkt (vorlage_id, kontrollpunkt_id),
  KEY idx_vorlage (vorlage_id, reihenfolge),
  FOREIGN KEY (vorlage_id) REFERENCES rundgang_vorlage(id) ON DELETE CASCADE,
  FOREIGN KEY (kontrollpunkt_id) REFERENCES kontrollpunkt(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// ── Offerten und spaeter Rechnungen (ENT-181) ─────────────────────────────
//
// Produkte sind Stammdaten: die immer gleichen Leistungen (Verkehrsdienst,
// Zulagen) samt Standardtext, Preis, Einheit und MWST-Satz. Sie starten
// LEER -- erfundene Leistungen und Preise waeren Inhalte, die niemand
// entschieden hat.
//
// einzelpreis_rappen und mwst_satz_bp hier sind VORSCHLAEGE. Sobald ein
// Produkt in einen Beleg uebernommen wird, werden die Werte in die Position
// kopiert (siehe beleg_positionen) -- eine spaetere Preisaenderung darf eine
// bereits verschickte Offerte nicht rueckwirkend veraendern. Dieselbe Regel
// wie beim versionierten GAV-Regelwerk in auslagen.php.
'produkte' => "CREATE TABLE produkte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- Format P0001 aufwaerts, automatisch vergeben (ENT-219) -- siehe
  -- naechste_produktnummer() in produkte.php. NULL bei Datensaetzen aus der
  -- Zeit davor, bis der Nachtrag unten sie ergaenzt.
  nummer VARCHAR(20) NULL,
  name VARCHAR(200) NOT NULL,
  beschreibung TEXT NULL,
  einzelpreis_rappen INT NOT NULL DEFAULT 0,
  einheit VARCHAR(20) NOT NULL DEFAULT 'Std.',
  -- Basispunkte (Hundertstel-Prozent): 8.10 % = 810, steuerfrei = 0.
  -- Ganzzahlig, damit der Satz exakt ist -- als Fliesskommazahl waere er es
  -- nicht.
  mwst_satz_bp INT NOT NULL DEFAULT 810,
  sortierung INT NOT NULL DEFAULT 0,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_produkt_aktiv (aktiv, sortierung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// EINE Tabelle fuer Offerte und Rechnung, unterschieden durch `art`.
// Bewusst so, obwohl an anderer Stelle (ma_funktion/ma_abteilung) zwei
// gleich gebaute Tabellen einer generischen vorgezogen wurden: Dort waren es
// zwei getrennte Begriffe, die nur zufaellig dieselbe Form haben. Hier ist es
// derselbe Beleg in zwei Rollen -- eine Rechnung entsteht aus einer Offerte,
// traegt dieselben Positionen und dieselbe Summenrechnung. Zwei Tabellen
// waeren zwei Rechenwege, die auseinanderlaufen koennen.
//
// Die Summen (zwischensumme/rabatt/mwst/rundung/total) sind ABGELEITETE
// Werte: Sie werden bei jedem Speichern serverseitig aus den Positionen neu
// gerechnet (beleg_summen() in belege.php) und hier abgelegt, damit die
// Liste zweihundert Offerten anzeigen kann, ohne zweihundertmal zu rechnen.
// Die Wahrheit sind die Positionen; diese Spalten sind ihr Abdruck.
'belege' => "CREATE TABLE belege (
  id INT AUTO_INCREMENT PRIMARY KEY,
  art VARCHAR(20) NOT NULL DEFAULT 'offerte',
  nummer VARCHAR(20) NOT NULL,
  kunde_id INT NULL,
  -- Ansprechperson beim Kunden, aus kunden_person. NULL heisst: keine
  -- genannt, dann steht auf dem Beleg nur die Firma.
  person_id INT NULL,
  titel VARCHAR(200) NOT NULL DEFAULT '',
  referenz VARCHAR(100) NULL,
  datum DATE NOT NULL,
  gueltig_bis DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'entwurf',
  -- Gesamtrabatt in Basispunkten, anteilig auf die Positionen verteilt.
  rabatt_bp INT NOT NULL DEFAULT 0,
  zwischensumme_rappen INT NOT NULL DEFAULT 0,
  rabatt_rappen INT NOT NULL DEFAULT 0,
  mwst_rappen INT NOT NULL DEFAULT 0,
  rundung_rappen INT NOT NULL DEFAULT 0,
  total_rappen INT NOT NULL DEFAULT 0,
  -- Aus einer Offerte laesst sich eine Vorlage machen (Dreipunkt-Menue).
  -- Eine Vorlage traegt keine Nummer im laufenden Kreis und erscheint nicht
  -- in der Offertenliste.
  ist_vorlage TINYINT(1) NOT NULL DEFAULT 0,
  -- Ob eine zusaetzliche Unterschriftsseite mitgedruckt wird (ENT-187).
  unterschriftsseite TINYINT(1) NOT NULL DEFAULT 0,
  -- Archivieren heisst: aus der Liste, aber wiederherstellbar. Es gibt
  -- bewusst kein Stornieren -- eine Offerte hat keine Buchhaltungswirkung,
  -- die storniert werden muesste; 'abgelehnt' deckt den fachlichen Fall.
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  bemerkung TEXT NULL,
  -- Die folgenden drei erscheinen auf dem gedruckten Dokument, im Unterschied
  -- zu bemerkung (nur fuer den eigenen Gebrauch). Getrennte Spalten statt
  -- eines Freitextblocks, weil jede an einer anderen Stelle des Blattes
  -- steht: Notizen nahe an den Positionen, Bedingungen darunter, Fusszeile
  -- ganz unten (ENT-187).
  oeffentliche_notizen TEXT NULL,
  bedingungen TEXT NULL,
  fusszeile_text TEXT NULL,
  -- Kundenportal (ENT-192): ein unrateberer Zufallswert statt der id, damit
  -- der Link selbst kein Login ersetzt, aber auch nicht einfach durchgezaehlt
  -- werden kann. NULL heisst: noch nie versendet, es gibt keinen Link.
  versand_token VARCHAR(64) NULL,
  -- Wann und von welcher Adresse aus der Kunde entschieden hat -- ohne
  -- Login ist das der einzige Beleg, falls eine Entscheidung spaeter
  -- bestritten wird. Bleibt NULL, solange keine Entscheidung vorliegt.
  entscheidung_am DATETIME NULL,
  entscheidung_ip VARCHAR(45) NULL,
  -- Getrennt von entscheidung_am, nach demselben Muster wie
  -- verfuegbarkeiten.gesehen_am (ENT-033): entscheidung_am ist der Beleg der
  -- Kundenentscheidung selbst und bleibt unberuehrt, dieser Zeitstempel
  -- steuert nur, ob sie noch im Ereignis-Feed der Uebersicht auftaucht
  -- (ENT-197).
  entscheidung_gesehen_am DATETIME NULL,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_beleg_nummer (art, nummer),
  UNIQUE KEY uq_beleg_versand_token (versand_token),
  KEY idx_beleg_liste (art, aktiv, ist_vorlage, datum),
  KEY idx_beleg_kunde (kunde_id),
  FOREIGN KEY (kunde_id) REFERENCES kunden(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// produkt_id ist nur ein RUECKVERWEIS fuer Auswertungen ('wie oft haben wir
// Verkehrsdienst offeriert') und darf ins Leere zeigen, wenn das Produkt
// spaeter geloescht wird. Was auf dem Beleg steht, sind die Kopien daneben:
// produkt_name, beschreibung, einzelpreis_rappen, einheit, mwst_satz_bp.
'beleg_positionen' => "CREATE TABLE beleg_positionen (
  id INT AUTO_INCREMENT PRIMARY KEY,
  beleg_id INT NOT NULL,
  sortierung INT NOT NULL DEFAULT 0,
  produkt_id INT NULL,
  produkt_name VARCHAR(200) NOT NULL DEFAULT '',
  beschreibung TEXT NULL,
  -- Menge mit zwei Nachkommastellen: 70.00 Std., 0.50 Std., 10.00 Stk.
  menge DECIMAL(10,2) NOT NULL DEFAULT 1,
  einheit VARCHAR(20) NOT NULL DEFAULT 'Std.',
  einzelpreis_rappen INT NOT NULL DEFAULT 0,
  -- Rabatt nur auf diese Position, zusaetzlich zum Gesamtrabatt des Belegs.
  rabatt_bp INT NOT NULL DEFAULT 0,
  mwst_satz_bp INT NOT NULL DEFAULT 810,
  KEY idx_position_beleg (beleg_id, sortierung),
  FOREIGN KEY (beleg_id) REFERENCES belege(id) ON DELETE CASCADE,
  FOREIGN KEY (produkt_id) REFERENCES produkte(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Abwesenheitsplanung (ENT-254): Antrag/Genehmigung fuer Ferien, Krankheit,
// Unfall, Militaer-/Zivildienst/Zivilschutz und Schwangerschaft. Eine Zeile
// je Antrag, nicht je Tag -- der Zeitraum (von/bis) ist das, was
// Mitarbeitende tatsaechlich beantragen, eine Tagestabelle waere hier eine
// Verdoppelung ohne eigenen Nutzen.
//
// "beantragt_von" ist bewusst eigenstaendig neben mitarbeiter_id: normalerweise
// identisch (jemand beantragt fuer sich selbst), aber bei einer spaeteren
// Erfassung durch die Verwaltung im Namen einer Person waeren es zwei
// verschiedene Personen. Ohne dieses Feld liesse sich das nicht mehr
// unterscheiden.
//
// gesehen_am nach demselben Muster wie verfuegbarkeiten (ENT-033) und
// belege.entscheidung_gesehen_am (ENT-197): steuert nur, ob ein offener
// Antrag noch im Ereignis-Feed auftaucht -- entschieden_am bleibt der
// eigentliche Beleg der Entscheidung und wird davon nicht beruehrt.
'abwesenheiten' => "
CREATE TABLE IF NOT EXISTS abwesenheiten (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mitarbeiter_id INT NOT NULL,
  typ VARCHAR(20) NOT NULL,
  von DATE NOT NULL,
  bis DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'beantragt',
  bemerkung TEXT NULL,
  ablehnung_grund TEXT NULL,
  beantragt_von INT NOT NULL,
  beantragt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entschieden_von INT NULL,
  entschieden_am DATETIME NULL,
  gesehen_am DATETIME NULL,
  geaendert_am DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_person_zeitraum (mitarbeiter_id, von, bis),
  KEY idx_status (status),
  FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

];

foreach ($tabellen as $name => $sql) {
    if (hat_tabelle_jetzt($pdo, $name)) {
        $schon[] = "Tabelle $name war bereits vorhanden";
        continue;
    }
    if ($nurPruefen) { $getan[] = "Tabelle $name fehlt noch"; continue; }
    try {
        $pdo->exec($sql);
        $getan[] = "Tabelle $name angelegt";
    } catch (Throwable $e) {
        $fehler[] = "Tabelle $name — " . $e->getMessage();
    }
}

// ── 2. Spalten nachtragen, falls die erste Fassung schon lief
$spalten = [
    ['einsaetze', 'objekt_id',        'ALTER TABLE einsaetze ADD COLUMN objekt_id INT NULL AFTER kunde_name'],
    ['einsaetze', 'masterschicht_id', 'ALTER TABLE einsaetze ADD COLUMN masterschicht_id INT NULL AFTER objekt_id'],
    // ENT-119: Zugehoerigkeit zu einer zusammen angelegten Reihe. NULL heisst
    // "gehoert zu keiner" -- bestehende Einsaetze bleiben unberuehrt.
    ['einsaetze', 'serie_id', 'ALTER TABLE einsaetze ADD COLUMN serie_id INT NULL AFTER masterschicht_id'],
    ['einsatz_zuteilung', 'zusage',   "ALTER TABLE einsatz_zuteilung ADD COLUMN zusage VARCHAR(20) NOT NULL DEFAULT 'offen' AFTER mitarbeiter_id"],
    ['objekte', 'einsatzart',         "ALTER TABLE objekte ADD COLUMN einsatzart VARCHAR(100) NOT NULL DEFAULT 'Revierdienst' AFTER kanton"],
    ['verfuegbarkeiten', 'gesehen_am', 'ALTER TABLE verfuegbarkeiten ADD COLUMN gesehen_am DATETIME NULL AFTER erfasst_am'],
    // Sitzungsablauf (ENT-075). Ohne diese Spalte greift nur die absolute
    // Frist -- die Untaetigkeitsfrist braucht einen Stempel.
    ['sessions', 'letzte_nutzung',
     'ALTER TABLE sessions ADD COLUMN letzte_nutzung DATETIME NULL AFTER erstellt_am'],
    // PLZ am Objekt (ENT-054). Fuer die Wegstrecke nach Art. 18 braucht es
    // eine eindeutige Adresse; Strasse plus Ort allein ist in der Schweiz
    // nicht immer eindeutig.
    ['objekte', 'plz', "ALTER TABLE objekte ADD COLUMN plz VARCHAR(10) NULL AFTER strasse"],
    // Anstellungskategorie und vertragliches Pensum (ENT-065, Art. 8 GAV).
    // Ohne sie gibt es keine Obergrenze, gegen die sich Jahresstunden
    // vergleichen liessen -- 900, 1'800 oder 2'300 ist ein Unterschied.
    // Bewusst NULL als Vorgabe und nicht 'C': Eine geratene Kategorie waere
    // schlimmer als eine fehlende, weil sie eine Grenze behauptet.
    ['mitarbeiter', 'anstellungskategorie', "ALTER TABLE mitarbeiter ADD COLUMN anstellungskategorie CHAR(1) NULL"],
    ['mitarbeiter', 'pensum_stunden',      "ALTER TABLE mitarbeiter ADD COLUMN pensum_stunden INT NULL"],
    // Eintrittsdatum fuer die Pro-rata-Regel aus Art. 8 Ziff. 1b.
    ['mitarbeiter', 'eintritt',            "ALTER TABLE mitarbeiter ADD COLUMN eintritt DATE NULL"],

    // ── Ausbau des Mitarbeiterstamms (ENT-072) ───────────────────────────
    // Vorlage war eine bestehende HR-Loesung; der Projektinhaber wollte den
    // Inhalt deckungsgleich, in eigener Gestaltung. Alle Felder sind NULL-
    // faehig: Der Bestand ist gewachsen, und ein Pflichtfeld, das man mit
    // einem Strich fuellt, ist keine Pruefung (gleiche Ueberlegung wie
    // ENT-044 beim Kundenstamm).
    //
    // Adresse. Bis hierher stand die PLZ mit dem Ort zusammen in einem Feld,
    // genau wie frueher bei den Kunden. Getrennt wird weiter unten, wo das
    // Muster eindeutig ist.
    ['mitarbeiter', 'geschlecht',       "ALTER TABLE mitarbeiter ADD COLUMN geschlecht VARCHAR(10) NULL AFTER anrede"],
    ['mitarbeiter', 'adresszusatz',     "ALTER TABLE mitarbeiter ADD COLUMN adresszusatz VARCHAR(200) NULL AFTER strasse"],
    ['mitarbeiter', 'hausnummer',       "ALTER TABLE mitarbeiter ADD COLUMN hausnummer VARCHAR(20) NULL AFTER strasse"],
    ['mitarbeiter', 'plz',              "ALTER TABLE mitarbeiter ADD COLUMN plz VARCHAR(10) NULL AFTER adresszusatz"],
    ['mitarbeiter', 'land',             "ALTER TABLE mitarbeiter ADD COLUMN land VARCHAR(100) NULL AFTER ort"],
    //
    // Kontaktwege. Geschaeftlich und privat getrennt: Wer eine Person am
    // Wochenende erreichen muss, braucht eine andere Nummer als der Kunde.
    ['mitarbeiter', 'email_privat',     "ALTER TABLE mitarbeiter ADD COLUMN email_privat VARCHAR(200) NULL AFTER email"],
    ['mitarbeiter', 'telefon_geschaeft',"ALTER TABLE mitarbeiter ADD COLUMN telefon_geschaeft VARCHAR(50) NULL AFTER telefon"],
    ['mitarbeiter', 'mobil_geschaeft',  "ALTER TABLE mitarbeiter ADD COLUMN mobil_geschaeft VARCHAR(50) NULL AFTER mobil"],
    // In der Vorlage heisst dieses Feld "Kontakt fuer Fahrorganisation" --
    // ein Begriff aus deren Fahrdienst. Fuer einen Sicherheitsbetrieb ist der
    // gleichwertige Zweck ein Notfallkontakt: wen man anruft, wenn auf Schicht
    // etwas passiert. Bewusst umbenannt statt woertlich uebernommen.
    ['mitarbeiter', 'notfallkontakt',   "ALTER TABLE mitarbeiter ADD COLUMN notfallkontakt VARCHAR(200) NULL"],
    //
    // Betriebliches. Funktion und Abteilung verweisen auf pflegbare Listen,
    // der Standort auf die ohnehin vorhandenen Anstellungsorte -- eine zweite
    // Ortsliste daneben wuerde davonlaufen (Entscheid des Projektinhabers).
    ['mitarbeiter', 'kurzzeichen',      "ALTER TABLE mitarbeiter ADD COLUMN kurzzeichen VARCHAR(10) NULL"],
    ['mitarbeiter', 'funktion_id',      "ALTER TABLE mitarbeiter ADD COLUMN funktion_id INT NULL"],
    ['mitarbeiter', 'abteilung_id',     "ALTER TABLE mitarbeiter ADD COLUMN abteilung_id INT NULL"],
    ['mitarbeiter', 'anstellungsort_id',"ALTER TABLE mitarbeiter ADD COLUMN anstellungsort_id INT NULL"],
    ['mitarbeiter', 'beruf',            "ALTER TABLE mitarbeiter ADD COLUMN beruf VARCHAR(200) NULL"],
    // Austritt gehoert neben den Eintritt. Die Vorlage kennt ihn nicht, aber
    // ohne ihn laesst sich nicht sagen, wer noch beschaeftigt ist -- und die
    // Jahresstunden nach Art. 8 haengen am Zeitraum.
    ['mitarbeiter', 'austritt',         "ALTER TABLE mitarbeiter ADD COLUMN austritt DATE NULL AFTER eintritt"],
    //
    // Personenstand und Versicherung.
    ['mitarbeiter', 'ahv_nr',           "ALTER TABLE mitarbeiter ADD COLUMN ahv_nr VARCHAR(16) NULL"],
    ['mitarbeiter', 'nationalitaet',    "ALTER TABLE mitarbeiter ADD COLUMN nationalitaet VARCHAR(100) NULL"],
    ['mitarbeiter', 'heimatort',        "ALTER TABLE mitarbeiter ADD COLUMN heimatort VARCHAR(200) NULL"],
    ['mitarbeiter', 'geburtsort',       "ALTER TABLE mitarbeiter ADD COLUMN geburtsort VARCHAR(200) NULL"],
    ['mitarbeiter', 'zivilstand',       "ALTER TABLE mitarbeiter ADD COLUMN zivilstand VARCHAR(30) NULL"],
    ['mitarbeiter', 'heiratsdatum',     "ALTER TABLE mitarbeiter ADD COLUMN heiratsdatum DATE NULL"],
    //
    // Bewilligungen und Auszuege. Gespeichert wird jeweils die ART und das
    // DATUM, nicht das Dokument -- die Dateiablage ist ein eigener Schritt
    // mit eigener Zugriffsbeschraenkung.
    ['mitarbeiter', 'aufenthaltsbewilligung',   "ALTER TABLE mitarbeiter ADD COLUMN aufenthaltsbewilligung VARCHAR(20) NULL"],
    ['mitarbeiter', 'aufenthalt_gueltig_bis',   "ALTER TABLE mitarbeiter ADD COLUMN aufenthalt_gueltig_bis DATE NULL"],
    ['mitarbeiter', 'arbeitsbewilligung',       "ALTER TABLE mitarbeiter ADD COLUMN arbeitsbewilligung VARCHAR(100) NULL"],
    ['mitarbeiter', 'arbeit_gueltig_bis',       "ALTER TABLE mitarbeiter ADD COLUMN arbeit_gueltig_bis DATE NULL"],
    ['mitarbeiter', 'zemis_nr',                 "ALTER TABLE mitarbeiter ADD COLUMN zemis_nr VARCHAR(30) NULL"],
    ['mitarbeiter', 'strafregister_datum',      "ALTER TABLE mitarbeiter ADD COLUMN strafregister_datum DATE NULL"],
    ['mitarbeiter', 'betreibung_datum',         "ALTER TABLE mitarbeiter ADD COLUMN betreibung_datum DATE NULL"],
    // Dienstausweis. In der Vorlage ein eigener Abschnitt, im Bildschirmfoto
    // abgeschnitten -- uebernommen wird das Nachpruefbare: Nummer und
    // Gueltigkeit.
    ['mitarbeiter', 'dienstausweis_nr',         "ALTER TABLE mitarbeiter ADD COLUMN dienstausweis_nr VARCHAR(50) NULL"],
    ['mitarbeiter', 'dienstausweis_gueltig_bis',"ALTER TABLE mitarbeiter ADD COLUMN dienstausweis_gueltig_bis DATE NULL"],
    //
    // Zugang. "Hat Systemzugriff" und "Systemfunktion" der Vorlage decken
    // sich mit den vorhandenen Spalten aktiv und ist_admin -- dafuer braucht
    // es keine neuen Felder. Neu sind die drei Angaben rund um den Zugang.
    ['mitarbeiter', 'sprache',               "ALTER TABLE mitarbeiter ADD COLUMN sprache VARCHAR(10) NULL"],
    ['mitarbeiter', 'zugang_bis',            "ALTER TABLE mitarbeiter ADD COLUMN zugang_bis DATE NULL"],
    ['mitarbeiter', 'letzter_zugriff',       "ALTER TABLE mitarbeiter ADD COLUMN letzter_zugriff DATETIME NULL"],
    ['mitarbeiter', 'passwort_geaendert_am', "ALTER TABLE mitarbeiter ADD COLUMN passwort_geaendert_am DATETIME NULL"],
    //
    // ── Qualifikationen mit Lohnfolge (ENT-072, Art. 19 und Art. 10 GAV) ──
    // Diese vier Angaben verlangt der GAV, die Vorlage kennt keine davon.
    //
    // WICHTIG, und der Grund fuer den Zuschnitt: Nach Art. 19 Ziff. 2 und 3
    // entsteht der Zuschlag aus dem ANGEORDNETEN EINSATZ mit Diensthund
    // beziehungsweise Schusswaffe -- nicht daraus, dass jemand die
    // Berechtigung besitzt. Hier steht deshalb nur die Berechtigung. Ob ein
    // konkreter Einsatz mit Hund oder Waffe angeordnet war, gehoert an die
    // Schicht und ist noch nicht gebaut (offener Punkt).
    //
    // Der Fachausweis nach Ziff. 1 gilt "fuer Personenschutz, Bewachung,
    // Anlaesse oder Zentralendienste" -- vier verschiedene, darum ein Wert
    // und kein Ja/Nein.
    ['mitarbeiter', 'fachausweis',                "ALTER TABLE mitarbeiter ADD COLUMN fachausweis VARCHAR(30) NULL"],
    ['mitarbeiter', 'fachausweis_am',             "ALTER TABLE mitarbeiter ADD COLUMN fachausweis_am DATE NULL"],
    ['mitarbeiter', 'diensthundefuehrer',         "ALTER TABLE mitarbeiter ADD COLUMN diensthundefuehrer TINYINT(1) NOT NULL DEFAULT 0"],
    // Die kantonale Diensthundefuehrer-Bewilligung zahlt nach Art. 19 Ziff. 2
    // der Arbeitgeber -- ein abgelaufenes Datum ist also seine Sache.
    ['mitarbeiter', 'diensthund_bewilligung_bis', "ALTER TABLE mitarbeiter ADD COLUMN diensthund_bewilligung_bis DATE NULL"],
    ['mitarbeiter', 'waffentragberechtigt',       "ALTER TABLE mitarbeiter ADD COLUMN waffentragberechtigt TINYINT(1) NOT NULL DEFAULT 0"],
    ['mitarbeiter', 'waffe_bewilligung_bis',      "ALTER TABLE mitarbeiter ADD COLUMN waffe_bewilligung_bis DATE NULL"],
    // Art. 10 Ziff. 3: Die Bestaetigung der Basisausbildung "ist im
    // Personaldossier abzulegen". Gespeichert wird das Datum; die Bestaetigung
    // selbst gehoert in die Dokumentenablage (Stufe 2).
    // Ziff. 4: Wer einen eidg. Fachausweis hat, muss sie nicht absolvieren.
    ['mitarbeiter', 'basisausbildung_am',         "ALTER TABLE mitarbeiter ADD COLUMN basisausbildung_am DATE NULL"],
    // Sparte (ENT-037). Der Bestand ist ausnahmslos Sicherheit -- die Reinigung
    // kommt erst mit diesem Schritt dazu. Die Vorgabe traegt die Altdaten also
    // richtig, ohne dass etwas von Hand nachgetragen werden muss.
    ['objekte',         'sparte', "ALTER TABLE objekte ADD COLUMN sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit' AFTER einsatzart"],
    ['masterschichten', 'sparte', "ALTER TABLE masterschichten ADD COLUMN sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit' AFTER art"],
    ['einsaetze',       'sparte', "ALTER TABLE einsaetze ADD COLUMN sparte VARCHAR(20) NOT NULL DEFAULT 'sicherheit' AFTER einsatzart"],
    // Kundenuebersicht (ENT-040): eigene Nummer, Ansprechperson und Notiz als
    // durchsuchbare Zusatzfelder, sowie Archivierung statt endgueltigem
    // Loeschen -- gleiches Vorgehen wie objekte.aktiv.
    ['kunden', 'kundennummer',  'ALTER TABLE kunden ADD COLUMN kundennummer VARCHAR(10) NULL AFTER id, ADD UNIQUE KEY uniq_kundennummer (kundennummer)'],
    ['kunden', 'kontaktperson', 'ALTER TABLE kunden ADD COLUMN kontaktperson VARCHAR(200) NULL AFTER telefon'],
    ['kunden', 'notiz',         'ALTER TABLE kunden ADD COLUMN notiz TEXT NULL AFTER email'],
    ['kunden', 'aktiv',         'ALTER TABLE kunden ADD COLUMN aktiv TINYINT(1) NOT NULL DEFAULT 1 AFTER notiz'],
    // Ausbau des Kundenstamms (ENT-044). Der Bestand ist ausnahmslos
    // Unternehmen -- die Vorgabe traegt die Altdaten damit richtig, ohne dass
    // etwas von Hand nachzutragen waere. Alle uebrigen Felder sind freiwillig.
    ['kunden', 'art',         "ALTER TABLE kunden ADD COLUMN art VARCHAR(20) NOT NULL DEFAULT 'unternehmen' AFTER kundennummer"],
    ['kunden', 'anrede',      'ALTER TABLE kunden ADD COLUMN anrede VARCHAR(20) NULL AFTER art'],
    ['kunden', 'vorname',     'ALTER TABLE kunden ADD COLUMN vorname VARCHAR(100) NULL AFTER anrede'],
    ['kunden', 'nachname',    'ALTER TABLE kunden ADD COLUMN nachname VARCHAR(100) NULL AFTER vorname'],
    ['kunden', 'zusatzfeld',  'ALTER TABLE kunden ADD COLUMN zusatzfeld VARCHAR(200) NULL AFTER name'],
    // Abweichende Rechnungsadresse (ENT-155). Alle sechs Felder NULL-bar und
    // ohne Schalter: gefuellt heisst abweichend, leer heisst gleich wie die
    // gewoehnliche Adresse. Ein zusaetzliches Ja/Nein-Feld koennte auf "ja"
    // stehen, waehrend die Felder leer sind -- und dann stuende auf dem
    // Beleg eine leere Adresse.
    ['kunden', 're_name',       'ALTER TABLE kunden ADD COLUMN re_name VARCHAR(200) NULL AFTER notiz'],
    ['kunden', 're_zusatz',     'ALTER TABLE kunden ADD COLUMN re_zusatz VARCHAR(200) NULL AFTER re_name'],
    ['kunden', 're_strasse',    'ALTER TABLE kunden ADD COLUMN re_strasse VARCHAR(200) NULL AFTER re_zusatz'],
    ['kunden', 're_hausnummer', 'ALTER TABLE kunden ADD COLUMN re_hausnummer VARCHAR(20) NULL AFTER re_strasse'],
    ['kunden', 're_plz',        'ALTER TABLE kunden ADD COLUMN re_plz VARCHAR(20) NULL AFTER re_hausnummer'],
    ['kunden', 're_ort',        'ALTER TABLE kunden ADD COLUMN re_ort VARCHAR(200) NULL AFTER re_plz'],
    ['kunden', 'hausnummer',  'ALTER TABLE kunden ADD COLUMN hausnummer VARCHAR(20) NULL AFTER strasse'],
    ['kunden', 'adresszusatz','ALTER TABLE kunden ADD COLUMN adresszusatz VARCHAR(200) NULL AFTER hausnummer'],
    ['kunden', 'plz',         'ALTER TABLE kunden ADD COLUMN plz VARCHAR(10) NULL AFTER adresszusatz'],
    ['kunden', 'uid',         'ALTER TABLE kunden ADD COLUMN uid VARCHAR(20) NULL AFTER ort'],
    ['kunden', 'mwst_nr',     'ALTER TABLE kunden ADD COLUMN mwst_nr VARCHAR(20) NULL AFTER uid'],
    // Ereignis-Feed der Uebersicht (ENT-090). "Gesehen" wird am Datensatz
    // selbst vermerkt, nicht in einer eigenen Ereignistabelle -- genauso, wie
    // es verfuegbarkeiten.gesehen_am seit ENT-033 macht. Eine zweite Tabelle
    // koennte mit der Wirklichkeit auseinanderlaufen; ein Zeitstempel an der
    // Quelle kann das nicht.
    ['rapporte',          'gesehen_am',        'ALTER TABLE rapporte ADD COLUMN gesehen_am DATETIME NULL'],
    ['einsatz_zuteilung', 'zusage_gesehen_am', 'ALTER TABLE einsatz_zuteilung ADD COLUMN zusage_gesehen_am DATETIME NULL AFTER zusage'],
    // Wann der oder die Eingeteilte die Schicht in der App GEOEFFNET hat
    // (ENT-113). Nicht zu verwechseln mit zusage_gesehen_am darueber: Das
    // haelt fest, wann der PLANER das Ereignis im Feed abgehakt hat. Zwei
    // verschiedene Personen, zwei verschiedene Aussagen -- der aehnliche
    // Name ist Erblast, der Inhalt nicht derselbe.
    ['einsatz_zuteilung', 'gesehen_am', 'ALTER TABLE einsatz_zuteilung ADD COLUMN gesehen_am DATETIME NULL AFTER zusage_gesehen_am'],
    // Schichtabgleich (ENT-045): das Ist neben dem Plan. Vorgabe 'offen', damit
    // der Bestand sichtbar unabgeglichen bleibt, statt faelschlich als
    // bestaetigt zu gelten -- was nie geprueft wurde, darf nicht so aussehen,
    // als waere es geprueft worden.
    ['einsaetze', 'ist_status',      "ALTER TABLE einsaetze ADD COLUMN ist_status VARCHAR(20) NOT NULL DEFAULT 'offen' AFTER status"],
    ['einsaetze', 'ist_von',         'ALTER TABLE einsaetze ADD COLUMN ist_von TIME NULL AFTER ist_status'],
    ['einsaetze', 'ist_bis',         'ALTER TABLE einsaetze ADD COLUMN ist_bis TIME NULL AFTER ist_von'],
    // Pause je Zeile (ENT-046): Beginn plus Dauer, wie in der Referenzloesung.
    // Das Ende ergibt sich rechnerisch und wird nicht gespeichert.
    ['einsaetze', 'ist_pause_von',   'ALTER TABLE einsaetze ADD COLUMN ist_pause_von TIME NULL AFTER ist_bis'],
    ['einsaetze', 'ist_pause_min',   'ALTER TABLE einsaetze ADD COLUMN ist_pause_min INT NULL AFTER ist_pause_von'],
    // Kundenunterschrift am EINSATZ (ENT-160), nicht mehr nur am einzelnen
    // Rapport. Sind zwei Leute am selben Auftrag, unterschreibt der Kunde
    // sonst zweimal auf zwei Telefonen -- und der gemeinsame Kundenbericht
    // haette zwei Unterschriften fuer einen Auftrag.
    //
    // Der Zeitstempel und die einholende Person sind KEIN Beiwerk: Wer zuerst
    // fertig ist, laesst unterschreiben; wer laenger bleibt, rapportiert
    // danach. Die Unterschrift deckt dann eine Zeit, die es beim
    // Unterschreiben noch nicht gab. Steht sie datiert auf dem Blatt, ist das
    // sichtbar statt stillschweigend behauptet.
    ['einsaetze', 'unterschrift',     'ALTER TABLE einsaetze ADD COLUMN unterschrift MEDIUMTEXT NULL'],
    ['einsaetze', 'unterzeichner',    'ALTER TABLE einsaetze ADD COLUMN unterzeichner VARCHAR(200) NULL AFTER unterschrift'],
    ['einsaetze', 'unterschrift_von', 'ALTER TABLE einsaetze ADD COLUMN unterschrift_von INT NULL AFTER unterzeichner'],
    ['einsaetze', 'unterschrift_am',  'ALTER TABLE einsaetze ADD COLUMN unterschrift_am DATETIME NULL AFTER unterschrift_von'],
    // Zweiter Fusszeilen-Block auf dem Ausdruck, fuer einen Zweitsitz
    // (ENT-169) -- derselbe Umgang wie die erste Fusszeile aus ENT-155:
    // freier Text, leer erlaubt, keine erfundenen Angaben.
    ['betrieb', 'fusszeile2', 'ALTER TABLE betrieb ADD COLUMN fusszeile2 TEXT NULL AFTER fusszeile'],
    // Strukturierte Absenderadresse fuer die QR-Rechnung (ENT-205) -- die
    // freie Fusszeile taugt dafuer nicht, der SIX-Standard verlangt Strasse/
    // Hausnummer/PLZ/Ort als getrennte Felder. Land bewusst NICHT als
    // eigenes Feld: CUPI 24 GmbH ist ein Schweizer Betrieb, ein fest "CH" im
    // Code ist keine Auslegung, sondern schlicht Tatsache -- ein Wahlfeld
    // dafuer waere Konfigurierbarkeit ohne Anlass (CLAUDE.md, "Nach der
    // Freigabe / Scope").
    // Produktnummer (ENT-219) -- automatisch vergeben, siehe
    // naechste_produktnummer() in produkte.php und den Nachtrag fuer
    // bestehende Produkte ohne Nummer weiter unten.
    ['produkte', 'nummer',       'ALTER TABLE produkte ADD COLUMN nummer VARCHAR(20) NULL AFTER id'],
    ['betrieb', 'qr_iban',       'ALTER TABLE betrieb ADD COLUMN qr_iban VARCHAR(34) NULL AFTER fusszeile2'],
    ['betrieb', 'qr_strasse',    'ALTER TABLE betrieb ADD COLUMN qr_strasse VARCHAR(200) NULL AFTER qr_iban'],
    ['betrieb', 'qr_hausnummer', 'ALTER TABLE betrieb ADD COLUMN qr_hausnummer VARCHAR(20) NULL AFTER qr_strasse'],
    ['betrieb', 'qr_plz',        'ALTER TABLE betrieb ADD COLUMN qr_plz VARCHAR(10) NULL AFTER qr_hausnummer'],
    ['betrieb', 'qr_ort',        'ALTER TABLE betrieb ADD COLUMN qr_ort VARCHAR(100) NULL AFTER qr_plz'],
    // Hauptdomizil (ENT-245): die allgemeine Geschaeftsadresse des Betriebs,
    // fuer die neu zusammengefasste "Betrieb"-Kachel (vormals "Anstellungsorte").
    // BEWUSST eine dritte, eigene Adresse -- nicht dieselben Spalten wie
    // qr_strasse/qr_plz/qr_ort (das ist die Absenderadresse einer QR-Rechnung,
    // fachlich an die Zahlungsabwicklung gebunden, nicht an die Frage "wo
    // sitzt die Firma") und nicht dieselben wie anstellungsorte (das ist ein
    // GAV-Begriff fuer den Auslagenersatz, keine Firmenadresse -- beide
    // koennten in Wirklichkeit unterschiedliche Orte sein). Kein Land-Feld,
    // aus demselben Grund wie bei den QR-Feldern oben: CUPI 24 GmbH ist ein
    // Schweizer Betrieb, das ist Tatsache und keine Auslegung.
    ['betrieb', 'domizil_strasse', 'ALTER TABLE betrieb ADD COLUMN domizil_strasse VARCHAR(200) NULL AFTER qr_ort'],
    ['betrieb', 'domizil_plz',     'ALTER TABLE betrieb ADD COLUMN domizil_plz VARCHAR(10) NULL AFTER domizil_strasse'],
    ['betrieb', 'domizil_ort',     'ALTER TABLE betrieb ADD COLUMN domizil_ort VARCHAR(200) NULL AFTER domizil_plz'],
    // Kontaktangaben des Betriebs (ENT-247) -- eigene Spalten, weil bisher
    // nirgends im Datenmodell eine Telefonnummer oder E-Mail-Adresse fuer den
    // Betrieb selbst existierte (nur fuer Mitarbeitende und Kunden).
    ['betrieb', 'telefon', 'ALTER TABLE betrieb ADD COLUMN telefon VARCHAR(50) NULL AFTER domizil_ort'],
    ['betrieb', 'email',   'ALTER TABLE betrieb ADD COLUMN email VARCHAR(200) NULL AFTER telefon'],
    // TINYINT NULL, nicht NOT NULL DEFAULT 0: NULL heisst 'noch nicht
    // entschieden', 0 heisst 'geprueft und nein'. Der Unterschied ist bei
    // GAV-AUS-004 wesentlich -- eine Vorbelegung waere eine Auslegung.
    ['einsaetze', 'ist_pause_bezahlt_ma',     'ALTER TABLE einsaetze ADD COLUMN ist_pause_bezahlt_ma TINYINT NULL AFTER ist_pause_min'],
    ['einsaetze', 'ist_pause_bezahlt_kunde',  'ALTER TABLE einsaetze ADD COLUMN ist_pause_bezahlt_kunde TINYINT NULL AFTER ist_pause_bezahlt_ma'],
    ['einsaetze', 'ist_bemerkung',   'ALTER TABLE einsaetze ADD COLUMN ist_bemerkung TEXT NULL AFTER ist_pause_bezahlt_kunde'],
    ['einsaetze', 'abgeglichen_von', 'ALTER TABLE einsaetze ADD COLUMN abgeglichen_von INT NULL AFTER ist_bemerkung'],
    ['einsaetze', 'abgeglichen_am',  'ALTER TABLE einsaetze ADD COLUMN abgeglichen_am DATETIME NULL AFTER abgeglichen_von'],
    // Der Abgleich laeuft je Person, nicht je Schicht: eine Zeile ist eine
    // zugeteilte Person, mit eigenen Ist-Zeiten und eigenem Status. Dieselbe
    // Person kann am selben Tag auf zwei Objekten unterschiedlich lang
    // gearbeitet haben -- eine gemeinsame Zeit an der Schicht kann das nicht
    // abbilden. Die Felder an einsaetze oben bleiben fuer den Fall, dass gar
    // niemand zugeteilt war.
    ['einsatz_zuteilung', 'ist_status',      "ALTER TABLE einsatz_zuteilung ADD COLUMN ist_status VARCHAR(20) NOT NULL DEFAULT 'offen' AFTER zusage"],
    ['einsatz_zuteilung', 'ist_von',         'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_von TIME NULL AFTER ist_status'],
    ['einsatz_zuteilung', 'ist_bis',         'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_bis TIME NULL AFTER ist_von'],
    ['einsatz_zuteilung', 'ist_pause_von',   'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_pause_von TIME NULL AFTER ist_bis'],
    ['einsatz_zuteilung', 'ist_pause_min',   'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_pause_min INT NULL AFTER ist_pause_von'],
    ['einsatz_zuteilung', 'ist_pause_bezahlt_ma',    'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_pause_bezahlt_ma TINYINT NULL AFTER ist_pause_min'],
    ['einsatz_zuteilung', 'ist_pause_bezahlt_kunde', 'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_pause_bezahlt_kunde TINYINT NULL AFTER ist_pause_bezahlt_ma'],
    ['einsatz_zuteilung', 'ist_bemerkung',   'ALTER TABLE einsatz_zuteilung ADD COLUMN ist_bemerkung TEXT NULL AFTER ist_pause_bezahlt_kunde'],
    ['einsatz_zuteilung', 'abgeglichen_von', 'ALTER TABLE einsatz_zuteilung ADD COLUMN abgeglichen_von INT NULL AFTER ist_bemerkung'],
    ['einsatz_zuteilung', 'abgeglichen_am',  'ALTER TABLE einsatz_zuteilung ADD COLUMN abgeglichen_am DATETIME NULL AFTER abgeglichen_von'],

    // Intraday-Planung (ENT-076): Positionen mit eigener Zeit, dazu die Felder
    // aus dem Vorbild. Alles NULL-fähig -- bestehende Einsaetze bleiben gueltig.
    ['einsatz_zuteilung', 'position_id',   'ALTER TABLE einsatz_zuteilung ADD COLUMN position_id INT NULL AFTER zusage'],
    ['einsaetze', 'veranstaltung',  'ALTER TABLE einsaetze ADD COLUMN veranstaltung VARCHAR(200) NULL AFTER bemerkung'],
    ['einsaetze', 'treffpunkt',     'ALTER TABLE einsaetze ADD COLUMN treffpunkt VARCHAR(200) NULL AFTER veranstaltung'],
    ['einsaetze', 'taetigkeit',     'ALTER TABLE einsaetze ADD COLUMN taetigkeit TEXT NULL AFTER treffpunkt'],
    ['einsaetze', 'qualifikation',  'ALTER TABLE einsaetze ADD COLUMN qualifikation VARCHAR(200) NULL AFTER taetigkeit'],
    ['einsaetze', 'zustaendig_id',  'ALTER TABLE einsaetze ADD COLUMN zustaendig_id INT NULL AFTER qualifikation'],
    // ENT-115: Der Kanton gehoert zum Arbeitsort und stand bisher nur am
    // Objekt. Fuer den freien Einsatz fehlte er -- er wird aber gebraucht,
    // sobald Wegstrecken und Zonen daran haengen.
    ['einsaetze', 'kanton',          'ALTER TABLE einsaetze ADD COLUMN kanton VARCHAR(2) NULL AFTER ort'],
    // Ansprechperson vor Ort. Vor- und Nachname getrennt, damit sich daraus
    // eine Anrede bilden laesst; die Nummer eigenstaendig, weil sie auf dem
    // Handy waehlbar sein soll und nicht aus einem Fliesstext geklaubt.
    ['einsaetze', 'kontakt_vorname', 'ALTER TABLE einsaetze ADD COLUMN kontakt_vorname VARCHAR(100) NULL AFTER zustaendig_id'],
    ['einsaetze', 'kontakt_nachname','ALTER TABLE einsaetze ADD COLUMN kontakt_nachname VARCHAR(100) NULL AFTER kontakt_vorname'],
    ['einsaetze', 'kontakt_telefon', 'ALTER TABLE einsaetze ADD COLUMN kontakt_telefon VARCHAR(50) NULL AFTER kontakt_nachname'],
    // ENT-116: Weg vom Hauptanstellungsort zum Einsatzort (Art. 18 Ziff. 2).
    // Die Kilometer werden gespeichert, nicht bei jeder Anzeige neu ermittelt:
    // Eine spaetere Neuberechnung darf eine abgerechnete Vergangenheit nicht
    // veraendern (GAV-AUS-011, Punkt B).
    ['einsaetze', 'weg_km',      'ALTER TABLE einsaetze ADD COLUMN weg_km DECIMAL(6,2) NULL AFTER kontakt_telefon'],
    ['einsaetze', 'weg_minuten', 'ALTER TABLE einsaetze ADD COLUMN weg_minuten INT NULL AFTER weg_km'],
    // Die Adresse, zu der die Kilometer gehoeren. Aendert jemand den
    // Arbeitsort, passt die gespeicherte Zahl nicht mehr -- ohne diesen
    // Abgleich faellt das niemandem auf.
    ['einsaetze', 'weg_adresse', 'ALTER TABLE einsaetze ADD COLUMN weg_adresse VARCHAR(300) NULL AFTER weg_minuten'],
    // Eine Fahrzeit-Position ist KEINE Arbeitszeit (Art. 18 Ziff. 2, wörtlich:
    // "wird nicht an die Arbeitszeit gemäss diesem GAV angerechnet"). Sie
    // steht im Raster, damit der Planer die Anfahrt sieht -- sie darf aber
    // niemals in die Stundensummen einfliessen (Sperrwirkung im
    // Auslegungsregister). Darum ein eigenes Kennzeichen an der Position und
    // nicht bloss eine Funktion, die "Fahrzeit" heisst: Ein Name laesst sich
    // umschreiben, ein Kennzeichen nicht versehentlich.
    ['einsatz_position', 'ist_fahrzeit', 'ALTER TABLE einsatz_position ADD COLUMN ist_fahrzeit TINYINT NOT NULL DEFAULT 0 AFTER funktion'],

    // Schicht rapportieren (ENT-082): Verweis vom Rapport auf die Schicht.
    // NULL bleibt der Normalfall fuer den bestehenden manuellen Rapport --
    // nur wer ueber "Schicht rapportieren" kommt, traegt hier einen Wert ein.
    ['rapporte', 'einsatz_id', 'ALTER TABLE rapporte ADD COLUMN einsatz_id INT NULL AFTER mitarbeiter_id'],

    // Auslagenersatz (ENT-123/ENT-125). Die Vorgabe haengt an der Person --
    // sie steht am haeufigsten fest ueber viele Einsaetze hinweg, nicht an
    // jedem einzelnen. Werte siehe MA_VERKEHRSMITTEL in mitarbeiter.php
    // ('Privatfahrzeug', 'Oeffentlicher Verkehr', 'Mitfahrer', 'Geschaeftsfahrzeug').
    ['mitarbeiter', 'verkehrsmittel', "ALTER TABLE mitarbeiter ADD COLUMN verkehrsmittel VARCHAR(20) NULL"],
    // Ausnahme je Einsatz -- fuer die Fahrgemeinschaft, die es nur diesmal
    // gibt. NULL heisst: die Vorgabe der Person gilt.
    ['einsatz_zuteilung', 'verkehrsmittel', 'ALTER TABLE einsatz_zuteilung ADD COLUMN verkehrsmittel VARCHAR(20) NULL AFTER position_id'],
    // Nur bei oeffentlichem Verkehr gebraucht: Art. 18 Ziff. 4 verlangt den
    // TATSAECHLICHEN Billettpreis, 2. Klasse -- keine Pauschale, die sich aus
    // der Zone herleiten liesse. In Rappen, ganzzahlig, wie alle Geldwerte
    // dieses Ausbaus (siehe backend/auslagen.php).
    ['einsatz_zuteilung', 'oev_rappen', 'ALTER TABLE einsatz_zuteilung ADD COLUMN oev_rappen INT NULL AFTER verkehrsmittel'],

    // Offert-Formular an das Vorbild angeglichen (ENT-187). belege stand zum
    // Zeitpunkt dieser Aenderung bereits produktiv (ENT-184) -- die neuen
    // Spalten kommen darum ueber ALTER TABLE nach, nicht nur in der
    // CREATE-TABLE-Fassung oben.
    ['belege', 'unterschriftsseite',
     'ALTER TABLE belege ADD COLUMN unterschriftsseite TINYINT(1) NOT NULL DEFAULT 0 AFTER ist_vorlage'],
    ['belege', 'oeffentliche_notizen', 'ALTER TABLE belege ADD COLUMN oeffentliche_notizen TEXT NULL AFTER bemerkung'],
    ['belege', 'bedingungen', 'ALTER TABLE belege ADD COLUMN bedingungen TEXT NULL AFTER oeffentliche_notizen'],
    ['belege', 'fusszeile_text', 'ALTER TABLE belege ADD COLUMN fusszeile_text TEXT NULL AFTER bedingungen'],

    // Kundenportal per E-Mail-Versand (ENT-192). belege stand bereits
    // produktiv -- die Spalten kommen wie oben ueber ALTER TABLE nach. Der
    // eindeutige Schluessel haengt am selben ALTER TABLE wie die Spalte
    // selbst, nicht an einem eigenen Nachtrag-Mechanismus: Existiert die
    // Spalte schon, wird der ganze Befehl uebersprungen (siehe hat_spalte
    // unten) -- der Schluessel entsteht also immer zusammen mit der Spalte,
    // nie getrennt davon.
    ['belege', 'versand_token',
     'ALTER TABLE belege ADD COLUMN versand_token VARCHAR(64) NULL AFTER fusszeile_text, '
     . 'ADD UNIQUE KEY uq_beleg_versand_token (versand_token)'],
    ['belege', 'entscheidung_am', 'ALTER TABLE belege ADD COLUMN entscheidung_am DATETIME NULL AFTER versand_token'],
    ['belege', 'entscheidung_ip', 'ALTER TABLE belege ADD COLUMN entscheidung_ip VARCHAR(45) NULL AFTER entscheidung_am'],

    // Rundgang pausieren/abbrechen (ENT-146). pausiert_seit haelt den Beginn
    // der AKTUELLEN Pause fest -- pause_minuten ist die kumulierte Summe ueber
    // alle bisherigen Pausen dieses Rundgangs (Projektinhaber-Entscheid
    // 2026-08-27: ein Zaehler statt einer eigenen Tabelle je Pause-Intervall,
    // reicht fuer beliebig viele Pause/Fortsetzen-Zyklen). Ein Abbruch ist
    // endgueltig (kein Gegenstueck zu pausiert_seit noetig) und verlangt
    // zwingend einen Grund (ENT-146 Punkt 2).
    ['rundgang', 'pausiert_seit',    'ALTER TABLE rundgang ADD COLUMN pausiert_seit DATETIME NULL AFTER rohzeit_ende'],
    ['rundgang', 'pause_minuten',    'ALTER TABLE rundgang ADD COLUMN pause_minuten INT NOT NULL DEFAULT 0 AFTER pausiert_seit'],
    ['rundgang', 'abbruch_grund',    'ALTER TABLE rundgang ADD COLUMN abbruch_grund VARCHAR(30) NULL AFTER pause_minuten'],
    ['rundgang', 'abbruch_freitext', 'ALTER TABLE rundgang ADD COLUMN abbruch_freitext TEXT NULL AFTER abbruch_grund'],
    ['rundgang', 'abgebrochen_am',   'ALTER TABLE rundgang ADD COLUMN abgebrochen_am DATETIME NULL AFTER abbruch_freitext'],

    // Kontrollrunden (ENT-204): welche Vorlage dieser Durchfuehrung zugrunde
    // liegt. NULLable und ON DELETE SET NULL (siehe Verweis weiter unten) --
    // massgeblich ist die Vorlage von heute, nicht die von damals, gleiches
    // Prinzip wie bei rundgang_scan.kontrollpunkt_id.
    ['rundgang', 'rundgang_vorlage_id', 'ALTER TABLE rundgang ADD COLUMN rundgang_vorlage_id INT NULL AFTER objekt_id'],

    // Ersatzscan (Q-22 in sop-projekt): manuelle Bestaetigung eines
    // Kontrollpunkts mit Fotobeleg, wenn der reguläre NFC-/Geofence-Scan
    // nicht moeglich ist. Nullable -- nur ein 'ersatzscan'-Eintrag traegt
    // ein Foto, 'bestaetigt'/'nicht_verfuegbar' bleiben ohne.
    ['rundgang_scan', 'foto',      'ALTER TABLE rundgang_scan ADD COLUMN foto LONGBLOB NULL AFTER beschreibung'],
    ['rundgang_scan', 'foto_mime', 'ALTER TABLE rundgang_scan ADD COLUMN foto_mime VARCHAR(50) NULL AFTER foto'],

    // Ereignis-Feed und Glocke (ENT-197): eigener Zeitstempel, getrennt von
    // entscheidung_am -- siehe Kommentar am CREATE TABLE oben.
    ['belege', 'entscheidung_gesehen_am',
     'ALTER TABLE belege ADD COLUMN entscheidung_gesehen_am DATETIME NULL AFTER entscheidung_ip'],

    // Rechnungen-Reiter, Ausbaustufe nach dem Grundgeruest (ENT-181,
    // Projektinhaber-Entscheid 28.08.2026): faellig_bis ist das Pendant zu
    // gueltig_bis bei Offerten -- manuell erfasst, keine automatisch
    // berechnete Zahlungsfrist. bezahlt/bezahlt_am sind bewusst eine einfache
    // Ja/Nein-Markierung statt einer Teilzahlungsbuchhaltung: "Offener
    // Betrag" in der Liste ist damit entweder 0 oder der volle Betrag, keine
    // eigene Zahlungs-Tabelle noetig.
    ['belege', 'faellig_bis', 'ALTER TABLE belege ADD COLUMN faellig_bis DATE NULL AFTER gueltig_bis'],
    ['belege', 'bezahlt',     'ALTER TABLE belege ADD COLUMN bezahlt TINYINT(1) NOT NULL DEFAULT 0 AFTER faellig_bis'],
    ['belege', 'bezahlt_am',  'ALTER TABLE belege ADD COLUMN bezahlt_am DATE NULL AFTER bezahlt'],
];
foreach ($spalten as [$tabelle, $spalte, $sql]) {
    if (!hat_tabelle_jetzt($pdo, $tabelle) || hat_spalte($pdo, $tabelle, $spalte)) {
        continue;
    }
    if ($nurPruefen) { $getan[] = "Spalte $tabelle.$spalte fehlt noch"; continue; }
    schritt($pdo, $sql, "Spalte $tabelle.$spalte", $getan, $fehler);
}

// ── 2a2. Die eine Betriebszeile anlegen, falls sie fehlt (ENT-155).
// Bewusst LEER: Firmenname und Zusatz standen bis dahin im Quelltext, aber sie
// hier als Vorgabe einzusetzen hiesse, erfundene Angaben in ein Dokument zu
// schreiben, das an Kunden herausgeht. Die Oberflaeche sagt statt dessen, dass
// der Briefkopf noch gepflegt werden muss.
if (hat_tabelle_jetzt($pdo, 'betrieb')) {
    $hat = (int)$pdo->query('SELECT COUNT(*) FROM betrieb')->fetchColumn();
    if (!$hat) {
        if ($nurPruefen) { $getan[] = 'Betriebszeile fehlt noch'; }
        else { schritt($pdo, "INSERT INTO betrieb (id, firma, zusatz) VALUES (1, '', '')",
            'Betriebszeile', $getan, $fehler); }
    }
}

// ── 2b. Kundennummern nachtragen, wenn Kunden ohne eigene Nummer bestehen --
// entweder aus der Zeit vor ENT-040 oder weil die Spalte gerade erst oben
// dazukam. Reihenfolge nach id, damit die Vergabe nachvollziehbar bleibt.
if (hat_spalte($pdo, 'kunden', 'kundennummer')) {
    $ohneNummer = $pdo->query(
        'SELECT id FROM kunden WHERE kundennummer IS NULL ORDER BY id'
    )->fetchAll(PDO::FETCH_COLUMN);
    if ($ohneNummer) {
        if ($nurPruefen) {
            $getan[] = count($ohneNummer) . ' Kunde(n) ohne Kundennummer';
        } else {
            foreach ($ohneNummer as $kid) {
                $nr = naechste_kundennummer($pdo);
                $pdo->prepare('UPDATE kunden SET kundennummer = ? WHERE id = ?')->execute([$nr, $kid]);
            }
            $getan[] = count($ohneNummer) . ' Kundennummer(n) vergeben';
        }
    }
}

// ── 2b2. Die beiden Anstellungsorte einmalig hinterlegen (ENT-055).
// Auf ausdrueckliche Bitte des Projektinhabers, damit er sie nicht von Hand
// erfassen muss. Laeuft NUR, wenn die Tabelle leer ist -- wer die Orte
// spaeter ueber die Oberflaeche aendert, bekommt sie nicht wieder
// ueberschrieben.
//
// Die 18.0 km sind gemessen, nicht geschaetzt (OP-44 erledigt): kuerzeste
// effektive Wegstrecke Trimbach -> Gelterkinden gemaess Google Maps, wie es
// Art. 18 Ziff. 2 GAV verlangt. Google bietet auf dieser Strecke auch 19.2
// und 20.4 km an; massgebend ist die kuerzeste, nicht die schnellste.
// Unter 40 km, also gilt Art. 18 Ziff. 3.2.
//
// Betriebsdaten im Code sind an sich unschoen. Hier vertretbar, weil das
// Werkzeug rein intern eingesetzt wird (ENT-008) und die Adressen auf
// cupi24.ch oeffentlich stehen. Wuerde daraus je ein Produkt fuer Dritte,
// muss dieser Block als Erstes verschwinden.
//
// Die 19 km stammen aus der Angabe des Projektinhabers, nicht aus einer
// eigenen Messung. Sie entscheiden nach Art. 18: unter 40 km ist im
// Nebenanstellungsgebiet nichts geschuldet (Ziff. 3.2.5).
if (hat_tabelle_jetzt($pdo, 'anstellungsorte')) {
    $anzahl = (int)$pdo->query('SELECT COUNT(*) FROM anstellungsorte')->fetchColumn();
    if ($anzahl === 0) {
        if ($nurPruefen) {
            $getan[] = 'Anstellungsorte Trimbach (HAO) und Gelterkinden (NAO) hinterlegen';
        } else {
            $ins = $pdo->prepare(
                'INSERT INTO anstellungsorte (bezeichnung, rolle, strasse, plz, ort, km_zum_anderen, aktiv, bemerkung)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
            );
            $ins->execute(['Hauptsitz Trimbach', 'hao', 'Baslerstrasse 67', '4632', 'Trimbach', 18.0,
                'Hauptanstellungsort nach Art. 18 Ziff. 2 GAV (ENT-055). Von hier wird gemessen.']);
            $ins->execute(['Standort Gelterkinden', 'nao', 'Rünenbergerstrasse 44', '4460', 'Gelterkinden', 18.0,
                'Nebenanstellungsort nach Art. 18 Ziff. 2 GAV (ENT-055). Erzeugt das Nebenanstellungsgebiet.']);
            $getan[] = 'Anstellungsorte Trimbach (HAO) und Gelterkinden (NAO) hinterlegt, 18.0 km auseinander';
        }
    }
}

// ── 2b3. Dasselbe fuer Mitarbeitende (ENT-072). Bis hierher stand auch dort
// die PLZ mit dem Ort zusammen in einem Feld. Getrennt wird nur, wo das
// Muster eindeutig ist -- lieber ungetrennt als falsch zerlegt. Laeuft nur
// ueber Personen, deren plz noch leer ist, und ist beliebig wiederholbar.
if (hat_spalte($pdo, 'mitarbeiter', 'plz')) {
    $ungetrenntMa = $pdo->query(
        "SELECT id, ort FROM mitarbeiter
         WHERE (plz IS NULL OR plz = '') AND ort REGEXP '^[0-9]{4}[[:space:]]' ORDER BY id"
    )->fetchAll();
    if ($ungetrenntMa) {
        if ($nurPruefen) {
            $getan[] = count($ungetrenntMa) . ' Mitarbeitende(r) mit PLZ und Ort in einem Feld';
        } else {
            $sm = $pdo->prepare('UPDATE mitarbeiter SET plz = ?, ort = ? WHERE id = ?');
            foreach ($ungetrenntMa as $m) {
                [$plz, $ort] = plz_ort_trennen((string)$m['ort']);
                $sm->execute([$plz, $ort, (int)$m['id']]);
            }
            $getan[] = count($ungetrenntMa) . ' Mitarbeiteradresse(n) in PLZ und Ort getrennt';
        }
    }
}

// ── 2b4. Nulldaten in echte Leerwerte umwandeln (ENT-072, Korrektur).
// ma_eingabe_lesen() hat ein leeres Datumsfeld als leeren TEXT gespeichert.
// MySQL macht daraus ausserhalb des strengen Modus '0000-00-00'. Die
// Oberflaeche zeigte daraufhin "00.00.0000" -- und markierte nicht erfasste
// Bewilligungen als "abgelaufen", weil '0000-00-00' vor jedem heutigen Datum
// liegt. Ein nicht erfasstes Datum ist UNBEKANNT und nicht laengst vorbei;
// der Unterschied entscheidet darueber, ob jemand eingeteilt werden darf.
//
// Die Ursache ist behoben; dieser Block raeumt auf, was vorher geschrieben
// wurde. Er laeuft nur ueber Spalten, die es gibt, und ist wiederholbar.
$nullDatumSpalten = [];
foreach (ma_felder() as $feld => $typ) {
    if ($typ === 'datum' && hat_spalte($pdo, 'mitarbeiter', $feld)) { $nullDatumSpalten[] = $feld; }
}
if ($nullDatumSpalten) {
    $wo = implode(' OR ', array_map(fn($f) => "$f = '0000-00-00'", $nullDatumSpalten));
    $betroffen = (int)$pdo->query("SELECT COUNT(*) FROM mitarbeiter WHERE $wo")->fetchColumn();
    if ($betroffen > 0) {
        if ($nurPruefen) {
            $getan[] = "$betroffen Mitarbeitende(r) mit Nulldatum (00.00.0000) in mindestens einem Datumsfeld";
        } else {
            $setzen = implode(', ', array_map(
                fn($f) => "$f = CASE WHEN $f = '0000-00-00' THEN NULL ELSE $f END", $nullDatumSpalten));
            $pdo->exec("UPDATE mitarbeiter SET $setzen WHERE $wo");
            $getan[] = "$betroffen Mitarbeitende(r): Nulldaten auf \"nicht erfasst\" gesetzt";
        }
    }
}

// ── 2b5. Rollen aus dem bisherigen "Admin ja/nein" ableiten (ENT-077).
// Jedes heutige Admin-Konto wird zu "verwaltung", alle uebrigen zu
// "mitarbeitend". NIEMAND verliert oder gewinnt dabei Rechte -- der Zustand
// ist genau derselbe, nur anders aufgeschrieben.
//
// Laeuft nur ueber Personen OHNE Rolleneintrag und ist damit wiederholbar:
// Wer spaeter von Hand eine andere Rolle bekommen hat, wird nicht wieder
// ueberschrieben. Das ist wichtig, weil die Einrichtung jederzeit erneut
// gedrueckt werden darf.
if (hat_tabelle_jetzt($pdo, 'mitarbeiter_rollen')) {
    $ohneRolle = $pdo->query(
        'SELECT m.id, m.ist_admin FROM mitarbeiter m
          WHERE NOT EXISTS (SELECT 1 FROM mitarbeiter_rollen r WHERE r.mitarbeiter_id = m.id)
          ORDER BY m.id'
    )->fetchAll();
    if ($ohneRolle) {
        $admins = count(array_filter($ohneRolle, fn($m) => (int)$m['ist_admin'] === 1));
        if ($nurPruefen) {
            $getan[] = count($ohneRolle) . ' Person(en) ohne Rolle — davon ' . $admins
                . ' mit bisherigem Admin-Zugang';
        } else {
            $ein = $pdo->prepare('INSERT IGNORE INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (?, ?)');
            foreach ($ohneRolle as $m) {
                $ein->execute([(int)$m['id'], (int)$m['ist_admin'] === 1 ? 'verwaltung' : 'mitarbeitend']);
            }
            $getan[] = count($ohneRolle) . ' Person(en) eine Rolle zugewiesen ('
                . $admins . ' × Verwaltung, ' . (count($ohneRolle) - $admins) . ' × Mitarbeitend)';
        }
    }
}

// ── 2b6. Produktnummern nachtragen, wenn Produkte ohne eigene Nummer
// bestehen (ENT-219) -- entweder aus der Zeit vor dieser Entscheidung oder
// weil die Spalte gerade erst oben dazukam. Reihenfolge nach id, damit die
// Vergabe nachvollziehbar bleibt. Gleiches Muster wie 2b (Kundennummern).
if (hat_spalte($pdo, 'produkte', 'nummer')) {
    $ohneProduktnummer = $pdo->query(
        'SELECT id FROM produkte WHERE nummer IS NULL ORDER BY id'
    )->fetchAll(PDO::FETCH_COLUMN);
    if ($ohneProduktnummer) {
        if ($nurPruefen) {
            $getan[] = count($ohneProduktnummer) . ' Produkt(e) ohne Produktnummer';
        } else {
            foreach ($ohneProduktnummer as $pid) {
                $nr = naechste_produktnummer($pdo);
                $pdo->prepare('UPDATE produkte SET nummer = ? WHERE id = ?')->execute([$nr, $pid]);
            }
            $getan[] = count($ohneProduktnummer) . ' Produktnummer(n) vergeben';
        }
    }
}

// ── 2c. PLZ aus dem bisherigen Ort-Feld herausloesen (ENT-044). Bis hierher
// stand beides zusammen in einer Spalte ("4632 Trimbach"). Getrennt wird nur,
// wo das Muster eindeutig ist: vier Ziffern, Leerzeichen, Rest. Passt es
// nicht, bleibt der Wert unveraendert stehen -- lieber ungetrennt als falsch
// zerlegt. Laeuft nur ueber Kunden, deren plz noch leer ist, und ist damit
// beliebig oft wiederholbar.
if (hat_spalte($pdo, 'kunden', 'plz')) {
    $ungetrennt = $pdo->query(
        "SELECT id, ort FROM kunden
         WHERE (plz IS NULL OR plz = '') AND ort REGEXP '^[0-9]{4}[[:space:]]' ORDER BY id"
    )->fetchAll();
    if ($ungetrennt) {
        if ($nurPruefen) {
            $getan[] = count($ungetrennt) . ' Kunde(n) mit PLZ und Ort in einem Feld';
        } else {
            $s = $pdo->prepare('UPDATE kunden SET plz = ?, ort = ? WHERE id = ?');
            foreach ($ungetrennt as $k) {
                [$plz, $ort] = plz_ort_trennen((string)$k['ort']);
                $s->execute([$plz, $ort, (int)$k['id']]);
            }
            $getan[] = count($ungetrennt) . ' Adresse(n) in PLZ und Ort getrennt';
        }
    }
}

// ── 2c2. "Abgeschlossen" nachtragen fuer laengst vollstaendig rapportierte
// Einsaetze (ENT-128). Noetig, weil der Uebergang nur im Moment eines NEUEN
// Rapports ausgeloest wird (rapport_create.php) -- ein Rapport, der schon
// vor dieser Aenderung bestand, hat ihn nie durchlaufen. Ausgenommen bleiben
// abgesagte und bereits abgeglichene Einsaetze (ENT-045), genau wie beim
// laufenden Uebergang. Beliebig oft wiederholbar.
if (hat_tabelle_jetzt($pdo, 'einsaetze') && hat_tabelle_jetzt($pdo, 'einsatz_zuteilung')
    && hat_tabelle_jetzt($pdo, 'rapporte') && hat_spalte($pdo, 'einsaetze', 'status')) {
    $kandidaten = $pdo->query(
        "SELECT id FROM einsaetze WHERE status NOT IN ('abgesagt', 'abgeschlossen') ORDER BY id"
    )->fetchAll(PDO::FETCH_COLUMN);
    $nachzutragen = array_values(array_filter($kandidaten, fn($eid) =>
        !einsatz_abgeglichen($pdo, (int)$eid) && einsatz_vollstaendig_rapportiert($pdo, (int)$eid)));
    if ($nachzutragen) {
        if ($nurPruefen) {
            $getan[] = count($nachzutragen) . ' Einsatz/Einsaetze bereits vollständig rapportiert, aber noch nicht als abgeschlossen markiert';
        } else {
            $s = $pdo->prepare("UPDATE einsaetze SET status = 'abgeschlossen' WHERE id = ?");
            foreach ($nachzutragen as $eid) { $s->execute([$eid]); }
            $getan[] = count($nachzutragen) . ' Einsatz/Einsaetze auf "abgeschlossen" nachgetragen';
        }
    }
}

// ── 3. Verweise und Index nachtragen, wenn die Spalten neu dazugekommen sind
$verweise = [
    ['einsaetze', 'objekt_id',        'ALTER TABLE einsaetze ADD FOREIGN KEY (objekt_id) REFERENCES objekte(id) ON DELETE SET NULL'],
    ['einsaetze', 'masterschicht_id', 'ALTER TABLE einsaetze ADD FOREIGN KEY (masterschicht_id) REFERENCES masterschichten(id) ON DELETE SET NULL'],
    ['einsaetze', 'abgeglichen_von',  'ALTER TABLE einsaetze ADD FOREIGN KEY (abgeglichen_von) REFERENCES mitarbeiter(id) ON DELETE SET NULL'],
    // Verliert die Schicht spaeter ihren Datensatz, bleibt der Rapport als
    // Beleg stehen -- er ist ein Dokument ueber einen bestimmten Tag, kein
    // Verweis, der mit der Schicht sterben darf (ENT-082).
    ['rapporte', 'einsatz_id', 'ALTER TABLE rapporte ADD FOREIGN KEY (einsatz_id) REFERENCES einsaetze(id) ON DELETE SET NULL'],
    // Kontrollrunden (ENT-204).
    ['rundgang', 'rundgang_vorlage_id', 'ALTER TABLE rundgang ADD FOREIGN KEY (rundgang_vorlage_id) REFERENCES rundgang_vorlage(id) ON DELETE SET NULL'],
];
foreach ($verweise as [$tabelle, $spalte, $sql]) {
    if (!hat_spalte($pdo, $tabelle, $spalte) || hat_fremdschluessel($pdo, $tabelle, $spalte)) {
        continue;
    }
    if ($nurPruefen) { $getan[] = "Verweis $tabelle.$spalte fehlt noch"; continue; }
    // Ein Verweis ist eine Absicherung, keine Voraussetzung: Die Spalte
    // arbeitet auch ohne ihn. Scheitert er -- etwa weil eine Tabelle noch
    // MyISAM ist --, darf das den Rest nicht aufhalten.
    schritt($pdo, $sql, "Verweis $tabelle.$spalte", $getan, $fehler);
}

// ── 4. Ergebnis. Fehlt am Schluss etwas, wird das gesagt statt verschwiegen.
// Im Pruefmodus (GET) heisst "fehlt" nur "noch nicht eingerichtet", kein Fehler --
// das Dashboard liest dafuer 'ausstehend', nicht 'status'.
$fehlt = [];
foreach (array_keys($tabellen) as $name) {
    if (!hat_tabelle_jetzt($pdo, $name)) {
        $fehlt[] = $name;
    }
}

// Bewusst mit HTTP 200, auch wenn etwas schieflief: Bei einem Fehlerstatus
// verwirft die Oberflaeche den Rumpf und zeigt nur ihren eigenen Ersatztext.
// Genau daran ging der Grund verloren. Rot wird der Kasten ueber 'status',
// die Einzelheiten stehen in 'fehler'.
json_response([
    'status' => (!$nurPruefen && ($fehlt || $fehler)) ? 'error' : 'ok',
    'message' => $nurPruefen
        ? ($getan ? count($getan) . ' Punkt(e) stehen noch aus.' : 'Alles ist eingerichtet.')
        : ($fehlt
            ? 'Diese Tabellen fehlen weiterhin: ' . implode(', ', $fehlt)
            : ($fehler
                ? count($fehler) . ' Schritt(e) sind fehlgeschlagen — die uebrigen sind gelaufen.'
                : ($getan ? 'Einrichtung abgeschlossen.' : 'Alles war bereits eingerichtet.'))),
    'getan' => $getan,
    'unveraendert' => $schon,
    'fehler' => $fehler,
    'ausstehend' => count($getan),
]);
