const Product = require("../models/product");
const express = require("express");
const Category = require("../models/category");
const moment = require("moment-timezone");

const upload = require("../middelwares/upload-photo");
const verifyToken = require("../middelwares/verify-token");
const router = express.Router();
const app = express();
const cookieParser = require("cookie-parser");

app.use(cookieParser());

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
        console.warn(`Invalid event start time for product ${product._id}, falling back to event.start`);
        eventStartMoment = moment(product.event.start).tz(eventTimezone);
      }
    } else {
      if (product.event.startTime) {
        console.warn(`Invalid startTime format for product ${product._id}: ${product.event.startTime}, falling back to event.start`);
      }
      eventStartMoment = moment(product.event.start).tz(eventTimezone);
    }

    const expirationTime = eventStartMoment.clone().add(12, 'hours');

    return now.isBefore(expirationTime);
  });
}
router.post("/upload", upload.array("photos", 3), function (req, res, next) {
  res.send({
    data: req.files,
    msg: "Successfully uploaded " + req.files.length + " files!",
  });
});
router.get("/product/:idOrSlug", async (req, res) => {
  const param = req.params.idOrSlug;

  try {
    let product;

    // 🔹 Check if it's a valid ObjectId
    if (/^[0-9a-fA-F]{24}$/.test(param)) {
      product = await Product.findById(param)
        .populate("user", "brand name"); // ✅ Add this
    } else {
      // 🔹 Convert slug back to readable text
      const decoded = decodeURIComponent(param).trim().replace(/-/g, " ");

      // 🔹 Try title first
      product = await Product.findOne({
        title: new RegExp("^" + decoded + "$", "i"),
      }).populate("user", "brand name"); // ✅ Add this

      // 🔹 If not found, try customizeUrl
      if (!product) {
        product = await Product.findOne({
          customizeUrl: new RegExp("^" + decoded + "$", "i"),
        }).populate("user", "brand name"); // ✅ Add this
      }
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const activeProducts = filterExpiredEvents([product]);
    if (activeProducts.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Event has expired",
      });
    }

    // 🔹 Affiliate tracking
    const { aff } = req.query;
    if (aff) {
      res.cookie("affiliate", aff, {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: "Lax",
      });
    }

    res.json({ success: true, product });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});




router.post(
  `/products`,
  verifyToken,
  upload.array("photos", 10),
  async (req, res) => {
    try {
      
      let product = new Product();
      
      // Handle photos - only add if files were uploaded
      if (req.files && req.files.length > 0) {
        req.files.forEach((f) => product.photos.push(f.location));
      }
      
      product.category = req.body.categoryID;
      product.title = req.body.title;
      product.customizeUrl = req.body.customizeUrl;
      product.user = req.decoded._id;
      
      // Parse tickets with error handling
      let parsedTickets = [];
      if (req.body.tickets) {
        try {
          parsedTickets = JSON.parse(req.body.tickets);
        } catch (parseError) {
          console.error("Error parsing tickets:", parseError);
          return res.status(400).json({ 
            success: false, 
            message: "Invalid tickets format" 
          });
        }
      }
      
      product.event = {
        start: new Date(req.body.eventDate),

        ...(req.body.endDate ? { end: new Date(req.body.endDate) } : {}),

        startTime: req.body.startTime, // "03:00"
     
        timezone: req.body.timezone || "UTC",
        location: {
          name: req.body.locationName || "", // optional
         
        },
        tickets: parsedTickets,
      };
      
      // Handle tags - split if exists, otherwise empty array
      product.tag = req.body.tag ? req.body.tag.split(",") : [];

      product.description = req.body.description;

      product.price = req.body.price;

      await product.save();
      console.log("Product saved successfully:", product._id);

      res.json({
        status: true,
        message: "save succes",
        data: product,
        msg: "Successfully uploaded " + (req.files ? req.files.length : 0) + " files!",
      });
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ 
        success: false, 
        message: error.message || "Error creating event" 
      });
    }
  }
);
router.get("/user/products", verifyToken, async (req, res) => {
  try {
    const userId = req.decoded._id; // from token
    const products = await Product.find({ user: userId });

    res.json({
      success: true,
      count: products.length,
      products,
    });
    ////console.log("User Products:", products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/products", async (req, res) => {
  try {
    const allProducts = await Product.find()
      .populate("category")
      .exec();

    const activeProducts = filterExpiredEvents(allProducts);

    res.json({
      status: true,
      products: activeProducts,
    });
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



router.get("/categories/:categoryType", async (req, res) => {
  try {
    let categoryType = req.params.categoryType;

    const category = await Category.findOne({ type: categoryType });

    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    const allProducts = await Product.find({ 
      category: category._id
    });

    const activeProducts = filterExpiredEvents(allProducts);

    res.json({ success: true, products: activeProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// POST /products/:id/views - Update product views
router.post("/products/:id/views", async (req, res) => {
  try {
    const productId = req.params.id;

    // Find the product by ID
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Increment the views count
    product.views += 1;

    // Save the updated product
    await product.save();

    res.status(200).json({ message: "Product views updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});
// POST request to increment the likes of a product
router.post("/products/:id/like", async (req, res) => {
  const productId = req.params.id;
  ////console.log(productId);

  try {
    const product = await Product.findByIdAndUpdate(
      productId,
      { $inc: { likes: 1 } },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ likes: product.likes });
  } catch (error) {
    res.status(500).json({ error: "Failed to update likes" });
  }
});

// GET request to retrieve the total likes of a product
router.get("/products/:productId/likes", async (req, res) => {
  const productId = req.params.productId;

  try {
    const product = await Product.findById(productId);
    res.json({ likes: product.likes });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve likes" });
  }
});
router.put(
  "/product/:id",
  verifyToken,
  upload.array("photos", 10),
  async (req, res) => {
    try {
      const updateData = {};

      // If new photos are uploaded, replace them
      if (req.files && req.files.length > 0) {
        updateData.photos = req.files.map((file) => file.location);
      }

      // Basic fields
      updateData.title = req.body.title;
      updateData.price = req.body.price;
      updateData.description = req.body.description;
      updateData.category = req.body.categoryID;
      updateData.user = req.decoded._id;
      updateData.tag = req.body.tag?.split(",") || [];

      // Parse tickets with error handling
      let parsedTickets = [];
      if (req.body.tickets) {
        try {
          parsedTickets = JSON.parse(req.body.tickets);
        } catch (parseError) {
          console.error("Error parsing tickets during update:", parseError);
          return res.status(400).json({ 
            status: false, 
            message: "Invalid tickets format" 
          });
        }
      }

      // Event information
      updateData.event = {
         start: new Date(req.body.eventDate),

        ...(req.body.endDate ? { end: new Date(req.body.endDate) } : {}),
        startTime: req.body.startTime,
     
        timezone: req.body.timezone || "UTC",
        location: {
          name: req.body.locationName || "",
         
        },
        tickets: parsedTickets,
      };
      console.log(updateData)
      // Update the product
      const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true }
      );

      if (!updatedProduct) {
        return res
          .status(404)
          .json({ status: false, message: "Product not found" });
      }

      res.json({
        status: true,
        message: "Product updated successfully",
        data: updatedProduct,
      });
    } catch (error) {
      console.error("Update Error:", error);
      res.status(500).json({ status: false, message: error.message || "Server error" });
    }
  }
);
router.delete(`/product/:id`, async (req, res) => {
  try {
    let deletedProduct = await Product.findByIdAndDelete({
      _id: req.params.id,
    });
    if (deletedProduct) {
      res.json({
        status: true,
        message: "sucess",
      });
    }
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
router.post("/check-custom-url", async (req, res) => {
  try {
    const { url } = req.body; // Get plain text from body
    if (!url) {
      return res.status(400).json({ success: false, message: "No URL provided" });
    }

    // Check in DB
    const exists = await Product.findOne({ customizeUrl: url.trim() });

    if (exists) {
      return res.json({ success: false, message: "This URL is already taken" });
    }

    res.json({ success: true, message: "This URL is available" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



module.exports = router;
