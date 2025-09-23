const mongoose = require("mongoose");
const affiliate = require("./affiliate");
const deepPopulate = require("mongoose-deep-populate")(mongoose);
const Schema = mongoose.Schema;

const ticketSchema = new mongoose.Schema({
  name: String,
  quantity: Number,
});

const OrderSchema = new mongoose.Schema({
  reference: {
    type: String,
    required: true,
    unique: true,
  },
  title: {
    type: String,
    required: true
  },
  contact: {
    email: { type: String, required: true },
    phone: { type: String, required: true },
  },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  tickets: [ticketSchema],
  startDate: {
    type: Date,
    required: true,
  },
  startTime: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
 affiliate: {
  type: String,
  unique: true,
  sparse: true,   // allows multiple docs without affiliate
},

promoCode: {
  type: String,
  unique: true,
  sparse: true,   // allows multiple docs without promoCode
},

  scanned: {
    type: Boolean,
    default: false, // ✅ default not scanned
  },
  scannedAt: {
    type: Date, // ✅ optional timestamp
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});



OrderSchema.plugin(deepPopulate)

module.exports = mongoose.model("Order", OrderSchema);