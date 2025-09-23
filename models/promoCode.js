// models/PromoCode.js
const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema({

  code: { type: String, required: true, unique: true },
  discountType: { type: String, enum: ["percentage", "fixed"], required: true },
  discountValue: { type: Number, required: true },
  expiryDate: { type: Date, required: true },
  usageLimit: { type: Number, default: 0 }, // 0 = unlimited
  usedCount: { type: Number, default: 0 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, 
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
  });

module.exports = mongoose.model("PromoCode", promoCodeSchema);
