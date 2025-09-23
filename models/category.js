const mongoose = require("mongoose");
const deepPopulate = require("mongoose-deep-populate")(mongoose);
const Schema = mongoose.Schema;
const CategorySchema = new Schema({
 // owner: { type: Schema.Types.ObjectId, ref: "User" },
  type:{

    type: String,
    unique: true,
    required: true
  },
  photo: String,
  products: [
    {
      productID: { type: Schema.Types.ObjectId, ref: "Product" },
      quantity: Number,
      price: Number
    }
  ]

});

CategorySchema.plugin(deepPopulate)
const Category = mongoose.model("Category", CategorySchema);
module.exports = Category;
