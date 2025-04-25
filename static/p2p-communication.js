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
        console.log("Visitor ID extracted from token:", this.visitorId);
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
    
    console.log("VirtualplexP2P instance created for screening:", screeningId);
  }
  
  /**
   * Initialize the P2P connection and join the screening
   */
  async initialize(videoElement) {
    console.log("Initializing P2P connection...");
    this.videoElement = videoElement;
    
    // Connect to signaling WebSocket
    try {
      console.log("Connecting to WebSocket...");
      await this.connectSignaling();
      console.log("WebSocket connection established successfully");
    } catch (error) {
      console.error("Failed to connect to WebSocket:", error);
      throw error;
    }
    
    // Setup heartbeat to keep seat reservation active
    this.startHeartbeat();
    
    // Listen for window close/refresh to clean up
    window.addEventListener('beforeunload', () => this.cleanup());
    
    console.log("P2P connection initialized successfully");
  }
  
  /**
   * Connect to the signaling WebSocket
   */
  async connectSignaling() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/screenings/${this.screeningId}`;
      console.log("Connecting to WebSocket URL:", wsUrl);
      
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        // Authenticate the WebSocket connection
        console.log("WebSocket opened, sending authentication...");
        this.socket.send(JSON.stringify({
          type: 'authenticate',
          data: {
            token: this.visitorToken
          }
        }));
        
        console.log('Connected to signaling server');
        resolve();
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error', error);
        reject(error);
      };
      
      this.socket.onclose = (event) => {
        console.log('Disconnected from signaling server', event.code, event.reason);
        // Try to reconnect after a delay
        setTimeout(() => this.connectSignaling(), 5000);
      };
      
      this.socket.onmessage = (event) => {
        console.log("WebSocket message received:", event.data.substring(0, 100) + "...");
        const message = JSON.parse(event.data);
        this.handleSignalingMessage(message);
      };
    });
  }
  
  /**
   * Handle incoming messages from the signaling server
   */
  handleSignalingMessage(message) {
    console.log("Handling signaling message type:", message.type);
    
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
        console.log('Received WebRTC signal from', message.data.from);
        this.handleWebRTCSignal(message.data);
        break;
        
      case 'seat_update':
        // Update the UI to reflect seat changes
        console.log('Seat update received');
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
        
      case 'authenticated':
        console.log('WebSocket authenticated:', message.data);
        break;
        
      case 'error':
        console.error('WebSocket error message:', message.data);
        break;
        
      default:
        console.log('Unknown message type:', message.type);
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
        console.log('Sending ICE candidate to', targetVisitorId);
        this.sendSignal(targetVisitorId, 'ice-candidate', event.candidate);
      }
    };
    
    // Create and send offer
    peerConnection.createOffer()
      .then(offer => {
        console.log('Created offer, setting local description');
        return peerConnection.setLocalDescription(offer);
      })
      .then(() => {
        console.log('Sending offer to', targetVisitorId);
        this.sendSignal(targetVisitorId, 'offer', peerConnection.localDescription);
      })
      .catch(error => console.error('Error creating offer', error));
    
    // Handle incoming data channels
    peerConnection.ondatachannel = (event) => {
      console.log('Received data channel from', targetVisitorId);
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
      console.log('Received data channel message from', peerId);
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'chat':
          // Handle chat message
          console.log('Received chat message from', peerId);
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
          console.log('Received playback sync from', peerId, message);
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
    
    console.log('Received WebRTC signal:', type, 'from:', from);
    
    // Skip if we don't have a connection yet
    if (!this.peers[from]) {
      console.log('Creating new peer connection for', from);
      this.initiatePeerConnection(from);
    }
    
    const peerConnection = this.peers[from];
    
    switch (type) {
      case 'offer':
        console.log('Processing offer from', from);
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload))
          .then(() => {
            console.log('Remote description set, creating answer');
            return peerConnection.createAnswer();
          })
          .then(answer => {
            console.log('Answer created, setting local description');
            return peerConnection.setLocalDescription(answer);
          })
          .then(() => {
            console.log('Sending answer to', from);
            this.sendSignal(from, 'answer', peerConnection.localDescription);
          })
          .catch(error => console.error('Error handling offer', error));
        break;
        
      case 'answer':
        console.log('Processing answer from', from);
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload))
          .then(() => console.log('Remote description set for answer'))
          .catch(error => console.error('Error handling answer', error));
        break;
        
      case 'ice-candidate':
        console.log('Adding ICE candidate from', from);
        peerConnection.addIceCandidate(new RTCIceCandidate(payload))
          .then(() => console.log('ICE candidate added successfully'))
          .catch(error => console.error('Error adding ICE candidate', error));
        break;
    }
  }
  
  /**
   * Send a WebRTC signaling message
   */
  sendSignal(targetId, type, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log('Sending signal:', type, 'to:', targetId);
      this.socket.send(JSON.stringify({
        type: 'webrtc_signal',
        data: {
          target: targetId,
          type: type,
          payload: payload
        }
      }));
    } else {
      console.error('Cannot send signal, WebSocket not open');
    }
  }
  
  /**
   * Select a seat in the screening
   */
  selectSeat(row, seat) {
    console.log('Selecting seat:', row, seat);
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
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Seat selection response:', data);
      return data;
    })
    .catch(error => {
      console.error('Error selecting seat:', error);
      throw error;
    });
  }
  
  /**
   * Release the currently selected seat
   */
  releaseSeat() {
    console.log('Releasing seat');
    return fetch(`/api/screenings/${this.screeningId}/seats/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.visitorToken}`
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Seat release response:', data);
      return data;
    })
    .catch(error => {
      console.error('Error releasing seat:', error);
      throw error;
    });
  }
  // Update the startStreaming method in p2p-communication.js

/**
 * Start the WebTorrent streaming
 */
startStreaming(magnetLink) {
  console.log('Starting WebTorrent streaming with magnet link:', magnetLink);
  
  // Use the globally available WebTorrent object instead of require
  if (typeof WebTorrent === 'undefined') {
    console.error('WebTorrent is not defined. Make sure to include the WebTorrent script in your HTML.');
    return Promise.reject(new Error('WebTorrent is not defined'));
  }
  
  console.log('Creating new WebTorrent client...');
  const client = new WebTorrent({
    // Enable debugging
    maxConns: 100,       // Max number of connections per torrent
    tracker: {
      announce: [], // Use default trackers in the magnet link
      rtcConfig: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' }
        ]
      }
    }
  });
  
  return new Promise((resolve, reject) => {
    console.log('Adding torrent to WebTorrent client...');
    
    let loadStartTime = Date.now();
    
    // Add more event handlers to the client
    client.on('error', error => {
      console.error('WebTorrent client error:', error);
      reject(new Error(`WebTorrent client error: ${error.message}`));
    });
    
    client.on('warning', warning => {
      console.warn('WebTorrent warning:', warning);
    });
    
    try {
      // Parse the magnet link to extract trackers for debugging
      const trackers = magnetLink.match(/tr=([^&]+)/g);
      if (trackers) {
        console.log('Trackers in magnet link:', trackers.map(t => decodeURIComponent(t.replace('tr=', ''))));
      }
      
      // Start the download
      const torrent = client.add(magnetLink, {
        announce: [] // Use the trackers in the magnet link
      }, (torrent) => {
        console.log('Torrent added successfully, info hash:', torrent.infoHash);
        this.torrent = torrent;
        
        // Get the largest file as the movie file
        console.log('Torrent has', torrent.files.length, 'files');
        
        if (torrent.files.length === 0) {
          const error = new Error('Torrent contains no files');
          console.error(error);
          reject(error);
          return;
        }
        
        const file = torrent.files.reduce((prev, current) => {
          console.log('File:', current.name, 'Size:', current.length);
          return (prev.length > current.length) ? prev : current;
        });
        
        console.log('Selected largest file for playback:', file.name, 'Size:', file.length);
        
        // Stream to video element
        console.log('Rendering file to video element...');
        file.renderTo(this.videoElement, {
          autoplay: false,  // Don't autoplay until we're ready
          controls: true,   // Use video controls
        }, (err) => {
          if (err) {
            console.error('Error rendering file to video element:', err);
            reject(new Error(`Error rendering file: ${err.message}`));
            return;
          }
          
          console.log('File rendered to video element successfully');
          
          // Handle playback events for synchronization
          this.videoElement.addEventListener('play', () => {
            console.log('Video played at time:', this.videoElement.currentTime);
            this.broadcastPlaybackState();
          });
          
          this.videoElement.addEventListener('pause', () => {
            console.log('Video paused at time:', this.videoElement.currentTime);
            this.broadcastPlaybackState();
          });
          
          this.videoElement.addEventListener('seeking', () => {
            console.log('Video seeking to', this.videoElement.currentTime);
            this.broadcastPlaybackState();
          });
          
          this.videoElement.addEventListener('canplay', () => {
            console.log('Video can play now');
          });
          
          this.videoElement.addEventListener('error', (e) => {
            console.error('Video element error:', this.videoElement.error);
          });
          
          resolve(torrent);
        });
      });
      
      // Add more torrent event listeners for debugging
      torrent.on('infoHash', () => {
        console.log('Got info hash:', torrent.infoHash);
      });
      
      torrent.on('metadata', () => {
        console.log('Got metadata, name:', torrent.name);
      });
      
      torrent.on('ready', () => {
        console.log('Torrent ready, starting download...');
      });
      
      torrent.on('download', bytes => {
        const progress = (torrent.progress * 100).toFixed(1);
        // Log progress less frequently to avoid console flood
        if (Math.floor(progress) % 10 === 0) {
          console.log('Download progress:', progress + '%', 
                      'Speed:', (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
                      'Peers:', torrent.numPeers);
        }
      });
      
      torrent.on('noPeers', announceType => {
        console.warn('No peers found:', announceType);
      });
      
      torrent.on('wire', (wire, addr) => {
        console.log('Connected to peer:', addr);
      });
      
      torrent.on('done', () => {
        console.log('Torrent download completed in', (Date.now() - loadStartTime) / 1000, 'seconds');
      });
      
      // Handle timeout
      setTimeout(() => {
        if (!torrent.ready) {
          console.error('Torrent timed out after 30 seconds with no metadata');
          // Don't reject promise, but provide warning
          console.warn('Continuing without complete torrent metadata. Streaming might be delayed.');
        }
      }, 30000);
      
    } catch (err) {
      console.error('Exception adding torrent:', err);
      reject(new Error(`Exception adding torrent: ${err.message}`));
    }
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
    
    console.log('Broadcasting playback state:', playbackInfo);
    
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
    
    console.log('Sending chat message:', text);
    
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
    console.log('Starting heartbeat interval');
    this.heartbeatInterval = setInterval(() => {
      console.log('Sending heartbeat...');
      fetch(`/api/screenings/${this.screeningId}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.visitorToken}`
        }
      })
      .then(response => response.json())
      .then(data => console.log('Heartbeat response:', data))
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
    console.log('Cleaning up connections');
    
    // Release seat
    this.releaseSeat().catch(error => console.error('Error releasing seat during cleanup:', error));
    
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
    
    console.log('Cleanup completed');
  }
}