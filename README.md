# Antigravity 🪐⚡

> **Blazing-Fast Local Network P2P File-Sharing Engine with "iOS 27" Glassmorphic Design**

Antigravity enables instantaneous file transfers between devices on the same Wi-Fi or Local Area Network (LAN). Powered by direct **WebRTC DataChannels** and a lightweight **Socket.io** signaling server, transfers bypass external servers entirely and saturate maximum local hardware bandwidth with **zero file-size limits**.

---

## 🌟 Highlights

- **Direct WebRTC P2P DataChannels:** Zero cloud relay. Transfers stream directly device-to-device at full Wi-Fi speeds (e.g., 50–100+ MB/s on modern Wi-Fi 6 / LAN).
- **Backpressure Flow Control & 64 KB Chunking:** Safely streams massive multi-gigabyte files (movies, archives, raw footage) without RAM bloat or buffer overflow.
- **Auto-Discovery on Local Network:** Any device connecting to the local IP automatically appears on the orbital radar as a glowing node.
- **"iOS 27" / visionOS Design Language:**
  - **Glassmorphism 2.0:** Hyper-clean `backdrop-blur-3xl`, frosted surfaces, specular rim highlights.
  - **Dynamic Island Status HUD:** Morphing status capsule at top of screen with real-time MB/s counter, circular SVG progress ring, and fluid spring animations.
  - **Magnetic Sonar Radar:** Discovered peers float in orbital tracks with interactive drop zones.
  - **Full-Screen Drag & Drop:** Drag files anywhere to illuminate drop targets, or click any node to browse.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Unified Server (Frontend + Signaling on 0.0.0.0:3000)
```bash
npm run dev
```

The server automatically detects your machine's local Wi-Fi / Ethernet IPv4 address and prints it to the console:
```text
======================================================
   ANTIGRAVITY - LOCAL P2P FILE SHARING ENGINE
======================================================
 Localhost:      http://localhost:3000
 Wi-Fi / LAN IP:
   -> http://192.168.1.15:3000   (Wi-Fi)
 Open this URL on your other phone/laptop on the same Wi-Fi!
======================================================
```

### 3. Share Across Devices
1. Open `http://localhost:3000` on your computer.
2. Open `http://192.168.x.x:3000` on your iPhone, Android, iPad, or another computer connected to the same Wi-Fi.
3. Both devices will appear on each other's radar screen as floating glowing nodes.
4. Drag and drop any file onto a node to transfer it instantly!

---

## 📐 Architecture

```
                      Local Wi-Fi Network
    [ Device A (Sender) ]               [ Device B (Receiver) ]
             |                                     |
             +-----> [ Socket.io Signaling ] <-----+
             |       (Discovery / Handshake)       |
             |                                     |
             +====================================>+
                 Direct WebRTC DataChannel (P2P)
                     64 KB Binary Chunks
                   Flow-Controlled Stream
```

1. **Signaling Server (`server.js`)**: Purely manages discovery rosters and relays WebRTC SDP offers/answers and ICE candidates over WebSockets. Once connected, no file data ever touches the server.
2. **WebRTC Hook (`src/hooks/useWebRTC.ts`)**:
   - Creates `RTCPeerConnection` and `RTCDataChannel`.
   - Chunks file into 64 KB slices via `File.slice()` and `arrayBuffer()`.
   - Listens to `dataChannel.bufferedAmount` with a 1 MB high-water mark and resumes upon `bufferedamountlow` to guarantee zero dropped packets.
   - Computes rolling speeds (MB/s) and estimated time remaining (ETA).
3. **UI Layer (`src/components/*`)**:
   - `DynamicIsland.tsx`: Smooth morphing layout using Framer Motion spring physics.
   - `RadarScreen.tsx`: Sonar sweeps, radial gradients, and orbital peer positioning.
   - `PeerNode.tsx`: Interactive glass orb with device platform badges and drag-over glow halos.
   - `DropZoneOverlay.tsx`: Global viewport drag detection.
   - `IncomingTransferModal.tsx`: iOS 27 action sheet for approving incoming files.
