const router = require("express").Router();
const moment = require("moment");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const dayjs = require("dayjs");
const nodemailer = require("nodemailer");
const User = require("../models/user");
const Order = require("../models/order");
const Product = require("../models/product");
const axios = require("axios");
const PromoCode = require("../models/promoCode");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY; // Replace with your secret key

// ✅ Initialize transaction
// ✅ Initialize Payment
router.post("/initialize", async (req, res) => {
  const { email, amount, currency } = req.body;

  try {
    const paymentData = {
      email,
      amount: amount * 100, // Convert to smallest currency unit
      callback_url: `${process.env.FRONTEND_URL}/payment-success`,
    };

    // Add currency if provided (Paystack supports NGN, USD, GHS, etc.)
    if (currency && currency !== "NGN") {
      paymentData.currency = currency;
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json(response.data);
    ////console.log("Paystack Init Response:", response.data);
  } catch (error) {
    console.error(
      "Paystack Init Error:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

// ✅ Verify Payment
router.get("/verify/:reference", async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "Paystack Verify Error:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to verify payment" });
  }
});
// GET /api/order/:reference
router.get("/order/:reference", async (req, res) => {
  const { reference } = req.params;

  try {
    const order = await Order.findOne({ reference });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.scanned) {
      return res
        .status(409)
        .json({ error: "Ticket has already been scanned." });
    }

    // ✅ Mark as scanned
    order.scanned = true;
    order.scannedAt = new Date();
    await order.save();

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ error: "Server error" });
  }
});
router.post("/order", async (req, res) => {
  const {
    reference,
    contact,
    userId,
    tickets,
    startDate,
    startTime,
    location,
    price,
    title,
    affiliate,
    promoCode,
    currency,
  } = req.body;

  console.log("📦 Order request:", req.body);

  try {
    // ✅ CRITICAL FIX 1: Check if order already exists (idempotency)
    const existingOrder = await Order.findOne({ reference });
    if (existingOrder) {
      console.log("⚠️ Order already exists for reference:", reference);
      return res.status(200).json({
        success: true,
        message: "Order already processed",
        order: existingOrder,
      });
    }

    // ✅ CRITICAL FIX 2: Verify payment with Paystack (ALWAYS when reference exists)
    let verifiedPaidAmount = 0;
    
    // Try to verify with Paystack - this determines if it's a paid or free order
    try {
      const verifyResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const paymentStatus = verifyResponse.data?.data?.status;
      const paidAmount = verifyResponse.data?.data?.amount / 100; // Convert from kobo to naira

      if (paymentStatus !== "success") {
        console.error("❌ Payment not successful:", paymentStatus);
        return res.status(400).json({
          error: "Payment verification failed. Payment status: " + paymentStatus,
        });
      }

      // ✅ Use Paystack's verified amount as source of truth
      verifiedPaidAmount = paidAmount;
      console.log("✅ Payment verified successfully:", reference);
      console.log(`💰 Verified payment amount: ₦${paidAmount}`);
      
    } catch (verifyError) {
      // ✅ If Paystack verification fails, this is a free ticket (no payment)
      // Free tickets use a generated reference not in Paystack system
      console.log("ℹ️ No Paystack transaction found - treating as free ticket");
      verifiedPaidAmount = 0;
    }

    // ✅ Apply promo code usage
    if (promoCode) {
      const promo = await PromoCode.findOne({ code: promoCode.toUpperCase() });
      if (promo) {
        promo.usedCount = (promo.usedCount || 0) + 1;
        await promo.save();
      }
    }

    // ✅ Ensure user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // ✅ Format date and tickets
    const formattedDate = dayjs(startDate).format("MMM D, YYYY"); // e.g., "Sep 28, 2025"

    const ticketList = tickets
      .map((t) => `${t.name.toUpperCase()} x${t.quantity}`)
      .join("\n");

    // ✅ Prepare Order data (but don't save yet)
    // Use verified payment amount from Paystack as source of truth
    const orderData = {
      title,
      reference,
      userId,
      contact,
      tickets,
      startDate,
      startTime,
      location,
      price: verifiedPaidAmount, // ✅ Use Paystack verified amount, not client price
      currency: currency || "NGN", // ✅ Store currency used for payment
      createdAt: moment().format(),
    };
    if (affiliate) orderData.affiliate = affiliate;
    if (promoCode) orderData.promoCode = promoCode;
    // ✅ Generate PDF using PDFKit
    const doc = new PDFDocument({ size: [400, 530], margin: 0 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const w = doc.page.width;
    const h = doc.page.height;

    // === Outer Red Border ===
    doc
      .rect(15, 15, w - 30, h - 30)
      .lineWidth(8)
      .strokeColor("#DC143C")
      .stroke();

    // === Inner Green Border ===
    doc
      .rect(25, 25, w - 50, h - 50)
      .lineWidth(4)
      .strokeColor("#228B22")
      .stroke();

    // === Top Info Box ===
    const infoBoxX = 45,
      infoBoxY = 45,
      infoBoxW = 220,
      infoBoxH = 110;
    doc
      .roundedRect(infoBoxX, infoBoxY, infoBoxW, infoBoxH, 15)
      .lineWidth(3)
      .strokeColor("#228B22")
      .stroke();

    // Date, Time, Booking ID
    doc
      .fontSize(20)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text(formattedDate, infoBoxX + 15, infoBoxY + 15, {
        width: infoBoxW - 30,
        align: "center",
      });

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(startTime, infoBoxX + 15, infoBoxY + 45, {
        width: infoBoxW - 30,
        align: "center",
      });

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("BOOKING ID", infoBoxX + 15, infoBoxY + 65, {
        width: infoBoxW - 30,
        align: "center",
      });

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(reference, infoBoxX + 15, infoBoxY + 80, {
        width: infoBoxW - 30,
        align: "center",
      });

    // === QR Code ===
    try {
      const qrDataUrl = await QRCode.toDataURL(reference, {
        width: 80,
        margin: 1,
      });
      const qrImage = Buffer.from(qrDataUrl.split(",")[1], "base64");
      doc.image(qrImage, w - 110, 55, { width: 70 });
    } catch (error) {
      console.log("QR code generation failed:", error);
    }

    // === Section Title ===
    const titleY = 180;
    doc
      .fontSize(16)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text("BOOKING CONFIRMATION", 45, titleY);
    doc
      .moveTo(45, titleY + 20)
      .lineTo(w - 45, titleY + 20)
      .lineWidth(2)
      .strokeColor("#228B22")
      .stroke();

    // === Field Drawing Function ===
    function drawField(label, value, y, isTicket = false) {
      const labelWidth = 80;
      const valueWidth = w - 130 - labelWidth;
      const fieldHeight = isTicket ? 60 : 35;

      // Green label box
      doc
        .roundedRect(45, y, labelWidth, fieldHeight, 8)
        .fillAndStroke("#228B22", "#228B22");
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(label, 45 + 10, y + (isTicket ? 20 : 12), {
          width: labelWidth - 20,
          align: "center",
        });

      // Value box
      doc
        .roundedRect(45 + labelWidth + 10, y, valueWidth, fieldHeight, 8)
        .lineWidth(2)
        .strokeColor("#228B22")
        .fillAndStroke("#FFFFFF", "#228B22");

      doc
        .fillColor("#000000")
        .font("Helvetica")
        .fontSize(11)
        .text(value, 45 + labelWidth + 20, y + (isTicket ? 10 : 12), {
          width: valueWidth - 20,
          align: "left",
        });
    }

    // === Draw All Fields ===
    let currentY = 220;
    drawField("NAME", contact.name || user.name, currentY);
    currentY += 50;
    drawField("EMAIL", contact.email, currentY);
    currentY += 50;
    drawField("AMOUNT", `\u20A6${verifiedPaidAmount}`, currentY);

    currentY += 50;
    drawField("TICKET", ticketList, currentY, true);

    // === Footer Text ===
    const footerTextY = h - 80; // Place footer text slightly higher from the bottom
    doc
      .fontSize(10)
      .fillColor("#DC143C")
      .font("Helvetica-Bold")
      .text(
        `YOUR BOOKING FOR ${title.toUpperCase()} HAS BEEN CONFIRMED`,
        45,
        footerTextY,
        {
          width: w - 90,
          align: "center",
        }
      );

    // === Logo ===
    const logoPath = path.join(__dirname, "views", "IMG_0264.png");
    if (fs.existsSync(logoPath)) {
      try {
        const logoY = footerTextY + 20; // 20px below the text
        doc.image(logoPath, w / 2 - 15, logoY, { width: 30 });
      } catch (error) {
        console.log("Logo loading failed:", error);
      }
    }

    doc.end();
    const pdfBuffer = await pdfPromise;

    // ✅ CRITICAL FIX: Save Order FIRST after payment verification (before email)
    // This ensures payment is never lost even if email fails
    const order = new Order(orderData);
    await order.save();
    console.log("✅ Order saved successfully after payment verification:", reference);

    // ✅ Email setup - FIXED: createTransport not createTransporter
    const mailTransporter = nodemailer.createTransport({
      host: "mail.privateemail.com", // Namecheap Private Email SMTP host
      port: 465,
      secure: true,
      auth: {
        user: process.env.GOOGLE_APP_EMAIL, // should be info@234tickets.live
        pass: process.env.GOOGLE_APP_PW, // your mailbox password
      },
    });

    // ✅ Send emails - wrapped in try-catch to prevent order failure if email fails
    let emailStatus = { customer: false, owner: false, error: null };
    
    try {
      // ✅ Email to customer with PDF
      const customerEmail = {
        from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
        to: contact.email,
        subject: "🎟️ Your Ticket Order Confirmation",
        html: `
          <div style="font-family: Arial; line-height: 1.6;">
            <h2>🎉 Your ticket for <strong>${title}</strong> is confirmed!</h2>
            <p><strong>Reference:</strong> ${reference}</p>
            <p>Your ticket is attached as a PDF.</p>
          </div>
        `,
        attachments: [
          {
            filename: `ticket-${reference}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      };

      await mailTransporter.sendMail(customerEmail);
      emailStatus.customer = true;
      console.log("✅ Customer email sent successfully to:", contact.email);

      // ✅ Email to event owner without PDF
      const ticketListHtml = tickets
        .map((t) => `${t.name.toUpperCase()} x${t.quantity}`)
        .join("<br>");
      const ownerEmail = {
        from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
        to: user.email,
        subject: `📢 New Ticket Order for ${title}`,
        html: `
          <div style="font-family: Arial; line-height: 1.6;">
            <h2>📢 New order received for your event: <strong>${title}</strong></h2>
            <p><strong>Customer:</strong> ${contact.name || user.name} (${
          contact.email
        })</p>
            <p><strong>Reference:</strong> ${reference}</p>
            <p><strong>Tickets:</strong><br>${ticketListHtml}</p>
            <p><strong>Total:</strong> ₦${verifiedPaidAmount}</p>
            <p><strong>Date:</strong> ${formattedDate} at ${startTime}</p>
          </div>
        `,
      };

      await mailTransporter.sendMail(ownerEmail);
      emailStatus.owner = true;
      console.log("✅ Owner email sent successfully to:", user.email);

    } catch (emailError) {
      // ✅ Log email error but DON'T fail the order (payment already successful)
      console.error("❌ EMAIL SENDING FAILED:", emailError);
      console.error("Email error details:", {
        message: emailError.message,
        code: emailError.code,
        command: emailError.command,
        response: emailError.response,
        customerEmailSent: emailStatus.customer,
        ownerEmailSent: emailStatus.owner,
        reference: reference,
        customerEmail: contact.email,
        ownerEmail: user.email,
      });
      emailStatus.error = emailError.message;
      
      // Continue execution - order is already saved
    }

    // ✅ Reduce ticket quantity correctly
    const product = await Product.findOne({ title, user: userId });

    if (product) {
      for (const t of tickets) {
        const ticket = product.event.tickets.find(
          (tk) => tk.name.toLowerCase() === t.name.toLowerCase()
        );

        if (ticket && ticket.type === "limited") {
          // Validate purchase does not exceed current limits
          const maxPurchase = Math.min(ticket.purchaseLimit, ticket.quantity);

          if (t.quantity > maxPurchase) {
            return res.status(400).json({
              error: `You can only purchase up to ${maxPurchase} ticket(s) for ${ticket.name}.`,
            });
          }

          // Reduce quantity
          ticket.quantity -= t.quantity;
          if (ticket.quantity < 0) ticket.quantity = 0;

          // Update purchaseLimit dynamically — can't be more than quantity left
          ticket.purchaseLimit = Math.min(
            ticket.purchaseLimit,
            ticket.quantity
          );
        }
      }

      await product.save();
    } else {
      console.warn(
        "⚠️ Product not found for order, ticket quantity not updated."
      );
    }

    // ✅ Response with email status
    const responseMessage = emailStatus.error
      ? "Order saved and tickets updated. Email delivery encountered issues - please check logs."
      : "Order saved, emails sent successfully, and tickets updated.";
    
    res.status(201).json({
      success: true,
      message: responseMessage,
      order,
      emailStatus: {
        customerEmailSent: emailStatus.customer,
        ownerEmailSent: emailStatus.owner,
        emailError: emailStatus.error,
      },
    });
  } catch (error) {
    console.error("❌ Order processing error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
  
