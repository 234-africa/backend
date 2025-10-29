const router = require("express").Router();
const moment = require("moment");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const dayjs = require("dayjs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const User = require("../models/user");
const Order = require("../models/order");
const Product = require("../models/product");
const axios = require("axios");
const PromoCode = require("../models/promoCode");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

async function sendEmailWithRetry(transporter, mailOptions, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📧 Email attempt ${attempt}/${maxRetries} to ${mailOptions.to}`);
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${mailOptions.to}: ${info.messageId}`);
      return info;
    } catch (error) {
      lastError = error;
      console.error(`❌ Email attempt ${attempt}/${maxRetries} failed to ${mailOptions.to}:`, error.message);
      if (attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  console.error(`❌ All email attempts failed to ${mailOptions.to}:`, lastError);
  throw lastError;
}

async function generateTicketPDF(orderDetails) {
  const { reference, contact, user, tickets, startDate, startTime, title, price } = orderDetails;
  
  const formattedDate = dayjs(startDate).format("MMM D, YYYY");
  const ticketList = tickets
    .map((t) => `${t.name.toUpperCase()} x${t.quantity}`)
    .join("\n");

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
    console.log("⚠️ QR code generation failed:", error.message);
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
  drawField("AMOUNT", `\u20A6${price}`, currentY);
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
      console.log("⚠️ Logo loading failed:", error.message);
    }
  }

  doc.end();
  return await pdfPromise;
}

async function processOrderAndSendEmails(orderData) {
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
  } = orderData;

  console.log(`📦 Processing order: ${reference}`);

  const existingOrder = await Order.findOne({ reference });
  if (existingOrder) {
    console.log(`⚠️ Order ${reference} already exists, skipping...`);
    return existingOrder;
  }

  if (promoCode) {
    const promo = await PromoCode.findOne({ code: promoCode.toUpperCase() });
    if (promo) {
      const isUnlimited = promo.usageLimit === 0;
      const isWithinLimit = isUnlimited || promo.usedCount < promo.usageLimit;
      
      if (isWithinLimit) {
        promo.usedCount = (promo.usedCount || 0) + 1;
        await promo.save();
        console.log(`✅ Promo code ${promoCode} usage updated: ${promo.usedCount}${isUnlimited ? ' (unlimited)' : '/' + promo.usageLimit}`);
      } else {
        console.warn(`⚠️ Promo code ${promoCode} has reached its usage limit, not incrementing`);
      }
    }
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const formattedDate = dayjs(startDate).format("MMM D, YYYY");

  const newOrderData = {
    title,
    reference,
    userId,
    contact,
    tickets,
    startDate,
    startTime,
    location,
    price,
    createdAt: moment().format(),
  };
  if (affiliate) newOrderData.affiliate = affiliate;
  if (promoCode) newOrderData.promoCode = promoCode;

  const order = new Order(newOrderData);
  await order.save();
  console.log(`✅ Order ${reference} saved to database`);

  const pdfBuffer = await generateTicketPDF({
    reference,
    contact,
    user,
    tickets,
    startDate,
    startTime,
    title,
    price,
  });
  console.log(`✅ PDF ticket generated for ${reference}`);

  const mailTransporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GOOGLE_APP_EMAIL,
      pass: process.env.GOOGLE_APP_PW,
    },
  });

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

  await sendEmailWithRetry(mailTransporter, customerEmail);

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
        <p><strong>Total:</strong> ₦${price}</p>
        <p><strong>Date:</strong> ${formattedDate} at ${startTime}</p>
      </div>
    `,
  };

  await sendEmailWithRetry(mailTransporter, ownerEmail);

  const product = await Product.findOne({ title, user: userId });

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

        ticket.quantity -= t.quantity;
        if (ticket.quantity < 0) ticket.quantity = 0;

        ticket.purchaseLimit = Math.min(
          ticket.purchaseLimit,
          ticket.quantity
        );
      }
    }

    await product.save();
    console.log(`✅ Ticket quantities updated for ${title}`);
  } else {
    console.warn(
      `⚠️ Product not found for order ${reference}, ticket quantity not updated.`
    );
  }

  return order;
}

router.post("/paystack-webhook", async (req, res) => {
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      console.error("❌ Webhook signature verification failed");
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    console.log(`📨 Webhook received: ${event.event}`);

    if (event.event === "charge.success") {
      const { reference, customer, amount } = event.data;
      
      console.log(`✅ Payment successful via webhook: ${reference}, Amount: ₦${amount / 100}`);
      console.log(`📧 Customer: ${customer.email}`);
      console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
      console.log(`ℹ️ Order creation will be handled by /order endpoint with server-side price verification`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.sendStatus(500);
  }
});

router.post("/initialize", async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100,
        callback_url: `${process.env.FRONTEND_URL}/payment-success`,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Payment initialized: ${response.data.data.reference}, Amount: ₦${amount}`);
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "❌ Paystack Init Error:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

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

    const { status, amount } = response.data.data;
    console.log(`✅ Payment verified: ${reference}, Status: ${status}, Amount: ${amount / 100}`);
    
    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      "❌ Paystack Verify Error:",
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
    title,
    affiliate,
    promoCode,
  } = req.body;

  console.log(`📦 Order request received: ${reference}`);

  try {
    const product = await Product.findOne({ title, user: userId });
    if (!product) {
      console.error(`❌ Product not found: ${title} for user ${userId}`);
      return res.status(404).json({
        error: "Event not found. Please verify the event details.",
      });
    }

    let calculatedPrice = 0;
    for (const requestedTicket of tickets) {
      const productTicket = product.event.tickets.find(
        (t) => t.name.toLowerCase() === requestedTicket.name.toLowerCase()
      );

      if (!productTicket) {
        console.error(`❌ Ticket type not found: ${requestedTicket.name}`);
        return res.status(404).json({
          error: `Ticket type "${requestedTicket.name}" not found for this event.`,
        });
      }

      calculatedPrice += productTicket.price * requestedTicket.quantity;
    }

    let discountedPrice = calculatedPrice;
    let appliedPromo = null;
    if (promoCode) {
      const promo = await PromoCode.findOne({ code: promoCode.toUpperCase() });
      if (promo) {
        const isUnlimited = promo.usageLimit === 0;
        const isWithinLimit = isUnlimited || promo.usedCount < promo.usageLimit;
        
        if (!isWithinLimit) {
          console.warn(`⚠️ Promo code ${promoCode} has reached its usage limit`);
        } else {
          const now = new Date();
          if (promo.expiryDate && new Date(promo.expiryDate) > now) {
            let discountAmount = 0;
            if (promo.discountType === "percentage") {
              discountAmount = (calculatedPrice * promo.discountValue) / 100;
              console.log(`✅ Promo code ${promoCode} applied: ${promo.discountValue}% off`);
            } else if (promo.discountType === "fixed") {
              discountAmount = promo.discountValue;
              console.log(`✅ Promo code ${promoCode} applied: ₦${promo.discountValue} off`);
            }
            discountedPrice = calculatedPrice - discountAmount;
            if (discountedPrice < 0) discountedPrice = 0;
            appliedPromo = promo;
            console.log(`💰 Price after discount: ₦${discountedPrice} (Original: ₦${calculatedPrice})`);
          } else {
            console.warn(`⚠️ Promo code ${promoCode} has expired`);
          }
        }
      } else {
        console.warn(`⚠️ Promo code ${promoCode} not found`);
      }
    }

    const finalPriceKobo = Math.round(discountedPrice * 100);
    const finalPrice = finalPriceKobo / 100;

    console.log(`🔍 Verifying payment with Paystack for reference: ${reference}`);
    console.log(`💰 Server-calculated price: ₦${finalPrice.toFixed(2)} (${finalPriceKobo} kobo)`);
    
    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paymentData = verifyResponse.data.data;
    
    if (paymentData.status !== "success") {
      console.error(`❌ Payment not successful for ${reference}. Status: ${paymentData.status}`);
      return res.status(400).json({
        error: "Payment verification failed. Payment was not successful.",
        status: paymentData.status,
      });
    }

    const paidAmountKobo = paymentData.amount;
    const paidAmount = paidAmountKobo / 100;
    console.log(`💳 Paystack verified amount: ₦${paidAmount.toFixed(2)} (${paidAmountKobo} kobo)`);

    if (paidAmountKobo !== finalPriceKobo) {
      console.error(`❌ SECURITY: Payment amount mismatch for ${reference}. Paid: ${paidAmountKobo} kobo (₦${paidAmount.toFixed(2)}), Expected: ${finalPriceKobo} kobo (₦${finalPrice.toFixed(2)})`);
      return res.status(400).json({
        error: `Payment amount verification failed. Amount paid (₦${paidAmount.toFixed(2)}) does not match the required amount (₦${finalPrice.toFixed(2)}).`,
      });
    }

    console.log(`✅ Payment amount verified: ${paidAmountKobo} kobo (₦${paidAmount.toFixed(2)}) matches expected ${finalPriceKobo} kobo (₦${finalPrice.toFixed(2)})`);

    const orderData = {
      reference,
      contact,
      userId,
      tickets,
      startDate,
      startTime,
      location,
      price: finalPrice,
      title,
      affiliate,
      promoCode,
    };

    const order = await processOrderAndSendEmails(orderData);

    res.status(201).json({
      success: true,
      message: "Payment verified, order saved, emails sent, and tickets updated.",
      order,
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.error(`❌ Payment reference ${reference} not found on Paystack`);
      return res.status(404).json({
        error: "Payment reference not found. Please ensure payment was completed.",
      });
    }

    console.error(`❌ Order processing error for ${reference}:`, error.message);
    return res.status(500).json({
      error: "Failed to process order",
      details: error.message,
    });
  }
});

module.exports = router;
    
