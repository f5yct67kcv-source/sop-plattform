// E-Mail-Designer unter Administration › Betrieb (ENT-729).
//
// Entscheid des Projektinhabers (Vorbild AbaNinja): links die Vorschau der
// gewaehlten Mail, rechts die Gestaltung nach dem CI des Betriebs, darunter
// die Texte je Mail mit Platzhaltern. Knopf und Link stehen fest in der
// Mail. Lesbarkeit wird angemahnt, nicht verboten.
//
// Die Vorschau rechnet hier wie auf dem Server die ECHTE PHP-Funktion
// (mail_vorschau_cli.php ruft mail_betrieb_bauen auf). Gemessen wird, was in
// der Vorschau steht -- nicht, was im Quelltext steht.
//
// Teil A fuehrt pruef_mail_gestaltung.php aus (die Mail selbst).
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const LOGO = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAACgBAMAAAB54XoeAAAAMFBMVEXgj4/////EKCj+/v7IOTnSXV346OjMRkbaeHjz1dXhlZXrt7fwyMjVZmbmp6fdhoYND/2JAAAAEHRSTlP/AP//////////////////0XJbHgAABPNJREFUeNrtWjGLXUUU/mY2WQkqzNiJzVYKqZ5W2iloglZL/oCbHyAIKggiiIVNQFKaRmws1cVCSBqDhWxSbSWIhX9AmEEMkbCbY/HevnfvnXPOnHvnPknQqe7eN/vd7zvnzJmZM+Mi5m0e/wM+coDnLJ3OIoFyva+LVjQjZgXQhfJdagDkf1RZ+gkfU0n4cXJV5pWv6cYVZftpeDJ9Pw1PRvQT8UREfqQ4PvL6GM7ulN4/9s0fayHOAXbxSm9GHZEDjJXgUH/3mgGFYEuaGUuGG8HJ4OFUZ2jA61APVUBnylJrRFcFDKast0EMFcB1tq8NFBIGjOcFG2aPxIv2vGDDbARetGcJJstceKbCKYDBaMB+tyACuhGCO/1cLR8mIx7rOl8qJpgblZp9qTjbAVd9nQCoEgxGit5IMApTSEHRS7FQJDl+BifFKUEkuGIXZYqBmfWcSHANFJk4oYFmX7F6n5i83AmSDbM+RzCGzIINBcUFp1jR7HWCsdRYvMo8w2Be4vCGDANATrFxBdvX7GX25hVs5iQbbFX5MTAMadoKlhiGbsC9vh/q9sgdI/qxG4CaBt8xAJnMxxiSOkbc6vY2T0bJQ0A3Bzc3ZEjTsWjIMFRyWF3pGmWbTskNMLkP6OYh5/oMqQWLtly3CTOBhe16OTfhZNWGNHp8YLtOcXOBuS5DasMik+QXY4z7AJ6MMT4DwP/6Wrz8xfcqcrXc9+7h5vNvvwzcvWvP2Gy7AuDy8vHpw5FTgChhsXx83erloMW1A/z15eMCeD+99Z4S2UGyYd6M7geL47M+e3jiI3yNW5e0sVWTfIADOOwCAI6xAwCXmmyY8Skurt38sN0pP+MEB/gYALCPvz98yeJEre1i13+CvWVIAjfw5rNfNjG8h9MfsLMPAPgNAI6++6kJ8OEh/sCF5fNft5ehvt8U2NfxDu6dje07AHDaBngTwLdndJ//8wjAB+MBO7nsZOmNVTt94bl1/qRpDB8scOG48/cvrckBr+Jk9XS0txzb59sAv8LF1dOd+9eunL8K3G8D/D3dXsv/7MenvgE+bwMs2s7hXIArf1ytAmbj+ubGGzcXeOXWNXlLn1f1jgC1/m0qVMVVkcubVs8j+jxGB4WNC5xeEYPmYkePlw0bV+5huwzzlFU28aG+RRu6WcJwCUjzhWFZMm10smjDerrJmg1zJdkxLQmf8BC8QmOCpqhjk42CLoAKG46ojWTJJ1pgK2ZM1cDOXGiTddR1i4V+QmSoxvDdbwab6MSGNTE2dKakQ/JA7gBms/UlX2XOy8FgrqwM5A4gCSmM6lbo19R9zXPJGJyZD+xQi5EMXfGwiOEqTkioKC4CO6hhQqgRNJWqkmF0M6UqkqeqrHxzeG5SlEyDPDZInk2ynL6cKJqyOn+WgKRMflkychhyL0v3Tki2SZngMw+oUSSCiWDfhgpFXjBz4MtlbPOlSe4chz2Tsi5KAhNO7DGccSHGXjrw7LCNYwSTtmjPI0QH1l2ezyyGYzPh3osXMouzGnA4IL0Ub9aTx1zb+JApGtd4VN9JZQPixsTFAGIOQTe9pQwdlTnGa3OI4OuozTH/yt252W/3FVqT/rrXzlmWqNG6e5RXsIZbRjSuzJIm4slr7DQNTzvd1zJOmlLEaNqn8Ihp3PuaZEl2y33sMghbb4wPsn19W24DfERKVf8ZwH8AcK1XotU53oYAAAAASUVORK5CYII=';

// ── A) Die Mail selbst, in PHP ausgefuehrt ─────────────────────────────────
{
  let aus = '', code = 0;
  try { aus = execFileSync('php', [`${HIER}/pruef_mail_gestaltung.php`], { encoding: 'utf8' }); }
  catch (e) { aus = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
  const n = Number((aus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
  check(`PHP: die Mail des Betriebs laeuft durch (${n} Pruefungen)`, n > 30);
  const f = aus.split('\n').filter(z => z.trim().startsWith('x '));
  check('PHP: jede Pruefung der Mail stimmt', code === 0 && f.length === 0);
  f.forEach(z => bad.push('PHP: ' + z.trim()));
}

const php = eingabe => JSON.parse(execFileSync('php', [`${HIER}/mail_vorschau_cli.php`],
  { input: JSON.stringify(eingabe), encoding: 'utf8' }));
const GRUND = php({ aktion: 'get' });

async function starte({ darf = true, unbekannt = false, betrieb = {}, gespeichert = null, speichern = 'echt' } = {}) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const fehler = [], posts = [];
  page.on('pageerror', e => fehler.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem('rv3_huelle', 'aus'); } catch (e) {} });
  const b = { firma: 'Muster Sicherheit AG', email: 'buero@beispiel.ch', logo_png: LOGO, ...betrieb };
  let amServer = gespeichert || GRUND.vorgabe;
  const rr = ['betrieb_lesen', ...(darf ? ['betrieb_schreiben'] : []), 'plan'];
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login') || u.includes('me.php')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false, rechte: rr, rollen: [] });
    if (u.includes('meine_einstellungen')) return send({ status: 'ok', einstellungen: { thema: 'hell', glas: 'aus', dichte: 'normal', farbe: 'graphit' } });
    if (u.includes('mail_designer')) {
      if (route.request().method() === 'GET') {
        return send({ status: 'ok', gestaltung: amServer, vorgabe: GRUND.vorgabe, arten: GRUND.arten,
          betrieb: { firma: b.firma, hat_logo: !!b.logo_png, logo_webp: !!b.logo_webp, email: b.email || '' },
          stand_unbekannt: unbekannt, darf_aendern: darf });
      }
      const body = JSON.parse(route.request().postData());
      posts.push(body);
      if (body.aktion === 'speichern') {
        if (unbekannt) return send({ status: 'error', stand_unbekannt: true }, 409);
        const r = php({ aktion: 'speichern', gestaltung: body.gestaltung });
        if (r.status === 'ok') { amServer = r.gestaltung; }
        return send(r, r.status === 'ok' ? 200 : 400);
      }
      if (body.aktion === 'testmail') return send({ status: 'ok', an: 'ich@beispiel.ch' });
      return send(php({ aktion: 'vorschau', art: body.art, gestaltung: body.gestaltung, betrieb: b }));
    }
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
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('md'); });
  await page.waitForTimeout(900);
  return { browser, page, fehler, posts };
}
const vorschau = page => page.evaluate(() => {
  const d = $('emdVorschau').contentDocument;
  const knopf = [...d.querySelectorAll('a')].find(a => a.closest('td') && a.closest('td').style.background);
  const kopf = [...d.querySelectorAll('td')].find(t => t.style.fontSize === '20px');
  return { html: d.documentElement.outerHTML, text: d.body ? d.body.innerText : '',
           betreff: $('emdBetreff').textContent,
           img: !!d.querySelector('img'), imgAusr: d.querySelector('img') ? d.querySelector('img').parentElement.getAttribute('align') : null,
           knopfText: knopf ? knopf.textContent : null, knopfHref: knopf ? knopf.getAttribute('href') : null,
           knopfHg: knopf ? getComputedStyle(knopf.parentElement).backgroundColor : null,
           kopfHg: kopf ? getComputedStyle(kopf).backgroundColor : null, kopfText: kopf ? kopf.textContent : null };
});
const warte = page => page.waitForTimeout(700);

// ── B) Aufbau ──────────────────────────────────────────────────────────────
{
  const { browser, page, fehler, posts } = await starte();
  const v = await vorschau(page);
  check('Die Vorschau zeigt die Offerte mit Logo, Kopfband und Knopf', v.img && v.kopfText === 'Offerte OF-0001' && v.knopfText === 'Offerte ansehen');
  check('Der Betreff steht ueber der Vorschau, mit eingesetzten Platzhaltern', v.betreff === 'Offerte OF-0001 von Muster Sicherheit AG');
  check('In der Vorschau bleibt kein Platzhalter stehen', !/\{[A-Za-z-]+\}/.test(v.text));
  check('Die Fusszeile nennt den Betrieb, der Hinweis auf GuardOpS ist voreingestellt',
    /Muster Sicherheit AG/.test(v.text) && /Versendet mit GuardOpS/.test(v.text));
  const arten = await page.evaluate(() => [...$('emdArt').options].map(o => o.textContent));
  check(`Alle Kundenmails stehen zur Wahl (${arten.join(', ')})`, arten.length === 6 && arten.includes('Offerte') && arten.includes('Rundgang-Rapport'));
  check('Speichern ist aus, solange nichts geaendert ist', await page.evaluate(() => $('emdSpeichern').disabled));
  check('Die Seite sagt, wohin Antworten gehen', /buero@beispiel\.ch/.test(await page.textContent('#emdAntwort')));

  const mass = await page.evaluate(() => {
    const l = document.querySelector('.emd-links').getBoundingClientRect(), r = document.querySelector('.emd-rechts').getBoundingClientRect();
    const f = $('emdVorschau').getBoundingClientRect();
    return { nebeneinander: r.left >= l.right, obenGleich: Math.abs(l.top - r.top) < 2, vorschauBreit: f.width >= 600, rechts: Math.round(r.width) };
  });
  check('Vorschau links, Einstellungen rechts, oben buendig', mass.nebeneinander && mass.obenGleich);
  check(`Die Vorschau ist mindestens so breit wie eine Mail (600 px)`, mass.vorschauBreit);
  const hoch = await page.evaluate(() => { const f = $('emdVorschau'), d = f.contentDocument;
    return { fenster: Math.round(f.getBoundingClientRect().height), inhalt: d.documentElement.scrollHeight }; });
  check(`Die Vorschau zeigt die ganze Mail ohne Bildlauf (${hoch.fenster} fuer ${hoch.inhalt} px)`, hoch.fenster >= hoch.inhalt);
  await page.screenshot({ path: `${OUT}/mail-designer.png`, fullPage: true });

  // ── C) Primaerfarbe faerbt Kopfband, Knopf und Links mit ────────────────
  await page.evaluate(() => { const el = $('emdF_primaer'); el.value = '#e05757'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await warte(page);
  const v2 = await vorschau(page);
  check('KRITISCH: die Primaerfarbe kommt in Kopfband und Knopf der Vorschau an (gemessen)',
    v2.kopfHg === 'rgb(224, 87, 87)' && v2.knopfHg === 'rgb(224, 87, 87)');
  check('Speichern wird moeglich, und die Seite sagt "ungespeichert"',
    await page.evaluate(() => !$('emdSpeichern').disabled && /ungespeichert/i.test($('emdStand').textContent)));

  // ── D) Lesbarkeit: Warnung, kein Verbot ────────────────────────────────
  await page.evaluate(() => { const el = $('emdF_knopf_text'); el.value = '#f0f0f0'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const k = $('emdF_knopf'); k.value = '#ffe680'; k.dispatchEvent(new Event('input', { bubbles: true })); });
  await warte(page);
  check('Hellgrau auf Gelb: die Seite warnt beim Knopf', /knopf/i.test(await page.textContent('#emdWarnInhalt')));
  // Weiss auf dem Rot aus dem Vorbild (#E05757) liegt bei 3.6 : 1 -- auch das
  // meldet die Seite. Ein dunkleres Rot ist lesbar, dann verschwindet sie.
  check('Weiss auf hellem Rot: die Seite warnt auch beim Kopfband', /kopfband/i.test(await page.textContent('#emdWarnKopf')));
  await page.evaluate(() => { const el = $('emdF_kopf_hg'); el.value = '#9b1c1c'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await warte(page);
  check('Mit dunklem Rot ist das Kopfband lesbar, und die Warnung verschwindet -- nur dort',
    (await page.textContent('#emdWarnKopf')).trim() === '' && /knopf/i.test(await page.textContent('#emdWarnInhalt')));
  check('Trotz Warnung bleibt Speichern moeglich (Warnung, kein Verbot)', await page.evaluate(() => !$('emdSpeichern').disabled));

  // ── E) Texte, Platzhalter, fester Knopf ────────────────────────────────
  await page.fill('#emdT_knopf', 'Jetzt anschauen');
  await page.click('#emdT_text'); await page.keyboard.press('End');
  await page.click('#emdPlatzhalter button:has-text("{Kunde}")');
  await warte(page);
  const v3 = await vorschau(page);
  check('Ein Klick auf einen Platzhalter fuegt ihn in den Text ein', (await page.inputValue('#emdT_text')).includes('{Kunde}'));
  check('und die Vorschau zeigt den eingesetzten Wert', /Muster AG/.test(v3.text));
  check('KRITISCH: eine eigene Knopfbeschriftung behaelt den Link',
    v3.knopfText === 'Jetzt anschauen' && /token=muster/.test(v3.knopfHref || ''));
  const platzOfferte = await page.evaluate(() => [...document.querySelectorAll('#emdPlatzhalter button')].map(b => b.textContent));
  await page.selectOption('#emdArt', 'code'); await warte(page);
  const platzCode = await page.evaluate(() => [...document.querySelectorAll('#emdPlatzhalter button')].map(b => b.textContent));
  check('Jede Mail zeigt ihre eigenen Platzhalter ({Code} nur beim Code)',
    platzCode.includes('{Code}') && !platzOfferte.includes('{Code}'));
  check('Die Code-Mail hat keinen Knopf und kein Feld dafuer', await page.evaluate(() => $('emdKnopfFeld').hidden));
  const v4 = await vorschau(page);
  check('Die Code-Mail zeigt den Code in der Vorschau', /483 920/.test(v4.text));

  // ── F) Speichern ───────────────────────────────────────────────────────
  await page.selectOption('#emdArt', 'offerte'); await warte(page);
  await page.click('#emdSpeichern'); await page.waitForTimeout(400);
  const gesp = posts.filter(p => p.aktion === 'speichern');
  check('Speichern schickt die ganze Gestaltung einmal', gesp.length === 1 && gesp[0].gestaltung.farben.knopf === '#FFE680');
  check('Danach steht "gespeichert" und der Knopf ist wieder aus',
    await page.evaluate(() => $('emdSpeichern').disabled && /gespeichert/i.test($('emdStand').textContent)));

  // Ein unbekannter Platzhalter: der Server lehnt ab, die Seite sagt warum.
  await page.fill('#emdT_text', 'Hallo {Kundennummer}'); await warte(page);
  await page.click('#emdSpeichern'); await page.waitForTimeout(400);
  check('Ein unbekannter Platzhalter wird nicht gespeichert, und die Seite nennt ihn',
    /Kundennummer/.test(await page.textContent('#emdStand')) && !(await page.evaluate(() => $('emdSpeichern').disabled)));

  // Standardtext stellt die Vorgabe wieder her.
  await page.click('#emdStandardtext'); await warte(page);
  check('"Standardtext" stellt den Text der Vorgabe wieder her',
    (await page.inputValue('#emdT_text')) === GRUND.vorgabe.texte.offerte.text);

  // Testmail
  await page.click('#emdTest'); await page.waitForTimeout(300);
  const tm = posts.filter(p => p.aktion === 'testmail');
  check('Testmail geht mit dem Stand, den man sieht, und die Seite sagt wohin',
    tm.length === 1 && tm[0].art === 'offerte' && /ich@beispiel\.ch/.test(await page.textContent('#emdStand')));
  check(`Keine JavaScript-Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}

// ── G) Logo: an, aus, Ausrichtung, fehlt, WebP ────────────────────────────
{
  const { browser, page, fehler } = await starte();
  await page.click('#emdLogoAusr button[data-w="rechts"]'); await warte(page);
  check('Die Ausrichtung des Logos kommt in der Vorschau an', (await vorschau(page)).imgAusr === 'right');
  await page.uncheck('#emdLogoAn'); await warte(page);
  check('Logo aus: kein Bild in der Vorschau', !(await vorschau(page)).img);
  await page.uncheck('#emdHinweis'); await warte(page);
  check('Hinweis auf GuardOpS laesst sich abschalten', !/Versendet mit/.test((await vorschau(page)).text));
  check(`ohne Fehler (${fehler.join(' | ')})`, fehler.length === 0);
  await browser.close();
}
{
  const { browser, page } = await starte({ betrieb: { logo_png: '' , email: '' } });
  const h = await page.textContent('#emdLogoHinweis');
  check('Ohne Logo sagt die Seite, wo man es hochlaedt -- statt einer leeren Stelle', /kein logo/i.test(h) && /betrieb/i.test(h));
  check('Ohne E-Mail des Betriebs warnt die Seite, dass Antworten verloren gehen',
    await page.evaluate(() => $('emdAntwort').classList.contains('warn') && /keine e-mail/i.test($('emdAntwort').textContent)));
  await browser.close();
}
{
  const { browser, page } = await starte({ betrieb: { logo_png: '', logo_webp: true } });
  check('Ein WebP-Logo heisst nicht "kein Logo": eigener Satz, dass Mailprogramme es nicht zeigen',
    /webp/i.test(await page.textContent('#emdLogoHinweis')) && !/noch kein logo/i.test(await page.textContent('#emdLogoHinweis')));
  await browser.close();
}

// ── H) Ohne Recht, ohne Einrichtung ───────────────────────────────────────
{
  const { browser, page, posts } = await starte({ darf: false });
  check('Ohne Schreibrecht: ansehen ja, aendern nein',
    await page.evaluate(() => $('emdT_text').disabled && $('emdF_primaer').disabled && $('emdSpeichern').hidden && $('emdTest').hidden));
  check('und die Seite sagt warum', /ändern darf/i.test(await page.textContent('#emdStand')));
  check('Die Vorschau gibt es trotzdem', (await vorschau(page)).img);
  check('Nichts wird gespeichert', !posts.some(p => p.aktion === 'speichern'));
  await browser.close();
}
{
  const { browser, page } = await starte({ unbekannt: true });
  await page.fill('#emdT_knopf', 'Anders'); await warte(page);
  check('Fehlt die Einrichtung: Speichern bleibt aus, und die Seite sagt warum',
    await page.evaluate(() => $('emdSpeichern').disabled && /einrichtung/i.test($('emdStand').textContent)));
  check('die Vorschau folgt trotzdem', (await vorschau(page)).knopfText === 'Anders');
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
