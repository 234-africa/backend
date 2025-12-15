const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const passport = require("passport");
const dotenv = require("dotenv");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const { runCleanups } =  require("./routes/cron");


// Load passport config
require("./auth");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ------------------- Middleware ------------------- //
app.use(
  session({
    secret: "mmmmm",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(morgan("combined"));
app.use(cors());
app.use(cookieParser());

const { router: paymentRoutes, paystackWebhookHandler, stripeWebhookHandler, fincraWebhookHandler, alatpayWebhookHandler } = require("./routes/payment");
app.post("/api/webhook/paystack", express.raw({ type: "application/json" }), paystackWebhookHandler);
app.post("/api/webhook/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/api/webhook/fincra", express.raw({ type: "application/json" }), fincraWebhookHandler);
app.post("/api/webhook/alatpay", express.raw({ type: "application/json" }), alatpayWebhookHandler);

app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());

// ------------------- Auth Guard ------------------- //
function isLoggedIn(req, res, next) {
  req.user ? next() : res.sendStatus(401);
}

// ------------------- Routes ------------------- //
const productsRoutes = require("./routes/product");
const staffRoutes = require("./routes/staff");
const categoryRoutes = require("./routes/category");
const userRoutes = require("./routes/auth");
const bankRoutes = require("./routes/bank");
const affiliateRoutes = require("./routes/affiliate");
const orderRoutes = require("./routes/order");
const promoRoutes = require("./routes/promoCode");

app.use("/api", productsRoutes);
app.use("/api", staffRoutes);
app.use("/api", bankRoutes);
app.use("/api", categoryRoutes);
app.use("/api", userRoutes);
app.use("/api", affiliateRoutes);
app.use("/api", paymentRoutes);
app.use("/api", orderRoutes);
app.use("/api", promoRoutes);

// ------------------- DB Connection ------------------- //
mongoose
  .connect(process.env.DATABASE, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
    autoIndex: true, // makes sure indexes are created
  })
  .then(() => {
    runCleanups();
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ App starting error:", err.stack);
    process.exit(1);
  });

// ------------------- App Routes ------------------- //
app.get("/h", (req, res) => {
  res.send("Successful response.");
});

app.get("/", (req, res) => {
  res.send('<a href="/auth/google">Authenticate with Google</a>');
});

// Google OAuth
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["email", "profile"] })
);

app.get(
  "/auth/callback",
  passport.authenticate("google", {
    successRedirect: "/protected",
    failureRedirect: "/auth/google/failure",
  })
);

app.get("/auth/google/failure", (req, res) => {
  res.send("Failed to authenticate..");
});

app.get("/protected", isLoggedIn, (req, res) => {
  res.send(`Hello ${req.user.displayName}`);
});

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).send("Error logging out.");
    }
    res.send("Goodbye!");
  });
});

// Message API
app.post("/api/message", (req, res) => {
  const { name, message } = req.body;
  //console.log("Received:", name, message);
  res.json({ status: "success", received: { name, message } });
});

// ------------------- Start Server ------------------- //
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
