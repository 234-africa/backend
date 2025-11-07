const mongoose = require("mongoose");
const Schema = mongoose.Schema;
//const mongooseAlgolia= require('mongoose-algolia')
const ProductSchema = new Schema(
  {
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    user: { type: Schema.Types.ObjectId, ref: "User" },

    title: {
      type: String,
      set: (v) => v.trim(),
    },
    customizeUrl: {
      type: String,
      unique: true,
      required: true,
      set: (v) => v.trim(),
    },

    description: {
      type: String,
      required: true,
    },
    tag: { type: Array },
    photos: { type: Array },
    time: { type: Date, default: Date.now },
    price: Number,
    currency: {
      type: String,
      enum: ["NGN", "USD", "GBP", "EUR", "GHS"],
      default: "NGN"
    },
    event: {
      start: { type: Date, required: true },
      end: { type: Date, required: false },

      startTime: String, // e.g. "03:00"
      endTime: String, // e.g. "09:00"
      timezone: { type: String, default: "UTC" },
      location: {
        name: { type: String },
      },

     tickets: [
    {
      name: { type: String, required: true },
      price: { type: Number },

      type: {
        type: String,
        enum: ["limited", "unlimited"],
        default: "limited",
      },

      quantity: {
        type: Number,
        required: function () {
          return this.type === "limited";
        },
        min: [0, "Quantity must be at least 0 for limited tickets"],
      },

      purchaseLimit: {
        type: Number,
        default: 10,
        min: [0, "Purchase limit must be at least 1"],
      },
    },
  ],

    },

    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
  },
  {
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  }
);

ProductSchema.methods.calculateOverallRating = async function () {
  const reviews = this.reviews;
  if (reviews.length > 0) {
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    return totalRating / reviews.length;
  } else {
    return 0;
  }
};

let Model = mongoose.model("Product", ProductSchema);

const Product = mongoose.model("Product", ProductSchema);
module.exports = Product;
