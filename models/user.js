const mongoose = require("mongoose");
const bcrypt = require("bcrypt-nodejs");
const uniqueValidator = require('mongoose-unique-validator');

const Schema = mongoose.Schema;

// ✅ Payout history schema
const PayoutSchema = new Schema({
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
});

const UserSchema = new Schema({
  name: String,
  brand: {
    type: String,
    required: true,
    unique: true
  },
  picture: String,
  email: {
    type: String,
    trim: true,
    unique: true,
    required: true
  },
  role: { type: String, enum: ["user", "admin"], default: "user" },

  password: {
    type: String,
    required: true
  },
  isVerified: {
    type: Boolean,
    default: false // <-- NEW FIELD
  },
  time: { type: Date, default: Date.now },
  resetLink: { data: String, default: '' },
  address: { type: Schema.Types.ObjectId, ref: "Address" },

  // ✅ Earnings section
  totalEarnings: { type: Number, default: 0 },   // grows when orders are made
  totalPaidOut: { type: Number, default: 0 },    // grows when admin pays
  payouts: [PayoutSchema]                        // history of manual payouts
});

// ✅ Virtual field (not stored in DB)
UserSchema.virtual("unpaidEarnings").get(function () {
  return this.totalEarnings - this.totalPaidOut;
});

// Create unique index for the email field
UserSchema.plugin(uniqueValidator);

// Password hashing
UserSchema.pre("save", function (next) {
  let user = this;

  // ✅ Extra: Force role from ADMIN_EMAILS in .env
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",")
    : [];

  if (adminEmails.includes(user.email)) {
    user.role = "admin";
  }

  // ✅ Your original password hashing logic
  if (this.isModified("password") || this.isNew) {
    bcrypt.genSalt(10, function (err, salt) {
      if (err) {
        return next(err);
      }

      bcrypt.hash(user.password, salt, null, function (err, hash) {
        if (err) {
          return next(err);
        }

        user.password = hash;
        next();
      });
    });
  } else {
    return next();
  }
});



UserSchema.methods.comparePassword = function (password, next) {
  let user = this;
  return bcrypt.compareSync(password, user.password);
};

const User = mongoose.model("User", UserSchema);
module.exports = User;
