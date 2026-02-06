class AnomalNetwork {
    constructor() {
        // ID oluştur ve kaydet
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
        const models = ['Alpha', 'Beta', 'Delta', 'Omega', 'Prime'];
        const hex = Math.floor(Math.random() * 999);
        const newName = `Anomal ${models[Math.floor(Math.random() * models.length)]} ${hex}`;
        localStorage.setItem('anomal-name', newName);
        return newName;
    }

    connect(address) {
        this.ws = new WebSocket(address);
        this.ws.onopen = () => {
            console.log("Sunucuya Bağlandı ✅ ID:", this.myId);
            this.sendSignal('join', {
                sender: this.myId,
                device: { model: this.deviceName, type: this.getDeviceType() }
            });
        };
        this.ws.onmessage = (event) => {
            try { const msg = JSON.parse(event.data); this.handleSignal(msg); } catch (e) { }
        };
        this.ws.onclose = () => setTimeout(() => this.connect(address), 1000);
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
        if (this.peers[peerInfo.id] || peerInfo.id === this.myId) return;
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
        return /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    }
}

class AnomalPeer {
    constructor(info, network) {
        this.id = info.id;
        this.model = info.model;
        this.network = network;
        
        // --- TRAFİK POLİSİ ---
        // Eğer benim ID'm onunkinden büyükse, BEN başlatırım (Initiator).
        // Değilse, o başlatsın ben beklerim.
        this.isInitiator = this.network.myId > this.id;

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

        // Eğer ben başlatıcı DEĞİLSEM, kanalın bana gelmesini beklerim
        this.pc.ondatachannel = (event) => { 
            console.log("Kanal Kabul Edildi (Passive) 🟢");
            this.setupChannel(event.channel); 
        };

        // Eğer başlatıcı BEN isem, kanalı ben açar ve teklifi ben yaparım
        if (this.isInitiator) {
            console.log("Bağlantı Başlatılıyor (Active) 🟡");
            const channel = this.pc.createDataChannel('anomal-data');
            this.setupChannel(channel);
            
            this.pc.createOffer().then(desc => {
                this.pc.setLocalDescription(desc);
                this.network.sendSignal('signal', { to: this.id, data: { type: 'offer', sdp: desc } });
            });
        }
    }

    setupChannel(channel) {
        this.channel = channel;
        this.channel.bufferedAmountLowThreshold = 64 * 1024;

        this.channel.onopen = () => {
            console.log(`KANAL HAZIR: ${this.model} 🚀`);
            if (this.queuedFile) {
                this.sendFileData(this.queuedFile);
                this.queuedFile = null;
            }
        };
        this.channel.onmessage = (e) => this.handleData(e.data);
    }

    async handleSignal(data) {
        try {
            if (data.type === 'offer') {
                // Sadece pasif taraf teklif alır, ama çakışma olursa burası kurtarır
                if (this.isInitiator) {
                    console.warn("Çarpışma algılandı, ama devam ediliyor...");
                }
                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.network.sendSignal('signal', { to: this.id, data: { type: 'answer', sdp: answer } });
            } else if (data.type === 'answer') {
                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            } else if (data.type === 'candidate') {
                // Bağlantı durumu kontrolü
                if (this.pc.remoteDescription) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            }
        } catch(e) { console.error("Sinyal Hatası:", e); }
    }

    send(file) {
        if (!this.channel || this.channel.readyState !== 'open') {
            console.log("Kanal hazır değil, kuyruğa alındı.");
            this.queuedFile = file;
            if(window.showToast) window.showToast("Bağlantı bekleniyor...");
            return;
        }
        this.sendFileData(file);
    }

    sendFileData(file) {
        console.log("Gönderim Başladı:", file.name);
        try {
            this.channel.send(JSON.stringify({ type: 'header', name: file.name, size: file.size, mime: file.type }));
        } catch(e) { return; }

        const chunkSize = 16 * 1024;
        const reader = new FileReader();
        let offset = 0;

        reader.onload = (e) => {
            const data = e.target.result;
            const pushData = () => {
                if (this.channel.bufferedAmount > 160 * 1024) { 
                    setTimeout(pushData, 10); // Kanal doluysa bekle
                    return;
                }
                try {
                    this.channel.send(data);
                    offset += data.byteLength;
                    if (offset < file.size) {
                        readNextSlice();
                    }
                } catch (err) { }
            };
            pushData();
        };

        const readNextSlice = () => {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        };
        readNextSlice();
    }

    handleData(data) {
        if (typeof data === 'string') {
            const msg = JSON.parse(data);
            if (msg.type === 'header') {
                this.receivingFile = msg;
                this.fileBuffer = [];
                this.receivedSize = 0;
                window.dispatchEvent(new CustomEvent('file-incoming', { detail: msg }));
            }
        } else {
            if (!this.receivingFile) return;
            this.fileBuffer.push(data);
            this.receivedSize += data.byteLength;

            const percent = (this.receivedSize / this.receivingFile.size) * 100;
            if (Math.floor(percent) % 1 === 0 || percent >= 100) {
                window.dispatchEvent(new CustomEvent('file-progress', { detail: percent }));
            }

            if (this.receivedSize >= this.receivingFile.size) {
                const blob = new Blob(this.fileBuffer, { type: this.receivingFile.mime });
                window.dispatchEvent(new CustomEvent('file-ready', { detail: { blob, name: this.receivingFile.name } }));
                this.receivingFile = null;
                this.fileBuffer = [];
            }
        }
    }

    close() { if (this.pc) this.pc.close(); }
}

window.network = new AnomalNetwork();