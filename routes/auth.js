const router = require("express").Router();
const User = require("../models/user");
const verifyToken = require("../middelwares/verify-token");
const axios = require('axios');
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const {
  OAuth2Client
} = require('google-auth-library');
const oauth2Client = new OAuth2Client()
router.post('/auth/google', async (req, res) => {
  try {
    const code = req.headers.authorization;
    ////console.log('Authorization Code:', code);

    // Exchange the authorization code for an access token
    const response = await axios.post(
      'https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: 'postmessage',
        grant_type: 'authorization_code'
      }
    );
    const accessToken = response.data.access_token;
    ////console.log('Access Token:', accessToken);

    // Fetch user details using the access token
    const userResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );
    const userDetails = userResponse.data;
    ////console.log('User Details:', userDetails);


    // Check if the user already exists in the database
    let user = await User.findOne({
      email: userDetails.email
    });

    if (!user) {
      // User does not exist, create a new user instance
      user = new User({
        name: userDetails.name,
        email: userDetails.email,
        picture: userDetails.picture,
        password: 'your_default_password_here',
        isAdmin: true
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
      expiresIn: 604800 //1 WEEK
    });

    // Send the token and user details back to the frontend
    res.status(200).json({
      userDetails,
      token
    });

    // ...



  } catch (error) {
    console.error('Error saving code:', error);
    res.status(500).json({
      message: 'Failed to save code'
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
        message: "Authentication failed, user not found."
      });
    }

    // ✅ Check if email is verified
    if (!foundUser.isVerified) {
      return res.status(401).json({
        success: false,
        message: "Please verify your email before logging in."
      });
    }

    // ✅ Check if password matches
    if (foundUser.comparePassword(req.body.password)) {
      let token = jwt.sign(foundUser.toJSON(), process.env.SECRET, {
        expiresIn: 604800 // 1 week
      });

      return res.json({
        success: true,
        token: token
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Authentication failed, wrong password."
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


// Sign Up
router.post("/auth/signup", async (req, res) => {
  const { name, email, password,brand } = req.body;

  if (!email || !password) {
    return res.json({
      success: false,
      message: "Please enter your email and password"
    });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already exists"
      });
    }

    const newUser = new User({
      name,
      email,
      password,
      brand,
      isVerified: false // Add this field to your User model
    });

    const token = jwt.sign({ email }, process.env.SECRET, {
      expiresIn: "1d"
    });

    const confirmURL = `${process.env.FRONTEND_URL}/confirm-email?token=${token}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GOOGLE_APP_EMAIL,
        pass: process.env.GOOGLE_APP_PW
      }
    });

    const mailOptions = {
      from: process.env.GOOGLE_APP_EMAIL,
      to: email,
      subject: "Confirm your Email",
      html: `
        <h3>Thanks for signing up, ${name}!</h3>
        <p>Please click the link below to confirm your email:</p>
        <a href="${confirmURL}">${confirmURL}</a>
      `
    };

    await newUser.save();

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      } else {
        return res.status(200).json({
          success: true,
          message: "Signup successful. Please check your email to confirm your account."
        });
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
router.get("/auth/confirm/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const decoded = jwt.verify(token, process.env.SECRET);
    const user = await User.findOne({ email: decoded.email });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid token or user not found." });
    }

    if (user.isVerified) {
      return res.status(200).json({ success: true, message: "Email already verified." });
    }

    user.isVerified = true;
    await user.save();

    return res.status(200).json({ success: true, message: "Email successfully verified!" });
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid or expired token." });
  }
});

  router.post("/auth/forgotPassword", async (req, res) => {
    ////console.log(res);
    if (process.env.GOOGLE_APP_EMAIL && process.env.GOOGLE_APP_PW) {
      const email = req.body.email;
      User.findOne({
        email
      }, (err, user) => {
        if (err || !user) {
          return res
            .status(400)
            .json({
              error: "User with this email does not exist"
            });
        }

        const token = jwt.sign({
            _id: user._id
          },
          process.env.RESET_PASSWORD_KEY, {
            expiresIn: "15m"
          }
        );

        let mailTransporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.GOOGLE_APP_EMAIL,
            pass: process.env.GOOGLE_APP_PW
          }
        });

        const data = {
          to: email,
          subject: "Reset Account Password Link",
          html: `
          <h3>Please click the link below to reset your password</h3>
          <p>${process.env.FRONTEND_URL}/reset?token=${token}</p>
          `
        };

        return user.updateOne({
          resetLink: token
        }, (err, user) => {
          if (err) {
            return res.status(400).json({
              error: "Reset password link error"
            });
          } else {
            mailTransporter.sendMail(data, function (error, body) {
              if (error) {
                return res.status(400).json({
                  error: error.message
                });
              }
              return res
                .status(200)
                .json({
                  message: "Email has been sent, please follow the instructions"
                });
            });
          }
        });
      });
    } else {
      return res
        .status(400)
        .json({
          error: "You have not set up an account to send an email or a reset password key for jwt"
        });
    }
  });

router.post("/auth/updatePassword", async (req, res) => {
  ////console.log(res);
  const {
    token,
    password
  } = req.body;
  if (token) {
    jwt.verify(token, process.env.RESET_PASSWORD_KEY, function (
      error,
      decodedData
    ) {
      if (error) {
        return res
          .status(400)
          .json({
            error: "Incorrect token or it is expired"
          });
      }
      User.findOne({
        resetLink: token
      }, (err, user) => {
        if (err || !user) {
          return res
            .status(400)
            .json({
              error: "User with this token does not exist"
            });
        }

        user.password = password
        user.save((err, result) => {
          if (err) {
            ////console.log(err)
            return res.status(400).json({
              error: "Reset Password Error"
            });
          } else {
            return res
              .status(200)
              .json({
                message: "Your password has been changed"
              });
          }
        });
      });
    });
  } else {
    return res.status(401).json({
      error: "Authentication Error"
    });
  }
});
// Get Profile
router.get("/auth/user", verifyToken, async (req, res) => {
  try {
    let foundUser = await User.findOne({
      _id: req.decoded._id
    }).populate("address"); // Populate the address field with the actual address object

    if (foundUser) {
      res.json({
        success: true,
        user: foundUser
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Update profile
router.put("/auth/user", verifyToken, async (req, res) => {
  try {
    let foundUser = await User.findOne({
      _id: req.decoded._id
    });

    if (foundUser) {
      if (req.body.name) foundUser.name = req.body.name;
      if (req.body.email) foundUser.email = req.body.email;
      if (req.body.password) foundUser.password = req.body.password;

      await foundUser.save();

      res.json({
        success: true,
        message: "Successfully updated"
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.get(`/users`, async (req, res) => {
  try {
    let users = await User.find();

    res.json({
      status: true,
      users: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;