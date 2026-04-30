import { createOpenKBMcpHttpServer } from "./server";

const port = Number(process.env.PORT ?? 4100);

const server = createOpenKBMcpHttpServer();

server.listen(port, "0.0.0.0", () => {
  console.log(`OpenKB MCP server listening on ${port}`);
});
