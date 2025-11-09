const router = require("express").Router();
const Order = require("../models/order");
const Product = require("../models/product");
const verifyToken = require("../middelwares/verify-token");

const nodemailer = require("nodemailer");

const fs = require("fs");

const path = require("path");
const PDFDocument = require("pdfkit-table");
const ExcelJS = require("exceljs");

router.get("/orders/download-and-email", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;
    const userEmail = req.decoded.email;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });

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
      datas: orders.map((order) => {
        const currencySymbols = {
          NGN: "₦",
          USD: "$",
          GBP: "£",
          EUR: "€",
          GHS: "GH₵",
        };
        const currency = order.currency || "NGN";
        const symbol = currencySymbols[currency] || "₦";
        
        return {
          _id: order._id.toString(),
          date: new Date(order.createdAt).toLocaleString(),
          reference: order.reference || "N/A",
          title: order.title || "N/A",
          email: order.contact?.email || "N/A",
          phone: order.contact?.phone || "N/A",
          price: `${symbol} ${(order.price || 0).toLocaleString()}`,
        };
      }),
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

    // === Validate Email Configuration ===
    if (!process.env.GOOGLE_APP_EMAIL || !process.env.GOOGLE_APP_PW) {
      console.error("❌ CRITICAL: Email credentials (GOOGLE_APP_EMAIL or GOOGLE_APP_PW) are not configured!");
      fs.unlinkSync(pdfPath);
      return res.status(500).json({ 
        success: false, 
        message: "Email service is not configured. Please contact support." 
      });
    }

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

    try {
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

      console.log(`✅ Orders PDF emailed successfully to ${userEmail}`);
      fs.unlinkSync(pdfPath);
      res.json({ success: true, message: "Orders sent to email" });
    } catch (emailError) {
      console.error("❌ Email sending failed:", emailError.message);
      console.error("Full error:", emailError);
      fs.unlinkSync(pdfPath);
      return res.status(500).json({ 
        success: false, 
        message: `Failed to send email: ${emailError.message}` 
      });
    }
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/orders/export-excel", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });

    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "No orders found",
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Orders");

    worksheet.columns = [
      { header: "ORDER ID", key: "orderId", width: 25 },
      { header: "DATE", key: "date", width: 20 },
      { header: "REFERENCE", key: "reference", width: 20 },
      { header: "EVENT", key: "event", width: 30 },
      { header: "CUSTOMER EMAIL", key: "email", width: 30 },
      { header: "PHONE", key: "phone", width: 15 },
      { header: "AMOUNT", key: "amount", width: 15 },
      { header: "CURRENCY", key: "currency", width: 10 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF228B22" },
    };
    worksheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true };

    orders.forEach((order) => {
      const currencySymbols = {
        NGN: "₦",
        USD: "$",
        GBP: "£",
        EUR: "€",
        GHS: "GH₵",
      };
      const currency = order.currency || "NGN";
      const symbol = currencySymbols[currency] || "₦";

      worksheet.addRow({
        orderId: order._id.toString(),
        date: new Date(order.createdAt).toLocaleString(),
        reference: order.reference || "N/A",
        event: order.title || "N/A",
        email: order.contact?.email || "N/A",
        phone: order.contact?.phone || "N/A",
        amount: `${symbol} ${(order.price || 0).toLocaleString()}`,
        currency: currency,
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=orders_${userId}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("❌ Excel export error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/orders/download-and-email-excel", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id;
    const userEmail = req.decoded.email;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });

    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "No orders found",
      });
    }

    const excelPath = path.join(__dirname, `orders_${userId}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Orders");

    worksheet.columns = [
      { header: "ORDER ID", key: "orderId", width: 25 },
      { header: "DATE", key: "date", width: 20 },
      { header: "REFERENCE", key: "reference", width: 20 },
      { header: "EVENT", key: "event", width: 30 },
      { header: "CUSTOMER EMAIL", key: "email", width: 30 },
      { header: "PHONE", key: "phone", width: 15 },
      { header: "AMOUNT", key: "amount", width: 15 },
      { header: "CURRENCY", key: "currency", width: 10 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF228B22" },
    };
    worksheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true };

    orders.forEach((order) => {
      const currencySymbols = {
        NGN: "₦",
        USD: "$",
        GBP: "£",
        EUR: "€",
        GHS: "GH₵",
      };
      const currency = order.currency || "NGN";
      const symbol = currencySymbols[currency] || "₦";

      worksheet.addRow({
        orderId: order._id.toString(),
        date: new Date(order.createdAt).toLocaleString(),
        reference: order.reference || "N/A",
        event: order.title || "N/A",
        email: order.contact?.email || "N/A",
        phone: order.contact?.phone || "N/A",
        amount: `${symbol} ${(order.price || 0).toLocaleString()}`,
        currency: currency,
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      }
    });

    await workbook.xlsx.writeFile(excelPath);

    if (!process.env.GOOGLE_APP_EMAIL || !process.env.GOOGLE_APP_PW) {
      console.error("❌ CRITICAL: Email credentials (GOOGLE_APP_EMAIL or GOOGLE_APP_PW) are not configured!");
      fs.unlinkSync(excelPath);
      return res.status(500).json({ 
        success: false, 
        message: "Email service is not configured. Please contact support." 
      });
    }

    const transporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.GOOGLE_APP_EMAIL,
        pass: process.env.GOOGLE_APP_PW,
      },
    });

    try {
      await transporter.sendMail({
        from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
        to: userEmail,
        subject: "Your Orders (Excel)",
        text: "Attached is your order summary in Excel format.",
        attachments: [
          {
            filename: `orders_${userId}.xlsx`,
            path: excelPath,
          },
        ],
      });

      console.log(`✅ Orders Excel emailed successfully to ${userEmail}`);
      fs.unlinkSync(excelPath);
      res.json({ success: true, message: "Orders Excel sent to email" });
    } catch (emailError) {
      console.error("❌ Email sending failed:", emailError.message);
      console.error("Full error:", emailError);
      fs.unlinkSync(excelPath);
      return res.status(500).json({ 
        success: false, 
        message: `Failed to send email: ${emailError.message}` 
      });
    }
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    const orders = await Order.find({ userId: userId }).sort({ createdAt: -1 });
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
    const orders = await Order.find().sort({ createdAt: -1 });

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
      .sort({ createdAt: -1 })
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

router.get("/orders/by-event/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const organizerId = req.decoded._id;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (product.user.toString() !== organizerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view orders for this event",
      });
    }

    const orders = await Order.find({ productId })
      .sort({ createdAt: -1 })
      .populate("userId", "name email");

    res.json({
      success: true,
      count: orders.length,
      event: {
        id: product._id,
        title: product.title,
      },
      orders,
    });
  } catch (error) {
    console.error("Error fetching orders by event:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
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
