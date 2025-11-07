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
  const { email, amount } = req.body;

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100, // Convert Naira to Kobo
        callback_url: `${process.env.FRONTEND_URL}/payment-success`,
      },
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
  } = req.body;

  console.log("📦 Order request:", req.body);

  try {
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

    // ✅ Save Order first
    const orderData = {
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
    if (affiliate) orderData.affiliate = affiliate;
    if (promoCode) orderData.promoCode = promoCode;

    const order = new Order(orderData);
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
    drawField("AMOUNT", `\u20A6${price}`, currentY);

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

    // ✅ Email setup with connection pooling for faster delivery
    const mailTransporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      auth: {
        user: process.env.GOOGLE_APP_EMAIL,
        pass: process.env.GOOGLE_APP_PW,
      },
    });

    // ✅ Email to customer with enhanced HTML template
    const customerEmail = {
      from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
      to: contact.email,
      subject: "🎟️ Your Ticket Order Confirmation",
      text: `Your ticket for ${title} is confirmed!\n\nReference: ${reference}\n\nYour ticket is attached as a PDF.\n\nThank you for your purchase!\n\n234 Tickets`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 40px 30px; text-align: center; background-color: #228B22; border-radius: 8px 8px 0 0;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px;">🎉 Ticket Confirmed!</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 30px; color: #333333; font-size: 16px; line-height: 1.6;">
                      <p style="margin: 0 0 20px 0;">Dear Customer,</p>
                      <p style="margin: 0 0 20px 0;">Your ticket for <strong style="color: #228B22;">${title}</strong> has been confirmed!</p>
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0; background-color: #f9f9f9; border-radius: 6px;">
                        <tr>
                          <td style="padding: 20px;">
                            <p style="margin: 0 0 10px 0;"><strong>Booking Reference:</strong></p>
                            <p style="margin: 0; font-size: 20px; color: #228B22; font-weight: bold;">${reference}</p>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 20px 0;">Your ticket is attached to this email as a PDF. Please present it at the event entrance.</p>
                      <p style="margin: 20px 0;">Thank you for your purchase!</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 20px 30px; text-align: center; background-color: #f4f4f4; border-radius: 0 0 8px 8px; font-size: 14px; color: #666666;">
                      <p style="margin: 0;">234 Tickets - Your Premier Event Ticketing Platform</p>
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

    await mailTransporter.sendMail(customerEmail);

    // ✅ Email to event owner with enhanced template
    const ticketListHtml = tickets
      .map((t) => `<li style="margin: 5px 0;">${t.name.toUpperCase()} x${t.quantity}</li>`)
      .join("");
    const ticketListText = tickets
      .map((t) => `${t.name.toUpperCase()} x${t.quantity}`)
      .join("\n");
    const ownerEmail = {
      from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
      to: user.email,
      subject: `📢 New Ticket Order for ${title}`,
      text: `New order received for your event: ${title}\n\nCustomer: ${contact.name || user.name} (${contact.email})\nReference: ${reference}\n\nTickets:\n${ticketListText}\n\nTotal: ₦${price}\nDate: ${formattedDate} at ${startTime}\n\n234 Tickets`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 40px 30px; text-align: center; background-color: #DC143C; border-radius: 8px 8px 0 0;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px;">📢 New Order Received!</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 30px; color: #333333; font-size: 16px; line-height: 1.6;">
                      <p style="margin: 0 0 20px 0;">Hello Event Organizer,</p>
                      <p style="margin: 0 0 20px 0;">You have received a new order for <strong style="color: #DC143C;">${title}</strong></p>
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
                        <tr>
                          <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee;">
                            <strong>Customer:</strong> ${contact.name || user.name}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee;">
                            <strong>Email:</strong> ${contact.email}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee;">
                            <strong>Reference:</strong> ${reference}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee;">
                            <strong>Event Date:</strong> ${formattedDate} at ${startTime}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0; border-bottom: 1px solid #eeeeee;">
                            <strong>Total Amount:</strong> ₦${price}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 15px 0;">
                            <strong>Tickets Purchased:</strong>
                            <ul style="margin: 10px 0; padding-left: 20px;">
                              ${ticketListHtml}
                            </ul>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 20px 30px; text-align: center; background-color: #f4f4f4; border-radius: 0 0 8px 8px; font-size: 14px; color: #666666;">
                      <p style="margin: 0;">234 Tickets - Your Premier Event Ticketing Platform</p>
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

    await mailTransporter.sendMail(ownerEmail);

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

    // ✅ Response
    res.status(201).json({
      success: true,
      message: "Order saved, emails sent, and tickets updated.",
      order,
    });
  } catch (error) {
    console.error("❌ Order processing error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
