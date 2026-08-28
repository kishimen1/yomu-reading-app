import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const githubPagesBase = repositoryName && !repositoryName.endsWith(".github.io")
  ? `/${repositoryName}/`
  : "/";

export default defineConfig({
  // GitHub Pages project sites live below /<repository>/.
  // Keep local builds relocatable while deriving the hosted path in Actions.
  base: process.env.GITHUB_ACTIONS === "true" ? githubPagesBase : "./",
  server: {
    host: "0.0.0.0",
    port: 8056,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith(".css")
          ? "assets/styles.css"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
});
