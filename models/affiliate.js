// models/Affiliate.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AffiliateSchema = new Schema({
  name: { type: String, required: true },       // Seller name
  code: { type: String, required: true, unique: true }, // Unique code e.g. "partner1"

  product: { type: Schema.Types.ObjectId, ref: "Product" }, // product they are selling
   link: { type: String, required: true }, // <-- store the affiliate link here

   user: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Affiliate", AffiliateSchema);
