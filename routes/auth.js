const router = require("express").Router();
const User = require("../models/user");
const verifyToken = require("../middelwares/verify-token");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const Order = require("../models/order");
const mongoose = require("mongoose");
//const Payout = require("../models/payout");
const { OAuth2Client } = require("google-auth-library");
const oauth2Client = new OAuth2Client();
router.post("/auth/google", async (req, res) => {
  try {
    const code = req.headers.authorization;
    ////console.log('Authorization Code:', code);

    // Exchange the authorization code for an access token
    const response = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    });
    const accessToken = response.data.access_token;
    ////console.log('Access Token:', accessToken);

    // Fetch user details using the access token
    const userResponse = await axios.get(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    const userDetails = userResponse.data;
    ////console.log('User Details:', userDetails);

    // Check if the user already exists in the database
    let user = await User.findOne({
      email: userDetails.email,
    });

    if (!user) {
      // User does not exist, create a new user instance
      user = new User({
        name: userDetails.name,
        email: userDetails.email,
        picture: userDetails.picture,
        password: "your_default_password_here",
        isAdmin: true,
      });

      // Save the new user to the database
      await user.save();
      ////console.log('New user saved to the database');
    } else {
      // User already exists, update the user details
      user.name = userDetails.name;
      user.picture = userDetails.picture;
      await user.save();
      ////console.log('User updated in the database');
    }

    let token = jwt.sign(user.toJSON(), process.env.SECRET, {
      expiresIn: 604800, //1 WEEK
    });

    // Send the token and user details back to the frontend
    res.status(200).json({
      userDetails,
      token,
    });

    // ...
  } catch (error) {
    console.error("Error saving code:", error);
    res.status(500).json({
      message: "Failed to save code",
    });
  }
});
// Login
router.post("/auth/login", async (req, res) => {
  try {
    let foundUser = await User.findOne({ email: req.body.email });

    if (!foundUser) {
      return res.status(403).json({
        success: false,
        message: "Authentication failed, user not found.",
      });
    }

    // ✅ Check if email is verified
    if (!foundUser.isVerified) {
      return res.status(401).json({
        success: false,
        message: "Please verify your email before logging in.",
      });
    }

    // ✅ Check if password matches
    if (foundUser.comparePassword(req.body.password)) {
      let token = jwt.sign(foundUser.toJSON(), process.env.SECRET, {
        expiresIn: 604800, // 1 week
      });

      return res.json({
        success: true,
        token: token,
      });
      
    } else {
      return res.status(403).json({
        success: false,
        message: "Authentication failed, wrong password.",
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Payout route
router.post("/users/:id/payout", async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.params.id;

    // 1️⃣ Validate request
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid payout amount",
      });
    }

    // 2️⃣ Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 3️⃣ Check unpaid earnings (use your calculation)
    const orders = await Order.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: null, totalEarnings: { $sum: "$price" } } },
    ]);

    const totalEarnings = orders.length ? orders[0].totalEarnings : 0;
    const unpaidEarnings = totalEarnings - (user.totalPaidOut || 0);

    if (amount > unpaidEarnings) {
      return res.status(400).json({
        success: false,
        message: "Insufficient unpaid earnings",
      });
    }

    // 4️⃣ Update payout info
    user.totalPaidOut = (user.totalPaidOut || 0) + amount;
    user.payouts.push({ amount, date: new Date() });
    await user.save();

    // 5️⃣ Send success response
    res.status(200).json({
      success: true,
      message: `₦${amount} paid out successfully`,
      totalPaidOut: user.totalPaidOut,
    });
    console.log("✅ Payout successful");
  } catch (err) {
    console.error("Payout Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
});

// Sign Up
router.post("/auth/signup", async (req, res) => {
  const { name, email, password, brand } = req.body;

  if (!email || !password) {
    return res.json({
      success: false,
      message: "Please enter your email and password",
    });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    const newUser = new User({
      name,
      email,
      password,
      brand,
      isVerified: false, // Add this field to your User model
    });

    const token = jwt.sign({ email }, process.env.SECRET, {
      expiresIn: "1d",
    });

    const confirmURL = `${process.env.FRONTEND_URL}/confirm-email?token=${token}`;

    const mailOptions = {
      from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
      to: email,
      subject: "Confirm your Email",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Email</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 20px 0;">
                <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #228B22 0%, #047143 100%); padding: 50px 30px; text-align: center;">
                      <div style="background-color: rgba(255,255,255,0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 48px;">✉️</span>
                      </div>
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Welcome to 234 Tickets!</h1>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 40px 30px;">
                      <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #333333;">Hi <strong>${name}</strong>,</p>
                      <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #333333;">Thanks for signing up! We're excited to have you on board. To get started, please confirm your email address by clicking the button below.</p>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                        <tr>
                          <td align="center">
                            <a href="${confirmURL}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #228B22 0%, #047143 100%); color: #ffffff; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 700; box-shadow: 0 4px 15px rgba(34,139,34,0.3);">Confirm Email Address</a>
                          </td>
                        </tr>
                      </table>

                      <!-- Alternative Link -->
                      <p style="margin: 30px 0 0; font-size: 14px; line-height: 1.6; color: #666666; text-align: center;">Or copy and paste this link into your browser:</p>
                      <p style="margin: 10px 0 0; font-size: 13px; color: #228B22; word-break: break-all; text-align: center; background-color: #f9f9f9; padding: 12px; border-radius: 8px;">${confirmURL}</p>
                      
                      <!-- Info Box -->
                      <div style="background-color: #fff3cd; border-left: 4px solid #DC143C; padding: 16px; border-radius: 8px; margin: 30px 0 0;">
                        <p style="margin: 0; font-size: 14px; color: #856404; line-height: 1.5;"><strong>🔒 Security Note:</strong><br>This link will expire in 24 hours. If you didn't create an account, please ignore this email.</p>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                      <p style="margin: 0 0 10px; font-size: 14px; color: #666666;">Need help? Contact our support team</p>
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

    await newUser.save();

    // ✅ Send confirmation email asynchronously with retry logic (non-blocking)
    setImmediate(async () => {
      if (!process.env.GOOGLE_APP_EMAIL || !process.env.GOOGLE_APP_PW) {
        console.error("❌ CRITICAL: Email credentials not configured! Cannot send confirmation email to:", email);
        return;
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

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await transporter.sendMail(mailOptions);
          console.log(`✅ Confirmation email sent to ${email}`);
          break;
        } catch (error) {
          console.error(`❌ Email attempt ${attempt}/3 failed for ${email}:`, error.message);
          console.error(`❌ Full error:`, error);
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          } else {
            console.error(`❌ All confirmation email attempts failed for ${email}`);
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      message:
        "Signup successful. Please check your email to confirm your account.",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});
router.get("/auth/confirm/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const decoded = jwt.verify(token, process.env.SECRET);
    const user = await User.findOne({ email: decoded.email });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid token or user not found." });
    }

    if (user.isVerified) {
      return res
        .status(200)
        .json({ success: true, message: "Email already verified." });
    }

    user.isVerified = true;
    await user.save();

    return res
      .status(200)
      .json({ success: true, message: "Email successfully verified!" });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid or expired token." });
  }
});

router.post("/auth/forgotPassword", async (req, res) => {
  ////console.log(res);
  if (process.env.GOOGLE_APP_EMAIL && process.env.GOOGLE_APP_PW) {
    const email = req.body.email;
    console.log(email);
    User.findOne(
      {
        email,
      },
      (err, user) => {
        if (err || !user) {
          return res.status(400).json({
            error: "User with this email does not exist",
          });
        }

        const token = jwt.sign(
          {
            _id: user._id,
          },
          process.env.RESET_PASSWORD_KEY,
          {
            expiresIn: "15m",
          }
        );

        let mailTransporter = nodemailer.createTransport({
          host: "mail.privateemail.com", // ✅ NOT smtp.gmail.com
          port: 465, // ✅ Secure SSL port
          secure: true,
          auth: {
            user: process.env.GOOGLE_APP_EMAIL,
            pass: process.env.GOOGLE_APP_PW,
          },
        });

        const data = {
          from: `"234 Tickets" <${process.env.GOOGLE_APP_EMAIL}>`,
          to: email,
          subject: "Reset Account Password Link",
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Password Reset</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                      <!-- Header -->
                      <tr>
                        <td style="background: linear-gradient(135deg, #DC143C 0%, #B01030 100%); padding: 50px 30px; text-align: center;">
                          <div style="background-color: rgba(255,255,255,0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                            <span style="font-size: 48px;">🔒</span>
                          </div>
                          <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Password Reset Request</h1>
                        </td>
                      </tr>
                      
                      <!-- Content -->
                      <tr>
                        <td style="padding: 40px 30px;">
                          <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #333333;">Hi there,</p>
                          <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #333333;">We received a request to reset your password. Click the button below to create a new password for your 234 Tickets account.</p>
                          
                          <!-- CTA Button -->
                          <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                            <tr>
                              <td align="center">
                                <a href="${process.env.FRONTEND_URL}/reset?token=${token}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #DC143C 0%, #B01030 100%); color: #ffffff; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 700; box-shadow: 0 4px 15px rgba(220,20,60,0.3);">Reset My Password</a>
                              </td>
                            </tr>
                          </table>

                          <!-- Alternative Link -->
                          <p style="margin: 30px 0 0; font-size: 14px; line-height: 1.6; color: #666666; text-align: center;">Or copy and paste this link into your browser:</p>
                          <p style="margin: 10px 0 0; font-size: 13px; color: #DC143C; word-break: break-all; text-align: center; background-color: #f9f9f9; padding: 12px; border-radius: 8px;">${process.env.FRONTEND_URL}/reset?token=${token}</p>
                          
                          <!-- Warning Box -->
                          <div style="background-color: #fff3cd; border-left: 4px solid #DC143C; padding: 16px; border-radius: 8px; margin: 30px 0 0;">
                            <p style="margin: 0 0 10px; font-size: 14px; color: #856404; line-height: 1.5;"><strong>⏱️ Important:</strong><br>This password reset link will expire in <strong>15 minutes</strong> for security reasons.</p>
                            <p style="margin: 0; font-size: 14px; color: #856404; line-height: 1.5;">If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
                          </div>
                        </td>
                      </tr>
                      
                      <!-- Footer -->
                      <tr>
                        <td style="background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                          <p style="margin: 0 0 10px; font-size: 14px; color: #666666;">Need help? Contact our support team</p>
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

        return user.updateOne(
          {
            resetLink: token,
          },
          (err, user) => {
            if (err) {
              return res.status(400).json({
                error: "Reset password link error",
              });
            } else {
              mailTransporter.sendMail(data, function (error, body) {
                if (error) {
                  console.error("❌ Password reset email failed:", error.message);
                  console.error("❌ Full error:", error);
                  return res.status(400).json({
                    error: error.message,
                  });
                }
                console.log(`✅ Password reset email sent to ${email}`);
                return res.status(200).json({
                  message:
                    "Email has been sent, please follow the instructions",
                });
              });
            }
          }
        );
      }
    );
  } else {
    return res.status(400).json({
      error:
        "You have not set up an account to send an email or a reset password key for jwt",
    });
  }
});

router.post("/auth/updatePassword", async (req, res) => {
  ////console.log(res);
  const { token, password } = req.body;
  if (token) {
    jwt.verify(
      token,
      process.env.RESET_PASSWORD_KEY,
      function (error, decodedData) {
        if (error) {
          return res.status(400).json({
            error: "Incorrect token or it is expired",
          });
        }
        User.findOne(
          {
            resetLink: token,
          },
          (err, user) => {
            if (err || !user) {
              return res.status(400).json({
                error: "User with this token does not exist",
              });
            }

            user.password = password;
            user.save((err, result) => {
              if (err) {
                ////console.log(err)
                return res.status(400).json({
                  error: "Reset Password Error",
                });
              } else {
                return res.status(200).json({
                  message: "Your password has been changed",
                });
              }
            });
          }
        );
      }
    );
  } else {
    return res.status(401).json({
      error: "Authentication Error",
    });
  }
});
// Get Profile
router.get("/auth/user", verifyToken, async (req, res) => {
  try {
    let foundUser = await User.findOne({
      _id: req.decoded._id,
    }).populate("address"); // Populate the address field with the actual address object

    if (foundUser) {
      res.json({
        success: true,
        user: foundUser,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Update profile
router.put("/auth/user", verifyToken, async (req, res) => {
  try {
    let foundUser = await User.findOne({
      _id: req.decoded._id,
    });

    if (foundUser) {
      if (req.body.name) foundUser.name = req.body.name;
      if (req.body.email) foundUser.email = req.body.email;
      if (req.body.password) foundUser.password = req.body.password;

      await foundUser.save();

      res.json({
        success: true,
        message: "Successfully updated",
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.get(`/users`, async (req, res) => {
  try {
    // 1️⃣ Aggregate total earnings from orders
    const earnings = await Order.aggregate([
      {
        $group: {
          _id: "$userId",
          totalEarnings: { $sum: "$price" },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    // 2️⃣ Map earnings by userId
    const earningsMap = {};
    earnings.forEach((e) => {
      earningsMap[e._id.toString()] = {
        totalEarnings: e.totalEarnings,
        orderCount: e.orderCount,
      };
    });

    // 3️⃣ Fetch users from DB (including totalPaidOut & payouts)
    let users = await User.find();

    // 4️⃣ Merge user data + earnings
    let usersWithEarnings = users.map((user) => {
      const e = earningsMap[user._id.toString()] || {
        totalEarnings: 0,
        orderCount: 0,
      };
      return {
        _id: user._id,
        name: user.name,
        brand: user.brand,
        email: user.email,
        picture: user.picture,
        role: user.role,
        isVerified: user.isVerified,
        createdAt: user.time,

        // 🔑 Earnings info
        totalEarnings: e.totalEarnings,
        orderCount: e.orderCount,

        // 🔑 From User schema
        totalPaidOut: user.totalPaidOut || 0,
        unpaidEarnings: e.totalEarnings - (user.totalPaidOut || 0),

        // Optional: include payout history
        payouts: user.payouts || [],
      };
    });

    // 5️⃣ Sort by totalEarnings
    usersWithEarnings.sort((a, b) => b.totalEarnings - a.totalEarnings);

    res.json({
      status: true,
      users: usersWithEarnings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
