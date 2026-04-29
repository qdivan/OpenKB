import { createServer } from "node:http";

import { getDifyAdapterHealth } from "./health";

const port = Number(process.env.PORT ?? 4200);

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(getDifyAdapterHealth()));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "NOT_FOUND" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OpenKB Dify adapter scaffold listening on ${port}`);
});
