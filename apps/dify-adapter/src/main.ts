import { createDifyAdapterHttpServer } from "./server";

const port = Number(process.env.PORT ?? 4200);
const server = createDifyAdapterHttpServer();

server.listen(port, "0.0.0.0", () => {
  console.log(`OpenKB Dify adapter listening on ${port}`);
});
