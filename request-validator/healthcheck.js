// Simple healthcheck script
import http from "node:http";

const PORT = Number(process.env.PORT || 18081);

http.get(`http://localhost:${PORT}/healthz`, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
}).on("error", () => {
  process.exit(1);
});

