// Persistenz über das zentrale ToolsUebersicht-Login-Gateway.
// Gleiches Gateway-Muster wie E:\busplan\db.js, erweitert um die Datei-Aktionen
// dav-file-put / dav-file-get / dav-file-delete (Vorbild E:\vereinskalender\db.js).
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const GATEWAY_APP_ID = "ablaufplan";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message || "Daten wurden zwischenzeitlich von einem anderen Gerät geändert");
    this.name = "ConflictError";
  }
}

// ETag des zuletzt geladenen/geschriebenen Stands. Wird bei dav-save mitgeschickt,
// damit der Worker Konflikte (anderes Gerät hat inzwischen gespeichert) erkennt.
let gatewayRev = null;

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) throw new Error("Kein Bearbeiten-Recht für dieses Tool.");
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) {
    let detail = "";
    try { const b = await resp.json(); if (b && b.error) detail = ": " + b.error; } catch (_) {}
    throw new Error(`Gateway-Fehler (HTTP ${resp.status})${detail}`);
  }
  return resp.json();
}

// Das "me" aus der letzten dav-load-Antwort. Der Worker legt es bei, weil er
// nutzer.json und die Rechte-Datei für diesen Request ohnehin gelesen hat --
// der erste fetchMe() nach dem Laden kommt damit ohne eigenen Roundtrip aus.
let gatewayMe = null;

async function gatewayLoad() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  gatewayMe = (body.me && typeof body.me === "object") ? body.me : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}

async function gatewaySave(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Letzter Rettungsversuch beim Verlassen der Seite. Ein normaler fetch wird beim
// Entladen abgebrochen -- mit keepalive überlebt der Request das Schließen des
// Tabs. Bewusst MIT gatewayRev: lieber ein wirkungsloser 409 als stiller fremder
// Datenverlust. Grenze: Browser erlauben für keepalive nur 64 KB Body.
const KEEPALIVE_MAX_BYTES = 64 * 1024;

function gatewaySaveBeacon(dataObj) {
  const token = getSessionToken();
  if (!token) return false;
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = JSON.stringify(payload);
  if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return false;
  try {
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body,
      keepalive: true
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Liefert {username, isAdmin, groupIds, vorname, nachname, mannschaften, canEdit, canAdmin}.
async function fetchMe() {
  if (gatewayMe) { const me = gatewayMe; gatewayMe = null; return me; }
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
}

// Mannschaftsnamen für die Ankreuzliste UND die Trainer dahinter.
//
// ⚠️ Seit 2026-08-12 ist die ZENTRALE MANNSCHAFTSLISTE die Quelle
// (`mannschaften-load` im Gateway), nicht mehr die frei getippten Felder in den
// Trainerprofilen. Genau daher kam das Durcheinander in der Ankreuzliste: dort
// standen „B1", „B-Junioren", „B-Junioren 2 (K)" und „Zeugwart" nebeneinander,
// weil jeder Trainer seine eigene Schreibweise hinterlegt hatte.
//
// Die Liste liefert die Trainer gleich mit — ein Aufruf statt zweier, und die
// Namen kommen aus der Zuordnung an der Mannschaft statt aus einem Textvergleich.
//
// ⚠️ RÜCKFALL auf den alten Weg, solange die Liste leer ist: sie wird erst
// aufgebaut, und bis dahin darf die Ankreuzliste nicht leer sein. Der Rückfall
// verschwindet von selbst, sobald die erste Mannschaft angelegt ist — er wird
// bewusst NICHT gemischt, sonst stünde das alte Durcheinander wieder daneben.
//
// ⚠️ Die Trainernamen bleiben im angemeldeten Bereich. Sie werden weder in
// `ablaufplan.json` gespeichert noch über den Link ohne Anmeldung ausgeliefert —
// der Worker kennt sie in `ablaufplan-oeffentlich` gar nicht, weil sie nie in
// den Datensatz wandern. Wer das ändert, ändert den Datenschutz-Absatz auf
// `plan.html` mit.
//
// ⚠️ Wirft nicht nach oben durch: ohne Liste bleibt die Ankreuzliste leer, das
// freie Feld und der Text-Übernehmer funktionieren trotzdem.
async function fetchMannschaftsInfo() {
  try {
    const body = await gatewayRequest({ action: "mannschaften-load" });
    const teams = (body && Array.isArray(body.teams)) ? body.teams : [];
    // Archivierte sind aufgelöste Mannschaften: alte Abläufe zeigen sie weiter
    // an, aber für einen NEUEN Punkt soll sie niemand mehr ankreuzen können.
    const aktiv = teams.filter((t) => t && t.kurz && !t.archiviert);
    if (aktiv.length) {
      const trainer = new Map();
      aktiv.forEach((t) => {
        const k = normMannschaft(t.kurz);
        if (!k) return;
        trainer.set(k, (t.trainer || [])
          .map((p) => ({ name: String(p.name || p.username || ""), username: String(p.username || "") }))
          .filter((p) => p.name)
          .sort((a, b) => a.name.localeCompare(b.name, "de")));
      });
      // Reihenfolge kommt aus dem Gateway (Herren, dann A bis G, dann Nummer)
      // und wird hier bewusst NICHT neu sortiert — alphabetisch stünde E1 vor D1.
      return { namen: aktiv.map((t) => t.kurz), trainer, ausListe: true };
    }
    return await fetchMannschaftsInfoAusProfilen();
  } catch (e) {
    console.warn("Mannschaftsliste nicht ladbar", e);
    try {
      return await fetchMannschaftsInfoAusProfilen();
    } catch (_) {
      return { namen: [], trainer: new Map(), ausListe: false };
    }
  }
}

// Der Weg von vor dem 2026-08-12. Bleibt als Rückfallebene, bis die zentrale
// Liste befüllt ist; danach läuft er nie wieder an.
async function fetchMannschaftsInfoAusProfilen() {
  const body = await gatewayRequest({ action: "list-trainer-profiles" });
  const namen = new Map();   // normalisiert -> Anzeigename
  const trainer = new Map(); // normalisiert -> [{name, username}]
  ((body && body.profiles) || []).forEach((p) => {
    const anzeige = [p.vorname, p.nachname].filter(Boolean).join(" ").trim() || String(p.username || "");
    (p.mannschaften || []).forEach((m) => {
      const roh = String(m || "").trim();
      const k = normMannschaft(roh);
      if (!roh || !k) return;
      if (!namen.has(k)) namen.set(k, roh);
      if (!trainer.has(k)) trainer.set(k, []);
      if (anzeige) trainer.get(k).push({ name: anzeige, username: String(p.username || "") });
    });
  });
  trainer.forEach((liste) => liste.sort((a, b) => a.name.localeCompare(b.name, "de")));
  return {
    namen: Array.from(namen.values()).sort((a, b) => a.localeCompare(b, "de", { numeric: true })),
    trainer,
    ausListe: false
  };
}

// ---------- Anhänge ----------
//
// ⚠️ Anhänge liegen NICHT im JSON, sondern als eigene Datei neben der JSON-Datei
// (<jsonDir>/dateien/<uuid>). Im Dokument stehen nur die Metadaten. Ein
// base64-Blob in einer Datei, die bei jedem Speichern vollständig übertragen
// wird, wäre der sichere Weg in eine unbedienbare App.

function neueDateiId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const komma = res.indexOf(",");
      resolve(komma >= 0 ? res.slice(komma + 1) : res);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(file);
  });
}

async function gatewayPutFile(file) {
  const id = neueDateiId();
  const dataBase64 = await fileToBase64(file);
  await gatewayRequest({
    action: "dav-file-put",
    app: GATEWAY_APP_ID,
    id,
    name: file.name,
    contentType: file.type || "application/octet-stream",
    dataBase64
  });
  return { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}

// ⚠️ Der Blob-Typ kommt aus den gespeicherten Metadaten, NICHT aus dem
// Content-Type der Antwort — bei Dateien ohne Endung liefert Nextcloud
// application/octet-stream und der Browser böte nur einen Download an.
async function gatewayFetchFileBlob(id, mime) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "dav-file-get", app: GATEWAY_APP_ID, id })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error("Datei nicht abrufbar (HTTP " + resp.status + ")");
  const roh = await resp.blob();
  return mime ? new Blob([roh], { type: mime }) : roh;
}

// best-effort: ein fehlgeschlagenes Aufräumen darf das Löschen nie blockieren.
async function gatewayDeleteFile(id) {
  try {
    await gatewayRequest({ action: "dav-file-delete", app: GATEWAY_APP_ID, id });
  } catch (e) {
    console.warn("Datei-Löschen fehlgeschlagen für", id, e);
  }
}
