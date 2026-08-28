<?php
// db_fehlermeldung() wirklich ausfuehren (ENT-216) -- ausgeloest durch einen
// echten Fehlschlag beim Anlegen eines Produkts auf der Live-Datenbank, der
// nur "Datenbankfehler" ohne jede weitere Spur zeigte. set_exception_handler()
// selbst laesst sich nicht ohne einen echten, unbehandelten Fehler pruefen --
// die Zuordnungslogik wurde darum in db_fehlermeldung() ausgelagert, damit sie
// fuer sich mit konstruierten PDOException-Objekten geprueft werden kann.
declare(strict_types=1);
require __DIR__ . '/../backend/db.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

check('Kein PDOException-Fehler bekommt eine unveraenderte, allgemeine Meldung',
    db_fehlermeldung(new RuntimeException('irgendwas')) === 'Unerwarteter Serverfehler');

check('KRITISCH: fehlende Tabelle (42S02) verweist auf die Einrichtung',
    str_contains(
        db_fehlermeldung(new class ('x') extends PDOException {
            public function __construct(string $m) { parent::__construct($m); $this->code = '42S02'; }
        }),
        '„Pruefen und einrichten"'
    ));

check('KRITISCH: fehlende Spalte (42S22) verweist ebenfalls auf die Einrichtung',
    str_contains(
        db_fehlermeldung(new class ('x') extends PDOException {
            public function __construct(string $m) { parent::__construct($m); $this->code = '42S22'; }
        }),
        '„Pruefen und einrichten"'
    ));

check('KRITISCH: verletzte Eindeutigkeit/Fremdschluessel (23000) bleibt verstaendlich, ohne Tabellennamen',
    str_contains(
        db_fehlermeldung(new class ('x') extends PDOException {
            public function __construct(string $m) { parent::__construct($m); $this->code = '23000'; }
        }),
        'verletzt eine Regel der Datenbank'
    ));

// Genau der Fall vom 28.08.2026: ein nicht eingeordneter Fehler (hier
// beispielhaft 'HY000', nativer MySQL-Code 1364 "Field doesn't have a
// default value") bekommt jetzt wenigstens den Code sichtbar mit --
// vorher stand ausschliesslich "Datenbankfehler" da, ohne jede weitere Spur.
$unbekannt = new class ('x') extends PDOException {
    public function __construct(string $m) {
        parent::__construct($m);
        $this->code = 'HY000';
        $this->errorInfo = ['HY000', 1364, "Field 'kategorie_id' doesn't have a default value"];
    }
};
$meldungUnbekannt = db_fehlermeldung($unbekannt);
check('KRITISCH: ein nicht eingeordneter Fehler zeigt den SQLSTATE-Code',
    str_contains($meldungUnbekannt, 'HY000'));
check('KRITISCH: er zeigt auch den nativen Treibercode (hier 1364)',
    str_contains($meldungUnbekannt, '1364'));
check('KRITISCH: er verraet dabei KEINE Tabellen- oder Spaltennamen aus der echten Fehlermeldung',
    !str_contains($meldungUnbekannt, 'kategorie_id'));

// Ohne errorInfo (z. B. bei einer von Hand geworfenen PDOException ohne
// Treiberkontext) darf die Meldung nicht mit einem PHP-Fehler abbrechen.
$ohneErrorInfo = new class ('x') extends PDOException {
    public function __construct(string $m) { parent::__construct($m); $this->code = 'HY000'; }
};
check('KRITISCH: fehlt errorInfo, bleibt die Meldung trotzdem stabil (kein Absturz, kein leerer Code)',
    db_fehlermeldung($ohneErrorInfo) === 'Datenbankfehler (HY000)');

echo "\n" . $ok . ' bestanden, ' . count($bad) . " nicht bestanden\n";
if ($bad) { foreach ($bad as $b) { echo '  x ' . $b . "\n"; } exit(1); }
echo "Alle Pruefungen bestanden.\n";
