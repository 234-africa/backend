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

// ✅ Helper function for async email sending with retry logic
async function sendEmailAsync(mailOptions, retries = 3) {
  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GOOGLE_APP_EMAIL,
      pass: process.env.GOOGLE_APP_PW,
    },
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${mailOptions.to}`);
      return true;
    } catch (error) {
      console.error(`❌ Email attempt ${attempt}/${retries} failed to ${mailOptions.to}:`, error.message);
      if (attempt === retries) {
        console.error(`❌ All email attempts failed for ${mailOptions.to}`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// ✅ Currency symbol helper
function getCurrencySymbol(currency) {
  const symbols = {
    NGN: "₦",
    USD: "$",
    GBP: "£",
    EUR: "€",
    GHS: "GH₵"
  };
  return symbols[currency] || "₦";
}

// ✅ Helper function to process order (shared by webhook and /order endpoint)
async function processOrderWithTicket(orderData) {
  const {
    reference,
    contact,
    userId,
    productId,
    tickets,
    startDate,
    startTime,
    location,
    price,
    title,
    affiliate,
    promoCode,
    currency,
  } = orderData;

  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");
  
  const orderCurrency = currency || user.currency || "NGN";
  const currencySymbol = getCurrencySymbol(orderCurrency);

  const formattedDate = dayjs(startDate).format("MMM D, YYYY");
  const ticketList = tickets
    .map((t) => `${t.name.toUpperCase()} x${t.quantity}`)
    .join("\n");

  // ✅ VALIDATE ticket availability BEFORE saving order (prevents over-selling)
  const product = await Product.findById(productId);

  if (product) {
    for (const t of tickets) {
      const ticket = product.event.tickets.find(
        (tk) => tk.name.toLowerCase() === t.name.toLowerCase()
      );

      if (ticket && ticket.type === "limited") {
        const maxPurchase = Math.min(ticket.purchaseLimit, ticket.quantity);

        if (t.quantity > maxPurchase) {
          throw new Error(
            `You can only purchase up to ${maxPurchase} ticket(s) for ${ticket.name}.`
          );
        }
      }
    }
  }

  // ✅ Apply promo code usage AFTER validation (prevents incorrect counting on failures)
  if (promoCode) {
    const promo = await PromoCode.findOne({ code: promoCode.toUpperCase() });
    if (promo) {
      promo.usedCount = (promo.usedCount || 0) + 1;
      await promo.save();
    }
  }

  // ✅ Save Order AFTER validation
  const newOrderData = {
    title,
    reference,
    productId,
    userId,
    contact,
    tickets,
    startDate,
    startTime,
    location,
    price,
    currency: orderCurrency,
    createdAt: moment().format(),
  };
  if (affiliate) newOrderData.affiliate = affiliate;
  if (promoCode) newOrderData.promoCode = promoCode;

  const order = new Order(newOrderData);
  await order.save();

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

  doc
    .rect(15, 15, w - 30, h - 30)
    .lineWidth(8)
    .strokeColor("#DC143C")
    .stroke();

  doc
    .rect(25, 25, w - 50, h - 50)
    .lineWidth(4)
    .strokeColor("#228B22")
    .stroke();

  const infoBoxX = 45,
    infoBoxY = 45,
    infoBoxW = 220,
    infoBoxH = 110;
  doc
    .roundedRect(infoBoxX, infoBoxY, infoBoxW, infoBoxH, 15)
    .lineWidth(3)
    .strokeColor("#228B22")
    .stroke();

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

  function drawField(label, value, y, isTicket = false) {
    const labelWidth = 80;
    const valueWidth = w - 130 - labelWidth;
    const fieldHeight = isTicket ? 60 : 35;

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

  let currentY = 220;
  drawField("NAME", contact.name || user.name, currentY);
  currentY += 50;
  drawField("EMAIL", contact.email, currentY);
  currentY += 50;
  drawField("AMOUNT", `${currencySymbol}${price}`, currentY);

  currentY += 50;
  drawField("TICKET", ticketList, currentY, true);

  const footerTextY = h - 80;
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

  const logoPath = path.join(__dirname, "views", "IMG_0264.png");
  if (fs.existsSync(logoPath)) {
    try {
      const logoY = footerTextY + 20;
      doc.image(logoPath, w / 2 - 15, logoY, { width: 30 });
    } catch (error) {
      console.log("Logo loading failed:", error);
    }
  }

  doc.end();
  const pdfBuffer = await pdfPromise;

  // ✅ Prepare emails
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
        <p><strong>Total:</strong> ${currencySymbol}${price}</p>
        <p><strong>Date:</strong> ${formattedDate} at ${startTime}</p>
      </div>
    `,
  };

  // ✅ Send emails asynchronously (non-blocking)
  setImmediate(async () => {
    await sendEmailAsync(customerEmail);
    await sendEmailAsync(ownerEmail);
  });

  // ✅ Reduce ticket quantity (product already fetched and validated above)
  if (product) {
    for (const t of tickets) {
      const ticket = product.event.tickets.find(
        (tk) => tk.name.toLowerCase() === t.name.toLowerCase()
      );

      if (ticket && ticket.type === "limited") {
        // Reduce quantity (already validated above)
        ticket.quantity -= t.quantity;
        if (ticket.quantity < 0) ticket.quantity = 0;

        // Update purchaseLimit dynamically
        ticket.purchaseLimit = Math.min(
          ticket.purchaseLimit,
          ticket.quantity
        );
      }
    }

    await product.save();
  }

  return order;
}

// ✅ Initialize transaction
// ✅ Initialize Payment
router.post("/initialize", async (req, res) => {
  const { email, amount, metadata, currency } = req.body;

  try {
    const requestedCurrency = currency || "NGN";
    
    const PAYSTACK_SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "GHS"];
    
    if (!PAYSTACK_SUPPORTED_CURRENCIES.includes(requestedCurrency)) {
      return res.status(400).json({ 
        error: `Currency '${requestedCurrency}' is not supported by Paystack. Please use one of: NGN, USD, GBP, or GHS.`,
        supportedCurrencies: PAYSTACK_SUPPORTED_CURRENCIES
      });
    }
    
    const paymentCurrency = requestedCurrency;
    
    const paymentData = {
      email,
      amount: amount * 100, // Convert to smallest unit (kobo/cents/pence)
      currency: paymentCurrency, // NGN, USD, GBP, GHS (Paystack supported)
      callback_url: `${process.env.FRONTEND_URL}/payment-success`,
    };

    if (metadata) {
      paymentData.metadata = {
        ...metadata,
        currency: paymentCurrency,
      };
    } else {
      paymentData.metadata = {
        currency: paymentCurrency,
      };
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

// ✅ Paystack Webhook Handler - Ensures transactions are confirmed even if frontend fails
router.post("/webhook/paystack", async (req, res) => {
  const crypto = require("crypto");
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash === req.headers["x-paystack-signature"]) {
    const event = req.body;
    
    if (event.event === "charge.success") {
      const { reference, metadata } = event.data;
      
      console.log(`✅ Webhook received for reference: ${reference}`);
      
      // ✅ Respond immediately to Paystack (prevent timeout)
      res.sendStatus(200);
      
      // ✅ Process order asynchronously
      setImmediate(async () => {
        try {
          // ✅ Check if order already exists (idempotency)
          const existingOrder = await Order.findOne({ reference });
          
          if (existingOrder) {
            console.log(`✅ Order already exists for reference: ${reference}`);
            return;
          }
          
          // ✅ If metadata exists, create order from webhook
          if (metadata && metadata.orderData) {
            console.log(`📦 Creating order from webhook for reference: ${reference}`);
            
            const orderData = {
              ...metadata.orderData,
              reference,
              currency: metadata.currency || metadata.orderData.currency || "NGN",
            };
            
            // ✅ Process order (promo code handled inside helper function)
            await processOrderWithTicket(orderData);
            console.log(`✅ Order created successfully from webhook: ${reference}`);
          } else {
            console.log(`⚠️ No metadata found for reference: ${reference}. Waiting for frontend to create order.`);
          }
        } catch (error) {
          console.error("❌ Webhook order processing error:", error);
        }
      });
    } else {
      res.sendStatus(200);
    }
  } else {
    console.error("❌ Invalid webhook signature");
    res.sendStatus(400);
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
    productId,
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
    // ✅ Check if order already exists (idempotency)
    const existingOrder = await Order.findOne({ reference });
    if (existingOrder) {
      console.log(`✅ Order already exists for reference: ${reference}`);
      return res.status(200).json({
        success: true,
        message: "Order already exists.",
        order: existingOrder,
      });
    }

    // ✅ Process order using shared helper (handles PDF, emails, ticket quantity, and promo codes)
    const order = await processOrderWithTicket({
      ...req.body,
      currency: currency || "NGN",
    });

    // ✅ Instant response (emails sent asynchronously)
    res.status(201).json({
      success: true,
      message: "Order saved, emails sent, and tickets updated.",
      order,
    });
  } catch (error) {
    console.error("❌ Order processing error:", error);
    
    // ✅ Handle duplicate key error (race condition between webhook and frontend)
    if (error.code === 11000 || error.message?.includes("duplicate key")) {
      return res.status(200).json({
        success: true,
        message: "Order already exists (created by webhook).",
      });
    }
    
    // ✅ Handle ticket limit exceeded
    if (error.message?.includes("can only purchase")) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: error.message || "Server error" });
  }
});

module.exports = router;
