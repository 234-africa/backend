const jwt = require("jsonwebtoken");
const Staff = require("../models/staff");

module.exports = async function (req, res, next) {
  let token = req.headers["x-access-token"] || req.headers["authorization"];
  const checkBearer = "Bearer ";

  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  if (token.startsWith(checkBearer)) {
    token = token.slice(checkBearer.length);
  }

  try {
    const decoded = jwt.verify(token, process.env.SECRET);

    // ✅ Check staff instead of user
    const staff = await Staff.findById(decoded._id);
    if (!staff) {
      return res.status(401).json({ success: false, message: "Invalid token. Staff not found" });
    }

    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Failed to authenticate" });
  }
};
