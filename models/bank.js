const mongoose = require("mongoose");
//const deepPopulate = require("mongoose-deep-populate")(mongoose);
const Schema = mongoose.Schema;
const BankSchema = new Schema({
  accountName: {
    type: String,
    required: true
  },
  accountNumber: {
    type: String,
    required: true
  },
  bankName: {
    type: String,
    required: true
  },
   user: { type: Schema.Types.ObjectId, ref: "User" },

});


const Bank = mongoose.model("Bank", BankSchema);
module.exports = Bank;
