// Couche de persistance — Supabase (PostgreSQL managé). Remplace l'ancienne
// version JSON locale (lowdb) ; c'est le SEUL fichier que la migration a dû
// réécrire — flows.js, scheduler.js et server.js n'utilisent que les fonctions
// exportées ci-dessous, jamais de requête SQL directe.
const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

if (!config.supabaseUrl || !config.supabaseServiceKey) {
  console.warn("[db] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant — voir .env.example");
}

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

function orThrow(error, contexte) {
  if (error) {
    console.error(`[db] erreur ${contexte}:`, error.message);
    throw error;
  }
}

// ---------- Clients ----------
async function findClientByPhone(telephone) {
  const { data, error } = await supabase.from("clients").select("*").eq("telephone", telephone).maybeSingle();
  orThrow(error, "findClientByPhone");
  return data;
}
async function getClientById(id) {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  orThrow(error, "getClientById");
  return data;
}
async function upsertClient(telephone, patch) {
  const existing = await findClientByPhone(telephone);
  if (existing) {
    const { data, error } = await supabase.from("clients").update(patch).eq("telephone", telephone).select().single();
    orThrow(error, "upsertClient(update)");
    return data;
  }
  const { data, error } = await supabase
    .from("clients")
    .insert({ telephone, ...patch })
    .select()
    .single();
  orThrow(error, "upsertClient(insert)");
  return data;
}

// ---------- Interventions ----------
async function createIntervention(payload) {
  const { data, error } = await supabase
    .from("interventions")
    .insert({
      client_id: payload.client_id,
      type_service: payload.type_service,
      type_probleme: payload.type_probleme,
      position_gps_lat: payload.position_gps?.lat,
      position_gps_lng: payload.position_gps?.lng,
      quartier: payload.quartier,
      photos: payload.photos || [],
      montant: payload.montant,
      statut: payload.statut || "reçue",
    })
    .select()
    .single();
  orThrow(error, "createIntervention");
  return mapIntervention(data);
}
async function updateIntervention(id, patch) {
  const dbPatch = { ...patch };
  if (["terminée", "payée", "annulée"].includes(patch.statut)) dbPatch.date_cloture = new Date().toISOString();
  const { data, error } = await supabase.from("interventions").update(dbPatch).eq("id", id).select().single();
  orThrow(error, "updateIntervention");
  return mapIntervention(data);
}
async function getActiveInterventionForClient(clientId) {
  const TERMINAUX = new Set(["terminée", "payée", "annulée"]);
  const { data, error } = await supabase
    .from("interventions")
    .select("*")
    .eq("client_id", clientId)
    .order("date_creation", { ascending: false })
    .limit(5);
  orThrow(error, "getActiveInterventionForClient");
  const active = (data || []).find((row) => !TERMINAUX.has(row.statut));
  return mapIntervention(active);
}
async function getInterventionById(id) {
  const { data, error } = await supabase.from("interventions").select("*").eq("id", id).maybeSingle();
  orThrow(error, "getInterventionById");
  return mapIntervention(data);
}
function mapIntervention(row) {
  if (!row) return row;
  return { ...row, position_gps: row.position_gps_lat != null ? { lat: row.position_gps_lat, lng: row.position_gps_lng } : null };
}

// ---------- Techniciens ----------
async function listAvailableTechniciens() {
  const { data, error } = await supabase.from("techniciens").select("*").eq("statut_dispo", "disponible");
  orThrow(error, "listAvailableTechniciens");
  return (data || []).map(mapTechnicien);
}
async function getTechnicien(id) {
  const { data, error } = await supabase.from("techniciens").select("*").eq("id", id).maybeSingle();
  orThrow(error, "getTechnicien");
  return mapTechnicien(data);
}
async function setTechnicienStatut(id, statut_dispo) {
  const { error } = await supabase.from("techniciens").update({ statut_dispo }).eq("id", id);
  orThrow(error, "setTechnicienStatut");
}
async function updateTechnicienNote(id, nouvelleNote) {
  const { error } = await supabase.from("techniciens").update({ note_moyenne: nouvelleNote }).eq("id", id);
  orThrow(error, "updateTechnicienNote");
}
function mapTechnicien(row) {
  if (!row) return row;
  return { ...row, position_gps_live: { lat: row.position_gps_lat, lng: row.position_gps_lng } };
}

// ---------- Paiements ----------
async function createPaiement(payload) {
  const { data, error } = await supabase.from("paiements").insert(payload).select().single();
  orThrow(error, "createPaiement");
  return data;
}
async function updatePaiement(id, patch) {
  const { data, error } = await supabase.from("paiements").update(patch).eq("id", id).select().single();
  orThrow(error, "updatePaiement");
  return data;
}

// ---------- Abonnements ----------
async function getActiveSubscription(clientId) {
  const { data, error } = await supabase
    .from("abonnements")
    .select("*")
    .eq("client_id", clientId)
    .gt("date_fin", new Date().toISOString())
    .maybeSingle();
  orThrow(error, "getActiveSubscription");
  return data;
}
async function createSubscription(clientId, moisValidite = 5) {
  const dateFin = new Date();
  dateFin.setMonth(dateFin.getMonth() + moisValidite);
  const { data, error } = await supabase
    .from("abonnements")
    .insert({ client_id: clientId, date_fin: dateFin.toISOString() })
    .select()
    .single();
  orThrow(error, "createSubscription");
  await supabase.from("clients").update({ abonnement_actif: true }).eq("id", clientId);
  return data;
}

// ---------- Signalements zones (carte intelligente) ----------
async function addSignalementZone(payload) {
  const { data, error } = await supabase
    .from("signalements_zones")
    .insert({
      position_gps_lat: payload.position_gps?.lat,
      position_gps_lng: payload.position_gps?.lng,
      niveau_eau_estime: payload.niveau_eau_estime,
      source: payload.source,
      photo_url: payload.photo_url,
    })
    .select()
    .single();
  orThrow(error, "addSignalementZone");
  return data;
}

// ---------- Sessions (machine à états par numéro) ----------
async function getSession(telephone) {
  const { data, error } = await supabase.from("sessions").select("*").eq("telephone", telephone).maybeSingle();
  orThrow(error, "getSession");
  if (data) return data;
  const fresh = { telephone, etape: "menu_principal", contexte: {} };
  const { data: created, error: insErr } = await supabase.from("sessions").insert(fresh).select().single();
  orThrow(insErr, "getSession(create)");
  return created;
}
async function setSession(telephone, patch) {
  const dbPatch = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("sessions")
    .upsert({ telephone, ...dbPatch }, { onConflict: "telephone" })
    .select()
    .single();
  orThrow(error, "setSession");
  return data;
}
async function resetSession(telephone) {
  return setSession(telephone, { etape: "menu_principal", contexte: {} });
}

// ---------- CRM / scheduler (section 5.8) ----------
async function listClientsForMarketing() {
  const { data, error } = await supabase.from("clients").select("*").eq("opt_out_marketing", false);
  orThrow(error, "listClientsForMarketing");
  return data || [];
}
async function listInterventionsAPaieePourParrainage() {
  const { data, error } = await supabase
    .from("interventions")
    .select("*")
    .eq("statut", "payée")
    .eq("parrainage_envoye", false);
  orThrow(error, "listInterventionsAPaieePourParrainage");
  return (data || []).map(mapIntervention);
}
async function marquerParrainageEnvoye(id) {
  await supabase.from("interventions").update({ parrainage_envoye: true }).eq("id", id);
}
async function listClientsInactifsDepuis(dateLimiteIso) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("opt_out_marketing", false)
    .eq("reactivation_envoyee", false)
    .lt("date_creation", dateLimiteIso);
  orThrow(error, "listClientsInactifsDepuis");
  return data || [];
}
async function marquerReactivationEnvoyee(clientId) {
  await supabase.from("clients").update({ reactivation_envoyee: true }).eq("id", clientId);
}

module.exports = {
  findClientByPhone,
  getClientById,
  upsertClient,
  createIntervention,
  updateIntervention,
  getActiveInterventionForClient,
  getInterventionById,
  listAvailableTechniciens,
  getTechnicien,
  setTechnicienStatut,
  updateTechnicienNote,
  createPaiement,
  updatePaiement,
  getActiveSubscription,
  createSubscription,
  addSignalementZone,
  getSession,
  setSession,
  resetSession,
  listClientsForMarketing,
  listInterventionsAPaieePourParrainage,
  marquerParrainageEnvoye,
  listClientsInactifsDepuis,
  marquerReactivationEnvoyee,
};
