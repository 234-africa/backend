const router = require("express").Router();
const Order = require("../models/order");
const verifyToken = require("../middelwares/verify-token");

const nodemailer = require("nodemailer");

const fs = require("fs");

const path = require("path");
const PDFDocument = require("pdfkit-table");

router.get("/orders/download-and-email", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;
    const userEmail = req.decoded.email;
    const orders = await Order.find({ userId });

    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "No orders found",
      });
    }

    const pdfPath = path.join(__dirname, `orders_${userId}.pdf`);
    const stream = fs.createWriteStream(pdfPath);

    // ✅ Landscape for wider space
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
    });

    doc.pipe(stream);

    // === Title ===
    doc.fontSize(22).fillColor("#333").text("My Orders", { align: "center" });
    doc.moveDown(2);

    // === Auto-fit table without fixed widths ===
    const table = {
      headers: [
        { label: "ORDER ID", property: "_id", noWrap: false },
        { label: "DATE", property: "date", noWrap: false },
        { label: "REFERENCE", property: "reference", noWrap: false },
        { label: "EVENT", property: "title", noWrap: false },
        { label: "CUSTOMER EMAIL", property: "email", noWrap: false },
        { label: "PHONE", property: "phone", noWrap: false },
        { label: "AMOUNT", property: "price", noWrap: false },
      ],
      datas: orders.map((order) => ({
        _id: order._id.toString(),
        date: new Date(order.createdAt).toLocaleString(),
        reference: order.reference || "N/A",
        title: order.title || "N/A",
        email: order.contact?.email || "N/A",
        phone: order.contact?.phone || "N/A",
        price: `₦ ${(order.price || 0).toLocaleString("en-NG")}`,
      })),
    };

    // === Render Table ===
    await doc.table(table, {
      prepareHeader: () =>
        doc.font("Helvetica-Bold").fontSize(9).fillColor("black"),
      prepareRow: (row, i) => {
        doc.font("Helvetica").fontSize(8).fillColor("black");
        if (i % 2 === 0) {
          doc
            .rect(
              doc.x,
              doc.y,
              doc.page.width - doc.page.margins.left - doc.page.margins.right,
              20
            )
            .fill("#f5f5f5")
            .stroke();
          doc.fillColor("black");
        }
      },
      columnSpacing: 5,
      padding: 4,
    });

    doc.end();

    // === Wait for PDF to finish writing ===
    await new Promise((resolve, reject) => {
      stream.on("finish", () => {
        resolve();
      });
      stream.on("error", reject);
    });

    // === Email PDF ===
    const transporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.GOOGLE_APP_EMAIL,
        pass: process.env.GOOGLE_APP_PW,
      },
    });

    await transporter.sendMail({
      from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
      to: userEmail,
      subject: "Your Orders",
      text: "Attached is your order summary.",
      attachments: [
        {
          filename: `orders_${userId}.pdf`,
          path: pdfPath,
        },
      ],
    });

    fs.unlinkSync(pdfPath); // delete temp file

    res.json({ success: true, message: "Orders sent to email" });
  } catch (err) {
    console.error("❌ Server error:", err);
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
