const cron = require("node-cron");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const Product = require("../models/product");      // adjust path
const PromoCode = require("../models/promoCode");  // adjust path

async function deleteExpiredProducts() {
  try {
    const allProducts = await Product.find();
    let deletedCount = 0;

    for (const product of allProducts) {
      if (!product.event || !product.event.start) continue;

      const eventTimezone = product.event.timezone || "UTC";
      
      const eventStartDate = moment.tz(product.event.start, eventTimezone);
      
      if (product.event.startTime) {
        const [hours, minutes] = product.event.startTime.split(":");
        eventStartDate.set({
          hour: parseInt(hours, 10),
          minute: parseInt(minutes, 10),
          second: 0
        });
      }

      const expirationTime = eventStartDate.clone().add(12, "hours");
      const nowInEventTimezone = moment.tz(eventTimezone);

      if (nowInEventTimezone.isAfter(expirationTime)) {
        await Product.findByIdAndDelete(product._id);
        deletedCount++;
      }
    }

    console.log(`🧹 Deleted ${deletedCount} expired products (12 hours after event start).`);
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
