# PeerFile

Transfert de fichiers 100% P2P entre deux navigateurs. Le fichier reste dans le navigateur de l'envoyeur et n'est jamais stocké sur un serveur.

## Fonctionnement

- WebRTC pour le transfert direct (peer-to-peer).
- WebSocket uniquement pour la signalisation (échange d'offres/candidates).
- Le lien généré contient un jeton secret et permet au receveur de rejoindre automatiquement la session.
- Le transfert fonctionne tant que l'onglet de l'envoyeur reste ouvert.

## Démarrer

```bash
npm install
npm start
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000) pour l'envoyeur. Le receveur ouvre le lien partagé pour rejoindre.

### HTTPS / certificats

Pour activer HTTPS, fournissez un certificat et une clé via les variables d'environnement suivantes :

```bash
SSL_CERT_PATH=/chemin/vers/cert.pem SSL_KEY_PATH=/chemin/vers/key.pem npm start
```

## Notes réseau

- Un serveur STUN public est utilisé par défaut.
- Pour des réseaux stricts (NAT/pare-feu), ajoutez un serveur TURN dans `public/app.js`.

## Sécurité

- Le flux de données passe directement entre les deux navigateurs via WebRTC (DataChannel chiffré par DTLS). Le serveur n'a jamais accès au contenu du fichier.
- Le serveur de signalisation exige le jeton secret contenu dans le lien pour autoriser l'accès à une salle et limite les rôles (un envoyeur/receveur).
- Le lien peut être réinitialisé pour régénérer un jeton et invalider le lien précédent.
