const router = require("express").Router();
const moment = require("moment");
const fs = require("fs");
const ExcelJS = require("exceljs");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const path = require("path");
const dayjs = require("dayjs");
const nodemailer = require("nodemailer");
const User = require("../models/user");
const Order = require("../models/order");
const Product = require("../models/product");
const axios = require("axios");
const PromoCode = require("../models/promoCode");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Fincra Configuration - supports multiple env var naming conventions
const FINCRA_SECRET_KEY = process.env.FINCRA_SECRET_KEY || process.env.FINCRA_SECRET;
const FINCRA_PUBLIC_KEY = process.env.FINCRA_PUBLIC_KEY || process.env.FINCRA_PUBLICKEY;
const FINCRA_WEBHOOK_SECRET = process.env.FINCRA_WEBHOOK_SECRET || process.env.FINCRA_WEBHOOK;

// Alat Pay Configuration - supports multiple env var naming conventions
const ALATPAY_API_KEY = process.env.ALATPAY_API_KEY || process.env.ALAT_PUBLICKEY || process.env.ALAT_API_KEY;
const ALATPAY_BUSINESS_ID = process.env.ALATPAY_BUSINESS_ID || process.env.ALAT_BUSINESS_ID || process.env.ALAT_BUSINESSID;
const ALATPAY_WEBHOOK_SECRET = process.env.ALATPAY_WEBHOOK_SECRET || process.env.ALAT_SECRET_KEY || process.env.ALAT_WEBHOOK_SECRET;

// ✅ Helper function for async email sending with retry logic
async function sendEmailAsync(mailOptions, retries = 3) {
  if (!process.env.GOOGLE_APP_EMAIL || !process.env.GOOGLE_APP_PW) {
    console.error("❌ CRITICAL: Email credentials (GOOGLE_APP_EMAIL or GOOGLE_APP_PW) are not configured!");
    console.error("❌ Cannot send email to:", mailOptions.to);
    return false;
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

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${mailOptions.to}`);
      return true;
    } catch (error) {
      console.error(`❌ Email attempt ${attempt}/${retries} failed to ${mailOptions.to}:`, error.message);
      console.error(`❌ Full error:`, error);
      if (attempt === retries) {
        console.error(`❌ All email attempts failed for ${mailOptions.to}`);
        console.error(`❌ Email config - Host: mail.privateemail.com, Port: 465, User: ${process.env.GOOGLE_APP_EMAIL ? 'SET' : 'NOT SET'}`);
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
    GHS: "GH₵",
    KES: "KSh",
    UGX: "USh",
    ZMW: "ZK",
    ZAR: "R"
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

  // ✅ Generate QR Code for the ticket
  const qrCodeDataURL = await QRCode.toDataURL(reference, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 200,
    margin: 2
  });

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
    drawField("AMOUNT", `${currencySymbol}${price}`, currentY);

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

  // ✅ Prepare emails
  const customerEmail = {
    from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
    to: contact.email,
    subject: "🎟️ Your Ticket Order Confirmation",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ticket Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                <!-- Header with brand colors -->
                <tr>
                  <td style="background: linear-gradient(135deg, #228B22 0%, #047143 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">🎉 Ticket Confirmed!</h1>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #333333;">Hi <strong>${contact.name || user.name}</strong>,</p>
                    <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #333333;">Great news! Your ticket for <strong style="color: #228B22;">${title}</strong> has been confirmed.</p>
                    
                    <!-- Ticket Info Card -->
                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 30px; background-color: #f9f9f9; border-radius: 12px; overflow: hidden;">
                      <tr>
                        <td style="padding: 20px;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #666666;">Reference Number</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #228B22; font-weight: 700; text-align: right; font-family: monospace;">${reference}</td>
                            </tr>
                            <tr>
                              <td colspan="2" style="padding: 12px 0 8px 0; border-top: 1px solid #e0e0e0; font-size: 14px; color: #666666;">Event Details</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Date</td>
                              <td style="padding: 4px 0; font-size: 14px; color: #333333; font-weight: 600; text-align: right;">${formattedDate}</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Time</td>
                              <td style="padding: 4px 0; font-size: 14px; color: #333333; font-weight: 600; text-align: right;">${startTime}</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Amount</td>
                              <td style="padding: 4px 0; font-size: 16px; color: #228B22; font-weight: 700; text-align: right;">${currencySymbol}${price}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA -->
                    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #666666;">📎 Your ticket is attached as a PDF file with a scannable QR code. Please present it at the event entrance.</p>
                    
                    <!-- Tips -->
                    <div style="background-color: #fff3cd; border-left: 4px solid #DC143C; padding: 16px; border-radius: 8px; margin: 20px 0;">
                      <p style="margin: 0; font-size: 14px; color: #856404; line-height: 1.5;"><strong>💡 Quick Tips:</strong><br>• Save this email and the attached PDF ticket<br>• Show the QR code at the entrance for quick scanning<br>• Arrive 15 minutes before the event</p>
                    </div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                    <p style="margin: 0 0 10px; font-size: 14px; color: #666666;">Need help? Contact us anytime</p>
                    <p style="margin: 0; font-size: 12px; color: #999999;">© ${new Date().getFullYear()} 234 Tickets. All rights reserved.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
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
    .map((t) => `<tr><td style="padding: 8px 12px; font-size: 14px; color: #333333; border-bottom: 1px solid #f0f0f0;">${t.name.toUpperCase()}</td><td style="padding: 8px 12px; font-size: 14px; color: #228B22; font-weight: 700; text-align: right; border-bottom: 1px solid #f0f0f0;">x${t.quantity}</td></tr>`)
    .join("");
  const ownerEmail = {
    from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
    to: user.email,
    subject: `📢 New Ticket Order for ${title}`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Order Notification</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #DC143C 0%, #B01030 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">📢 New Order Alert!</h1>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #333333;">Hi <strong>${user.name}</strong>,</p>
                    <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #333333;">You've received a new ticket order for <strong style="color: #DC143C;">${title}</strong>! 🎉</p>
                    
                    <!-- Order Summary Card -->
                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 30px; background-color: #f9f9f9; border-radius: 12px; overflow: hidden;">
                      <tr>
                        <td style="padding: 20px;">
                          <h3 style="margin: 0 0 16px; font-size: 16px; color: #DC143C; font-weight: 700;">Order Details</h3>
                          
                          <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #666666;">Reference</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #DC143C; font-weight: 700; text-align: right; font-family: monospace;">${reference}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #666666;">Customer</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #333333; font-weight: 600; text-align: right;">${contact.name || user.name}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #666666;">Email</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #333333; text-align: right;">${contact.email}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #666666;">Event Date</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #333333; font-weight: 600; text-align: right;">${formattedDate} at ${startTime}</td>
                            </tr>
                          </table>

                          <h4 style="margin: 20px 0 12px; font-size: 14px; color: #666666; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Tickets Ordered</h4>
                          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                            ${ticketListHtml}
                            <tr style="background-color: #f0f0f0;">
                              <td style="padding: 12px; font-size: 16px; color: #333333; font-weight: 700;">Total</td>
                              <td style="padding: 12px; font-size: 18px; color: #228B22; font-weight: 700; text-align: right;">${currencySymbol}${price}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Action Prompt -->
                    <div style="background-color: #e8f5e9; border-left: 4px solid #228B22; padding: 16px; border-radius: 8px;">
                      <p style="margin: 0; font-size: 14px; color: #2e7d32; line-height: 1.5;"><strong>✅ Action Required:</strong><br>Log in to your dashboard to view complete order details and manage your event.</p>
                    </div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                    <p style="margin: 0 0 10px; font-size: 14px; color: #666666;">Manage your events at 234 Tickets</p>
                    <p style="margin: 0; font-size: 12px; color: #999999;">© ${new Date().getFullYear()} 234 Tickets. All rights reserved.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
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

// ✅ Paystack Webhook Handler (exported for direct app registration with raw body parser)
const paystackWebhookHandler = async (req, res) => {
  const crypto = require("crypto");
  
  const rawBody = req.body.toString('utf8');
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  if (hash === req.headers["x-paystack-signature"]) {
    const event = JSON.parse(rawBody);
    
    if (event.event === "charge.success") {
      const { reference, metadata } = event.data;
      
      console.log(`✅ Paystack webhook received for reference: ${reference}`);
      
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
            console.log(`📦 Creating order from Paystack webhook for reference: ${reference}`);
            
            const orderData = {
              ...metadata.orderData,
              reference,
              currency: metadata.currency || metadata.orderData.currency || "NGN",
            };
            
            // ✅ Process order (promo code handled inside helper function)
            await processOrderWithTicket(orderData);
            console.log(`✅ Order created successfully from Paystack webhook: ${reference}`);
          } else {
            console.log(`⚠️ No metadata found for reference: ${reference}. Waiting for frontend to create order.`);
          }
        } catch (error) {
          console.error("❌ Paystack webhook order processing error:", error);
        }
      });
    } else {
      res.sendStatus(200);
    }
  } else {
    console.error("❌ Invalid Paystack webhook signature");
    console.error("❌ Expected hash does not match received signature");
    res.sendStatus(400);
  }
};

// ✅ Stripe Payment Intent - Initialize Payment
router.post("/stripe/create-payment-intent", async (req, res) => {
  const { email, amount, metadata, currency } = req.body;

  try {
    const requestedCurrency = (currency || "USD").toLowerCase();
    
    const STRIPE_SUPPORTED_CURRENCIES = ["usd", "gbp", "eur"];
    
    if (!STRIPE_SUPPORTED_CURRENCIES.includes(requestedCurrency)) {
      return res.status(400).json({ 
        error: `Currency '${requestedCurrency.toUpperCase()}' is not supported by Stripe. Please use one of: USD, GBP, or EUR.`,
        supportedCurrencies: STRIPE_SUPPORTED_CURRENCIES.map(c => c.toUpperCase())
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: requestedCurrency,
      receipt_email: email,
      metadata: {
        ...metadata,
        email,
        currency: requestedCurrency.toUpperCase(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
    
    console.log("✅ Stripe Payment Intent created:", paymentIntent.id);
  } catch (error) {
    console.error("❌ Stripe Payment Intent Error:", error.message);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});

// ✅ Stripe Webhook Handler (exported for direct app registration)
const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const { metadata } = paymentIntent;

    console.log(`✅ Stripe webhook received for payment: ${paymentIntent.id}`);

    res.sendStatus(200);

    setImmediate(async () => {
      try {
        const reference = paymentIntent.id;
        
        const existingOrder = await Order.findOne({ reference });
        
        if (existingOrder) {
          console.log(`✅ Order already exists for Stripe payment: ${reference}`);
          return;
        }
        
        if (metadata && metadata.orderData) {
          console.log(`📦 Creating order from Stripe webhook: ${reference}`);
          
          const orderData = JSON.parse(metadata.orderData);
          orderData.reference = reference;
          orderData.currency = metadata.currency || "USD";
          
          await processOrderWithTicket(orderData);
          console.log(`✅ Order created successfully from Stripe webhook: ${reference}`);
        } else {
          console.log(`⚠️ No metadata found for Stripe payment: ${reference}`);
        }
      } catch (error) {
        console.error("❌ Stripe webhook order processing error:", error);
      }
    });
  } else {
    res.sendStatus(200);
  }
};

// ✅ Fincra Create Checkout - Initialize Payment (Official Checkout Redirect API)
// Documentation: https://docs.fincra.com/docs/checkout-redirect
router.post("/fincra/create-checkout", async (req, res) => {
  const { email, amount, metadata, currency } = req.body;

  try {
    // ✅ Check if Fincra credentials are configured
    if (!FINCRA_SECRET_KEY || !FINCRA_PUBLIC_KEY) {
      console.error("❌ Fincra credentials not configured - FINCRA_SECRET_KEY:", !!FINCRA_SECRET_KEY, "FINCRA_PUBLIC_KEY:", !!FINCRA_PUBLIC_KEY);
      return res.status(500).json({ error: "Fincra is not configured. Please contact support." });
    }

    const requestedCurrency = (currency || "NGN").toUpperCase();
    
    // Per official docs: Supported currencies for checkout
    const FINCRA_SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "UGX", "ZMW", "ZAR", "USD", "XAF", "XOF", "TZS"];
    
    if (!FINCRA_SUPPORTED_CURRENCIES.includes(requestedCurrency)) {
      return res.status(400).json({ 
        error: `Currency '${requestedCurrency}' is not supported by Fincra. Please use one of: ${FINCRA_SUPPORTED_CURRENCIES.join(', ')}.`,
        supportedCurrencies: FINCRA_SUPPORTED_CURRENCIES
      });
    }

    // ✅ Environment-aware API URL (sandbox vs production)
    const isLiveKey = FINCRA_SECRET_KEY && (FINCRA_SECRET_KEY.startsWith('sk_live') || FINCRA_SECRET_KEY.includes('live'));
    const fincraApiUrl = isLiveKey ? "https://api.fincra.com" : "https://sandboxapi.fincra.com";

    // ✅ Generate unique merchant reference for this transaction
    const merchantReference = `FCR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // ✅ Determine payment methods based on currency (per official Fincra docs)
    // NGN: bank_transfer, card, payAttitude
    // GHS, KES, UGX, TZS, XAF, XOF: mobile_money
    // ZMW: mobile_money, card
    // ZAR: bank_transfer, card
    // USD: card
    let paymentMethods = [];
    let defaultPaymentMethod = "card";
    
    switch (requestedCurrency) {
      case "NGN":
        paymentMethods = ["bank_transfer", "card", "payAttitude"];
        defaultPaymentMethod = "bank_transfer";
        break;
      case "GHS":
        paymentMethods = ["mobile_money", "bank_transfer"];
        defaultPaymentMethod = "mobile_money";
        break;
      case "KES":
      case "UGX":
      case "TZS":
      case "XAF":
      case "XOF":
        paymentMethods = ["mobile_money"];
        defaultPaymentMethod = "mobile_money";
        break;
      case "ZMW":
        paymentMethods = ["mobile_money", "card"];
        defaultPaymentMethod = "mobile_money";
        break;
      case "ZAR":
        paymentMethods = ["bank_transfer", "card"];
        defaultPaymentMethod = "card";
        break;
      case "USD":
        paymentMethods = ["card"];
        defaultPaymentMethod = "card";
        break;
      default:
        paymentMethods = ["card"];
        defaultPaymentMethod = "card";
    }

    // ✅ Build checkout payload per official Fincra Checkout Redirect API
    const checkoutData = {
      amount: Math.round(amount),
      currency: requestedCurrency,
      customer: {
        name: metadata?.orderData?.contact?.name || "Customer",
        email: email,
        phoneNumber: metadata?.orderData?.contact?.phone || "",
      },
      reference: merchantReference,
      feeBearer: "customer",
      paymentMethods: paymentMethods,
      defaultPaymentMethod: defaultPaymentMethod,
      redirectUrl: `${process.env.FRONTEND_URL}/payment-success`,
      settlementDestination: "wallet",
      successMessage: "Payment successful! Your ticket has been confirmed.",
    };

    // Include metadata for webhook processing
    if (metadata) {
      checkoutData.metadata = {
        ...metadata,
        currency: requestedCurrency,
      };
    }

    console.log("📤 Fincra checkout request:", JSON.stringify(checkoutData, null, 2));
    console.log("📤 Fincra API URL:", `${fincraApiUrl}/checkout/payments`);

    const response = await axios.post(
      `${fincraApiUrl}/checkout/payments`,
      checkoutData,
      {
        headers: {
          "accept": "application/json",
          "api-key": FINCRA_SECRET_KEY,
          "x-pub-key": FINCRA_PUBLIC_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📥 Fincra response:", JSON.stringify(response.data, null, 2));

    if (response.data && response.data.status === true && response.data.data) {
      res.status(200).json({
        status: true,
        data: {
          checkout_url: response.data.data.link,
          reference: merchantReference,
          payCode: response.data.data.payCode,
        },
      });
      
      console.log("✅ Fincra Checkout created - Link:", response.data.data.link, "PayCode:", response.data.data.payCode);
    } else {
      console.error("❌ Unexpected Fincra response:", response.data);
      res.status(500).json({ error: "Unexpected response from Fincra" });
    }
  } catch (error) {
    console.error("❌ Fincra Checkout Error:", error?.response?.data || error.message);
    console.error("❌ Fincra Full Error:", JSON.stringify(error?.response?.data, null, 2));
    const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message || "Failed to create Fincra checkout";
    res.status(500).json({ error: errorMessage });
  }
});

// ✅ Fincra Webhook Handler (exported for direct app registration)
const fincraWebhookHandler = async (req, res) => {
  const crypto = require("crypto");
  const signature = req.headers["signature"];

  if (!signature) {
    console.error("❌ Fincra webhook: No signature header found");
    return res.status(400).send("No signature header");
  }

  try {
    const rawBody = req.body.toString('utf8');
    
    const hash = crypto
      .createHmac("sha512", FINCRA_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (hash !== signature) {
      console.error("❌ Fincra webhook signature verification failed");
      console.error("Expected:", hash);
      console.error("Received:", signature);
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(rawBody);
    
    if (event.event === "charge.successful") {
      const paymentData = event.data;
      const reference = paymentData.reference;
      const merchantReference = paymentData.merchantReference;
      
      console.log(`✅ Fincra webhook received for reference: ${reference}`);
      
      res.sendStatus(200);
      
      setImmediate(async () => {
        try {
          const existingOrder = await Order.findOne({ reference });
          
          if (existingOrder) {
            console.log(`✅ Order already exists for Fincra payment: ${reference}`);
            return;
          }
          
          if (paymentData.metadata && paymentData.metadata.orderData) {
            console.log(`📦 Creating order from Fincra webhook: ${reference}`);
            
            const orderData = paymentData.metadata.orderData;
            orderData.reference = reference;
            orderData.currency = paymentData.currency || paymentData.metadata.currency || "NGN";
            
            await processOrderWithTicket(orderData);
            console.log(`✅ Order created successfully from Fincra webhook: ${reference}`);
          } else {
            console.log(`⚠️ No metadata found for Fincra payment: ${reference}`);
          }
        } catch (error) {
          console.error("❌ Fincra webhook order processing error:", error);
        }
      });
    } else {
      res.sendStatus(200);
    }
  } catch (err) {
    console.error("❌ Fincra webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

// ✅ Alat Pay - Returns configuration for frontend Web Plugin popup
// Per official docs: https://docs.alatpay.ng/web-plugin
// Uses frontend script: https://web.alatpay.ng/js/alatpay.js
// Supports NGN and USD for cards, only NGN for other payment methods
router.post("/alatpay/create-checkout", async (req, res) => {
  const { email, amount, metadata, currency } = req.body;

  try {
    const requestedCurrency = (currency || "NGN").toUpperCase();
    
    // Per docs.alatpay.ng/web-plugin: NGN and USD for cards, only NGN for other methods
    if (!["NGN", "USD"].includes(requestedCurrency)) {
      return res.status(400).json({ 
        error: `Currency '${requestedCurrency}' is not supported by Alat Pay. Alat Pay supports NGN and USD.`,
        supportedCurrencies: ["NGN", "USD"]
      });
    }

    if (!ALATPAY_API_KEY || !ALATPAY_BUSINESS_ID) {
      console.error("❌ Alat Pay credentials not configured - ALATPAY_API_KEY:", !!ALATPAY_API_KEY, "ALATPAY_BUSINESS_ID:", !!ALATPAY_BUSINESS_ID);
      return res.status(500).json({ error: "Alat Pay is not configured. Please contact support." });
    }

    // Generate unique order reference
    const orderReference = `ALAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Per docs.alatpay.ng/web-plugin - return config for Alatpay.setup()
    // Frontend uses: https://web.alatpay.ng/js/alatpay.js
    res.status(200).json({
      status: true,
      data: {
        apiKey: ALATPAY_API_KEY,
        businessId: ALATPAY_BUSINESS_ID,
        amount: Math.round(amount),
        currency: requestedCurrency,
        email: email,
        phone: metadata?.orderData?.contact?.phone || "",
        firstName: metadata?.orderData?.contact?.name?.split(' ')[0] || "Customer",
        lastName: metadata?.orderData?.contact?.name?.split(' ').slice(1).join(' ') || "",
        reference: orderReference,
        metadata: JSON.stringify({
          orderId: orderReference,
          orderData: metadata?.orderData || {},
        })
      },
    });
    
    console.log("✅ Alat Pay config generated for Web Plugin:", orderReference);
  } catch (error) {
    console.error("❌ Alat Pay Config Error:", error.message);
    res.status(500).json({ error: "Failed to initialize Alat Pay" });
  }
});

// ✅ Alat Pay Webhook Handler (exported for direct app registration)
// Per official docs: https://docs.alatpay.ng/webhook-validation
// - Uses HMAC-SHA256 (NOT SHA512)
// - Signature is Base64 encoded
// - Header is "x-signature"
// - IP whitelist: 74.178.162.156
const alatpayWebhookHandler = async (req, res) => {
  const crypto = require("crypto");
  
  try {
    const rawBody = req.body.toString('utf8');
    const receivedSignature = req.headers["x-signature"];
    
    // Verify webhook signature if secret is configured (per docs.alatpay.ng/webhook-validation)
    if (ALATPAY_WEBHOOK_SECRET && receivedSignature) {
      // AlatPay uses HMAC-SHA256 with Base64 encoding
      const computedSignature = crypto
        .createHmac("sha256", ALATPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("base64");

      if (computedSignature !== receivedSignature) {
        console.error("❌ Alat Pay webhook signature verification failed");
        console.error("❌ Computed:", computedSignature);
        console.error("❌ Received:", receivedSignature);
        return res.status(401).send("Invalid signature");
      }
      
      console.log("✅ Alat Pay webhook signature verified");
    }

    const event = JSON.parse(rawBody);
    
    console.log("📥 Alat Pay webhook received:", JSON.stringify(event, null, 2));
    
    // Per docs.alatpay.ng/setup-webhook-url, webhook payload structure is:
    // { Value: { Data: {...}, Status: true, Message: "Success" }, StatusCode: 200 }
    const webhookData = event.Value?.Data || event.data || event;
    const isSuccessful = 
      event.Value?.Status === true ||
      webhookData.Status === "completed" ||
      webhookData.status === "completed" ||
      event.status === "successful";
    
    if (isSuccessful) {
      const reference = webhookData.Id || webhookData.id || webhookData.OrderId || webhookData.orderId;
      
      console.log(`✅ Alat Pay webhook received for reference: ${reference}`);
      
      // Respond immediately
      res.sendStatus(200);
      
      // Process order asynchronously
      setImmediate(async () => {
        try {
          const existingOrder = await Order.findOne({ reference });
          
          if (existingOrder) {
            console.log(`✅ Order already exists for Alat Pay payment: ${reference}`);
            return;
          }
          
          // Parse metadata from customer field if present
          let orderMetadata = null;
          const customerData = webhookData.Customer || webhookData.customer;
          if (customerData?.Metadata || customerData?.metadata) {
            try {
              const metadataStr = customerData.Metadata || customerData.metadata;
              orderMetadata = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
            } catch (e) {
              console.log("⚠️ Could not parse Alat Pay metadata:", e.message);
            }
          }
          
          if (orderMetadata && orderMetadata.orderData) {
            console.log(`📦 Creating order from Alat Pay webhook: ${reference}`);
            
            const orderData = orderMetadata.orderData;
            orderData.reference = reference;
            orderData.currency = webhookData.Currency || webhookData.currency || "NGN";
            
            await processOrderWithTicket(orderData);
            console.log(`✅ Order created successfully from Alat Pay webhook: ${reference}`);
          } else {
            console.log(`⚠️ No metadata found for Alat Pay payment: ${reference}. Waiting for frontend to create order.`);
          }
        } catch (error) {
          console.error("❌ Alat Pay webhook order processing error:", error);
        }
      });
    } else {
      console.log(`ℹ️ Alat Pay webhook event (non-success):`, webhookData.Status || webhookData.status);
      res.sendStatus(200);
    }
  } catch (err) {
    console.error("❌ Alat Pay webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

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

module.exports = {
  router,
  paystackWebhookHandler,
  stripeWebhookHandler,
  fincraWebhookHandler,
  alatpayWebhookHandler,
};
