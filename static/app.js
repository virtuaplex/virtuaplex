document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const loginSection = document.getElementById('login-section');
    const theaterSection = document.getElementById('theater-section');
    const loginForm = document.getElementById('login-form');
    const screeningIdInput = document.getElementById('screening-id');
    const visitorNameInput = document.getElementById('visitor-name');
    const videoElement = document.getElementById('movie-screen');
    const seatsGrid = document.getElementById('seats-grid');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const visitorsList = document.getElementById('visitors-list');
    
    // Global variables
    let p2p = null;
    let currentSeat = null;
    
    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const screeningId = screeningIdInput.value.trim();
        const visitorName = visitorNameInput.value.trim();
        
        if (!screeningId || !visitorName) {
            alert('Please fill in all fields');
            return;
        }
        
        try {
            // Get visitor token from server
            const response = await fetch('/api/auth/visitor', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    screening_id: screeningId,
                    visitor_name: visitorName
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to authenticate');
            }
            
            const data = await response.json();
            const visitorToken = data.token;
            
            // Initialize P2P communication
            p2p = new VirtualplexP2P(screeningId, visitorToken);
            await p2p.initialize(videoElement);
            
            // Get screening details
            const screeningResponse = await fetch(`/api/screenings/${screeningId}`, {
                headers: {
                    'Authorization': `Bearer ${visitorToken}`
                }
            });
            
            if (!screeningResponse.ok) {
                throw new Error('Failed to get screening details');
            }
            
            const screeningData = await screeningResponse.json();
            
            // Show theater UI
            loginSection.classList.add('hidden');
            theaterSection.classList.remove('hidden');
            
            // Render seats
            renderSeats(screeningData.seats);
            
            // Start movie streaming
            if (screeningData.magnet_link) {
                await p2p.startStreaming(screeningData.magnet_link);
            }
            
        } catch (error) {
            console.error('Error joining screening', error);
            alert(`Error joining screening: ${error.message}`);
        }
    });
    
    // Render the seats grid
    function renderSeats(seatsData) {
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
        if (!p2p) return;
        
        try {
            // If we already have a seat, release it first
            if (currentSeat) {
                await p2p.releaseSeat();
                currentSeat.classList.remove('selected');
                currentSeat = null;
            }
            
            // Select the new seat
            const response = await p2p.selectSeat(row, seat);
            
            if (response.success) {
                seatElement.classList.add('selected');
                currentSeat = seatElement;
            } else {
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
        if (!text || !p2p) return;
        
        p2p.sendChat(text);
        chatInput.value = '';
    });
    
    // Update chat UI
    window.updateChat = (messages) => {
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
        visitorsList.innerHTML = '';
        
        Object.keys(positions).forEach(visitorId => {
            const listItem = document.createElement('li');
            listItem.textContent = `Visitor ${visitorId.substring(0, 6)}`;
            visitorsList.appendChild(listItem);
        });
    };
    
    // Update seat information UI
    window.updateSeatInformation = (seatData) => {
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
    
    // Handle window beforeunload event
    window.addEventListener('beforeunload', () => {
        if (p2p) {
            p2p.cleanup();
        }
    });
});