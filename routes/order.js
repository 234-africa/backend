const router = require("express").Router();
const Order = require("../models/order");
const verifyToken = require("../middelwares/verify-token");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

const fs = require("fs");

const path = require("path");

router.get("/orders/download-and-email", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;
    const userEmail = req.decoded.email;
    const orders = await Order.find({ userId });

    if (!orders.length) {
      return res.status(404).json({ success: false, message: "No orders found" });
    }

    // === Generate PDF ===
    const pdfPath = path.join(__dirname, `orders_${userId}.pdf`);
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    doc.pipe(fs.createWriteStream(pdfPath));

    // === Title ===
    doc.fontSize(20).text("Order Summary", { align: "center" });
    doc.moveDown();

    // === Table Header ===
    doc.fontSize(10);
    const headers = [
      "Order ID", "Date", "Reference", "Title",
      "Email", "Phone", "Amount", "Tickets"
    ];
    doc.font("Helvetica-Bold");
    headers.forEach((header, i) => {
      doc.text(header, { continued: i !== headers.length - 1, width: 70 });
    });
    doc.moveDown(0.5);
    doc.font("Helvetica");

    // === Table Rows ===
    orders.forEach(order => {
      const tickets = order.tickets
        .map(t => `${t.name} x ${t.quantity}`)
        .join(", ");

      const row = [
        order._id,
        new Date(order.createdAt).toLocaleString(),
        order.reference || "N/A",
        order.title || "N/A",
        order.contact?.email || "N/A",
        order.contact?.phone || "N/A",
        `₦${order.price || 0}`,
        tickets || "N/A"
      ];

      row.forEach((cell, i) => {
        doc.text(cell.toString(), {
          continued: i !== row.length - 1,
          width: 70
        });
      });
      doc.moveDown(0.5);
    });

    doc.end();

    // === Wait until PDF is written ===
    await new Promise(resolve => doc.on("finish", resolve));

    // === Email PDF ===
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GOOGLE_APP_EMAIL,
        pass: process.env.GOOGLE_APP_PW,
      },
    });

    await transporter.sendMail({
      from: process.env.GOOGLE_APP_EMAIL,
      to: userEmail,
      subject: "Your Orders",
      text: "Attached is your order summary.",
      attachments: [{ filename: `orders_${userId}.pdf`, path: pdfPath }],
    });

    fs.unlinkSync(pdfPath); // delete after sending

    res.json({ success: true, message: "Orders sent to email" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    const orders = await Order.find({ userId: userId });
    ////console.log(orders);
    ////console.log(userId);
    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/all-orders", async (req, res) => {
  try {
    const orders = await Order.find(); // get all orders

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/userr/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    const products = await Order.find({
      userId: userId,
    })
      .deepPopulate("products.productID.owner")
      .exec();
    ////console.log(products);
    ////console.log(userId);
    res.json({
      success: true,
      products,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});
// DELETE /api/order/:orderId
router.delete("/order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const deletedOrder = await Order.findByIdAndDelete(orderId);
    if (!deletedOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      message: "Order deleted successfully",
      order: deletedOrder,
    });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message,
    });
  }
});

router.put("/order/:orderId/update-status", async (req, res) => {
  const orderId = req.params.orderId;
  const { status } = req.body;

  try {
    const order = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      message: "Order status updated successfully",
      order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  }
});

module.exports = router;
