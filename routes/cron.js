const cron = require("node-cron");
const mongoose = require("mongoose");
const Product = require("../models/product");      // adjust path
const PromoCode = require("../models/promoCode");  // adjust path

async function deleteExpiredProducts() {
  try {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000));
    const result = await Product.deleteMany({
      "event.start": { $lt: twelveHoursAgo }
    });
    console.log(`🧹 Deleted ${result.deletedCount} expired products (12 hours after start time).`);
  } catch (err) {
    console.error("Error deleting expired products:", err);
  }
}

async function deleteExpiredPromoCodes() {
  try {
    const now = new Date();
    const result = await PromoCode.deleteMany({
      $or: [
        { expiryDate: { $lt: now } },
        {
          $expr: {
            $and: [
              { $gt: ["$usageLimit", 0] },
              { $gte: ["$usedCount", "$usageLimit"] }
            ]
          }
        }
      ]
    });
    console.log(`🧹 Deleted ${result.deletedCount} expired/used-out promo codes.`);
  } catch (err) {
    console.error("Error deleting expired promo codes:", err);
  }
}

// Run cleanup immediately on startup (optional)
async function runCleanups() {
  await deleteExpiredProducts();
  await deleteExpiredPromoCodes();
}

// Schedule cron job to run daily at midnight
cron.schedule("0 0 * * *", async () => {
  console.log("🕛 Running daily cleanup jobs...");
  await runCleanups();
});

module.exports = {
  runCleanups,
};
