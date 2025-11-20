// Test script to send probe data to the server
// Update the URL constant below with your server address
// Usage: node test-probe.js [loop] [interval_ms]

const SERVER_URL = "http://34.160.35.22"; // Change this to your deployed server URL/IP

// Generate a random 4-character ID
function generateId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Generate random probe data
function generateProbeData() {
  const id = generateId();
  const co2 = (400 + Math.random() * 200).toFixed(2);
  const hum = (30 + Math.random() * 50).toFixed(2);
  const temp = (20 + Math.random() * 10).toFixed(2);
  const db = (40 + Math.random() * 30).toFixed(2);
  
  return `${id}: [CO2] ${co2} [HUM] ${hum} [TEMP] ${temp} [dB] ${db}`;
}

// Send a probe data message
async function sendProbeData() {
  const data = generateProbeData();
  
  try {
    const response = await fetch(`${SERVER_URL}/api/probedata`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: data,
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✓ Sent: ${data}`);
      console.log(`  Response: ${JSON.stringify(result)}`);
    } else {
      console.error(`✗ Failed: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(`  Error: ${text}`);
    }
  } catch (error) {
    console.error(`✗ Error sending data: ${error.message}`);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length > 0 && args[0] === "loop") {
  // Continuous loop mode
  const interval = args[1] ? parseInt(args[1], 10) : 2000; // Default 2 seconds
  console.log(`Starting continuous mode (every ${interval}ms)...`);
  console.log(`Server URL: ${SERVER_URL}\n`);
  
  setInterval(() => {
    sendProbeData();
  }, interval);
} else {
  // Single send
  console.log(`Sending probe data to: ${SERVER_URL}\n`);
  sendProbeData();
}

