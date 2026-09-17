import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "local-purchasing-affiliations",
    // Local development only; production data is served by the authenticated function.
    configureServer(server) {
      server.middlewares.use("/api/purchasing-affiliations", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        const path = new URL("./data/purchasing-affiliations.json", import.meta.url);
        if (!existsSync(path)) {
          response.statusCode = 503;
          response.end(JSON.stringify({ message: "Local purchasing research has not been loaded." }));
          return;
        }
        response.end(readFileSync(path, "utf8"));
      });
    }
  }]
});
