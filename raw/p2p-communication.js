/**
 * Example code for P2P communication in the Virtuaplex client
 */

class VirtualplexP2P {
  constructor(screeningId, visitorToken) {
    // Store visitor information
    this.screeningId = screeningId;
    this.visitorToken = visitorToken;
    this.visitorId = null; // Will be extracted from token
    
    // Parse JWT token to get visitor ID
    const tokenParts = visitorToken.split('.');
    if (tokenParts.length === 3) {
      try {
        const payload = JSON.parse(atob(tokenParts[1]));
        this.visitorId = payload.sub;
      } catch (e) {
        console.error('Error parsing visitor token', e);
      }
    }
    
    // WebSocket connection for signaling
    this.socket = null;
    
    // WebRTC connections to other visitors
    this.peers = {};
    
    // Movie streaming data
    this.torrent = null;
    this.videoElement = null;
    
    // Position data from other visitors
    this.visitorPositions = {};
    
    // Chat history
    this.chatMessages = [];
  }
  
  /**
   * Initialize the P2P connection and join the screening
   */
  async initialize(videoElement) {
    this.videoElement = videoElement;
    
    // Connect to signaling WebSocket
    await this.connectSignaling();
    
    // Setup heartbeat to keep seat reservation active
    this.startHeartbeat();
    
    // Listen for window close/refresh to clean up
    window.addEventListener('beforeunload', () => this.cleanup());
  }
  
  /**
   * Connect to the signaling WebSocket
   */
  async connectSignaling() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/screenings/${this.screeningId}`);
      
      this.socket.onopen = () => {
        // Authenticate the WebSocket connection
        this.socket.send(JSON.stringify({
          type: 'authenticate',
          token: this.visitorToken
        }));
        
        console.log('Connected to signaling server');
        resolve();
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error', error);
        reject(error);
      };
      
      this.socket.onclose = () => {
        console.log('Disconnected from signaling server');
        // Try to reconnect after a delay
        setTimeout(() => this.connectSignaling(), 5000);
      };
      
      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleSignalingMessage(message);
      };
    });
  }
  
  /**
   * Handle incoming messages from the signaling server
   */
  handleSignalingMessage(message) {
    switch (message.type) {
      case 'visitor_joined':
        // New visitor joined, initiate WebRTC connection
        console.log('New visitor joined', message.data.visitor);
        this.initiatePeerConnection(message.data.visitor.id);
        break;
        
      case 'visitor_left':
        // Visitor left, clean up their connection
        console.log('Visitor left', message.data.visitor_id);
        if (this.peers[message.data.visitor_id]) {
          this.peers[message.data.visitor_id].close();
          delete this.peers[message.data.visitor_id];
        }
        delete this.visitorPositions[message.data.visitor_id];
        break;
        
      case 'webrtc_signal':
        // Handle WebRTC signaling
        this.handleWebRTCSignal(message.data);
        break;
        
      case 'seat_update':
        // Update the UI to reflect seat changes
        console.log('Seat update', message.data);
        // Update UI with new seat information
        if (typeof window.updateSeatInformation === 'function') {
          window.updateSeatInformation(message.data);
        }
        break;
        
      case 'screening_status':
        // Update screening status (e.g., ending soon)
        console.log('Screening status update', message.data);
        if (message.data.status === 'ended') {
          this.cleanup();
        }
        break;
    }
  }
  
  /**
   * Initiate a WebRTC peer connection with another visitor
   */
  initiatePeerConnection(targetVisitorId) {
    // Skip if we already have a connection or it's ourselves
    if (this.peers[targetVisitorId] || targetVisitorId === this.visitorId) {
      return;
    }
    
    console.log('Initiating peer connection with', targetVisitorId);
    
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    this.peers[targetVisitorId] = peerConnection;
    
    // Setup data channel for chat and position updates
    const dataChannel = peerConnection.createDataChannel('virtuaplex_data');
    this.setupDataChannel(dataChannel, targetVisitorId);
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(targetVisitorId, 'ice-candidate', event.candidate);
      }
    };
    
    // Create and send offer
    peerConnection.createOffer()
      .then(offer => peerConnection.setLocalDescription(offer))
      .then(() => {
        this.sendSignal(targetVisitorId, 'offer', peerConnection.localDescription);
      })
      .catch(error => console.error('Error creating offer', error));
    
    // Handle incoming data channels
    peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, targetVisitorId);
    };
  }
  
  /**
   * Set up a WebRTC data channel for chat and position updates
   */
  setupDataChannel(dataChannel, peerId) {
    dataChannel.onopen = () => {
      console.log('Data channel opened with', peerId);
    };
    
    dataChannel.onclose = () => {
      console.log('Data channel closed with', peerId);
    };
    
    dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'chat':
          // Handle chat message
          this.chatMessages.push({
            from: peerId,
            text: message.text,
            timestamp: new Date()
          });
          if (typeof window.updateChat === 'function') {
            window.updateChat(this.chatMessages);
          }
          break;
          
        case 'position':
          // Handle position update
          this.visitorPositions[peerId] = message.position;
          if (typeof window.updateVisitorPositions === 'function') {
            window.updateVisitorPositions(this.visitorPositions);
          }
          break;
          
        case 'playback':
          // Handle playback sync
          if (this.videoElement && Math.abs(this.videoElement.currentTime - message.position) > 5) {
            this.videoElement.currentTime = message.position;
            if (message.playing && this.videoElement.paused) {
              this.videoElement.play();
            } else if (!message.playing && !this.videoElement.paused) {
              this.videoElement.pause();
            }
          }
          break;
      }
    };
    
    // Store the data channel
    if (!this.peers[peerId].dataChannel) {
      this.peers[peerId].dataChannel = dataChannel;
    }
  }
  
  /**
   * Handle incoming WebRTC signaling messages
   */
  handleWebRTCSignal(data) {
    const { from, type, payload } = data;
    
    // Skip if we don't have a connection yet
    if (!this.peers[from]) {
      this.initiatePeerConnection(from);
    }
    
    const peerConnection = this.peers[from];
    
    switch (type) {
      case 'offer':
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload))
          .then(() => peerConnection.createAnswer())
          .then(answer => peerConnection.setLocalDescription(answer))
          .then(() => {
            this.sendSignal(from, 'answer', peerConnection.localDescription);
          })
          .catch(error => console.error('Error handling offer', error));
        break;
        
      case 'answer':
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload))
          .catch(error => console.error('Error handling answer', error));
        break;
        
      case 'ice-candidate':
        peerConnection.addIceCandidate(new RTCIceCandidate(payload))
          .catch(error => console.error('Error adding ICE candidate', error));
        break;
    }
  }
  
  /**
   * Send a WebRTC signaling message
   */
  sendSignal(targetId, type, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'webrtc_signal',
        data: {
          target: targetId,
          type: type,
          payload: payload
        }
      }));
    }
  }
  
  /**
   * Select a seat in the screening
   */
  selectSeat(row, seat) {
    return fetch(`/api/screenings/${this.screeningId}/seats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.visitorToken}`
      },
      body: JSON.stringify({
        row_number: row,
        seat_number: seat
      })
    })
    .then(response => response.json());
  }
  
  /**
   * Release the currently selected seat
   */
  releaseSeat() {
    return fetch(`/api/screenings/${this.screeningId}/seats/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.visitorToken}`
      }
    })
    .then(response => response.json());
  }
  
  /**
   * Start the WebTorrent streaming
   */
  startStreaming(magnetLink) {
    // Initialize WebTorrent client
    const WebTorrent = require('webtorrent');
    const client = new WebTorrent();
    
    return new Promise((resolve, reject) => {
      client.add(magnetLink, torrent => {
        this.torrent = torrent;
        
        // Get the largest file as the movie file
        const file = torrent.files.reduce((prev, current) => {
          return (prev.length > current.length) ? prev : current;
        });
        
        // Stream to video element
        file.renderTo(this.videoElement);
        
        // Handle playback events for synchronization
        this.videoElement.addEventListener('play', () => this.broadcastPlaybackState());
        this.videoElement.addEventListener('pause', () => this.broadcastPlaybackState());
        this.videoElement.addEventListener('seeking', () => this.broadcastPlaybackState());
        
        resolve(torrent);
      });
      
      client.on('error', error => {
        console.error('WebTorrent error', error);
        reject(error);
      });
    });
  }
  
  /**
   * Broadcast the current playback state to all peers
   */
  broadcastPlaybackState() {
    if (!this.videoElement) return;
    
    const playbackInfo = {
      type: 'playback',
      position: this.videoElement.currentTime,
      playing: !this.videoElement.paused
    };
    
    Object.values(this.peers).forEach(peer => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(JSON.stringify(playbackInfo));
      }
    });
  }
  
  /**
   * Send a chat message to all peers
   */
  sendChat(text) {
    const chatMessage = {
      type: 'chat',
      text: text,
      timestamp: new Date()
    };
    
    // Add to local chat history
    this.chatMessages.push({
      from: this.visitorId,
      text: text,
      timestamp: new Date()
    });
    
    if (typeof window.updateChat === 'function') {
      window.updateChat(this.chatMessages);
    }
    
    // Send to all peers
    Object.values(this.peers).forEach(peer => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(JSON.stringify(chatMessage));
      }
    });
  }
  
  /**
   * Update and broadcast the visitor's position
   */
  updatePosition(position, rotation) {
    const positionUpdate = {
      type: 'position',
      position: { position, rotation }
    };
    
    // Send to all peers
    Object.values(this.peers).forEach(peer => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(JSON.stringify(positionUpdate));
      }
    });
  }
  
  /**
   * Start heartbeat to keep the seat reservation active
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      fetch(`/api/screenings/${this.screeningId}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.visitorToken}`
        }
      })
      .then(response => response.json())
      .catch(error => console.error('Heartbeat error', error));
      
      // Also send heartbeat through WebSocket
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'heartbeat',
          data: {}
        }));
      }
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Clean up connections when leaving
   */
  cleanup() {
    // Release seat
    this.releaseSeat().catch(() => {});
    
    // Close WebRTC connections
    Object.values(this.peers).forEach(peer => {
      if (peer && peer.close) {
        peer.close();
      }
    });
    
    // Close WebSocket
    if (this.socket) {
      this.socket.close();
    }
    
    // Stop torrent client
    if (this.torrent && this.torrent.client) {
      this.torrent.client.destroy();
    }
    
    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}