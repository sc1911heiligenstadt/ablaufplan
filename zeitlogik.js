// Reine Rechenlogik des Ablaufplans — Zeiten, Sortierung, Textübernahme,
// Verschieben, Betroffenheit.
//
// ⚠️ Bewusst OHNE jeden DOM-Zugriff. Dadurch lässt sich die Datei in Node laden
// und einzeln prüfen (gleiches Muster wie E:\schulsport\termine.js). Wer hier
// document oder window anfasst, macht genau das kaputt.

// ---------- Zeit ----------

// "09:00" -> 540. Liefert null, wenn nichts Brauchbares dasteht.
function minutenAusZeit(zeit) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(zeit || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// 540 -> "09:00". Werte außerhalb eines Tages werden NICHT abgeschnitten,
// sondern vom Aufrufer über den Tagesversatz abgefangen (siehe verschiebeAb).
function zeitAusMinuten(minuten) {
  const m = ((minuten % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return String(h).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

// ---------- Datum ----------
//
// ⚠️ Gerechnet wird mit getFullYear/getMonth/getDate, NIE mit
// toISOString().slice(0,10): in deutscher Sommerzeit liefert toISOString() vor
// 02:00 Uhr den Vortag. Gleiche Falle wie in E:\schulsport\termine.js.

function isoAusDatum(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function datumAusIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Fängt den 31.02. ab: der Konstruktor rollt still weiter.
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

// Verschiebt ein ISO-Datum um ganze Tage.
function isoPlusTage(iso, tage) {
  const d = datumAusIso(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + tage);
  return isoAusDatum(d);
}

// Ganze Tage zwischen zwei ISO-Daten (b - a).
function tageZwischen(a, b) {
  const da = datumAusIso(a);
  const db = datumAusIso(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
}

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function datumText(iso) {
  const d = datumAusIso(iso);
  if (!d) return String(iso || "");
  return WOCHENTAGE[d.getDay()] + ", " +
    String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
}

function datumKurz(iso) {
  const d = datumAusIso(iso);
  if (!d) return String(iso || "");
  return WOCHENTAGE[d.getDay()].slice(0, 2) + " " +
    String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + ".";
}

// ---------- Mannschaften ----------

// Vergleichsform für Mannschaftsnamen. "D1", "D1-Jugend" und "d 1 Jugend" sind
// dieselbe Mannschaft — die Namen kommen aus den frei getippten Trainerprofilen
// und aus einer eingefügten Textliste, die stimmen nie zeichengenau überein.
function normMannschaft(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/(jugend|junioren|juniorinnen|mannschaft)$/, "");
}

// Betrifft dieser Punkt eine der eigenen Mannschaften?
// Ein Punkt ohne Mannschaft (nur Freitext-Wer) betrifft niemanden persönlich —
// er wird angezeigt, aber nie als "meiner" markiert.
function punktBetrifft(punkt, meineMannschaften) {
  const meine = (meineMannschaften || []).map(normMannschaft).filter(Boolean);
  if (!meine.length) return false;
  const seine = ((punkt && punkt.mannschaften) || []).map(normMannschaft).filter(Boolean);
  return seine.some((m) => meine.indexOf(m) >= 0);
}

// ---------- Sortierung ----------

// Sortierschlüssel eines Punktes: Datum, dann Startzeit. Punkte ohne Zeit
// stehen am Anfang des Tages, nicht irgendwo dazwischen.
function punktSortKey(punkt) {
  const min = minutenAusZeit(punkt && punkt.startZeit);
  return String((punkt && punkt.datum) || "") + "T" +
    String(min === null ? -1 : min).padStart(5, "0");
}

function sortierePunkte(punkte) {
  return (punkte || []).slice().sort((a, b) => {
    const ka = punktSortKey(a);
    const kb = punktSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

// ---------- Verschieben ----------
//
// Der Knopf am Tag selbst: ein Punkt und alles danach rutscht um X Minuten.
// Gerechnet wird auf der SORTIERTEN Reihenfolge, nicht auf der Speicher-
// reihenfolge — sonst hinge es davon ab, in welcher Folge die Punkte angelegt
// wurden. Läuft eine Zeit über Mitternacht, wandert der Punkt auf den nächsten
// Tag statt bei 23:59 stehenzubleiben.
function verschiebeAb(punkte, abId, minuten) {
  const sortiert = sortierePunkte(punkte);
  const start = sortiert.findIndex((p) => p.id === abId);
  if (start < 0 || !minuten) return punkte.slice();

  const betroffen = new Set(sortiert.slice(start).map((p) => p.id));

  return punkte.map((p) => {
    if (!betroffen.has(p.id)) return p;
    const startMin = minutenAusZeit(p.startZeit);
    if (startMin === null) return p; // ohne Startzeit gibt es nichts zu schieben

    const neuStart = startMin + minuten;
    const tagesVersatz = Math.floor(neuStart / 1440);
    const neu = Object.assign({}, p, {
      datum: tagesVersatz ? isoPlusTage(p.datum, tagesVersatz) : p.datum,
      startZeit: zeitAusMinuten(neuStart)
    });

    const endMin = minutenAusZeit(p.endZeit);
    if (endMin !== null) {
      // Die Endzeit wandert um denselben Betrag, damit die Dauer erhalten
      // bleibt. Ein Punkt, dessen Ende vor dem Start lag (über Mitternacht
      // getippt), bleibt genauso schief wie vorher — hier wird nichts geheilt.
      neu.endZeit = zeitAusMinuten(endMin + minuten);
    }
    return neu;
  });
}

// ---------- Zeitraum eines Ablaufs ----------

// Der Zeitraum im Kopf ist die Vorgabe; Punkte dürfen aber darüber
// hinauswandern (Verschieben über Mitternacht, eingefügter Text mit Datums-
// zeilen). Diese Funktion zieht den Kopf nach — sie schneidet nie etwas ab.
function synchronisiereZeitraum(ablauf) {
  const daten = (ablauf.punkte || []).map((p) => p.datum).filter(Boolean).sort();
  if (!daten.length) return ablauf;
  const frueh = daten[0];
  const spaet = daten[daten.length - 1];
  if (!ablauf.startDatum || frueh < ablauf.startDatum) ablauf.startDatum = frueh;
  if (!ablauf.endDatum || spaet > ablauf.endDatum) ablauf.endDatum = spaet;
  return ablauf;
}

// Ein Ablauf gehört ins Archiv, sobald sein LETZTER Tag vorbei ist.
// Der Tag selbst zählt bis zum Schluss dazu — am Medientag um 14 Uhr soll der
// Medientag nicht plötzlich unter "Früher" liegen.
function istVergangen(ablauf, heuteIso) {
  const ende = ablauf.endDatum || ablauf.startDatum || "";
  if (!ende) return false;
  return ende < heuteIso;
}

// ---------- Was läuft gerade / was kommt als Nächstes ----------

// Index des ersten Punktes, der noch nicht begonnen hat (bezogen auf die
// sortierte Liste). Alles davor ist gelaufen. Liefert die Länge der Liste,
// wenn alles vorbei ist.
function naechsterPunktIndex(sortiertePunkte, jetztIso, jetztMinuten) {
  for (let i = 0; i < sortiertePunkte.length; i++) {
    const p = sortiertePunkte[i];
    const datum = p.datum || "";
    if (datum > jetztIso) return i;
    if (datum < jetztIso) continue;
    const min = minutenAusZeit(p.startZeit);
    if (min === null || min >= jetztMinuten) return i;
  }
  return sortiertePunkte.length;
}

// Läuft dieser Punkt gerade? Ohne Endzeit gilt er als laufend, solange kein
// späterer Punkt begonnen hat — das entscheidet der Aufrufer, hier wird nur
// das Fenster geprüft.
function punktLaeuft(punkt, jetztIso, jetztMinuten) {
  if ((punkt.datum || "") !== jetztIso) return false;
  const start = minutenAusZeit(punkt.startZeit);
  if (start === null) return false;
  const ende = minutenAusZeit(punkt.endZeit);
  if (ende === null) return false;
  return jetztMinuten >= start && jetztMinuten < ende;
}

// ---------- Text übernehmen ----------

// Unsichtbare Zeichen, die beim Kopieren aus WhatsApp, Word und Mail mitkommen.
// ⚠️ Michels Medientag-Liste enthält genau solche (Word-Joiner U+2060 vor
// einzelnen Uhrzeiten) — ohne dieses Putzen findet die Zeitsuche die Zeile nicht.
const UNSICHTBAR_RE = /[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g;

function putzeZeile(zeile) {
  return String(zeile || "")
    .replace(UNSICHTBAR_RE, "")
    .replace(/\u00A0/g, " ")
    .replace(/^[\s]*[-–—*•·]+\s*/, "") // Aufzählungsstrich
    .trim();
}

// Erkennt Mannschafts-Kürzel wie B1, D2, C, G — auch als Kette B1/B2/B3.
// Bewusst ein MUSTER und nicht nur die Liste aus den Trainerprofilen: dort
// steht vielleicht "B-Junioren", in der eingefügten Liste steht "B1". Was das
// Muster erkennt, wird übernommen; was in der Profilliste steht, ebenfalls.
const TEAM_TOKEN_RE = /^[A-G]\d{0,2}$/i;

function tokenIstMannschaft(token, bekannte) {
  if (TEAM_TOKEN_RE.test(token)) return true;
  const norm = normMannschaft(token);
  if (!norm) return false;
  return (bekannte || []).some((b) => normMannschaft(b) === norm);
}

// "B1/B2" -> ["B1","B2"] wenn ALLE Teile als Mannschaft durchgehen, sonst null.
function teileMannschaften(token, bekannte) {
  const teile = token.split("/").map((t) => t.trim()).filter(Boolean);
  if (!teile.length) return null;
  if (!teile.every((t) => tokenIstMannschaft(t, bekannte))) return null;
  return teile;
}

// Eine reine Datumszeile ("Samstag 16.08.", "16.08.2026", "2026-08-16") schaltet
// die folgenden Punkte auf einen anderen Tag um — dafür ist ein Trainingslager
// da. Liefert ISO oder null.
function parseDatumZeile(zeile, jahrFallback) {
  const t = zeile.replace(/^[A-Za-zÄÖÜäöüß]+,?\s*/, "").trim(); // führender Wochentag
  let m = /^(\d{4})-(\d{2})-(\d{2})\.?$/.exec(t);
  if (m) return datumAusIso(m[1] + "-" + m[2] + "-" + m[3]) ? m[1] + "-" + m[2] + "-" + m[3] : null;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/.exec(t);
  if (!m) return null;
  let jahr = m[3] ? Number(m[3]) : Number(jahrFallback);
  if (m[3] && m[3].length === 2) jahr = 2000 + Number(m[3]);
  if (!jahr) return null;
  const iso = jahr + "-" + String(Number(m[2])).padStart(2, "0") + "-" + String(Number(m[1])).padStart(2, "0");
  return datumAusIso(iso) ? iso : null;
}

// Sucht die Uhrzeit am Zeilenanfang. Erlaubt 9:00, 09:00, 9.00 und einen
// Bereich 09:00-09:30 (auch mit Gedankenstrich oder "bis").
// Liefert { startZeit, endZeit, rest } oder null.
function parseZeitAnfang(zeile) {
  const re = /^(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|—|bis)\s*(\d{1,2})[:.](\d{2}))?\s*(?:uhr\b)?\s*/i;
  const m = re.exec(zeile);
  if (!m) return null;
  const start = minutenAusZeit(m[1] + ":" + m[2]);
  if (start === null) return null;
  let ende = null;
  if (m[3]) {
    ende = minutenAusZeit(m[3] + ":" + m[4]);
    if (ende === null) return null;
  }
  return {
    startZeit: zeitAusMinuten(start),
    endZeit: ende === null ? "" : zeitAusMinuten(ende),
    rest: zeile.slice(m[0].length).trim()
  };
}

// Wandelt eingefügten Text in Punkte um.
//
// Vertrag: Was nicht sicher erkannt wird, landet unverändert im Feld "was" —
// es wird NIE geraten und NIE still verworfen. Zeilen ohne Uhrzeit, die auch
// kein Datum sind, kommen als Warnung zurück, damit der Aufrufer sie anzeigen
// kann statt sie zu schlucken.
//
// text            — die eingefügte Liste
// standardDatum   — ISO-Datum, dem die Punkte zugeordnet werden
// bekannteTeams   — Mannschaftsnamen aus den Trainerprofilen (nur Zusatz zum Muster)
// neueId          — Funktion, die eine frische Id liefert
function parseAblaufText(text, standardDatum, bekannteTeams, neueId) {
  const punkte = [];
  const warnungen = [];
  let datum = standardDatum;
  const jahrFallback = (standardDatum || "").slice(0, 4);

  String(text || "").split(/\r?\n/).forEach((roh, nr) => {
    const zeile = putzeZeile(roh);
    if (!zeile) return;

    const zeit = parseZeitAnfang(zeile);
    if (!zeit) {
      const neuesDatum = parseDatumZeile(zeile, jahrFallback);
      if (neuesDatum) { datum = neuesDatum; return; }
      warnungen.push({ zeile: nr + 1, text: zeile, grund: "keine Uhrzeit erkannt" });
      return;
    }

    let mannschaften = [];
    let was = zeit.rest;

    // Erstes Wort nach der Uhrzeit als Mannschaft prüfen. Trennende Satzzeichen
    // dahinter (Doppelpunkt, Komma, Gedankenstrich) gehören nicht zum Namen.
    const ersterRaum = was.search(/\s/);
    const kopf = (ersterRaum < 0 ? was : was.slice(0, ersterRaum)).replace(/[:,;–—-]+$/, "");
    const geteilt = kopf ? teileMannschaften(kopf, bekannteTeams) : null;
    if (geteilt) {
      mannschaften = geteilt;
      was = (ersterRaum < 0 ? "" : was.slice(ersterRaum)).trim().replace(/^[:,;–—-]+\s*/, "");
    }

    punkte.push({
      id: neueId(),
      datum,
      startZeit: zeit.startZeit,
      endZeit: zeit.endZeit,
      was,
      mannschaften,
      werFrei: "",
      ort: "",
      notiz: ""
    });
  });

  return { punkte, warnungen };
}

// Für Node-Prüfungen. Im Browser gibt es kein module — dann bleibt alles global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    minutenAusZeit, zeitAusMinuten,
    isoAusDatum, datumAusIso, isoPlusTage, tageZwischen, datumText, datumKurz,
    normMannschaft, punktBetrifft,
    punktSortKey, sortierePunkte,
    verschiebeAb, synchronisiereZeitraum, istVergangen,
    naechsterPunktIndex, punktLaeuft,
    putzeZeile, parseDatumZeile, parseZeitAnfang, parseAblaufText
  };
}
