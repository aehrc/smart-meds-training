const express = require("express");
const session = require("express-session");
const path = require("path");
const smart = require("fhirclient/lib/entry/node");

const launchRoutes = require("./routes/launch");
const dashboardRoutes = require("./routes/dashboard");

const app = express();
const PORT = process.env.PORT || 3000;

// --- View engine ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// --- Static files ---
app.use(express.static(path.join(__dirname, "public")));

// --- Session (required by fhirclient for server-side auth state) ---
app.use(
  session({
    secret: "smart-meds-training-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// --- Landing page ---
app.get("/", (_req, res) => {
  res.render("index");
});

// --- SMART launch & callback ---
app.get("/launch", launchRoutes.launch);
app.get("/callback", launchRoutes.callback);

// --- Dashboard (post-auth) ---
app.get("/dashboard", dashboardRoutes.dashboard);

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).render("error", {
    title: "Server Error",
    message: err.message || "An unexpected error occurred.",
  });
});

app.listen(PORT, () => {
  console.log(`Medication Contraindication Checker running on http://localhost:${PORT}`);
  console.log(`Open the SMART launcher and use this as your App Launch URL:`);
  console.log(`  http://localhost:${PORT}/launch`);
});
