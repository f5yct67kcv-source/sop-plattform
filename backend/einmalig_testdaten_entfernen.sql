-- =====================================================================
-- EINMALIG: Testbestand entfernen vor dem internen Testbetrieb
-- ---------------------------------------------------------------------
-- Anlass: Alles, was bis zum 2026-09-10 erfasst wurde, war Testeingabe --
-- mit einer Ausnahme: die 132 Kunden sind echt und bleiben stehen. Vom
-- Projektinhaber am 2026-09-10 einzeln bestaetigt, auch fuer die fuenf
-- abgeglichenen Zuteilungen ("die 5 sind alle testeintraege, keine echte
-- arbeit").
--
-- Dieses Skript ist KEIN Werkzeug fuer den laufenden Betrieb. Es geht an
-- zwei Schutzvorrichtungen vorbei, die es aus gutem Grund gibt:
--
--   * ENT-045 -- eine abgeglichene Schicht ist festgeschrieben. Die Sperre
--     sitzt in einsatz_sperre_pruefen() in den PHP-Schreibwegen; ein DELETE
--     direkt in der Datenbank fragt sie nicht.
--   * ENT-501 -- require_augenhoehe() schuetzt fremde Verwaltungskonten.
--     Auch daran laeuft ein DELETE vorbei.
--
-- Deshalb: einmalig, von Hand, mit geprueftem Backup. Kein Endpunkt, kein
-- Knopf. Sobald echte Arbeitszeit erfasst ist, verbietet Art. 12 Ziff. 5
-- GAV (fuenf Jahre Aufbewahrung) diesen Lauf ohnehin.
--
-- ---------------------------------------------------------------------
-- VORAUSSETZUNG -- ohne das hier nicht ausfuehren:
--
--   1. Vollstaendiger SQL-Export der Datenbank, heruntergeladen UND
--      geprueft (Anzahl CREATE TABLE stimmt, Datei endet auf COMMIT).
--   2. Unten @ICH auf die eigene mitarbeiter.id gesetzt -- das ist das
--      einzige Konto, das ueberlebt. setup.php ist bewusst nicht
--      deployed (OP-17): Wer sich hier aussperrt, kommt nur ueber
--      phpMyAdmin zurueck.
--
-- Bleibt unberuehrt (12 Tabellen):
--   kunden, kunden_person, kunden_kontaktweg   -- die echten Kunden
--   betrieb                                    -- Firmenangaben inkl. Logo
--   anstellungsorte                            -- traegt den Fahrkostenersatz
--   feiertage, rollen, rollen_rechte           -- Konfiguration
--   lohnart, ereignisart                       -- Kataloge, teils eigene Zeilen
--   ma_abteilung, ma_funktion                  -- leer, aber Konfiguration
--
-- Nach dem Lauf im Cockpit "Einrichtung" druecken: legt einsatz_dokument
-- an (fehlt derzeit) und ergaenzt geleerte Startbestaende.
--
-- Sollte TRUNCATE an fehlenden Rechten scheitern ("command denied"), tut
-- es DELETE FROM <tabelle>; genauso -- nur bleiben dann die
-- AUTO_INCREMENT-Zaehler stehen.
-- =====================================================================

SET @ICH = 0;   -- <<<<<< HIER die eigene mitarbeiter.id eintragen

SET FOREIGN_KEY_CHECKS = 0;

-- ── Einsaetze und was daran haengt ───────────────────────────────────
TRUNCATE TABLE einsatz_zuteilung;
TRUNCATE TABLE einsatz_position;
TRUNCATE TABLE einsatz_auslagen;
TRUNCATE TABLE einsaetze;
TRUNCATE TABLE masterschichten;
TRUNCATE TABLE verfuegbarkeiten;
TRUNCATE TABLE abwesenheiten;

-- ── Rapporte, Rundgaenge, Ereignisse (samt Fotos) ────────────────────
TRUNCATE TABLE rapporte;
TRUNCATE TABLE rundgang_scan;
TRUNCATE TABLE rundgang_position;
TRUNCATE TABLE rundgang_aufgabe;
TRUNCATE TABLE rundgang;
TRUNCATE TABLE rundgang_vorlage_punkt;
TRUNCATE TABLE rundgang_vorlage;
TRUNCATE TABLE ereignis_meldung;

-- ── Objekte samt Kontrollpunkten und Geofences ───────────────────────
TRUNCATE TABLE kontrollpunkt_aufgabe;
TRUNCATE TABLE kontrollpunkt;
TRUNCATE TABLE geofence_bereich;
TRUNCATE TABLE objekt_aufgabe;
TRUNCATE TABLE objekt_distanz;
TRUNCATE TABLE objekt_kontaktweg;
TRUNCATE TABLE objekt_person;
TRUNCATE TABLE objekte;

-- ── Belege ───────────────────────────────────────────────────────────
-- Alle elf gehen weg. Acht trugen einen Versandlink, sechs den Status
-- 'angeschaut' -- der wird aber bei JEDEM Abruf des oeffentlichen Links
-- gesetzt (beleg_oeffentlich.php, Zeile 190), auch beim eigenen
-- Nachsehen im Browser. Er sagt nichts darueber, WER geoeffnet hat.
-- Der Projektinhaber hat am 2026-09-10 ausdruecklich bestaetigt, dass
-- jeder einzelne Eintrag zu Testzwecken entstand. Damit ist keine dieser
-- Nummern ausser Haus, und die Nummernkreise duerfen wieder bei OF-0001
-- und RE-0001 beginnen: beleg_naechste_nummer() leitet sie aus dem
-- Bestand ab, nicht aus einem Zaehler.
TRUNCATE TABLE beleg_positionen;
TRUNCATE TABLE belege;
TRUNCATE TABLE produkte;

-- ── Lohn ─────────────────────────────────────────────────────────────
-- lohn_person/_ansatz/_abzug waren bereits leer: es gab nie
-- Lohnstammdaten, deshalb erzeugte der eine Lohnlauf 0 Zeilen.
TRUNCATE TABLE lohnlauf_zeile;
TRUNCATE TABLE lohnlauf_person;
TRUNCATE TABLE lohnlauf;
TRUNCATE TABLE lohn_zahlung;
TRUNCATE TABLE lohn_abzug;
TRUNCATE TABLE lohn_ansatz;
TRUNCATE TABLE lohn_person;

-- ── Fahrzeuge ────────────────────────────────────────────────────────
TRUNCATE TABLE fahrzeug_uebernahme;
TRUNCATE TABLE fahrzeuge;

-- ── Mitteilungen und Kundenportal ────────────────────────────────────
-- kundenzugang geht mit: die Zugaenge gehoerten zu Testobjekten. Die
-- KUNDEN selbst bleiben -- ein Zugang ist nachher neu vergebbar.
TRUNCATE TABLE mitteilung_gelesen;
TRUNCATE TABLE mitteilungen;
TRUNCATE TABLE portal_abruf;
TRUNCATE TABLE kundenzugang_code;
TRUNCATE TABLE kundenzugang;
TRUNCATE TABLE kunden_sessions;

-- ── Technische Reste: Sitzungen, Spuren, Zaehler ─────────────────────
-- Alle Angemeldeten muessen sich danach neu anmelden. Das war mit ENT-501
-- ohnehin faellig.
TRUNCATE TABLE sessions;
TRUNCATE TABLE passwort_reset;
TRUNCATE TABLE anmeldeversuche;
TRUNCATE TABLE push_abo;
TRUNCATE TABLE zwei_faktor_codes;
TRUNCATE TABLE zwei_faktor_geraete;
TRUNCATE TABLE zwei_faktor;
TRUNCATE TABLE benutzer_layout;
TRUNCATE TABLE aenderungslog;

-- ── Personal: alle ausser dem eigenen Konto ──────────────────────────
-- Die Bedingung "@ICH > 0" ist die Notbremse: Wurde @ICH oben vergessen,
-- passiert hier NICHTS, statt alle neun Konten zu loeschen. Lieber ein
-- zweiter Lauf als ein ausgesperrter Betrieb.
DELETE FROM mitarbeiter_rollen WHERE mitarbeiter_id <> @ICH AND @ICH > 0;
DELETE FROM mitarbeiter        WHERE id             <> @ICH AND @ICH > 0;

-- Rueckfallschutz: Hat das ueberlebende Konto keine Zeile mehr in
-- mitarbeiter_rollen, faellt rechte_rollen() in backend/rechte.php auf die
-- Spalte ist_admin zurueck. Diese Zeile stellt sicher, dass dieser
-- Rueckfall Verwaltung bedeutet und nicht Mitarbeitend.
UPDATE mitarbeiter SET ist_admin = 1, aktiv = 1 WHERE id = @ICH AND @ICH > 0;

SET FOREIGN_KEY_CHECKS = 1;

-- ── Nachkontrolle ────────────────────────────────────────────────────
-- Soll: kunden 132, mitarbeiter 1, alles andere in der ersten Gruppe 0.
SELECT 'kunden (soll: unveraendert)' AS pruefung, COUNT(*) AS anzahl FROM kunden
UNION ALL SELECT 'mitarbeiter (soll: 1)',     COUNT(*) FROM mitarbeiter
UNION ALL SELECT 'einsaetze (soll: 0)',       COUNT(*) FROM einsaetze
UNION ALL SELECT 'einsatz_zuteilung (soll: 0)', COUNT(*) FROM einsatz_zuteilung
UNION ALL SELECT 'objekte (soll: 0)',         COUNT(*) FROM objekte
UNION ALL SELECT 'kontrollpunkt (soll: 0)',   COUNT(*) FROM kontrollpunkt
UNION ALL SELECT 'belege (soll: 0)',          COUNT(*) FROM belege
UNION ALL SELECT 'rapporte (soll: 0)',        COUNT(*) FROM rapporte
UNION ALL SELECT 'rundgang (soll: 0)',        COUNT(*) FROM rundgang
UNION ALL SELECT 'betrieb (soll: 1)',         COUNT(*) FROM betrieb
UNION ALL SELECT 'rollen_rechte (soll: 52)',  COUNT(*) FROM rollen_rechte
UNION ALL SELECT 'lohnart (soll: 21)',        COUNT(*) FROM lohnart;
