const express = require("express");
const router = express.Router();
const Product = require("../models/product");
const Staff = require("../models/staff");
const verifyStaffToken = require("../middelwares/verifyStaffToken");
const verifyToken = require("../middelwares/verify-token");

const jwt = require("jsonwebtoken");

// Function to generate random 6-character passcode
function generatePasscode(length = 6) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let passcode = "";
  for (let i = 0; i < length; i++) {
    passcode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return passcode;
}
router.post("/staff", verifyToken, async (req, res) => {
  try {
    const { staffName, productId } = req.body;

    // Ensure staffName and productId are provided
    if (!staffName || !productId) {
      return res.status(400).json({ error: "Staff name and productId are required" });
    }

    const userId = req.decoded._id; // user from token

    // Check if staff with same name exists for this user
    let staff = await Staff.findOne({ name: staffName, userId });

    if (staff) {
      // Staff exists → Add new productId if not already added
      const alreadyHasProduct = staff.products.some(
        (p) => p.productID.toString() === productId
      );

      if (!alreadyHasProduct) {
        staff.products.push({ productID: productId });
        await staff.save();
      }

      return res.status(200).json({
        message: alreadyHasProduct
          ? "Product already assigned to staff"
          : "Product added to staff successfully",
        staffId: staff._id,
        userId: staff.userId,
      });
    }

    // Staff doesn't exist → Create new
    const passcode = generatePasscode(); // e.g., random 6 digits
    staff = new Staff({
      name: staffName,
      passcode,
      products: [{ productID: productId }],
      userId
    });

    await staff.save();

    res.status(201).json({
      message: "Staff created successfully",
      staffId: staff._id,
      passcode,
      userId: staff.userId,
    });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/staff/login", async (req, res) => {
  try {
    const { name, passcode } = req.body;

    // Find staff by name and passcode together
    let foundStaff = await Staff.findOne({ name, passcode });

    if (!foundStaff) {
      return res.status(403).json({
        success: false,
        message: "Authentication failed, Staff not found or wrong passcode"
      });
    }

    // Create token
    let token = jwt.sign(
      { _id: foundStaff._id, name: foundStaff.name },
      process.env.SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      staff: {
        id: foundStaff._id,
        name: foundStaff.name,
        userId: foundStaff.userId,
        products: foundStaff.products
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


// Get all staff with product details
router.get("/staff", verifyStaffToken, async (req, res) => {
  try {
    // Get the staff ID from the token
    const staffId = req.decoded._id; // This must be set when logging in staff
    //console.log('stfa',staffId)


    if (!staffId) {
      return res.status(400).json({ message: "No staff ID in token", products: [] });
    }

    // Find the staff and populate product details
    const staff = await Staff.findById(staffId)
      .populate("products.productID");

    if (!staff) {
      return res.status(404).json({
        message: "Staff not found",
        products: []
      });
    }

    // Send back staff details with populated products
    res.json({
      id: staff._id,
      name: staff.name,
      userId: staff.userId,
      products: staff.products
    });

  } catch (err) {
    console.error("Error fetching staff:", err);
    res.status(500).json({
      error: err.message,
      products: []
    });
  }
});
// Get all staff for the logged-in user with product details
router.get("/user-staff", verifyToken, async (req, res) => {
  try {
    // Get userId from the decoded token (change this if your token payload is different)
    const userId = req.decoded._id || req.decoded.id;

    if (!userId) {
      return res.status(400).json({ message: "No user ID in token" });
    }

    // Find all staff linked to this user and populate products
    const staffList = await Staff.find({ userId })
      .populate("products.productID");

    res.json(staffList);

  } catch (err) {
    console.error("Error fetching staff for user:", err);
    res.status(500).json({ error: err.message });
  }
});





// Delete staff
router.delete("/staff/:id", verifyToken, async (req, res) => {
  try {
    await Staff.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Staff deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;
