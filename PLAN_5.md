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

## À faire ensuite

- [ ] Sélection des microphones, caméras et sorties audio.
- [ ] Vumètre et seuil VAD réglable.
- [ ] Push-to-talk et raccourcis clavier.
- [ ] Reconnexion et messages d'erreur média détaillés.
- [ ] Vérification réelle à deux navigateurs via le déploiement Coolify.
- [ ] TURN/TLS et durcissement production.

## Point de reprise

Le composant principal est `web/src/voice/VoiceView.tsx`. Le lot média est
implémenté et validé automatiquement, mais doit encore être essayé à deux
navigateurs sur Coolify. Le prochain lot commence par la sélection des
périphériques, puis le vumètre/VAD et le push-to-talk. Toute nouvelle tranche
doit finir par les tests frontend et backend, les typechecks, le build, puis une
mise à jour de ce fichier.
