document.addEventListener('DOMContentLoaded', () => {
    // Set up console messages to also display on screen for debugging
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    
    const debugElement = document.createElement('div');
    debugElement.id = 'debug-console';
    debugElement.style.position = 'fixed';
    debugElement.style.bottom = '0';
    debugElement.style.left = '0';
    debugElement.style.width = '100%';
    debugElement.style.maxHeight = '200px';
    debugElement.style.overflowY = 'auto';
    debugElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    debugElement.style.color = '#fff';
    debugElement.style.padding = '10px';
    debugElement.style.fontSize = '12px';
    debugElement.style.fontFamily = 'monospace';
    debugElement.style.zIndex = '9999';
    debugElement.style.display = 'none'; // Hidden by default
    
    document.body.appendChild(debugElement);
    
    // Add button to toggle debug console
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle Debug Console';
    toggleButton.style.position = 'fixed';
    toggleButton.style.bottom = '10px';
    toggleButton.style.right = '10px';
    toggleButton.style.zIndex = '10000';
    toggleButton.addEventListener('click', () => {
        debugElement.style.display = debugElement.style.display === 'none' ? 'block' : 'none';
    });
    document.body.appendChild(toggleButton);
    
    function addLogToDebug(type, ...args) {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return arg.toString();
                }
            }
            return arg;
        }).join(' ');
        
        const logElement = document.createElement('div');
        logElement.className = `log-${type}`;
        logElement.style.borderBottom = '1px solid #333';
        logElement.style.padding = '2px 0';
        
        // Add timestamp
        const timestamp = new Date().toISOString().substr(11, 8);
        logElement.textContent = `[${timestamp}] ${message}`;
        
        // Style based on type
        if (type === 'error') {
            logElement.style.color = '#ff5555';
        } else if (type === 'warn') {
            logElement.style.color = '#ffaa55';
        }
        
        debugElement.appendChild(logElement);
        debugElement.scrollTop = debugElement.scrollHeight;
    }
    
    console.log = function(...args) {
        originalConsoleLog.apply(console, args);
        addLogToDebug('log', ...args);
    };
    
    console.error = function(...args) {
        originalConsoleError.apply(console, args);
        addLogToDebug('error', ...args);
    };
    
    console.warn = function(...args) {
        originalConsoleWarn.apply(console, args);
        addLogToDebug('warn', ...args);
    };
    
    // Elements
    const loadingSection = document.getElementById('loading-section');
    const theaterSection = document.getElementById('theater-section');
    const userNameElement = document.getElementById('user-name');
    const videoElement = document.getElementById('movie-screen');
    const seatsGrid = document.getElementById('seats-grid');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const visitorsList = document.getElementById('visitors-list');
    
    // Global variables
    let p2p = null;
    let currentSeat = null;
    
    // Movie-themed adjectives and nouns for generating names
    const movieAdjectives = [
        "Epic", "Cinematic", "Dramatic", "Golden", "Classic", "Silver", "Stellar", "Blockbuster", 
        "Reel", "Legendary", "Premiere", "Oscar", "Dazzling", "Famous", "Acclaimed", "Vintage",
        "Hilarious", "Mysterious", "Thrilling", "Magical", "Surreal", "Animated", "Digital",
        "Spectacular", "Suspenseful", "Action", "Charming", "Romantic", "Glorious", "Futuristic"
    ];
    
    const movieNouns = [
        "Director", "Star", "Actor", "Scene", "Script", "Reel", "Ticket", "Screenplay", "Camera",
        "Premiere", "Spotlight", "Marquee", "Frame", "Popcorn", "Plot", "Character", "Trailer",
        "Oscar", "Film", "Role", "Audience", "Usher", "Montage", "Studio", "Score", "Soundtrack",
        "Cameo", "Producer", "Set", "Critic", "Projector", "Stunt", "Blockbuster", "Feature"
    ];
    
    // Generate a random movie-themed name
    function generateMovieName() {
        const adjective = movieAdjectives[Math.floor(Math.random() * movieAdjectives.length)];
        const noun = movieNouns[Math.floor(Math.random() * movieNouns.length)];
        return `${adjective}${noun}`;
    }
    
    // Automatically join the default screening
    async function autoJoinScreening() {
        try {
            console.log("Starting auto-join process...");
            
            const visitorName = generateMovieName();
            console.log("Generated visitor name:", visitorName);
            userNameElement.textContent = visitorName;
            
            // Get visitor token from server
            console.log("Requesting visitor token from server...");
            const response = await fetch('/api/auth/visitor', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    screening_id: 'default',
                    visitor_name: visitorName
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error("Failed to authenticate:", response.status, errorText);
                throw new Error(`Failed to authenticate (${response.status}): ${errorText}`);
            }
            
            const data = await response.json();
            console.log("Received authentication response:", data);
            const visitorToken = data.token;
            
            // Initialize P2P communication
            console.log("Initializing P2P communication...");
            p2p = new VirtualplexP2P('default', visitorToken);
            await p2p.initialize(videoElement);
            
            // Get screening details
            console.log("Fetching screening details...");
            const screeningResponse = await fetch('/api/screenings/default', {
                headers: {
                    'Authorization': `Bearer ${visitorToken}`
                }
            });
            
            if (!screeningResponse.ok) {
                const errorText = await screeningResponse.text();
                console.error("Failed to get screening details:", screeningResponse.status, errorText);
                throw new Error(`Failed to get screening details (${screeningResponse.status}): ${errorText}`);
            }
            
            const screeningData = await screeningResponse.json();
            console.log("Received screening data:", screeningData);
            
            // Show theater UI
            loadingSection.classList.add('hidden');
            theaterSection.classList.remove('hidden');
            
            // Render seats
            console.log("Rendering seats...");
            renderSeats(screeningData.seats);
            
            // Start movie streaming
            if (screeningData.magnet_link) {
                console.log("Starting movie streaming with magnet link:", screeningData.magnet_link);
                try {
                    await p2p.startStreaming(screeningData.magnet_link);
                    console.log("Movie streaming started successfully");
                } catch (streamingError) {
                    console.error("Failed to start streaming:", streamingError);
                    
                    // Even if streaming fails, we can still continue with chat and seat selection
                    alert("Failed to start movie streaming, but you can still chat and select a seat.\n\n" + streamingError.message);
                }
            } else {
                console.warn("No magnet link provided for streaming");
            }
            
        } catch (error) {
            console.error('Error joining screening', error);
            alert(`Error joining screening: ${error.message}`);
        }
    }
    
    // Render the seats grid
    function renderSeats(seatsData) {
        console.log("Rendering seats grid with data:", seatsData);
        seatsGrid.innerHTML = '';
        
        const rows = seatsData.rows;
        const seatsPerRow = seatsData.seats_per_row;
        
        for (let row = 0; row < rows; row++) {
            for (let seat = 0; seat < seatsPerRow; seat++) {
                const seatElement = document.createElement('div');
                seatElement.className = 'seat';
                seatElement.dataset.row = row;
                seatElement.dataset.seat = seat;
                seatElement.textContent = `${String.fromCharCode(65 + row)}${seat + 1}`;
                
                // Check if seat is occupied
                const occupied = seatsData.occupied.some(s => s.row === row && s.seat === seat);
                if (occupied) {
                    console.log(`Seat ${row}:${seat} is occupied`);
                    seatElement.classList.add('occupied');
                } else {
                    seatElement.addEventListener('click', () => selectSeat(row, seat, seatElement));
                }
                
                seatsGrid.appendChild(seatElement);
            }
        }
    }
    
    // Select a seat
    async function selectSeat(row, seat, seatElement) {
        if (!p2p) {
            console.error("Cannot select seat, P2P not initialized");
            return;
        }
        
        try {
            console.log(`Selecting seat at row ${row}, seat ${seat}`);
            
            // If we already have a seat, release it first
            if (currentSeat) {
                console.log("Releasing current seat before selecting new one");
                await p2p.releaseSeat();
                currentSeat.classList.remove('selected');
                currentSeat = null;
            }
            
            // Select the new seat
            console.log("Sending seat selection request...");
            const response = await p2p.selectSeat(row, seat);
            
            if (response.success) {
                console.log("Seat selection successful:", response);
                seatElement.classList.add('selected');
                currentSeat = seatElement;
            } else {
                console.warn("Seat selection failed:", response);
                alert('Failed to select seat. It might be already taken.');
            }
        } catch (error) {
            console.error('Error selecting seat', error);
            alert(`Error selecting seat: ${error.message}`);
        }
    }
    
    // Handle chat form submission
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const text = chatInput.value.trim();
        if (!text || !p2p) {
            console.warn("Cannot send chat: empty message or P2P not initialized");
            return;
        }
        
        console.log("Sending chat message:", text);
        p2p.sendChat(text);
        chatInput.value = '';
    });
    
    // Update chat UI
    window.updateChat = (messages) => {
        console.log(`Updating chat UI with ${messages.length} messages`);
        chatMessages.innerHTML = '';
        
        messages.forEach(msg => {
            const messageElement = document.createElement('div');
            messageElement.className = 'chat-message';
            
            const senderElement = document.createElement('div');
            senderElement.className = 'sender';
            senderElement.textContent = msg.from === p2p.visitorId ? 'You' : `Visitor ${msg.from.substring(0, 6)}`;
            
            const textElement = document.createElement('div');
            textElement.className = 'text';
            textElement.textContent = msg.text;
            
            const timestampElement = document.createElement('div');
            timestampElement.className = 'timestamp';
            timestampElement.textContent = new Date(msg.timestamp).toLocaleTimeString();
            
            messageElement.appendChild(senderElement);
            messageElement.appendChild(textElement);
            messageElement.appendChild(timestampElement);
            
            chatMessages.appendChild(messageElement);
        });
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    
    // Update visitor positions UI
    window.updateVisitorPositions = (positions) => {
        console.log("Updating visitor positions:", positions);
        visitorsList.innerHTML = '';
        
        Object.keys(positions).forEach(visitorId => {
            const listItem = document.createElement('li');
            listItem.textContent = `Visitor ${visitorId.substring(0, 6)}`;
            visitorsList.appendChild(listItem);
        });
    };
    
    // Update seat information UI
    window.updateSeatInformation = (seatData) => {
        console.log("Updating seat information:", seatData);
        // Update the seats grid with new occupancy data
        const allSeats = seatsGrid.querySelectorAll('.seat');
        
        allSeats.forEach(seat => {
            const row = parseInt(seat.dataset.row);
            const seatNum = parseInt(seat.dataset.seat);
            
            // Reset state
            seat.classList.remove('occupied');
            if (currentSeat !== seat) {
                seat.classList.remove('selected');
            }
            
            // Check if seat is occupied
            const occupied = seatData.occupied.some(s => s.row === row && s.seat === seatNum);
            if (occupied) {
                seat.classList.add('occupied');
            }
        });
    };
    
    // Start auto-join process when page loads
    console.log("Page loaded, starting auto-join process...");
    autoJoinScreening();
    
    // Handle window beforeunload event
    window.addEventListener('beforeunload', () => {
        console.log("Page unloading, cleaning up...");
        if (p2p) {
            p2p.cleanup();
        }
    });
});