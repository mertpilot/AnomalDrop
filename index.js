const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// PORT AYARI (Render otomatik atar, yoksa 3030)
const PORT = process.env.PORT || 3030;

// --- KRİTİK DÜZELTME BURADA ---
// Render'da index.js ve client klasörü yan yanadır.
// Bu yüzden '../client' değil, direkt 'client' diyoruz.
app.use(express.static(path.join(__dirname, 'client')));

// Ana sayfayı zorla gönder (Garanti olsun)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// WebSocket Sunucusu
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Bağlantı canlılık kontrolü
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) { return; }

        switch (data.type) {
            case 'join':
                // 1. Kimlik bilgilerini kaydet
                ws.id = data.sender;
                ws.deviceName = data.device.model;
                ws.deviceType = data.device.type;

                // 2. Herkese duyur: "Yeni biri geldi"
                broadcast({
                    type: 'peer-joined',
                    peer: { id: ws.id, model: ws.deviceName, type: ws.deviceType }
                }, ws);

                // 3. Yeni gelene duyur: "Odadakiler bunlar"
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.deviceName) {
                        ws.send(JSON.stringify({
                            type: 'peer-joined',
                            peer: { id: client.id, model: client.deviceName, type: client.deviceType }
                        }));
                    }
                });
                break;

            case 'signal':
                // Sinyali (WebRTC datası) hedefe ilet
                sendMessageTo(data.to, {
                    type: 'signal',
                    sender: ws.id,
                    data: data.data
                });
                break;
                
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
        }
    });

    ws.on('close', () => {
        broadcast({ type: 'peer-left', peerId: ws.id });
    });
});

// --- HEARTBEAT (NABIZ) ---
// Render bağlantıyı koparmasın diye 30 saniyede bir kontrol
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// Yardımcı: Herkese Gönder
function broadcast(message, senderWs) {
    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Yardımcı: Kişiye Gönder
function sendMessageTo(destinationId, message) {
    wss.clients.forEach(client => {
        if (client.id === destinationId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Sunucuyu Başlat
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AnomalDrop Sunucusu Hazır! Port: ${PORT}`);
});