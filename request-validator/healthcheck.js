// Simple healthcheck script
import http from "node:http";

http.get("http://localhost:18081/healthz", (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
}).on("error", () => {
  process.exit(1);
});

