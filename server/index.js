// server/index.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import our simulator
const { startTraffic } = require('./traffic_simulator');

const app = express();
app.use(cors()); // Allow connections from anywhere

const server = http.createServer(app);

// Initialize Socket.io (The Real-Time Engine)
const io = new Server(server, {
    cors: {
        origin: "*", // Allow React (or any client) to connect
        methods: ["GET", "POST"]
    }
});

// Listener: When a user connects
io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log('User Disconnected');
    });
});

// Start the Simulation Logic
startTraffic(io);

// Start the Server on Port 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});