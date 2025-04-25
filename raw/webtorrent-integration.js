/**
 * Example code for WebTorrent integration in the Virtuaplex client
 */

// Initialize WebTorrent client
const WebTorrent = require('webtorrent');
const client = new WebTorrent();

// Function to start streaming a movie from a magnet link
function streamMovie(magnetLink, videoElement) {
  return new Promise((resolve, reject) => {
    client.add(magnetLink, torrent => {
      // Get the largest file as the movie file
      const file = torrent.files.reduce((prev, current) => {
        return (prev.length > current.length) ? prev : current;
      });
      
      // Stream to video element
      file.renderTo(videoElement);
      
      // Gather statistics
      const stats = {
        progress: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        timeRemaining: 0
      };
      
      const updateStats = () => {
        stats.progress = Math.round(torrent.progress * 100 * 100) / 100;
        stats.downloadSpeed = torrent.downloadSpeed;
        stats.uploadSpeed = torrent.uploadSpeed;
        stats.numPeers = torrent.numPeers;
        stats.timeRemaining = torrent.timeRemaining;
        
        // Emit statistics to update UI
        if (window.socket) {
          window.socket.emit('torrent_stats', stats);
        }
      };
      
      // Update statistics every second
      const statsInterval = setInterval(updateStats, 1000);
      
      torrent.on('done', () => {
        console.log('Torrent download complete');
        clearInterval(statsInterval);
        updateStats();
      });
      
      torrent.on('error', err => {
        clearInterval(statsInterval);
        reject(err);
      });
      
      resolve({
        torrent,
        file,
        stats,
        stopStreaming: () => {
          clearInterval(statsInterval);
          client.remove(torrent);
        }
      });
    });
  });
}

// Example of how to use the streaming function
function initializeMoviePlayer(magnetLink, lobbyId) {
  const videoElement = document.getElementById('movie-player');
  
  // Connect to WebSocket for synchronized playback
  const socket = io(`/ws/lobbies/${lobbyId}`);
  window.socket = socket;
  
  // Start streaming the movie
  streamMovie(magnetLink, videoElement)
    .then(stream => {
      // Store stream object for later use
      window.currentStream = stream;
      
      // Listen for playback control events
      socket.on('playback_status', data => {
        if (data.status === 'playing') {
          videoElement.currentTime = data.position;
          videoElement.play();
        } else if (data.status === 'paused') {
          videoElement.pause();
          videoElement.currentTime = data.position;
        }
      });
      
      // Synchronize local playback events with other viewers
      videoElement.addEventListener('play', () => {
        socket.emit('update_playback', {
          status: 'playing',
          position: videoElement.currentTime
        });
      });
      
      videoElement.addEventListener('pause', () => {
        socket.emit('update_playback', {
          status: 'paused',
          position: videoElement.currentTime
        });
      });
      
      videoElement.addEventListener('seeking', () => {
        socket.emit('update_playback', {
          status: videoElement.paused ? 'paused' : 'playing',
          position: videoElement.currentTime
        });
      });
    })
    .catch(err => {
      console.error('Error streaming movie:', err);
    });
}