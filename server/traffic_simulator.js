// server/traffic_simulator.js

const TARGET_IP = "10.0.0.1"; 
let isAttackMode = false; // Toggle this manually to test attack mode

function getRandomIP() {
    return `192.168.1.${Math.floor(Math.random() * 255)}`; 
}

function getSourceIP() {
    if (isAttackMode) return "66.66.66.66"; // Hacker IP
    return getRandomIP(); // Normal IP
}

/**
 * Starts the Traffic Simulation
 * @param {Object} io - The Socket.io server instance
 */
function startTraffic(io) {
    function generatePacket() {
        const packet = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString(),
            source_ip: getSourceIP(),
            destination_ip: TARGET_IP,
            method: isAttackMode ? "POST" : "GET",
            bytes: isAttackMode ? 5000 : Math.floor(Math.random() * 1000) + 200,
        };

        // 1. BROADCAST data to the frontend
        io.emit('packet', packet);
        
        // 2. Log to terminal (so you know it's working)
        console.log(`[Tracel] Emitted: ${packet.source_ip} | Size: ${packet.bytes}B`);

        const delay = isAttackMode ? 50 : 1000;
        setTimeout(generatePacket, delay);
    }

    generatePacket();
}

// Export the function so index.js can use it
module.exports = { startTraffic };