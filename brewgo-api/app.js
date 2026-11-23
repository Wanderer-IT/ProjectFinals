const path = require("path");
const express = require("express");
const requestId = require("./middleware/requestId");
const cors = require("./middleware/cors");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const routes = require("./routes");
const { seedDemoData } = require("./models/seedDemo");
const persistence = require("./models/persistence");

// Memory-only mode seeds right away. With Supabase, server.js loads the saved data first and seeds only if it is empty.
if (!persistence.enabled) seedDemoData();

const app = express();
app.disable("x-powered-by");
app.use(requestId);
app.use(cors);
app.use(express.json({ limit: "100kb" }));
app.use("/images", express.static(path.join(__dirname, "public", "images")));

app.get("/", (req, res) => res.json({ name: "Brew Go API", version: "v1", docs: "see docs/API.md", base: "/api/v1", health: "/api/v1/health" }));
app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
