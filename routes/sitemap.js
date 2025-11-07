const express = require("express");
const router = express.Router();
const Product = require("../models/product");
const moment = require("moment-timezone");

function filterExpiredEvents(products) {
  const now = moment();
  
  return products.filter(product => {
    if (!product.event || !product.event.start) return false;

    const eventTimezone = product.event.timezone || 'UTC';
    let eventStartMoment;

    if (product.event.startTime && /^\d{2}:\d{2}$/.test(product.event.startTime)) {
      const eventDate = moment(product.event.start).format('YYYY-MM-DD');
      const eventTime = product.event.startTime;

      eventStartMoment = moment.tz(
        `${eventDate} ${eventTime}`,
        'YYYY-MM-DD HH:mm',
        eventTimezone
      );

      if (!eventStartMoment.isValid()) {
        eventStartMoment = moment(product.event.start).tz(eventTimezone);
      }
    } else {
      eventStartMoment = moment(product.event.start).tz(eventTimezone);
    }

    const expirationTime = eventStartMoment.clone().add(12, 'hours');

    return now.isBefore(expirationTime);
  });
}

router.get("/sitemap.xml", async (req, res) => {
  try {
    const baseUrl = process.env.FRONTEND_URL || "https://234africa.com";
    
    const allProducts = await Product.find();
    const products = filterExpiredEvents(allProducts);

    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/</loc>\n`;
    sitemap += `    <changefreq>daily</changefreq>\n`;
    sitemap += `    <priority>1.0</priority>\n`;
    sitemap += `  </url>\n`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/events</loc>\n`;
    sitemap += `    <changefreq>daily</changefreq>\n`;
    sitemap += `    <priority>0.9</priority>\n`;
    sitemap += `  </url>\n`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/about</loc>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.7</priority>\n`;
    sitemap += `  </url>\n`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/how-it-works</loc>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.7</priority>\n`;
    sitemap += `  </url>\n`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/login</loc>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.6</priority>\n`;
    sitemap += `  </url>\n`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${baseUrl}/register</loc>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.6</priority>\n`;
    sitemap += `  </url>\n`;

    products.forEach((product) => {
      const eventSlug = encodeURIComponent(product.customizeUrl || product.title.replace(/\s+/g, "-").toLowerCase());
      const lastmod = product.time ? new Date(product.time).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${baseUrl}/event/${eventSlug}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.8</priority>\n`;
      sitemap += `  </url>\n`;
    });

    sitemap += '</urlset>';

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (error) {
    console.error("Error generating sitemap:", error);
    res.status(500).send("Error generating sitemap");
  }
});

module.exports = router;
