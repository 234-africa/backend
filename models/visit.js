const mongoose = require("mongoose");
const moment = require('moment-timezone');
const Schema = mongoose.Schema;
//const mongooseAlgolia = require("mongoose-algolia");
const VisitSchema = new Schema({
    ipAddress: String,
    userAgent: String,
    url: String,
    time: {
      type: Date,
      default: function () {
        return moment().tz('Africa/Lagos').toDate();
      },
    },
    count: {
      type: Number,
      default: 0
    },
  },


);

const Visit = mongoose.model("Visit", VisitSchema);
module.exports = Visit;