import { createServer } from "node:http";

import { getMcpHealth } from "./health";

const port = Number(process.env.PORT ?? 4100);

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(getMcpHealth()));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "NOT_FOUND" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OpenKB MCP scaffold listening on ${port}`);
});
