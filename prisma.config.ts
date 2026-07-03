import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env when a config file is present, so load it
// ourselves for local CLI use. In CI / Docker the file is absent and the env
// vars are provided directly, so a missing file is not an error.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the ambient environment
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
