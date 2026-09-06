const socket = new WebSocket(`ws://${window.location.host}/ws`);

socket.addEventListener("message", (event) => {
  const log = document.getElementById("ws-log");
  log.textContent += `received: ${event.data}\n`;
});

document.getElementById("ping-btn").addEventListener("click", () => {
  socket.send(JSON.stringify({ action: "ping" }));
});

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ action: "ping" }));
});
