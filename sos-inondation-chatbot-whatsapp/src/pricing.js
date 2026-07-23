// Grille tarifaire — à ajuster librement, c'est la seule source de vérité
// utilisée à la fois par le devis rapide et par l'estimation en urgence.
const SERVICES = [
  {
    id: "pompage",
    label: "Pompage eau + évacuation",
    priceMin: 25000,
    priceMax: 80000,
    delai: "2h intervention",
  },
  {
    id: "nettoyage",
    label: "Nettoyage & désinfection maison",
    priceMin: 30000,
    priceMax: 100000,
    delai: "Jour même",
  },
  {
    id: "demenagement",
    label: "Déménagement d'urgence meubles",
    priceMin: 20000,
    priceMax: 60000,
    delai: "Immédiat",
  },
  {
    id: "debouchage",
    label: "Débouchage canalisations bouchées",
    priceMin: 15000,
    priceMax: 40000,
    delai: "1h",
  },
  {
    id: "electrique",
    label: "Sécurisation électrique d'urgence",
    priceMin: 20000,
    priceMax: 50000,
    delai: "Immédiat",
  },
];

const PACK_SECURITE = {
  label: "Pack Sécurité Saison des Pluies",
  priceMin: 15000,
  priceMax: 30000,
  avantages: [
    "Intervention prioritaire garantie",
    "-20% sur toutes les interventions",
    "Audit gratuit de vulnérabilité",
    "Ligne dédiée 24h/24",
  ],
};

function formatFcfa(n) {
  return n.toLocaleString("fr-FR").replace(/,/g, " ") + " FCFA";
}

function formatRange(min, max) {
  return `${formatFcfa(min)} à ${formatFcfa(max)}`;
}

// Estimation utilisée dans la branche "urgence" à partir du type de sinistre choisi (1-4)
const URGENCE_TYPE_TO_SERVICE = {
  "1": "pompage", // Maison inondée
  "2": "debouchage", // Canalisation bouchée
  "3": "electrique", // Risque électrique
  "4": "pompage", // Autre -> estimation par défaut, affinée par un technicien
};

module.exports = { SERVICES, PACK_SECURITE, formatFcfa, formatRange, URGENCE_TYPE_TO_SERVICE };
