// E-Mail-Versand unter Administration › Betrieb (ENT-730): eine Kachel mit
// den Reitern Gestaltung (der E-Mail-Designer, ENT-729) und Absender.
//
// Entscheide des Projektinhabers: Das Passwort steht verschluesselt am
// Server und kommt nie zurueck in den Browser. Speichern meldet sich am
// Mailserver an und speichert nur, wenn das klappt. Faellt der eigene
// Server aus, wird nicht ueber GuardOpS ausgewichen. Verschluesselung als
// Wahl zwischen SSL/TLS und STARTTLS, ohne unverschluesselt.
//
// Teil A fuehrt pruef_mail_versand.php aus (Verschluesselung, Sperre
// interner Adressen, kein Ausweichen, abgelehnte Anmeldung gegen ein echtes
// Gegenueber). Teil B misst die Oberflaeche.
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── A) Der Server, in PHP ausgefuehrt ──────────────────────────────────────
{
  let aus = '', code = 0;
  try { aus = execFileSync('php', [`${HIER}/pruef_mail_versand.php`], { encoding: 'utf8' }); }
  catch (e) { aus = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
  const n = Number((aus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
  check(`PHP: der eigene Mailserver laeuft durch (${n} Pruefungen)`, n > 35);
  const f = aus.split('\n').filter(z => z.trim().startsWith('x '));
  check('PHP: jede Pruefung zum eigenen Mailserver stimmt', code === 0 && f.length === 0);
  f.forEach(z => bad.push('PHP: ' + z.trim()));
}

// ── A2) Jede Kundenmail gibt den Server des Betriebs mit ────────────────────
// Eine Versandstelle, die mail_betrieb() benutzt, den Server aber nicht an
// smtp_senden() weitergibt, schickt still ueber GuardOpS -- genau das
// Ausweichen, das ausgeschlossen ist. Gezaehlt je Datei: so viele
// Weitergaben wie Aufrufe von mail_betrieb().
{
  const { readFileSync, readdirSync } = await import('fs');
  const dateien = [...readdirSync(`${WURZEL}/backend`).map(f => `backend/${f}`),
                   ...readdirSync(`${WURZEL}/backend/api`).map(f => `backend/api/${f}`)]
    .filter(f => f.endsWith('.php') && !f.endsWith('mail_gestaltung.php'));
  let stellen = 0;
  for (const f of dateien) {
    const q = readFileSync(`${WURZEL}/${f}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const aufrufe = (q.match(/\bmail_betrieb\(\$pdo/g) || []).length;
    if (!aufrufe) { continue; }
    stellen += aufrufe;
    const weiter = (q.match(/smtp_senden\([^;]*\[['"]server['"]\][^;]*\);/gs) || []).length;
    check(`KRITISCH: ${f} gibt den Server des Betriebs an smtp_senden() weiter (${weiter} von ${aufrufe})`, weiter >= aufrufe);
  }
  check(`Alle Versandstellen gefunden (${stellen})`, stellen >= 5);
}

const GUARDOPS = { typ: 'guardops', passwort_hinterlegt: false };
const EIGEN = { typ: 'eigen', absender: 'offerten@beispiel.ch', benutzer: 'offerten@beispiel.ch',
                server: 'mail.beispiel.ch', port: 465, verschluesselung: 'ssl', passwort_hinterlegt: true };

async function starte({ darf = true, schluessel = true, versand = GUARDOPS, anmeldung = true } = {}) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const fehler = [], posts = [], dialoge = [];
  page.on('pageerror', e => fehler.push(e.message));
  page.on('dialog', d => { dialoge.push(d.message()); d.dismiss(); });
  await page.addInitScript(() => { try { localStorage.setItem('rv3_huelle', 'aus'); } catch (e) {} });
  let amServer = versand;
  const rr = ['betrieb_lesen', ...(darf ? ['betrieb_schreiben'] : []), 'plan'];
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login') || u.includes('me.php')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false, rechte: rr, rollen: [] });
    if (u.includes('meine_einstellungen')) return send({ status: 'ok', einstellungen: { thema: 'hell', glas: 'aus', dichte: 'normal', farbe: 'graphit' } });
    if (u.includes('mail_absender')) {
      if (route.request().method() === 'GET') {
        return send({ status: 'ok', versand: amServer, schluessel_da: schluessel, stand_unbekannt: false,
                      darf_aendern: darf, ports: [25, 465, 587, 2525] });
      }
      const body = JSON.parse(route.request().postData());
      posts.push(body);
      if (body.aktion === 'speichern') {
        if (body.versand.typ === 'eigen' && !anmeldung) {
          return send({ status: 'error', message: 'Nicht gespeichert. Der Mailserver hat die Anmeldung nicht angenommen: Anmeldung abgelehnt.' }, 422);
        }
        const v = body.versand;
        amServer = v.typ === 'eigen'
          ? { typ: 'eigen', absender: v.absender, benutzer: v.benutzer, server: v.server, port: v.port,
              verschluesselung: v.verschluesselung, passwort_hinterlegt: true, zuletzt_ok: '2000-01-02 03:04:00' }
          : { typ: 'guardops', passwort_hinterlegt: false };
        return send({ status: 'ok', versand: amServer });
      }
      if (body.aktion === 'testmail') return send({ status: 'ok', an: 'ich@beispiel.ch' });
    }
    if (u.includes('mail_designer')) return send({ status: 'error', message: 'nicht Teil dieser Pruefung' }, 500);
    if (u.includes('dashboard_stats')) {
      return send({ status: 'ok', stand: '', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 }, verlauf: [], angemeldet: [],
        letzte_rapporte: [], pro_mitarbeiter: [], ereignisse: [], ereignisse_gesamt: 0, ereignisse_gekuerzt: false,
        ereignisse_je_art: {}, ereignisse_unvollstaendig: [], glocke: { ereignisse: [], gesamt: 0, gekuerzt: false, je_art: {}, aus: [] } });
    }
    return send({ status: 'ok', betrieb: {}, kunden: [], einsaetze: [], mitarbeiter: [], orte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);
  await page.evaluate(() => { go('betrieb'); bkUebersichtZeigen(); });
  await page.waitForTimeout(200);
  await page.click('#bkKachelMd');
  await page.waitForTimeout(500);
  return { browser, page, fehler, posts, dialoge };
}
const sichtbar = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && !!el.offsetParent; }, sel);
const absender = async page => { await page.click('.emv-tabs .tab[data-reiter="absender"]'); await page.waitForTimeout(150); };

// ── B) Eine Kachel, zwei Reiter ────────────────────────────────────────────
{
  const { browser, page, fehler } = await starte();
  check('Die Kachel heisst "E-Mail-Versand"', /^E-Mail-Versand$/.test((await page.textContent('#bkKachelMd')).trim()));
  const reiter = await page.$$eval('.emv-tabs .tab', t => t.map(x => x.textContent.trim()));
  check(`Zwei Reiter: Gestaltung und Absender (${reiter.join(', ')})`, reiter.join('|') === 'Gestaltung|Absender');
  check('Beim Oeffnen steht die Gestaltung vorne, der Absender ist zu',
    await sichtbar(page, '#emdVorschau') && !(await sichtbar(page, '#emvTyp')));
  await absender(page);
  check('Reiter Absender: das Formular ist da, die Gestaltung weg',
    await sichtbar(page, '#emvTyp') && !(await sichtbar(page, '#emdVorschau')));
  check('Die Knoepfe oben gehoeren zum Reiter (kein "Vorschau"-Feld beim Absender)',
    await sichtbar(page, '#emvSpeichern') && !(await sichtbar(page, '#emdArt')) && !(await sichtbar(page, '#emdSpeichern')));
  check('Der Reiter Absender ist als gewaehlt markiert', await page.evaluate(() =>
    document.querySelector('.emv-tabs .tab[data-reiter="absender"]').classList.contains('on')));

  // GuardOpS ist der Standard
  check('Standard: Versand ueber GuardOpS, keine Konfiguration zu sehen',
    await page.inputValue('#emvTyp') === 'guardops' && !(await sichtbar(page, '#emvKonfig')));
  check('Die Seite sagt, worueber die Mails gehen', /GuardOpS/.test(await page.textContent('#emvInfo')));
  check('Speichern ist aus, solange nichts geaendert ist', await page.evaluate(() => $('emvSpeichern').disabled));
  const opt = await page.$$eval('#emvVersch option', o => o.map(x => x.value));
  check(`KRITISCH: keine Wahl "unverschluesselt" (${opt.join(', ')})`, opt.join('|') === 'ssl|starttls');

  // Eigener Server waehlen
  await page.selectOption('#emvTyp', 'eigen');
  await page.waitForTimeout(100);
  check('Eigener Server: die Konfiguration erscheint', await sichtbar(page, '#emvKonfig'));
  const mass = await page.evaluate(() => {
    const r = id => $(id).getBoundingClientRect();
    return { benutzerPw: Math.abs(r('emvBenutzer').top - r('emvPasswort').top) < 2 && r('emvPasswort').left > r('emvBenutzer').right,
             serverPort: Math.abs(r('emvServer').top - r('emvPort').top) < 2 && r('emvPort').left > r('emvServer').right,
             breite: Math.round(document.querySelector('.emv-spalte').getBoundingClientRect().width) };
  });
  check('Benutzername und Passwort nebeneinander, Server und Port nebeneinander (gemessen)', mass.benutzerPw && mass.serverPort);
  check(`Das Formular bleibt schmal wie im Vorbild (${mass.breite} px)`, mass.breite <= 720);
  check('Ungespeichert: die Seite sagt es', /ungespeichert/i.test(await page.textContent('#emvStand')));

  // Port-Vorschlag
  await page.selectOption('#emvVersch', 'starttls');
  check('STARTTLS schlaegt Port 587 vor', await page.inputValue('#emvPort') === '587');
  await page.selectOption('#emvVersch', 'ssl');
  check('SSL/TLS schlaegt Port 465 vor', await page.inputValue('#emvPort') === '465');

  await page.screenshot({ path: `${OUT}/mail-absender.png`, fullPage: true });
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}

// ── C) Speichern: Anmeldung abgelehnt, dann geklappt ───────────────────────
{
  const { browser, page, fehler, posts, dialoge } = await starte({ anmeldung: false });
  await absender(page);
  await page.selectOption('#emvTyp', 'eigen');
  await page.fill('#emvAbsender', 'offerten@beispiel.ch');
  await page.fill('#emvBenutzer', 'offerten@beispiel.ch');
  await page.fill('#emvPasswort', 'Geheim-123');
  await page.fill('#emvServer', 'mail.beispiel.ch');
  await page.click('#emvSpeichern'); await page.waitForTimeout(300);
  const p = posts.find(x => x.aktion === 'speichern');
  check('Gespeichert wird, was eingetippt ist, samt Passwort',
    p && p.versand.typ === 'eigen' && p.versand.passwort === 'Geheim-123' && p.versand.server === 'mail.beispiel.ch' && p.versand.port === 465);
  check('Abgelehnte Anmeldung: die Meldung des Servers steht da, nicht gespeichert',
    /Anmeldung abgelehnt/.test(await page.textContent('#emvStand')) && await page.evaluate(() => emvGeaendert()));
  check('Und Speichern bleibt moeglich, fuer den naechsten Versuch', await page.evaluate(() => !$('emvSpeichern').disabled));
  // Verlassen mit ungespeicherten Angaben fragt nach
  await page.evaluate(() => emdZurueck()); await page.waitForTimeout(100);
  check('Zurueck mit ungespeicherten Angaben fragt nach', dialoge.some(d => /nicht gespeichert/i.test(d)));
  check('und bleibt auf der Seite, wenn man abbricht', await sichtbar(page, '#emvTyp'));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}
{
  const { browser, page, fehler } = await starte();
  await absender(page);
  await page.selectOption('#emvTyp', 'eigen');
  await page.fill('#emvAbsender', 'offerten@beispiel.ch');
  await page.fill('#emvBenutzer', 'offerten@beispiel.ch');
  await page.fill('#emvPasswort', 'Geheim-123');
  await page.fill('#emvServer', 'mail.beispiel.ch');
  await page.click('#emvSpeichern'); await page.waitForTimeout(300);
  check('Geklappt: die Seite sagt es', /Anmeldung .* hat geklappt/.test(await page.textContent('#emvStand')));
  check('KRITISCH: das Passwortfeld ist danach leer, es steht nur "Hinterlegt"',
    await page.inputValue('#emvPasswort') === '' && /Hinterlegt/.test(await page.getAttribute('#emvPasswort', 'placeholder')));
  check('Nichts mehr ungespeichert', await page.evaluate(() => !emvGeaendert() && $('emvSpeichern').disabled));
  check('Die letzte erfolgreiche Verbindung steht da', /Zuletzt erfolgreich verbunden: 02\.01\.2000, 03:04/.test(await page.textContent('#emvLetzt')));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}

// ── D) Gespeicherter eigener Server ────────────────────────────────────────
{
  const { browser, page, fehler, posts } = await starte({ versand: { ...EIGEN,
    letzter_fehler: { am: '2000-01-02 03:04:00', text: 'Anmeldung abgelehnt.' } } });
  await absender(page);
  check('Die gespeicherten Angaben stehen in den Feldern', await page.inputValue('#emvServer') === 'mail.beispiel.ch'
    && await page.inputValue('#emvVersch') === 'ssl' && await page.inputValue('#emvPort') === '465');
  check('KRITISCH: das Passwortfeld bleibt leer', await page.inputValue('#emvPasswort') === '');
  const letzt = await page.evaluate(() => ({ t: $('emvLetzt').textContent, warn: $('emvLetzt').classList.contains('warn') }));
  check('Ein fehlgeschlagener Versand faellt auf, mit Zeit und Grund', letzt.warn && /fehlgeschlagen \(02\.01\.2000, 03:04\): Anmeldung abgelehnt/.test(letzt.t));
  // Nur den Port aendern: das Passwort bleibt leer und gilt als unveraendert
  await page.selectOption('#emvPort', '2525');
  await page.click('#emvSpeichern'); await page.waitForTimeout(300);
  const p = posts.find(x => x.aktion === 'speichern');
  check('Ohne neues Passwort geht ein leeres Feld mit (der Server behaelt das alte)', p && p.versand.passwort === '' && p.versand.port === 2525);
  // Testmail
  await page.click('#emvTest'); await page.waitForTimeout(200);
  check('Testmail an mich: die Seite nennt die Adresse', /ich@beispiel\.ch/.test(await page.textContent('#emvStand')));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}

// ── E) Ohne Schluessel, ohne Recht ─────────────────────────────────────────
{
  const { browser, page, fehler } = await starte({ schluessel: false });
  await absender(page);
  await page.selectOption('#emvTyp', 'eigen');
  await page.fill('#emvPasswort', 'x');
  const info = await page.evaluate(() => ({ t: $('emvInfo').textContent, warn: $('emvInfo').classList.contains('warn') }));
  check('Ohne Schluessel auf der Anlage: die Seite sagt es deutlich', info.warn && /Schlüssel/.test(info.t));
  check('und Speichern und Testmail sind aus', await page.evaluate(() => $('emvSpeichern').disabled && $('emvTest').disabled));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}
{
  const { browser, page, fehler } = await starte({ darf: false, versand: EIGEN });
  await absender(page);
  check('Ohne Recht zum Aendern: Felder gesperrt, Speichern und Testmail weg',
    await page.evaluate(() => $('emvServer').disabled && $('emvTyp').disabled && $('emvSpeichern').hidden && $('emvTest').hidden));
  check('und die Seite sagt warum', /Ändern darf/.test(await page.textContent('#emvStand')));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  ✗ ' + b);
if (bad.length) { process.exitCode = 1; } else { console.log('Alle Pruefungen bestanden.'); }
