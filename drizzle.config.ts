import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect      : "postgresql",
  schema       : "./src/server/db/schema/index.ts",
  out          : "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://plotweaver:plotweaver@127.0.0.1:5432/wenyuan_v3"
  },
  strict : true,
  verbose: true
});
