const Bank = require("../models/bank");
const express = require("express");
//const upload = require("../middelwares/upload-photo");
const router = express.Router();
const verifyToken = require("../middelwares/verify-token");

router.post(`/bank`,verifyToken, async (req, res) => {
  try {
    let bank = new Bank();
    bank.accountName = req.body.accountName;
    bank.accountNumber = req.body.accountNumber;
    bank.bankName = req.body.bankName;
    bank.user = req.decoded._id; // from token

    await bank.save();
    res.json({
      status: true,
      message: "save success",
      data: bank
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get(`/bank`,verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    let banks = await Bank.find({ user: userId });
    
    res.json({
      status: true,
      banks: banks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put(`/bank/:id`,verifyToken, async (req, res) => {
  try {
    const bank = await Bank.findOneAndUpdate(
      { _id: req.params.id },
      {
        $set: {
          accountName: req.body.accountName,
          accountNumber: req.body.accountNumber,
          bankName: req.body.bankName
        }
      },
      {
        upsert: true
      }
    );

    res.json({
      status: true,
      updatedCategory: bank
    });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
router.get(`/bank/:id`,verifyToken, async (req, res) => {
  try {
    let bank = await Bank.findOne({
      _id: req.params.id
    });

    res.json({
      success: true,
      bank: bank
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
router.delete(`/bank/:id`,verifyToken, async (req, res) => {
  try {
    let deletedBank = await Bank.findByIdAndDelete({
      _id: req.params.id
    });
    if (deletedBank) {
      res.json({
        status: true,
        message: "sucess"
      });
    }
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
router.get("/all-banks", async (req, res) => {
  try {
    const banks = await Bank.find()
      .populate({
        path: "user",
        select: "email"  // only get email from user
      });

    res.json({
      success: true,
      count: banks.length,
      banks,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
module.exports = router;
