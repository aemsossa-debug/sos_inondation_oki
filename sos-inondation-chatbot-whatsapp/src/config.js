require("dotenv").config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  return v;
}

module.exports = {
  port: process.env.PORT || 3000,

  // WhatsApp Cloud API (Meta) — voir README section "Obtenir ces valeurs"
  waToken: required("WHATSAPP_TOKEN", ""),
  waPhoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID", ""),
  waVerifyToken: required("WHATSAPP_VERIFY_TOKEN", "sos-inondation-verify"),
  waApiVersion: required("WHATSAPP_API_VERSION", "v20.0"),
  appSecret: required("WHATSAPP_APP_SECRET", ""), // pour vérifier la signature des webhooks (recommandé en prod)

  // Entreprise
  businessName: "SOS INONDATION",
  serviceZones: ["Cotonou", "Abomey-Calavi"],

  // Divers
  publicBaseUrl: required("PUBLIC_BASE_URL", "http://localhost:3000"), // utilisé pour générer les liens de reçus
  dbPath: required("DB_PATH", "./data/db.json"),
};
