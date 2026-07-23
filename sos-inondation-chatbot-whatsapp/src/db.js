// Couche de persistance. En Phase 1, un simple fichier JSON (via lowdb) suffit
// largement et coûte 0 FCFA. Pour migrer vers PostgreSQL en Phase 3, seule cette
// couche doit être réécrite — flows/ et whatsapp.js n'ont jamais besoin de changer.
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");

const dbPath = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const adapter = new FileSync(dbPath);
const db = low(adapter);

db.defaults({
  clients: [],
  interventions: [],
  techniciens: [],
  paiements: [],
  abonnements: [],
  signalements_zones: [],
  sessions: [],
}).write();

// Semis de techniciens de démonstration si la base est vide — à remplacer
// par votre équipe réelle depuis le dashboard opérateur.
if (db.get("techniciens").size().value() === 0) {
  db.get("techniciens")
    .push(
      {
        id: uid(),
        nom: "Cyriaque HOUNSA",
        telephone: "22997000001",
        position_gps_live: { lat: 6.3703, lng: 2.3912 }, // Akpakpa
        statut_dispo: "disponible",
        note_moyenne: 4.8,
        plaque: "AB-1234-RB",
      },
      {
        id: uid(),
        nom: "Fabrice AGOSSOU",
        telephone: "22997000002",
        position_gps_live: { lat: 6.3833, lng: 2.4333 }, // Cadjehoun
        statut_dispo: "disponible",
        note_moyenne: 4.6,
        plaque: "AB-5678-RB",
      },
      {
        id: uid(),
        nom: "Judicaël TOSSOU",
        telephone: "22997000003",
        position_gps_live: { lat: 6.4489, lng: 2.3559 }, // Abomey-Calavi
        statut_dispo: "disponible",
        note_moyenne: 4.9,
        plaque: "AB-9012-RB",
      }
    )
    .write();
}

function uid() {
  return crypto.randomUUID();
}

// ---------- Clients ----------
function findClientByPhone(telephone) {
  return db.get("clients").find({ telephone }).value();
}
function upsertClient(telephone, patch) {
  const existing = findClientByPhone(telephone);
  if (existing) {
    db.get("clients").find({ telephone }).assign(patch).write();
    return findClientByPhone(telephone);
  }
  const client = { id: uid(), telephone, abonnement_actif: false, date_creation: new Date().toISOString(), ...patch };
  db.get("clients").push(client).write();
  return client;
}

// ---------- Interventions ----------
function createIntervention(data) {
  const intervention = {
    id: uid(),
    statut: "reçue",
    date_creation: new Date().toISOString(),
    photos: [],
    ...data,
  };
  db.get("interventions").push(intervention).write();
  return intervention;
}
function updateIntervention(id, patch) {
  db.get("interventions").find({ id }).assign(patch).write();
  return db.get("interventions").find({ id }).value();
}
function getActiveInterventionForClient(clientId) {
  return db
    .get("interventions")
    .filter((i) => i.client_id === clientId && !["terminée", "payée", "annulée"].includes(i.statut))
    .sortBy("date_creation")
    .last()
    .value();
}
function getInterventionById(id) {
  return db.get("interventions").find({ id }).value();
}

// ---------- Techniciens ----------
function listAvailableTechniciens() {
  return db.get("techniciens").filter({ statut_dispo: "disponible" }).value();
}
function getTechnicien(id) {
  return db.get("techniciens").find({ id }).value();
}
function setTechnicienStatut(id, statut_dispo) {
  db.get("techniciens").find({ id }).assign({ statut_dispo }).write();
}

// ---------- Paiements ----------
function createPaiement(data) {
  const paiement = { id: uid(), statut: "en_attente", date_creation: new Date().toISOString(), ...data };
  db.get("paiements").push(paiement).write();
  return paiement;
}
function updatePaiement(id, patch) {
  db.get("paiements").find({ id }).assign(patch).write();
  return db.get("paiements").find({ id }).value();
}

// ---------- Abonnements ----------
function getActiveSubscription(clientId) {
  const now = new Date().toISOString();
  return db
    .get("abonnements")
    .find((a) => a.client_id === clientId && a.date_fin > now)
    .value();
}
function createSubscription(clientId, moisValidite = 5) {
  const now = new Date();
  const fin = new Date(now);
  fin.setMonth(fin.getMonth() + moisValidite);
  const sub = {
    id: uid(),
    client_id: clientId,
    type_pack: "Pack Sécurité Saison des Pluies",
    date_debut: now.toISOString(),
    date_fin: fin.toISOString(),
  };
  db.get("abonnements").push(sub).write();
  db.get("clients").find({ id: clientId }).assign({ abonnement_actif: true }).write();
  return sub;
}

// ---------- Signalements zones (carte intelligente) ----------
function addSignalementZone(data) {
  const s = { id: uid(), date: new Date().toISOString(), ...data };
  db.get("signalements_zones").push(s).write();
  return s;
}

// ---------- Sessions de conversation (machine à états par numéro) ----------
function getSession(telephone) {
  let s = db.get("sessions").find({ telephone }).value();
  if (!s) {
    s = { telephone, etape: "menu_principal", contexte: {} };
    db.get("sessions").push(s).write();
  }
  return s;
}
function setSession(telephone, patch) {
  const existing = db.get("sessions").find({ telephone }).value();
  if (existing) {
    db.get("sessions").find({ telephone }).assign(patch).write();
  } else {
    db.get("sessions").push({ telephone, etape: "menu_principal", contexte: {}, ...patch }).write();
  }
  return db.get("sessions").find({ telephone }).value();
}
function resetSession(telephone) {
  return setSession(telephone, { etape: "menu_principal", contexte: {} });
}

module.exports = {
  db,
  uid,
  findClientByPhone,
  upsertClient,
  createIntervention,
  updateIntervention,
  getActiveInterventionForClient,
  getInterventionById,
  listAvailableTechniciens,
  getTechnicien,
  setTechnicienStatut,
  createPaiement,
  updatePaiement,
  getActiveSubscription,
  createSubscription,
  addSignalementZone,
  getSession,
  setSession,
  resetSession,
};
