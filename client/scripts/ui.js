class AnomalUI {
    constructor() {
        this.peers = {};
        this.initListeners();
        // Gelen dosya verisini tutacak geçici hafıza
        this.incomingFile = null;
    }

    initListeners() {
        // Ağ Olaylarını Dinle
        window.addEventListener('connected', (e) => {
            const noPeersHeader = document.querySelector('x-no-peers h2');
            if(noPeersHeader) noPeersHeader.textContent = "Bağlantı Kuruldu";
            
            const noPeersP = document.querySelector('x-no-peers p');
            if(noPeersP) noPeersP.textContent = "Cihazlar bekleniyor...";
            
            console.log("Benim İsmim:", e.detail.name);
        });

        window.addEventListener('peer-joined', (e) => this.addPeer(e.detail));
        window.addEventListener('peer-left', (e) => this.removePeer(e.detail));
        window.addEventListener('signal', (e) => this.handleSignal(e.detail));
        
        // Gizli Dosya Input'u
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        this.fileInput.addEventListener('change', (e) => {
            if (this.selectedPeerId && e.target.files.length > 0) {
                this.sendFile(this.selectedPeerId, e.target.files[0]);
                // Input'u temizle ki aynı dosyayı tekrar seçebilsin
                this.fileInput.value = '';
            }
        });

        // Buton Bağlamaları (Download butonu kritik)
        document.addEventListener('DOMContentLoaded', () => {
            const dlBtn = document.getElementById('download');
            // Butona basılınca downloadFile fonksiyonunu çalıştır
            if(dlBtn) dlBtn.onclick = (e) => {
                e.preventDefault(); // Varsayılan davranışı engelle
                this.downloadFile();
            };
            
            // Kapatma butonları
            document.querySelectorAll('[close]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dialog = btn.closest('x-dialog');
                    if(dialog) dialog.removeAttribute('show');
                });
            });
        });
    }

    addPeer(peer) {
        if (this.peers[peer.id]) return;
        this.peers[peer.id] = peer;

        document.querySelector('x-no-peers').classList.add('hidden');

        const el = document.createElement('x-peer');
        el.id = peer.id;
        el.innerHTML = `
            <div class="device-icon">
                <svg class="icon" style="width:40px; height:40px; fill:#fff;">
                    <use xlink:href="#${this.getIcon(peer.type)}" />
                </svg>
            </div>
            <div class="name">${peer.model}</div>
            <div class="status">Hazır</div>
        `;

        el.addEventListener('click', () => {
            this.selectedPeerId = peer.id;
            this.fileInput.click();
        });

        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.selectedPeerId = peer.id;
            this.openDialog('sendTextDialog');
        });

        document.querySelector('x-peers').appendChild(el);
        this.playSound('blop');
    }

    removePeer(peerId) {
        const el = document.getElementById(peerId);
        if (el) el.remove();
        delete this.peers[peerId];
        
        if (Object.keys(this.peers).length === 0) {
            document.querySelector('x-no-peers').classList.remove('hidden');
        }
    }

    // --- DOSYA GÖNDERME ---
    sendFile(peerId, file) {
        const peer = document.getElementById(peerId);
        if(peer) peer.querySelector('.status').textContent = "Gönderiliyor %0";
        
        // 1. Önce Başlık Bilgisini Gönder
        window.network.send({
            type: 'signal',
            to: peerId,
            data: {
                type: 'header',
                name: file.name,
                size: file.size,
                mime: file.type
            }
        });
        
        // 2. Dosyayı Oku ve Gönder
        const reader = new FileReader();
        reader.onload = (e) => {
            // Veri okundu, gönderiliyor
             window.network.send({
                type: 'signal',
                to: peerId,
                data: {
                    type: 'chunk',
                    chunk: e.target.result // Base64 Data URL
                }
            });
            if(peer) peer.querySelector('.status').textContent = "Gönderildi";
            setTimeout(() => {
                if(peer) peer.querySelector('.status').textContent = "Hazır";
            }, 2000);
        };
        reader.readAsDataURL(file);
    }

    // --- DOSYA ALMA ---
    handleSignal(msg) {
        const data = msg.data;
        if (!data) return;

        if (data.type === 'header') {
            // Dosya bilgisi geldi, hafızayı hazırla
            this.incomingFile = {
                name: data.name,
                size: data.size,
                mime: data.mime,
                data: null // Henüz veri yok
            };
            
            document.getElementById('fileName').textContent = data.name;
            document.getElementById('fileSize').textContent = this.formatBytes(data.size);
            
            this.openDialog('receiveDialog');
            this.playSound('blop');
        } 
        else if (data.type === 'chunk') {
            // Dosya verisi geldi, hafızaya yaz
            if (this.incomingFile) {
                this.incomingFile.data = data.chunk;
                console.log("Dosya verisi alındı, indirilmeye hazır.");
            }
        }
    }

    // --- İNDİRME MANTIĞI (THE FIX) ---
    downloadFile() {
        if (!this.incomingFile || !this.incomingFile.data) {
            this.showToast("Dosya verisi henüz gelmedi veya eksik!");
            return;
        }

        try {
            // Base64 verisini temizle (data:image/png;base64, kısmını ayır)
            const base64Data = this.incomingFile.data.split(',')[1];
            const mimeType = this.incomingFile.data.split(',')[0].split(':')[1].split(';')[0];
            
            // Base64'ü Binary Blob'a çevir (Telefonda çalışması için şart)
            const blob = this.base64ToBlob(base64Data, mimeType);
            
            // Blob için geçici bir URL oluştur
            const url = URL.createObjectURL(blob);
            
            // Gizli link oluştur ve tıkla
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = this.incomingFile.name;
            
            document.body.appendChild(a);
            a.click();
            
            // Temizlik
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.incomingFile = null; // Hafızayı boşalt
            }, 100);

            this.closeDialog('receiveDialog');
            this.showToast("İndirme Başlatıldı");
            
        } catch (e) {
            console.error("İndirme hatası:", e);
            this.showToast("İndirme Hatası!");
        }
    }

    // Base64 -> Blob Dönüştürücü (Hayat Kurtaran Fonksiyon)
    base64ToBlob(base64, mime) {
        const byteCharacters = atob(base64);
        const byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        return new Blob(byteArrays, {type: mime});
    }

    // --- DİYALOG İŞLEMLERİ ---
    openDialog(id) {
        document.getElementById(id).setAttribute('show', 'true');
    }

    closeDialog(id) {
        document.getElementById(id).removeAttribute('show');
    }

    // --- YARDIMCILAR ---
    getIcon(type) {
        if (type === 'mobile') return 'phone-iphone';
        if (type === 'tablet') return 'tablet-mac';
        return 'desktop-mac';
    }

    playSound(id) {
        const audio = document.getElementById(id);
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => {});
        }
    }
    
    showToast(msg) {
        const toast = document.getElementById('toast');
        if(toast) {
            toast.textContent = msg;
            toast.setAttribute('show', 'true');
            setTimeout(() => toast.removeAttribute('show'), 3000);
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// UI Başlat
const ui = new AnomalUI();