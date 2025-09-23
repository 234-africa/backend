const express = require("express");
const router = express.Router();
const Affiliate = require("../models/affiliate");
const Product = require("../models/product");
const slugify = require("slugify"); // <-- add this
const Order = require("../models/order");

const verifyToken = require("../middelwares/verify-token");


// Create affiliate for a product
router.post("/affiliate", verifyToken, async (req, res) => {
  try {
    const { name, code, productId } = req.body;

    // Ensure product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Check if code already exists
    const existingAffiliate = await Affiliate.findOne({ code });
    if (existingAffiliate) {
      return res.status(400).json({ success: false, message: "Affiliate code already exists" });
    }

    // Use title or slug for URL
    const slug = product.slug || slugify(product.title, { lower: true });

    // Generate affiliate link
    const link = `${process.env.FRONTEND_URL}/event/${slug}?aff=${code}`;

    // Save affiliate with link
    const affiliate = new Affiliate({
      name,
      code,
      product: productId,
      user: req.decoded._id, // user from token
      link,
    });

    await affiliate.save();

    res.json({ success: true, affiliate });
  } catch (err) {
    console.error("Error creating affiliate:", err);
    // Catch duplicate key error from MongoDB just in case
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Affiliate code must be unique" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get(`/affiliates`,verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    let affiliates = await Affiliate.find({ user: userId });
    
    res.json({
      status: true,
      affiliates: affiliates
    });
  // //console.log(affiliates)
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/affiliate-orders", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // logged-in user (affiliate owner)

    // Step 1: Find all affiliate codes owned by this user
    const affiliates = await Affiliate.find({ user: userId });
    //console.log("sr", affiliates);

    const affiliateCodes = affiliates.map((a) => a.code);
    //console.log("aff", affiliateCodes);

    if (affiliateCodes.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Step 2: Find orders that used those affiliate codes (case-insensitive)
    const affiliateRegexes = affiliateCodes.map(
      (code) => new RegExp(`^${code}$`, "i")
    );

    const orders = await Order.find({
      affiliate: { $in: affiliateRegexes },
    });
    //console.log("or", orders);

    // Step 3: Map orders to desired format
    const data = orders.map((order) => {
      // find affiliate ignoring case
      const affiliate = affiliates.find(
        (a) => a.code.toLowerCase() === order.affiliate.toLowerCase()
      );

      return {
        affiliateName: affiliate?.name || "Unknown",
        affiliateCode: order.affiliate,
        title: order.title,
        price: order.price,
        reference: order.reference,
        createdAt: order.createdAt,
      };
    });

    res.json({ success: true, data });
    //console.log("orderss", data);
  } catch (err) {
    console.error("Affiliate Orders Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/affiliate-orders-summary", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;

    // Step 1: Get affiliates for this user
    const affiliates = await Affiliate.find({ user: userId });
    const affiliateCodes = affiliates.map((a) => a.code);

    if (affiliateCodes.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Step 2: Find orders with case-insensitive affiliate match
    const affiliateRegexes = affiliateCodes.map(
      (code) => new RegExp(`^${code}$`, "i")
    );

    const orders = await Order.find({ affiliate: { $in: affiliateRegexes } });

    // Step 3: Group by affiliate code (case-insensitive)
    const summary = {};

    for (const order of orders) {
      const code = order.affiliate;

      // match affiliate ignoring case
      const affiliate = affiliates.find(
        (a) => a.code.toLowerCase() === code.toLowerCase()
      );

      const key = affiliate?.code || code; // use normalized affiliate code

      if (!summary[key]) {
        summary[key] = {
          code: key,
          name: affiliate?.name || "Unknown",
          totalOrders: 0,
          totalEarnings: 0,
        };
      }

      summary[key].totalOrders += 1;
      summary[key].totalEarnings += order.price;
    }

    const result = Object.values(summary);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Affiliate summary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



module.exports = router;
