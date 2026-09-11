<?php
// Legt die Tabellen der Betreiber-Ebene an (ENT-524).
//
// Ergaenzt nur Fehlendes, loescht nichts, leert nichts -- gefahrlos
// mehrfach aufrufbar, dasselbe Muster wie planung_einrichten.php.
//
// WER DARF DAS: Die Verwaltung dieses Betriebs (require_verwaltung).
//
// Das ist eine bewusste Wahl gegen die naheliegende Alternative "laeuft
// ohne Anmeldung, solange noch kein Betreiber existiert". Ein Endpunkt,
// der sich selbst freischaltet, solange eine Tabelle leer ist, ist genau
// so lange offen, bis ihn jemand findet -- und wer ihn zuerst findet,
// legt sich als Betreiber der ganzen Anlage an. Der Einstieg laeuft darum
// ueber die Anmeldung, die es heute schon gibt: Der Cockpit-Admin richtet
// die Betreiber-Ebene ein, danach steht sie eigenstaendig und braucht das
// Cockpit nie wieder.
//
// GET ist reiner Pruefmodus (kein exec) -- wie beim Einrichtungsknopf der
// Planung, damit sich der Stand anzeigen laesst, ohne etwas zu aendern.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../betreiber.php';

$user = require_session();
require_verwaltung($user);

$pdo    = betreiber_db();

// Dieselbe Grenze wie beim ersten Konto: Sobald mehr als ein Mandant
// eingetragen ist, läuft die Einrichtung nur noch über ein Betreiber-Konto.
// Sie trägt den aufrufenden Betrieb als Mandant 1 ein -- ein fremder Betrieb
// dürfte das nicht.
if (!be_bootstrap_offen($pdo)) {
    require_betreiber_voll();
}
$nurPruefen = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);
$getan  = [];
$fehler = [];
$offen  = [];

// ── Die Tabellen ──────────────────────────────────────────────────────
$tabellen = [

// Konten der Betreiber-Ebene. Getrennt von `mitarbeiter`, weil ein
// Betreiber-Konto keinem Mandanten gehoert -- Begruendung ausfuehrlich in
// backend/betreiber.php.
'betreiber' => "CREATE TABLE IF NOT EXISTS betreiber (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NOT NULL,
  passwort_hash VARCHAR(255) NOT NULL,
  aktiv TINYINT(1) NOT NULL DEFAULT 1,
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  letzte_anmeldung DATETIME NULL,
  UNIQUE KEY uq_betreiber_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// In token steht ausschliesslich der SHA-256-Abdruck, nie der Rohwert
// (ENT-501). CHAR(64) ist genau die Laenge eines solchen Abdrucks in
// Hexdarstellung -- ein laengeres Feld liesse Raum fuer etwas anderes.
'betreiber_sessions' => "CREATE TABLE IF NOT EXISTS betreiber_sessions (
  token CHAR(64) NOT NULL PRIMARY KEY,
  betreiber_id INT UNSIGNED NOT NULL,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  letzte_nutzung DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_betreiber_sessions_konto (betreiber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Der Mandantenstamm -- die Sicht des BETREIBERS auf einen Betrieb.
//
// Nicht zu verwechseln mit der Tabelle `betrieb`, die es schon gibt: Die
// steht in der Datenbank des jeweiligen Mandanten und traegt dessen eigene
// Firmendaten (Briefkopf, Domizil, Logo). Hier stehen Vertrag, Status und
// die Frage, wo die Daten dieses Mandanten liegen.
//
// KEIN PASSWORTFELD. Host, Name und Benutzer stehen hier, das Passwort
// kommt aus dem Deploy -- Begruendung in backend/betreiber.php.
// `secret_name` haelt nur fest, WELCHES Secret gemeint ist.
//
// Sind db_host/db_name leer, gilt die Standardverbindung aus db.php. Das
// ist der Bestandsmandant, dessen Daten schon da waren, bevor es einen
// Mandantenstamm gab -- kein Sonderfall, sondern die dokumentierte
// Bedeutung von "leer".
'mandant' => "CREATE TABLE IF NOT EXISTS mandant (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  status ENUM('aktiv','gesperrt','gekuendigt') NOT NULL DEFAULT 'aktiv',
  kanton CHAR(2) NULL,
  gav_unterstellt TINYINT(1) NULL,
  gav_bestaetigt_am DATETIME NULL,
  gav_bestaetigt_von VARCHAR(200) NULL,
  db_host VARCHAR(200) NOT NULL DEFAULT '',
  db_name VARCHAR(200) NOT NULL DEFAULT '',
  db_user VARCHAR(200) NOT NULL DEFAULT '',
  secret_name VARCHAR(100) NOT NULL DEFAULT '',
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Zweiter Faktor je Betreiber-Konto (OP-517). Getrennt von `zwei_faktor`,
// weil jene Tabelle an `mitarbeiter` haengt und ein Betreiber-Konto keine
// Zeile darin ist -- das Verfahren (TOTP) ist dasselbe, nur die Speicherung
// getrennt.
//
// `bestaetigt_am` ist der eigentliche Schalter: Ein eingerichtetes, aber nie
// gegengeprueftes Geheimnis zaehlt nicht, sonst sperrte sich aus, wer den
// QR-Code abgebrochen hat, bevor seine App ihn gelesen hatte.
//
// `notfallcodes` haelt ausschliesslich HASHES, nie die Codes selbst -- ein
// Notfallcode ist ein Passwortersatz und wird wie eines verwahrt.
'betreiber_zwei_faktor' => "CREATE TABLE IF NOT EXISTS betreiber_zwei_faktor (
  betreiber_id INT UNSIGNED NOT NULL PRIMARY KEY,
  geheim VARCHAR(64) NOT NULL,
  bestaetigt_am DATETIME NULL,
  letztes_fenster BIGINT NULL,
  notfallcodes TEXT NULL,
  angelegt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
];

foreach ($tabellen as $name => $sql) {
    if (hat_tabelle($pdo, $name)) { continue; }
    if ($nurPruefen) { $offen[] = 'Tabelle ' . $name; continue; }
    try {
        $pdo->exec($sql);
        $getan[] = 'Tabelle ' . $name . ' angelegt';
    } catch (Throwable $e) {
        $fehler[] = 'Tabelle ' . $name . ' — ' . $e->getMessage();
    }
}

// ── Der Bestandsmandant ───────────────────────────────────────────────
//
// Der Betrieb, der heute laeuft, wird Mandant 1 -- ohne dass eine einzige
// Zeile seiner Daten bewegt wird. Genau das war die Ueberlegung hinter der
// Wahl "je Mandant eine eigene Datenbank": Der Bestand bleibt liegen, wo er
// liegt, und bekommt nur einen Eintrag im Stamm.
//
// Der Name wird aus `betrieb` gelesen und NICHT im Quelltext gefuehrt --
// im Code steht kein echter Firmenname (Hausregel Vertraulichkeit). Fehlt
// der Briefkopf noch, bleibt der Platzhalter stehen und laesst sich spaeter
// im Betreiber-Bereich richtigstellen.
if (!$nurPruefen && hat_tabelle($pdo, 'mandant')) {
    $anzahl = (int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn();
    if ($anzahl === 0) {
        $name = '';
        try {
            $name = (string)(db()->query('SELECT firma FROM betrieb WHERE id = 1')->fetchColumn() ?: '');
        } catch (Throwable $e) {
            // Kein Briefkopf, kein Problem -- Platzhalter unten.
        }
        if (trim($name) === '') { $name = 'Bestandsbetrieb (Name nachtragen)'; }
        $stmt = $pdo->prepare(
            'INSERT INTO mandant (name, status, db_host, db_name, db_user, secret_name)
             VALUES (?, ?, \'\', \'\', \'\', \'\')'
        );
        $stmt->execute([$name, 'aktiv']);
        $getan[] = 'Bestandsbetrieb als Mandant 1 eingetragen';
    }
} elseif ($nurPruefen && hat_tabelle($pdo, 'mandant')) {
    $anzahl = (int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn();
    if ($anzahl === 0) { $offen[] = 'Bestandsbetrieb als Mandant 1'; }
}

// ── Stand melden ──────────────────────────────────────────────────────
//
// "Noch kein Konto" ist eine eigene Aussage und nicht dasselbe wie "nicht
// eingerichtet" -- die Tabellen koennen stehen, ohne dass sich jemand
// anmelden kann. Beides wird getrennt gemeldet.
$konten = null;
if (hat_tabelle($pdo, 'betreiber')) {
    $konten = (int)$pdo->query('SELECT COUNT(*) FROM betreiber')->fetchColumn();
}

json_response([
    'status'      => $fehler ? 'error' : 'ok',
    'modus'       => $nurPruefen ? 'pruefung' : 'ausgefuehrt',
    'getan'       => $getan,
    'offen'       => $offen,
    'fehler'      => $fehler,
    'konten'      => $konten,
    'hinweis'     => $konten === 0
        ? 'Tabellen stehen, aber es gibt noch kein Betreiber-Konto. Erstes Konto über betreiber_konto_anlegen.php.'
        : null,
]);
