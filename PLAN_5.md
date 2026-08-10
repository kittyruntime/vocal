# Plan 5 — Client voix, caméra et partage d'écran

Dernière mise à jour : 2026-08-10 (nuit)

## Terminé

- [x] Transitions : toasts avec entrée/sortie animées (état "leaving" avant retrait du DOM), messages de chat en fondu à l'arrivée, bandeau de connexion qui glisse à l'apparition, survol des salons de la sidebar adouci. Tout respecte `prefers-reduced-motion`.
- [x] Plein écran par tuile vidéo (partage d'écran, caméra locale et distante) via la Fullscreen API native, bouton visible au survol, icône synchronisée sur l'état réel (y compris sortie via Échap ou l'UI du navigateur).
- [x] Réglages d'un salon (nom, accès, qualité média par défaut, suppression) déplacés du panneau admin global vers une icône réglages par salon dans la sidebar (`ChannelSettingsModal.tsx`), visible aux admins uniquement. Le panneau admin ne garde que les réglages serveur (inscriptions, membres/rôles).
- [x] Interface entièrement traduite en anglais (composants + tests + `lang="en"`). Les noms de salons restent du contenu utilisateur, non traduits.
- [x] Remplacement complet du système de rôles (admin/moderator/member, hiérarchique) par des capabilities indépendantes et cumulables : `manage_channels`, `manage_server`, `moderate`, `publish_voice`. Aucune hiérarchie implicite — détenir une capability n'en implique jamais une autre. L'accès à un salon est gouverné par `channels.required_capability` (nullable = ouvert à tout utilisateur authentifié), à la place de `min_role`. Le premier compte (`/api/setup`) reçoit les 4 capabilities ; une inscription normale reçoit uniquement `publish_voice` (préserve le comportement actuel : tout le monde peut publier en vocal par défaut). Nouveauté réelle permise par ce modèle : `publish_voice` gouverne désormais si le jeton LiveKit émis autorise `canPublish` — un admin peut donc retirer ce droit à un utilisateur précis (mode écoute seule) sans toucher au reste de ses droits. Kick/ban sont gouvernés par `moderate` (plus par admin uniquement) ; gestion des salons par `manage_channels` ; réglages serveur, invitations et attribution des capabilities par `manage_server`, avec protection contre le retrait de `manage_server` au dernier détenteur (équivalent du garde-fou « dernier admin »). Migration `006_capabilities.sql` : nouvelle table `user_capabilities`, colonnes `users.role` et `channels.min_role` supprimées, mapping des données existantes préservant l'accès effectif (admin → toutes, moderator → moderate+publish_voice, member → publish_voice). Panneau admin : sélecteur de rôle remplacé par des cases à cocher par capability ; réglages de salon : sélecteur d'accès par capability requise (ou « Everyone »).
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
- [x] Expulsion (kick) : révoque les sessions actives et force la déconnexion WebSocket ; l’utilisateur peut se reconnecter.
- [x] Bannissement (ban/unban) : comme kick, mais bloque aussi les futures connexions (login 403, sessions déjà valides rejetées) jusqu’à levée. Impossible de se bannir soi-même.

## À faire ensuite

- [x] Appliquer réellement le seuil VAD à la transmission avec porte audio et délai anti-coupure.
- [x] Reconnexion et messages d'erreur média détaillés.
- [x] Expulsion et bannissement de comptes (modération de base).
- [ ] Mute forcé par un modérateur, non contournable (API serveur LiveKit `RoomServiceClient`).
- [ ] Retirer aussi un utilisateur expulsé/banni d’un salon vocal LiveKit auquel iel est déjà connecté·e (aujourd’hui, kick/ban coupe la session WebSocket mais pas une connexion WebRTC déjà établie — limite connue, à traiter avec le mute forcé puisque les deux ont besoin du `RoomServiceClient`).
- [ ] Tests E2E Playwright.
- [ ] Vérification réelle à deux navigateurs via le déploiement Coolify.
- [ ] TURN/TLS et durcissement production.

## Point de reprise

Le composant principal est `web/src/voice/VoiceView.tsx`. La refonte frontend,
les périphériques, le vumètre, le push-to-talk, les vues d'appel animées, les
profils de qualité, l'administration serveur, la porte audio VAD et la
reconnexion LiveKit sont implémentés. La porte audio vit dans
`web/src/voice/VoiceGateProcessor.ts` : elle ouvre le signal au-dessus du seuil
et conserve 280 ms de marge avant fermeture.

**Reconnexion et erreurs différenciées (fait) :** `VoiceStatus` a un état
`"reconnecting"` distinct, piloté par `RoomEvent.Reconnecting`/`Reconnected` du
SDK LiveKit — la vue reste affichée (grille, contrôles) avec un bandeau
« Reconnexion en cours… » plutôt que de tout réinitialiser comme le fait un
vrai `RoomEvent.Disconnected`. Si la reconnexion échoue définitivement (un
`Disconnected` survient alors qu'on était en train de reconnecter), un toast
distinct prévient l'utilisateur ; un `Disconnected` consécutif à un départ
volontaire (`leaveRoom`) ne déclenche rien, comme avant. Les messages d'erreur
sont différenciés via `MediaDeviceFailure.getFailure()` du SDK (refus de
permission micro/caméra, périphérique absent, périphérique déjà utilisé) et
`ConnectionError`/`ConnectionErrorReason` pour distinguer une perte réseau au
moment de rejoindre un salon d'un autre échec ; le partage d'écran annulé est
traité comme un refus de permission (les deux cas sont indiscernables au
niveau de l'API navigateur `getDisplayMedia`). Tout vit dans
`web/src/voice/VoiceView.tsx` (`describeJoinError`, `describeMediaError`,
`MEDIA_ERROR_MESSAGES`) — pas de nouveau fichier.

**Passe UX/UI (fait) :** traduction complète en anglais, réglages de salon
déplacés sur une icône par salon, plein écran par tuile vidéo, transitions
adoucies, et remplacement complet du système de rôles par des capabilities
indépendantes (`manage_channels`, `manage_server`, `moderate`,
`publish_voice` — voir la section Terminé pour le détail). Le modèle de
permissions vit désormais dans `server/src/capabilities.ts` côté serveur et
`web/src/api/client.ts` côté client ; il n'y a plus de notion de rôle nulle
part dans le code.

**Prochaine étape exacte :** reprendre le backlog de modération avancée —
mute forcé par un détenteur de `moderate`, non contournable (API serveur
LiveKit `RoomServiceClient`), et retirer un utilisateur expulsé/banni d'une
connexion WebRTC déjà établie (même limite de `RoomServiceClient`). Puis
redéployer sur Coolify pour le test réel à deux navigateurs (mode Jeu inclus)
et vérifier en conditions réelles le bandeau de reconnexion et les messages
d'erreur média. Enfin, TURN/TLS et durcissement production. Toute nouvelle
tranche doit finir par les tests frontend et backend, les typechecks, le
build, puis une mise à jour de ce fichier.
