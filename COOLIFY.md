# Déployer Vocal sur Coolify

Cette stack déploie quatre services : `web` (Nginx + React), `server`
(Fastify), `postgres` et `livekit`.

## 1. Créer la ressource

Dans Coolify, créer une ressource depuis ce dépôt GitHub et choisir le build pack
**Docker Compose**. Utiliser le fichier :

```text
/docker-compose.coolify.yml
```

## 2. Configurer les domaines

Deux DNS de type A doivent pointer vers l'adresse IPv4 publique du serveur.

- service `web`, port `80` : `https://vocal.example.com`
- service `livekit`, port `7880` : `https://livekit.example.com`

Coolify termine TLS pour ces deux domaines. Le navigateur utilisera
`wss://livekit.example.com` pour LiveKit.

## 3. Configurer les variables

Ajouter ces variables dans la ressource Coolify :

```env
POSTGRES_PASSWORD=mot-de-passe-url-safe
MESSAGE_MASTER_KEY=base64-32-octets
APP_ORIGIN=https://vocal.example.com
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=cle-livekit
LIVEKIT_API_SECRET=secret-livekit-long
```

Générer des valeurs sûres sur une machine de confiance :

```bash
openssl rand -base64 32  # MESSAGE_MASTER_KEY
openssl rand -hex 16     # LIVEKIT_API_KEY
openssl rand -hex 32     # LIVEKIT_API_SECRET
openssl rand -hex 24     # POSTGRES_PASSWORD (compatible avec DATABASE_URL)
```

Ne pas réutiliser `devkey` / `secret` en production et ne jamais changer
`MESSAGE_MASTER_KEY` après avoir stocké des messages : ils deviendraient
illisibles.

## 4. Ouvrir les ports média

Dans le pare-feu du VPS et celui de l'hébergeur, autoriser en entrée :

- `7881/tcp` — fallback WebRTC TCP ;
- `7882/udp` — média WebRTC.

Les ports HTTP/HTTPS habituels de Coolify doivent déjà être ouverts. PostgreSQL
et le backend ne sont pas publiés directement.

## 5. Déployer et vérifier

Après le déploiement :

1. ouvrir `https://vocal.example.com/api/health` et vérifier `{"status":"ok"}` ;
2. créer le premier compte administrateur depuis l'application ;
3. créer un salon vocal ;
4. le rejoindre depuis deux navigateurs ou appareils différents ;
5. vérifier les logs `server` et `livekit` si la présence ou l'audio ne remonte pas.

Cette configuration suffit pour les premiers tests. Pour une connectivité fiable
depuis des réseaux d'entreprise très restrictifs, ajouter ensuite TURN/TLS sur un
domaine et un port dédiés.
