// server/traffic_simulator.js

/**
 * TRACEL ENGINE: Network Traffic Simulator
 * Generates synthetic packets for analysis.
 */

// CONFIGURATION
const TARGET_IP = "10.0.0.1"; 
let isAttackMode = false; // Toggle this to true to test "Hacker Mode"

// 1. HELPER: Generate Random IP
function getRandomIP() {
    return `192.168.1.${Math.floor(Math.random() * 255)}`; 
}

// 2. LOGIC: Get Source IP based on Mode
function getSourceIP() {
    // In Attack Mode, use a fixed "Botnet" IP
    if (isAttackMode) return "66.66.66.66"; 
    // In Normal Mode, use random user IPs
    return getRandomIP(); 
}

// 3. MAIN ENGINE
function generatePacket() {
    const packet = {
        id: Math.random().toString(36).substr(2, 9), // Unique ID
        timestamp: new Date().toISOString(),
        source_ip: getSourceIP(),
        destination_ip: TARGET_IP,
        method: isAttackMode ? "POST" : "GET", // Hackers often POST data
        bytes: isAttackMode ? 5000 : Math.floor(Math.random() * 1000) + 200,
    };

    console.log(`[Tracel] Generated: ${packet.source_ip} | Size: ${packet.bytes}B`);

    // Speed Control: 
    // Attack = 50ms (Very Fast)
    // Normal = 1000ms (1 Second)
    const delay = isAttackMode ? 50 : 1000;
    setTimeout(generatePacket, delay);
}

// Start the Engine
console.log("--- TRACEL SIMULATOR STARTING ---");
generatePacket();