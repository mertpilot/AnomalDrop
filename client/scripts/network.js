class AnomalNetwork {
    constructor() {
        this.myId = localStorage.getItem('anomal-id') || Math.random().toString(36).substring(2, 9);
        localStorage.setItem('anomal-id', this.myId);
        this.deviceName = this.generateName();
        this.peers = {};
        
        window.anomalPeers = this.peers;

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const address = protocol + '//' + location.host;
        this.connect(address);
    }

    generateName() {
        let savedName = localStorage.getItem('anomal-name');
        if (savedName) return savedName;
        const models = ['Node', 'Station', 'Ghost', 'Core', 'Unit', 'Operator'];
        const randomModel = models[Math.floor(Math.random() * models.length)];
        const hex = Math.floor(Math.random() * 999);
        const newName = `Anomal ${randomModel} ${hex}`;
        localStorage.setItem('anomal-name', newName);
        return newName;
    }

    connect(address) {
        this.ws = new WebSocket(address);
        this.ws.onopen = () => {
            console.log("Sunucuya Bağlandı ✅");
            this.sendSignal('join', {
                sender: this.myId,
                device: { model: this.deviceName, type: this.getDeviceType() }
            });
        };
        this.ws.onmessage = (event) => {
            try { const msg = JSON.parse(event.data); this.handleSignal(msg); } catch (e) { }
        };
        this.ws.onclose = () => setTimeout(() => this.connect(address), 2000);
    }

    sendSignal(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, ...data }));
        }
    }

    handleSignal(msg) {
        switch (msg.type) {
            case 'peer-joined': this.addPeer(msg.peer); break;
            case 'peer-left': this.removePeer(msg.peerId); break;
            case 'signal': if (this.peers[msg.sender]) this.peers[msg.sender].handleSignal(msg.data); break;
            case 'ping': this.sendSignal('pong', {}); break;
        }
    }

    addPeer(peerInfo) {
        if (this.peers[peerInfo.id]) return;
        const peer = new AnomalPeer(peerInfo, this);
        this.peers[peerInfo.id] = peer;
        window.dispatchEvent(new CustomEvent('peer-joined', { detail: peerInfo }));
    }

    removePeer(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        window.dispatchEvent(new CustomEvent('peer-left', { detail: peerId }));
    }

    getDeviceType() {
        const ua = navigator.userAgent;
        if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
        if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated/.test(ua)) return 'mobile';
        return 'desktop';
    }
}

class AnomalPeer {
    constructor(info, network) {
        this.id = info.id;
        this.model = info.model;
        this.network = network;
        this.pc = new RTCPeerConnection({ 
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ] 
        });
        this.channel = null;
        this.fileBuffer = [];
        this.receivingFile = null;
        this.receivedSize = 0;
        this.queuedFile = null; 

        this.pc.onicecandidate = (event) => {
            if (event.candidate) this.network.sendSignal('signal', { to: this.id, data: { type: 'candidate', candidate: event.candidate } });
        };

        this.pc.ondatachannel = (event) => { this.setupChannel(event.channel); };

        const channel = this.pc.createDataChannel('anomal-data');
        this.setupChannel(channel);
        
        this.pc.createOffer().then(desc => {
            this.pc.setLocalDescription(desc);
            this.network.sendSignal('signal', { to: this.id, data: { type: 'offer', sdp: desc } });
        });
    }

    setupChannel(channel) {
        this.channel = channel;
        // --- SENSO AYARI ---
        // Kanal doluluk oranı 64KB'ın altına düşünce "Bana Haber Ver" diyoruz.
        this.channel.bufferedAmountLowThreshold = 64 * 1024;

        this.channel.onopen = () => {
            console.log(`Kanal Açıldı: ${this.model} 🚀`);
            if (this.queuedFile) {
                this.send(this.queuedFile);
                this.queuedFile = null;
            }
        };
        this.channel.onmessage = (e) => this.handleData(e.data);
    }

    async handleSignal(data) {
        try {
            if (data.type === 'offer') {
                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.network.sendSignal('signal', { to: this.id, data: { type: 'answer', sdp: answer } });
            } else if (data.type === 'answer') {
                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            } else if (data.type === 'candidate') {
                await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch(e) { console.error(e); }
    }

    send(file) {
        if (this.channel.readyState !== 'open') {
            this.queuedFile = file;
            if(window.showToast) window.showToast("Bağlantı bekleniyor...");
            return;
        }

        console.log("Gönderim başlıyor:", file.name);

        // Metadata
        try {
            this.channel.send(JSON.stringify({ type: 'header', name: file.name, size: file.size, mime: file.type }));
        } catch(e) { console.error("Header Hatası:", e); return; }

        const chunkSize = 16 * 1024; // 16KB Lokmalar
        const reader = new FileReader();
        let offset = 0;

        // Okuma ve Gönderme Fonksiyonu
        const readSlice = () => {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            if (this.channel.readyState !== 'open') return;
            
            try {
                this.channel.send(e.target.result);
                offset += e.target.result.byteLength;

                if (offset < file.size) {
                    // --- EN KRİTİK NOKTA: SENSÖR KONTROLÜ ---
                    // Eğer kanalın ağzı çok doluysa (Threshold'u geçtiyse) DUR.
                    if (this.channel.bufferedAmount > this.channel.bufferedAmountLowThreshold) {
                        // Burada hiçbir şey yapmıyoruz, sadece duruyoruz.
                        // Aşağıdaki 'onbufferedamountlow' eventi tetiklenince devam edecek.
                    } else {
                        // Kanal müsait, durmak yok yola devam
                        readSlice();
                    }
                } else {
                    console.log("Gönderim bitti!");
                }
            } catch(error) { console.error("Upload Hatası:", error); }
        };

        // --- SENSÖR: KANAL BOŞALINCA TETİKLENİR ---
        this.channel.onbufferedamountlow = () => {
            // Eğer gönderim bitmediyse kaldığı yerden devam et
            if (offset < file.size) {
                readSlice();
            }
        };

        // İLK TETİKLEME
        readSlice();
    }

    handleData(data) {
        if (typeof data === 'string') {
            const msg = JSON.parse(data);
            if (msg.type === 'header') {
                this.receivingFile = msg;
                this.fileBuffer = [];
                this.receivedSize = 0;
                window.dispatchEvent(new CustomEvent('file-incoming', { detail: { name: msg.name, size: msg.size } }));
            }
        } else {
            if (!this.receivingFile) return;

            this.fileBuffer.push(data);
            this.receivedSize += data.byteLength;

            const percent = (this.receivedSize / this.receivingFile.size) * 100;
            // UI Güncelleme (Her %1'de bir)
            if (Math.floor(percent) % 1 === 0 || percent >= 100) {
                window.dispatchEvent(new CustomEvent('file-progress', { detail: percent }));
            }

            if (this.receivedSize >= this.receivingFile.size) {
                const blob = new Blob(this.fileBuffer, { type: this.receivingFile.mime });
                window.dispatchEvent(new CustomEvent('file-ready', { 
                    detail: { blob: blob, name: this.receivingFile.name } 
                }));
                this.receivingFile = null;
                this.fileBuffer = [];
            }
        }
    }

    close() { if (this.pc) this.pc.close(); }
}

window.network = new AnomalNetwork();