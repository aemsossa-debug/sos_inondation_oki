const { listAvailableTechniciens } = require("./db");

// Distance à vol d'oiseau en kilomètres entre deux points GPS.
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Retourne le technicien disponible le plus proche de la position du sinistre,
// ou null s'il n'y en a aucun (dans ce cas, la conversation bascule sur un
// message "toutes les équipes sont mobilisées" plutôt que de planter).
function findNearestTechnicien(positionGps) {
  const disponibles = listAvailableTechniciens();
  if (disponibles.length === 0) return null;
  if (!positionGps) return disponibles[0];

  let best = null;
  let bestDist = Infinity;
  for (const t of disponibles) {
    const d = haversineKm(positionGps, t.position_gps_live);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  // ~25 km/h en moyenne en zone inondée / circulation dense de Cotonou
  const etaMinutes = Math.max(8, Math.round((bestDist / 25) * 60));
  return { technicien: best, distanceKm: Math.round(bestDist * 10) / 10, etaMinutes };
}

module.exports = { haversineKm, findNearestTechnicien };
