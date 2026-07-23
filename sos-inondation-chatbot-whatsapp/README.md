# SOS INONDATION — Chatbot WhatsApp

Chatbot WhatsApp officiel de SOS INONDATION (Cotonou & Abomey-Calavi, Bénin).
Implémente intégralement le script décrit en section 5 du dossier de conception :
menu principal, 5 branches de conversation, répartition automatique du
technicien le plus proche, paiement, reçus PDF, et automatisations CRM.

Ce projet est **prêt à déployer**. Il n'y a aucune ligne de code à écrire pour
le mettre en service — seulement les étapes de branchement ci-dessous.

---

## 1. Prérequis

- Node.js 18 ou plus (`node -v` pour vérifier)
- Un compte Meta Business (gratuit) : https://business.facebook.com
- Un numéro de téléphone dédié à WhatsApp Business (ne doit pas déjà être
  utilisé sur l'application WhatsApp classique)
- Un compte d'hébergement gratuit : [Render](https://render.com) ou
  [Railway](https://railway.app)

## 2. Installation locale

```bash
cd sos-inondation-whatsapp-bot
npm install
cp .env.example .env
```

## 3. Obtenir les valeurs de `.env`

### WHATSAPP_TOKEN et WHATSAPP_PHONE_NUMBER_ID

1. Allez sur https://developers.facebook.com/apps et cliquez **Créer une application** → type **Entreprise**.
2. Dans le tableau de bord de l'app, ajoutez le produit **WhatsApp**.
3. Meta crée automatiquement un numéro de test — dans l'onglet **WhatsApp → Démarrage rapide**, vous trouverez :
   - Un **jeton d'accès temporaire** (`WHATSAPP_TOKEN`, valable 24h — voir §7 pour le rendre permanent)
   - L'**identifiant du numéro de téléphone** (`WHATSAPP_PHONE_NUMBER_ID`)
4. Pour utiliser votre propre numéro (recommandé pour la mise en production) : **WhatsApp → Configuration de l'API → Ajouter un numéro de téléphone**, puis suivez la vérification par SMS/appel.

### WHATSAPP_APP_SECRET

Dans **Paramètres de l'application → Général**, champ **Clé secrète**.

### WHATSAPP_VERIFY_TOKEN

Vous l'inventez vous-même (n'importe quelle chaîne, ex. `sos-inondation-verify-2026`). Vous la re-saisirez à l'identique dans la console Meta au moment de connecter le webhook (§6).

## 4. Test en local

```bash
npm start
```

Le serveur démarre sur `http://localhost:3000`. Pour que Meta puisse lui
envoyer des messages, il doit être accessible publiquement — utilisez
[ngrok](https://ngrok.com) le temps des tests :

```bash
ngrok http 3000
```

Copiez l'URL `https://xxxx.ngrok-free.app` fournie et utilisez-la comme
`PUBLIC_BASE_URL` dans `.env`, puis redémarrez `npm start`.

## 5. Déploiement (Render — 30 à 45 minutes la première fois)

1. Poussez ce dossier sur un dépôt GitHub.
2. Sur [render.com](https://render.com) → **New → Web Service** → connectez le dépôt.
3. Render détecte Node.js automatiquement :
   - **Build command** : `npm install`
   - **Start command** : `npm start`
4. Onglet **Environment** : ajoutez toutes les variables de votre `.env` (sauf `PUBLIC_BASE_URL`, à renseigner après l'étape 5).
5. Déployez. Render vous donne une URL publique du type `https://sos-inondation-bot.onrender.com`. Reportez-la dans `PUBLIC_BASE_URL` (variable d'environnement Render), puis redéployez.

> Railway fonctionne de façon quasiment identique si vous préférez cette plateforme.

## 6. Connecter le webhook dans Meta

1. **WhatsApp → Configuration** → section **Webhook** → **Modifier**.
2. **URL de rappel** : `https://VOTRE-URL-DE-DEPLOIEMENT/webhook`
3. **Jeton de vérification** : la valeur exacte de `WHATSAPP_VERIFY_TOKEN`.
4. **Vérifier et enregistrer**.
5. Dans la liste des champs webhook, abonnez-vous au champ **messages**.

## 7. Rendre le jeton permanent (avant l'ouverture au public)

Le jeton fourni par défaut expire au bout de 24h. Pour un jeton permanent :
1. Créez un **utilisateur système** dans Meta Business Manager (**Paramètres de l'entreprise → Utilisateurs → Utilisateurs système**).
2. Attribuez-lui un accès à l'application WhatsApp.
3. Générez un jeton avec la permission `whatsapp_business_messaging` — sans date d'expiration.
4. Remplacez `WHATSAPP_TOKEN` par cette nouvelle valeur.

## 8. Test de bout en bout

Écrivez "Bonjour" depuis votre téléphone personnel au numéro WhatsApp Business
configuré. Vous devez recevoir le message d'accueil (demande de prénom si
c'est un numéro jamais vu), puis le menu principal. Parcourez chaque branche
une fois avant l'ouverture au public.

---

## ⚠️ Modèles de message requis pour les automatisations CRM

WhatsApp interdit l'envoi de messages texte libres à un client en dehors des
**24h suivant son dernier message**. Les 3 messages automatiques programmés
dans `src/scheduler.js` (rappel de saison, relance parrainage, réactivation)
sont envoyés à l'initiative de l'entreprise et tomberont donc, presque
toujours, hors de cette fenêtre.

**Avant d'activer ces automatisations en production**, il faut :
1. Créer les 3 modèles dans **WhatsApp → Modèles de message**, avec exactement le texte prévu (ils sont déjà rédigés dans `src/scheduler.js`, il suffit de les copier).
2. Attendre l'approbation de Meta (24 à 48h en général).
3. Remplacer les 3 appels `wa.sendText(...)` correspondants par un appel utilisant `type: "template"` (voir la fonction `sendText` dans `src/whatsapp.js` comme modèle à dupliquer — la documentation Meta officielle détaille le format exact).

Tant que cette étape n'est pas faite, le chatbot conversationnel (menu,
urgence, devis, abonnement, suivi, conseiller) fonctionne parfaitement : cette
contrainte ne concerne que les 3 messages sortants non sollicités.

## Intégrer le dashboard opérateur et l'app technicien

Ce serveur expose déjà le point d'entrée que ces deux interfaces doivent
appeler pour faire progresser une intervention :

```
POST /api/interventions/:id/statut
Body JSON : { "statut": "en_route" | "arrivee" | "terminee", "etaMinutes": 12, "montant": 45000 }
```

Chaque appel déclenche automatiquement le message WhatsApp correspondant au
client (voir section 5.3 du dossier de conception). Les prototypes fournis
utilisent aujourd'hui des données de démonstration ; les brancher sur cette
API est la prochaine étape naturelle pour un système entièrement connecté.

## Passer de la base JSON locale à PostgreSQL (Phase 3)

Toute la logique métier passe exclusivement par `src/db.js` — c'est le seul
fichier à réécrire pour migrer vers PostgreSQL/Supabase. Aucun autre fichier
(`flows.js`, `whatsapp.js`, `server.js`...) n'a besoin de changer, à condition
de conserver les mêmes noms de fonctions exportées.

## Structure du projet

```
src/
  server.js       API + webhook WhatsApp (point d'entrée : npm start)
  flows.js        Machine à états — script complet du chatbot (section 5)
  whatsapp.js     Client WhatsApp Cloud API (envoi/réception)
  db.js           Base de données (JSON local — voir migration ci-dessus)
  dispatch.js     Sélection du technicien le plus proche
  pricing.js      Grille tarifaire
  receipts.js     Génération des reçus PDF
  scheduler.js    Automatisations CRM programmées
  config.js       Variables d'environnement
```
