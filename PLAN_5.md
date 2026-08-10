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
- [x] Icônes standardisées avec Lucide (suppression des tracés SVG maison).
- [x] Vue d'appel audio dédiée, compteur de participants et grille vidéo adaptative.
- [x] Animations d'entrée, de connexion, de prise de parole et respect de `prefers-reduced-motion`.
- [x] Profils persistants de qualité audio, webcam et partage d'écran appliqués à LiveKit.
- [x] Mode partage « Jeu » en 1080p à 60 ips (8 Mb/s, priorité à la fluidité).
- [x] Session vocale persistante pendant la navigation dans les salons textuels.
- [x] Indicateur nominatif du locuteur actif en vue audio, vidéo et partage.
- [x] Paramètres voix/vidéo déplacés dans une modale inspirée de Discord.
- [x] Tuiles nominatives par participant avec anneau ou cadre vert sur le locuteur actif.
- [x] Barre d’appel compacte à contrôles circulaires inspirée de Discord.
- [x] Connexion automatique au clic sur un salon vocal.
- [x] Choix détection vocale/push-to-talk déplacé dans les paramètres.

## Administration serveur

- [x] Qualités média par défaut persistées par salon vocal.
- [x] Édition du nom, du rôle minimum et suppression d’un salon.
- [x] Ouverture/fermeture des inscriptions dans les paramètres serveur.
- [x] Liste des utilisateurs et attribution des rôles par un administrateur.
- [x] Protection contre la rétrogradation du dernier administrateur.
- [x] Mise à jour immédiate des droits WebSocket lors d’un changement de rôle.

## À faire ensuite

- [x] Appliquer réellement le seuil VAD à la transmission avec porte audio et délai anti-coupure.
- [ ] Reconnexion et messages d'erreur média détaillés.
- [ ] Vérification réelle à deux navigateurs via le déploiement Coolify.
- [ ] TURN/TLS et durcissement production.

## Point de reprise

Le composant principal est `web/src/voice/VoiceView.tsx`. La refonte frontend,
les périphériques, le vumètre, le push-to-talk, les vues d'appel animées, les
profils de qualité, l'administration serveur et la porte audio VAD sont
implémentés. La porte audio vit dans `web/src/voice/VoiceGateProcessor.ts` : elle
ouvre le signal au-dessus du seuil et conserve 280 ms de marge avant fermeture.

**Prochaine étape exacte :** implémenter la reconnexion LiveKit avec un état
visuel dédié et des messages différenciés pour refus de permissions micro,
caméra, partage annulé, périphérique absent et perte réseau. Ensuite seulement,
redéployer sur Coolify et effectuer le test réel à deux navigateurs, notamment
le mode Jeu selon les limites du navigateur et de la connexion. Toute nouvelle
tranche doit finir par les tests frontend et backend, les typechecks, le build,
puis une mise à jour de ce fichier.
