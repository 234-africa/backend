const jwt = require("jsonwebtoken");
const User = require("../models/user");

module.exports = async function (req, res, next) {
  let token = req.headers["x-access-token"] || req.headers["authorization"];
  let checkBearer = "Bearer ";

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No token provided",
    });
  }

  if (token.startsWith(checkBearer)) {
    token = token.slice(checkBearer.length);
  }

  try {
    const decoded = jwt.verify(token, process.env.SECRET);
    
    // 🔒 Check if user still exists
    const user = await User.findById(decoded._id); // Or whatever your token includes (e.g. userId)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. User no longer exists.",
      });
    }

    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Failed to authenticate",
    });
  }
};
