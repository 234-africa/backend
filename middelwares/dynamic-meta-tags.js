const fs = require("fs");
const path = require("path");
const Product = require("../models/product");

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const dynamicMetaTags = async (req, res, next) => {
  const url = req.path;

  if (url.startsWith("/event/")) {
    try {
      const titleParam = url.replace("/event/", "");
      const decodedTitle = decodeURIComponent(titleParam).trim().replace(/-/g, " ");

      let product = await Product.findOne({
        title: new RegExp("^" + decodedTitle + "$", "i"),
      });

      if (!product) {
        product = await Product.findOne({
          customizeUrl: new RegExp("^" + decodedTitle + "$", "i"),
        });
      }

      if (product) {
        const indexPath = path.resolve(__dirname, "../../frontend/dist/index.html");
        let html = fs.readFileSync(indexPath, "utf-8");

        const eventTitle = escapeHtml(product.title || "234 AFRICA Event");
        const eventDescription = product.description
          ? escapeHtml(product.description.substring(0, 200))
          : "Join us for this amazing event on 234 AFRICA.";
        const eventImage = product.photos && product.photos.length > 0
          ? escapeHtml(product.photos[0])
          : "https://234africa.com/default-event-image.png";
        const eventUrl = escapeHtml(`${req.protocol}://${req.get("host")}${req.originalUrl}`);

        const eventDate = product.event && product.event.start
          ? new Date(product.event.start).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";

        const eventLocation = product.event && product.event.location && product.event.location.name
          ? escapeHtml(product.event.location.name)
          : "Online Event";

        const fullDescription = escapeHtml(`${product.description ? product.description.substring(0, 200) : "Join us for this amazing event on 234 AFRICA."}${eventDate ? ` | Date: ${eventDate}` : ""}${eventLocation ? ` | Location: ${eventLocation}` : ""}`);

        const metaTags = `
  <meta name="description" content="${fullDescription}" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="event" />
  <meta property="og:url" content="${eventUrl}" />
  <meta property="og:title" content="${eventTitle}" />
  <meta property="og:description" content="${fullDescription}" />
  <meta property="og:image" content="${eventImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="234 AFRICA" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${eventUrl}" />
  <meta name="twitter:title" content="${eventTitle}" />
  <meta name="twitter:description" content="${fullDescription}" />
  <meta name="twitter:image" content="${eventImage}" />
  
  <!-- WhatsApp (uses Open Graph) -->
  <meta property="og:image:alt" content="${eventTitle}" />`;

        html = html.replace(
          /<title>.*?<\/title>/i,
          `<title>${eventTitle}</title>`
        );

        html = html.replace(
          /<meta\s+(?:name|property)=["'](?:description|og:title|og:description|og:image|og:type|og:url|twitter:title|twitter:description|twitter:image|twitter:card)["'][^>]*>/gi,
          ""
        );

        html = html.replace(/<head>/i, `<head>${metaTags}`);

        return res.send(html);
      }
    } catch (error) {
      console.error("Error generating dynamic meta tags:", error);
    }
  }

  next();
};

module.exports = dynamicMetaTags;
