const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected peers
const peers = new Map();

wss.on('connection', (ws) => {
    const peerId = generatePeerId();
    peers.set(peerId, ws);

    // Send the peer their ID
    ws.send(JSON.stringify({ type: 'id', peerId }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'offer':
                // Forward the offer to the target peer
                const targetPeer = peers.get(data.target);
                if (targetPeer) {
                    targetPeer.send(JSON.stringify({
                        type: 'offer',
                        offer: data.offer,
                        from: peerId
                    }));
                }
                break;

            case 'answer':
                // Forward the answer to the target peer
                const offeringPeer = peers.get(data.target);
                if (offeringPeer) {
                    offeringPeer.send(JSON.stringify({
                        type: 'answer',
                        answer: data.answer,
                        from: peerId
                    }));
                }
                break;

            case 'ice-candidate':
                // Forward ICE candidates to the target peer
                const candidateTarget = peers.get(data.target);
                if (candidateTarget) {
                    candidateTarget.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: data.candidate,
                        from: peerId
                    }));
                }
                break;
        }
    });

    ws.on('close', () => {
        peers.delete(peerId);
    });
});

// Generate a random peer ID
function generatePeerId() {
    return Math.random().toString(36).substr(2, 9);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});