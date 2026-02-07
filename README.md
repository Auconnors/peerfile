# PeerFile

Transfert de fichiers 100% P2P entre deux navigateurs. Le fichier reste dans le navigateur de l'envoyeur et n'est jamais stocké sur un serveur.

## Fonctionnement

- WebRTC pour le transfert direct (peer-to-peer).
- WebSocket uniquement pour la signalisation (échange d'offres/candidates).
- Le lien généré permet au receveur de rejoindre automatiquement la session.
- Le transfert fonctionne tant que l'onglet de l'envoyeur reste ouvert.

## Démarrer

```bash
npm install
npm start
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000) pour l'envoyeur. Le receveur ouvre le lien partagé pour rejoindre.

## Notes réseau

- Un serveur STUN public est utilisé par défaut.
- Pour des réseaux stricts (NAT/pare-feu), ajoutez un serveur TURN dans `public/app.js`.

## Sécurité

Le flux de données passe directement entre les deux navigateurs. Le serveur n'a jamais accès au contenu du fichier.
