class AnomalNetwork {
    constructor() {
        // Benzersiz ID ve İsim Oluştur
        this.myId = localStorage.getItem('anomal-id') || Math.random().toString(36).substring(2, 9);
        localStorage.setItem('anomal-id', this.myId);
        
        this.deviceName = this.generateName();
        
        // IP Adresini Otomatik Algıla ve Bağlan
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const address = protocol + '//' + location.host;
        
        console.log("AnomalNetwork: Bağlantı başlatılıyor ->", address);
        this.connect(address);
    }

    generateName() {
        // İsim hafızada varsa onu kullan, yoksa yeni üret
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
            console.log("AnomalNetwork: Sunucuya Bağlandı! ✅");
            this.send({
                type: 'join',
                sender: this.myId,
                device: {
                    model: this.deviceName,
                    type: this.getDeviceType()
                }
            });
            // Bağlantı kurulunca arayüze haber ver
            window.dispatchEvent(new CustomEvent('connected', { detail: { name: this.deviceName } }));
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error("Mesaj hatası:", e);
            }
        };

        this.ws.onclose = () => {
            console.log("Bağlantı koptu, tekrar deneniyor... ⚠️");
            window.dispatchEvent(new CustomEvent('disconnected'));
            setTimeout(() => this.connect(address), 3000);
        };
        
        this.ws.onerror = (err) => {
            console.error("WebSocket Hatası:", err);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    handleMessage(msg) {
        // Gelen mesajı tüm sisteme yay (UI bunu dinleyecek)
        switch (msg.type) {
            case 'peer-joined':
                console.log("Cihaz Bulundu:", msg.peer.model);
                window.dispatchEvent(new CustomEvent('peer-joined', { detail: msg.peer }));
                break;
            case 'peer-left':
                window.dispatchEvent(new CustomEvent('peer-left', { detail: msg.peerId }));
                break;
            case 'signal':
                window.dispatchEvent(new CustomEvent('signal', { detail: msg }));
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
        }
    }

    getDeviceType() {
        const ua = navigator.userAgent;
        if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
        if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated/.test(ua)) return 'mobile';
        return 'desktop';
    }
}

// Global Erişime Aç
window.network = new AnomalNetwork();