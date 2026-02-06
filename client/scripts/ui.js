const peersContainer = document.querySelector('x-peers');
const noPeers = document.querySelector('x-no-peers');

// 1. Cihaz Katıldı
window.addEventListener('peer-joined', (e) => {
    const peer = e.detail;
    const el = document.createElement('x-peer');
    el.id = `peer-${peer.id}`;
    el.innerHTML = `
        <div class="device-icon">
            <svg class="icon" style="width:40px;height:40px;fill:#fff"><use xlink:href="#${getIcon(peer.type)}"></use></svg>
            <div class="progress"></div>
        </div>
        <div class="name">${peer.model}</div>
        <div class="status">${peer.type}</div>
    `;
    
    // Tekli Gönderim
    el.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (ev) => {
            const file = ev.target.files[0];
            if(file && window.network.peers[peer.id]) window.network.peers[peer.id].send(file);
        };
        input.click();
    });

    // Drop Zone (Sürükle Bırak)
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.style.transform = 'scale(1.1)'; });
    el.addEventListener('dragleave', () => { el.style.transform = 'scale(1)'; });
    el.addEventListener('drop', (ev) => {
        ev.preventDefault();
        el.style.transform = 'scale(1)';
        const files = ev.dataTransfer.files;
        if (files.length > 0 && window.network.peers[peer.id]) window.network.peers[peer.id].send(files[0]);
    });

    peersContainer.appendChild(el);
    updateState();
    playSound('blop');
});

window.addEventListener('peer-left', (e) => {
    const el = document.getElementById(`peer-${e.detail}`);
    if (el) el.remove();
    updateState();
});

// --- DOSYA TRANSFER UI ---

// A. Dosya Gelmeye Başladı (Kilitli)
window.addEventListener('file-incoming', (e) => {
    const dialog = document.getElementById('receiveDialog');
    document.getElementById('fileName').innerText = e.detail.name;
    document.getElementById('fileSize').innerText = formatBytes(e.detail.size);
    
    // UI Reset
    const btn = document.getElementById('download');
    const status = document.getElementById('transferStatus');
    const bar = document.getElementById('transferFill');
    
    btn.classList.add('disabled'); // KİLİTLE
    btn.textContent = "Yükleniyor...";
    btn.onclick = null;

    status.textContent = "VERİ AKTARILIYOR...";
    status.style.opacity = "1";
    if(bar) bar.style.width = "0%";

    dialog.setAttribute('show', 'true');
});

// B. Neon Bar Doluyor
window.addEventListener('file-progress', (e) => {
    const percent = e.detail;
    const bar = document.getElementById('transferFill');
    if(bar) bar.style.width = `${percent}%`;
});

// C. Transfer Bitti (Kilidi Aç)
window.addEventListener('file-ready', (e) => {
    const btn = document.getElementById('download');
    const status = document.getElementById('transferStatus');
    const bar = document.getElementById('transferFill');

    status.textContent = "TAMAMLANDI ✨";
    if(bar) bar.style.width = "100%";
    
    // Butonu Aç
    btn.classList.remove('disabled');
    btn.textContent = "KAYDET (İNDİR)";
    
    // İndirme Linkini Hazırla
    const url = URL.createObjectURL(e.detail.blob);
    btn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = e.detail.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        document.getElementById('receiveDialog').removeAttribute('show');
        setTimeout(() => URL.revokeObjectURL(url), 100);
    };
});

function updateState() {
    const count = peersContainer.children.length;
    noPeers.style.display = count > 0 ? 'none' : 'flex';
}

function getIcon(type) {
    if(type === 'mobile') return 'phone-iphone';
    if(type === 'tablet') return 'tablet-mac';
    return 'desktop-mac';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

function playSound(id) {
    const audio = document.getElementById(id);
    if(audio) audio.play().catch(e => {});
}