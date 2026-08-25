/* ══════════════════════════════════════════════════════════════════════════
   GAV-REGELN — gemeinsam für Verwaltung (dashboard.html) und
   Mitarbeiter-App (app.html).

   WARUM EINE DATEI: Dieselbe Schicht muss in beiden Oberflächen dieselbe
   Zahl ergeben. Sieht die Verwaltung andere Stunden als die betroffene
   Person selbst, ist der Streit vorprogrammiert — und im Zweifel steht die
   Person schlechter da, weil sie die Abweichung erklären müsste. Zwei
   Kopien einer Lohnregel driften früher oder später auseinander; die eine
   Kopie hier kann es nicht.

   WAS HIER NICHT PASSIERT: Es entsteht kein Lohn, keine Rechnung, kein
   Zeitzuschlag nach Art. 14 Ziff. 3 und kein Ferienstand. Die Funktionen
   liefern Zeiten, die angezeigt und von einem Menschen beurteilt werden.

   Bezugsversion: GAV private Sicherheitsdienstleistungen, Ausgabe 2026.
   Offene Auslegungsfragen: siehe `90-gav/auslegungsregister.md`
   (GAV-AUS-001 bis GAV-AUS-008 im Dokumentations-Repository).
   ══════════════════════════════════════════════════════════════════════════ */

/* Versioniertes Regelwerk mit Gültigkeitszeitraum, wie CLAUDE.md Teil B es
   verlangt: eine spätere GAV-Revision darf zurückliegende Monate nicht
   rückwirkend verändern. Fällt ein Datum in keinen Zeitraum, wird NICHT
   gerechnet — lieber keine Zahl als eine auf abgelaufener Grundlage.

   Beim Fortschreiben: neuen Eintrag ANHÄNGEN, den alten stehen lassen. */
const GAV_REGELWERK = [
  {
    quelle: 'GAV private Sicherheitsdienstleistungen, Ausgabe 2026 (AVE vom 11.12.2025)',
    ab: '2026-01-01', bis: '2026-12-31',
    satz: 0.10,                              // 6 Minuten pro Stunde
    nachtAb: 23 * 60, nachtBis: 6 * 60,      // 23:00–06:00, über Mitternacht
    sonntagAb: 6 * 60, sonntagBis: 23 * 60,  // 06:00–23:00 an Sonntagen
  },
];
const gavRegel = datum => GAV_REGELWERK.find(r => datum >= r.ab && datum <= r.bis) || null;

/* Rohzeit in Minuten: bis minus von, über Mitternacht hinweg. OHNE
   Pausenabzug — die Pausenpflicht bemisst sich an der Zeit vor dem Abzug,
   sonst wäre die Rechnung zirkulär (die Pause kürzte ihre eigene Pflicht). */
function gavRohMin(von, bis) {
  if (!von || !bis) { return null; }
  const min = t => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  let d = min(bis) - min(von);
  if (d < 0) { d += 1440; }
  return d;
}

/* Nettozeit = Rohzeit minus UNBEZAHLTER Pause (ENT-047).
   Art. 13 Ziff. 2 rechnet eine bezahlte Pause ausdrücklich zur Arbeitszeit.

   Nur die MA-Kennzeichnung wirkt. "Bezahlte Pause Kunde" ist eine
   Verrechnungsfrage gegenüber dem Auftraggeber und hat mit dem Lohn nichts
   zu tun — die beiden dürfen nie zusammengeworfen werden.

   Ist die Kennzeichnung noch nicht gesetzt (null), wird abgezogen: das ist
   die bisherige Rechnung und bleibt der Ausgangszustand, solange die
   Feststellung nach Art. 13 Ziff. 2 niemand getroffen hat. */
function gavNetto(von, bis, pauseMin, pauseBezahltMa) {
  let d = gavRohMin(von, bis);
  if (d === null) { return ''; }
  if (Number(pauseBezahltMa) !== 1) { d -= Number(pauseMin || 0); }
  if (d < 0) { return ''; }
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}

/* Mindestpause nach Art. 13 Ziff. 1 — WÖRTLICH aus dem Vertrag:
   15 Min. bei mehr als 5½ Std., 30 Min. bei mehr als 7, 60 Min. bei mehr
   als 9. Die Zahlen sind eindeutig; offen ist nur, WORAUF sie angewendet
   werden (GAV-AUS-007). Hier: Rohzeit der einzelnen Schicht. */
const GAV_PAUSE_REGEL = [
  { abMin: 9 * 60, pause: 60, text: 'mehr als 9 Std.' },
  { abMin: 7 * 60, pause: 30, text: 'mehr als 7 Std.' },
  { abMin: 5.5 * 60, pause: 15, text: 'mehr als 5½ Std.' },
];
function gavPauseSoll(von, bis) {
  const roh = gavRohMin(von, bis);
  if (roh === null) { return null; }
  const treffer = GAV_PAUSE_REGEL.find(r => roh > r.abMin);
  return treffer ? { min: treffer.pause, weil: treffer.text } : { min: 0, weil: null };
}

/* Zeitbonus nach Art. 12 Ziff. 2: 6 Minuten (10 %) pro Stunde, die in ein
   Bonusfenster fällt — Nachtarbeit 23:00–06:00 oder Sonntagsarbeit
   06:00–23:00, jeweils inklusive Pause.

   Minutenweise über den echten Kalenderverlauf, weil eine Schicht über
   Mitternacht in einen Sonntag hineinlaufen kann.

   Die beiden Fenster sind KOMPLEMENTÄR — dieselbe Minute kann nie in beide
   fallen. Die vom PaKo bestätigte Regel "nur einmal, nicht doppelt" ist
   damit bauartbedingt eingehalten (GAV-AUS-001, geklärt).

   ANTEILIG statt nur volle Stunden: der Vertrag nennt 6 Minuten UND 10 %
   im selben Atemzug, und ein Prozentsatz ist seiner Natur nach anteilig.
   Für 15-Minuten-Runden ist das entscheidend — GAV-AUS-008, vorläufige
   Annahme, noch nicht von der PaKo bestätigt.

   FEIERTAGE FEHLEN: welche Liste gilt, ist offen (GAV-AUS-006). Ein
   Feiertag, der kein Sonntag ist, bekommt hier keinen Bonus; die Summe ist
   dann ZU TIEF. Aufrufer müssen das kenntlich machen — dafür gibt es
   gavFeiertagLuecke().

   Rückgabe null heisst "kein Regelwerk für dieses Datum". */
function gavBonusMin(datum, von, bis) {
  const regel = gavRegel(datum);
  if (!regel || !von || !bis) { return null; }
  const min = t => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  const start = min(von);
  let ende = min(bis);
  if (ende <= start) { ende += 1440; }
  const tag0 = new Date(datum + 'T12:00:00');
  let imFenster = 0;
  for (let m = start; m < ende; m++) {
    const tagesMin = ((m % 1440) + 1440) % 1440;
    const d = new Date(tag0.getTime() + Math.floor(m / 1440) * 864e5);
    const inNacht = tagesMin >= regel.nachtAb || tagesMin < regel.nachtBis;
    const inSonntag = d.getDay() === 0 && tagesMin >= regel.sonntagAb && tagesMin < regel.sonntagBis;
    if (inNacht || inSonntag) { imFenster++; }
  }
  return imFenster * regel.satz;
}

/* Fällt eine Schicht auf einen Feiertag, der kein Sonntag ist? Dann fehlt
   in der Summe ein Bonus, den der GAV vorsieht — das muss man sehen,
   sonst hält man eine zu tiefe Zahl für vollständig.
   `karte` ist eine Zuordnung Datum -> Feiertag (beliebiger Wahrheitswert). */
function gavFeiertagLuecke(datum, von, bis, karte) {
  const tage = [datum];
  if (von && bis && bis <= von) {
    const d = new Date(datum + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    tage.push(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  }
  return tage.some(t => (karte || {})[t] && new Date(t + 'T12:00:00').getDay() !== 0);
}

/* ══════════════════════════════════════════════════════════════════════
   AUSLAGENERSATZ NACH ART. 18 — ZONENBESTIMMUNG (ENT-054)

   Hier wird ausschliesslich die ZONE bestimmt, keine Franken. Das ist eine
   bewusste Grenze: Die Beträge stehen zwar im Vertrag, aber bei mehreren
   Einsätzen am selben Tag ist nach Art. 18 Ziff. 8 gar nicht bestimmbar,
   welcher Einsatz die Pauschale trägt (GAV-AUS-010, offen). Eine Zahl auf
   dem Bildschirm wird zur Auszahlung — also erst rechnen, wenn geklärt.

   Gemessen wird IMMER ab Hauptanstellungsort (Art. 18 Ziff. 2, wörtlich:
   "Es gilt immer die Berechnungsgrundlage: kürzeste effektive Wegstrecke
   ausgehend vom Hauptanstellungsort zu seinem konkreten Einsatzort gemäss
   'Google Maps', Hin- und Rückweg"). Der Nebenanstellungsort ist KEIN
   zweiter Messpunkt — er erzeugt nur das Nebenanstellungsgebiet, und das
   geht allen Pauschalzonen und der Regiezone vor.

   Die Zonengrenzen bemessen sich an der EINFACHEN Strecke ("der Einsatzort
   befindet sich zwischen 10.01 bis 20 km Wegstrecke ab Anstellungsort").
   Dass die Pauschalen Hin- und Rückweg abdecken, ist eine Aussage über die
   Beträge, nicht über die Grenzen — der PAKO-Kommentar bestätigt das:
   "Alle Pauschalzonen sind als Hin- und Rückweg berechnet."       */

/* Der Satz, der beim Erfassen einer Wegstrecke auf dem Bildschirm stehen
   muss. Er steht hier und nicht in der Oberflaeche, weil er eine GAV-Regel
   wiedergibt und nicht eine Gestaltungsfrage ist -- und weil er an zwei
   Stellen gebraucht wird (Anstellungsort und Objekt).

   Der Hinweis ist kein Schoenheitsfehler-Schutz, sondern schliesst eine
   echte Falle: Google Maps sortiert die Routenliste nach FAHRZEIT. Die
   oberste Zeile ist damit die schnellste, nicht die kuerzeste. Wer sie
   ungeprueft abschreibt, kann eine Zone zu hoch oder zu tief landen -- und
   die Zonengrenzen liegen auf 10.00 / 20.00 / 30.00 km. */
const GAV_WEGSTRECKE_HINWEIS =
  'Kürzeste effektive Wegstrecke ab Hauptanstellungsort gemäss Google Maps '
  + '(Art. 18 Ziff. 2 GAV) — nicht die schnellste. Google sortiert die Routen '
  + 'nach Fahrzeit; massgebend ist die Route mit den wenigsten Kilometern.';

/* GAV-AUS-010 ist offen (Auslegungsregister): "Pro Tag kann nur ein Hin- und
   Rueckweg zum Einsatzort mit Pauschalen abgerechnet werden" (Art. 18
   Ziff. 8) -- WELCHER von mehreren Einsaetzen am selben Tag das ist, ist
   nicht geklaert. Die Sperrwirkung dazu ist woertlich: "Solange offen, wird
   fuer Tage mit mehr als einem Einsatz kein Auslagenersatz berechnet -- weder
   als Vorschlag noch als Anzeige."

   Diese Konstante ist trotzdem KEINE Verletzung der Sperre: Es wird nichts
   BERECHNET, nur GEMELDET, dass der Fall eintreten kann. Eine Zone, die
   Entschaedigung ausloest, und eine Person mit zwei Einsaetzen am selben Tag
   sind beobachtbare Tatsachen -- die Sperre verbietet, daraus einen Betrag zu
   machen, nicht, den Zustand zu zeigen.

   Eine einzige Quelle (wie GAV_WEGSTRECKE_HINWEIS oben), weil der Text an
   mehreren Stellen gebraucht wird: Objektliste, Objektdialog, Neue-Schicht,
   Einsatzplan (siehe OP-104). */
const GAV_AUS010_HINWEIS =
  'GAV-AUS-010 ist offen: Für Tage mit mehr als einem Einsatz je Person darf '
  + 'nach heutigem Stand kein Auslagenersatz berechnet oder angezeigt werden — '
  + 'es ist nicht geklärt, welcher Einsatz als „der eine Hin- und Rückweg" gilt '
  + '(Art. 18 Ziff. 8). Vor einer Abrechnung muss das die PaKo klären (OP-104).';

const GAV_ZONEN = [
  { schluessel: 'anstellungsgebiet', name: 'Anstellungsgebiet',
    bis: 10, entschaedigung: false, quelle: 'Art. 18 Ziff. 3.1.1' },
  { schluessel: 'pauschalzone1', name: 'Pauschalzone 1',
    bis: 20, entschaedigung: true, quelle: 'Art. 18 Ziff. 3.1.2' },
  { schluessel: 'pauschalzone2', name: 'Pauschalzone 2',
    bis: 30, entschaedigung: true, quelle: 'Art. 18 Ziff. 3.1.3' },
  { schluessel: 'regiezone', name: 'Regiezone',
    bis: Infinity, entschaedigung: true, quelle: 'Art. 18 Ziff. 3.1.4' },
];

/* Zone eines Einsatzortes.
     kmHao    — Wegstrecke Hauptanstellungsort -> Einsatzort, einfach
     kmNao    — Wegstrecke Nebenanstellungsort -> Einsatzort (null, wenn keiner)
     kmHaoNao — Wegstrecke zwischen den beiden Anstellungsorten (null ohne NAO)

   Rückgabe: null, wenn die Distanz nicht bekannt ist. Das ist der wichtigste
   Rückgabewert überhaupt — "nicht bekannt" darf NIE wie "keine Entschädigung"
   aussehen. Genau dieser Fehler kostet Mitarbeitende sonst still ihr Geld. */
function gavZone(kmHao, kmNao, kmHaoNao) {
  const h = kmHao === null || kmHao === undefined || kmHao === '' ? null : Number(kmHao);
  if (h === null || !isFinite(h) || h < 0) { return null; }

  const n = kmNao === null || kmNao === undefined || kmNao === '' ? null : Number(kmNao);

  // Das Nebenanstellungsgebiet geht allen anderen Zonen vor (Art. 18
  // Ziff. 3.2.5 bzw. 3.3.5). OB dort etwas geschuldet ist, hängt am Abstand
  // der beiden Anstellungsorte: unter 40 km nichts (Ziff. 3.2.5), ab 40 km
  // eine Pauschale nach Formel (Ziff. 3.3.5).
  if (n !== null && isFinite(n) && n <= 10) {
    const d = kmHaoNao === null || kmHaoNao === undefined || kmHaoNao === '' ? null : Number(kmHaoNao);
    if (d === null || !isFinite(d)) { return null; }   // unbestimmbar, nicht "keine"
    return {
      schluessel: 'nebenanstellungsgebiet',
      name: 'Nebenanstellungsgebiet',
      entschaedigung: d >= 40,
      quelle: d >= 40 ? 'Art. 18 Ziff. 3.3.5' : 'Art. 18 Ziff. 3.2.5',
      vorrang: true,
    };
  }

  const z = GAV_ZONEN.find(x => h <= x.bis);
  return { schluessel: z.schluessel, name: z.name, entschaedigung: z.entschaedigung, quelle: z.quelle, vorrang: false };
}

/* ══════════════════════════════════════════════════════════════════════
   GELTUNGSBEREICH: NUR SICHERHEIT (ENT-061)

   Das gesamte Regelwerk in dieser Datei stammt aus dem GAV für private
   Sicherheitsdienstleistungen. Für Reinigungseinsätze gilt er nicht — der
   Projektinhaber hat das am 2026-08-20 festgestellt und die Verantwortung
   für diese Sparte ausdrücklich übernommen.

   Massgeblich ist die SPARTE, nicht die Einsatzart: Sie steht am Objekt als
   Vorgabe und wird auf den Einsatz vererbt, wo sie verbindlich ist
   (ENT-037). Die Einsatzart beschreibt die Arbeit, die Sparte das Regelwerk.

   Was hier ABGESCHALTET wird, weil es nur aus diesem GAV stammt:
     - Zeitbonus für Nacht- und Sonntagsarbeit (Art. 12 Ziff. 2)
     - Auslagenersatz nach Art. 18 (Zonen, Fahrzeit-, Fahrkostenersatz)
     - die 210-Stunden-Schwelle (Art. 14 Ziff. 3)

   Was BLEIBT, und das ist der Punkt, der leicht übersehen wird:
     - Der Pausenhinweis. Die Schwellen 5½ / 7 / 9 Stunden stehen ebenso in
       Art. 15 des ARBEITSGESETZES, das unabhängig von jedem GAV gilt. Der
       PAKO-Kommentar sagt es selbst: "Die Pausen sind auch in Art. 15 ArG
       geregelt." Der GAV schreibt sie nicht vor, er wiederholt sie. Wer die
       Pausen mit dem GAV abschaltet, entfernt einen Hinweis, der von Gesetzes
       wegen weiter gilt.
     - Die Nettozeit. Bis minus von minus unbezahlte Pause ist Arithmetik,
       keine Auslegung.

   OFFEN und ausdrücklich nicht behauptet: ob für die Reinigung ein eigener
   GAV gilt. Das ist nicht geprüft und liegt beim Projektinhaber.        */

const GAV_SPARTE = 'sicherheit';

/* Gilt das Sicherheits-Regelwerk für diesen Einsatz?
   Eingabe ist die Sparte des Einsatzes (oder ersatzweise die des Objekts).
   Fehlt sie, wird SICHERHEIT angenommen — die vorsichtige Richtung: Lieber
   einen Bonus zu viel prüfen als einen zu wenig zahlen. */
function gavGilt(sparte) {
  return String(sparte || GAV_SPARTE).toLowerCase() !== 'reinigung';
}

/* ══════════════════════════════════════════════════════════════════════
   RUHEZEIT — DIE ERSTE KONTROLLINSTANZE (ENT-064)

   Anders als Zeitbonus oder Auslagenersatz geht es hier nicht um Geld,
   sondern um Gesundheit. Art. 14 Ziff. 4 GAV behaelt die
   arbeitsgesetzlichen Vorschriften zu taeglicher Ruhezeit und maximaler
   Tagesarbeitszeit ausdruecklich vor und ermaechtigt die PaKo, bei
   ernstlichen Hinweisen auf regelmaessige grobe Verstoesse das
   Arbeitsinspektorat einzuschalten.

   Die Zahl stammt NICHT aus dem Gedaechtnis, sondern aus dem
   PAKO-Kommentar zu Art. 15 Ziff. 5, woertlich:

     "Ein freier Tag umfasst 24 Stunden plus die taegliche regulaere
      Ruhezeit von 11 Stunden, d. h. 35 Stunden zwischen den Einsaetzen."

   Damit sind zwei Schwellen belegt: 11 Stunden zwischen zwei Schichten,
   35 Stunden, damit ein Tag als freier Tag zaehlt.

   WAS HIER BEWUSST FEHLT: Das Arbeitsgesetz erlaubt, die taegliche
   Ruhezeit einmal pro Woche auf 8 Stunden zu verkuerzen, sofern der
   Durchschnitt ueber zwei Wochen 11 Stunden erreicht. Diese Ausnahme ist
   hier NICHT umgesetzt -- der Gesetzestext liegt nicht im Repository, und
   eine Ausnahme aus dem Gedaechtnis waere genau die Art von Annahme, die
   CLAUDE.md verbietet. Folge: Das Werkzeug warnt in diesen Faellen zu oft,
   nie zu selten. Das ist die richtige Richtung -- eine Warnung zu viel
   kostet einen Klick, eine zu wenig kostet Ruhezeit.                    */

const GAV_RUHEZEIT = {
  stundenMin: 11,
  freierTagMin: 35,
  quelle: 'PAKO-Kommentar zu Art. 15 Ziff. 5 GAV, i.V.m. Art. 14 Ziff. 4 GAV',
  ausnahmeOffen: 'Die Verkürzung auf 8 Stunden einmal pro Woche (Arbeitsgesetz) ist nicht umgesetzt.',
};

/* Lücke in Minuten zwischen dem Ende der einen und dem Beginn der
   naechsten Schicht. Beide Schichten koennen ueber Mitternacht laufen --
   gavRohMin() kennt das bereits, hier wird dieselbe Logik auf zwei
   getrennte Termine angewandt.
   Rueckgabe: null, wenn sich nichts bestimmen laesst. Ueberlappen sich
   die beiden, ist es keine Ruhezeitfrage, sondern eine Doppelbelegung --
   dann ebenfalls null, denn dafuer gibt es eine eigene Pruefung. */
function gavRuheLuecke(datumA, vonA, bisA, datumB, vonB, bisB) {
  const spanne = (d, v, b) => {
    if (!d || !v || !b) { return null; }
    const t0 = new Date(d + 'T00:00:00');
    if (isNaN(t0.getTime())) { return null; }
    const min = s => Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3, 5));
    const a = t0.getTime() / 60000 + min(v);
    let e = t0.getTime() / 60000 + min(b);
    if (e <= a) { e += 1440; }
    return [a, e];
  };
  const A = spanne(datumA, vonA, bisA), B = spanne(datumB, vonB, bisB);
  if (!A || !B) { return null; }
  if (A[0] < B[1] && B[0] < A[1]) { return null; }   // Ueberlappung, nicht Ruhezeit
  return B[0] >= A[1] ? B[0] - A[1] : A[0] - B[1];
}

/* Prueft eine geplante Schicht gegen die uebrigen Schichten einer Person.
   `andere` ist eine Liste von {datum, von, bis, titel, kunde_name}.
   Zurueck kommt eine Liste der Unterschreitungen, jeweils mit der
   gefundenen Luecke -- damit die Meldung die Zahl nennen kann und nicht
   nur "zu wenig". */
function gavRuheVerletzungen(datum, von, bis, andere) {
  if (!datum || !von || !bis) { return []; }
  const grenze = GAV_RUHEZEIT.stundenMin * 60;
  const treffer = [];
  (andere || []).forEach(e => {
    const l = gavRuheLuecke(datum, von, bis, e.datum, e.von, e.bis);
    if (l === null || l >= grenze) { return; }
    treffer.push({ minuten: l, gegen: e });
  });
  return treffer.sort((a, b) => a.minuten - b.minuten);
}

/* "8:30" aus 510 Minuten -- fuer die Meldung. */
function gavStd(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════════════════
   ANSTELLUNGSKATEGORIEN NACH ART. 8 (ENT-065)

   Art. 8 Ziff. 1a, woertlich:
     A  Monatslohn, vertraglich fix 1'801 bis 2'300 Stunden pro Kalenderjahr
     B  Monatslohn, vertraglich fix   901 bis 1'800 Stunden
     C  Stundenlohn, bis 900 Arbeitsstunden pro Kalenderjahr,
        "inkl. Ferien und Zeitbonus von 10 % (gem. Art. 12 Ziff. 2 GAV)
         sowie Zeitzuschlag (nach Art. 14 Ziff. 3 GAV)"

   Der Zusatz bei C ist der Kern und leicht zu ueberlesen: Die 900 Stunden
   sind BEWERTETE Zeit, nicht geleistete. Wer 860 Stunden nachts arbeitet,
   liegt mit dem Zeitbonus bereits darueber. Eine Warnung auf der Rohzeit
   kaeme zu spaet.

   Zwei Schwellen, zwei verschiedene Bemessungen:
     - die Kategoriegrenze (Ziff. 1c) auf BEWERTETER Zeit
     - der Nachzahlungs-Ausloeser (Ziff. 4) bei 1'000 TATSAECHLICH
       gearbeiteten Stunden fuer Kategorie C
   Wer beides mit derselben Zahl prueft, liegt bei einem von beiden falsch.

   WAS DIE ZAHL HEUTE NICHT ENTHAELT: Feiertagsbonus (GAV-AUS-006 offen),
   Zeitzuschlag 25 % ueber 210 Std. (nicht gebaut), Ferien (nicht gebaut).
   Die Summe ist damit systematisch ZU TIEF -- der Balken schlaegt zu spaet
   aus, nie zu frueh. Deshalb heisst die Zahl in der Oberflaeche
   "mindestens" und nicht "genau".                                       */

const GAV_KATEGORIEN = {
  A: { grenze: 2300, ab: 1801, lohn: 'Monatslohn' },
  B: { grenze: 1800, ab: 901,  lohn: 'Monatslohn' },
  C: { grenze: 900,  ab: 0,    lohn: 'Stundenlohn', rohGrenze: 1000 },
};
const GAV_KAT_TOLERANZ = 0.05;   // Art. 8 Ziff. 2: bis 5 % uebertragbar
const GAV_KAT_QUELLE = 'Art. 8 Ziff. 1–4 GAV, Ausgabe 2026';

/* Wo steht eine Person im Verhaeltnis zu ihrer Kategoriegrenze?
     kategorie  — 'A' | 'B' | 'C' | null
     bewertetMin— Nettozeit + Zeitbonus in Minuten (GAV-Stunden)
     rohMin     — Nettozeit ohne Bonus, fuer Art. 8 Ziff. 4
   Rueckgabe null, wenn keine Kategorie hinterlegt ist -- ohne sie gibt es
   keine Grenze, und eine geratene waere schlimmer als keine. */
function gavKatStand(kategorie, bewertetMin, rohMin) {
  const k = GAV_KATEGORIEN[String(kategorie || '').toUpperCase()];
  if (!k) { return null; }
  const std = Number(bewertetMin || 0) / 60;
  const roh = Number(rohMin || 0) / 60;
  const toleranz = k.grenze * (1 + GAV_KAT_TOLERANZ);

  let stufe = 'ok';
  if (std > toleranz) { stufe = 'ueber_toleranz'; }
  else if (std > k.grenze) { stufe = 'ueber_grenze'; }
  else if (std >= k.grenze * 0.9) { stufe = 'nahe'; }

  // Der zweite, unabhaengige Ausloeser -- nur Kategorie C, und auf der
  // tatsaechlich gearbeiteten Zeit.
  const rohUeber = !!(k.rohGrenze && roh > k.rohGrenze);

  return {
    kategorie: String(kategorie).toUpperCase(),
    grenze: k.grenze,
    toleranz: Math.round(toleranz),
    rohGrenze: k.rohGrenze || null,
    stunden: std,
    rohStunden: roh,
    anteil: k.grenze ? std / k.grenze : 0,
    stufe,
    rohUeber,
    quelle: GAV_KAT_QUELLE,
  };
}
