# Plan 5 — Client voix, caméra et partage d'écran

Dernière mise à jour : 2026-08-10

## Terminé

- [x] SDK `livekit-client` chargé à la demande.
- [x] Récupération d'un jeton vocal court auprès du backend.
- [x] Présence vocale synchronisée par WebSocket et affichée dans la sidebar.
- [x] Connexion et déconnexion d'un salon LiveKit.
- [x] Publication du microphone et contrôle mute/unmute.
- [x] Lecture des pistes audio distantes.
- [x] Stack de test Coolify complète et documentée.

## Terminé — Lot média

- [x] Assourdissement local (deafen).
- [x] Activation/désactivation de la caméra.
- [x] Activation/arrêt du partage d'écran.
- [x] Rendu et nettoyage des vidéos locales et distantes.
- [x] Tests du cycle de vie des contrôles média.
- [x] Noms des participants dans la présence sidebar.
- [x] Indicateur de parole active autour des vidéos.
- [x] Refonte du frontend dans une disposition Discord utilisable.
- [x] Sidebar compacte, formulaire admin repliable et barre utilisateur.
- [x] Chat avec avatars, horodatage, état vide et composer robuste.
- [x] Sélection des microphones, caméras et sorties audio.
- [x] Vumètre local avec seuil visuel persistant.
- [x] Push-to-talk à la barre Espace, ignoré pendant la saisie.
- [x] Inscription publique sans invitation, avec session immédiate.
- [x] Correction des POST sans body (`voice-token` n'envoie plus un faux JSON vide).
- [x] Polish visuel : typographie système stable, icônes SVG et hiérarchie affinée.

## À faire ensuite

- [ ] Appliquer réellement le seuil VAD à la transmission (le seuil actuel est visuel).
- [ ] Reconnexion et messages d'erreur média détaillés.
- [ ] Vérification réelle à deux navigateurs via le déploiement Coolify.
- [ ] TURN/TLS et durcissement production.

## Point de reprise

Le composant principal est `web/src/voice/VoiceView.tsx`. La refonte frontend,
les périphériques, le vumètre, le push-to-talk et l'inscription publique sont
implémentés. Le `400` Fastify sur `voice-token` est corrigé à la source. Le
prochain point prioritaire est de redéployer sur Coolify puis de tester le média
à deux navigateurs. Toute nouvelle tranche doit finir par les tests frontend et
backend, les typechecks, le build, puis une mise à jour de ce fichier.
