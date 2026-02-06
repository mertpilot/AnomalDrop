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
        // KANAL İYİLEŞTİRMESİ: Büyük dosyalar için threshold ayarı
        this.channel.bufferedAmountLowThreshold = 65535;

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

        // Metadata gönder
        try {
            this.channel.send(JSON.stringify({ type: 'header', name: file.name, size: file.size, mime: file.type }));
        } catch(e) { console.error("Header Hatası:", e); return; }

        // --- BÜYÜK DOSYA AYARI ---
        const chunkSize = 16 * 1024; // 16KB (Güvenli Boyut)
        // Kanalın boğulmaması için limit (64KB tampon)
        const MAX_BUFFER_AMOUNT = 64 * 1024; 
        
        const reader = new FileReader();
        let offset = 0;

        reader.onload = (e) => {
            if (this.channel.readyState !== 'open') return;
            
            try {
                this.channel.send(e.target.result);
                offset += e.target.result.byteLength;

                if (offset < file.size) {
                    // --- KRİTİK NOKTA: BACKPRESSURE (GERİ BASINÇ) ---
                    // Eğer kanalın ağzı çok doluysa (MAX_BUFFER_AMOUNT), bekle!
                    if (this.channel.bufferedAmount > MAX_BUFFER_AMOUNT) {
                        // Kanal boşalana kadar bekleme döngüsü
                        const waitLoop = setInterval(() => {
                            if (this.channel.bufferedAmount < MAX_BUFFER_AMOUNT) {
                                clearInterval(waitLoop);
                                readSlice(offset);
                            }
                        }, 5); // 5ms'de bir kontrol et
                    } else {
                        // Kanal müsait, yapıştır
                        readSlice(offset);
                    }
                } else {
                    console.log("Gönderim bitti!");
                }
            } catch(error) {
                console.error("Upload Hatası:", error);
            }
        };

        const readSlice = (o) => {
            const slice = file.slice(o, o + chunkSize);
            reader.readAsArrayBuffer(slice);
        };

        readSlice(0);
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
            // UI Kasmasın diye her %1'de bir güncelle
            if (Math.floor(percent) % 1 === 0) {
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