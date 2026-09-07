const expmod = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const User = require("../models/user.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

/**
 * Formats a user document for API responses.
 * @param {Object} user - Mongoose user document.
 * @return {Object} Formatted user object.
 */
function userResponse(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    email: user.email || null,
    otp_verified: user.otp_verified,
    location: user.location,
    district: user.district,
    created_at: user.createdAt.toISOString(),
  };
}

/**
 * Builds the full token response for a user.
 * @param {Object} user - Mongoose user document.
 * @return {Object} Token response object.
 */
function tokenResponse(user) {
  const userId = user._id.toString();
  return {
    access_token: jwt.sign(
        {
          sub: userId,
          type: "access",
          iat: Math.floor(Date.now() / 1000),
        },
        process.env.SECRET_KEY,
        {
          expiresIn:
            process.env.ACCESS_TOKEN_EXPIRE_MINUTES + "m",
        },
    ),
    refresh_token: jwt.sign(
        {
          sub: userId,
          type: "refresh",
          tokenType: "RefToken",
          iat: Math.floor(Date.now() / 1000),
        },
        process.env.REF_TOKEN_SECRET,
        {
          expiresIn:
            process.env.REFRESH_TOKEN_EXPIRE_DAYS + "d",
        },
    ),
    token_type: "bearer",
    expires_in:
      parseInt(
          process.env.ACCESS_TOKEN_EXPIRE_MINUTES,
          10,
      ) * 60,
  };
}

router.route("/register").post(async (req, res) => {
  const name = req.body.name;
  const phone = req.body.phone;
  const email = req.body.email;
  const password = req.body.password;

  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanEmail =
    email && typeof email === "string" && email.trim()
      ? email.trim().toLowerCase()
      : null;
  try {
    const existingPhone = await User.findOne({
      phone: cleanPhone,
    });
    if (existingPhone) {
      return res.status(409).json({
        detail: "Phone number already registered",
      });
    }
    if (cleanEmail) {
      const existingEmail = await User.findOne({
        email: cleanEmail,
      });
      if (existingEmail) {
        return res.status(409).json({
          detail: "Email already registered",
        });
      }
    }
    const userData = {
      name: typeof name === "string" ? name.trim() : "",
      phone: cleanPhone,
      email: cleanEmail,
      password_hash: bcrypt.hashSync(password, 10),
    };
    const user = new User(userData);
    await user.save();
    res.status(201).json({
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({
      detail: "Internal server error",
    });
  }
});

router.route("/login").post(async (req, res) => {
  const email = req.body.email;
  const phone = req.body.phone;
  const password = req.body.password;

  try {
    let user = null;
    if (phone && typeof phone === "string" && phone.trim()) {
      user = await User.findOne({phone: phone.trim()});
    } else if (email && typeof email === "string" && email.trim()) {
      user = await User.findOne({
        email: email.trim().toLowerCase(),
      });
    }
    if (
      !user ||
      !bcrypt.compareSync(
          password,
          user.password_hash,
      )
    ) {
      return res
          .status(401)
          .json({
            detail: "Invalid credentials",
          });
    }
    res.json({
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({
      detail: "Internal server error",
    });
  }
});

router.route("/refresh").post(async (req, res) => {
  const refreshToken = req.body.refresh_token;
  try {
    const decoded = jwt.verify(
        refreshToken,
        process.env.REF_TOKEN_SECRET,
    );
    if (decoded.type !== "refresh") {
      return res
          .status(401)
          .json({
            detail: "Invalid refresh token",
          });
    }
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res
          .status(401)
          .json({
            detail: "Invalid refresh token",
          });
    }
    res.json(tokenResponse(user));
  } catch (err) {
    return res
        .status(401)
        .json({detail: "Invalid refresh token"});
  }
});

router.route("/me").get(requireAuth, (req, res) => {
  res.json(userResponse(req.user));
});

router.route("/update").post(
    requireAuth,
    async (req, res) => {
      const { location, district, push_token } = req.body;

      req.user.location = location;
      req.user.district = district;
      req.user.push_token = push_token;

      try {
        await req.user.save();
        res.json(req.user);
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/sendotp").post(async (req, res) => {
  const {phone} = req.body;
  const cleanPhone =
    typeof phone === "string" ? phone.trim() : "";

  if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({
      detail: "Enter a valid 10-digit Indian mobile number",
    });
  }

  try {
    const user = await User.findOne({phone: cleanPhone});
    if (!user) {
      return res.status(404).json({
        detail: "No account found with this mobile number",
      });
    }

    const otp = String(
        Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
    );

    user.otp_val = otp;
    user.otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const smsRes = await axios.get(
        "https://sms.hitechsms.com/app/smsapi/index.php",
        {
          params: {
            key: "569ABB2E778B41",
            campaign: 0,
            contacts: cleanPhone,
            msg: "Your OTP is " + otp + ". This code is valid for 10 minutes. Do not share it with anyone. - TWORINGS",
            senderid: "TWRING",
            routeid: 13,
            type: "text",
            template_id: "1207177106220884239",
          },
        },
    );

    res.json({
      success: true,
      message: "OTP sent successfully",
      smsResponse: smsRes.data,
    });
  } catch (err) {
    console.error("[sendotp] Error:", err.message);
    res.status(500).json({
      detail: "Failed to send OTP. Please try again.",
    });
  }
});

router.route("/verifyotp").post(async (req, res) => {
  const {phone, otp} = req.body;
  const cleanPhone =
    typeof phone === "string" ? phone.trim() : "";
  const cleanOtp =
    typeof otp === "string" ? otp.trim() : "";

  if (!cleanPhone || !cleanOtp) {
    return res.status(400).json({
      detail: "Phone and OTP are required",
    });
  }

  try {
    const user = await User.findOne({phone: cleanPhone});
    if (!user) {
      return res.status(404).json({
        detail: "No account found with this mobile number",
      });
    }

    if (!user.otp_val) {
      return res.status(400).json({
        detail: "No OTP found. Please request a new one.",
      });
    }

    if (user.otp_expires_at < new Date()) {
      return res.status(400).json({
        detail: "OTP has expired. Please request a new one.",
      });
    }

    if (user.otp_val !== cleanOtp) {
      return res.status(400).json({
        detail: "Invalid OTP. Please try again.",
      });
    }

    user.otp_verified = true;
    user.otp_val = undefined;
    user.otp_expires_at = undefined;
    await user.save();

    res.json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (err) {
    console.error("[verifyotp] Error:", err.message);
    res.status(500).json({
      detail: "Failed to verify OTP. Please try again.",
    });
  }
});

module.exports = router;
