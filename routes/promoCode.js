// routes/promo.js
const express = require("express");
const router = express.Router();
const promoCode = require("../models/promoCode");
const verifyToken = require("../middelwares/verify-token");
const Order = require("../models/order");

// POST /apply-promo
router.post("/apply-promo", async (req, res) => {
  try {
    const { code, orderTotal, id } = req.body;
    console.log(req.body);

    // 1. Find promo code
    const promo = await promoCode.findOne({ code: code.toUpperCase() });
    if (!promo) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid promo code" });
    }

    // 2. Check expiry
    if (new Date() > promo.expiryDate) {
      return res
        .status(400)
        .json({ success: false, message: "Promo code expired" });
    }

    // 3. Check usage limit
    if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) {
      return res
        .status(400)
        .json({ success: false, message: "Promo code usage limit reached" });
    }

    // 4. Check if product is eligible for the promo (compare as string)
    const isProductEligible = promo.products.some(
      (productId) => String(productId) === id
    );
    console.log(isProductEligible);

    if (!isProductEligible) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Promo code not applicable to this product",
        });
    }

    // 5. Calculate discount
    let discount = 0;
    if (promo.discountType === "percentage") {
      discount = (orderTotal * promo.discountValue) / 100;
      console.log(
        `Discount Type: Percentage`,
        `\nOrder Total: ${orderTotal}`,
        `\nDiscount Value: ${promo.discountValue}%`,
        `\nCalculated Discount: ${discount}`
      );
    } else {
      discount = promo.discountValue;
    }

    const newTotal = Math.max(orderTotal - discount, 0);
    console.log(newTotal);

   // 6. Send response
const responsePayload = {
  success: true,
  discount,
  newTotal,
  discountType: promo.discountType, // 👈 include type
  discountValue: promo.discountValue, // 👈 include value
  message: "Promo code applied successfully",
};

// ✅ log it before sending
console.log("Promo Response Payload:", responsePayload);

return res.json(responsePayload);

    
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// ✅ Create new promo code
router.post("/create-promo", verifyToken, async (req, res) => {
  try {
    let promo = new promoCode();

    promo.code = req.body.code.toUpperCase().replace(/\s+/g, "");
    promo.discountType = req.body.discountType;
    promo.discountValue = req.body.discountValue;
    promo.expiryDate = req.body.expiryDate;
    promo.usageLimit = req.body.usageLimit || 0;
    promo.minOrderAmount = req.body.minOrderAmount || 0;
    promo.userId = req.decoded._id; // ✅ just like your Bank route
    promo.products = req.body.products || [];

    // 1. Check if code already exists
    const existing = await promoCode.findOne({
      code: req.body.code.toUpperCase(),
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Promo code already exists" });
    }
    console.log;

    await promo.save();

    return res.json({
      success: true,
      promo,
      message: "Promo code created successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/my-promos", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;

    const promos = await promoCode.find({ userId }).sort({ createdAt: -1 });
    console.log(promos);
    return res.json({ success: true, promos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/promo-orders", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // Logged-in promo creator
    // 1. Get all promo codes created by this user
    const promos = await promoCode
      .find({ userId: userId })
      .sort({ createdAt: -1 });
    //console.log(promos)
    const promoCodes = promos.map((p) => p.code);

    if (promoCodes.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 2. Build regexes for case-insensitive match
    const promoRegexes = promoCodes.map((code) => new RegExp(`^${code}$`, "i"));

    // 3. Find orders that used any of those promo codes
    const orders = await Order.find({
      promoCode: { $in: promoRegexes },
    });

    // 4. Format the results
    const data = orders.map((order) => {
      const promo = promos.find(
        (p) => p.code.toLowerCase() === order.promoCode?.toLowerCase()
      );

      return {
        promoCode: order.promoCode,
        promoId: promo?._id,
        title: order.title,
        price: order.price,
        reference: order.reference,
        createdAt: order.createdAt,
      };
    });

    res.json({ success: true, data });
    // console.log("orderss", data);
  } catch (err) {
    console.error("Promo Orders Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
