// WebRTC configuration
const configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

let peerConnection = null;
let dataChannel = null;
let ws = null;
let myPeerId = null;
let currentFile = null;
let receivedSize = 0;
let fileSize = 0;
const CHUNK_SIZE = 16384; // 16KB chunks

// Connect to signaling server
function connectToSignalingServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'id':
                myPeerId = data.peerId;
                document.getElementById('peerId').textContent = myPeerId;
                document.getElementById('fileInput').disabled = false;
                break;

            case 'offer':
                await handleOffer(data);
                break;

            case 'answer':
                await handleAnswer(data);
                break;

            case 'ice-candidate':
                await handleIceCandidate(data);
                break;
        }
    };

    ws.onclose = () => {
        updateStatus('Disconnected from server', 'error');
    };
}

// Initialize the application
function init() {
    connectToSignalingServer();

    document.getElementById('connectBtn').addEventListener('click', initiateConnection);
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('sendBtn').addEventListener('click', sendFile);
}

// Update status with appropriate styling
function updateStatus(message, type = 'progress') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = type;
}

// Handle file selection
function handleFileSelect(event) {
    currentFile = event.target.files[0];
    if (currentFile) {
        document.getElementById('sendBtn').disabled = false;
        updateStatus(`Selected file: ${currentFile.name} (${formatFileSize(currentFile.size)})`);
    }
}

// Format file size in human-readable format
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initiate connection to another peer
async function initiateConnection() {
    const targetPeerId = document.getElementById('targetPeerId').value;
    if (!targetPeerId) {
        updateStatus('Please enter a peer ID', 'error');
        return;
    }

    try {
        peerConnection = new RTCPeerConnection(configuration);
        setupPeerConnectionHandlers(targetPeerId);

        // Create data channel
        dataChannel = peerConnection.createDataChannel('fileTransfer');
        setupDataChannelHandlers(dataChannel);

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        ws.send(JSON.stringify({
            type: 'offer',
            target: targetPeerId,
            offer: offer
        }));

        updateStatus('Connecting to peer...');
    } catch (error) {
        updateStatus('Failed to create connection: ' + error, 'error');
    }
}

// Handle incoming connection offer
async function handleOffer(data) {
    try {
        peerConnection = new RTCPeerConnection(configuration);
        setupPeerConnectionHandlers(data.from);

        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannelHandlers(dataChannel);
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            target: data.from,
            answer: answer
        }));

        updateStatus('Connecting to peer...');
    } catch (error) {
        updateStatus('Failed to handle offer: ' + error, 'error');
    }
}

// Handle incoming connection answer
async function handleAnswer(data) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
        updateStatus('Failed to handle answer: ' + error, 'error');
    }
}

// Handle incoming ICE candidate
async function handleIceCandidate(data) {
    try {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        updateStatus('Failed to handle ICE candidate: ' + error, 'error');
    }
}

// Setup peer connection handlers
function setupPeerConnectionHandlers(targetPeerId) {
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target: targetPeerId,
                candidate: event.candidate
            }));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
            updateStatus('Connected to peer', 'success');
        }
    };
}

// Setup data channel handlers
function setupDataChannelHandlers(channel) {
    channel.onopen = () => {
        updateStatus('Data channel opened', 'success');
        document.getElementById('fileInput').disabled = false;
    };

    channel.onclose = () => {
        updateStatus('Data channel closed');
        document.getElementById('fileInput').disabled = true;
        document.getElementById('sendBtn').disabled = true;
    };

    channel.onerror = (error) => {
        updateStatus('Data channel error: ' + error, 'error');
    };

    // Handle incoming file data
    let receivedData = [];
      let fileMetadata = null;
    channel.onmessage = (event) => {
        const data = event.data;
        if (typeof data === 'string') {
            // Metadata message
            fileMetadata = JSON.parse(data);
            fileSize = fileMetadata.fileSize;
            receivedSize = 0;
            receivedData = [];
            updateStatus(`Receiving file: ${fileMetadata.fileName}`);
        } else {
            // File chunk received
            receivedData.push(data);
            receivedSize += data.byteLength;
            const progress = Math.round((receivedSize / fileSize) * 100);
            updateStatus(`Receiving file: ${progress}%`);

            if (receivedSize === fileSize && fileMetadata) {
                // File transfer completed
                const blob = new Blob(receivedData);
                const downloadUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                document.body.appendChild(a);
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = fileMetadata.fileName;
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(downloadUrl);
                updateStatus('File received successfully', 'success');
                // Reset for next transfer
                receivedData = [];
                fileMetadata = null;
                receivedSize = 0;
                fileSize = 0;
            }
        }
    };
}

// Send file to connected peer
async function sendFile() {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        updateStatus('No connection to peer', 'error');
        return;
    }

    if (!currentFile) {
        updateStatus('Please select a file first', 'error');
        return;
    }

    try {
        // Send file metadata
        dataChannel.send(JSON.stringify({
            fileName: currentFile.name,
            fileSize: currentFile.size,
            fileType: currentFile.type
        }));

        // Send file in chunks
        const reader = new FileReader();
        let offset = 0;

        reader.onload = (event) => {
            dataChannel.send(event.target.result);
            offset += event.target.result.byteLength;
            const progress = Math.round((offset / currentFile.size) * 100);
            updateStatus(`Sending file: ${progress}%`);

            if (offset < currentFile.size) {
                // Read next chunk
                readChunk(offset);
            } else {
                updateStatus('File sent successfully', 'success');
            }
        };

        const readChunk = (offset) => {
            const slice = currentFile.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        readChunk(0);
    } catch (error) {
        updateStatus('Failed to send file: ' + error, 'error');
    }
}

// Initialize the application when the page loads
window.addEventListener('load', init);