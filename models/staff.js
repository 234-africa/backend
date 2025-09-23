const mongoose = require("mongoose");
const deepPopulate = require("mongoose-deep-populate")(mongoose);
const Schema = mongoose.Schema;

const StaffSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    passcode: {
      type: String,
      required: true,
      unique: true,
    },
    products: [
      {
        productID: { type: Schema.Types.ObjectId, ref: "Product" },
      },
    ],
    
 userId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Enable deep population for nested references
StaffSchema.plugin(deepPopulate);

module.exports = mongoose.model("Staff", StaffSchema);
