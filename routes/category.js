const Category = require("../models/category");
const express = require("express");
const upload = require("../middelwares/upload-photo");
const router = express.Router();

router.post(`/categories`, upload.single("photo"), async (req, res) => {
  try {
    let category = new Category();
    category.type = req.body.type;
   category.photo = req.file.location;
    await category.save();
    res.json({
      status: true,
      message: "save succes"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get(`/categories`, async (req, res) => {
  try {
    let categories = await Category.find();

    res.json({
      status: true,
      categories: categories
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put(`/categories/:id`, upload.single("photo"), async (req, res) => {
  try {
    const update = {
      type: req.body.type,
    };

    if (req.file && req.file.location) {
      update.photo = req.file.location;
    }

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id },
      { $set: update },
      { new: true }
    );

    res.json({ status: true, updatedCategory: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get(`/categories/:id`, async (req, res) => {
  try {
    let category = await Category.findOne({
      _id: req.params.id
    });

    res.json({
      success: true,
      category: category
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
router.delete(`/categories/:id`, async (req, res) => {
  try {
    let deletedCategory = await Category.findByIdAndDelete({
      _id: req.params.id
    });
    if (deletedCategory) {
      res.json({
        status: true,
        message: "sucess"
      });
    }
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
module.exports = router;
