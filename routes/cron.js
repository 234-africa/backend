const cron = require("node-cron");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const Product = require("../models/product");
const PromoCode = require("../models/promoCode");

async function deleteExpiredProducts() {
  try {
    const allProducts = await Product.find({
      "event.start": { $lte: new Date() }
    });

    const now = moment();
    const expiredIds = [];

    for (const product of allProducts) {
      if (!product.event || !product.event.start) continue;

      const eventTimezone = product.event.timezone || 'UTC';
      let eventStartMoment;

      if (product.event.startTime && /^\d{2}:\d{2}$/.test(product.event.startTime)) {
        const eventDate = moment(product.event.start).format('YYYY-MM-DD');
        const eventTime = product.event.startTime;

        eventStartMoment = moment.tz(
          `${eventDate} ${eventTime}`,
          'YYYY-MM-DD HH:mm',
          eventTimezone
        );

        if (!eventStartMoment.isValid()) {
          console.warn(`Invalid event start time for product ${product._id}, falling back to event.start`);
          eventStartMoment = moment(product.event.start).tz(eventTimezone);
        }
      } else {
        if (product.event.startTime) {
          console.warn(`Invalid startTime format for product ${product._id}: ${product.event.startTime}, falling back to event.start`);
        }
        eventStartMoment = moment(product.event.start).tz(eventTimezone);
      }

      const expirationTime = eventStartMoment.clone().add(12, 'hours');

      if (now.isAfter(expirationTime)) {
        expiredIds.push(product._id);
      }
    }

    if (expiredIds.length > 0) {
      const result = await Product.deleteMany({ _id: { $in: expiredIds } });
      console.log(`🧹 Deleted ${result.deletedCount} expired products (12 hours after event start time).`);
    } else {
      console.log(`🧹 No expired products to delete.`);
    }
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
  // NOTE: Events are NOT deleted automatically. They are only hidden from public view.
  // Only organizers can delete their own events.
  // await deleteExpiredProducts(); // DISABLED - events should not be auto-deleted
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
