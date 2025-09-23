const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const QRCode = require("qrcode");

async function generateTicketPDF(order) {
  const qr = await QRCode.toDataURL(order.reference);

  let html = fs.readFileSync(path.join(__dirname, "ticketTemplate.html"), "utf8");
  html = html
    .replace("{{eventName}}", order.title)
    .replace("{{reference}}", order.reference)
    .replace("{{name}}", order.contact.name)
    .replace("{{email}}", order.contact.email)
    .replace("{{price}}", order.price)
    .replace("{{qrCode}}", qr);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await browser.close();

  return pdf;
}

(async () => {
  const testOrder = {
    title: "Afrobeat Music Festival",
    reference: "ABC123XYZ",
    contact: {
      name: "John Doe",
      email: "john@example.com",
    },
    price: "25,000",
  };

  const pdfBuffer = await generateTicketPDF(testOrder);

  fs.writeFileSync("test-ticket.pdf", pdfBuffer);
  console.log("✅ Ticket PDF generated: test-ticket.pdf");
})();
